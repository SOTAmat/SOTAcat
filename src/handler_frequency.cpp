#include "globals.h"
#include "kx_radio.h"
#include "radio_service.h"
#include "radio_snapshot.h"
#include "timed_lock.h"
#include "webserver.h"

#include <esp_log.h>
#include <esp_timer.h>
static const char * TAG8 = "sc:hdl_freq";

/**
 * Handles a HTTP GET request to retrieve the current frequency from the radio.
 *
 * @param req Pointer to the HTTP request structure.
 * @return ESP_OK on successful frequency retrieval and transmission, appropriate error code otherwise.
 */
esp_err_t handler_frequency_get (httpd_req_t * req) {
    showActivity();
    ESP_LOGV (TAG8, "trace: %s()", __func__);

    RadioSnapshotData snap = radio_snapshot::get();
    int64_t           now  = esp_timer_get_time();

    if (!snap.has_frequency()) {
        // Nothing known yet (cold start / radio never present).
        // Skip the refresh-enqueue during FT8 — the radio service does no
        // CAT work while Ft8RadioExclusive is set, so the slot would only
        // churn; matches handler_status.cpp's FT8 guard.
        if (!Ft8RadioExclusive)
            radio_service_request_refresh (RadioCmdType::REFRESH_FREQUENCY);
        REPLY_WITH_FAILURE (req, HTTPD_500_INTERNAL_SERVER_ERROR, "frequency unavailable");
    }

    if (!snap.frequency_fresh (now) && !Ft8RadioExclusive)
        radio_service_request_refresh (RadioCmdType::REFRESH_FREQUENCY);

    char buf[16];
    snprintf (buf, sizeof (buf), "%ld", snap.frequency_hz);
    REPLY_WITH_STRING (req, buf, "frequency");
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
    int freq = atoi (param_value);  // Convert the parameter to an integer
    ESP_LOGI (TAG8, "frequency '%d'", freq);
    if (freq <= 0)
        REPLY_WITH_FAILURE (req, HTTPD_404_NOT_FOUND, "invalid frequency");

    int rc = radio_service_set (RadioCmdType::SET_FREQUENCY, freq);
    if (rc < 0)
        REPLY_WITH_SERVICE_UNAVAILABLE (req, "radio link down");

    REPLY_WITH_ACCEPTED (req, "frequency change accepted, applying");
}
