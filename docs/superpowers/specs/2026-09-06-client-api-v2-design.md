# Client-Facing API v2: State Document, Operations, Events — Design

**Status:** Proposed; not implemented. Written from a survey of the current
contract and of the third-party clients that consume it (see §Evidence).
**Date:** 2026-09-06
**Builds on:** `2026-05-15-radio-decoupling-design.md` (radio service task,
snapshot, link health) and `2026-08-17-radio-async-handlers-design.md`
(parked handlers, honest 204/202/500/503). Current mechanism:
`docs/dev/Radio-Access.md`.
**Does not change:** `/api/v1/*`. Every v1 route keeps its status codes,
bodies, and query-string parameters. v1 is the compatibility facade for the
clients listed below and is frozen by this document.

## Problem

The decoupling work gave SOTAcat an honest radio service with generations,
parking, supersede semantics, and link health. The HTTP contract in front of it
still looks like the 2024 API: one scalar per route, values in the query
string, plain text here and JSON there, and no way for a client to learn what
happened after the reply. Every consumer has therefore rebuilt the same
machinery on its side, and each has built it slightly wrong in a way the
contract forced.

### Evidence

Surveyed on 2026-09-06. Commits named so the survey can be rechecked.

| Client | Version surveyed | Reads | Writes | Poll | Connection heuristic |
|---|---|---|---|---|---|
| SOTAcat web UI | `main` 9b66772 | frequency, mode, connectionStatus, batteryInfo, rssi, version | frequency, mode, keyer, xmit, atu, time, settings | 3 s VFO, 2 s status, 60 s battery | connectionStatus glyph |
| SOTAmat | eb57611 (2026-09-06) | frequency, mode | frequency, mode, prepareft8, ft8, cancelft8 | 1 s, 3 s when flaky | GET frequency must parse > 0 |
| SOTALog 1.7 | cdf8f28 (2026-06-01) | frequency, mode, version | frequency, mode, keyer | 1 s connected, 5 s probing | GET version must be 200; N failures then re-probe |
| PoLo (pounce branch) | 3a9a28c4, unmerged | none | frequency, mode | none | none |
| PoLo upstream | 778b3ce9 (2026-07-06) | none | none | none | receives deep links from SOTAcat |
| HaLo | no public source | unknown | unknown | unknown | unknown |

What the survey shows:

1. **Every client treats any 2xx as success.** SOTAmat checks
   `IsSuccessStatusCode`; SOTALog checks `200...299`; PoLo and the web UI check
   `response.ok`. A 202 "accepted, applying" and a 202 "superseded" are
   indistinguishable from 204 to all of them. The message body is never read.
2. **Every tune is two racing PUTs.** SOTAmat, SOTALog, PoLo, and the web UI's
   chase page all send `PUT frequency` then `PUT mode`. A concurrent reader
   sees the new frequency with the old mode. No client can express "tune to
   this spot" atomically.
3. **Every poller is a re-implementation of the event stream.** Three
   independent 1 s loops (SOTAmat, SOTALog, the web UI at 3 s) each fetch two
   scalars. The web UI suppresses its own poller for 2 s after a user action
   so it does not read back a stale value. PoLo cannot poll at all, so
   SOTAcat pushes `/vfo` deep links into it; that is a push channel built in
   the wrong direction because no pull channel existed.
4. **Long-running work is invisible after the reply.** Keyer, FT8 transmit,
   ATU tune, and OTA reply 204 as soon as the task starts. SOTALog sets a
   `keyerActive` flag for the duration of its PUT and suspends polling while
   keying; because the 204 returns immediately, the flag clears at once and
   polling resumes during the transmission. The client wanted an operation
   with a lifetime and got a queue acknowledgement.
5. **Device health and radio health are conflated.** SOTAmat's reachability
   probe is `GET frequency`; SOTALog's poll requires `200` on `GET frequency`.
   Since 2026-08-17 a dead radio answers `503 radio link down`, which both
   apps read as a dead or flaky SOTAcat.
6. **There is no machine-readable contract.** SOTALog reverse-engineered its
   own reference (`reference/SOTAcat-API.md` in their repo, from a February
   2026 firmware, before 202 and link-down existed) and notes "No OpenAPI
   specification exists upstream" and that error bodies are JSON served as
   `text/plain`.
7. **A browser-hosted client cannot call SOTAcat at all.** The server sets no
   `Access-Control-*` headers and registers no `OPTIONS` handler (verified by
   grep over `src/` and `include/`). Any page not served by SOTAcat itself is
   blocked by the browser before the request leaves. HaLo, Ham2K's successor
   to PoLo, targets the web browser as a platform and is described as built
   for CAT control; a TCP `rigctld` port is unreachable from a page, so HTTP
   is the only integration a browser-hosted logger could use.
8. **Three error shapes.** `{"error"}` on 4xx/5xx, `{"message"}` on 202, and
   plain text for `frequency` and `mode` values.

### What is already right

The parked async handlers, the honest 503 with a reason, the generation and
supersede model in the radio service, the link-health hysteresis, and the
capability-gated UI are the foundation this design builds on. None of them
change.

## Goal

Give third-party clients a contract they can consume without rebuilding
SOTAcat's internals, and give SOTAcat's own UI the same contract so it stops
carrying poll-suppression hacks:

- One JSON state document for the radio, with freshness, patchable in one
  request.
- Operations with a lifetime for keyer, FT8, ATU tune, and OTA.
- One push channel that replaces every poll loop.
- One error shape.
- A device health resource distinct from radio health.
- A published, machine-readable contract, discoverable from mDNS.
- CORS so a browser-hosted client can participate.

## Non-goals

- Changing or removing any `/api/v1` route. SOTAmat and SOTALog ship against
  it and are not ours to update.
- Authentication. SOTAcat runs on a private AP or a hotspot; the threat model
  has not changed.
- WebSockets for the v2 event stream. SSE meets the need with one chunked
  GET on the server already running; see §Why SSE. This non-goal is
  conditional on the TCI open question below, since a TCI facade would need
  a WebSocket server regardless.
- The `rigctld` facade on `feature/rigctld-server`. It is a separate audience
  (hamlib desktop apps) and is discussed only where its service-layer work
  is a prerequisite here.
- Touching the radio-service worker's ownership model, the FT8 yield, or
  FT8 timing. FT8 timing outranks everything in this document.

## Architecture

SOTAcat has one radio service and, after this design, three presentations of
it: the frozen v1 routes, the v2 routes, and (if merged) rigctld. The contract
that matters is the service's: generations, park, supersede, refresh, link
health. v2 is a thin presentation of that contract, not a new state machine.

```
browser UI / SOTALog / PoLo / HaLo          SOTAmat / SOTALog (today)
            │  JSON, SSE, CORS                        │  plain text, query PUTs
            ▼                                         ▼
      /api/v2/*  (this design)                  /api/v1/*  (frozen)
            │                                         │
            └──────────────┬──────────────────────────┘
                           ▼
                   radio service task
          (generations, park table, snapshot, health)
                           │
                           ▼
                        radio driver
```

Three additions are needed below the HTTP layer before v2 can be honest. They
are listed under §Service prerequisites and are the first phase.

## v2 resources

All bodies are JSON. All successful GETs are `200`. All writes accept JSON
bodies. Every response carries `Cache-Control: no-store`.

### `GET /api/v2/device`

Always `200` while the web server is up, regardless of the radio. This is the
reachability probe SOTAmat and SOTALog should have had.

```json
{ "model": "SOTAcat", "hardware": "...", "firmware": "260906.1200",
  "api": { "v1": true, "v2": "2.0.0", "openapi": "/api/v2/openapi.json" },
  "clock": { "unixMs": 1789012345678, "source": "phone" },
  "radio": { "type": "KX2", "link": "up" },
  "battery": { ... }, "rssi": -61 }
```

### `GET /api/v2/radio`

The state document. Every field the snapshot holds, with a generation and
freshness so the client can grey stale values instead of guessing.

```json
{ "gen": 4127, "link": "up",
  "frequency": 14060000, "mode": "CW", "power": 5, "volume": 12,
  "ptt": false, "atu": "in",
  "observedAt": 1789012345678, "ageMs": 340,
  "busy": null }
```

`busy` is `null`, `"ft8"`, or `"keyer"` and mirrors the accept-gate in
`include/radio_set_gate.h`. When the link is down the document is still
`200` with `"link": "down"` and the last-known values; the honesty is in
`link` and `ageMs`, not in a 503. (v1 keeps its 503 because SOTAmat depends
on it; see the 2026-08-17 spec's as-built note.)

Fields the snapshot does not hold yet (S-meter, PTT) come from the rigctld
branch's `REFRESH_SMETER` and PTT work and are included only once that lands.

### `PATCH /api/v2/radio`

JSON Merge Patch (RFC 7396) of the writable fields: `frequency`, `mode`,
`power`, `volume`. One request, one outcome. Replaces the racing pair of
PUTs every client sends today.

```json
PATCH /api/v2/radio
If-Match: "4127"
{ "frequency": 14060000, "mode": "CW" }
```

Outcomes, mapped from `radio_set_via_http`'s table:

| Radio outcome | Reply |
|---|---|
| all fields applied within the park bound | `200` with the new state document |
| any field refused by the radio | `500` problem, `applied` lists what did land |
| confirmation outran the bound, or could not park | `202` with an operation (see below) |
| superseded by a newer PATCH | `202` with the operation in state `superseded` |
| FT8 or keyer owns the radio | `503` problem with `Retry-After` when known |
| link down | `503` problem |
| `If-Match` does not match current `gen` | `412` problem with the current document |

`If-Match` is optional. Without it the semantics are last-writer-wins, as
today. With it a client gets compare-and-set for free.

A multi-field PATCH enqueues its fields as consecutive service SETs under one
operation id. The reply is the outcome of the last one, and the operation
records each field's outcome.

### Operations

Every piece of work that outlives its request becomes an operation. That
includes keyer, FT8 prepare and transmit, ATU tune, OTA, and any PATCH that
returned 202.

```json
POST /api/v2/operations
Idempotency-Key: 7c1e...
{ "kind": "keyer", "message": "CQ SOTA DE K5EM K" }

202 Accepted
Location: /api/v2/operations/91
{ "id": 91, "kind": "keyer", "state": "queued",
  "createdAt": 1789012345678, "eta": null }
```

- `GET /api/v2/operations/{id}` returns the operation. States: `queued`,
  `running`, `done`, `failed`, `superseded`, `cancelled`, `expired`. `failed`
  carries a problem object.
- `DELETE /api/v2/operations/{id}` cancels. For FT8 this is what `cancelft8`
  does today; for the keyer there is no abort path today, so cancel of a
  `running` keyer operation returns `409` until one exists; for a queued
  PATCH it removes the slot.
- `GET /api/v2/operations` lists the live ones (bounded, see §Resource budget).
- `Idempotency-Key` replaces SOTAmat's `requestToken` and `sequenceNumber`
  with one idiom for every kind. A repeated key within the retention window
  returns the existing operation rather than creating another.

The rigctld branch's `radio_service_set_wait` is this state machine for one
generation, written in C. Operations generalize it to a small table with ids.

### `GET /api/v2/events`

Server-Sent Events. One connection replaces every poll loop.

```
event: radio
id: 4128
data: {"gen":4128,"frequency":14060000,"mode":"CW",...,"source":"v2:PATCH"}

event: operation
data: {"id":91,"state":"running"}

event: link
data: {"state":"down","reason":"timeout"}

event: device
data: {"battery":{...},"rssi":-58}

: heartbeat
```

- `radio` fires on every snapshot generation change and carries the whole
  document plus `source`: which facade and method caused it (`v1:PUT`,
  `v2:PATCH`, `rigctld`, `panel` for a front-panel change, `ft8`, `keyer`).
  Loggers exist to record what the radio is doing; with `source` they can
  follow a QSY made from any client without polling and without the
  `/vfo` deep link.
- `id` is the snapshot generation, so `Last-Event-ID` on reconnect lets the
  server send the current document once and resume.
- The first event on every connection is `hello`, carrying the `/device`
  document and the full `/radio` document, so a client has complete state
  before the first change arrives. With `Last-Event-ID` the `hello` still
  comes first, then any generations since.
- Events caused by one write are delivered before events caused by a later
  write.
- Heartbeat comment every 15 s. Idle streams are dropped after a bound (see
  §Resource budget).
- A client that PATCHes and then sees its own generation echoed back needs no
  poll-suppression window. The web UI's `VFO_ACTION_SUPPRESS_MS` goes away.

#### Why SSE

It is one long chunked GET on the `esp_http_server` already running. The
browser's `EventSource` reconnects on its own with `Last-Event-ID` when a
phone throttles a background tab, which is the failure the web UI currently
works around by hand. It is one-directional, which is all any client needs;
writes go through PATCH and operations. WebSockets would add a frame codec
and a second lifecycle for no gain here.

**To verify before phase 3:** that `httpd_resp_send_chunk` on the pinned
ESP-IDF can hold a response open indefinitely from a completion actor other
than the handler, and how it interacts with the async-handler detach already
in use. React Native does not ship `EventSource`; PoLo or HaLo would need a
library, which has not been verified against their toolchains.

### Errors

RFC 9457 Problem Details everywhere in v2, `application/problem+json`.

```json
503 Service Unavailable
Retry-After: 9
{ "type": "urn:sotacat:radio-busy", "title": "Radio busy",
  "status": 503, "detail": "FT8 transmission in progress",
  "busy": "ft8", "until": 1789012354000 }
```

`Retry-After` is set when the deadline is known (FT8 has a transmission
window) and omitted when it is not (keyer). Types are a closed list published
in the OpenAPI document.

### CORS

Every `/api/v2` route answers `OPTIONS` with `Access-Control-Allow-Origin: *`,
`Access-Control-Allow-Methods: GET, PATCH, POST, DELETE`,
`Access-Control-Allow-Headers: Content-Type, If-Match, Idempotency-Key`, and a
long `Access-Control-Max-Age`. `Access-Control-Allow-Origin: *` is also on
every v2 response, and `Access-Control-Expose-Headers` names `Location` and
`ETag`. The wildcard is deliberate: there is no credential to protect, and the
device is only reachable on its own network.

v1 gets the same treatment. It is additive, no existing client sends
`Origin`, and it is the cheapest possible unblock for a browser-hosted logger
that only knows v1. **To verify:** that `esp_http_server` accepts
`HTTP_OPTIONS` registrations alongside the wildcard `/api/*` handlers.

### Contract publication and discovery

- `GET /api/v2/openapi.json` serves an OpenAPI 3.1 document embedded like the
  other web assets (three sync points; see `docs/dev/Web-UI.md`). The same
  file lives in the repo and is what SOTALog's hand-written reference should
  be replaced by.
- The `_device-info._tcp` mDNS TXT record gains `api=v2` and
  `openapi=/api/v2/openapi.json`.
- The mock server in `test/mock_server/` implements v2 alongside v1 so
  third-party developers can run against it without hardware. This is
  already how SOTAcat's own UI and integration tests run.

## Service prerequisites

These are below the HTTP layer and come first. They pay for themselves in
rigctld as well.

1. **Operation identity for keyer and FT8.** Both bypass the radio service
   today and take the radio mutex directly (`handler_cat.cpp` keyer task,
   `handler_ft8.cpp`). Until they are represented in an operation table with
   an id and a state, neither the v2 operation resource nor SOTALog's keyer
   flag can be honest. This does not move their execution onto the service
   worker; FT8 keeps its own task and its precedence. It only means the
   service knows they exist, when they start, and when they end. The
   accept-gate in `radio_set_gate.h` already reads both flags; the operation
   table is where those flags become records.
2. **A broadcast primitive.** Parked completers are per-request. The event
   stream needs to learn about a snapshot generation change once and fan it
   out to every open stream. A cheap tick that compares the last-sent
   generation to the snapshot's is enough; a callback from
   `radio_snapshot` publish is cleaner. Either way it must run on the HTTP
   server task, as the park completions do, so no stream write happens off
   that task.
3. **One capability model.** The browser gates itself on `radioType` plus
   transverter settings today. v2's `/device` and `/radio` need the same
   truth, and the rigctld `dump_state` bitmask would read from it too.

## Compatibility

| Client | Effect of this design |
|---|---|
| SOTAmat | none; v1 frozen. Gains nothing until it opts in. What would tempt it: an FT8 operation that says `done` or `cancelled` rather than "queued", and `/device` for its reachability probe. |
| SOTALog | none until it opts in. What would tempt it: atomic PATCH, the keyer operation it is already trying to model, `/device` for its probe, and the OpenAPI file in place of its hand-written one. |
| PoLo | pounce branch keeps working on v1. The event stream would let PoLo follow the VFO without SOTAcat's outbound `/vfo` deep links, if PoLo adds an SSE client. |
| HaLo | CORS is the unblock. Everything else is what a browser-hosted CAT client would want. Unverified: HaLo's actual transport plans. |
| SOTAcat web UI | migrates to v2 in phase 4. Loses five timers and the poll-suppression window. |
| rigctld branch | benefits from prerequisites 1 and 3 on merge. Unchanged otherwise. |

## Resource budget

The constraint is sockets and RAM on the ESP32, not CPU.

- `max_open_sockets` is 12 today (2026-08-17 spec, as built). Each SSE stream
  holds one for its lifetime. Budget: at most 4 streams, idle-dropped after
  60 s without a client read, and refused with `503` beyond the cap. One
  phone tab, one logger, and one spare is the expected load.
- The rigctld branch sized `CONFIG_LWIP_MAX_SOCKETS` for two rigctld clients.
  If both land, the socket ceiling must be re-derived once, in one place, and
  written in `docs/dev/Radio-Access.md`.
- Operation table: 8 entries, fixed, static. Finished operations are retained
  for 30 s for `GET` and idempotency, then recycled. Beyond 8 live operations,
  `POST` returns `503` with a problem. This matches the `RADIO_PARK_MAX` of 8.
- OpenAPI document: embedded, gzip-compressed, target under 12 KB.
- No heap allocation per event. Each stream has a fixed send buffer.

## Error handling

- Stream write failure closes that stream only; the snapshot and other
  streams are untouched.
- An operation whose owner task dies (keyer task abort, FT8 cleanup) is
  marked `failed` by the cleanup path, not left `running`. This is the one
  place where the operation table needs a hook in existing task teardown.
- A PATCH that partially applied reports per-field outcomes in the operation
  and in the 500 problem. It never claims success for a field that did not
  land.
- Expiry (`SET_APPLY_DEADLINE_MS`) maps to operation state `expired`, which
  is distinct from `failed` because nothing was attempted on the radio, as
  the worker already distinguishes.

## Testing

- Host tests for the operation table (pure, like `test_radio_set_gate.cpp`):
  create, transition, supersede, cancel, expire, recycle, idempotency lookup,
  cap.
- Mock server implements v2 and SSE; integration tests under
  `test/integration/` cover every row of the PATCH outcome table, the
  operation lifecycle for keyer and FT8, CORS preflight on v1 and v2, and
  `Last-Event-ID` resume.
- UI tests (`make -C test/integration test-ui`) once the web UI migrates.
- Hardware: the 2026-08-17 validation record's scenarios re-run over v2
  (radio dead, FT8 held, slow CAT, PUT storms, slow reader), plus a 2 h soak
  with 4 streams open and one rigctld client if merged. Full retest gate
  applies: unit, integration, UI, and real hardware via OTA before merge.
- Third-party: SOTALog and SOTAmat continue to pass their own tests against
  the mock server's v1. That is the compatibility proof for the frozen facade.

## Phasing

Order is by leverage for third-party clients, and each phase ships on its
own.

1. **v1 unblock:** CORS on v1, OpenAPI 3.1 document for v1 served from the
   device and committed to the repo, mDNS TXT advertising it. No new
   surface. This alone answers SOTALog's reference doc and HaLo's browser
   constraint.
2. **Service prerequisites:** operation table with keyer and FT8 recorded in
   it; broadcast primitive; capability model unified. rigctld can merge
   after this.
3. **v2 read side and events:** `/device`, `/radio`, `/events`, problem
   details, CORS.
4. **v2 write side:** `PATCH /radio`, `/operations`, `Idempotency-Key`,
   `If-Match`. Web UI migrates to v2 and drops its timers.
5. **Outreach:** OpenAPI and mock server handed to SOTALog, SOTAmat, and
   Ham2K with the migration notes from §Compatibility. Nothing in this phase
   is SOTAcat code.

## Risks

- **SSE on ESP-IDF is unproven here.** Phase 3 starts with a spike that holds
  a chunked response open from the server task for an hour on hardware. If
  it cannot, the fallback is long-polling on `GET /radio?since=<gen>`, which
  preserves the contract shape and loses only latency.
- **Socket pressure.** Four streams, two rigctld clients, SOTAmat polling,
  and phone keepalives may exceed 12. The soak test decides the number; the
  design does not.
- **Operation hooks in task teardown** touch the keyer and FT8 cleanup
  paths, which are the most timing-sensitive code in the tree. The hook is
  a single atomic store, added after the existing cleanup, never before.
- **Two facades writing the same radio** were already true with v1 plus the
  web UI; v2 adds no new writer, but `source` in the event stream makes the
  contention visible for the first time. That is a feature, and a support
  question.

## Open questions

- Should `/radio` while the link is down be `200` with `"link":"down"` (this
  document) or `503` like v1? The argument for `200` is that the document is
  honest on its own and clients stop conflating device and radio. The
  argument for `503` is one rule for both versions. Decision here is `200`;
  revisit if a v2 client asks for the other.
- Whether a PATCH of `frequency` and `mode` should be two service SETs under
  one operation (this document) or one combined SET type. Two keeps the
  worker unchanged; one would be atomic on the radio too. Start with two.
- Retention window for finished operations and idempotency keys: 30 s is a
  guess sized to SOTAmat's retry loop (150 ms gaps) and SOTALog's 30 s keyer
  timeout. Tune after the mock tests.

### TCI facade instead of, or alongside, v2 events

Surveyed 2026-09-06 against FlexRadio's SmartSDR TCP/IP API wiki and the TCI
protocol PDF in `github.com/ExpertSDR3/TCI`. Both vendors arrived at the same
model this document proposes: an ack per write, push on every change, the
originating client named in the push, a hello with version and full state on
connect, a keyer with a queue that can be drained or cancelled, and the ATU as
an operation. The v2 design is not idiosyncratic on the model.

Both differ from this document on transport. Each uses one persistent
bidirectional socket with commands and status multiplexed: SmartSDR on raw
TCP 4992 with `C<seq>|...` commands, `R<seq>|<hex>|` responses and
`S<handle>|...` status; TCI on a WebSocket with text commands echoed to all
clients. This document splits writes into HTTP and pushes into SSE, which is
REST-idiomatic and browser-simple, but is a dialect no existing client
speaks.

TCI is the one that changes the calculus. It is published, runs over
WebSocket so a browser page can reach it, and Expert Electronics lists client
implementations in loggers and digital-mode software: Log4OM, RUMlog,
MacLoggerDX, SWISSLOG, LogHX, OCLog, 5MContest, JTDX, MSHV, and WSJT-X
Improved. Hamlib ships a TCI driver, so hamlib-based apps could reach a TCI
server too. Thetis and AetherSDR implement TCI servers, so it is no longer a
single-vendor protocol.

The alternative: a TCI facade over the radio service, the same shape as the
`feature/rigctld-server` branch, serving `VFO`, `MODULATION`, `TRX`, `TUNE`,
`DRIVE`, `VOLUME` and `CW_MACROS` (with `cw_macros_empty` and
`cw_macros_stop`), the init commands (`VFO_LIMITS`, `MODULATIONS_LIST`,
`PROTOCOL`, `READY`) derived from the capability model, and every client
write echoed to all clients. It would give SOTAcat a dozen existing clients
for one server, and could make both the v2 event stream and the rigctld
facade unnecessary for third parties (hamlib apps via the TCI driver).

What stays in v2 either way, because no standard covers it: `/device`,
operations for FT8, OpenAPI, and CORS.

Decision deferred until two things are verified:

1. Whether the listed TCI clients tolerate a server that omits the audio and
   IQ stream commands entirely, and which subset of init commands each
   requires before it considers the connection usable. Test against at least
   Log4OM and one of JTDX or WSJT-X Improved, with a mock TCI server first.
2. Whether `esp_http_server`'s WebSocket support (`CONFIG_HTTPD_WS_SUPPORT`)
   fits the socket budget in §Resource budget alongside v1 polling and the
   phone's tab, and whether it can be driven from the HTTP server task the
   way parked completions are.

If both hold, phases 3 and 4 of §Phasing are re-planned: the TCI facade
replaces `GET /api/v2/events` as the push channel for third parties, the web
UI chooses between SSE and the same WebSocket, and the rigctld branch is
re-evaluated against Hamlib's TCI driver before merge. If either fails, this
document stands as written and TCI is declined with that finding recorded
here.

Independent of the decision, two amendments are adopted now from the survey:
the SSE stream opens with a `hello` event carrying the `/device` document and
the full `/radio` document before any change event; and events caused by
command A are delivered before events caused by command B, which the
operation table must preserve.
