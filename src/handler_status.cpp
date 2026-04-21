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
    else if (Ft8RadioExclusive) {
        symbol = "⚪";
    }
    else if (kxRadio.is_keyer_active()) {
        // CW keyer holds the radio mutex for the full transmit duration; report
        // transmitting directly instead of timing out trying to take the lock.
        symbol = "🔴";
    }
    else {
        long transmitting = -1;

        // Tier 1: Fast timeout for GET operations
        TIMED_LOCK_OR_FAIL (req, kxRadio.timed_lock (RADIO_LOCK_TIMEOUT_FAST_MS, "connection status GET")) {
            if (!kxRadio.get_xmit_state (transmitting))
                transmitting = -1;
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
