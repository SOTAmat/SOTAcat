#include "globals.h"
#include "kx_radio.h"
#include "webserver.h"

#include <memory>

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

    long         xmit    = atoi (param_value);  // Convert the parameter to an integer
    const char * command = xmit ? "TX;" : "RX;";

    {
        const std::lock_guard<Lockable> lock (kxRadio);
        kxRadio.put_to_kx_command_string (command, 1);
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

    long         bank    = atoi (param_value);  // Convert the parameter to an integer
    const char * command = bank == 1 ? "SWT11;SWT19;" : "SWT11;SWT27;";

    {
        const std::lock_guard<Lockable> lock (kxRadio);
        kxRadio.put_to_kx_command_string (command, 1);
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

    long power;
    {
        const std::lock_guard<Lockable> lock (kxRadio);
        power = kxRadio.get_from_kx ("PC", SC_KX_COMMUNICATION_RETRIES, 3);
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

    {
        const std::lock_guard<Lockable> lock (kxRadio);
        if (!kxRadio.put_to_kx ("PC", 3, atoi (param_value), SC_KX_COMMUNICATION_RETRIES))
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

    char command[256];
    snprintf (command, sizeof (command), "KYW%s;", param_value);
    {
        const std::lock_guard<Lockable> lock (kxRadio);

        radio_mode_t mode            = (radio_mode_t)kxRadio.get_from_kx ("MD", SC_KX_COMMUNICATION_RETRIES, 1);
        long         speed_wpm       = kxRadio.get_from_kx ("KS", SC_KX_COMMUNICATION_RETRIES, 3);
        long         chars_remaining = strlen (param_value);

        if (mode != MODE_CW)
            kxRadio.put_to_kx ("MD", 1, MODE_CW, SC_KX_COMMUNICATION_RETRIES);
        kxRadio.put_to_kx_command_string (command, 1);

        /**
         * NOTE: Ideally, we'd have a do-while loop here looking at the
         * remaining queue of characters to be transmitted, and looping to delay
         * further if there are any. Regrettably, the response format of the
         * relevant "TBX;" command is of variable length since it shows the
         * count of characters (good) and also what they are (bad). The
         * combination is bad for us, because we currently don't have an
         * accommodation in the uart communications for variable-length
         * responses. But we're conservative enough in this current
         * implementation that we come quite close to being contemporaneous with
         * the conclusion of the transmission.
         */
        long duration_ms = 60 * 1000 * chars_remaining / (speed_wpm * 5);
        ESP_LOGI (TAG8, "delaying %ld ms for %ld chars at %ld wpm", duration_ms, chars_remaining, speed_wpm);
        vTaskDelay (pdMS_TO_TICKS (duration_ms));

        vTaskDelay (pdMS_TO_TICKS (600));  // an additional amount, once, for command processing
        if (mode != MODE_CW)
            kxRadio.put_to_kx ("MD", 1, mode, SC_KX_COMMUNICATION_RETRIES);
    }

    REPLY_WITH_SUCCESS();
}
