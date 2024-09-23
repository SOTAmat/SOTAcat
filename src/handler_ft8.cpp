#include "../lib/ft8_encoder/ft8/constants.h"
#include "../lib/ft8_encoder/ft8/encode.h"
#include "../lib/ft8_encoder/ft8/pack.h"
#include "globals.h"
#include "hardware_specific.h"
#include "idle_status_task.h"
#include "kx_radio.h"
#include "settings.h"
#include "webserver.h"

#include <driver/gpio.h>
#include <driver/uart.h>
#include <esp_timer.h>
#include <math.h>
#include <memory>

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

static ft8_task_pack_t * ft8ConfigInfo = NULL;

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

        // Decrease the remaining delay
        delay_ms -= wait_time;
    }
}

#define EASE_STEPS 1

/**
 * Transitions from a prior frequency to a new frequency smoothly over one or more steps.
 *
 * @param prior_frequency The frequency at which the previous tone was sent.
 * @param frequency The target frequency for the current tone.
 * @param lastWakeTime The last recorded wake time, used for task delay calculations.
 * @param toneInterval The interval at which tones should be sent, in ticks.
 */
static void sendFT8Tone (long prior_frequency, long frequency, TickType_t * lastWakeTime, const TickType_t toneInterval) {
    // Jeff: I commented out the following line because this is the most time critical function: sending the FT8 tones.
    // We don't want to log this function because it will affect the timing and add jitter.
    // ESP_LOGV(TAG8, "trace: %s(%ld, %ld)", __func__, prior_frequency, frequency);

    char command[16];
    // Ease into the new frequency based on the prior frequency in x steps lasting 10% of the interval
    long delta_frequency = frequency - prior_frequency;

    for (int step = 1; step <= EASE_STEPS; step++) {
        long eased_frequency = prior_frequency + round (delta_frequency * ((float)step / EASE_STEPS));
        snprintf (command, sizeof (command), "FA%011ld;", eased_frequency);

        // Send the tone command over UART
        uart_write_bytes (UART_NUM, command, 14);
    }

    // Reset the lastWakeTime to the time we entered this function, and then wait the 0.16 total interval seconds.
    vTaskDelayUntil (lastWakeTime, toneInterval);
}

/**
 * Task function to handle the FT8 transmission process.
 *
 * @param pvParameter A pointer to the parameter provided when the task is created. Expected to be an `ft8_task_pack_t` struct.
 */
static void xmit_ft8_task (void * pvParameter) {
    ESP_LOGV (TAG8, "trace: %s()", __func__);

    if (ft8TaskInProgress) {
        ESP_LOGE (TAG8, "%s called while another FT8 task is in progress.", __func__);
        vTaskDelete (NULL);
        return;
    }
    if (ft8ConfigInfo == NULL) {
        ESP_LOGE (TAG8, "%s called with ft8ConfigInfo == NULL", __func__);
        vTaskDelete (NULL);
        return;
    }

    // this block encapsulates our exclusive access to the radio port
    {
        const std::lock_guard<Lockable> lock (kxRadio);

        ft8TaskInProgress = true;

        ESP_LOGI (TAG8, "ft8 transmission starting--");

        // Get ready, do any pre-work before the 'waitForFT8Window()' call so we start at the right time
        ft8_task_pack_t * info            = (ft8_task_pack_t *)pvParameter;
        const TickType_t  toneInterval    = pdMS_TO_TICKS (160);  // 160ms interval for each tone
        long              prior_frequency = info->baseFreq + (long)round (info->tones[0] * 6.25);

        waitForFT8Window();

        // Update the timer for when to cancel the radio FT8 mode
        int64_t watchdogTime = esp_timer_get_time() + (15LL * 1000LL * 1000LL);  // 15 seconds from now, converted to microseconds
        if (watchdogTime > CancelRadioFT8ModeTime)
            CancelRadioFT8ModeTime = watchdogTime;

        struct timeval startTime;
        gettimeofday (&startTime, NULL);  // Capture the current time to calculate the total time

        uart_write_bytes (UART_NUM, "SWH16;", strlen ("SWH16;"));  // Tell the radio to turn on the CW tone
        TickType_t lastWakeTime = xTaskGetTickCount();             // Initialize lastWakeTime

        // Now tell the radio to play the array of 79 tones
        // Note that the Elecraft KX2/KX3 radios do not allow fractional Hz, so we round to the nearest Hz.
        for (int j = 0; j < FT8_NN; ++j) {
            long next_frequency = info->baseFreq + (long)round (info->tones[j] * 6.25);

            sendFT8Tone (prior_frequency,
                         next_frequency,
                         &lastWakeTime,
                         toneInterval);

            prior_frequency = next_frequency;

            if (CancelRadioFT8ModeTime <= 1)
                break;
        }

        // Tell the radio to turn off the CW tone
        uart_write_bytes (UART_NUM, "SWH16;", strlen ("SWH16;"));

        // Stop the timer and calculate the total time
        struct timeval endTime;
        gettimeofday (&endTime, NULL);
        long totalTime = (endTime.tv_sec - startTime.tv_sec) * 1000 + (endTime.tv_usec - startTime.tv_usec) / 1000;
        ESP_LOGI (TAG8, "ft8 transmission time: %ld ms", totalTime);
    }

    // Note that the cleanup will happen in the watchdog 'cleanup_ft8_task' function
    ft8TaskInProgress = false;
    ESP_LOGI (TAG8, "--ft8 transmission completed.");
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

    while (esp_timer_get_time() < CancelRadioFT8ModeTime || ft8TaskInProgress) {
        vTaskDelay (pdMS_TO_TICKS (250));
    }

    CancelRadioFT8ModeTime = 0;  // Race condition here, but minimize the probability by clearing immediately

    if (ft8ConfigInfo == NULL) {
        // This should never happen, but just in case...
        ESP_LOGE (TAG8, "cleanup_ft8_task called with ft8ConfigInfo == NULL");
        CommandInProgress = false;
        vTaskDelete (NULL);
        return;
    }

    // Restore the radio to its prior state
    {
        const std::lock_guard<Lockable> lock (kxRadio);
        kxRadio.restore_kx_state (ft8ConfigInfo->kx_state, 4);
    }

    // Release ft8ConfigInfo
    delete ft8ConfigInfo->kx_state;
    delete[] ft8ConfigInfo->tones;
    delete ft8ConfigInfo;
    ft8ConfigInfo = NULL;

    CommandInProgress = false;
    ESP_LOGI (TAG8, "cleanup_ft8_task() completed.");
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
    // so we need to stop the watchdog, then set the system clock, then restart the watchdog.

    // Shut down the inactivity watchdog timer task
    vTaskDelete (xInactivityWatchdogHandle);
    // Set the system's clock to the time received from the cell phone
    settimeofday (&nowTimeUTC, NULL);
    // Restart the inactivity watchdog timer task noting the current activity time first.
    time (&LastUserActivityUnixTime);
    xTaskCreate (&idle_status_task, "sleep_status_task", 2048, NULL, SC_TASK_PRIORITY_IDLE, &xInactivityWatchdogHandle);

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

    // char *tonesString = malloc(FT8_NN * 8 + 1);
    // tonesString[0] = '\0';
    // for (int i = 0; i < FT8_NN; ++i)
    // {
    //     char toneString[8];
    //     snprintf(toneString, sizeof(toneString), "%d,", tones[i]);
    //     strcat(tonesString, toneString);
    // }
    // ESP_LOGI(TAG8, "FT8 Tones: %s", tonesString);
    // free(tonesString);

    // this block encapsulates our exclusive access to the radio port
    {
        const std::lock_guard<Lockable> lock (kxRadio);

        // First capture the current state of the radio before changing it:
        kx_state_t * kx_state = new kx_state_t;
        kxRadio.get_kx_state (kx_state);

        // Prepare the radio to send the FT8 FSK tones using CW tones.
        // MN058; - select the TUN PWR menu item
        // MP010; - set the TUN PWR to 10 watts
        long baseFreq = rfFreq + audioFreq;

        kxRadio.put_to_kx ("FR", 1, 0, SC_KX_COMMUNICATION_RETRIES);          // FR0; - Cancels split mode
        kxRadio.put_to_kx ("FT", 1, 0, SC_KX_COMMUNICATION_RETRIES);          // FT0; - Select VFO A
        kxRadio.put_to_kx ("FA", 11, baseFreq, SC_KX_COMMUNICATION_RETRIES);  // FAnnnnnnnnnnn; - Set the radio to transmit on the middle of the FT8 frequency
        kxRadio.put_to_kx ("MD", 1, MODE_CW, SC_KX_COMMUNICATION_RETRIES);    // MD3; - To set the Peaking Filter mode, we have to be in CW mode: MD3;
        kxRadio.put_to_kx ("AP", 1, 1, SC_KX_COMMUNICATION_RETRIES);          // AP1; - Enable Audio Peaking filter

        // Offload playing the FT8 audio
        ft8ConfigInfo           = new ft8_task_pack_t;
        ft8ConfigInfo->baseFreq = baseFreq;
        ft8ConfigInfo->tones    = tones;
        ft8ConfigInfo->kx_state = kx_state;  // will be deleted later in cleanup
    }

    // We have prepared the radio to send FT8, but we don't know if the user will
    // cancel or send FT8.  We set the cleanup watchdog timer to be 1 second after
    // the next FT8 window starts.  If the user does send FT8 that will set a new
    // timout for the watchdog.  If the user cancels, the watchdog will trigger.
    CancelRadioFT8ModeTime = esp_timer_get_time() + ((msUntilFT8Window() + 1000) * 1000LL);  // 1 second after the next FT8 window starts, converted to microseconds

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

    if (ft8TaskInProgress)
        REPLY_WITH_FAILURE (req, HTTPD_500_INTERNAL_SERVER_ERROR, "post called while another FT8 task already in progress");

    STANDARD_DECODE_QUERY (req, unsafe_buf);

    CommandInProgress = true;

    if (CancelRadioFT8ModeTime <= 0 && ft8ConfigInfo == NULL) {
        // Nobody has called the 'handler_prepareft8_post' command yet, so we need to compute the FT8 tones
        // and prepare the radio, by calling the 'handler_prepareft8_post' command.
        esp_err_t rslt = handler_prepareft8_post (req);
        if (rslt != ESP_OK) {
            CommandInProgress = false;
            return rslt;
        }
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

    // Offload playing the FT8 audio
    ft8ConfigInfo->baseFreq = rfFreq + audioFreq;

    // Update the watchdog timer to be 1 second after the next FT8 window starts.
    // The xmit_ft8_task will reset the watchdog timer if it is called again.
    int64_t watchdogTime = esp_timer_get_time() + ((msUntilFT8Window() + 1000) * 1000LL);  // 1 second after the next FT8 window starts, converted to microseconds
    if (watchdogTime > CancelRadioFT8ModeTime)
        CancelRadioFT8ModeTime = watchdogTime;

    // The watchdog timer will clean up after the FT8 transmission is done.
    xTaskCreate (&xmit_ft8_task, "xmit_ft8_task", 8192, ft8ConfigInfo, SC_TASK_PRIORITY_HIGHEST, NULL);

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

    REPLY_WITH_SUCCESS();
}
