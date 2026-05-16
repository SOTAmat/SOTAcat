# Decoupling the Web UI from Radio Link State — Design

**Status:** Approved for planning
**Date:** 2026-05-15

## Problem

When the KX2 is switched off (or was never attached) while the Run tab
is open, the entire SOTAcat web UI becomes unresponsive: tab switches
hang, the Run page freezes, and the client-only "QRT SMS" button
cannot be used. This forces the operator to leave the radio powered on
to send QRT, reducing post-activation flexibility.

### Root cause (verified in code)

Two independent couplings combine:

1. **Server-side — radio I/O blocks the single HTTP server task.**
   ESP-IDF's `esp_http_server` (`HTTPD_DEFAULT_CONFIG()`,
   `webserver.cpp:318`) services all requests on **one task**. The Run
   page polls `/api/v1/frequency` and `/api/v1/mode` every 3 s
   (`run.js` `getCurrentVfoState`, `VFO_POLLING_INTERVAL_MS = 3000`).
   With the radio off, each handler does a synchronous CAT read:
   `get_from_kx("FA"/"MD", tries=3, …)` with `"FA"`/`"MD"` in
   `long_command_prefixes` → `KX_TIMEOUT_MS_LONG_COMMANDS = 2000 ms`
   per `uart_read_bytes`, and `uart_get_command`'s retry path
   (read + `empty_kx_input_buffer` + 30 ms + retry) blocks **~6 s
   while holding the radio mutex**. Because the server is
   single-tasked, every other request — tab HTML/JS, settings,
   callsign/gps/cwMacros — is starved.

2. **Client-side — client-only actions gated on device round-trips.**
   `#sms-qrt-button` ships `disabled` (`run.html:93`) and is enabled
   only by `updateSpotButtonStates()`, which runs in
   `onSpotAppearing()` *after* `await ensureCallSignLoaded()`,
   `await getLocation()`, `await loadCwMacrosAsync()` (each an
   un-timed backend fetch). When the server is starved, that await
   chain never resolves, so the QRT button — which needs neither the
   radio nor the server (`sendQrtSms()` only builds an `sms:` URI) —
   stays greyed out.

Chase data refresh is already decoupled: `chase_api.js` fetches
directly from `https://spothole.app`, not the ESP32. Only *navigating
to* the Chase tab (a device asset fetch) is affected — i.e. coupling 1.

## Goal

Sever both couplings so that, with the radio off or never present:

- The device web server stays responsive for every non-radio
  endpoint (tab navigation, settings, asset loads).
- Client-only actions (QRT/Spot SMS, Polo, SOTAmāt) work immediately.
- VFO polling stops generating doomed traffic and resumes on recovery.
- No silent success: a tune/mode/power change against a dead radio
  reports honest failure.

Non-goals: blanket `AbortController`/timeout on all client fetches; a
new connection indicator (the existing ⚫ `#connection-status`
affordance is reused); changing the GET response payload shape.

## Architecture

Two independent, independently-shippable decouplings.

### Server-side: radio I/O off the HTTP path

Introduce a dedicated **radio service task** that is the sole owner of
the UART and the existing radio mutex. HTTP handlers no longer perform
synchronous CAT I/O:

- **GET** handlers read a shared, lock-protected **snapshot** and
  return immediately. Stale snapshot → return the stale value *and*
  enqueue a background refresh (no waiting).
- **SET** handlers enqueue a command and wait on a per-request
  completion signal up to a bounded timeout (~800 ms); if link is
  known-down they reject in sub-millisecond time.

The radio task's CAT calls to a dead radio still cost ~6 s, but that
time is entirely off the HTTP server task, so no endpoint stalls.

```
Browser ──HTTP──> handler ──> [snapshot read]      ──> reply (µs)
                       │
                       └─ enqueue (refresh / SET) ──┐
                                                    v
                              radio service task (owns UART+mutex)
                                  · drains bounded queue
                                  · ~6 s dead-radio CAT timeout here
                                  · updates snapshot + link-health
```

### Client-side: stop gating on the radio link

- Enable client-only buttons from localStorage-cached identity
  synchronously; refresh from backend without `await`.
- Gate VFO polling on the existing `AppState.connectionState` health
  signal; reuse the ⚫ indicator (no new UI).

## Components

### Server-side

#### Radio link-health state (closes an existing gap)

`kxRadio.is_connected()` exists, and `handler_connectionStatus_get`
already returns ⚫ instantly when it is false (`handler_status.cpp`).
The gap: **nothing flips it back to `false`** once the radio is
switched off after a successful connect. The radio service task
becomes the single authority:

- `>= LINK_DOWN_FAIL_THRESHOLD` consecutive CAT failures → link-down.
- First successful CAT exchange → link-up.

Threshold mirrors the client's existing `DISCONNECT_THRESHOLD`
pattern. `is_connected()` becomes the one source of truth consulted by
all handlers.

#### Radio service task

Owns UART + the existing radio mutex. Responsibilities:

- Maintain a **snapshot** struct: `frequency`, `mode`, `xmit_state`,
  `link_health`, and per-field `last_updated` timestamps. Protected by
  its own lightweight lock (or atomics) — *distinct from the radio
  mutex*, so cache reads never contend on UART.
- Drain a **bounded request queue** of: GET-refresh requests
  (coalesced — duplicates collapse to one) and SET commands
  (frequency newest-wins, matching today's debounce intent).
- Update snapshot + link-health after every CAT exchange.
- Signal per-request completion so SET handlers can wait for an ack.

**Decision (resolves brainstorm open point 1):** the radio mutex's
contention surface *shrinks* — only the radio task ever takes it.
Handlers take only the small snapshot lock (reads) or enqueue (SETs).
This is the clean model without a scary "rip out all handler locking"
diff, because handler radio-locking is replaced by snapshot-locking,
not removed wholesale.

#### Cache-only GET handlers

`handler_frequency_get`, `handler_mode_get`,
`handler_connectionStatus_get`, and peers:

- Return the snapshot value immediately; never call `uart_*`.
- Snapshot older than a freshness window → return value, enqueue a
  refresh, do not wait. Generalizes the existing 200 ms frequency
  cache (`handler_frequency.cpp:13`) into one snapshot.
- Link known-down with a cached value → return last-known (client
  treats ⚫ as the staleness cue).
- Link known-down with no cached value (cold start / radio never
  present) → fast sentinel / `HTTPD_500`/`503`, never block.

**Decision (resolves brainstorm open point 2):** GET response payloads
stay **byte-identical** to today (bare value text). Health is conveyed
only through the existing `connectionStatus` channel, so no existing
consumer needs changes.

#### SET handlers

`handler_frequency_put`, `handler_mode_put`, `handler_volume`,
`handler_atu`, power:

- `is_connected() == false` → reject immediately (HTTP 503),
  sub-millisecond.
- Else enqueue the command, wait on a per-request completion signal up
  to `SET_ACK_TIMEOUT_MS` (~800 ms). Return honest 200 / 5xx. Update
  snapshot only on confirmed success.

#### On-demand only

The radio task performs CAT work **only** when the queue is
non-empty. No continuous idle polling → no extra battery drain on the
portable rig.

### Client-side

#### Ungate client-only actions (`run.js` / `main.js`)

In `onSpotAppearing()`:

- Enable SMS / QRT / Polo / SOTAmāt from localStorage-cached
  callsign + location *synchronously* (the data is already persisted
  by `ensureCallSignLoaded`/`getLocation`/`loadCwMacrosAsync` on prior
  visits).
- Move `ensureCallSignLoaded()` / `getLocation()` /
  `loadCwMacrosAsync()` off the critical path: fire them
  un-`await`ed; when they resolve, opportunistically refresh button
  state. `updateSpotButtonStates()` runs immediately, not behind the
  await chain.
- No fetch-timeout work needed — the awaits are removed from the path,
  not made resilient.

#### Gate VFO polling on link health (`run.js` / `main.js`)

`getCurrentVfoState()` / `startVfoUpdates()` consult the existing
`AppState.connectionState` (driven by the existing `connectionStatus`
poll):

- Link-down → suspend or heavily back off the 3 s VFO poll.
- Recovery → resume normal cadence.

The ⚫ `#connection-status` indicator already communicates the state;
no new UI element.

## Data flow

1. Run tab open, radio on: VFO poll → cache-only GET → instant fresh
   snapshot (refreshed on demand by the radio task). Identical UX to
   today.
2. Radio switched off: in-flight CAT call completes on the radio task
   (~6 s, off HTTP path) and fails; after the threshold, link-health
   → down; `connectionStatus` returns ⚫; client backs off VFO poll;
   client-only buttons remain usable throughout.
3. Radio never present (cold boot, no rig): first queued CAT request
   fails fast-path to link-down; GETs return sentinel; SETs 503;
   server fully responsive for all non-radio endpoints.
4. Recovery: a queued CAT request succeeds → link-up → client resumes
   polling → snapshot refreshes.

## Error handling

- **Cold start / no value cached:** GET returns defined "unknown"
  fast; SET 503s fast.
- **Radio off mid-session:** ~6 s blocking confined to the radio task;
  link flips down after threshold.
- **SET timeout/failure:** honest HTTP 5xx; existing client behavior
  (revert display via `getCurrentVfoState()` on `!ok`) preserved.
- **Queue overload:** bounded queue; GET-refresh coalesced; frequency
  SET newest-wins; excess rejected rather than unbounded growth.
- **Recovery race:** link-up requires a *successful* exchange, not
  merely absence of failure, preventing flapping.

## Testing approach

Existing infra to extend:

- `test/integration/test_mutex_stress.py`,
  `test/integration/test_webserver_performance.py` — add a
  radio-off / radio-absent scenario asserting non-radio endpoints
  stay responsive (e.g. `connectionStatus` and an asset fetch return
  under a small bound while VFO endpoints are exercised).
- `test/unit/test_run.js` — assert SMS/QRT/Polo buttons are enabled
  without the backend init fetches resolving, and that VFO polling
  backs off when `connectionState` is not `"connected"`.
- `test/mock_server/server.py` — add a mode that simulates a
  dead/slow radio (delayed/empty CAT responses) for the above.

Host-compilable C++ unit tests for the link-health state machine
(failure→down at threshold, success→up, no flap) and snapshot
coalescing, if a host build target can be added; otherwise covered via
the integration harness plus a manual hardware checklist:

1. Radio off mid-session on Run tab → UI stays responsive, QRT SMS
   works, ⚫ shows, recovery on power-up.
2. Boot with no radio attached → all tabs navigable, settings usable.
3. SET frequency/mode while radio off → honest failure in the UI, no
   false success.

## Risks

- **Concurrency (highest):** new task + bounded queue + completion
  signalling around the existing mutex. Mitigated by making the radio
  task the *sole* mutex owner (shrinks contention surface) and a
  distinct snapshot lock.
- **Behavioral parity when radio present:** GET payloads unchanged;
  on-demand refresh must keep snapshot fresh enough that the Run page
  feels identical. Validated by `test_webserver_performance.py`
  baselines.
- **Irreversibility:** firmware controls a physical radio. Phase
  rollout — server-side first (parity-tested with radio present),
  client-side second.

## Phasing

1. **Server-side decoupling** — radio task, snapshot, link-health,
   cache-only GET, enqueue+ack SET. Shippable alone; fixes coupling 1.
2. **Client-side decoupling** — ungate buttons, gate VFO polling on
   `connectionState`. Shippable alone; fixes coupling 2 and the
   reported QRT-button complaint.
