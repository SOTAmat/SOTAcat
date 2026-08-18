# Async HTTP Handlers for Radio GET/SET — Design

**Status:** Implemented on `feature/radio-web-decoupling` (commits `450823a`…`8979f10`); mock- and hardware-validated 2026-08-17
**Date:** 2026-08-17
**Builds on:** `feature/radio-web-decoupling` (radio service task, snapshot,
link health, request slots) — see `docs/radio-web-decoupling-overview.md`.
**Supersedes:** the "pure fire-and-forget SET (202)" and "GET returns stale,
never waits" decisions in `2026-05-15-radio-decoupling-design.md` §SET
handlers / §Cache-only GET handlers.

## Problem

The radio-service branch fixed the real bug (a slow/absent radio froze the
single `esp_http_server` task) but paid for it with two contract regressions
that a review on 2026-08-17 identified as blocking:

1. **Reads lag one poll.** `RADIO_SNAPSHOT_FRESH_US` (200 ms) is far below
   the clients' 3 s poll cadence, so every GET returns the *previous* poll's
   value and arms a refresh. Front-panel VFO changes reach the UI in 3–6 s
   instead of ≤3 s; the TX 🔴 indicator lags one poll; and any client that
   does `PUT /frequency` then `GET /frequency` to confirm (SOTAmat can
   read/set frequency and mode) reads the **old** value.
2. **SETs are silently "successful".** `PUT` returns 202 in ~17 ms regardless
   of outcome. A CAT failure, an unsupported mode, or an expired command is
   never reported; the client's optimistic display drifts until a later poll
   corrects it. The original design's "no silent success" goal was dropped
   under hardware pressure, not decided.

Both regressions come from one premise: *a handler must reply before it
returns, so any wait blocks the server task*. That premise is false on the
pinned ESP-IDF (5.x): `httpd_req_async_handler_begin()` detaches a request
from the server task so another actor can complete it later.

## Goal

Restore `main`'s read-your-write and honest-status semantics for the radio
GET/SET endpoints **without** ever blocking the HTTP server task, and
without touching the radio-service worker's ownership model, the FT8 yield,
or the link-health/throttle machinery.

Concretely, when the radio is healthy:

- `GET /frequency|/mode|/connectionStatus` returns a value no older than
  ~`GET_WAIT_MS` (target 300 ms) — i.e. effectively live.
- `PUT /frequency|/mode|/volume|/atu` returns `204` after the radio confirmed
  the change (as `main` did), `500` if the radio refused it, and `202` only
  if confirmation genuinely outran the bound.
- A `PUT` followed immediately by a `GET` returns the new value.

When the radio is dead, off, or held by FT8: every one of those endpoints
still returns within a small bound and the server task never stalls — the
branch's core property is preserved unchanged.

## Non-goals

- Converting `/power`, `/xmit`, `/keyer`, `/msg`, `/time`, `/volume` GET.
  Same mechanism applies later; not in this change. *(Done later the same
  day for all but `/keyer`, which already runs on its own task.)*
- Any client-side change. The web UI already treats 2xx as success and
  polls; SOTAmat gets its read-your-write back without change.
- Changing FT8 behaviour, priorities, or `RADIO_LOCK_TIMEOUT_FT8_MS`.
- Multi-worker HTTP. One server task remains; it just stops waiting.

## Verified facts about the IDF primitive

From `components/esp_http_server/src/httpd_txrx.c`, `httpd_sess.c`,
`httpd_main.c` in the pinned framework (`framework-espidf@3.50500.0`):

- `httpd_req_async_handler_begin(req, &copy)` **mallocs** a deep copy of the
  request (`httpd_req_t` + `aux` + `scratch` up to the current header size +
  `resp_hdrs`), and marks the session `for_async_req = true`. The original
  handler must then `return ESP_OK` without sending.
- While `for_async_req` is set the server task **skips that socket** in its
  select loop and the **LRU purge will not close it**. If async requests are
  never completed, sockets exhaust and `accept` fails. ⇒ *A hard completion
  bound is mandatory, not optional.*
- Response functions (`httpd_resp_set_status/type/send`) may be called on the
  copy from any task; `httpd_req_async_handler_complete(copy)` frees the copy
  and hands the socket back.
- `httpd_queue_work(handle, fn, arg)` runs `fn` **on the server task** via
  its control socket. `CONFIG_HTTPD_QUEUE_WORK_BLOCKING` is unset, so it can
  fail if the control queue is momentarily full; callers must handle that.
- Our dispatch (`webserver.cpp` `find_and_execute_api_handler`) returns the
  handler's result and does not touch `req` afterwards, so a handler may
  detach and return.

## Architecture

```
 HTTP server task                    radio service task            esp_timer task
 ─────────────────                   ──────────────────            ──────────────
 handler:                            drain slot → CAT op           park tick (100 ms,
   snapshot fresh?  ─yes─▶ reply     ┌───────────────────┐         only while table
   else: arm slot,                   │ on op complete:   │         is non-empty)
         async_begin,                │ httpd_queue_work( │         │
         park(kind, gen, deadline)   │   on_op_done, …)  │         │ httpd_queue_work(
   return ESP_OK                     └─────────┬─────────┘         │   on_park_tick)
                                               │                   │
 ┌─────────────────────────────────────────────▼───────────────────▼────┐
 │  Park table — mutated ONLY on the HTTP server task                    │
 │  on_op_done(kind, gen, ok):  complete parked req of that kind         │
 │  on_park_tick():             complete parked reqs past their deadline │
 │  park():                     newcomer supersedes same-kind occupant   │
 └───────────────────────────────────────────────────────────────────────┘
```

Three new pieces; everything else on the branch stays.

### 1. Park table (`src/radio_park.h/.cpp`, pure core host-testable)

A fixed-size table with **at most one parked request per kind**:

| kind | source | wait bound |
|------|--------|-----------|
| `GET_FREQUENCY`, `GET_MODE`, `GET_XMIT` | GET handlers | `GET_WAIT_MS` = 300 |
| `SET_FREQUENCY`, `SET_MODE`, `SET_VOLUME`, `SET_ATU` | PUT handlers | `SET_WAIT_MS` = 1500 |

Entry: `{ httpd_req_t* async; uint32_t gen; int64_t deadline_us; }`.

- **One per kind, newcomer wins.** If a request parks on an occupied kind,
  the occupant is completed *immediately* with the same answer it would have
  received on timeout (GET: current snapshot value; SET: `202 superseded`).
  This bounds the table at 7 entries with no allocation of our own, and it
  is exactly the coalescing semantics the slots already have: the client's
  own newer request made the older one moot.
- **Generation.** Each `radio_service_set()` returns the slot generation it
  armed; the parked SET records it. `on_op_done(kind, gen_applied, ok)`
  completes a parked SET only if `gen_applied >= parked.gen` (a completion
  for an op that started before this request was armed must not satisfy
  it). GETs complete on *any* refresh completion of their kind — a refresh
  that started ≤300 ms before the park is still fresher than the bound.
- **Pure core.** `ParkTable` (park / supersede / on_done / expire) is written
  without IDF types (`void*` handle, `int64_t` clock), like
  `RadioLinkHealth`, so coalescing/generation/timeout rules get red-green
  host tests. A thin IDF shim owns the `httpd_req_t*` and sending.

### 2. Completion actor = the HTTP server task

All table mutation and all response sending happen on the server task,
reached via `httpd_queue_work`. Rationale:

- The radio worker **blocks in CAT for seconds** on a dead radio; it cannot
  be the actor that enforces a 300 ms bound.
- The esp_timer task must not do socket sends (send can block up to
  `send_wait_timeout` = 5 s on a stalled client).
- One actor ⇒ the table needs no lock; the worker and timer only post
  small POD messages.

Two work functions:

- `on_op_done({kind, gen, ok})` — posted by the worker after every
  `do_refresh` / `do_set` (after the radio lock is released, before the next
  op). Completes the parked request of that kind with the outcome (below).
- `on_park_tick()` — posted by a 100 ms periodic `esp_timer` that is started
  when the table becomes non-empty and stopped when it empties (managed on
  the server task, so start/stop are race-free). Completes every entry whose
  `deadline_us` has passed with its timeout answer.

`httpd_queue_work` failure handling: the worker retries once after
`vTaskDelay(1)`; if it still fails it drops the message — the tick will
complete the request at its deadline. The tick itself, if its post fails,
simply fires again 100 ms later. **Nothing can leave a request parked past
`deadline + ~200 ms`.**

### 3. Handler flows

**GET (`frequency`, `mode`, `connectionStatus`'s xmit branch)**

```
snap = radio_snapshot::get()
if fresh(snap)                         → reply value now (sync)          [unchanged]
if link down                           → reply stale value / 500 (sync)  [unchanged]
if Ft8RadioExclusive                   → reply stale value (sync)        [unchanged]
if park table has no room / async_begin fails
                                       → arm refresh, reply stale (sync) [today's path]
else                                   → arm refresh, async_begin,
                                         park(GET_x, gen, now+GET_WAIT), return ESP_OK
```

Completion: `on_op_done` → reply the *now-current* snapshot value (200,
byte-identical payload). Timeout → reply current snapshot value (stale) or
500 if nothing cached. `connectionStatus` composes its glyph from the fresh
xmit state exactly as today.

**PUT (`frequency`, `mode`, `volume`, `atu`)**

```
validate params                        → 404/500 (sync)                  [unchanged]
if link down                           → 503 (sync)                      [unchanged]
if Ft8RadioExclusive                   → 503 "radio busy (FT8)" (sync)   [NEW: honest; today 202-then-dropped]
gen = radio_service_set(type, arg)     (-1 → 503 as today)
if no room / async_begin fails         → 202 (today's path)
else                                   → async_begin, park(SET_x, gen, now+SET_WAIT), return ESP_OK
```

Completion by `on_op_done(gen_applied ≥ gen)`:
`ok` → **204 No Content** (restores `main`'s success contract);
`!ok` → 500 "failed to set …" (as `main`). Timeout → 202 "accepted,
applying" (branch behaviour, now only when confirmation truly outran
1.5 s — e.g. a KX2 band change ≈1.5 s CAT queued behind another op).
Superseded → 202 "superseded".

The mode handler's `SSB` case moves its LSB/USB resolution into the worker
at apply time (from the frequency slot if armed, else the snapshot) so it
can no longer pick a sideband from a frequency the client just replaced.

### Radio-service worker changes (small)

- After each `do_refresh`/`do_set` (lock already released) post
  `on_op_done`. `do_set` returns the applied generation.
- Slots carry a `gen` counter incremented on every arm; the drain copies it.
- Everything else — slot model, FT8 skip, bounded lock acquire, re-arm,
  link-down throttle, WDT resets, deadline expiry — is unchanged. Note that
  with `SET_WAIT_MS` = 1.5 s and `SET_APPLY_DEADLINE_MS` = 5 s, an expired
  SET can never still be parked; expiry only ever affects requests that
  already received a 202.

## HTTP contract after this change

| Case | `main` | branch today | this design |
|------|--------|--------------|-------------|
| GET, radio healthy | live value | value from previous poll | value ≤~300 ms old (live) |
| GET, radio dead / FT8 | 500 after ≤6 s block / cached | stale, instant | stale, ≤300 ms, server never blocks |
| PUT applied | 204 | 202 | **204** |
| PUT refused by radio | 500 | 202 (silent) | **500** |
| PUT slower than bound | 500 after timeout | 202 | 202 |
| PUT superseded by newer same-type PUT | n/a (serialized) | 202 | 202 |
| PUT, link down | block then 5xx | 503 instant | 503 instant |
| PUT during FT8 | 5xx "radio busy" | 202 then dropped | **503 "radio busy (FT8)"** |
| PUT then immediate GET | new value | **old value** | new value |

Only the "PUT during FT8" row changes relative to `main`'s *intent*, and it
becomes more honest, not less. `docs/dev/Web-UI.md` / API docs get this
table.

## Concurrency model (summary)

- Radio mutex: worker (plus FT8 and the keyer task) — unchanged.
- Snapshot mutex: leaf — unchanged.
- Slot mutex (`s_req_mutex`): unchanged; slots gain a `gen`.
- Park table: **no lock** — server-task-only. Worker and timer communicate
  through `httpd_queue_work` messages (POD by value; static ring of ≤16
  message structs since `httpd_queue_work` takes a pointer — the worker
  posts at most one message per op and ops are serialized, the timer at most
  one per tick; both mark a message free once consumed).
- Sends happen on the server task, so a stalled client can delay other
  requests by at most `send_wait_timeout` — identical to today for every
  synchronous reply.

## Resource budget

- **Sockets.** `max_open_sockets` = 12. Worst-case parked = 7 (one per
  kind); typical = 2–3 (freq+mode GET, occasionally xmit or one SET).
  Recommend `max_open_sockets` 12 → 16 (each unused slot is a few dozen
  bytes; an open one ~1 KB) so a browser's 6 parallel asset fetches never
  compete with parked requests. To be measured, not assumed.
- **Heap.** `httpd_req_async_handler_begin` allocates ≈ `sizeof(httpd_req_t)`
  + `aux` + scratch (≤ header bytes actually received, ≤512) + `resp_hdrs`
  ≈ 1–2 KB per parked request, freed on complete (≤300–1500 ms later).
  Worst case ≈14 KB transient. This project has a heap-fragmentation
  history; the small, short-lived, uniform-size pattern is benign, but log
  `heap_caps_get_largest_free_block()` before/after in the stress test and
  set the park cap (`RADIO_PARK_MAX`, default 7) lower if it moves.
- **CPU.** One 100 ms timer only while something is parked; zero when idle.
  No new task.

## Failure modes and answers

| Failure | Consequence | Mitigation |
|---------|-------------|-----------|
| `async_begin` returns error (OOM) | request would hang | fall back to synchronous stale/202 reply (today's path) |
| `httpd_queue_work` fails | completion delayed | retry once, then rely on tick; tick re-fires every 100 ms |
| Worker wedged (dead radio, FT8) | parked reqs never see `on_op_done` | tick completes at deadline; server task unaffected |
| Client disconnects while parked | send fails on complete | `httpd_resp_send` errors are ignored; `async_handler_complete` still frees |
| Server restarted with entries parked | leaked copies | not applicable today (server never restarts at runtime); if it ever does, `radio_park_drain_all()` before `httpd_stop` |
| Two clients park the same GET kind | second supersedes first | first gets the current snapshot value immediately (same as its timeout answer) |

## Testing

- **Host (pure):** `ParkTable` — park/supersede semantics, generation gating
  (`gen_applied < parked.gen` must not complete), deadline expiry ordering,
  cap enforcement, "table empty ⇒ timer stop" transitions.
- **Mock server (`test/mock_server/server.py`):** add `--radio-latency MS`
  and `--radio-dead` modes so `test/integration/test_mutex_stress.py` can
  assert, without hardware: (a) `PUT` then immediate `GET` returns the new
  value; (b) `PUT` returns 204 with a healthy mock and 500 with a refusing
  mock; (c) with `--radio-dead`, GET returns within `GET_WAIT_MS + 200`
  and `/version` p95 stays < 200 ms while radio endpoints are hammered by
  50 parallel clients (exercises the "no room → sync fallback" path and
  proves no socket exhaustion); (d) parked count never exceeds the cap.
- **Hardware checklist:** the four items in
  `docs/for-AI-agents/radio-service-ft8-mutex-contention.md` (FT8 overlap,
  timing, post-FT8 refresh, PUT during FT8 → now expect 503), plus: turn
  the VFO knob → phone updates within one poll; Chase "tune" → 204/204 and
  Run page shows new frequency on the next poll; radio off mid-session →
  GETs answer in ≤~400 ms, PUTs 503 after link-down, QRT SMS usable.

## Implementation phasing (commits on the same branch)

1. `feat: pure ParkTable + host tests` (no IDF deps).
2. `feat: park shim — async_begin/complete, queue_work messages, tick timer`.
3. `feat: worker posts on_op_done; slots carry generation`.
4. `feat: GET handlers park on stale snapshot` (freq, mode, connectionStatus).
5. `feat: PUT handlers park; restore 204/500; 503 during FT8`.
6. `fix: resolve SSB sideband at apply time in the worker`.
7. `test: mock-server radio-latency/dead modes + read-your-write assertions`.
8. `docs: API contract table; update overview §4/§6`.

Steps 1–3 are inert (nothing parks yet) and can land first for review.

## Open questions

- `SET_WAIT_MS` = 1500 vs 800 from the original spec: 800 would return 202
  on most KX2 band changes (~1.5 s CAT). Parked sockets cost nothing on the
  server task, so the longer bound seems free; confirm the client's
  2 s post-action poll suppression still comfortably covers it (yes on
  paper — verify on hardware).
- Should a GET that parks *also* count as "client active" for a keep-warm
  refresh cadence? With parking, keep-warm is no longer needed for latency;
  leaving it out preserves the on-demand/battery goal. Revisit only if
  300 ms waits show up as UI jank.
- Convert `/power` in this series or the next? Run's max-power toggle uses
  it; it is one more `SET_POWER` kind (already in the enum) — cheap, but
  keeps this change focused if deferred.
