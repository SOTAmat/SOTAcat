#include "globals.h"
#include "kx_radio.h"
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
        const std::lock_guard<Lockable> lock (kxRadio);
        long                            transmitting = kxRadio.get_from_kx ("TQ", SC_KX_COMMUNICATION_RETRIES, 1);

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
