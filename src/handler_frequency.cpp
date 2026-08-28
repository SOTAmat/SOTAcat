#include "globals.h"
#include "radio_park_httpd.h"
#include "radio_service.h"
#include "radio_http.h"
#include "radio_snapshot.h"
#include "webserver.h"

#include <esp_timer.h>

#include <esp_log.h>
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

// Async completer: the refresh finished (or the wait expired). Reply with
// whatever the snapshot holds now. Payload byte-identical to the sync path.
static void frequency_get_complete (httpd_req_t * req, RadioParkOutcome, bool) {
    send_frequency (req, radio_snapshot::get());
}

/**
 * Handles a HTTP GET request to retrieve the current frequency from the radio.
 *
 * Fresh snapshot: reply immediately. Stale/unknown: arm a background refresh
 * and, if the link is up, park the request (up to RADIO_PARK_GET_WAIT_MS)
 * so the reply reflects the refreshed value. The HTTP server task is never
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
    return radio_get_via_http (req, RadioCmdType::REFRESH_FREQUENCY, RadioParkKind::GET_FREQUENCY, snap, snap.frequency_fresh (now), snap.has_frequency(), send_frequency, frequency_get_complete);
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
