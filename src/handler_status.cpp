#include "globals.h"
#include "kx_radio.h"
#include "timed_lock.h"
#include "webserver.h"

#include <esp_log.h>
static const char * TAG8 = "sc:hdl_stat";

/**
 * Handles an HTTP GET request to check and return the current transmitting status of the radio.
 * It queries the radio for its transmitting status and returns an appropriate symbol:
 * 🟢 for not transmitting, 🔴 for transmitting, and ⚪ for an unknown or failure state.
 *
 * @param req Pointer to the HTTP request structure.
 * @return ESP_OK if the status is successfully retrieved and sent; otherwise, an error code.
 */
esp_err_t handler_connectionStatus_get (httpd_req_t * req) {
    showActivity();

    ESP_LOGV (TAG8, "trace: %s()", __func__);

    const char * symbol;

    if (!kxRadio.is_connected())
        symbol = "⚫";
    else {
        long transmitting = -1;

        // Tier 1: Fast timeout for GET operations
        TIMED_LOCK_OR_FAIL (req, kxRadio.timed_lock (RADIO_LOCK_TIMEOUT_FAST_MS, "connection status GET")) {
            if (kxRadio.get_radio_type() == RadioType::KH1) {
                char response[20];
                if (kxRadio.get_from_kx_string ("DS1", SC_KX_COMMUNICATION_RETRIES, response, sizeof (response))) {
                    // Expecting response like "DS1xxxxxxxxxxxxxxxx;" where x's are the line contents
                    char xmit_char = response[3];  // 1st character is "P" if transmitting
                    switch (xmit_char) {
                    case 'P': transmitting = 1; break;
                    default: transmitting = 0;
                    }
                }
            }
            else {
                transmitting = kxRadio.get_from_kx ("TQ", SC_KX_COMMUNICATION_RETRIES, 1);
            }
        }

        switch (transmitting) {
        case 0:
            symbol = "🟢";
            break;
        case 1:
            symbol = "🔴";
            break;
        default:  // includes transmitting == -1, the failure case
            symbol = "⚪";
        }
    }

    REPLY_WITH_STRING (req, symbol, "connection status");
}
