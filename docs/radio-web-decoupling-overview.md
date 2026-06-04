# Radio / Web Decoupling — Branch Overview

**Branch:** `radio-web-decoupling` · **Base:** `main` · **22 commits**
**Status:** server-side phase complete; hardware-validated (radio-off, rapid
tuning, SMS-QRT, FT8 overlap).

This document explains, end to end, what this branch changes relative to
`main` and why. For the original design rationale see
`docs/superpowers/specs/2026-05-15-radio-decoupling-design.md`; for the
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

### 4.1 GET — read the snapshot, never block

```
 browser ─GET /api/v1/frequency─▶ handler_frequency_get
                                    │  snap = radio_snapshot::get()   (take small lock, copy, release)
                                    │  fresh?  ──yes──▶ reply snap.frequency_hz        (~20 µs)
                                    │          ──no───▶ arm refresh slot, reply anyway (stale value)
                                    ▼
                          radio service task later refreshes the snapshot from the radio
```

- The GET response payload is **byte-identical to `main`** (bare value text).
  Existing consumers need no change.
- A stale snapshot still returns its last-known value immediately and arms a
  background refresh — it never waits on the radio.
- Cold start with nothing cached → fast failure (`HTTP 500` / `MODE_UNKNOWN`),
  never a hang.

### 4.2 SET — pure fire-and-forget, HTTP 202

```
 browser ─PUT /api/v1/frequency?frequency=─▶ handler_frequency_put
                                    │  link known-down? ──yes──▶ HTTP 503  (synchronous, ~µs)
                                    │  else: write SET slot, notify worker
                                    └────────────────────────▶ HTTP 202 Accepted  (~17 ms)
                                                                     │
                          radio service task drains the slot, runs the CAT tune,
                          updates the snapshot on success — client sees it on its next GET
```

A SET handler **never blocks the HTTP server task**. It returns 202 ("accepted,
applying") in ~17 ms regardless of how long the radio takes. The client
confirms the outcome through its normal VFO poll (the snapshot updates only on
a confirmed CAT success).

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
| **Snapshot freshness** | Each field carries a timestamp; `*_fresh(now)` is skew-safe (a clock before the stamp reads stale, never falsely fresh). | `radio_snapshot.h` |
| **Link-down throttle** | While link is down, refresh CAT probes are throttled to one per 10 s — otherwise a dead radio + active polling spins ~6 s CAT timeouts back-to-back and saturates Wi-Fi/HTTP scheduling. | `radio_service.cpp` |
| **SET apply-deadline** | A queued SET older than 5 s is skipped rather than applied late (don't retune long after the user's click). | `radio_service.cpp` |
| **FT8-aware yield** | FT8 transmission holds the radio mutex continuously (~27 s). The worker skips **all** CAT work while `Ft8RadioExclusive` is set, and bounds its lock-acquire to 3 s with slot re-arm as a TOCTOU safety net — so it never trips the 20 s task watchdog and never disturbs FT8 timing. | `radio_service.cpp` |
| **Watchdog discipline** | The worker resets the task watchdog before each drained CAT op. | `radio_service.cpp` |

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

| Endpoint kind | `main` | this branch |
|---------------|--------|-------------|
| `GET /api/v1/frequency`, `/mode`, `/connectionStatus` | value from a live CAT read (or short cache) | value from the snapshot; **payload byte-identical** |
| `PUT` (frequency / mode / volume / ATU) — success | `HTTP 200` after the radio confirmed | `HTTP 202 Accepted` — applied asynchronously, confirmed via a later GET |
| `PUT` — radio link down | (would block, then fail) | `HTTP 503 Service Unavailable` — synchronous, sub-millisecond |
| `PUT` — bad parameter (invalid freq/mode, volume unsupported) | `HTTP 404` / `500` | unchanged (`404` / `500`, pre-validation) |

Two new response helpers were added (`include/webserver.h`):
`REPLY_WITH_SERVICE_UNAVAILABLE` (503) and `REPLY_WITH_ACCEPTED` (202) —
ESP-IDF's `httpd_err_code_t` enum has no 503, so they set the status line
directly.

The `main`-era synchronous "confirmed 200 / confirmed 500" for SETs is gone:
with pure-async SETs, confirmation is observational (the client's VFO poll
shows whether the radio moved). This is the design trade that keeps the single
HTTP task from ever being starved.

---

## 7. File-by-file change map

### New files

| File | Purpose |
|------|---------|
| `include/radio_link_health.h` | Pure, header-only link-health state machine. Host-unit-testable. |
| `include/radio_snapshot.h` | `RadioSnapshotData` POD + skew-safe freshness predicates + the `radio_snapshot::` accessor API. |
| `src/radio_snapshot.cpp` | Mutex-guarded singleton wrapping `RadioSnapshotData`. |
| `src/radio_service.h` / `src/radio_service.cpp` | The radio service task, request slots, and the producer API (`radio_service_request_refresh`, `radio_service_set`, `radio_service_link_up`, `radio_service_start`). |
| `test/host/Makefile`, `test/host/test_radio_link_health.cpp`, `test/host/test_radio_snapshot.cpp` | Host-compiled (`g++ -std=c++17`) red-green unit tests for the two pure-logic units. |
| `docs/superpowers/specs/...-design.md`, `docs/superpowers/plans/...-server.md`, `...-client.md` | Design spec and the server / client implementation plans. |

### Modified files

| File | Change |
|------|--------|
| `src/handler_frequency.cpp` | GET reads the snapshot; PUT is pure-async (202/503). Old 200 ms frequency cache removed. |
| `src/handler_mode.cpp` | `get_radio_mode` reads the snapshot; `handler_mode_put` pure-async; SSB resolves LSB/USB from the snapshot. Old mode cache removed. |
| `src/handler_status.cpp` | `connectionStatus` reads `radio_service_link_up()` (live) instead of the never-cleared `is_connected()`, and reads xmit-state from the snapshot. |
| `src/handler_volume.cpp`, `src/handler_atu.cpp` | PUT is pure-async (202/503). |
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
  (failure→down at threshold, success→up, anti-flap) and `RadioSnapshot`
  (freshness boundary, clock-skew canary) — pure logic, compiled with `g++`,
  no hardware.
- **Integration** (`test/integration/test_mutex_stress.py`): a cold-probe
  asserts `/version`, `/frequency`, `/connectionStatus` each return < 200 ms
  single-client; an under-load probe asserts `/version` p95 < 2 s while radio
  endpoints are hammered.
- **Hardware-validated:** radio-off responsiveness (~20 ms vs multi-second
  hangs), 12-PUT rapid-tune burst (all 202 in 15–27 ms, no VFO aborts),
  band-switch tunes, the QRT SMS button usable with the radio off, and an FT8
  transmission overlapping VFO polls with no `radio_service` watchdog warning.

---

## 9. Known residual / out of scope

- **Unconverted handlers.** `handler_cat.cpp` (TX/RX, power, keyer, message
  play), `handler_ft8.cpp`, `handler_time.cpp`, and the volume **GET** still
  take the radio mutex directly. The radio service worker's FT8-yield and
  bounded lock-acquire make this safe (no watchdog trip, no deadlock).
  Converting them fully is possible follow-up work.
- **Client-side phase (Phase 2).** `docs/superpowers/plans/...-client.md`
  describes a second phase — enable client-only buttons synchronously from
  `localStorage`, gate VFO polling on `connectionState` — not executed on this
  branch. The server phase alone already restores the reported behavior
  (responsive UI + usable QRT SMS button with the radio off).

---

## 10. Commit map (22 commits)

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
blocked the single HTTP task (fixed by going pure-async, `7efe9fa`→`aa51055`)
and that the radio service worker contended with FT8 for the radio mutex
(fixed by the FT8-aware yield, `8d101e3`).
