#include "globals.h"
#include "kx_radio.h"
#include "radio_service.h"
#include "radio_snapshot.h"
#include "timed_lock.h"
#include "webserver.h"

#include <esp_log.h>
#include <esp_timer.h>
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

    if (!radio_service_link_up())
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
        // Never touch the radio here — read the cached xmit state the
        // service task maintains. Stale/unknown -> ⚪, and request a
        // refresh so the next poll is accurate.
        RadioSnapshotData snap = radio_snapshot::get();
        int64_t           now  = esp_timer_get_time();
        if (!snap.has_xmit())
            radio_service_request_refresh (RadioCmdType::REFRESH_XMIT);
        else if (!snap.xmit_fresh (now))
            radio_service_request_refresh (RadioCmdType::REFRESH_XMIT);
        switch (snap.xmit_state) {
        case 0:  symbol = "🟢"; break;
        case 1:  symbol = "🔴"; break;
        default: symbol = "⚪";
        }
    }

    REPLY_WITH_STRING (req, symbol, "connection status");
}
