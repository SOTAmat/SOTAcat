# Radio service vs. FT8: mutex contention defect (and fix)

**Status:** Fixed in commit `8d101e3` (Task 7.12) — radio service worker
yields the radio to FT8 (skips all CAT work while `Ft8RadioExclusive` is set)
and bounds its lock-acquire with slot re-arm. Hardware-verified: an FT8
transmission overlapping VFO polls produces no `radio_service` watchdog
warning and FT8 timing is undisturbed.
**Date:** 2026-05-21 (found) / 2026-05-22 (fixed)
**Severity:** Medium — task-watchdog timeout on every FT8 transmission that
overlaps a VFO poll. Not a reboot (`CONFIG_ESP_TASK_WDT_PANIC` is unset), but
a real defect that had to be fixed before `radio-web-decoupling` merges.
**Hard constraint:** FT8 transmission timing takes precedence over all other
radio work. Any fix must leave FT8 timing strictly undisturbed.

---

## Background

Branch `radio-web-decoupling` moves all CAT I/O off the single HTTP server
task onto a dedicated **radio service task** (`src/radio_service.cpp`). HTTP
handlers now read a snapshot (GETs) or drop a command in a slot (SETs); the
worker task is meant to be the sole owner of the radio mutex
(`kxRadio.timed_lock`).

FT8 transmission (`src/handler_ft8.cpp`) is driven by the SOTAmat mobile app
via `/prepareft8`, `/ft8`, `/cancelft8` — never by the web UI. FT8 is
time-synced to 15 s windows with a 160 ms tone cadence; any disturbance
corrupts a transmission.

## The problem

### The false assumption

`src/radio_service.cpp` acquires the radio mutex with `portMAX_DELAY` and
justifies it (around line 60):

```
// portMAX_DELAY is safe: only this task ever takes the radio mutex,
// so it is never actually contended ...
```

**This is false.** `handler_ft8.cpp` takes `kxRadio.timed_lock` directly in
three places:

- `ft8_prepare_internal()` — `RADIO_LOCK_TIMEOUT_CRITICAL_MS`
- `xmit_ft8_task()` — `RADIO_LOCK_TIMEOUT_FT8_MS` (20 s)
- `cleanup_ft8_task()` — `RADIO_LOCK_TIMEOUT_CRITICAL_MS`

The radio service task is **not** the sole owner of the radio mutex. FT8
contends for it.

### How it fails

`xmit_ft8_task()` holds the radio mutex *continuously* across
`waitForFT8Window()` + all 79 tones + every queued repeat
(`handler_ft8.cpp`, the `TimedLock` block spanning roughly lines 369–488).
A single FT8 cycle holds the mutex for up to ~15 s (window wait) + ~12.6 s
(transmission) ≈ **27 s**, and longer with queued repeats.

The radio service worker:

- is registered with the **task watchdog** (`esp_task_wdt_add(NULL)`) and
  resets it only at the top of its loop (`esp_task_wdt_reset()`);
- drains its slots unconditionally on each wake — `do_refresh()` / `do_set()`
  both call `kxRadio.timed_lock(portMAX_DELAY, ...)` with **no FT8 awareness**.

So when a refresh or SET slot is pending while FT8 holds the mutex, the worker
blocks in `timed_lock` and cannot reset its watchdog:

```
t=0      xmit_ft8_task acquires radio mutex ───────────────────────┐
t=0.5    GET /frequency (browser/SOTAmat VFO poll), snapshot stale  │
         -> radio_service_request_refresh() -> worker wakes         │  mutex held
         -> do_refresh() -> kxRadio.timed_lock(portMAX_DELAY)        │  continuously:
         -> WORKER BLOCKS  (last esp_task_wdt_reset was at t~=0.5)   │  waitForFT8Window
t=20.5   !! TASK WATCHDOG FIRES on radio_service (20 s, no reset)    │  (0-15 s)
t~=27    xmit_ft8_task releases mutex -> worker unblocks ───────────┘  + ~12.6 s xmit
```

`CONFIG_ESP_TASK_WDT_TIMEOUT_S = 20` in `sdkconfig.seeed_xiao_esp32c3_*`.
`CONFIG_ESP_TASK_WDT_PANIC` is **not** set, so the result is a watchdog
warning + backtrace dumped to the console — not a reboot. But it spams on
essentially every FT8 transmission that overlaps a VFO poll, and the watchdog
ISR's backtrace print on the single-core ESP32-C3 is a plausible (if small)
timing perturbation near a tone boundary.

**Trigger condition:** any `GET /api/v1/frequency` or `GET /api/v1/mode`, or
any radio SET, arriving while FT8 holds the mutex. With the Run page open
(polls every 3 s) or SOTAmat polling VFO state between `/prepareft8` and
`/ft8`, this happens on most FT8 transmissions.

### Secondary regression

On `main`, `handler_frequency_get` and `get_radio_mode` (in
`handler_mode.cpp`) checked the global `Ft8RadioExclusive` flag and did **zero**
radio work during FT8. The branch dropped that check, so those GETs now enqueue
background refreshes during FT8 — which is what feeds the worker the slot it
then blocks on. (`handler_status.cpp` *kept* its `Ft8RadioExclusive` guard, so
`connectionStatus` is fine — the inconsistency is itself a tell.)

## What is NOT broken

The FT8 tone cadence itself is safe and must stay that way:

- **Mutual exclusion** — the worker cannot inject a CAT command mid-
  transmission; `xmit_ft8_task` holds the mutex the whole time.
- **Priority** — `xmit_ft8_task` runs at `SC_TASK_PRIORITY_HIGHEST` (8); the
  worker at `SC_TASK_PRIORITY_NORMAL` (5). A worker blocked on the mutex is in
  the Blocked state and burns no CPU.
- **Priority inheritance** — if the worker holds the mutex when FT8 wants it,
  the worker is boosted to 8 and finishes its CAT op promptly (tens of ms on a
  healthy radio); `waitForFT8Window()` then re-syncs to the next boundary.

The fix must preserve all three properties.

## The solution

Make the radio service **FT8-aware**, restoring `main`'s "leave the radio
entirely alone during FT8" behavior. Two changes, both in
`src/radio_service.cpp`:

### 1. Worker skips CAT work while FT8 is active (primary fix)

In `radio_service_task()`, before draining the SET and refresh slots, test the
global `Ft8RadioExclusive` flag (declared `extern bool` in `globals.h`):

- If FT8 is active: **do not drain any slot, do not touch the radio.** Leave
  refresh slots armed and SET slots in place, then loop. The loop still hits
  `esp_task_wdt_reset()` and `ulTaskNotifyTake(... 1000 ms)`, so the watchdog
  is fed every <=1 s.
- When FT8 clears (`cleanup_ft8_task` sets `Ft8RadioExclusive = false`), the
  next wake drains normally. A refresh slot simply runs late. A SET slot is
  re-evaluated by `do_set()`'s existing `expires_at_us` check — a SET older
  than `SET_APPLY_DEADLINE_MS` (5 s) is correctly skipped rather than applied
  long after the user's click.

This both eliminates the blocking-on-FT8-mutex path and matches the FT8
precedence constraint: the radio service performs no CAT I/O during FT8.

### 2. Bounded lock wait with slot re-arm (safety net)

Replace `kxRadio.timed_lock(portMAX_DELAY, ...)` in `do_refresh()` and
`do_set()` with a bounded timeout (a few seconds — well under the 20 s
watchdog; do **not** use `RADIO_LOCK_TIMEOUT_FT8_MS`). On failure to acquire:

- `do_refresh`: re-arm the refresh slot (`s_refresh_pending[idx] = true`) and
  return, so the refresh is retried on a later wake.
- `do_set`: if the command has not yet expired, re-store the `PendingSet`;
  if expired, drop it.

This closes the narrow TOCTOU window where FT8 sets `Ft8RadioExclusive` and
acquires the mutex between the worker's flag check and its `timed_lock` call,
and hardens the worker against any other long-duration mutex holder.

### 3. Fix the misleading comment

Delete/replace the "only this task ever takes the radio mutex, so it is never
actually contended" comment — it is factually wrong and led to the defect.

### Optional: restore the GET-handler guard

Re-add the `Ft8RadioExclusive` early-out to `handler_frequency_get` and
`get_radio_mode()` so they do not even enqueue refreshes during FT8. With fix
#1 this is defense-in-depth (an armed-but-skipped slot is harmless), but it
restores parity with `handler_status.cpp` and avoids needless slot churn.

## Notes / caveats for the implementer

- `Ft8RadioExclusive` is a plain `bool` in `globals.h`, written by the FT8
  tasks and read here from the worker — a benign data race in practice on this
  MCU (single-core, aligned bool), and consistent with how `handler_status.cpp`
  already reads it. Making it `std::atomic<bool>` would be a clean, optional
  hardening but is not required for the fix.
- Do not change FT8 task priorities, the FT8 mutex hold pattern, or
  `RADIO_LOCK_TIMEOUT_FT8_MS`. The fix is confined to the radio service.
- Keep the existing link-down probe throttle (`LINK_DOWN_PROBE_INTERVAL_US`)
  behavior; the FT8 skip is an additional, separate gate.

## Verification

- **Host unit reasoning:** the link-health / snapshot host tests
  (`test/host/`) are unaffected; no new host test is strictly required, but a
  worker-logic test would need ESP-IDF mocks.
- **Hardware checklist:**
  1. Start an FT8 transmission via SOTAmat with the Run page open in a
     browser (VFO polling active). Confirm: no task-watchdog warning for
     `radio_service` on the console for the full transmission, including a
     multi-repeat sequence.
  2. Confirm FT8 transmission timing is unchanged (tone count, ~12.6 s
     duration log line in `handler_ft8.cpp`).
  3. After FT8 completes, confirm `/api/v1/frequency` and `/api/v1/mode`
     refresh normally (snapshot updates resume).
  4. Issue a `PUT /api/v1/frequency` *during* an FT8 transmission; confirm it
     is refused synchronously with `503 "radio busy (FT8)"` (async-handler
     phase — it is not even enqueued), nothing is applied late, and FT8 is
     undisturbed.
- **Integration:** `test/integration/test_mutex_stress.py` asserts non-radio
  endpoint responsiveness; `test/integration/test_radio_contract.py` exercises
  the FT8 case against the mock server (`ft8: true` via `_debug/state` → PUT
  503, GET instant, ⚪).
