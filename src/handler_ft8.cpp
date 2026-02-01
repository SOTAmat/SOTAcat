#include "../lib/ft8_encoder/ft8/constants.h"
#include "../lib/ft8_encoder/ft8/encode.h"
#include "../lib/ft8_encoder/ft8/pack.h"
#include "globals.h"
#include "hardware_specific.h"
#include "idle_status_task.h"
#include "kx_radio.h"
#include "timed_lock.h"
#include "webserver.h"

#include <cmath>
#include <driver/gpio.h>
#include <driver/uart.h>
#include <esp_task_wdt.h>
#include <esp_timer.h>
#include <freertos/FreeRTOS.h>
#include <freertos/queue.h>
#include <freertos/semphr.h>
#include <sys/time.h>

// Thank-you to KI6SYD for providing key information about the Elecraft KX radios and for initial testing. - AB6D

#include <esp_log.h>
static const char * TAG8 = "sc:hdl_ft8.";

/**
 * Holds the timestamp until which the radio should remain in FT8 mode. This variable is used as a watchdog timer;
 * if the system time surpasses this timestamp without any new FT8 activity, the system will automatically exit
 * FT8 mode and revert the radio to its previous state. The value is in microseconds since the Unix epoch.
 */
static int64_t CancelRadioFT8ModeTime = 0;

/**
 * Indicates whether an FT8 transmission task is currently in progress. This boolean flag helps prevent the
 * initiation of multiple concurrent FT8 transmission tasks, ensuring that only one FT8 task operates at any
 * given time, thus avoiding conflicts or resource contention in radio usage.
 */
static bool ft8TaskInProgress = false;

/**
 * A pointer to an `ft8_task_pack_t` structure containing configuration information needed for the FT8 transmission.
 * This includes base frequency, the encoded tones to transmit, and any state information necessary for managing the
 * radio device.
 * This pointer is initially set to NULL and is allocated when preparing for an FT8 transmission.
 * It must be properly managed to avoid memory leaks and is cleaned up after the transmission completes or is cancelled.
 */
typedef struct
{
    long         baseFreq;
    uint8_t *    tones;
    kx_state_t * kx_state;
} ft8_task_pack_t;

static ft8_task_pack_t * ft8ConfigInfo     = NULL;
bool                     Ft8RadioExclusive = false;

constexpr size_t         FT8_QUEUE_MAX = 4;
static long              ft8_queue[FT8_QUEUE_MAX];
static size_t            ft8_queue_head  = 0;
static size_t            ft8_queue_tail  = 0;
static size_t            ft8_queue_count = 0;
static SemaphoreHandle_t ft8_queue_mutex = nullptr;

struct Ft8ToneEvent {
    long frequency;
};

static QueueHandle_t      ft8_tone_queue  = nullptr;
static esp_timer_handle_t ft8_tone_timer  = nullptr;
static volatile size_t    ft8_tone_index  = 0;
static volatile bool      ft8_tone_active = false;
static ft8_task_pack_t *  ft8_tone_info   = nullptr;

static void ft8_tone_timer_cb (void * arg) {
    (void)arg;
    if (!ft8_tone_active || !ft8_tone_info)
        return;

    size_t idx = ft8_tone_index;
    if (idx >= FT8_NN)
        return;

    long         next_frequency = ft8_tone_info->baseFreq + (long)std::round (ft8_tone_info->tones[idx] * 6.25);
    Ft8ToneEvent event          = {next_frequency};
    if (xQueueSend (ft8_tone_queue, &event, 0) == pdTRUE) {
        ft8_tone_index = idx + 1;
    }
    else {
        // If we can't keep up with tone scheduling, abort the transmission
        CancelRadioFT8ModeTime = 1;
        ft8_tone_index         = FT8_NN;
    }
}

static void ft8_queue_init () {
    if (!ft8_queue_mutex) {
        ft8_queue_mutex = xSemaphoreCreateMutex();
    }
}

static size_t ft8_queue_size () {
    ft8_queue_init();
    if (!ft8_queue_mutex)
        return 0;

    if (xSemaphoreTake (ft8_queue_mutex, pdMS_TO_TICKS (25)) != pdTRUE)
        return 0;

    size_t count = ft8_queue_count;
    xSemaphoreGive (ft8_queue_mutex);
    return count;
}

static bool ft8_queue_push (long base_freq) {
    ft8_queue_init();
    if (!ft8_queue_mutex)
        return false;

    if (xSemaphoreTake (ft8_queue_mutex, pdMS_TO_TICKS (100)) != pdTRUE)
        return false;

    if (ft8_queue_count >= FT8_QUEUE_MAX) {
        xSemaphoreGive (ft8_queue_mutex);
        return false;
    }

    ft8_queue[ft8_queue_tail] = base_freq;
    ft8_queue_tail            = (ft8_queue_tail + 1) % FT8_QUEUE_MAX;
    ++ft8_queue_count;

    xSemaphoreGive (ft8_queue_mutex);
    return true;
}

static bool ft8_queue_pop (long & out_base_freq) {
    ft8_queue_init();
    if (!ft8_queue_mutex)
        return false;

    if (xSemaphoreTake (ft8_queue_mutex, pdMS_TO_TICKS (100)) != pdTRUE)
        return false;

    if (ft8_queue_count == 0) {
        xSemaphoreGive (ft8_queue_mutex);
        return false;
    }

    out_base_freq  = ft8_queue[ft8_queue_head];
    ft8_queue_head = (ft8_queue_head + 1) % FT8_QUEUE_MAX;
    --ft8_queue_count;

    xSemaphoreGive (ft8_queue_mutex);
    return true;
}

static void ft8_queue_clear () {
    ft8_queue_init();
    if (!ft8_queue_mutex)
        return;

    if (xSemaphoreTake (ft8_queue_mutex, pdMS_TO_TICKS (100)) != pdTRUE)
        return;

    ft8_queue_head  = 0;
    ft8_queue_tail  = 0;
    ft8_queue_count = 0;
    xSemaphoreGive (ft8_queue_mutex);
}

/**
 * Calculates the number of milliseconds until the next FT8 transmission window.
 *
 * @return The number of milliseconds until the next 15-second boundary.
 */
static long msUntilFT8Window () {
    // Obtain the current time with microsecond precision
    struct timeval tv_now;
    gettimeofday (&tv_now, NULL);

    // Convert current time to milliseconds using long long to avoid overflow
    long long now_ms = (long long)(tv_now.tv_sec) * 1000LL + (tv_now.tv_usec / 1000LL);

    // Calculate delay until the next 15-second boundary
    long delay_ms = 15000 - (now_ms % 15000LL);
    if (delay_ms == 15000)
        delay_ms = 0;  // Adjust if already at boundary

    return delay_ms;
}

/**
 * Waits for the FT8 transmission window using vTaskDelay to synchronize start time.
 */
static void waitForFT8Window () {
    ESP_LOGV (TAG8, "trace: %s()", __func__);

    long       delay_ms                       = msUntilFT8Window();
    const long cancellation_check_interval_ms = 250;

    // Wait for the next 15-second boundary to start the FT8 transmission

    // Use vTaskDelay to wait for the calculated delay in ticks
    // Note: pdMS_TO_TICKS converts milliseconds to ticks
    while (delay_ms > 0) {
        // If CancelRadioFT8ModeTime is <= 1, exit the function immediately
        if (CancelRadioFT8ModeTime <= 1) {
            ESP_LOGI (TAG8, "CancelRadioFT8ModeTime triggered, returning early.");
            return;
        }

        // Wait for the lesser of the remaining delay or the check interval
        long wait_time = (delay_ms < cancellation_check_interval_ms) ? delay_ms : cancellation_check_interval_ms;

        vTaskDelay (pdMS_TO_TICKS (wait_time));
        ESP_ERROR_CHECK (esp_task_wdt_reset());

        // Decrease the remaining delay
        delay_ms -= wait_time;
    }
}

#define EASE_STEPS 1

/**
 * Transitions from a prior frequency to a new frequency smoothly over one or more steps.
 *
 * @param base_frequency The base frequency for the FT8 transmission. Needed for KH offset calculations.
 * @param prior_frequency The frequency at which the previous tone was sent.
 * @param frequency The target frequency for the current tone.
 * @param lastWakeTime The last recorded wake time, used for task delay calculations.
 * @param toneInterval The interval at which tones should be sent, in ticks.
 */
/**
 * Task function to handle the FT8 transmission process.
 *
 * @param pvParameter A pointer to the parameter provided when the task is created. Expected to be an `ft8_task_pack_t` struct.
 */
static void xmit_ft8_task (void * pvParameter) {
    ESP_LOGV (TAG8, "trace: %s()", __func__);
    bool wdt_registered = false;
    bool timer_started  = false;

    if (ft8ConfigInfo == NULL) {
        ESP_LOGE (TAG8, "%s called with ft8ConfigInfo == NULL", __func__);
        ft8TaskInProgress = false;
        vTaskDelete (NULL);
        return;
    }

    ft8TaskInProgress = true;

    // this block encapsulates our exclusive access to the radio port
    {
        TimedLock lock = kxRadio.timed_lock (RADIO_LOCK_TIMEOUT_FT8_MS, "FT8 transmission");
        if (!lock.acquired()) {
            ESP_LOGE (TAG8, "Failed to acquire radio lock for FT8 transmission");
            CancelRadioFT8ModeTime = 1;
            ft8TaskInProgress      = false;
            ft8_queue_clear();
            goto cleanup;
        }

        // Register with watchdog timer after lock is acquired
        ESP_ERROR_CHECK (esp_task_wdt_add (NULL));
        wdt_registered = true;

        ESP_LOGI (TAG8, "ft8 transmission starting--");

        // Get ready, do any pre-work before the 'waitForFT8Window()' call so we start at the right time
        ft8_task_pack_t * info = (ft8_task_pack_t *)pvParameter;

        if (!ft8_tone_queue) {
            ft8_tone_queue = xQueueCreate (4, sizeof (Ft8ToneEvent));
            if (!ft8_tone_queue) {
                ESP_LOGE (TAG8, "Failed to create FT8 tone queue");
                ft8TaskInProgress = false;
                goto cleanup;
            }
        }

        if (!ft8_tone_timer) {
            const esp_timer_create_args_t timer_args = {
                .callback              = &ft8_tone_timer_cb,
                .arg                   = nullptr,
                .dispatch_method       = ESP_TIMER_TASK,
                .name                  = "ft8_tone",
                .skip_unhandled_events = false,
            };
            if (esp_timer_create (&timer_args, &ft8_tone_timer) != ESP_OK) {
                ESP_LOGE (TAG8, "Failed to create FT8 tone timer");
                ft8TaskInProgress = false;
                goto cleanup;
            }
        }

        while (true) {
            waitForFT8Window();
            if (CancelRadioFT8ModeTime <= 1) {
                ESP_LOGI (TAG8, "FT8 transmit cancelled before window start");
                ft8_queue_clear();
                ft8TaskInProgress = false;
                goto cleanup;
            }

            // Update the timer for when to cancel the radio FT8 mode
            int64_t watchdogTime = esp_timer_get_time() + (15LL * 1000LL * 1000LL);  // 15 seconds from now, converted to microseconds
            if (watchdogTime > CancelRadioFT8ModeTime)
                CancelRadioFT8ModeTime = watchdogTime;

            int64_t startTime = esp_timer_get_time();  // Capture the current time to calculate the total time

            // Reset watchdog before starting time-critical FT8 transmission
            ESP_ERROR_CHECK (esp_task_wdt_reset());

            // Tell the radio to turn on the CW tone
            kxRadio.ft8_tone_on();

            // Prepare timer-driven tone scheduling
            (void)xQueueReset (ft8_tone_queue);
            ft8_tone_info   = info;
            ft8_tone_index  = 1;  // tone 0 is sent immediately
            ft8_tone_active = true;

            long first_frequency = info->baseFreq + (long)std::round (info->tones[0] * 6.25);
            kxRadio.ft8_set_tone (info->baseFreq, first_frequency);

            timer_started = (esp_timer_start_periodic (ft8_tone_timer, 160000) == ESP_OK);
            if (!timer_started) {
                ESP_LOGE (TAG8, "Failed to start FT8 tone timer");
                CancelRadioFT8ModeTime = 1;
            }

            // Now tell the radio to play the remaining tones (1..78)
            for (int j = 1; j < FT8_NN; ++j) {
                if (CancelRadioFT8ModeTime <= 1)
                    break;

                Ft8ToneEvent event;
                if (xQueueReceive (ft8_tone_queue, &event, pdMS_TO_TICKS (200)) != pdTRUE) {
                    ESP_LOGW (TAG8, "FT8 tone queue timeout");
                    CancelRadioFT8ModeTime = 1;
                    break;
                }

                kxRadio.ft8_set_tone (info->baseFreq, event.frequency);
                ESP_ERROR_CHECK (esp_task_wdt_reset());
            }

            if (timer_started) {
                esp_timer_stop (ft8_tone_timer);
                timer_started = false;
            }
            ft8_tone_active = false;

            // Tell the radio to turn off the CW tone
            kxRadio.ft8_tone_off();

            // Reset watchdog after completing time-critical FT8 transmission
            ESP_ERROR_CHECK (esp_task_wdt_reset());

            // Stop the timer and calculate the total time
            int64_t endTime   = esp_timer_get_time();
            long    totalTime = (endTime - startTime) / 1000;  // Convert microseconds to milliseconds
            ESP_LOGI (TAG8, "ft8 transmission time: %ld ms", totalTime);

            if (CancelRadioFT8ModeTime <= 1) {
                ft8_queue_clear();
                break;
            }

            long next_base_freq = 0;
            if (ft8_queue_pop (next_base_freq)) {
                info->baseFreq = next_base_freq;
                ESP_LOGI (TAG8, "queued FT8 transmit scheduled");
                continue;
            }

            break;
        }
    }
    // TimedLock auto-unlocks here

    // Note that the cleanup will happen in the watchdog 'cleanup_ft8_task' function
    ft8TaskInProgress = false;
    ESP_LOGI (TAG8, "--ft8 transmission completed.");
    if (wdt_registered)
        esp_task_wdt_delete (NULL);  // Unregister before deletion
    vTaskDelete (NULL);
    return;

cleanup:
    if (timer_started)
        esp_timer_stop (ft8_tone_timer);
    ft8_tone_active = false;
    if (wdt_registered)
        esp_task_wdt_delete (NULL);
    vTaskDelete (NULL);
}

/**
 * Task function to clean up after an FT8 transmission has ended.
 * Gets called 15 seconds after the FT8 transmission starts so that we can clean up.
 * This acts as a watchdog which can be reset when repeated FT8 transmissions are sent, but
 * a few seconds after the last transmission, the watchdog will trigger and clean up.
 *
 * @param pvParameter Unused parameter, expected to be NULL.
 */
static void cleanup_ft8_task (void * pvParameter) {
    ESP_LOGV (TAG8, "trace: %s()", __func__);

    // Register with watchdog timer
    ESP_ERROR_CHECK (esp_task_wdt_add (NULL));

    while (esp_timer_get_time() < CancelRadioFT8ModeTime || ft8TaskInProgress) {
        ESP_ERROR_CHECK (esp_task_wdt_reset());  // Reset watchdog during wait
        vTaskDelay (pdMS_TO_TICKS (250));
    }

    CancelRadioFT8ModeTime = 0;  // Race condition here, but minimize the probability by clearing immediately

    if (ft8ConfigInfo == NULL) {
        // This should never happen, but just in case...
        ESP_LOGE (TAG8, "cleanup_ft8_task called with ft8ConfigInfo == NULL");
        CommandInProgress = false;
        Ft8RadioExclusive = false;
        esp_task_wdt_delete (NULL);  // Unregister before deletion
        vTaskDelete (NULL);
        return;
    }

    // Restore the radio to its prior state (including TUN PWR)
    bool restored = false;
    int  attempts = 0;
    while (!restored) {
        TimedLock lock2 = kxRadio.timed_lock (RADIO_LOCK_TIMEOUT_CRITICAL_MS, "FT8 cleanup");
        if (!lock2.acquired()) {
            ++attempts;
            if (attempts % 4 == 0) {
                ESP_LOGW (TAG8, "Still waiting for radio lock for FT8 cleanup");
            }
            ESP_ERROR_CHECK (esp_task_wdt_reset());
            vTaskDelay (pdMS_TO_TICKS (250));
            continue;
        }

        ESP_LOGI (TAG8, "Restoring radio state including TUN PWR to original settings");
        kxRadio.restore_radio_state (ft8ConfigInfo->kx_state, 4);
        restored = true;
        // TimedLock auto-unlocks here
    }

    // Release ft8ConfigInfo
    delete ft8ConfigInfo->kx_state;
    delete[] ft8ConfigInfo->tones;
    delete ft8ConfigInfo;
    ft8ConfigInfo = NULL;

    CommandInProgress = false;
    Ft8RadioExclusive = false;
    ESP_LOGI (TAG8, "cleanup_ft8_task() completed.");
    esp_task_wdt_delete (NULL);  // Unregister before deletion
    vTaskDelete (NULL);
}

/**
 * HTTP request handler to prepare the radio and system for an FT8 transmission.
 *
 * @param req A pointer to the HTTP request.
 *            expects the following parameters in the URL query string:
 *            - 'messageText': The text message to be encoded into the FT8 format. This text is then converted
 *              into a sequence of audio tones for transmission.
 *            - 'timeNow': The current time in milliseconds since epoch. This time is used to synchronize the
 *              system's clock for timing the FT8 transmission accurately.
 *            - 'rfFrequency': The radio frequency (in Hz) at which the base radio signal should be set. This
 *              frequency is used to calculate the actual transmission frequency by adding the audio frequency.
 *            - 'audioFrequency': The frequency offset (in Hz) added to the 'rfFrequency' to derive the actual
 *              transmission frequency. This offset represents the audio tone frequency in the FT8 signal.
 *
 * @return ESP_OK on success or ESP_FAIL on failure.
 */
esp_err_t handler_prepareft8_post (httpd_req_t * req) {
    showActivity();

    ESP_LOGV (TAG8, "trace: %s()", __func__);

    if (CommandInProgress || ft8ConfigInfo != NULL) {
        CancelRadioFT8ModeTime = 1;
        REPLY_WITH_FAILURE (req, HTTPD_500_INTERNAL_SERVER_ERROR, "prepare called while another command already in progress");
    }

    /**
     * In this short window of time between the check of CommandInProgress above,
     * and the setting of the same to "true" below, we could have a race condition.
     * But we'll assume it's rare, while we quickly decode the request.
     * Otherwise, setting CommandInProgress to "true" beforehand would mean we would
     * need to unwind the decoding macro to insert code setting it to "false" on error.
     */
    STANDARD_DECODE_QUERY (req, unsafe_buf);

    CommandInProgress = true;
    gpio_set_level (LED_BLUE, LED_ON);  // LED on

    char    ft8_msg[64];
    char    nowTimeUTCms_str[64];
    int64_t nowTimeUTCms = 0;
    char    rfFreq_str[32];
    long    rfFreq = 0;
    char    audioFreq_str[16];
    int     audioFreq         = 0;
    char *  timeStringEndChar = NULL;

    // Parse the 'messageText' parameter from the query
    if (!(httpd_query_key_value (unsafe_buf, "messageText", ft8_msg, sizeof (ft8_msg)) == ESP_OK &&
          url_decode_in_place (ft8_msg) &&
          strnlen (ft8_msg, sizeof (ft8_msg)) <= 13 &&
          httpd_query_key_value (unsafe_buf, "timeNow", nowTimeUTCms_str, sizeof (nowTimeUTCms_str)) == ESP_OK &&
          (nowTimeUTCms = strtoll (nowTimeUTCms_str, &timeStringEndChar, 10)) > 0 &&
          httpd_query_key_value (unsafe_buf, "rfFrequency", rfFreq_str, sizeof (rfFreq_str)) == ESP_OK &&
          (rfFreq = atol (rfFreq_str)) > 0 &&
          httpd_query_key_value (unsafe_buf, "audioFrequency", audioFreq_str, sizeof (audioFreq_str)) == ESP_OK &&
          (audioFreq = atoi (audioFreq_str)) > 0)) {
        CommandInProgress = false;
        REPLY_WITH_FAILURE (req, HTTPD_404_NOT_FOUND, "parameter parsing error");
    }

    // Set the system clock based on the time received from the phone
    struct timeval nowTimeUTC;
    nowTimeUTC.tv_sec  = nowTimeUTCms / 1000;
    nowTimeUTC.tv_usec = (nowTimeUTCms % 1000) * 1000;

    // Reseting the system clock to the time received from the phone can cause the
    // inactivity idle watchdog to trigger (which would put the device to sleep),
    // so we need to reset the activity timer after changing the system clock.

    // Set the system's clock to the time received from the cell phone
    settimeofday (&nowTimeUTC, NULL);

    // Reset the activity timer to prevent idle watchdog from triggering
    resetActivityTimer();

    // First, pack the text data into an FT8 binary message
    uint8_t packed[FTX_LDPC_K_BYTES];
    int     rc = pack77 (ft8_msg, packed);
    if (rc < 0) {
        CommandInProgress = false;
        REPLY_WITH_FAILURE (req, HTTPD_500_INTERNAL_SERVER_ERROR, "can't parse FT8 message");
    }

    // Second, encode the binary message as a sequence of FSK tones
    uint8_t * tones = new uint8_t[FT8_NN];  // Array of 79 tones (symbols)
    if (tones == NULL) {
        CommandInProgress = false;
        REPLY_WITH_FAILURE (req, HTTPD_500_INTERNAL_SERVER_ERROR, "can't allocate memory for FT8 tones");
    }

    ft8_encode (packed, tones);

    // this block encapsulates our exclusive access to the radio port
    {
        TimedLock lock = kxRadio.timed_lock (RADIO_LOCK_TIMEOUT_CRITICAL_MS, "FT8 setup");
        if (!lock.acquired()) {
            CommandInProgress = false;
            gpio_set_level (LED_BLUE, LED_OFF);
            delete[] tones;
            REPLY_WITH_FAILURE (req, HTTPD_500_INTERNAL_SERVER_ERROR, "radio busy, please retry");
        }

        // First capture the current state of the radio before changing it:
        kx_state_t * kx_state = new kx_state_t;
        if (!kxRadio.get_radio_state (kx_state)) {
            delete kx_state;
            delete[] tones;
            CommandInProgress = false;
            gpio_set_level (LED_BLUE, LED_OFF);
            REPLY_WITH_FAILURE (req, HTTPD_500_INTERNAL_SERVER_ERROR, "failed to read radio state");
        }

        // Prepare the radio to send the FT8 FSK tones using CW tone with proper power setting.
        long baseFreq = rfFreq + audioFreq;

        if (!kxRadio.ft8_prepare (baseFreq)) {
            kxRadio.restore_radio_state (kx_state, 2);
            delete kx_state;
            delete[] tones;
            CommandInProgress = false;
            gpio_set_level (LED_BLUE, LED_OFF);
            Ft8RadioExclusive = false;
            REPLY_WITH_FAILURE (req, HTTPD_500_INTERNAL_SERVER_ERROR, "failed to prepare radio for ft8");
        }
        // Offload playing the FT8 audio
        ft8ConfigInfo           = new ft8_task_pack_t;
        ft8ConfigInfo->baseFreq = baseFreq;
        ft8ConfigInfo->tones    = tones;
        ft8ConfigInfo->kx_state = kx_state;  // will be deleted later in cleanup
        Ft8RadioExclusive       = true;
    }  // TimedLock auto-unlocks here

    // We have prepared the radio to send FT8, but we don't know if the user will
    // cancel or send FT8. Ensure we keep the radio prepared long enough for the
    // next transmit request, even if prepare happens close to a window boundary.
    int64_t now_us              = esp_timer_get_time();
    int64_t next_window_timeout = now_us + ((msUntilFT8Window() + 1000) * 1000LL);
    int64_t min_prepare_timeout = now_us + (20LL * 1000LL * 1000LL);
    CancelRadioFT8ModeTime      = (next_window_timeout > min_prepare_timeout) ? next_window_timeout : min_prepare_timeout;

    // Start the watchdog timer to cleanup whenever we are done with ft8.
    // This will set CommandInProgress=false; and restore the radio to its prior state.
    xTaskCreate (&cleanup_ft8_task, "cleanup_ft8_task", 5120, NULL, SC_TASK_PRIORITY_NORMAL, NULL);

    // Send a response back
    CommandInProgress = false;
    REPLY_WITH_SUCCESS();
}

/**
 * HTTP request handler to initiate the FT8 transmission.
 *
 * @param req A pointer to the HTTP request structure. Query parameters
 *            'rfFrequency' and 'audioFrequency' are used to compute the base
 *            transmission frequency and proper encoding of the FT8 signal.
 * @return ESP_OK on success or ESP_FAIL on failure.
 */
esp_err_t handler_ft8_post (httpd_req_t * req) {
    showActivity();

    ESP_LOGV (TAG8, "trace: %s()", __func__);

    STANDARD_DECODE_QUERY (req, unsafe_buf);

    CommandInProgress = true;

    if (!ft8TaskInProgress && CancelRadioFT8ModeTime <= 0 && ft8ConfigInfo == NULL) {
        // Nobody has called the 'handler_prepareft8_post' command yet, so we need to compute the FT8 tones
        // and prepare the radio, by calling the 'handler_prepareft8_post' command.
        CommandInProgress = false;
        esp_err_t rslt    = handler_prepareft8_post (req);
        if (rslt != ESP_OK) {
            return rslt;
        }
        // handler_prepareft8_post clears CommandInProgress; reassert for transmit workflow
        CommandInProgress = true;
    }

    // If cleanup is in progress, do not try to transmit with stale state.
    if (CancelRadioFT8ModeTime <= 0 && ft8ConfigInfo != NULL) {
        CommandInProgress = false;
        REPLY_WITH_FAILURE (req, HTTPD_500_INTERNAL_SERVER_ERROR, "ft8 cleanup in progress");
    }

    char rfFreq_str[32];
    long rfFreq = 0;
    char audioFreq_str[16];
    int  audioFreq = 0;

    // Parse the 'messageText' parameter from the query
    if (!(httpd_query_key_value (unsafe_buf, "rfFrequency", rfFreq_str, sizeof (rfFreq_str)) == ESP_OK &&
          (rfFreq = atol (rfFreq_str)) > 0 &&
          httpd_query_key_value (unsafe_buf, "audioFrequency", audioFreq_str, sizeof (audioFreq_str)) == ESP_OK &&
          (audioFreq = atoi (audioFreq_str)) > 0)) {
        CommandInProgress = false;
        REPLY_WITH_FAILURE (req, HTTPD_404_NOT_FOUND, "parameter parsing error");
    }

    long baseFreq = rfFreq + audioFreq;

    if (ft8ConfigInfo == NULL) {
        ft8_queue_clear();
        ft8TaskInProgress = false;
        CommandInProgress = false;
        REPLY_WITH_FAILURE (req, HTTPD_500_INTERNAL_SERVER_ERROR, "ft8 not prepared");
    }

    if (ft8TaskInProgress || ft8_queue_size() > 0) {
        int64_t wait_deadline = esp_timer_get_time() + (20LL * 1000LL * 1000LL);
        while (!ft8_queue_push (baseFreq)) {
            if (esp_timer_get_time() >= wait_deadline) {
                CommandInProgress = false;
                REPLY_WITH_FAILURE (req, HTTPD_500_INTERNAL_SERVER_ERROR, "FT8 queue full");
            }
            vTaskDelay (pdMS_TO_TICKS (100));
        }
        CommandInProgress = false;
        REPLY_WITH_SUCCESS();
    }

    ft8TaskInProgress = true;

    // Offload playing the FT8 audio
    ft8ConfigInfo->baseFreq = baseFreq;

    // Update the watchdog timer to be 1 second after the next FT8 window starts.
    // The xmit_ft8_task will reset the watchdog timer if it is called again.
    int64_t watchdogTime = esp_timer_get_time() + ((msUntilFT8Window() + 1000) * 1000LL);  // 1 second after the next FT8 window starts, converted to microseconds
    if (watchdogTime > CancelRadioFT8ModeTime)
        CancelRadioFT8ModeTime = watchdogTime;

    // The watchdog timer will clean up after the FT8 transmission is done.
    if (xTaskCreate (&xmit_ft8_task, "xmit_ft8_task", 8192, ft8ConfigInfo, SC_TASK_PRIORITY_HIGHEST, NULL) != pdPASS) {
        ft8TaskInProgress = false;
        CommandInProgress = false;
        REPLY_WITH_FAILURE (req, HTTPD_500_INTERNAL_SERVER_ERROR, "failed to start FT8 transmission task");
    }

    REPLY_WITH_SUCCESS();
}

/**
 * HTTP request handler to cancel an ongoing or scheduled FT8 transmission.
 *
 * @param req A pointer to the HTTP request.
 * @return ESP_OK on success, indicating the transmission cancellation.
 */
esp_err_t handler_cancelft8_post (httpd_req_t * req) {
    ESP_LOGV (TAG8, "trace: %s()", __func__);

    // Tell the watchdog timer to cancel the FT8 mode and restore the radio to its prior state
    CancelRadioFT8ModeTime = 1;
    ft8_queue_clear();

    REPLY_WITH_SUCCESS();
}
