#include <ctype.h>
#include <math.h>
#include <sys/time.h>

#include "driver/gpio.h"
#include "driver/uart.h"
#include "esp_http_server.h"
#include "esp_log.h"
#include "esp_timer.h"
#include "handler_ft8.h"
#include "globals.h"
#include "settings.h"
#include "../lib/ft8_encoder/ft8/constants.h"
#include "../lib/ft8_encoder/ft8/encode.h"
#include "../lib/ft8_encoder/ft8/pack.h"

// Thank-you to KI6SYD for providing key information about the Elecraft KX radios and for initial testing. - AB6D

int64_t CancelRadioFT8ModeTime = 0;
bool ft8TaskInProgress = false;
ft8_task_pack_t *ft8ConfigInfo = NULL;

bool url_decode_in_place(char *str)
{
    char *dst = str;
    int a, b;
    while (*str)
    {
        if ((*str == '%') &&
            ((a = str[1]) && (b = str[2])) &&
            (isxdigit(a) && isxdigit(b)))
        {
            if (a >= 'a')
                a -= 'a' - 'A';
            if (a >= 'A')
                a -= ('A' - 10);
            else
                a -= '0';
            if (b >= 'a')
                b -= 'a' - 'A';
            if (b >= 'A')
                b -= ('A' - 10);
            else
                b -= '0';

            *dst++ = 16 * a + b;
            str += 3;
        }
        else if (*str == '+')
        {
            *dst++ = ' ';
            str++;
        }
        else
        {
            *dst++ = *str++;
        }
    }
    *dst = '\0';

    return true;
}

// ====================================================================================================
static long msUntilFT8Window()
{
    // Obtain the current time with microsecond precision
    struct timeval tv_now;
    gettimeofday(&tv_now, NULL);

    // Convert current time to milliseconds using long long to avoid overflow
    long long now_ms = (long long)(tv_now.tv_sec) * 1000LL + (tv_now.tv_usec / 1000LL);

    // Calculate delay until the next 15-second boundary
    long delay_ms = 15000 - (now_ms % 15000LL);
    if (delay_ms == 15000)
        delay_ms = 0; // Adjust if already at boundary

    return delay_ms;
}

// ====================================================================================================
static void waitForFT8Window()
{
    long delay_ms = msUntilFT8Window();

    // Use vTaskDelay to wait for the calculated delay in ticks
    // Note: pdMS_TO_TICKS converts milliseconds to ticks
    if (delay_ms > 0)
        vTaskDelay(pdMS_TO_TICKS(delay_ms));
}

// ====================================================================================================
#define EASE_STEPS 1

static void sendFT8Tone(long prior_frequency, long frequency, TickType_t *lastWakeTime, const TickType_t toneInterval)
{
    char command[16];
    // Ease into the new frequency based on the prior frequency in x steps lasting 10% of the interval
    long delta_frequency = frequency - prior_frequency;

    for (int step = 1; step <= EASE_STEPS; step++)
    {
        long eased_frequency = prior_frequency + round(delta_frequency * ((float)step / EASE_STEPS));
        snprintf(command, sizeof(command), "FA%011ld;", eased_frequency);

        // Send the tone command over UART
        uart_write_bytes(UART_NUM, command, 14);
    }

    // Reset the lastWakeTime to the time we entered this function, and then wait the 0.16 total interval seconds.
    vTaskDelayUntil(lastWakeTime, toneInterval);
}

// ====================================================================================================
static void xmit_ft8_task(void *pvParameter)
{
    if (ft8TaskInProgress)
    {
        ESP_LOGI(TAG, "ERROR: xmit_ft8_task() called while another FT8 task is in progress.");
        vTaskDelete(NULL);
        return;
    }
    if (ft8ConfigInfo == NULL)
    {
        ESP_LOGI(TAG, "ERROR: xmit_ft8_task() called with ft8ConfigInfo == NULL");
        vTaskDelete(NULL);
        return;
    }

    xSemaphoreTake(KXCommunicationMutex, portMAX_DELAY);
    ft8TaskInProgress = true;

    ESP_LOGI(TAG, "xmit_ft8_task() started.");

    // Get ready, do any pre-work before the 'waitForFT8Window()' call so we start at the right time
    struct timeval startTime;

    ft8_task_pack_t *info = (ft8_task_pack_t *)pvParameter;
    const TickType_t toneInterval = pdMS_TO_TICKS(160); // 160ms interval for each tone
    long prior_frequency = info->baseFreq + (long)round(info->tones[0] * 6.25);

    waitForFT8Window();

    // Update the timer for when to cancel the radio FT8 mode
    int64_t watchdogTime = esp_timer_get_time() + (15LL * 1000LL * 1000LL); // 15 seconds from now, converted to microseconds
    if (watchdogTime > CancelRadioFT8ModeTime)
        CancelRadioFT8ModeTime = watchdogTime;

    gettimeofday(&startTime, NULL); // Capture the current time to calculate the total time

    uart_write_bytes(UART_NUM, "SWH16;", strlen("SWH16;")); // Tell the radio to turn on the CW tone
    TickType_t lastWakeTime = xTaskGetTickCount();          // Initialize lastWakeTime

    // Now tell the radio to play the array of 79 tones
    // Note that the Elecraft KX2/KX3 radios do not allow fractional Hz, so we round to the nearest Hz.
    for (int j = 0; j < FT8_NN; ++j)
    {
        long next_frequency = info->baseFreq + (long)round(info->tones[j] * 6.25);
        sendFT8Tone(prior_frequency,
                    next_frequency,
                    &lastWakeTime,
                    toneInterval);
        prior_frequency = next_frequency;
    }

    // Tell the radio to turn off the CW tone
    uart_write_bytes(UART_NUM, "SWH16;", strlen("SWH16;"));

    // Stop the timer and calculate the total time
    struct timeval endTime;
    gettimeofday(&endTime, NULL);
    long totalTime = (endTime.tv_sec - startTime.tv_sec) * 1000 + (endTime.tv_usec - startTime.tv_usec) / 1000;
    ESP_LOGI(TAG, "FT8 transmission time: %ld ms", totalTime);

    // Note that the cleanup will happen in the watchdog 'cleanup_ft8_task' function
    xSemaphoreGive(KXCommunicationMutex);
    ft8TaskInProgress = false;
    ESP_LOGI(TAG, "xmit_ft8_task() completed.");
    vTaskDelete(NULL);
}

// ====================================================================================================
static void cleanup_ft8_task(void *pvParameter)
{
    ESP_LOGI(TAG, "cleanup_ft8_task() started.");

    // Function gets called 15 seconds after the FT8 transmission starts so that we can clean up.
    // This acts as a watchdog which can be reset when repeated FT8 transmissions are sent, but
    // a few seconds after the last transmission, the watchdog will trigger and clean up.

    while (esp_timer_get_time() < CancelRadioFT8ModeTime || ft8TaskInProgress)
        vTaskDelay(pdMS_TO_TICKS(250));

    CancelRadioFT8ModeTime = 0; // Race condition here, but minimize the probability by clearing immediately

    if (ft8ConfigInfo == NULL)
    {
        // This should never happen, but just in case...
        ESP_LOGI(TAG, "ERROR: cleanup_ft8_task called with ft8ConfigInfo == NULL");
        CommandInProgress = false;
        vTaskDelete(NULL);
        return;
    }

    // Restore the radio to its prior state
    xSemaphoreTake(KXCommunicationMutex, portMAX_DELAY);
    restore_kx_state(ft8ConfigInfo->kx_state, 4);
    xSemaphoreGive(KXCommunicationMutex);

    delete ft8ConfigInfo->kx_state;
    delete[] ft8ConfigInfo->tones;
    delete ft8ConfigInfo;
    ft8ConfigInfo = NULL;
    CommandInProgress = false;
    ESP_LOGI(TAG, "cleanup_ft8_task() completed.");
    vTaskDelete(NULL);
}

// ====================================================================================================
esp_err_t handler_prepareft8_post(httpd_req_t *req)
{
    showActivity();

    if (CommandInProgress || ft8ConfigInfo != NULL)
    {
        ESP_LOGI(TAG, "ERROR: handler_prepareft8_post() called while another command is in progress.");
        httpd_resp_send_500(req); // Bad request because another is in progress!
        return ESP_FAIL;
    }
    CommandInProgress = true;
    gpio_set_level(LED_BLUE, LED_ON); // LED on

    // Get the length of the URL query
    size_t buf_len = httpd_req_get_url_query_len(req) + 1;
    if (buf_len > 1)
    {
        char *buf = new char[buf_len + 1];
        if (!buf)
        {
            ESP_LOGI(TAG, "ERROR: handler_prepareft8_post() : heap allocation failed.");
            httpd_resp_send_500(req);
            CommandInProgress = false;
            return ESP_FAIL;
        }

        // Get the URL query
        if (httpd_req_get_url_query_str(req, buf, buf_len) == ESP_OK)
        {
            char ft8_msg[64];
            char nowTimeUTCms_str[64];
            int64_t nowTimeUTCms = 0;
            char rfFreq_str[32];
            long rfFreq = 0;
            char audioFreq_str[16];
            int audioFreq = 0;
            char *timeStringEndChar = NULL;

            ESP_LOGI(TAG, "handler_prepareft8_post() called with buffer len %d: %s", buf_len, buf);

            // Parse the 'messageText' parameter from the query
            if (httpd_query_key_value(buf, "messageText", ft8_msg, sizeof(ft8_msg)) == ESP_OK &&
                url_decode_in_place(ft8_msg) &&
                strnlen(ft8_msg, sizeof(ft8_msg)) <= 13 &&
                httpd_query_key_value(buf, "timeNow", nowTimeUTCms_str, sizeof(nowTimeUTCms_str)) == ESP_OK &&
                (nowTimeUTCms = strtoll(nowTimeUTCms_str, &timeStringEndChar, 10)) > 0 &&
                httpd_query_key_value(buf, "rfFrequency", rfFreq_str, sizeof(rfFreq_str)) == ESP_OK &&
                (rfFreq = atol(rfFreq_str)) > 0 &&
                httpd_query_key_value(buf, "audioFrequency", audioFreq_str, sizeof(audioFreq_str)) == ESP_OK &&
                (audioFreq = atoi(audioFreq_str)) > 0)
            {
                // Set the system clock based on the time received from the phone
                struct timeval nowTimeUTC;
                nowTimeUTC.tv_sec = nowTimeUTCms / 1000;
                nowTimeUTC.tv_usec = (nowTimeUTCms % 1000) * 1000;
                settimeofday(&nowTimeUTC, NULL);

                // First, pack the text data into an FT8 binary message
                uint8_t packed[FTX_LDPC_K_BYTES];
                int rc = pack77(ft8_msg, packed);
                if (rc < 0)
                {
                    ESP_LOGI(TAG, "ERROR: Can't parse FT8 message");
                    httpd_resp_send_500(req); // Bad request for one of several reasons
                    CommandInProgress = false;
                    delete[] buf;
                    return ESP_FAIL;
                }

                // Second, encode the binary message as a sequence of FSK tones
                uint8_t *tones = new uint8_t[FT8_NN]; // Array of 79 tones (symbols)
                if (tones == NULL)
                {
                    ESP_LOGI(TAG, "ERROR: Can't allocate memory for FT8 tones");
                    httpd_resp_send_500(req); // Bad request for one of several reasons
                    CommandInProgress = false;
                    delete[] buf;
                    return ESP_FAIL;
                }

                ft8_encode(packed, tones);

                // char *tonesString = malloc(FT8_NN * 8 + 1);
                // tonesString[0] = '\0';
                // for (int i = 0; i < FT8_NN; ++i)
                // {
                //     char toneString[8];
                //     snprintf(toneString, sizeof(toneString), "%d,", tones[i]);
                //     strcat(tonesString, toneString);
                // }
                // ESP_LOGI(TAG, "FT8 Tones: %s", tonesString);
                // free(tonesString);

                // First capture the current state of the radio before changing it:
                kx_state_t *kx_state = new kx_state_t;
                get_kx_state(kx_state);

                // Prepare the radio to send the FT8 FSK tones using CW tones.
                // MN058; - select the TUN PWR menu item
                // MP010; - set the TUN PWR to 10 watts
                long baseFreq = rfFreq + audioFreq;

                put_to_kx("FR", 1, 0, 2);         // FR0; - Cancels split mode
                put_to_kx("FT", 1, 0, 2);         // FT0; - Select VFO A
                put_to_kx("FA", 11, baseFreq, 2); // FAnnnnnnnnnnn; - Set the radio to transmit on the middle of the FT8 frequency
                put_to_kx("MD", 1, 3, 2);         // MD3; - To set the Peaking Filter mode we have to be in CW mode: MD3;
                put_to_kx("AP", 1, 1, 2);         // AP1; - Enable Audio Peaking filter

                // Offload playing the FT8 audio
                ft8ConfigInfo = new ft8_task_pack_t;
                ft8ConfigInfo->baseFreq = baseFreq;
                ft8ConfigInfo->tones = tones;
                ft8ConfigInfo->kx_state = kx_state;  // will be deleted later in cleanup

                // We have prepared the radio to send FT8, but we don't know if the user will
                // cancel or send FT8.  We set the cleanup watchdog timer to be 1 second after
                // the next FT8 window starts.  If the user does send FT8 that will set a new
                // timout for the watchdog.  If the user cancels, the watchdog will trigger.
                CancelRadioFT8ModeTime = esp_timer_get_time() + ((msUntilFT8Window() + 1000) * 1000LL); // 1 second after the next FT8 window starts, converted to microseconds

                // Start the watchdog timer to cleanup whenever we are done with ft8.
                // This will set CommandInProgress=false; and restore the radio to its prior state.
                xTaskCreate(&cleanup_ft8_task, "cleanup_ft8_task", 5120, NULL, 5, NULL);

                // Send a response back
                httpd_resp_send(req, "OK", HTTPD_RESP_USE_STRLEN);
                delete[] buf;
                ESP_LOGI(TAG, "handler_prepareft8_post(): success.");
                return ESP_OK;
            }
            else
            {
                ESP_LOGI(TAG, "ERROR: handler_prepareft8_post(): parsing parameters error.");
                httpd_resp_send_500(req); // Bad request for one of several reasons
            }
        }
        else
        {
            ESP_LOGI(TAG, "ERROR: handler_prepareft8_post(): Querry parsing error.");
            httpd_resp_send_404(req); // Query parsing error
        }

        delete[] buf;
    }
    else
    {
        // HTTP buffer length is less than 1, so no query string, no new to delete
        httpd_resp_send_404(req); // No query string
    }

    CommandInProgress = false;
    ESP_LOGI(TAG, "ERROR: handler_prepareft8_post(): failed.");
    return ESP_FAIL;
}

// ====================================================================================================
esp_err_t handler_ft8_post(httpd_req_t *req)
{
    showActivity();

    if (ft8TaskInProgress)
    {
        ESP_LOGI(TAG, "ERROR: handler_ft8_post() called while another FT8 task is in progress.");
        httpd_resp_send_500(req); // Bad request because another is in progress!
        return ESP_FAIL;
    }

    CommandInProgress = true;

    if (CancelRadioFT8ModeTime <= 0 && ft8ConfigInfo == NULL)
    {
        // Nobody has called the 'handler_prepareft8_post' command yet, so we need to compute the FT8 tones
        // and prepare the radio, by calling the 'handler_prepareft8_post' command.
        esp_err_t rslt = handler_prepareft8_post(req);
        if (rslt != ESP_OK)
        {
            CommandInProgress = false;
            return rslt;
        }
    }

    // We need to reparse the frequency and audio frequency from the query string
    // Get the length of the URL query
    size_t buf_len = httpd_req_get_url_query_len(req) + 1;
    if (buf_len > 1)
    {
        char *buf = new char[buf_len + 1];
        if (!buf)
        {
            ESP_LOGI(TAG, "ERROR: handler_ft8_post() : heap allocation failed.");
            httpd_resp_send_500(req);
            CommandInProgress = false;
            return ESP_FAIL;
        }

        // Get the URL query
        if (httpd_req_get_url_query_str(req, buf, buf_len) == ESP_OK)
        {
            char rfFreq_str[32];
            long rfFreq = 0;
            char audioFreq_str[16];
            int audioFreq = 0;

            ESP_LOGI(TAG, "handler_ft8_post() called with buffer len %d: %s", buf_len, buf);

            // Parse the 'messageText' parameter from the query
            if (httpd_query_key_value(buf, "rfFrequency", rfFreq_str, sizeof(rfFreq_str)) == ESP_OK &&
                (rfFreq = atol(rfFreq_str)) > 0 &&
                httpd_query_key_value(buf, "audioFrequency", audioFreq_str, sizeof(audioFreq_str)) == ESP_OK &&
                (audioFreq = atoi(audioFreq_str)) > 0)
            {
                // Offload playing the FT8 audio
                ft8ConfigInfo->baseFreq = rfFreq + audioFreq;

                // Update the watchdog timer to be 1 second after the next FT8 window starts.
                // The xmit_ft8_task will reset the watchdog timer if it is called again.
                int64_t watchdogTime = esp_timer_get_time() + ((msUntilFT8Window() + 1000) * 1000LL); // 1 second after the next FT8 window starts, converted to microseconds
                if (watchdogTime > CancelRadioFT8ModeTime)
                {
                    CancelRadioFT8ModeTime = watchdogTime;
                }

                // The watchdog timer will clean up after the FT8 transmission is done.
                xTaskCreate(&xmit_ft8_task, "xmit_ft8_task", 8192, ft8ConfigInfo, 8, NULL);

                // Send a response back
                httpd_resp_send(req, "OK", HTTPD_RESP_USE_STRLEN);
                delete[] buf;
                ESP_LOGI(TAG, "handler_ft8_post(): success.");
                return ESP_OK;
            }
            else
            {
                ESP_LOGI(TAG, "ERROR: handler_ft8_post(): parsing parameters error.");
                httpd_resp_send_500(req); // Bad request for one of several reasons
            }
        }
        else
        {
            ESP_LOGI(TAG, "ERROR: handler_ft8_post(): parsing error.");
            httpd_resp_send_404(req); // Query parsing error
        }

        delete[] buf;
    }
    else
    {
        ESP_LOGI(TAG, "ERROR: handler_ft8_post(): No Query String error.");
        httpd_resp_send_404(req); // No query string, so no new to delete
    }

    CommandInProgress = false;
    ESP_LOGI(TAG, "ERROR: handler_ft8_post(): failed.");
    return ESP_FAIL;
}

// ====================================================================================================
esp_err_t handler_cancelft8_post(httpd_req_t *req)
{
    // Tell the watchdog timer to cancel the FT8 mode and restore the radio to its prior state
    CancelRadioFT8ModeTime = 1;
    httpd_resp_send(req, "OK", HTTPD_RESP_USE_STRLEN);
    ESP_LOGI(TAG, "handler_cancelft8_post(): success.");
    return ESP_OK;
}
