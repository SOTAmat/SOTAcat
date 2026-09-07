#pragma once
// HTTP glue between the radio service and the REST handlers, for both
// directions: SETs enqueue and park; GETs serve cached values through the
// snapshot/refresh/park dance.
//
// SET side: enqueue the op on the radio service,
// park the request, and reply with the honest outcome, without ever
// blocking the HTTP server task. See docs/dev/Radio-Access.md.
//
//   FT8 active                 → 503 "radio busy (FT8)"        (sync; not enqueued)
//   link down / service absent → 503 "radio link down"         (sync)
//   parked, radio applied it   → 204 No Content                (as `main`)
//   parked, radio refused it   → 500 "<what> failed"           (as `main`)
//   parked, wait bound passed  → 202 "<what> accepted, applying"
//   superseded by a newer SET  → 202 "<what> superseded"
//   cannot park (cap/OOM)      → 202 "<what> accepted, applying" (sync)
//
// Callers validate parameters first (404/500 as before), then `return`
// this function's result.
#include "radio_service.h"

#include <esp_http_server.h>

esp_err_t radio_set_via_http (httpd_req_t * req, RadioCmdType type, long arg, const char * what);

// HTTP glue for radio GET handlers serving cached values: the snapshot/
// refresh/park dance shared by frequency, mode, volume and power (dispatch
// order in include/radio_get_gate.h). `send_now` writes the payload from
// the snapshot; `completer` is the park completion callback. `fresh` and
// `has_value` come from the field's own snapshot predicates.
#include "radio_park_httpd.h"
#include "radio_snapshot.h"

typedef void (*radio_get_sender_t) (httpd_req_t *, const RadioSnapshotData &);

esp_err_t radio_get_via_http (httpd_req_t * req, RadioCmdType refresh, RadioParkKind kind, const RadioSnapshotData & snap, bool fresh, bool has_value, radio_get_sender_t send_now, radio_park_completer_t completer);
