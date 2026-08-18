#pragma once
// ESP-IDF shim around RadioParkTable: detaches an httpd request from the
// server task (httpd_req_async_handler_begin), parks it, and completes it
// later — when the radio service finishes the matching op, or when its
// deadline passes. See 2026-08-17-radio-async-handlers-design.md.
//
// Threading contract:
//   * radio_park_init / radio_park_request / radio_park_set_completer run on
//     the HTTP server task (from start_webserver / URI handlers).
//   * radio_park_notify_done may be called from ANY task (the radio service
//     worker); it only posts a message via httpd_queue_work.
//   * All table mutation and all response sending happen on the server task.
#include "radio_park.h"

#include <esp_http_server.h>

// How long a parked request waits before it is completed with its timeout
// answer. GETs: enough for a healthy CAT read (~50-100 ms) with margin.
// SETs: covers a KX2 band change (~1.5 s of CAT); parked sockets cost the
// server task nothing, so the longer bound is free.
static constexpr uint32_t RADIO_PARK_GET_WAIT_MS = 300;
static constexpr uint32_t RADIO_PARK_SET_WAIT_MS = 1500;
// Deadline sweep cadence while anything is parked (timer stops when empty).
static constexpr uint32_t RADIO_PARK_TICK_MS = 100;
// Occupancy cap (<= RADIO_PARK_KINDS). Each parked request holds one httpd
// socket and ~1-2 KB of heap (IDF's request copy) until completed.
static constexpr int RADIO_PARK_MAX = RADIO_PARK_KINDS;

enum class RadioParkOutcome {
    DONE,        // matching op finished; `ok` says whether it succeeded
    TIMEOUT,     // deadline passed with no matching completion
    SUPERSEDED,  // a newer request of the same kind parked; reply as timeout
    DRAINED,     // table drained (server shutting down)
};

// A completer sends the reply for a parked request of one kind. It runs on
// the server task with the async request copy; it MUST send a response
// (httpd_resp_send / _err) and MUST NOT call httpd_req_async_handler_complete
// — the shim does that. `ok` is meaningful only for DONE.
typedef void (*radio_park_completer_t) (httpd_req_t * req, RadioParkOutcome outcome, bool ok);

// Call once after httpd_start(), on the server task. Idempotent.
void radio_park_init (httpd_handle_t server);

// From a URI handler (server task): detach `req` and park it; `completer`
// will send its reply later. On success the handler MUST return ESP_OK
// without sending anything. Returns false if parking is not possible (shim
// not initialised, table at cap, async_begin failed) — the handler then
// replies synchronously as before. `gen` is the slot generation returned
// by radio_service_set() (0 for GET kinds).
bool radio_park_request (httpd_req_t * req, RadioParkKind kind, uint32_t gen, uint32_t wait_ms,
                         radio_park_completer_t completer);

// From any task: an op of `kind` finished with generation `gen` and result
// `ok`. Posts to the server task; never blocks on the network. If the post
// fails after one retry the message is dropped — the deadline tick still
// completes the request.
void radio_park_notify_done (RadioParkKind kind, uint32_t gen, bool ok);

// Number of currently parked requests (server task only; diagnostics).
int radio_park_count();
