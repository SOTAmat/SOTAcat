#include "globals.h"
#include "kx_radio.h"
#include "radio_park_httpd.h"
#include "radio_service.h"
#include "radio_set_http.h"
#include "radio_snapshot.h"
#include "webserver.h"

#include <cctype>
#include <esp_timer.h>

#include <esp_log.h>
static const char * TAG8 = "sc:hdl_mode";

static void send_mode (httpd_req_t * req, const RadioSnapshotData & snap) {
    // 0 == MODE_UNKNOWN -> "UNKNOWN", as before; nullptr covers both
    // out-of-range values and the enum gap at 8 (CR-01).
    char const * name = radio_mode_name (snap.mode);
    if (!name) {
        ESP_LOGE (TAG8, "unrecognized mode");
        http_send_error_json (req, HTTPD_500_INTERNAL_SERVER_ERROR, "unrecognized mode");
        return;
    }
    ESP_LOGI (TAG8, "returning mode: %s", name);
    http_send_string (req, name);
}

// Async completer: the refresh finished (or the wait expired) — reply with
// whatever the snapshot holds now. Payload byte-identical to the sync path.
static void mode_get_complete (httpd_req_t * req, RadioParkOutcome, bool) {
    send_mode (req, radio_snapshot::get());
}

/**
 * Handles an HTTP GET request to retrieve the current operating mode of the radio.
 *
 * Fresh snapshot: reply immediately. Stale/unknown: arm a background refresh
 * and, if the link is up, park the request (up to RADIO_PARK_GET_WAIT_MS)
 * so the reply reflects the refreshed value — the HTTP server task is never
 * blocked. If parking isn't possible, reply with the last-known value.
 *
 * @param req Pointer to the HTTP request structure.
 * @return ESP_OK if the mode is successfully retrieved and sent; otherwise, an error code.
 */
esp_err_t handler_mode_get (httpd_req_t * req) {
    showActivity();
    ESP_LOGV (TAG8, "trace: %s()", __func__);

    RadioSnapshotData snap = radio_snapshot::get();
    int64_t           now  = esp_timer_get_time();

    if (snap.mode_fresh (now)) {
        send_mode (req, snap);
        return ESP_OK;
    }

    // See handler_frequency_get for the FT8 / link-up reasoning.
    if (!Ft8RadioExclusive) {
        radio_service_request_refresh (RadioCmdType::REFRESH_MODE);  // also the recovery probe when down
        if (!radio_service_link_up())
            REPLY_WITH_SERVICE_UNAVAILABLE (req, "radio link down");  // see handler_frequency_get
        if (radio_park_request (req, RadioParkKind::GET_MODE, 0, RADIO_PARK_GET_WAIT_MS, mode_get_complete))
            return ESP_OK;  // reply sent later by mode_get_complete
    }

    send_mode (req, snap);  // FT8 / no room: last known, or "UNKNOWN"
    return ESP_OK;
}

/**
 * Handles an HTTP PUT request to set the radio operating mode.
 * Parses the 'mode' parameter from the HTTP request and adjusts the radio mode accordingly.
 * @param req Pointer to the HTTP request structure.
 * @return ESP_OK if the mode is successfully set; otherwise, an error code.
 */
esp_err_t handler_mode_put (httpd_req_t * req) {
    showActivity();

    ESP_LOGV (TAG8, "trace: %s()", __func__);

    STANDARD_DECODE_SOLE_PARAMETER (req, "mode", mode_param);

    // Normalize to uppercase in-place for case-insensitive matching
    for (char * p = mode_param; *p; ++p)
        *p = static_cast<char> (std::toupper (static_cast<unsigned char> (*p)));

    ESP_LOGI (TAG8, "requesting mode = '%s'", mode_param);

    // "SSB" is resolved to LSB/USB by the radio service at apply time
    // (RADIO_MODE_SSB_AUTO), after any frequency SET queued ahead of it.
    if (!strcmp (mode_param, "SSB")) {
        ESP_LOGI (TAG8, "mode = SSB (sideband chosen at apply time)");
        return radio_set_via_http (req, RadioCmdType::SET_MODE, RADIO_MODE_SSB_AUTO, "mode change");
    }

    radio_mode_t mode = radio_mode_from_name (mode_param);

    // Respond with an error if the mode is not recognized
    if (mode == MODE_UNKNOWN)
        REPLY_WITH_FAILURE (req, HTTPD_404_NOT_FOUND, "invalid mode");

    ESP_LOGI (TAG8, "mode = '%s'", radio_mode_name (mode));
    return radio_set_via_http (req, RadioCmdType::SET_MODE, (long)mode, "mode change");
}
