#include "globals.h"
#include "kx_radio.h"
#include "radio_park_httpd.h"
#include "radio_service.h"
#include "radio_snapshot.h"
#include "webserver.h"

#include <esp_timer.h>

#include <esp_log.h>
static const char * TAG8 = "sc:hdl_stat";

// Compose the status glyph from live state + the snapshot's xmit state.
// ⚫ link down · ⚪ FT8 / unknown · 🔴 transmitting (CW keyer or TX) · 🟢 idle
static const char * status_symbol (const RadioSnapshotData & snap) {
    if (!radio_service_link_up())
        return "⚫";
    if (Ft8RadioExclusive)
        return "⚪";
    if (kxRadio.is_keyer_active())
        return "🔴";  // CW keyer holds the radio for the whole transmission
    switch (snap.xmit_state) {
    case 0: return "🟢";
    case 1: return "🔴";
    default: return "⚪";
    }
}

static void send_status (httpd_req_t * req, const RadioSnapshotData & snap) {
    const char * symbol = status_symbol (snap);
    ESP_LOGI (TAG8, "returning connection status: %s", symbol);
    http_send_string (req, symbol);
}

// Async completer: the xmit refresh finished (or the wait expired).
static void status_get_complete (httpd_req_t * req, RadioParkOutcome, bool) {
    send_status (req, radio_snapshot::get());
}

/**
 * Handles an HTTP GET request to check and return the current transmitting status of the radio.
 * Returns 🟢 for not transmitting, 🔴 for transmitting, ⚪ for unknown/FT8, ⚫ for link down.
 *
 * Never touches the radio: reads the cached xmit state the service task
 * maintains. If that is stale and the link is up, arms a refresh and parks
 * the request (up to RADIO_PARK_GET_WAIT_MS) so the glyph reflects the
 * refreshed state. The HTTP server task is never blocked.
 *
 * @param req Pointer to the HTTP request structure.
 * @return ESP_OK if the status is successfully retrieved and sent; otherwise, an error code.
 */
esp_err_t handler_connectionStatus_get (httpd_req_t * req) {
    showActivity();
    ESP_LOGV (TAG8, "trace: %s()", __func__);

    RadioSnapshotData snap = radio_snapshot::get();
    int64_t           now  = esp_timer_get_time();

    // Link down: reply ⚫ at once, but ARM A RECOVERY PROBE. This poll runs
    // on every tab, every 5 s, so recovery must not depend on whether some
    // other client happens to be issuing stale frequency/mode GETs (hardware
    // test 2026-08-17: Run tab, radio off→on, glyph stayed ⚫ for 35 s until
    // a tab switch fetched frequency). The worker throttles link-down probes
    // to one TQ; ping per LINK_DOWN_PROBE_INTERVAL_US (5 s), ~0.2 s each.
    if (!radio_service_link_up() && !Ft8RadioExclusive)
        radio_service_request_refresh (RadioCmdType::REFRESH_XMIT);

    // Only the xmit-state branch depends on the snapshot; the ⚫/⚪/keyer-🔴
    // cases are decided from live flags and never need a refresh.
    if (radio_service_link_up() && !Ft8RadioExclusive && !kxRadio.is_keyer_active() &&
        !snap.xmit_fresh (now)) {
        radio_service_request_refresh (RadioCmdType::REFRESH_XMIT);
        if (radio_park_request (req, RadioParkKind::GET_XMIT, 0, RADIO_PARK_GET_WAIT_MS, status_get_complete))
            return ESP_OK;  // reply sent later by status_get_complete
    }

    send_status (req, snap);
    return ESP_OK;
}
