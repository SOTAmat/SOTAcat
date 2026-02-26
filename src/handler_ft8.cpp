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
#include <atomic>
#include <cstdlib>
#include <driver/gpio.h>
#include <driver/uart.h>
#include <esp_task_wdt.h>
#include <esp_timer.h>
#include <freertos/FreeRTOS.h>
#include <freertos/queue.h>
#include <freertos/semphr.h>
#include <cstdint>
#include <cstring>
#include <sys/time.h>

// Thank-you to KI6SYD for providing key information about the Elecraft KX radios and for initial testing. - AB6D

#include <esp_log.h>
static const char * TAG8 = "sc:hdl_ft8.";

/**
 * Holds the timestamp until which the radio should remain in FT8 mode. This variable is used as a watchdog timer;
 * if the system time surpasses this timestamp without any new FT8 activity, the system will automatically exit
 * FT8 mode and revert the radio to its previous state. The value is in microseconds since the Unix epoch.
 */
static std::atomic<int64_t> CancelRadioFT8ModeTime {0};

/**
 * Indicates whether an FT8 transmission task is currently in progress. This boolean flag helps prevent the
 * initiation of multiple concurrent FT8 transmission tasks, ensuring that only one FT8 task operates at any
 * given time, thus avoiding conflicts or resource contention in radio usage.
 */
static std::atomic<bool> ft8TaskInProgress {false};

static inline int64_t ft8_get_cancel_deadline_us () {
    return CancelRadioFT8ModeTime.load (std::memory_order_acquire);
}

static inline bool ft8_is_cancel_requested () {
    return ft8_get_cancel_deadline_us() <= 1;
}

static inline void ft8_set_cancel_deadline_us (int64_t deadline_us) {
    CancelRadioFT8ModeTime.store (deadline_us, std::memory_order_release);
}

static inline void ft8_request_cancel () {
    ft8_set_cancel_deadline_us (1);
}

static inline void ft8_extend_cancel_deadline_us (int64_t deadline_us) {
    int64_t current = ft8_get_cancel_deadline_us();
    while (deadline_us > current &&
           !CancelRadioFT8ModeTime.compare_exchange_weak (current, deadline_us, std::memory_order_acq_rel, std::memory_order_acquire)) {
        // retry until the larger deadline wins
    }
}

static inline bool ft8_is_task_in_progress () {
    return ft8TaskInProgress.load (std::memory_order_acquire);
}

static inline void ft8_set_task_in_progress (bool in_progress) {
    ft8TaskInProgress.store (in_progress, std::memory_order_release);
}

static inline bool ft8_try_claim_task_in_progress () {
    bool expected = false;
    return ft8TaskInProgress.compare_exchange_strong (expected, true, std::memory_order_acq_rel, std::memory_order_acquire);
}

constexpr size_t FT8_REQUEST_TOKEN_MAX = 64;

/**
 * A pointer to an `ft8_task_pack_t` structure containing configuration information needed for the FT8 transmission.
 * This includes:
 * - `baseFreq`: the current transmit base frequency used by the tone scheduler.
 * - `rfFreq`/`audioFreq`/`messageText`: the original prepare request payload used to detect identical prepare calls.
 * - `tones` and `kx_state`: resources that are released by cleanup_ft8_task().
 * This pointer is initially set to NULL and is allocated when preparing for an FT8 transmission.
 * It must be properly managed to avoid memory leaks and is cleaned up after the transmission completes or is cancelled.
 */
typedef struct
{
    long         baseFreq;
    long         rfFreq;
    int          audioFreq;
    char         messageText[14];
    uint8_t *    tones;
    kx_state_t * kx_state;
} ft8_task_pack_t;

static std::atomic<ft8_task_pack_t *> ft8ConfigInfo {nullptr};
bool                                  Ft8RadioExclusive = false;

static inline ft8_task_pack_t * ft8_get_config_info () {
    return ft8ConfigInfo.load (std::memory_order_acquire);
}

static inline void ft8_set_config_info (ft8_task_pack_t * config) {
    ft8ConfigInfo.store (config, std::memory_order_release);
}

static std::atomic<long>     ft8PreparedRfFreq {0};
static std::atomic<int>      ft8PreparedAudioFreq {0};
static std::atomic<uint32_t> ft8PreparedMessageHash {0};
static std::atomic<uint32_t> ft8PreparedRequestTokenHash {0};
static std::atomic<uint32_t> ft8LastAcceptedSequence {0};

static inline uint32_t ft8_get_last_accepted_sequence () {
    return ft8LastAcceptedSequence.load (std::memory_order_acquire);
}

static inline void ft8_set_last_accepted_sequence (uint32_t sequence_number) {
    ft8LastAcceptedSequence.store (sequence_number, std::memory_order_release);
}

static uint32_t ft8_hash_string (const char * text) {
    // FNV-1a hash; stable and fast for request identity checks.
    uint32_t hash = 2166136261u;
    if (!text) {
        return 0;
    }

    while (*text) {
        hash ^= static_cast<uint8_t> (*text++);
        hash *= 16777619u;
    }

    return hash;
}

static uint32_t ft8_hash_optional_string (const char * text) {
    if (!text || text[0] == '\0') {
        return 0;
    }
    return ft8_hash_string (text);
}

static void ft8_clear_prepare_identity ();

constexpr size_t         FT8_QUEUE_MAX = 4;
constexpr int64_t        FT8_QUEUE_WAIT_TIMEOUT_US = 2000LL * 1000LL;
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
        ft8_request_cancel();
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

static bool ft8_queue_pop_with_timeout (long & out_base_freq, int64_t wait_deadline_us) {
    while (!ft8_queue_pop (out_base_freq)) {
        if (esp_timer_get_time() >= wait_deadline_us) {
            return false;
        }
        vTaskDelay (pdMS_TO_TICKS (100));
    }
    return true;
}

static bool ft8_queue_push_with_timeout (long base_freq, int64_t wait_deadline_us) {
    while (!ft8_queue_push (base_freq)) {
        if (esp_timer_get_time() >= wait_deadline_us) {
            return false;
        }
        vTaskDelay (pdMS_TO_TICKS (100));
    }
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
        if (ft8_is_cancel_requested()) {
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
    ft8_task_pack_t * info = (ft8_task_pack_t *)pvParameter;

    if (info == NULL) {
        ESP_LOGE (TAG8, "%s called with pvParameter == NULL", __func__);
        ft8_set_task_in_progress (false);
        vTaskDelete (NULL);
        return;
    }

    ft8_set_task_in_progress (true);

    // this block encapsulates our exclusive access to the radio port
    {
        TimedLock lock = kxRadio.timed_lock (RADIO_LOCK_TIMEOUT_FT8_MS, "FT8 transmission");
        if (!lock.acquired()) {
            ESP_LOGE (TAG8, "Failed to acquire radio lock for FT8 transmission");
            ft8_request_cancel();
            ft8_queue_clear();
            goto cleanup;
        }

        // Register with watchdog timer after lock is acquired
        ESP_ERROR_CHECK (esp_task_wdt_add (NULL));
        wdt_registered = true;

        ESP_LOGI (TAG8, "ft8 transmission starting--");

        if (!ft8_tone_queue) {
            ft8_tone_queue = xQueueCreate (4, sizeof (Ft8ToneEvent));
            if (!ft8_tone_queue) {
                ESP_LOGE (TAG8, "Failed to create FT8 tone queue");
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
                goto cleanup;
            }
        }

        while (true) {
            waitForFT8Window();
            if (ft8_is_cancel_requested()) {
                ESP_LOGI (TAG8, "FT8 transmit cancelled before window start");
                ft8_queue_clear();
                goto cleanup;
            }

            // Update the timer for when to cancel the radio FT8 mode
            int64_t watchdogTime = esp_timer_get_time() + (15LL * 1000LL * 1000LL);  // 15 seconds from now, converted to microseconds
            ft8_extend_cancel_deadline_us (watchdogTime);

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
                ft8_request_cancel();
            }

            // Now tell the radio to play the remaining tones (1..78)
            for (int j = 1; j < FT8_NN; ++j) {
                if (ft8_is_cancel_requested())
                    break;

                Ft8ToneEvent event;
                if (xQueueReceive (ft8_tone_queue, &event, pdMS_TO_TICKS (200)) != pdTRUE) {
                    ESP_LOGW (TAG8, "FT8 tone queue timeout");
                    ft8_request_cancel();
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

            if (ft8_is_cancel_requested()) {
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
    ft8_set_task_in_progress (false);
    ESP_LOGI (TAG8, "--ft8 transmission completed.");
    if (wdt_registered)
        esp_task_wdt_delete (NULL);  // Unregister before deletion
    vTaskDelete (NULL);
    return;

cleanup:
    ft8_set_task_in_progress (false);
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

    while (esp_timer_get_time() < ft8_get_cancel_deadline_us() ||
           ft8_is_task_in_progress() ||
           CommandInProgress.load (std::memory_order_acquire)) {
        ESP_ERROR_CHECK (esp_task_wdt_reset());  // Reset watchdog during wait
        vTaskDelay (pdMS_TO_TICKS (250));
    }

    ft8_set_cancel_deadline_us (0);
    ft8_task_pack_t * configInfo = ft8_get_config_info();

    if (configInfo == NULL) {
        // This should never happen, but just in case...
        ESP_LOGE (TAG8, "cleanup_ft8_task called with ft8ConfigInfo == NULL");
        ft8_clear_prepare_identity();
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
        kxRadio.restore_radio_state (configInfo->kx_state, 4);
        restored = true;
        // TimedLock auto-unlocks here
    }

    // Release ft8ConfigInfo
    // Safe to free here: cleanup waits for ft8TaskInProgress to clear, so xmit no longer uses ft8ConfigInfo.
    ft8_set_config_info (NULL);
    ft8_clear_prepare_identity();
    delete configInfo->kx_state;
    delete[] configInfo->tones;
    delete configInfo;

    Ft8RadioExclusive = false;
    ESP_LOGI (TAG8, "cleanup_ft8_task() completed.");
    esp_task_wdt_delete (NULL);  // Unregister before deletion
    vTaskDelete (NULL);
}

/**
 * Normalized /prepareft8 request fields shared between explicit /prepareft8 and
 * the internal auto-prepare path in /ft8.
 */
typedef struct
{
    char    messageText[64];
    char    requestToken[FT8_REQUEST_TOKEN_MAX];
    int64_t nowTimeUTCms;
    long    rfFreq;
    int     audioFreq;
} ft8_prepare_request_t;

static void ft8_clear_prepare_identity () {
    ft8PreparedRfFreq.store (0, std::memory_order_release);
    ft8PreparedAudioFreq.store (0, std::memory_order_release);
    ft8PreparedMessageHash.store (0, std::memory_order_release);
    ft8PreparedRequestTokenHash.store (0, std::memory_order_release);
    ft8_set_last_accepted_sequence (0);
}

static void ft8_record_prepare_identity (const ft8_prepare_request_t & request) {
    ft8PreparedRfFreq.store (request.rfFreq, std::memory_order_release);
    ft8PreparedAudioFreq.store (request.audioFreq, std::memory_order_release);
    ft8PreparedMessageHash.store (ft8_hash_string (request.messageText), std::memory_order_release);
    ft8PreparedRequestTokenHash.store (ft8_hash_optional_string (request.requestToken), std::memory_order_release);
}

static bool ft8_is_same_prepare_request (const ft8_prepare_request_t & request) {
    if (ft8PreparedRfFreq.load (std::memory_order_acquire) != request.rfFreq) {
        return false;
    }
    if (ft8PreparedAudioFreq.load (std::memory_order_acquire) != request.audioFreq) {
        return false;
    }
    if (ft8PreparedMessageHash.load (std::memory_order_acquire) != ft8_hash_string (request.messageText)) {
        return false;
    }

    uint32_t prepared_token_hash = ft8PreparedRequestTokenHash.load (std::memory_order_acquire);
    uint32_t request_token_hash  = ft8_hash_optional_string (request.requestToken);
    if (prepared_token_hash != 0 || request_token_hash != 0) {
        return prepared_token_hash == request_token_hash;
    }

    return true;
}

static uint32_t ft8_parse_request_token_hash_from_query (const char * unsafe_buf) {
    char request_token[FT8_REQUEST_TOKEN_MAX];
    request_token[0] = '\0';

    if (httpd_query_key_value (unsafe_buf, "requestToken", request_token, sizeof (request_token)) == ESP_OK) {
        (void)url_decode_in_place (request_token);
    }

    return ft8_hash_optional_string (request_token);
}

static bool ft8_parse_sequence_number_from_query (const char * unsafe_buf, uint32_t & out_sequence_number) {
    char sequence_number_str[16];
    sequence_number_str[0] = '\0';

    if (httpd_query_key_value (unsafe_buf, "sequenceNumber", sequence_number_str, sizeof (sequence_number_str)) != ESP_OK) {
        return false;
    }

    char *        end_ptr = NULL;
    unsigned long parsed  = strtoul (sequence_number_str, &end_ptr, 10);
    if (parsed == 0 || end_ptr == sequence_number_str || *end_ptr != '\0' || parsed > UINT32_MAX) {
        return false;
    }

    out_sequence_number = static_cast<uint32_t> (parsed);
    return true;
}

enum class ft8_sequence_decision_t
{
    accept,
    duplicate,
    stale,
    out_of_order
};

static ft8_sequence_decision_t ft8_classify_sequence_number (uint32_t requested_sequence_number) {
    uint32_t last_sequence_number = ft8_get_last_accepted_sequence();
    if (last_sequence_number == 0) {
        return ft8_sequence_decision_t::accept;
    }
    if (requested_sequence_number == last_sequence_number) {
        return ft8_sequence_decision_t::duplicate;
    }
    if (requested_sequence_number < last_sequence_number) {
        return ft8_sequence_decision_t::stale;
    }
    if (last_sequence_number == UINT32_MAX) {
        return ft8_sequence_decision_t::out_of_order;
    }
    if (requested_sequence_number == (last_sequence_number + 1)) {
        return ft8_sequence_decision_t::accept;
    }
    return ft8_sequence_decision_t::out_of_order;
}

/**
 * Parse and validate all query parameters required for FT8 preparation.
 */
static bool ft8_parse_prepare_request_from_query (const char * unsafe_buf, ft8_prepare_request_t & out) {
    char   nowTimeUTCms_str[64];
    char   rfFreq_str[32];
    char   audioFreq_str[16];
    char * timeStringEndChar = NULL;

    out.nowTimeUTCms = 0;
    out.rfFreq       = 0;
    out.audioFreq    = 0;
    out.messageText[0] = '\0';
    out.requestToken[0] = '\0';

    if (httpd_query_key_value (unsafe_buf, "requestToken", out.requestToken, sizeof (out.requestToken)) == ESP_OK) {
        (void)url_decode_in_place (out.requestToken);
    }
    if (out.requestToken[0] == '\0') {
        return false;
    }

    if (!(httpd_query_key_value (unsafe_buf, "messageText", out.messageText, sizeof (out.messageText)) == ESP_OK &&
          url_decode_in_place (out.messageText) &&
          strnlen (out.messageText, sizeof (out.messageText)) <= 13 &&
          httpd_query_key_value (unsafe_buf, "timeNow", nowTimeUTCms_str, sizeof (nowTimeUTCms_str)) == ESP_OK &&
          (out.nowTimeUTCms = strtoll (nowTimeUTCms_str, &timeStringEndChar, 10)) > 0 &&
          httpd_query_key_value (unsafe_buf, "rfFrequency", rfFreq_str, sizeof (rfFreq_str)) == ESP_OK &&
          (out.rfFreq = atol (rfFreq_str)) > 0 &&
          httpd_query_key_value (unsafe_buf, "audioFrequency", audioFreq_str, sizeof (audioFreq_str)) == ESP_OK &&
          (out.audioFreq = atoi (audioFreq_str)) > 0)) {
        return false;
    }

    return true;
}

static void ft8_extend_prepare_deadline () {
    // We have prepared the radio to send FT8, but we don't know if the user will
    // cancel or send FT8. Ensure we keep the radio prepared long enough for the
    // next transmit request, even if prepare happens close to a window boundary.
    int64_t now_us              = esp_timer_get_time();
    int64_t next_window_timeout = now_us + ((msUntilFT8Window() + 1000) * 1000LL);
    int64_t min_prepare_timeout = now_us + (20LL * 1000LL * 1000LL);
    ft8_set_cancel_deadline_us ((next_window_timeout > min_prepare_timeout) ? next_window_timeout : min_prepare_timeout);
}

static bool ft8_prepare_internal (const ft8_prepare_request_t & request, const char ** error_message) {
    // Set the system clock based on the time received from the phone
    struct timeval nowTimeUTC;
    nowTimeUTC.tv_sec  = request.nowTimeUTCms / 1000;
    nowTimeUTC.tv_usec = (request.nowTimeUTCms % 1000) * 1000;

    // Resetting system time can make inactivity logic think we jumped forward, so
    // refresh the activity timer immediately after applying the phone timestamp.
    // Set the system's clock to the time received from the cell phone
    settimeofday (&nowTimeUTC, NULL);

    // Reset the activity timer to prevent idle watchdog from triggering
    resetActivityTimer();

    // First, pack the text data into an FT8 binary message
    uint8_t packed[FTX_LDPC_K_BYTES];
    int     rc = pack77 (request.messageText, packed);
    if (rc < 0) {
        *error_message = "can't parse FT8 message";
        return false;
    }

    // Second, encode the binary message as a sequence of FSK tones
    uint8_t * tones = new uint8_t[FT8_NN];  // Array of 79 tones (symbols)
    if (tones == NULL) {
        *error_message = "can't allocate memory for FT8 tones";
        return false;
    }

    ft8_encode (packed, tones);

    // this block encapsulates our exclusive access to the radio port
    {
        TimedLock lock = kxRadio.timed_lock (RADIO_LOCK_TIMEOUT_CRITICAL_MS, "FT8 setup");
        if (!lock.acquired()) {
            delete[] tones;
            *error_message = "radio busy, please retry";
            return false;
        }

        // First capture the current state of the radio before changing it:
        kx_state_t * kx_state = new kx_state_t;
        if (!kxRadio.get_radio_state (kx_state)) {
            delete kx_state;
            delete[] tones;
            *error_message = "failed to read radio state";
            return false;
        }

        // Prepare the radio to send the FT8 FSK tones using CW tone with proper power setting.
        long baseFreq = request.rfFreq + request.audioFreq;

        if (!kxRadio.ft8_prepare (baseFreq)) {
            kxRadio.restore_radio_state (kx_state, 2);
            delete kx_state;
            delete[] tones;
            Ft8RadioExclusive = false;
            *error_message    = "failed to prepare radio for ft8";
            return false;
        }

        // Offload playing the FT8 audio
        ft8_task_pack_t * configInfo = new ft8_task_pack_t;
        configInfo->baseFreq         = baseFreq;
        configInfo->rfFreq           = request.rfFreq;
        configInfo->audioFreq        = request.audioFreq;
        strlcpy (configInfo->messageText, request.messageText, sizeof (configInfo->messageText));
        configInfo->tones            = tones;
        configInfo->kx_state         = kx_state;  // will be deleted later in cleanup
        ft8_set_config_info (configInfo);
        ft8_record_prepare_identity (request);
        Ft8RadioExclusive = true;
    }  // TimedLock auto-unlocks here

    ft8_extend_prepare_deadline();

    // Start the cleanup watchdog now. It owns teardown of ft8ConfigInfo and radio
    // state restoration after cancel deadline expiry and/or task completion.
    xTaskCreate (&cleanup_ft8_task, "cleanup_ft8_task", 5120, NULL, SC_TASK_PRIORITY_NORMAL, NULL);
    return true;
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
 *            - 'requestToken': A workflow token generated by the client to correlate retries and
 *              reject stale requests from previous sessions.
 *
 * @return ESP_OK on success or ESP_FAIL on failure.
 */
esp_err_t handler_prepareft8_post (httpd_req_t * req) {
    showActivity();

    ESP_LOGV (TAG8, "trace: %s()", __func__);

    bool expected_command = false;
    if (!CommandInProgress.compare_exchange_strong (expected_command, true, std::memory_order_acq_rel, std::memory_order_acquire)) {
        ft8_request_cancel();
        REPLY_WITH_FAILURE (req, HTTPD_500_INTERNAL_SERVER_ERROR, "prepare called while another command already in progress");
    }

    struct CommandInProgressResetGuard {
        explicit CommandInProgressResetGuard (std::atomic<bool> * flag) : flag_ (flag) {}
        ~CommandInProgressResetGuard () {
            if (flag_) {
                flag_->store (false, std::memory_order_release);
            }
        }
        void dismiss () { flag_ = nullptr; }

      private:
        std::atomic<bool> * flag_;
    } commandGuard (&CommandInProgress);
    // Keep CommandInProgress from getting stuck true on any early return from
    // this handler, including REPLY_WITH_FAILURE paths inside STANDARD_DECODE_QUERY.

    STANDARD_DECODE_QUERY (req, unsafe_buf);
    gpio_set_level (LED_BLUE, LED_ON);  // LED on

    ft8_prepare_request_t request;
    if (!ft8_parse_prepare_request_from_query (unsafe_buf, request)) {
        gpio_set_level (LED_BLUE, LED_OFF);
        REPLY_WITH_FAILURE (req, HTTPD_404_NOT_FOUND, "parameter parsing error");
    }

    ft8_task_pack_t * existingConfig = ft8_get_config_info();
    if (existingConfig != NULL) {
        if (ft8_get_cancel_deadline_us() <= 0) {
            gpio_set_level (LED_BLUE, LED_OFF);
            REPLY_WITH_FAILURE (req, HTTPD_500_INTERNAL_SERVER_ERROR, "ft8 cleanup in progress");
        }

        // Idempotent fast-path: if the caller repeats the same prepare payload while
        // FT8 remains prepared, just extend the deadline instead of re-encoding tones
        // and reconfiguring the radio.
        if (ft8_is_same_prepare_request (request)) {
            ft8_extend_prepare_deadline();
            gpio_set_level (LED_BLUE, LED_OFF);
            CommandInProgress.store (false, std::memory_order_release);
            commandGuard.dismiss();
            REPLY_WITH_SUCCESS();
        }

        gpio_set_level (LED_BLUE, LED_OFF);
        REPLY_WITH_FAILURE (req, HTTPD_500_INTERNAL_SERVER_ERROR, "ft8 already prepared with different parameters");
    }

    const char * prepare_error = NULL;
    if (!ft8_prepare_internal (request, &prepare_error)) {
        gpio_set_level (LED_BLUE, LED_OFF);
        REPLY_WITH_FAILURE (req, HTTPD_500_INTERNAL_SERVER_ERROR, prepare_error ? prepare_error : "failed to prepare radio for ft8");
    }

    // Send a response back
    gpio_set_level (LED_BLUE, LED_OFF);
    CommandInProgress.store (false, std::memory_order_release);
    commandGuard.dismiss();
    REPLY_WITH_SUCCESS();
}

/**
 * HTTP request handler to initiate the FT8 transmission.
 *
 * @param req A pointer to the HTTP request structure. Query parameters
 *            'rfFrequency' and 'audioFrequency' are used to compute the base
 *            transmission frequency and proper encoding of the FT8 signal.
 *            'sequenceNumber' identifies the repeat within a workflow so retries
 *            can be handled idempotently.
 *            'requestToken' binds the request to a specific workflow session.
 * @return ESP_OK on success or ESP_FAIL on failure.
 */
esp_err_t handler_ft8_post (httpd_req_t * req) {
    showActivity();

    ESP_LOGV (TAG8, "trace: %s()", __func__);

    STANDARD_DECODE_QUERY (req, unsafe_buf);

    char rfFreq_str[32];
    long rfFreq = 0;
    char audioFreq_str[16];
    int  audioFreq = 0;

    // Parse the 'messageText' parameter from the query
    if (!(httpd_query_key_value (unsafe_buf, "rfFrequency", rfFreq_str, sizeof (rfFreq_str)) == ESP_OK &&
          (rfFreq = atol (rfFreq_str)) > 0 &&
          httpd_query_key_value (unsafe_buf, "audioFrequency", audioFreq_str, sizeof (audioFreq_str)) == ESP_OK &&
          (audioFreq = atoi (audioFreq_str)) > 0)) {
        CommandInProgress.store (false, std::memory_order_release);
        REPLY_WITH_FAILURE (req, HTTPD_404_NOT_FOUND, "parameter parsing error");
    }

    long baseFreq = rfFreq + audioFreq;
    uint32_t request_token_hash = ft8_parse_request_token_hash_from_query (unsafe_buf);
    if (request_token_hash == 0) {
        CommandInProgress.store (false, std::memory_order_release);
        REPLY_WITH_FAILURE (req, HTTPD_404_NOT_FOUND, "missing or invalid requestToken");
    }
    uint32_t sequence_number    = 0;
    if (!ft8_parse_sequence_number_from_query (unsafe_buf, sequence_number)) {
        CommandInProgress.store (false, std::memory_order_release);
        REPLY_WITH_FAILURE (req, HTTPD_404_NOT_FOUND, "missing or invalid sequenceNumber");
    }

    if (!ft8_is_task_in_progress() && ft8_get_cancel_deadline_us() <= 0 && ft8_get_config_info() == NULL) {
        // Nobody has called /prepareft8 yet; prepare internally without sending a nested HTTP response.
        bool expected_command = false;
        if (!CommandInProgress.compare_exchange_strong (expected_command, true, std::memory_order_acq_rel, std::memory_order_acquire)) {
            REPLY_WITH_FAILURE (req, HTTPD_500_INTERNAL_SERVER_ERROR, "prepare in progress");
        }

        struct CommandInProgressResetGuard {
            explicit CommandInProgressResetGuard (std::atomic<bool> * flag) : flag_ (flag) {}
            ~CommandInProgressResetGuard () {
                if (flag_) {
                    flag_->store (false, std::memory_order_release);
                }
            }
            void dismiss () { flag_ = nullptr; }

          private:
            std::atomic<bool> * flag_;
        } commandGuard (&CommandInProgress);

        ft8_prepare_request_t request;
        if (!ft8_parse_prepare_request_from_query (unsafe_buf, request)) {
            REPLY_WITH_FAILURE (req, HTTPD_404_NOT_FOUND, "parameter parsing error");
        }

        // Share the same prepare workflow used by /prepareft8, but avoid nested
        // HTTP response handling by staying in-process.
        const char * prepare_error = NULL;
        if (!ft8_prepare_internal (request, &prepare_error)) {
            REPLY_WITH_FAILURE (req, HTTPD_500_INTERNAL_SERVER_ERROR, prepare_error ? prepare_error : "failed to prepare radio for ft8");
        }

        CommandInProgress.store (false, std::memory_order_release);
        commandGuard.dismiss();
    }

    CommandInProgress.store (true, std::memory_order_release);

    // If the radio was prepared with a client token, only allow /ft8 requests from
    // that same workflow to guard against stale delayed packets.
    uint32_t prepared_token_hash = ft8PreparedRequestTokenHash.load (std::memory_order_acquire);
    if (prepared_token_hash != 0 && request_token_hash != prepared_token_hash) {
        CommandInProgress.store (false, std::memory_order_release);
        REPLY_WITH_FAILURE (req, HTTPD_500_INTERNAL_SERVER_ERROR, "ft8 request token mismatch");
    }

    ft8_sequence_decision_t sequence_decision = ft8_classify_sequence_number (sequence_number);
    if (sequence_decision == ft8_sequence_decision_t::duplicate) {
        // Duplicate retry of the most-recent accepted repeat: return success
        // without enqueueing another transmit.
        CommandInProgress.store (false, std::memory_order_release);
        REPLY_WITH_SUCCESS();
    }
    if (sequence_decision == ft8_sequence_decision_t::stale) {
        CommandInProgress.store (false, std::memory_order_release);
        REPLY_WITH_FAILURE (req, HTTPD_500_INTERNAL_SERVER_ERROR, "stale ft8 sequenceNumber");
    }
    if (sequence_decision == ft8_sequence_decision_t::out_of_order) {
        CommandInProgress.store (false, std::memory_order_release);
        REPLY_WITH_FAILURE (req, HTTPD_500_INTERNAL_SERVER_ERROR, "out-of-order ft8 sequenceNumber");
    }

    // If cleanup is in progress, do not try to transmit with stale state.
    if (ft8_get_cancel_deadline_us() <= 0 && ft8_get_config_info() != NULL) {
        CommandInProgress.store (false, std::memory_order_release);
        REPLY_WITH_FAILURE (req, HTTPD_500_INTERNAL_SERVER_ERROR, "ft8 cleanup in progress");
    }

    if (ft8_get_config_info() == NULL) {
        ft8_queue_clear();
        ft8_set_task_in_progress (false);
        CommandInProgress.store (false, std::memory_order_release);
        REPLY_WITH_FAILURE (req, HTTPD_500_INTERNAL_SERVER_ERROR, "ft8 not prepared");
    }

    if (ft8_is_task_in_progress()) {
        int64_t wait_deadline = esp_timer_get_time() + FT8_QUEUE_WAIT_TIMEOUT_US;
        if (!ft8_queue_push_with_timeout (baseFreq, wait_deadline)) {
            CommandInProgress.store (false, std::memory_order_release);
            REPLY_WITH_FAILURE (req, HTTPD_500_INTERNAL_SERVER_ERROR, "FT8 queue full");
        }
        ft8_set_last_accepted_sequence (sequence_number);
        CommandInProgress.store (false, std::memory_order_release);
        REPLY_WITH_SUCCESS();
    }

    long initial_base_freq = baseFreq;
    bool has_orphan_work   = (ft8_queue_size() > 0);

    // Atomically claim task startup (false -> true). This prevents two concurrent /ft8
    // requests from both launching a new transmit task.
    bool started_transmit_task = ft8_try_claim_task_in_progress();
    if (!started_transmit_task) {
        // Another request already has an FT8 task running, so queue this request for
        // the next transmit slot instead of starting a second task.
        int64_t wait_deadline = esp_timer_get_time() + FT8_QUEUE_WAIT_TIMEOUT_US;
        if (!ft8_queue_push_with_timeout (baseFreq, wait_deadline)) {
            CommandInProgress.store (false, std::memory_order_release);
            REPLY_WITH_FAILURE (req, HTTPD_500_INTERNAL_SERVER_ERROR, "FT8 queue full");
        }
        ft8_set_last_accepted_sequence (sequence_number);
        CommandInProgress.store (false, std::memory_order_release);
        REPLY_WITH_SUCCESS();
    }

    if (has_orphan_work) {
        int64_t wait_deadline = esp_timer_get_time() + FT8_QUEUE_WAIT_TIMEOUT_US;
        long    queued_base   = 0;
        if (!ft8_queue_pop_with_timeout (queued_base, wait_deadline)) {
            ft8_set_task_in_progress (false);
            CommandInProgress.store (false, std::memory_order_release);
            REPLY_WITH_FAILURE (req, HTTPD_500_INTERNAL_SERVER_ERROR, "FT8 queue busy");
        }
        initial_base_freq = queued_base;
        if (!ft8_queue_push_with_timeout (baseFreq, wait_deadline)) {
            ft8_set_task_in_progress (false);
            CommandInProgress.store (false, std::memory_order_release);
            REPLY_WITH_FAILURE (req, HTTPD_500_INTERNAL_SERVER_ERROR, "FT8 queue full");
        }
        ESP_LOGW (TAG8, "FT8 queue orphan detected; restarting transmit task");
    }

    // Offload playing the FT8 audio
    ft8_task_pack_t * configInfo = ft8_get_config_info();
    if (configInfo == NULL) {
        ft8_set_task_in_progress (false);
        CommandInProgress.store (false, std::memory_order_release);
        REPLY_WITH_FAILURE (req, HTTPD_500_INTERNAL_SERVER_ERROR, "ft8 not prepared");
    }
    configInfo->baseFreq = initial_base_freq;

    // Update the watchdog timer to be 1 second after the next FT8 window starts.
    // The xmit_ft8_task will reset the watchdog timer if it is called again.
    int64_t watchdogTime = esp_timer_get_time() + ((msUntilFT8Window() + 1000) * 1000LL);  // 1 second after the next FT8 window starts, converted to microseconds
    ft8_extend_cancel_deadline_us (watchdogTime);

    // The watchdog timer will clean up after the FT8 transmission is done.
    if (xTaskCreate (&xmit_ft8_task, "xmit_ft8_task", 8192, configInfo, SC_TASK_PRIORITY_HIGHEST, NULL) != pdPASS) {
        ft8_set_task_in_progress (false);
        CommandInProgress.store (false, std::memory_order_release);
        REPLY_WITH_FAILURE (req, HTTPD_500_INTERNAL_SERVER_ERROR, "failed to start FT8 transmission task");
    }

    // This HTTP command is complete once the transmit task is launched. Keep
    // CommandInProgress scoped to request handling so cleanup watchdog timing
    // depends on FT8 activity/deadlines, not a sticky command flag.
    ft8_set_last_accepted_sequence (sequence_number);
    CommandInProgress.store (false, std::memory_order_release);
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
    ft8_request_cancel();
    ft8_queue_clear();

    REPLY_WITH_SUCCESS();
}
