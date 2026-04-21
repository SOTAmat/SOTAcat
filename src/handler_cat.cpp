#include "globals.h"
#include "kx_radio.h"
#include "timed_lock.h"
#include "webserver.h"

#include <cstdlib>
#include <cstring>
#include <esp_log.h>
#include <freertos/FreeRTOS.h>
#include <freertos/task.h>

static const char * TAG8 = "sc:hdl_cat.";

/**
 * Handles an HTTP PUT request to enable/disable transmit
 *
 * @param req Pointer to the HTTP request structure.  The "state" query parameter
 *            is expected to hold either "0" (turn off transmission), or any other
 *            integer (turn on transmission)
 */
esp_err_t handler_xmit_put (httpd_req_t * req) {
    showActivity();

    ESP_LOGV (TAG8, "trace: %s()", __func__);

    STANDARD_DECODE_SOLE_PARAMETER (req, "state", param_value);
    ESP_LOGI (TAG8, "setting xmit to '%s'", param_value);

    long xmit = atoi (param_value);  // Convert the parameter to an integer

    // Tier 3: Critical timeout for TX/RX toggle
    TIMED_LOCK_OR_FAIL (req, kxRadio.timed_lock (RADIO_LOCK_TIMEOUT_CRITICAL_MS, "TX/RX toggle")) {
        if (!kxRadio.set_xmit_state (xmit != 0))
            REPLY_WITH_FAILURE (req, HTTPD_500_INTERNAL_SERVER_ERROR, "unable to set xmit");
    }

    REPLY_WITH_SUCCESS();
}

/**
 * Handles an HTTP PUT request to play a pre-recorded message from bank 1 or 2
 *
 * @param req Pointer to the HTTP request structure.  The "bank" query parameter
 *            is expected to hold either "1" or "2".
 */
esp_err_t handler_msg_put (httpd_req_t * req) {
    showActivity();

    ESP_LOGV (TAG8, "trace: %s()", __func__);

    STANDARD_DECODE_SOLE_PARAMETER (req, "bank", param_value);
    ESP_LOGI (TAG8, "playing message bank '%s'", param_value);

    long bank = atoi (param_value);  // Convert the parameter to an integer

    // Tier 2: Quick timeout for fast SET operations
    TIMED_LOCK_OR_FAIL (req, kxRadio.timed_lock (RADIO_LOCK_TIMEOUT_QUICK_MS, "message play")) {
        if (!kxRadio.play_message_bank (bank))
            REPLY_WITH_FAILURE (req, HTTPD_500_INTERNAL_SERVER_ERROR, "unable to play message bank");
    }

    REPLY_WITH_SUCCESS();
}

/**
 * Handles an HTTP GET request to retrieve the current power level.
 *
 * This function processes the HTTP GET request and retrieves the current power level
 * from the radio. The power level is then sent back as the HTTP response.
 *
 * @param req Pointer to the HTTP request structure.
 */
esp_err_t handler_power_get (httpd_req_t * req) {
    showActivity();

    ESP_LOGV (TAG8, "trace: %s()", __func__);

    long power = -1;

    // Tier 1: Fast timeout for GET operations
    TIMED_LOCK_OR_FAIL (req, kxRadio.timed_lock (RADIO_LOCK_TIMEOUT_FAST_MS, "power GET")) {
        if (!kxRadio.get_power (power))
            REPLY_WITH_FAILURE (req, HTTPD_404_NOT_FOUND, "power read not supported");
    }

    char power_string[8];
    snprintf (power_string, sizeof (power_string), "%ld", power);

    REPLY_WITH_STRING (req, power_string, "power");
}

/**
 * Handles an HTTP PUT request to set the power level.
 *
 * This function processes the HTTP PUT request by decoding the "power" query parameter,
 * which specifies the new power level to set. It sends a command to the radio to update
 * the power level accordingly.
 *
 * @param req Pointer to the HTTP request structure. The "power" query parameter
 *            is expected to hold a string representing the new power level.
 */
esp_err_t handler_power_put (httpd_req_t * req) {
    showActivity();

    ESP_LOGV (TAG8, "trace: %s()", __func__);

    STANDARD_DECODE_SOLE_PARAMETER (req, "power", param_value);
    ESP_LOGI (TAG8, "setting power to '%s'", param_value);

    long desired_power = atoi (param_value);

    // Tier 2: Moderate timeout for SET operations
    TIMED_LOCK_OR_FAIL (req, kxRadio.timed_lock (RADIO_LOCK_TIMEOUT_MODERATE_MS, "power SET")) {
        if (!kxRadio.set_power (desired_power))
            REPLY_WITH_FAILURE (req, HTTPD_404_NOT_FOUND, "unable to set power");
    }

    REPLY_WITH_SUCCESS();
}

/**
 * Background task that actually transmits a CW keyer message. Spawned from the
 * httpd server task so the single httpd worker stays free to service status,
 * frequency, and mode polls during the prolonged on-air transmission.
 *
 * Ownership:
 * pvParameter is a heap-allocated, null-terminated message string
 * transferred from handler_keyer_put(); this task frees it.
 * The caller is also responsible for having claimed the keyer via
 * kxRadio.try_begin_keyer_operation(); this task releases the claim via
 * kxRadio.end_keyer_operation().
 */
static void keyer_task (void * pvParameter) {
    char * message = (char *)pvParameter;

    {
        // Tier 3: critical timeout - keying can take up to ~15s for long messages.
        TimedLock lock = kxRadio.timed_lock (RADIO_LOCK_TIMEOUT_CRITICAL_MS, "keyer task");
        if (lock.acquired()) {
            if (!kxRadio.send_keyer_message (message))
                ESP_LOGE (TAG8, "keyer send failed for message '%s'", message);
        }
        else {
            ESP_LOGE (TAG8, "keyer task could not acquire radio lock for '%s'", message);
        }
    }

    kxRadio.end_keyer_operation();
    free (message);
    vTaskDelete (NULL);
}

/**
 * Handles an HTTP PUT request to send a Morse code message.
 *
 * The actual keying is dispatched to a background FreeRTOS task so that this
 * handler (and therefore the single httpd server task) returns immediately
 * and remains available to service status, frequency, and mode polls while
 * the transmission is on the air. handler_connectionStatus_get consults
 * kxRadio.is_keyer_active() to report 🔴 during this window without waiting
 * on the radio mutex.
 *
 * @param req Pointer to the HTTP request structure. The "message" query parameter
 *            is expected to hold the text to be transmitted in Morse code.
 */
esp_err_t handler_keyer_put (httpd_req_t * req) {
    showActivity();

    ESP_LOGV (TAG8, "trace: %s()", __func__);

    if (!kxRadio.supports_keyer())
        REPLY_WITH_FAILURE (req, HTTPD_404_NOT_FOUND, "Morse keying not supported on this radio");

    STANDARD_DECODE_SOLE_PARAMETER (req, "message", param_value);

    url_decode_in_place (param_value);
    ESP_LOGI (TAG8, "keying message '%s'", param_value);

    if (!kxRadio.try_begin_keyer_operation())
        REPLY_WITH_FAILURE (req, HTTPD_500_INTERNAL_SERVER_ERROR, "keyer busy, please retry");

    char * message_copy = strdup (param_value);
    if (!message_copy) {
        kxRadio.end_keyer_operation();
        REPLY_WITH_FAILURE (req, HTTPD_500_INTERNAL_SERVER_ERROR, "heap allocation failed");
    }

    if (xTaskCreate (&keyer_task, "keyer_task", 4096, message_copy, SC_TASK_PRIORITY_NORMAL, NULL) != pdPASS) {
        free (message_copy);
        kxRadio.end_keyer_operation();
        REPLY_WITH_FAILURE (req, HTTPD_500_INTERNAL_SERVER_ERROR, "failed to start keyer task");
    }

    REPLY_WITH_SUCCESS();
}
