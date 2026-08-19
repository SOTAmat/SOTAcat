#pragma once
// HTTP glue for radio SET handlers: enqueue the op on the radio service,
// park the request, and reply with the honest outcome — without ever
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
