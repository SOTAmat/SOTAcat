# Radio / Web Decoupling — Branch Overview

**Branch:** `feature/radio-web-decoupling` · **Base:** `main`
**Status:** server-side phase and async-handler phase both complete and
**hardware-validated** (2026-08-17, K5EM_1 + KX2: radio-on contract, VFO
knob, radio-off/on, FT8 ×3 with two clients polling — see §8).

This document explains, end to end, what this branch changes relative to
`main` and why. For the original design rationale see
`docs/superpowers/specs/2026-05-15-radio-decoupling-design.md`; for the
async-handler phase (honest 204/500 SETs, read-your-write GETs) see
`docs/superpowers/specs/2026-08-17-radio-async-handlers-design.md`; for the
FT8 contention fix see
`docs/for-AI-agents/radio-service-ft8-mutex-contention.md`.

---

## 1. TL;DR

On `main`, all radio CAT I/O happens **inside HTTP request handlers**.
ESP-IDF's `esp_http_server` runs every request on **one task**, so a single
handler blocked on a slow/absent radio (~6 s to time out) freezes the entire
web UI — the reported bug: *"after turning the KX2 off, the Run page goes
unresponsive and the QRT SMS button can't be used."*

This branch moves all CAT I/O onto a dedicated **radio service task**. HTTP
handlers no longer touch the radio: GETs read a cached **snapshot** and return
in microseconds; SETs drop a command in a **slot** and return immediately.
The web server stays responsive no matter what the radio is doing.

```
main:    browser ─▶ HTTP handler ─▶ [blocking CAT I/O, up to 6 s] ─▶ reply
branch:  browser ─▶ HTTP handler ─▶ [snapshot read / slot write, ~µs] ─▶ reply
                                          ▲   │
                                  snapshot│   │enqueue
                                          │   ▼
                                  radio service task ─▶ CAT I/O ─▶ KX radio
```

---

## 2. The problem on `main`

### 2.1 Single-task HTTP server + in-handler CAT I/O

`esp_http_server` (`HTTPD_DEFAULT_CONFIG()`, `webserver.cpp`) services **all**
requests on one task. On `main`, `handler_frequency_get`, `get_radio_mode`,
`handler_connectionStatus_get`, and the SET handlers each take the radio mutex
and perform a synchronous CAT exchange:

```
                ESP-IDF esp_http_server  —  ONE task, requests serialized
                ┌──────────────────────────────────────────────────┐
 GET /frequency ─▶│ handler_frequency_get                            │
 GET /run.html  ─▶│   kxRadio.timed_lock()                           │──▶ UART ──▶ KX2
 GET /settings  ─▶│   get_from_kx("FA")  ◀──── ~6 s ────┐            │   (radio OFF:
 GET /mode      ─▶│   ▒▒▒▒▒▒▒▒▒▒ BLOCKED ▒▒▒▒▒▒▒▒▒▒     │            │    never replies)
                │   every other request waits in line  │            │
                └──────────────────────────────────────────────────┘
        radio off  →  6 s block per poll  →  whole UI frozen, QRT button stuck
```

With the Run page polling `/api/v1/frequency` and `/api/v1/mode` every 3 s, a
powered-off radio means each poll blocks the one server task for ~6 s. Tab
navigation, settings, and the client-only QRT SMS button (gated behind
backend init fetches that never resolve) all stall.

### 2.2 Secondary gap

`kxRadio.is_connected()` is set `true` once at boot and **never cleared**, so
`/api/v1/connectionStatus` could not report a radio that was switched off
after a successful connect.

---

> **Durable reference:** the mechanism itself — components, request timelines
> (simple, overlapped, radio-off, FT8, lock contention), the link-health state
> machine and the budget table — now lives in
> [`docs/dev/Radio-Access.md`](dev/Radio-Access.md). Sections 3–6 below are kept as
> the record of what this branch changed and why; prefer Radio-Access.md for "how it
> works today".

## 3. The architecture on this branch

Four new components, all radio CAT I/O confined to one task.

```
        HTTP server task                         radio service task
        (per request: ~µs)                       (sole CAT I/O owner)
   ┌─────────────────────────┐               ┌───────────────────────────┐
   │ GET  → read snapshot     │──── reads ───▶│  RadioSnapshot  (cache)   │
   │ SET  → write a slot      │               │  RadioLinkHealth (state)  │
   │ both → return now        │──── writes ──▶│  request slots            │
   └─────────────────────────┘    + notify    │                           │
                                              │  drains slots, runs CAT,  │
                                              │  publishes snapshot +     │──▶ UART ──▶ KX
                                              │  link health              │
                                              └───────────────────────────┘
```

| Component | File | Role |
|-----------|------|------|
| `RadioLinkHealth` | `include/radio_link_health.h` | Pure state machine: 3 consecutive CAT failures → link-down; first success → up. |
| `RadioSnapshot` | `include/radio_snapshot.h`, `src/radio_snapshot.cpp` | Last-known frequency / mode / xmit-state + per-field timestamps; mutex-guarded; freshness predicates. |
| Radio service task | `src/radio_service.h`, `src/radio_service.cpp` | The single owner of radio CAT I/O. Drains request slots, runs CAT, updates the snapshot and link health. |
| Request slots | inside `src/radio_service.cpp` | Per-type slots (refresh + SET) that HTTP handlers fill; the worker drains them. |

The radio service task is started once at boot, after `kxRadio.connect()`
(`src/setup.cpp`).

---

## 4. How a request flows now

### 4.1 GET — read the snapshot; park briefly if stale, never block

```
 browser ─GET /api/v1/frequency─▶ handler_frequency_get
                                    │  snap = radio_snapshot::get()   (take small lock, copy, release)
                                    │  fresh?  ──yes──▶ reply snap.frequency_hz        (~20 µs)
                                    │          ──no───▶ arm refresh slot; link up? ─▶ PARK (≤300 ms)
                                    │                                    link down / FT8 / no room
                                    │                                        ─▶ reply stale value now
                                    ▼
                    radio service task refreshes the snapshot ─▶ posts "done" to the server task
                                                              ─▶ parked GET replies with the fresh value
                    (or the 100 ms park tick expires it ─▶ replies with the last-known value)
```

- The GET response payload is **byte-identical to `main`** (bare value text).
- "Park" = `httpd_req_async_handler_begin()`: the request is detached from
  the single server task, which immediately goes on serving other sockets.
  Nothing ever waits *on* the server task; a parked request only ties up its
  own socket for ≤300 ms. Result: reads are effectively live again (a
  front-panel VFO turn shows on the next poll, not the one after) and
  `PUT` → immediate `GET` reads the new value.
- Cold start with nothing cached → parks for the first refresh; `HTTP 500` /
  `UNKNOWN` only if that also fails. Never a hang.

### 4.2 SET — enqueue, park, reply honestly

```
 browser ─PUT /api/v1/frequency?frequency=─▶ handler_frequency_put ─▶ radio_set_via_http()
                                    │  FT8 active?     ──yes──▶ HTTP 503 "radio busy (FT8)"  (sync)
                                    │  link known-down? ─yes──▶ HTTP 503 "radio link down"   (sync)
                                    │  else: write SET slot (gen N), notify worker, PARK (≤1.5 s)
                                    ▼
                    worker drains the slot, runs the CAT tune, updates the snapshot,
                    posts "done(gen N, ok)" ─▶ parked PUT replies 204 (ok) / 500 (radio refused)
                    park tick expires it first ─▶ 202 "accepted, applying"
                    newer same-kind PUT arrives ─▶ the older one replies 202 "superseded"
```

A SET handler **never blocks the HTTP server task**, yet the client gets the
same honest answer `main` gave: 204 once the radio confirmed, 500 if it
refused. 202 is now the exception (confirmation genuinely outran 1.5 s — e.g.
a KX2 band change queued behind another op), not the rule.

`mode=SSB` is resolved to LSB/USB **by the worker at apply time**, i.e. after
any frequency SET queued ahead of it — the handler-side snapshot lookup picked
the wrong sideband when a tune was still pending.

### 4.3 The request-slot model — coalescing

Pending work is held as **per-type slots**, not a FIFO queue. A burst of
same-type requests collapses automatically.

```
   HTTP handlers (producers)              radio service task (consumer)
   ───────────────────────────            ─────────────────────────────
                          s_req_mutex     ulTaskNotifyTake() ── wakes ──┐
   GET stale  ─┐         ┌──────────────┐                               │
   SET freq   ─┼────────▶│ refresh[freq]│   for each armed slot:        │
   SET mode   ─┤         │ refresh[mode]│     take mutex                │
   SET volume ─┘         │ refresh[xmit]│     copy + clear slot         │
                         │ set[freq]  ◀─┼──  release mutex              │
                         │ set[mode]    │    run CAT (off the lock) ────┘
                         │ set[volume]  │
                         │ set[atu] ... │   newest-wins  (volume: accumulate delta)
                         └──────────────┘
```

A burst of 12 rapid frequency PUTs overwrites one slot 12× → the worker runs
**one** tune, to the final frequency. The radio no longer chases through
intermediate frequencies, and the HTTP server is never starved.

---

## 5. Key behaviors and safeguards

| Mechanism | What it does | Where |
|-----------|--------------|-------|
| **Link health** | 3 consecutive CAT failures → link-down; first success → up. `radio_service_link_up()` is the single source of truth; `connectionStatus` and SET fast-reject consult it. Closes the "never cleared" gap. | `radio_link_health.h` |
| **Fast-confirm** | After any failed CAT op the worker fires up to 2 `TQ;` pings (~0.2 s each) while it still holds the radio: dead radio → link-down ~0.5 s after the first failure (not after two more ~4 s `FA;`/`MD;` timeouts); ping succeeds → the failure was transient or a *refused* command → counter reset (refusals don't count against the link). | `radio_service.cpp` `fast_confirm_link` |
| **Snapshot freshness** | Each field carries a timestamp; `*_fresh(now)` is skew-safe (a clock before the stamp reads stale, never falsely fresh). | `radio_snapshot.h` |
| **Link-down probe** | While link is down, one cheap `TQ;` ping (~0.2 s) per 5 s is the recovery probe — armed by any stale GET including `connectionStatus`; other refreshes are dropped until the ping succeeds. Recovery ≤5 s after power-on; a dead radio costs 0.2 s of CAT per 5 s. | `radio_service.cpp` `probe_link` |
| **SET apply-deadline** | A queued SET older than 5 s is skipped rather than applied late (don't retune long after the user's click). | `radio_service.cpp` |
| **FT8-aware yield** | FT8 transmission holds the radio mutex continuously (~27 s). The worker skips **all** CAT work while `Ft8RadioExclusive` is set, and bounds its lock-acquire to 3 s with slot re-arm as a TOCTOU safety net — so it never trips the 20 s task watchdog and never disturbs FT8 timing. | `radio_service.cpp` |
| **Watchdog discipline** | The worker resets the task watchdog before each drained CAT op **and again after acquiring the radio lock** (so the ≤3 s lock wait is outside the budget), and `put_to_kx`'s retry loop feeds it (no-op for unsubscribed tasks). Measured worst case: a dead-radio `set_frequency`/`set_mode`/`set_power` is ~18 s (3 attempts × two 2 s reads + gaps) — under the 20 s WDT only because the lock wait is excluded. | `radio_service.cpp`, `kx_radio.cpp` |
| **Pre-flight ping** | If the previous op failed (link not yet down), a SET first pings `TQ;` (0.2 s); no answer → the SET fails fast and honestly (parked PUT → 500) instead of spending ~18 s, and the pings drive the link down. Caveat: if a SET is the *first* op to hit a freshly-dead radio it still costs its full ~18 s before detection — a rare ordering, since the polls' GETs usually fail first (0.5–4.5 s). | `radio_service.cpp` `do_set` |

### FT8 yield timeline

```
 t=0     FT8 task grabs the radio mutex ────────────────────────────────┐ held ~27 s
 t=0.5   GET /frequency → refresh slot armed, worker notified            │ (window wait
         worker wakes: Ft8RadioExclusive? ── YES ──▶ skip, leave armed   │  + ~12.6 s
         loop: esp_task_wdt_reset() + ulTaskNotifyTake(1 s) — repeat     │  transmission)
 t~27    FT8 task releases the mutex ──────────────────────────────────────┘
 t~28    worker wakes: Ft8RadioExclusive? ── no ──▶ drains slots normally
```

---

## 6. HTTP contract: what changed for clients

| Case | `main` | this branch |
|------|--------|-------------|
| `GET /frequency`, `/mode`, `/connectionStatus` — radio healthy | live CAT read (≤6 s block if radio dies mid-read) | value ≤~300 ms old; **payload byte-identical**; server task never blocks |
| `GET` — FT8 in progress | cached | last-known value, instantly |
| `GET` — radio link down | 500 after up to 6 s | **503 "radio link down"**, instant — SOTAmat polls only `frequency`/`mode` and must not be fed a stale value as live; the web UI treats non-OK as "no update" and shows ⚫ |
| `PUT` (frequency / mode / volume / ATU) — applied | `204` after the radio confirmed | **`204`** after the radio confirmed |
| `PUT` — radio refused | `500` | **`500`** |
| `PUT` — confirmation slower than 1.5 s | `500` after lock timeout | `202 Accepted` — applies asynchronously; confirm via a later GET |
| `PUT` — superseded by a newer same-kind PUT | n/a (serialized) | `202` "superseded" |
| `PUT` — radio link down | (would block, then fail) | `503 Service Unavailable`, synchronous |
| `PUT` — FT8 transmission in progress | 5xx "radio busy" | `503` "radio busy (FT8)", synchronous |
| `PUT` then immediate `GET` | new value | new value |
| `PUT` — bad parameter (invalid freq/mode, volume unsupported) | `404` / `500` | unchanged (`404` / `500`, pre-validation) |

Non-returning send helpers in `include/webserver.h` (`http_send_string`,
`http_send_no_content`, `http_send_error_json`, `http_send_accepted`,
`http_send_service_unavailable`) back both the `REPLY_WITH_*` macros and the
async completers; ESP-IDF's `httpd_err_code_t` has neither 202 nor 503, so
those two set the status line directly.

---

## 7. File-by-file change map

### New files

| File | Purpose |
|------|---------|
| `include/radio_link_health.h` | Pure, header-only link-health state machine. Host-unit-testable. |
| `include/radio_snapshot.h` | `RadioSnapshotData` POD + skew-safe freshness predicates + the `radio_snapshot::` accessor API. |
| `src/radio_snapshot.cpp` | Mutex-guarded singleton wrapping `RadioSnapshotData`. |
| `src/radio_service.h` / `src/radio_service.cpp` | The radio service task, request slots (with per-type generations), and the producer API (`radio_service_request_refresh`, `radio_service_set`, `radio_service_link_up`, `radio_service_start`). Posts `radio_park_notify_done()` after every op. |
| `include/radio_park.h` | Pure, host-tested park table: one parked request per kind, newcomer supersedes, SETs generation-gated, deadline expiry. |
| `src/radio_park_httpd.h` / `.cpp` | IDF shim: `httpd_req_async_handler_begin/complete`, completions posted to the server task via `httpd_queue_work`, 100 ms deadline tick while anything is parked. All table mutation and all sends happen on the server task. |
| `src/radio_set_http.h` / `.cpp` | Shared PUT flow: FT8/link-down 503, enqueue, park, per-kind completer replying 204/500/202. |
| `test/host/test_radio_park.cpp` | Red-green tests for the park table. |
| `test/integration/test_radio_contract.py` | Radio HTTP contract test — runs against the mock or hardware. |
| `test/host/Makefile`, `test/host/test_radio_link_health.cpp`, `test/host/test_radio_snapshot.cpp` | Host-compiled (`g++ -std=c++17`) red-green unit tests for the two pure-logic units. |
| `docs/superpowers/specs/2026-05-15-radio-decoupling-design.md`, `docs/superpowers/specs/2026-08-17-radio-async-handlers-design.md` | Design specs for the server phase and the async-handler phase. (The step-by-step implementation plans were deleted after landing — they described code that no longer exists that way; the rationale lives in the specs, the outcome here.) |

### Modified files

| File | Change |
|------|--------|
| `src/handler_frequency.cpp` | GET reads the snapshot, parks ≤300 ms if stale; PUT via `radio_set_via_http`. Old 200 ms frequency cache removed. |
| `src/handler_mode.cpp` | GET as above; PUT via `radio_set_via_http`; `SSB` passed through as `RADIO_MODE_SSB_AUTO` (worker resolves at apply time). Old mode cache removed. |
| `src/handler_status.cpp` | `connectionStatus` reads `radio_service_link_up()` (live) instead of the never-cleared `is_connected()`; xmit-state from the snapshot, parking ≤300 ms if stale. |
| `src/handler_volume.cpp`, `src/handler_atu.cpp` | PUT via `radio_set_via_http`. |
| `src/webserver.cpp` | Calls `radio_park_init(server)` after the URI handlers register. |
| `test/mock_server/server.py` | Radio endpoints now emulate the firmware contract (`MockRadio`): bare-text GETs, 204/500/202/503 PUTs, `--radio-latency`, `--radio-dead`, live `ft8`/`radio_dead`/`radio_latency_ms` via `_debug/state`. |
| `src/setup.cpp` | Starts the radio service task after radio connect. |
| `include/webserver.h` | `REPLY_WITH_SERVICE_UNAVAILABLE` (503) and `REPLY_WITH_ACCEPTED` (202) macros. |
| `platformio.ini` | Adds `src/web/spots.jsgz` to `board_build.embed_files` — fixes a pre-existing build break (`spots.jsgz` was in the CMake embed list and the webserver asset map but not in the PlatformIO embed list). |
| `test/integration/test_mutex_stress.py` | Adds a single-client cold-probe (proves per-handler decoupling) and an under-load `/version` responsiveness probe. |
| `.gitignore` | Ignores the host test binaries. |

> Unchanged on purpose: `handler_ft8.cpp`, FT8 task priorities, and
> `RADIO_LOCK_TIMEOUT_FT8_MS`. FT8 timing is a hard constraint; the radio
> service was made FT8-aware instead.

---

## 8. Testing

- **Host unit tests** (`test/host/`, `make test`): `RadioLinkHealth`
  (failure→down at threshold, success→up, anti-flap), `RadioSnapshot`
  (freshness boundary, clock-skew canary) and `RadioParkTable` (supersede,
  generation gate incl. wraparound, expiry, cap) — pure logic, `g++`, no
  hardware.
- **Contract test** (`test/integration/test_radio_contract.py`,
  `make -C test/integration test-contract[-mock]`): payload shapes and ≤600 ms
  GET bound, 404s, read-your-write for frequency/mode (204 ⇒ immediate GET
  matches), SSB resolved against the just-tuned frequency, 30-way parallel
  burst with no socket errors and `/version` p95 < 1 s; against the mock
  additionally radio-dead (⚫, 503, recovery), FT8 (503, ⚪) and slow-CAT
  (202 then applied). **Passes 12/12 healthy, 11/11 dead on the mock.**
- **Integration** (`test/integration/test_mutex_stress.py`): a cold-probe
  asserts `/version`, `/frequency`, `/connectionStatus` each return < 200 ms
  single-client; an under-load probe asserts `/version` p95 < 2 s while radio
  endpoints are hammered.
- **Hardware-validated (server phase, pre-async):** radio-off responsiveness
  (~20 ms vs multi-second hangs), 12-PUT rapid-tune burst (no VFO aborts),
  band-switch tunes, the QRT SMS button usable with the radio off, and an FT8
  transmission overlapping VFO polls with no `radio_service` watchdog warning.
- **Hardware pass (async phase, 2026-08-17, K5EM_1 debug build, KX2):**
  - `test-contract` against the device, radio on: **9/9** (GETs 15–40 ms,
    PUT frequency 204 in ~55 ms, PUT mode 204 in 375–680 ms, immediate GET
    after PUT reads the new value, SSB-after-tune correct).
  - VFO knob turned on the radio → the very next GET read the new frequency
    (42 ms). Read latency is back to "next poll", not "the one after".
  - Radio powered off: during the ~13 s detection window GETs answered in
    ~315 ms (park bound, last-known value), PUTs 202 in ~1.5 s, `/version`
    15 ms throughout; after ⚫ (~14 s) everything ~15 ms and PUTs 503.
    Console: CAT timeouts only — no watchdog, no park warnings.
  - Radio powered on: ⚫ → 🟢 in ~2 s; next PUT 204. With **no** VFO poll
    anywhere (status-only probe): ⚫ → 🟢 in ≤10 s via the `connectionStatus`
    probe (see §9).
  - After fast-confirm + `TQ;` recovery probe (later the same day): link-down
    0.5 s after the first failed CAT (was ~8 s), recovery ≤5 s after power-on
    (was up to ~20 s). What the header shows is now bounded by the client's
    5 s `connectionStatus` poll interval, not the server.
  - FT8 ×3 back-to-back via SOTAmat with the Run page polling on a phone
    *and* a desktop, plus a 1 Hz probe issuing PUTs: every PUT 503
    "radio busy (FT8)" in ~14 ms (never enqueued), GETs ~15 ms ⚪,
    `/version` 13 ms; `ft8 transmission time: 12480 ms` on all three
    (timing undisturbed); no `radio_service` watchdog warning.
  - 30-way parallel-connect bursts show +1 s/+3 s SYN-retransmit steps on
    `/version` and radio endpoints alike (ESP accept-backlog trait, present
    on `main`); the radio burst was no slower than the control.
  - Resource readings (temporary DIAG build, 2026-08-17): `radio_service`
    stack min-free 2112 B of 4096 (peak use ≈2 KB, stable after first heavy
    load); httpd task min-free 7548 B of 10240; heap largest free block
    114,688 B **identical** idle / during 40-way bursts / after (no
    fragmentation from park copies); heap min-ever 82 KB during bursts
    (httpd sockets + lwIP, recovers fully); parked occupancy ≤1 in 30 s
    samples. Nothing to tune. The DIAG lines are kept behind
    `-DSOTACAT_SOAK_DIAG` (off by default; build with
    `PLATFORMIO_BUILD_FLAGS=-DSOTACAT_SOAK_DIAG`).
  - **2 h mixed soak (2026-08-17, DIAG build):** two header pollers (2 s), two
    VFO pollers (3 s), a SOTAmat-style 1 s poller, asset reloads, a tune
    round-trip every 20 s and a mode toggle every 3 min — 33,499 requests,
    **0 errors**, all PUTs 204, latencies flat, largest free heap block
    unchanged at every sample, no WDT/accept/complete errors, no reboot.
    Adversarial socket tests (300 abort-while-parked, 40-wide same-kind GET and
    PUT storms, slow reader) left every socket free; the existing performance
    baseline, 60 s mutex stress and 71 Playwright UI tests all pass.

---

## 9. Known residual / out of scope

- **Handlers converted (2026-08-17, later the same day).** `power` GET/PUT,
  `volume` GET, `xmit` PUT, `msg` PUT and `time` PUT now go through the same
  snapshot / slot / park machinery (`REFRESH_POWER`, `REFRESH_VOLUME`,
  `SET_POWER`, `SET_XMIT`, `SET_MSG`, `SET_TIME`). The only code that still
  takes the radio mutex directly is FT8 (`handler_ft8.cpp`), the CW keyer's
  own background task (`handler_cat.cpp` `keyer_task`, already off the HTTP
  task), and boot-time `connect()`. Hardware: contract test 12/12 incl. power
  read-your-write and time sync.
- **Strict numeric params (2026-08-17).** The radio PUTs (`frequency`,
  `volume`, `xmit`, `msg`, `power`, `time`) used `atoi()`, so `power=abc`
  meant `power=0` — and a test probe did set a KX2 to 0 W. They now use
  `parse_long_param()` (`webserver.h`: sign + digits, whole string, no
  overflow) and reject junk/partial/negative values with 404 (400 for
  `time`) before anything reaches the radio. Contract test covers it.
- **Recovery probing (fixed 2026-08-17).** Originally only stale
  `frequency`/`mode` GETs armed the throttled recovery probe, so with no VFO
  poll running (observed on hardware: Chase tab on a phone, ⚫ for 35 s until
  a tab switch) the glyph never recovered. `connectionStatus` now arms a
  `REFRESH_XMIT` probe whenever the link is down (`TQ;`, ~100 ms; one per
  10 s), so the header self-heals on every tab. Verified: status-only
  polling, radio off→on, ⚫→🟢 within ≤10 s. SETs are still refused outright
  while down. Phase 2 may now gate VFO polling on connection state safely.
- **Client observation (unresolved, client-side).** During that stall the
  phone's Chase tab issued no `frequency`/`mode` GETs for 35 s after its
  initial fetch, although `connectionStatus` kept polling every 5 s. Not
  reproduced on demand; worth a look at `startGlobalVfoPolling` /
  `openTab`'s `pollingPaused` race if it recurs.
- **Client-side phase (Phase 2) — optional, not planned.** The original
  design (`2026-05-15-radio-decoupling-design.md` §Client-side) sketched a
  second phase: enable client-only buttons (QRT/Spot SMS, Polo, SOTAmāt)
  synchronously from `localStorage` instead of behind backend awaits, and
  gate VFO polling on connection state. Its goal — a usable QRT SMS button
  with the radio off — is already met by the server phase (hardware-confirmed
  2026-08-17), and the recovery-probe fix above removed the hazard that made
  polling-gating risky. Its implementation plan was deleted as unmaintained;
  the design spec still describes the idea if it is ever wanted.

---

## 10. Commit map

| Group | Commits |
|-------|---------|
| Design docs | `f82dc03` spec · `08f00c8` server + client plans |
| Build-break fix | `ec3e4fc` register `spots.jsgz` in the PlatformIO embed list |
| Pure logic (host-tested) | `f26e427` link-health · `40871a2` snapshot freshness |
| Concurrency core | `7a9c9a0` snapshot singleton · `2cecb16` radio service task · `c521b74` start at boot |
| Handler conversion | `1a26e4f` GET → snapshot · `c02f749` SET → enqueue |
| Hardening (post-hardware testing) | `dfccc72` skip-expired-SETs · `96c3d93` link-down CAT throttle · `2ddf754` per-op timeouts *(superseded)* · `7efe9fa` SET → 202 · `9160a48` decouple apply-deadline · `aa51055` pure-async SET + slot coalescing · `8d101e3` radio service yields to FT8 |
| Tests | `3d4eb92` responsiveness probe · `cc68f71` cold-probe + threshold |
| Doc upkeep | `7e528ba` · `fae5960` plan kept in sync with landed code |
| Close-out | `18794b9` phase validated |

The "Hardening" row reflects defects found only by running the firmware on
real hardware — most importantly that a SET handler waiting for an ack still
blocked the single HTTP task (fixed at the time by going pure-async,
`7efe9fa`→`aa51055`) and that the radio service worker contended with FT8 for
the radio mutex (fixed by the FT8-aware yield, `8d101e3`).

### Async-handler phase (after rebase onto `main`, 2026-08-17)

| Group | Commits |
|-------|---------|
| Design | `450823a` async-handler design spec |
| Pure logic (host-tested) | `9abb370` ParkTable |
| Plumbing | `413af53` park shim (async httpd) · `87b174e` worker reports completion + slot gen |
| Review fixes | `1abd5db` SET expiry is not a link failure · `22641fe` seed link health from boot connect · `ff88e56` resolve SSB sideband at apply time |
| Handler conversion | `0471603` GET handlers park on stale snapshot · `0a10a79` PUT handlers park; honest 204/500 |
| Tests | `8979f10` mock radio modes + HTTP contract test · `6967ce3` contract test hardware fixes |
| Docs | `3f92c03` async-handler contract; prune 202/503 macros |
| Post-hardware fixes (same day) | `ab9834c` connectionStatus arms link recovery probe · `8ae0fec` fast link-down detect and recovery · `0eb42aa` header status poll every 2 s |

This phase reverses the pure-async trade: the review found it cost read
latency (one poll behind), read-your-write for external clients (SOTAmat can
read/set frequency & mode), and honest SET failure. `httpd_req_async_handler_begin`
gives the same non-blocking property with `main`'s semantics.
