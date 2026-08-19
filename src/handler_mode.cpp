#include "globals.h"
#include "kx_radio.h"
#include "radio_park_httpd.h"
#include "radio_service.h"
#include "radio_set_http.h"
#include "radio_snapshot.h"
#include "webserver.h"

#include <cassert>
#include <cctype>
#include <esp_timer.h>

#include <esp_log.h>
static const char * TAG8 = "sc:hdl_mode";

// Struct to map radio mode names to their corresponding radio_mode_t enum values
typedef struct {
    char const * const name;  // Name of the radio mode as a string
    radio_mode_t       mode;  // Corresponding value from the radio_mode_t enumeration
} radio_mode_map_t;

// Array of radio mode mappings, ordered to match the radio_mode_t enumeration
static const radio_mode_map_t radio_mode_map[] = {
    {"UNKNOWN", MODE_UNKNOWN}, //  MODE_UNKNOWN = 0,
    {"LSB",     MODE_LSB    }, //  MODE_LSB     = 1,
    {"USB",     MODE_USB    }, //  MODE_USB     = 2,
    {"CW",      MODE_CW     }, //  MODE_CW      = 3,
    {"FM",      MODE_FM     }, //  MODE_FM      = 4,
    {"AM",      MODE_AM     }, //  MODE_AM      = 5,
    {"DATA",    MODE_DATA   }, //  MODE_DATA    = 6,
    {"CW_R",    MODE_CW_R   }, //  MODE_CW_R    = 7,
    {"DATA_R",  MODE_DATA_R }, //  MODE_DATA_R  = 9,

    // Aliases for "DATA":
    {"FT8",     MODE_DATA   },
    {"JS8",     MODE_DATA   },
    {"PK31",    MODE_DATA   },
    {"FT4",     MODE_DATA   },
    {"RTTY",    MODE_DATA   },
};

static void send_mode (httpd_req_t * req, const RadioSnapshotData & snap) {
    long mode = snap.mode;  // 0 == MODE_UNKNOWN -> "UNKNOWN", as before
    if (mode < MODE_UNKNOWN || mode > MODE_LAST) {
        ESP_LOGE (TAG8, "unrecognized mode");
        http_send_error_json (req, HTTPD_500_INTERNAL_SERVER_ERROR, "unrecognized mode");
        return;
    }
    assert (radio_mode_map[mode].mode == mode);
    ESP_LOGI (TAG8, "returning mode: %s", radio_mode_map[mode].name);
    http_send_string (req, radio_mode_map[mode].name);
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

    radio_mode_t mode = MODE_UNKNOWN;
#define COUNTOF(array) (sizeof (array) / sizeof (array[0]))
    // Iterate through the radio_mode_map to find a matching mode
    for (radio_mode_map_t const * mode_kv = &radio_mode_map[COUNTOF (radio_mode_map) - 1];
         mode_kv >= &radio_mode_map[0];
         --mode_kv)
        if (!strcmp (mode_param, mode_kv->name)) {
            mode = mode_kv->mode;
            break;
        }

    // Respond with an error if the mode is not recognized
    if (mode == MODE_UNKNOWN)
        REPLY_WITH_FAILURE (req, HTTPD_404_NOT_FOUND, "invalid mode");

    ESP_LOGI (TAG8, "mode = '%s'", radio_mode_map[mode].name);
    return radio_set_via_http (req, RadioCmdType::SET_MODE, (long)mode, "mode change");
}
