#include "radio_set_http.h"

#include "globals.h"
#include "kx_radio.h"
#include "radio_set_gate.h"
#include "radio_park_httpd.h"
#include "webserver.h"

#include <cstdio>

#include <esp_log.h>
static const char * TAG8 = "sc:radioset";

// Human label for the parked SET of each kind, for reply/log messages. Set
// at park time on the server task; one parked request per kind, and the
// superseded occupant is completed inside radio_park_request() — i.e.
// BEFORE we overwrite its label below — so it still sees its own.
static const char * s_what[RADIO_PARK_KINDS] = {};

static const char * what_of (RadioParkKind kind) {
    const char * w = s_what[(int)kind];
    return w ? w : "radio command";
}

// Async completer (server task). The shim's completer signature carries no
// user argument, so instantiate one thin wrapper per kind — each knows its
// kind statically and fetches its label from s_what.
template <RadioParkKind K>
static void set_complete_k (httpd_req_t * req, RadioParkOutcome outcome, bool ok) {
    const char * what = what_of (K);
    char         msg[96];
    switch (outcome) {
    case RadioParkOutcome::DONE:
        if (ok) {
            ESP_LOGI (TAG8, "%s applied", what);
            http_send_no_content (req);
        }
        else {
            snprintf (msg, sizeof (msg), "%s failed", what);
            ESP_LOGE (TAG8, "%s", msg);
            http_send_error_json (req, HTTPD_500_INTERNAL_SERVER_ERROR, msg);
        }
        break;
    case RadioParkOutcome::SUPERSEDED:
        snprintf (msg, sizeof (msg), "%s superseded", what);
        ESP_LOGI (TAG8, "%s", msg);
        http_send_accepted (req, msg);
        break;
    case RadioParkOutcome::TIMEOUT:
    case RadioParkOutcome::DRAINED:
    default:
        snprintf (msg, sizeof (msg), "%s accepted, applying", what);
        ESP_LOGI (TAG8, "%s (no confirmation within wait bound)", msg);
        http_send_accepted (req, msg);
        break;
    }
}

static radio_park_completer_t completer_for (RadioParkKind kind) {
    switch (kind) {
    case RadioParkKind::SET_FREQUENCY: return set_complete_k<RadioParkKind::SET_FREQUENCY>;
    case RadioParkKind::SET_MODE: return set_complete_k<RadioParkKind::SET_MODE>;
    case RadioParkKind::SET_VOLUME: return set_complete_k<RadioParkKind::SET_VOLUME>;
    case RadioParkKind::SET_ATU: return set_complete_k<RadioParkKind::SET_ATU>;
    case RadioParkKind::SET_POWER: return set_complete_k<RadioParkKind::SET_POWER>;
    case RadioParkKind::SET_XMIT: return set_complete_k<RadioParkKind::SET_XMIT>;
    case RadioParkKind::SET_MSG: return set_complete_k<RadioParkKind::SET_MSG>;
    case RadioParkKind::SET_TIME: return set_complete_k<RadioParkKind::SET_TIME>;
    default: return nullptr;
    }
}

esp_err_t radio_set_via_http (httpd_req_t * req, RadioCmdType type, long arg, const char * what) {
    char msg[96];

    // FT8 and the CW keyer each own the radio for a whole transmission and
    // the service can do no CAT work meanwhile; a SET would only sit until
    // it expired. Say so now.
    RadioSetRefusal refusal = radio_set_refusal (Ft8RadioExclusive, kxRadio.is_keyer_active());
    if (refusal != RadioSetRefusal::NONE) {
        const char * reason = radio_set_refusal_message (refusal);
        ESP_LOGW (TAG8, "%s refused: %s", what, reason);
        http_send_service_unavailable (req, reason);
        return ESP_FAIL;
    }

    uint32_t gen = 0;
    if (radio_service_set (type, arg, &gen) < 0) {
        ESP_LOGE (TAG8, "%s refused: radio link down", what);
        http_send_service_unavailable (req, "radio link down");
        return ESP_FAIL;
    }

    RadioParkKind kind;
    if (radio_service_park_kind (type, kind)) {
        radio_park_completer_t fn = completer_for (kind);
        if (fn && radio_park_request (req, kind, gen, RADIO_PARK_SET_WAIT_MS, fn)) {
            s_what[(int)kind] = what;  // after park: the superseded occupant kept its own label
            return ESP_OK;             // reply sent later by the completer
        }
    }

    // Enqueued but could not park (kind not parkable, table at cap, OOM):
    // fire-and-forget as before; the client confirms via a later GET.
    snprintf (msg, sizeof (msg), "%s accepted, applying", what);
    ESP_LOGI (TAG8, "%s (not parked)", msg);
    http_send_accepted (req, msg);
    return ESP_OK;
}
