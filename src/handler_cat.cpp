#include <memory>
#include "globals.h"
#include "kx_radio.h"
#include "webserver.h"

#include <esp_log.h>
static const char * TAG8 = "sc:hdl_cat ";

/**
 * Handles an HTTP PUT request to play a pre-recorded message
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
    ESP_LOGI (TAG8, "returning power: %s", power_string);
    httpd_resp_send (req, power_string, HTTPD_RESP_USE_STRLEN);

    return ESP_OK;
}

esp_err_t handler_power_put (httpd_req_t * req) {
    showActivity();

    ESP_LOGV (TAG8, "trace: %s()", __func__);

    STANDARD_DECODE_SOLE_PARAMETER (req, "power", param_value);
    ESP_LOGI (TAG8, "setting power to '%s'", param_value);

    {
        const std::lock_guard<Lockable> lock (kxRadio);
        if (!kxRadio.put_to_kx ("PC", 3, atoi (param_value), SC_KX_COMMUNICATION_RETRIES))
            REPLY_WITH_FAILURE (req, 404, "unable to set power");
    }

    REPLY_WITH_SUCCESS();
}

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
        radio_mode_t                    mode;

        mode = (radio_mode_t)kxRadio.get_from_kx ("MD", SC_KX_COMMUNICATION_RETRIES, 1);
        if (mode != MODE_CW)
            kxRadio.put_to_kx ("MD", 1, MODE_CW, SC_KX_COMMUNICATION_RETRIES);
        kxRadio.put_to_kx_command_string (command, 1);
        /**
         * TODO: wait for keying to complete before changing mode back This can
         * be a combination of a smart delay computed by taking WPM, message
         * size, and standard dot length into account As well, it can finish by
         * querying the radio for characters remaining to transmit, and
         * repeating that polling using shorter cycle informed by the queue
         * length. See "TBX" command. As it stands, the mode switch will be
         * queued, and won't disrupt transmission, but since the command returns
         * immediately and says we're still in CW mode, it looks like a failure
         * in the logs.
         */
        if (mode != MODE_CW)
            kxRadio.put_to_kx ("MD", 1, mode, SC_KX_COMMUNICATION_RETRIES);
    }

    REPLY_WITH_SUCCESS();
}
