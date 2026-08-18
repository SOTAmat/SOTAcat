#include "globals.h"
#include "kx_radio.h"
#include "radio_park_httpd.h"
#include "radio_service.h"
#include "radio_set_http.h"
#include "radio_snapshot.h"
#include "webserver.h"

#include <esp_log.h>
#include <esp_timer.h>
static const char * TAG8 = "sc:hdl_vol.";

/**
 * Handles an HTTP GET request to retrieve the current audio gain (volume).
 *
 * This function retrieves the current AF gain level from the radio
 * using the AG command. The value is returned as plain text (0-255).
 *
 * @param req Pointer to the HTTP request structure.
 */
static void send_volume (httpd_req_t * req, const RadioSnapshotData & snap) {
    if (!snap.has_volume()) {
        ESP_LOGE (TAG8, "unable to read volume");
        http_send_error_json (req, HTTPD_500_INTERNAL_SERVER_ERROR, "unable to read volume");
        return;
    }
    char buf[16];
    snprintf (buf, sizeof (buf), "%ld", snap.volume);
    ESP_LOGI (TAG8, "returning volume: %s", buf);
    http_send_string (req, buf);
}

static void volume_get_complete (httpd_req_t * req, RadioParkOutcome, bool) {
    send_volume (req, radio_snapshot::get());
}

esp_err_t handler_volume_get (httpd_req_t * req) {
    showActivity();
    ESP_LOGV (TAG8, "trace: %s()", __func__);

    if (!kxRadio.supports_volume())
        REPLY_WITH_FAILURE (req, HTTPD_404_NOT_FOUND, "volume not supported on this radio");

    RadioSnapshotData snap = radio_snapshot::get();
    int64_t           now  = esp_timer_get_time();
    if (snap.volume_fresh (now)) {
        send_volume (req, snap);
        return ESP_OK;
    }
    if (!Ft8RadioExclusive) {
        radio_service_request_refresh (RadioCmdType::REFRESH_VOLUME);
        if (!radio_service_link_up())
            REPLY_WITH_SERVICE_UNAVAILABLE (req, "radio link down");  // see handler_frequency_get
        if (radio_park_request (req, RadioParkKind::GET_VOLUME, 0, RADIO_PARK_GET_WAIT_MS, volume_get_complete))
            return ESP_OK;
    }
    send_volume (req, snap);
    return snap.has_volume() ? ESP_OK : ESP_FAIL;
}

/**
 * Handles an HTTP PUT request to adjust the audio gain (volume).
 *
 * This function adjusts the AF gain level on the radio by a delta value.
 * It reads the current volume, applies the delta (scaled and clamped by the
 * radio driver), and writes back.
 *
 * @param req Pointer to the HTTP request structure. The "delta" query parameter
 *            specifies the amount to adjust (positive or negative).
 */
esp_err_t handler_volume_put (httpd_req_t * req) {
    showActivity();

    ESP_LOGV (TAG8, "trace: %s()", __func__);

    STANDARD_DECODE_SOLE_PARAMETER (req, "delta", param_value);
    ESP_LOGI (TAG8, "adjusting volume by delta '%s'", param_value);

    long delta = 0;
    if (!parse_long_param (param_value, delta))
        REPLY_WITH_FAILURE (req, HTTPD_404_NOT_FOUND, "invalid delta");

    if (!kxRadio.supports_volume())
        REPLY_WITH_FAILURE (req, HTTPD_404_NOT_FOUND, "volume not supported on this radio");

    return radio_set_via_http (req, RadioCmdType::SET_VOLUME, delta, "volume change");
}
