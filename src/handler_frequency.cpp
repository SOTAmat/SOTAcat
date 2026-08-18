#include "globals.h"
#include "kx_radio.h"
#include "radio_park_httpd.h"
#include "radio_service.h"
#include "radio_set_http.h"
#include "radio_snapshot.h"
#include "timed_lock.h"
#include "webserver.h"

#include <esp_log.h>
#include <esp_timer.h>
static const char * TAG8 = "sc:hdl_freq";

static void send_frequency (httpd_req_t * req, const RadioSnapshotData & snap) {
    if (!snap.has_frequency()) {
        ESP_LOGE (TAG8, "frequency unavailable");
        http_send_error_json (req, HTTPD_500_INTERNAL_SERVER_ERROR, "frequency unavailable");
        return;
    }
    char buf[16];
    snprintf (buf, sizeof (buf), "%ld", snap.frequency_hz);
    ESP_LOGI (TAG8, "returning frequency: %s", buf);
    http_send_string (req, buf);
}

// Async completer: the refresh finished (or the wait expired) — reply with
// whatever the snapshot holds now. Payload byte-identical to the sync path.
static void frequency_get_complete (httpd_req_t * req, RadioParkOutcome, bool) {
    send_frequency (req, radio_snapshot::get());
}

/**
 * Handles a HTTP GET request to retrieve the current frequency from the radio.
 *
 * Fresh snapshot: reply immediately. Stale/unknown: arm a background refresh
 * and, if the link is up, park the request (up to RADIO_PARK_GET_WAIT_MS)
 * so the reply reflects the refreshed value — the HTTP server task is never
 * blocked. If parking isn't possible, reply with the last-known value.
 *
 * @param req Pointer to the HTTP request structure.
 * @return ESP_OK on successful frequency retrieval and transmission, appropriate error code otherwise.
 */
esp_err_t handler_frequency_get (httpd_req_t * req) {
    showActivity();
    ESP_LOGV (TAG8, "trace: %s()", __func__);

    RadioSnapshotData snap = radio_snapshot::get();
    int64_t           now  = esp_timer_get_time();

    if (snap.frequency_fresh (now)) {
        send_frequency (req, snap);
        return ESP_OK;
    }

    // Skip the refresh-enqueue during FT8 — the radio service does no CAT
    // work while Ft8RadioExclusive is set, so the slot would only churn (and
    // a parked request would just time out); matches handler_status.cpp.
    if (!Ft8RadioExclusive) {
        radio_service_request_refresh (RadioCmdType::REFRESH_FREQUENCY);
        // Only worth waiting when the link is up; when down the refresh is
        // a throttled recovery probe and the stale value is the answer.
        if (radio_service_link_up() &&
            radio_park_request (req, RadioParkKind::GET_FREQUENCY, 0, RADIO_PARK_GET_WAIT_MS,
                                frequency_get_complete))
            return ESP_OK;  // reply sent later by frequency_get_complete
    }

    send_frequency (req, snap);  // last known, or 500 if nothing cached yet
    return snap.has_frequency() ? ESP_OK : ESP_FAIL;
}

/**
 * Handles a HTTP PUT request to set a new frequency on the radio.
 * The desired frequency is specified in the URL query string.
 *
 * @param req Pointer to the HTTP request structure.
 * @return ESP_OK on successful frequency update, appropriate error code otherwise.
 */
esp_err_t handler_frequency_put (httpd_req_t * req) {
    showActivity();

    ESP_LOGV (TAG8, "trace: %s()", __func__);

    STANDARD_DECODE_SOLE_PARAMETER (req, "frequency", param_value)
    long freq = 0;
    if (!parse_long_param (param_value, freq) || freq <= 0)
        REPLY_WITH_FAILURE (req, HTTPD_404_NOT_FOUND, "invalid frequency");
    ESP_LOGI (TAG8, "frequency '%ld'", freq);

    return radio_set_via_http (req, RadioCmdType::SET_FREQUENCY, freq, "frequency change");
}
