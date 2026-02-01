#include "globals.h"
#include "kx_radio.h"
#include "timed_lock.h"
#include "webserver.h"

#include <esp_log.h>
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
 * Handles an HTTP PUT request to send a Morse code message.
 *
 * This function processes the HTTP PUT request by decoding the "message" query
 * parameter, which specifies the Morse code message to be sent. The message is
 * URL-decoded, and then a command is constructed to send the message via the
 * radio. The function also manages the radio mode and calculates the necessary
 * delay before restoring the mode based on the message length and speed.
 *
 * @param req Pointer to the HTTP request structure. The "message" query parameter
 *            is expected to hold the text to be transmitted in Morse code.
 */
esp_err_t handler_keyer_put (httpd_req_t * req) {
    showActivity();

    ESP_LOGV (TAG8, "trace: %s()", __func__);

    STANDARD_DECODE_SOLE_PARAMETER (req, "message", param_value);

    url_decode_in_place (param_value);
    ESP_LOGI (TAG8, "keying message '%s'", param_value);

    // Tier 3: Critical timeout for keyer operation
    TIMED_LOCK_OR_FAIL (req, kxRadio.timed_lock (RADIO_LOCK_TIMEOUT_CRITICAL_MS, "keyer")) {
        if (!kxRadio.supports_keyer())
            REPLY_WITH_FAILURE (req, HTTPD_404_NOT_FOUND, "Morse keying not supported on this radio");
        if (!kxRadio.send_keyer_message (param_value))
            REPLY_WITH_FAILURE (req, HTTPD_500_INTERNAL_SERVER_ERROR, "keyer send failed");
    }

    REPLY_WITH_SUCCESS();
}
