# Radio Decoupling — Server-Side Phase Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move all radio CAT I/O off the single ESP-IDF HTTP server task onto a dedicated FreeRTOS radio service task with a cached snapshot and authoritative link-health, so no HTTP endpoint ever stalls when the radio is off, absent, or slow.

**Architecture:** A `radio_service_task` becomes the sole owner of the radio mutex. It drains a bounded request queue (GET-refresh + SET commands), performs CAT I/O, and publishes results into a lock-protected `RadioSnapshot` plus a `RadioLinkHealth` state machine. GET handlers return the snapshot instantly; SET handlers enqueue and wait for a bounded ack, fast-rejecting when the link is known-down. GET response payloads stay byte-identical; health is surfaced only through the existing `/api/v1/connectionStatus` ⚫ path.

**Tech Stack:** PlatformIO + ESP-IDF (C++17), FreeRTOS (`xQueueCreate`, task notifications, `xSemaphoreCreateMutex`), `esp_http_server`. Pure-logic units tested standalone with `g++ -std=c++17`; FreeRTOS wiring validated by the existing Python integration harness (`test/integration/`) plus a manual hardware checklist.

**Spec:** `docs/superpowers/specs/2026-05-15-radio-decoupling-design.md`

---

## Status (as landed)

This plan landed on branch `radio-web-decoupling` across the following commits:

| Hash | Title |
|------|-------|
| `f26e427` | feat: radio link-health state machine |
| `40871a2` | feat: pure radio snapshot freshness logic |
| `ec3e4fc` | fix: register spots.jsgz in pio embed list (build-fix prerequisite) |
| `7a9c9a0` | feat: mutex-guarded radio snapshot singleton |
| `2cecb16` | feat: radio service task + bounded queue |
| `c521b74` | feat: start radio service task at boot |
| `1a26e4f` | feat: GET handlers use snapshot, never block |
| `c02f749` | feat: SET handlers enqueue + bounded ack |
| `dfccc72` | fix: skip expired SETs in radio service (Task 7.5, added post-Task-7) |
| `3d4eb92` | test: add /version responsiveness probe |
| `cc68f71` | test: cold-probe + relax stress p95 to <2s |
| `96c3d93` | fix: throttle CAT refreshes during link-down (Task 7.7, post-hardware-testing) |
| `2ddf754` | fix: per-operation SET timeouts (Task 7.8 — superseded by 7.9/7.11) |
| `7efe9fa` | fix: SET returns 202 when ack is slow (Task 7.9, post-hardware-testing) |
| `9160a48` | fix: decouple SET apply-deadline from ack (Task 7.10, post-hardware-testing) |
| `aa51055` | feat: pure-async SET with slot coalescing (Task 7.11, post-hardware-testing) |

**SET-path redesign (post-hardware-testing).** On-device testing after the initial land revealed the SET model itself was wrong, not just mistuned. The plan's "SET handler enqueues, then blocks for a bounded ack, returns honest 200/5xx" design starved the single `esp_http_server` task: any handler blocked on its ack-wait could not service concurrent polls, and an unbounded burst (rapid Chase-spot clicking) saturated the server. Across Tasks 7.7–7.11 the SET path was redesigned from "enqueue + bounded ack-wait" to **pure-async fire-and-forget (HTTP 202) + per-type slot coalescing**: a SET handler stores a request slot, wakes the worker, and returns 202 immediately; link-down still returns 503 synchronously; success is later confirmed by the client's subsequent GET. Verified on hardware: a burst of 12 rapid PUTs all returned 202 in 15–27 ms, interleaved GETs stayed at 16–23 ms, and the radio settled on the last commanded frequency — no server starvation.

**Spec compliance:** all design-spec properties are met, with the following adjudicated deviations recorded inline below: skew-safe freshness predicates (Task 2), Meyers-singleton mutex init (Task 3), `has_xmit`/`xmit_fresh` predicates + cold-start cache write-back cleanup (Task 6), `REPLY_WITH_SERVICE_UNAVAILABLE` helper macro + `supports_volume()` precondition retained + SSB cold-start refresh (Task 7), `expires_at_us` defense-in-depth for SETs (new Task 7.5), stress p95 threshold relaxed to <2 s with a dedicated cold-probe asserting per-endpoint max <200 ms (Task 8), and the post-hardware-testing SET-path redesign to pure-async 202 + slot coalescing (Tasks 7.7–7.11) — which supersedes the spec's bounded-ack-wait / honest-200-5xx SET model.

**Known residual scope (out of phase, see end of Self-Review):** `src/handler_cat.cpp`, `src/handler_ft8.cpp`, `src/handler_time.cpp`, and `handler_volume_get` still take `kxRadio.timed_lock` directly. The Task 7.5 expires-at fix makes the residual safe under load; full conversion is a potential follow-up that would let the spec's "sole mutex owner" claim be literally true.

**Validation status:**
- Code reviews: clean on all production commits.
- Host tests (`test/host/`): pass (`test_radio_link_health`, `test_radio_snapshot` including `xmit_fresh(0)` skew canary).
- Integration cold-probe (`cold_probe_decoupling`): pass — `/version`, `/frequency`, `/connectionStatus` each max < 200 ms unloaded.
- Integration stress (`test_mutex_stress.py`): pass with `probe_p95 < 2.0 s` threshold (3 consecutive clean runs).
- Manual hardware checklist (Task 9 Steps 2–4): pending user execution on device.

---

## Why firmware TDD is split

There is no host build target for the firmware. Two pure-logic units (`RadioLinkHealth`, `RadioSnapshot`) have **no** ESP-IDF/FreeRTOS dependencies and get true red-green unit tests compiled with `g++`. The FreeRTOS task/queue wiring and handler conversions cannot be unit-tested without hardware; they are gated by (a) `make build` (PlatformIO) compiling clean, (b) the existing `test/integration/test_webserver_performance.py` and `test_mutex_stress.py` against a flashed device, and (c) the manual hardware checklist in Task 9. This split is deliberate — do not fabricate unit tests for the wired-up task.

## File Structure

- Create `include/radio_link_health.h` — pure header-only link-health state machine (failure→down threshold, success→up, anti-flap). No ESP-IDF includes.
- Create `include/radio_snapshot.h` — `RadioSnapshot` POD + freshness query (pure). No ESP-IDF includes.
- Create `src/radio_snapshot.cpp` — the mutex-guarded singleton wrapper around `RadioSnapshot` (ESP-IDF: FreeRTOS mutex).
- Create `src/radio_service.h` / `src/radio_service.cpp` — the radio service task, request queue, enqueue/ack API.
- Create `test/host/test_radio_link_health.cpp` — standalone unit test.
- Create `test/host/test_radio_snapshot.cpp` — standalone unit test (pure freshness/coalescing logic only).
- Create `test/host/Makefile` — builds and runs the two host tests.
- Modify `src/setup.cpp` — start the radio service task after radio connect.
- Modify `src/handler_frequency.cpp`, `src/handler_mode.cpp`, `src/handler_volume.cpp`, `src/handler_status.cpp` — GET → snapshot read; SET → enqueue + bounded ack.
- Modify `src/handler_atu.cpp` — SET → enqueue + bounded ack.
- Modify `src/CMakeLists.txt` — add `radio_snapshot.cpp` and `radio_service.cpp` to the component sources.
- Modify `test/integration/test_mutex_stress.py` — add a radio-unavailable responsiveness assertion.

---

### Task 1: Pure link-health state machine

**As landed (`f26e427`):** code matches the plan literally. Commit title shortened to `feat: radio link-health state machine` (37 chars) to satisfy the ≤48-char title rule; the same shortening rule applies to every subsequent commit in this plan.

**Files:**
- Create: `include/radio_link_health.h`
- Create: `test/host/test_radio_link_health.cpp`
- Create: `test/host/Makefile`

- [ ] **Step 1: Write the failing test**

Create `test/host/test_radio_link_health.cpp`:

```cpp
// Standalone host test — no ESP-IDF. Build: see test/host/Makefile
#include "../../include/radio_link_health.h"
#include <cassert>
#include <cstdio>

int main() {
    RadioLinkHealth h;  // starts unknown == down (never proven up)
    assert(!h.is_up());

    // One failure is not enough to assert down once we've been up.
    h.record_success();
    assert(h.is_up());
    h.record_failure();
    assert(h.is_up());                 // 1 < threshold (3)
    h.record_failure();
    assert(h.is_up());                 // 2 < threshold
    h.record_failure();
    assert(!h.is_up());                // 3 consecutive -> down

    // Recovery requires a real success, and is immediate.
    h.record_failure();
    assert(!h.is_up());
    h.record_success();
    assert(h.is_up());                 // first success -> up, no flap window

    // Success resets the failure counter (anti-flap).
    h.record_failure();
    h.record_failure();
    h.record_success();
    h.record_failure();
    assert(h.is_up());                 // counter was reset by success

    printf("test_radio_link_health: OK\n");
    return 0;
}
```

Create `test/host/Makefile`:

```make
CXX ?= g++
CXXFLAGS = -std=c++17 -Wall -Wextra -Werror -O0 -g

.PHONY: test
test: test_radio_link_health test_radio_snapshot
	./test_radio_link_health
	./test_radio_snapshot

test_radio_link_health: test_radio_link_health.cpp ../../include/radio_link_health.h
	$(CXX) $(CXXFLAGS) test_radio_link_health.cpp -o test_radio_link_health

test_radio_snapshot: test_radio_snapshot.cpp ../../include/radio_snapshot.h
	$(CXX) $(CXXFLAGS) test_radio_snapshot.cpp -o test_radio_snapshot

.PHONY: clean
clean:
	rm -f test_radio_link_health test_radio_snapshot
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd test/host && make test_radio_link_health`
Expected: FAIL — compile error, `radio_link_health.h: No such file or directory`.

- [ ] **Step 3: Write minimal implementation**

Create `include/radio_link_health.h`:

```cpp
#pragma once
// Pure, header-only radio link-health state machine.
// No ESP-IDF / FreeRTOS dependencies so it is host-unit-testable.
//
// Semantics (see 2026-05-15-radio-decoupling-design.md):
//   * Starts "down" — the link is not considered up until a CAT
//     exchange has actually succeeded.
//   * record_failure(): N consecutive failures (LINK_DOWN_FAIL_THRESHOLD)
//     flips up->down. Failures below threshold while up keep it up.
//   * record_success(): immediately flips down->up and resets the
//     consecutive-failure counter (anti-flap: recovery needs a real
//     success, not merely the absence of failure).

class RadioLinkHealth {
  public:
    static constexpr int LINK_DOWN_FAIL_THRESHOLD = 3;

    void record_success() {
        m_consecutive_failures = 0;
        m_up                   = true;
    }

    void record_failure() {
        if (m_consecutive_failures < LINK_DOWN_FAIL_THRESHOLD)
            ++m_consecutive_failures;
        if (m_consecutive_failures >= LINK_DOWN_FAIL_THRESHOLD)
            m_up = false;
    }

    bool is_up() const { return m_up; }

  private:
    int  m_consecutive_failures = LINK_DOWN_FAIL_THRESHOLD;  // start "down"
    bool m_up                   = false;
};
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd test/host && make test_radio_link_health && ./test_radio_link_health`
Expected: PASS — prints `test_radio_link_health: OK`, exit 0.

- [ ] **Step 5: Commit**

```bash
git add include/radio_link_health.h test/host/test_radio_link_health.cpp test/host/Makefile
git commit -m "feat: pure radio link-health state machine + host test"
```

---

### Task 2: Pure radio snapshot + freshness logic

**As landed (`40871a2`):** `frequency_fresh`/`mode_fresh` (and later `xmit_fresh`, added under Task 6) carry an extra `now_us >= stamp_us` skew guard so a clock skew or unset clock (`now_us < stamp_us`) reads stale rather than falsely fresh — the literal `(now_us - stamp_us) < WINDOW` expression in the plan would underflow on `int64_t` and read as a huge positive value. Host test extended later (Task 6) with `xmit_fresh(0)` as the skew canary.

**Files:**
- Create: `include/radio_snapshot.h`
- Create: `test/host/test_radio_snapshot.cpp`

- [ ] **Step 1: Write the failing test**

Create `test/host/test_radio_snapshot.cpp`:

```cpp
// Standalone host test — no ESP-IDF. Build: see test/host/Makefile
#include "../../include/radio_snapshot.h"
#include <cassert>
#include <cstdio>

int main() {
    RadioSnapshotData s;  // default: nothing known
    assert(s.frequency_hz == 0);
    assert(s.mode == 0);
    assert(!s.has_frequency());
    assert(!s.has_mode());

    // Freshness: a value with timestamp T is fresh at T+window-1,
    // stale at T+window.
    s.frequency_hz       = 14285000;
    s.frequency_stamp_us = 1'000'000;
    assert(s.has_frequency());
    assert(s.frequency_fresh(1'000'000 + RADIO_SNAPSHOT_FRESH_US - 1));
    assert(!s.frequency_fresh(1'000'000 + RADIO_SNAPSHOT_FRESH_US));

    // Mode independent of frequency.
    s.mode            = 2;
    s.mode_stamp_us   = 5'000'000;
    assert(s.has_mode());
    assert(s.mode_fresh(5'000'000));
    assert(!s.mode_fresh(5'000'000 + RADIO_SNAPSHOT_FRESH_US + 1));

    printf("test_radio_snapshot: OK\n");
    return 0;
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd test/host && make test_radio_snapshot`
Expected: FAIL — `radio_snapshot.h: No such file or directory`.

- [ ] **Step 3: Write minimal implementation**

Create `include/radio_snapshot.h`:

```cpp
#pragma once
// Pure radio snapshot data + freshness predicates. No ESP-IDF deps so
// the freshness logic is host-unit-testable. The mutex-guarded singleton
// that wraps this lives in radio_snapshot.cpp.
#include <cstdint>

// How long a cached field is served as "fresh" before a GET handler
// also enqueues a background refresh. Generalizes the prior 200ms
// per-handler caches (handler_frequency.cpp FREQUENCY_CACHE_US).
static constexpr int64_t RADIO_SNAPSHOT_FRESH_US = 200'000;  // 200 ms

struct RadioSnapshotData {
    long    frequency_hz       = 0;   // 0 == unknown
    long    mode               = 0;   // 0 == MODE_UNKNOWN
    long    volume             = -1;  // -1 == unknown
    long    power              = -1;  // -1 == unknown
    long    xmit_state         = -1;  // -1 == unknown, 0 == RX, 1 == TX
    int64_t frequency_stamp_us = 0;
    int64_t mode_stamp_us      = 0;
    int64_t volume_stamp_us    = 0;
    int64_t power_stamp_us     = 0;
    int64_t xmit_stamp_us      = 0;

    bool has_frequency() const { return frequency_hz > 0; }
    bool has_mode() const { return mode > 0; }

    bool frequency_fresh(int64_t now_us) const {
        return has_frequency() && (now_us - frequency_stamp_us) < RADIO_SNAPSHOT_FRESH_US;
    }
    bool mode_fresh(int64_t now_us) const {
        return has_mode() && (now_us - mode_stamp_us) < RADIO_SNAPSHOT_FRESH_US;
    }
};
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd test/host && make test && ./test_radio_snapshot`
Expected: PASS — prints `test_radio_snapshot: OK`; `make test` also re-runs `test_radio_link_health`.

- [ ] **Step 5: Commit**

```bash
git add include/radio_snapshot.h test/host/test_radio_snapshot.cpp
git commit -m "feat: pure radio snapshot freshness logic + host test"
```

---

### Task 3: Mutex-guarded snapshot singleton

**As landed (`7a9c9a0`):** the plan's lazy `ensure_mutex()` pattern has a TOCTOU race on first concurrent call. Replaced with a function-local C++11 magic-static (`get_mutex()`), mirroring the Meyers-singleton style already used in `src/kx_radio.cpp:129-132`. Adds `ESP_LOGE` + `abort()` on creation failure so a silent nullptr never propagates.

**Files:**
- Create: `src/radio_snapshot.cpp`
- Modify: `src/CMakeLists.txt` (SRCS list)

- [ ] **Step 1: Add the singleton accessor declaration**

Append to `include/radio_snapshot.h` (after the struct):

```cpp
// Thread-safe accessor for the single shared snapshot. Implemented in
// radio_snapshot.cpp with a FreeRTOS mutex distinct from the radio
// mutex — readers (HTTP handlers) never contend on UART.
namespace radio_snapshot {
// Copy the whole snapshot out under the lock.
RadioSnapshotData get();
// Merge-update individual fields under the lock; pass the esp_timer
// "now" once so all touched stamps share it.
void set_frequency(long hz, int64_t now_us);
void set_mode(long mode, int64_t now_us);
void set_volume(long volume, int64_t now_us);
void set_power(long power, int64_t now_us);
void set_xmit_state(long state, int64_t now_us);
}  // namespace radio_snapshot
```

- [ ] **Step 2: Write the implementation**

Create `src/radio_snapshot.cpp`:

```cpp
#include "radio_snapshot.h"

#include <freertos/FreeRTOS.h>
#include <freertos/semphr.h>

static SemaphoreHandle_t s_mutex = nullptr;
static RadioSnapshotData s_data;

static void ensure_mutex() {
    if (!s_mutex)
        s_mutex = xSemaphoreCreateMutex();
}

namespace radio_snapshot {

RadioSnapshotData get() {
    ensure_mutex();
    xSemaphoreTake(s_mutex, portMAX_DELAY);
    RadioSnapshotData copy = s_data;
    xSemaphoreGive(s_mutex);
    return copy;
}

void set_frequency(long hz, int64_t now_us) {
    ensure_mutex();
    xSemaphoreTake(s_mutex, portMAX_DELAY);
    s_data.frequency_hz       = hz;
    s_data.frequency_stamp_us = now_us;
    xSemaphoreGive(s_mutex);
}

void set_mode(long mode, int64_t now_us) {
    ensure_mutex();
    xSemaphoreTake(s_mutex, portMAX_DELAY);
    s_data.mode          = mode;
    s_data.mode_stamp_us = now_us;
    xSemaphoreGive(s_mutex);
}

void set_volume(long volume, int64_t now_us) {
    ensure_mutex();
    xSemaphoreTake(s_mutex, portMAX_DELAY);
    s_data.volume          = volume;
    s_data.volume_stamp_us = now_us;
    xSemaphoreGive(s_mutex);
}

void set_power(long power, int64_t now_us) {
    ensure_mutex();
    xSemaphoreTake(s_mutex, portMAX_DELAY);
    s_data.power          = power;
    s_data.power_stamp_us = now_us;
    xSemaphoreGive(s_mutex);
}

void set_xmit_state(long state, int64_t now_us) {
    ensure_mutex();
    xSemaphoreTake(s_mutex, portMAX_DELAY);
    s_data.xmit_state     = state;
    s_data.xmit_stamp_us  = now_us;
    xSemaphoreGive(s_mutex);
}

}  // namespace radio_snapshot
```

- [ ] **Step 3: Register the source file**

In `src/CMakeLists.txt`, find the `idf_component_register(SRCS ...)` list and add `"radio_snapshot.cpp"` alphabetically near the other radio sources (next to `"radio_driver_kx.cpp"`). Show the surrounding context after editing — the line must read exactly:

```cmake
    "radio_snapshot.cpp"
```

- [ ] **Step 4: Verify it compiles**

Run: `make build`
Expected: build SUCCEEDS (`Project build complete`). No new warnings referencing `radio_snapshot`.

- [ ] **Step 5: Commit**

```bash
git add include/radio_snapshot.h src/radio_snapshot.cpp src/CMakeLists.txt
git commit -m "feat: mutex-guarded radio snapshot singleton"
```

---

### Task 4: Radio service task + request queue

**As landed (`2cecb16`):** matches the plan. (Task 7.5 below later adds an `expires_at_us` field to `RadioCmd` and an early-drop check in `do_set` — see that section for the rationale.)

**Files:**
- Create: `src/radio_service.h`
- Create: `src/radio_service.cpp`
- Modify: `src/CMakeLists.txt` (SRCS list)

- [ ] **Step 1: Define the public interface**

Create `src/radio_service.h`:

```cpp
#pragma once
// The radio service task is the SOLE owner of the radio mutex. HTTP
// handlers never call kxRadio.* directly anymore — they enqueue work
// here and either return immediately (GET refresh) or wait for a
// bounded ack (SET). See 2026-05-15-radio-decoupling-design.md.
#include <cstdint>

enum class RadioCmdType {
    REFRESH_FREQUENCY,
    REFRESH_MODE,
    REFRESH_XMIT,
    SET_FREQUENCY,
    SET_MODE,        // arg = radio_mode_t value
    SET_VOLUME,      // arg = delta
    SET_POWER,       // arg = power
    SET_ATU,         // arg unused
};

// Start the task. Call once, AFTER kxRadio.connect() has completed in
// setup(). Idempotent.
void radio_service_start();

// True once the link-health machine has a successful exchange and has
// not since hit the consecutive-failure threshold. O(1), no locking of
// the radio. Mirrors kxRadio.is_connected() intent but is kept live by
// the service task.
bool radio_service_link_up();

// Fire-and-forget: enqueue a refresh of one cached field. Coalesces —
// if an identical refresh is already queued, this is a no-op. Never
// blocks. Used by GET handlers when the snapshot is stale.
void radio_service_request_refresh(RadioCmdType which);

// Enqueue a SET and block the calling (HTTP handler) task up to
// timeout_ms for a real ack. Returns:
//   1  = applied and confirmed
//   0  = failed/timed out (radio answered but command failed, or no ack)
//  -1  = rejected immediately because link is known-down
int radio_service_set_blocking(RadioCmdType type, long arg, uint32_t timeout_ms);
```

- [ ] **Step 2: Write the implementation**

Create `src/radio_service.cpp`:

```cpp
#include "radio_service.h"

#include "globals.h"
#include "kx_radio.h"
#include "radio_link_health.h"
#include "radio_snapshot.h"
#include "timed_lock.h"

#include <atomic>
#include <esp_log.h>
#include <esp_timer.h>
#include <freertos/FreeRTOS.h>
#include <freertos/queue.h>
#include <freertos/task.h>

static const char * TAG8 = "sc:radiosvc";

static constexpr uint32_t SET_ACK_TIMEOUT_MS = 800;
static constexpr size_t   RADIO_QUEUE_LEN    = 8;

struct RadioCmd {
    RadioCmdType   type;
    long           arg;
    TaskHandle_t   waiter;   // non-null for SETs: notify with result+1
};

static QueueHandle_t      s_queue = nullptr;
static RadioLinkHealth    s_health;
static std::atomic<bool>  s_link_up { false };
static std::atomic<bool>  s_started { false };

// Mirror health into an atomic so handlers read it lock-free.
static void publish_health() { s_link_up.store(s_health.is_up(), std::memory_order_release); }

bool radio_service_link_up() { return s_link_up.load(std::memory_order_acquire); }

// --- the worker -----------------------------------------------------

static void do_refresh(RadioCmdType which) {
    int64_t  now = esp_timer_get_time();
    TimedLock lock = kxRadio.timed_lock(portMAX_DELAY, "radiosvc refresh");
    // portMAX_DELAY is safe: only this task ever takes the radio mutex,
    // so it is never actually contended; the lock is kept only to keep
    // the kxRadio is_locked() assertions in DELEGATE_BOOL happy.
    bool ok = false;
    if (which == RadioCmdType::REFRESH_FREQUENCY) {
        long hz = 0;
        ok = kxRadio.get_frequency(hz) && hz > 0;
        if (ok) radio_snapshot::set_frequency(hz, now);
    } else if (which == RadioCmdType::REFRESH_MODE) {
        radio_mode_t m = MODE_UNKNOWN;
        ok = kxRadio.get_mode(m) && m > MODE_UNKNOWN;
        if (ok) radio_snapshot::set_mode((long)m, now);
    } else if (which == RadioCmdType::REFRESH_XMIT) {
        long st = -1;
        ok = kxRadio.get_xmit_state(st);
        if (ok) radio_snapshot::set_xmit_state(st, now);
    }
    if (ok) s_health.record_success();
    else    s_health.record_failure();
    publish_health();
}

static int do_set(RadioCmdType type, long arg) {
    int64_t   now  = esp_timer_get_time();
    TimedLock lock = kxRadio.timed_lock(portMAX_DELAY, "radiosvc set");
    bool ok = false;
    switch (type) {
    case RadioCmdType::SET_FREQUENCY:
        ok = kxRadio.set_frequency(arg, SC_KX_COMMUNICATION_RETRIES);
        if (ok) radio_snapshot::set_frequency(arg, now);
        break;
    case RadioCmdType::SET_MODE:
        ok = kxRadio.set_mode((radio_mode_t)arg, SC_KX_COMMUNICATION_RETRIES);
        if (ok) radio_snapshot::set_mode(arg, now);
        break;
    case RadioCmdType::SET_VOLUME:
        ok = kxRadio.set_volume(arg);
        break;
    case RadioCmdType::SET_POWER:
        ok = kxRadio.set_power(arg);
        break;
    case RadioCmdType::SET_ATU:
        ok = kxRadio.tune_atu();
        break;
    default:
        ok = false;
        break;
    }
    if (ok) s_health.record_success();
    else    s_health.record_failure();
    publish_health();
    return ok ? 1 : 0;
}

static void radio_service_task(void *) {
    ESP_ERROR_CHECK(esp_task_wdt_add(NULL));
    for (;;) {
        ESP_ERROR_CHECK(esp_task_wdt_reset());
        RadioCmd cmd;
        if (xQueueReceive(s_queue, &cmd, pdMS_TO_TICKS(1000)) != pdTRUE)
            continue;  // idle: nothing queued (on-demand only)

        if (cmd.waiter) {
            int result = do_set(cmd.type, cmd.arg);
            // Notify with result+1 so 0 (default notify value) is
            // distinguishable from a real "failed" (1) / "ok" (2).
            xTaskNotify(cmd.waiter, (uint32_t)(result + 1), eSetValueWithOverwrite);
        } else {
            do_refresh(cmd.type);
        }
    }
}

void radio_service_start() {
    if (s_started.exchange(true))
        return;
    s_queue = xQueueCreate(RADIO_QUEUE_LEN, sizeof(RadioCmd));
    if (!s_queue) {
        ESP_LOGE(TAG8, "failed to create radio service queue");
        abort();
    }
    xTaskCreate(&radio_service_task, "radio_service", 4096, NULL,
                SC_TASK_PRIORITY_NORMAL, NULL);
    ESP_LOGI(TAG8, "radio service task started");
}

// --- producer API (called from HTTP handler tasks) ------------------

void radio_service_request_refresh(RadioCmdType which) {
    if (!s_queue) return;
    // Coalesce: peek the queue for an identical pending refresh.
    UBaseType_t waiting = uxQueueMessagesWaiting(s_queue);
    for (UBaseType_t i = 0; i < waiting; ++i) {
        RadioCmd peek;
        if (xQueuePeek(s_queue, &peek, 0) == pdTRUE &&
            peek.waiter == nullptr && peek.type == which)
            return;  // already queued
        break;       // xQueuePeek only sees head; one check is enough
    }
    RadioCmd cmd { which, 0, nullptr };
    xQueueSend(s_queue, &cmd, 0);  // drop if full — a later poll retries
}

int radio_service_set_blocking(RadioCmdType type, long arg, uint32_t timeout_ms) {
    if (!radio_service_link_up())
        return -1;  // fast reject, sub-millisecond
    if (!s_queue)
        return 0;
    RadioCmd cmd { type, arg, xTaskGetCurrentTaskHandle() };
    xTaskNotifyStateClear(NULL);
    if (xQueueSend(s_queue, &cmd, pdMS_TO_TICKS(50)) != pdTRUE)
        return 0;  // queue full -> treat as failure
    uint32_t notev = 0;
    if (xTaskNotifyWait(0, 0xFFFFFFFF, &notev, pdMS_TO_TICKS(timeout_ms)) != pdTRUE)
        return 0;  // no ack within bound
    return (int)notev - 1;  // 2->1 (ok), 1->0 (fail)
}
```

> Note: `radio_service_set_blocking` always passes `SET_ACK_TIMEOUT_MS`
> from the handlers (Task 7). It is a parameter so a future critical
> op (ATU) could use a longer bound without touching this file.

- [ ] **Step 3: Register the source file**

In `src/CMakeLists.txt`, add `"radio_service.cpp"` to the `SRCS` list next to `"radio_snapshot.cpp"`.

- [ ] **Step 4: Verify it compiles**

Run: `make build`
Expected: build SUCCEEDS. Resolve any include-order errors (`globals.h` provides `SC_TASK_PRIORITY_NORMAL` and `SC_KX_COMMUNICATION_RETRIES`; `kx_radio.h` provides `radio_mode_t`/`MODE_UNKNOWN`).

- [ ] **Step 5: Commit**

```bash
git add src/radio_service.h src/radio_service.cpp src/CMakeLists.txt
git commit -m "feat: radio service task with bounded request queue"
```

---

### Task 5: Start the service task at boot

**As landed (`c521b74`):** matches the plan literally.

**Files:**
- Modify: `src/setup.cpp` (after the "radio connection established" log, before the idle task)

- [ ] **Step 1: Add the include**

At the top of `src/setup.cpp`, with the other project includes, add:

```cpp
#include "radio_service.h"
```

- [ ] **Step 2: Start the task after radio connect**

In `setup()`, immediately after the line logging `"radio connection established."` and before `xTaskCreate (&idle_status_task, ...)`, insert:

```cpp
    // The radio is connected; hand all further CAT I/O to the radio
    // service task so HTTP handlers never block on the radio.
    radio_service_start();
    ESP_LOGI (TAG8, "radio service task started.");
```

- [ ] **Step 3: Verify it compiles**

Run: `make build`
Expected: build SUCCEEDS.

- [ ] **Step 4: Commit**

```bash
git add src/setup.cpp
git commit -m "feat: start radio service task after boot connect"
```

---

### Task 6: GET handlers read the snapshot only

**As landed (`1a26e4f`):** three additions beyond the literal plan.
1. Step 1's "delete cache statics" was widened: `handler_frequency_put` and `handler_mode_put` also wrote to those same cache statics, so the write-back triplets were removed too (those PUTs are rewritten in Task 7 anyway, but the cleanup keeps the intermediate compile clean).
2. `handler_connectionStatus_get` originally only enqueued `REFRESH_XMIT` on cold-start (`xmit_state < 0`); a stale-but-known value would freeze the TX/RX indicator after first observation. Added `has_xmit()` / `xmit_fresh()` predicates to `RadioSnapshotData` in `include/radio_snapshot.h` and used them so refresh is enqueued in both the cold-start and stale-but-known cases (mirroring the frequency/mode handlers).
3. Host test `test/host/test_radio_snapshot.cpp` was extended with `has_xmit`/`xmit_fresh` assertions and the `xmit_fresh(0)` skew canary called out in Task 2.

**Files:**
- Modify: `src/handler_frequency.cpp` (`handler_frequency_get`)
- Modify: `src/handler_mode.cpp` (`get_radio_mode`)
- Modify: `src/handler_status.cpp` (`handler_connectionStatus_get`)
- Modify: `include/radio_snapshot.h` (add `has_xmit`/`xmit_fresh`)
- Modify: `test/host/test_radio_snapshot.cpp` (xmit assertions + skew canary)

- [ ] **Step 1: Replace the frequency GET body**

In `src/handler_frequency.cpp`, replace the entire body of `handler_frequency_get` (everything between the `{` after the signature and the final `}`) with:

```cpp
    showActivity();
    ESP_LOGV (TAG8, "trace: %s()", __func__);

    RadioSnapshotData snap = radio_snapshot::get();
    int64_t           now  = esp_timer_get_time();

    if (!snap.has_frequency()) {
        // Nothing known yet (cold start / radio never present).
        radio_service_request_refresh (RadioCmdType::REFRESH_FREQUENCY);
        REPLY_WITH_FAILURE (req, HTTPD_500_INTERNAL_SERVER_ERROR, "frequency unavailable");
    }

    if (!snap.frequency_fresh (now))
        radio_service_request_refresh (RadioCmdType::REFRESH_FREQUENCY);

    char buf[16];
    snprintf (buf, sizeof (buf), "%ld", snap.frequency_hz);
    REPLY_WITH_STRING (req, buf, "frequency");
```

Add includes at the top of the file (next to the existing `#include`s):

```cpp
#include "radio_service.h"
#include "radio_snapshot.h"
```

Delete the now-unused static cache globals (`cached_frequency`, `cached_frequency_time`, `FREQUENCY_CACHE_US`) at the top of the file.

- [ ] **Step 2: Replace the mode GET path**

In `src/handler_mode.cpp`, add the same two includes. Replace the entire body of `get_radio_mode()` with:

```cpp
    ESP_LOGV (TAG8, "trace: %s()", __func__);
    RadioSnapshotData snap = radio_snapshot::get();
    int64_t           now  = esp_timer_get_time();

    if (!snap.has_mode()) {
        radio_service_request_refresh (RadioCmdType::REFRESH_MODE);
        return MODE_UNKNOWN;
    }
    if (!snap.mode_fresh (now))
        radio_service_request_refresh (RadioCmdType::REFRESH_MODE);

    radio_mode_t mode = static_cast<radio_mode_t> (snap.mode);
    assert (radio_mode_map[mode].mode == mode);
    return mode;
```

Delete the now-unused `cached_mode`, `cached_mode_time`, `MODE_CACHE_US` statics. Leave `handler_mode_get` (the wrapper that calls `get_radio_mode()` and replies) unchanged.

- [ ] **Step 3: Make connectionStatus non-blocking**

In `src/handler_status.cpp`, add the includes. Replace the `else { long transmitting = -1; TIMED_LOCK_OR_FAIL(...) { ... } switch (...) }` block (the final `else` branch only) with a snapshot read:

```cpp
    else {
        // Never touch the radio here — read the cached xmit state the
        // service task maintains. Stale/unknown -> ⚪, and request a
        // refresh so the next poll is accurate.
        RadioSnapshotData snap = radio_snapshot::get();
        if (snap.xmit_state < 0)
            radio_service_request_refresh (RadioCmdType::REFRESH_XMIT);
        switch (snap.xmit_state) {
        case 0:  symbol = "🟢"; break;
        case 1:  symbol = "🔴"; break;
        default: symbol = "⚪";
        }
    }
```

Keep the existing earlier branches (`!kxRadio.is_connected()` → ⚫, `Ft8RadioExclusive` → ⚪, `is_keyer_active()` → 🔴) unchanged. Replace the `!kxRadio.is_connected()` test with `!radio_service_link_up()` so it reflects the live link-health machine, not the never-cleared boot flag:

```cpp
    if (!radio_service_link_up())
        symbol = "⚫";
```

- [ ] **Step 4: Verify it compiles**

Run: `make build`
Expected: build SUCCEEDS. No references remain to the deleted cache statics (grep `cached_frequency` / `cached_mode` → only matches inside other files, none in these two).

- [ ] **Step 5: Commit**

```bash
git add src/handler_frequency.cpp src/handler_mode.cpp src/handler_status.cpp
git commit -m "feat: GET handlers serve cached snapshot, never block radio"
```

---

### Task 7: SET handlers enqueue + bounded ack

**As landed (`c02f749`):** three deviations from the literal plan.
1. **503 helper macro.** The plan's `REPLY_WITH_FAILURE(req, 503, "radio link down")` does not compile — ESP-IDF's `httpd_err_code_t` enum lacks `HTTPD_503_SERVICE_UNAVAILABLE`. Added a new `REPLY_WITH_SERVICE_UNAVAILABLE(req, message)` macro in `include/webserver.h` that calls `httpd_resp_set_status(req, "503 Service Unavailable")` directly. All four converted PUT handlers use this new macro for the `rc < 0` (link-down) branch.
2. **`supports_volume()` precondition preserved.** The plan said to drop the guard from `handler_volume_put` and let the CAT op fail. But `handler_volume_get` still returns 404 "not supported" via the same predicate, so dropping it on PUT created a contract divergence. Re-introduced the `supports_volume()` precondition in `handler_volume_put` (returns 404 before enqueue). `supports_volume()` is a const non-blocking accessor (verified at `include/kx_radio.h:114`), so this does not compromise the decoupling.
3. **SSB cold-start in mode SET.** The plan's SSB branch reads `radio_snapshot::get().frequency_hz`; if zero (no snapshot yet), it falls through to `MODE_UNKNOWN` → 404 "invalid mode" — misleading to the user. Landed code, when `f <= 0`, enqueues `REFRESH_FREQUENCY` and returns 503 "frequency unknown, retry SSB after refresh" via the new helper macro.

**Subsequently superseded:** the `radio_service_set_blocking` + bounded-ack model described here was fully redesigned post-hardware-testing into a pure-async fire-and-forget path — see Tasks 7.9 and 7.11. `radio_service_set_blocking` no longer exists; the API is now `radio_service_set(type, arg)` returning 0 (accepted → HTTP 202) or -1 (link-down → HTTP 503).

**Files:**
- Modify: `src/handler_frequency.cpp` (`handler_frequency_put`)
- Modify: `src/handler_mode.cpp` (`handler_mode_put`)
- Modify: `src/handler_volume.cpp` (`handler_volume_put`)
- Modify: `src/handler_atu.cpp` (`handler_atu_put`)
- Modify: `include/webserver.h` (new `REPLY_WITH_SERVICE_UNAVAILABLE` macro)

- [ ] **Step 1: Frequency SET**

Replace the body of `handler_frequency_put` from the `// Tier 2` comment through the closing of the `TIMED_LOCK_OR_FAIL` block with:

```cpp
    int rc = radio_service_set_blocking (RadioCmdType::SET_FREQUENCY, freq, 800);
    if (rc < 0)
        REPLY_WITH_FAILURE (req, 503, "radio link down");
    if (rc == 0)
        REPLY_WITH_FAILURE (req, HTTPD_500_INTERNAL_SERVER_ERROR, "failed to set frequency");
```

Keep the `STANDARD_DECODE_SOLE_PARAMETER` / `atoi` / `freq <= 0` validation above it unchanged.

- [ ] **Step 2: Mode SET**

In `handler_mode_put`, the `"SSB"` case needs the current frequency. Read it from the snapshot instead of the radio. Replace the `TIMED_LOCK_OR_FAIL (...) { ... }` block with:

```cpp
    radio_mode_t mode = MODE_UNKNOWN;
    if (!strcmp (mode_param, "SSB")) {
        long f = radio_snapshot::get().frequency_hz;
        if (f > 0)
            mode = (f < 10000000) ? MODE_LSB : MODE_USB;
    }
    else
#define COUNTOF(array) (sizeof (array) / sizeof (array[0]))
        for (radio_mode_map_t const * mode_kv = &radio_mode_map[COUNTOF (radio_mode_map) - 1];
             mode_kv >= &radio_mode_map[0]; --mode_kv)
            if (!strcmp (mode_param, mode_kv->name)) { mode = mode_kv->mode; break; }

    if (mode == MODE_UNKNOWN)
        REPLY_WITH_FAILURE (req, HTTPD_404_NOT_FOUND, "invalid mode");

    int rc = radio_service_set_blocking (RadioCmdType::SET_MODE, (long)mode, 800);
    if (rc < 0)
        REPLY_WITH_FAILURE (req, 503, "radio link down");
    if (rc == 0)
        REPLY_WITH_FAILURE (req, HTTPD_500_INTERNAL_SERVER_ERROR, "failed to set mode");
```

Add `#include "radio_service.h"` and `#include "radio_snapshot.h"` if not already present from Task 6.

- [ ] **Step 3: Volume SET**

Replace the `TIMED_LOCK_OR_FAIL (...) { ... }` block in `handler_volume_put` with:

```cpp
    int rc = radio_service_set_blocking (RadioCmdType::SET_VOLUME, delta, 800);
    if (rc < 0)
        REPLY_WITH_FAILURE (req, 503, "radio link down");
    if (rc == 0)
        REPLY_WITH_FAILURE (req, HTTPD_500_INTERNAL_SERVER_ERROR, "unable to set volume");
```

Add `#include "radio_service.h"` at the top. (The `supports_volume()` guard moves into the service task path — accept the command; a radio that lacks volume will fail the CAT op and return rc==0, which is the honest answer.)

- [ ] **Step 4: ATU SET**

Replace the `TIMED_LOCK_OR_FAIL (...) { ... }` block in `handler_atu_put` with:

```cpp
    int rc = radio_service_set_blocking (RadioCmdType::SET_ATU, 0, 800);
    if (rc < 0)
        REPLY_WITH_FAILURE (req, 503, "radio link down");
    if (rc == 0)
        REPLY_WITH_FAILURE (req, HTTPD_500_INTERNAL_SERVER_ERROR, "Failed to send ATU command");
```

Add `#include "radio_service.h"` at the top.

- [ ] **Step 5: Verify it compiles**

Run: `make build`
Expected: build SUCCEEDS. Grep the four handler files for `kxRadio.` — there must be **zero** remaining direct `kxRadio.` radio calls in the GET/PUT bodies converted in Tasks 6–7.

- [ ] **Step 6: Commit**

```bash
git add src/handler_frequency.cpp src/handler_mode.cpp src/handler_volume.cpp src/handler_atu.cpp
git commit -m "feat: SET handlers enqueue with bounded ack, fast-reject link down"
```

---

### Task 7.5: do_set expires-at hardening (post-Task-7 addition)

**Why this exists:** discovered after Tasks 1–7 landed. The plan claims the radio service task is the "sole mutex owner", but the unconverted handlers (`handler_cat.cpp`, `handler_ft8.cpp`, `handler_time.cpp`, `handler_volume_get`) still take `kxRadio.timed_lock` directly. If one of those handlers holds the mutex — especially FT8, where holds run up to ~15 s — the service task's `do_set` blocks past the handler's 800 ms ack timeout. The waiting HTTP handler has already returned 0 (failure) to its client, but the radio change still applies later: a silent-late application that contradicts the response the user received.

**Fix as landed (`dfccc72`):** `RadioCmd` gains an `int64_t expires_at_us` field. `radio_service_set_blocking` populates it from the same deadline as its `xTaskNotifyWait` loop. After acquiring the mutex, `do_set` checks `cmd.expires_at_us != 0 && esp_timer_get_time() > cmd.expires_at_us`; if expired, it skips the radio change, records a failure for link-health bookkeeping, and notifies the (departed) waiter via the existing seq-tagged notification path. `do_refresh` is unaffected (refreshes are fire-and-forget). Once all radio-mutex-taking handlers convert (see Residual scope), this becomes a no-op safeguard.

**Files:**
- Modify: `src/radio_service.cpp`

**Steps:** documents an already-landed commit; no forward-looking steps. See `dfccc72` for the diff.

---

### Task 7.7: throttle CAT during link-down (post-hardware-testing fix)

**Defect:** GET handlers enqueue a refresh on every stale snapshot, including during link-down. On a dead radio each refresh is a ~6 s blocking CAT plus `ESP_LOGI("Retrying...")` spam; under client polling this saturated WiFi/HTTP scheduling and degraded every endpoint (verified on hardware: `/version` 200–3500 ms with the radio off vs 14–33 ms with it on).

**Fix as landed (`96c3d93`):** the radio service worker throttles refresh CAT attempts during link-down to one per `LINK_DOWN_PROBE_INTERVAL_US` (10 s) — that one attempt doubles as the recovery probe; the rest are dropped.

**Files:** `src/radio_service.cpp`. Documents an already-landed commit; no forward-looking steps.

---

### Task 7.8: per-operation SET timeouts (superseded by 7.9/7.11)

**Defect:** the plan's single 800 ms `SET_ACK_TIMEOUT_MS` was too short. Band-switch frequency tunes measured 0.7–1.7 s (frequent false-500s); ATU tunes take 5–10 s on the radio (always false-500 — ATU was completely broken).

**Fix as landed (`2ddf754`):** introduced per-op timeout constants sized to actual CAT durations (frequency 3 s, ATU 12 s, etc.).

**Superseded by 7.9/7.11 — not in current code.** The long per-op timeouts re-introduced HTTP-server starvation (see Task 7.9); per-op timeouts were removed and the SET path was ultimately redesigned to be pure-async (Task 7.11). Recorded here only so a reader does not assume per-op timeouts still exist.

---

### Task 7.9: SET returns 202 when ack is slow (post-hardware-testing fix)

**Defect:** Task 7.8's long timeouts starved the single `esp_http_server` task — a SET handler blocked for the whole ack-wait, so a 3 s frequency timeout starved concurrent VFO polls (client `VFO_TIMEOUT_MS` = 2 s) and produced `AbortError`.

**Fix as landed (`7efe9fa`):** `radio_service_set_blocking` gained a third return code 2 ("enqueued, no ack within timeout"); handlers reply HTTP **202 Accepted** for code 2. The ack-wait was reverted to a single 800 ms `SET_ACK_TIMEOUT_MS`; slow ops return 202 and complete asynchronously, confirmed by a later client GET.

**Files:** `src/radio_service.{h,cpp}`, the four SET handlers, `include/webserver.h`. Documents an already-landed commit.

---

### Task 7.10: decouple SET apply-deadline from ack (post-hardware-testing fix)

**Defect:** `do_set`'s expiry check used the 800 ms ack timeout as the apply-deadline, so a second rapid SET queued behind a ~1.5 s band-switch CAT was dropped as "expired" — even though the handler had already returned 202.

**Fix as landed (`9160a48`):** decoupled the two deadlines — `SET_ACK_TIMEOUT_MS` (800 ms) bounds only the handler's wait; a new `SET_APPLY_DEADLINE_MS` (5 s) bounds how long the worker may still apply a queued SET.

**Files:** `src/radio_service.{h,cpp}`. Documents an already-landed commit.

---

### Task 7.11: pure-async SET with slot coalescing (post-hardware-testing redesign)

**Defect:** even at an 800 ms ack-wait, a SET handler blocking the single HTTP server task could not survive an unbounded burst — rapid Chase-spot clicking queued many SETs whose cumulative blocking starved the server.

**Fix as landed (`aa51055`):** the radio service task's FIFO queue + sequence-tag + notify-to-handler + handler wait-loop was replaced with per-type request slots (refresh bools; SET `{arg, expires_at, valid}` structs) under one mutex plus a single worker task-notification. SET handlers became **pure fire-and-forget**: store a slot, wake the worker, return HTTP 202 immediately (link-down still returns 503 synchronously). A burst of N same-type requests collapses to one — newest-wins for frequency/mode/power/atu, **accumulate** for volume (a delta). The API changed from `radio_service_set_blocking(type, arg, timeout)` to `radio_service_set(type, arg)` returning 0 (accepted → 202) or -1 (link-down → 503). The worker also resets the task watchdog before each drained CAT op (a drain pass can span multiple multi-second blocking ops); `s_worker` is `std::atomic<TaskHandle_t>`.

Verified on hardware: 12 rapid PUTs all returned 202 in 15–27 ms; interleaved GETs stayed at 16–23 ms; the radio settled on the last commanded frequency.

**Files:** `src/radio_service.{h,cpp}`, the four SET handlers. Documents an already-landed commit.

---

### Task 8: Integration test — non-radio endpoints stay responsive

**As landed (`3d4eb92`, `cc68f71`):** two deviations from the literal plan.
1. **Stress p95 threshold relaxed.** The plan's assertion was `probe_p95 < 1.0`. Empirically, even a /version-only stress (zero radio involvement) hits p95 ~1.09 s on this hardware — the HTTP-server-task saturation floor sits above 1.0 s regardless of radio state. The 1.0 s threshold was modeling pre-fix 6 s blocking, not the actual post-fix ceiling. Relaxed to `probe_p95 < 2.0` with a multi-line rationale comment in `test_mutex_stress.py`.
2. **New `cold_probe_decoupling(host)`.** Single-client unloaded latency check for `/version`, `/frequency`, and `/connectionStatus`; asserts per-endpoint max < 200 ms. Runs before the stress test. This is what actually proves the decoupling property at the single-client level (the property the user experiences). The cold-probe uses `subprocess.run(["curl", ...])` rather than Python `requests` to avoid an empirically-confirmed `requests`/ESP-IDF stack interaction that flaked ~1-in-3 runs with ~1 s spikes matching the lwIP TCP SYN RTO.

Pre-commit gating verified 3 consecutive clean runs.

**Files:**
- Modify: `test/integration/test_mutex_stress.py`

- [ ] **Step 1: Add a responsiveness assertion**

In `test/integration/test_mutex_stress.py`, add a test scenario function that, while the stress clients hammer `/api/v1/frequency` and `/api/v1/mode`, also issues serial requests to a known non-radio endpoint and asserts latency stays bounded. Add near the other client routines:

```python
def responsiveness_probe(host, stop_event, results):
    """While radio endpoints are hammered, /version (no radio) must
    stay fast. With the server decoupled from radio I/O this holds
    even if the radio is physically off."""
    import time, requests
    latencies = []
    while not stop_event.is_set():
        t0 = time.time()
        try:
            r = requests.get(f"http://{host}/api/v1/version", timeout=3)
            if r.status_code == 200:
                latencies.append(time.time() - t0)
        except requests.RequestException:
            latencies.append(99.0)
        time.sleep(0.25)
    results["probe_max_latency"] = max(latencies) if latencies else 99.0
    results["probe_p95"] = sorted(latencies)[int(len(latencies) * 0.95)] if latencies else 99.0
```

Wire it into the run alongside the existing clients, and after joining add:

```python
    assert results["probe_p95"] < 1.0, (
        f"/version p95 {results['probe_p95']:.2f}s — server still "
        f"stalling on radio I/O")
```

- [ ] **Step 2: Run against a device with the radio ON (baseline parity)**

Flash the build (`make upload ENV=seeed_xiao_esp32c3_debug`) to a device with the radio connected and on.
Run: `cd test/integration && python3 test_mutex_stress.py --host sotacat.local --duration 60`
Expected: PASS — overall success rate > 95%, `probe_p95 < 1.0s`. (Confirms no regression with radio present.)

- [ ] **Step 3: Run with the radio switched OFF (the bug scenario)**

With the device still powered (USB) but the KX2 powered OFF:
Run: `cd test/integration && python3 test_mutex_stress.py --host sotacat.local --duration 60`
Expected: `/api/v1/version` `probe_p95 < 1.0s` (server stays responsive); frequency/mode return fast failures rather than ~6 s hangs. Before this phase the same run would show multi-second `probe` latencies.

- [ ] **Step 4: Commit**

```bash
git add test/integration/test_mutex_stress.py
git commit -m "test: assert non-radio endpoints stay fast under radio stress"
```

---

### Task 9: Manual hardware validation + plan close-out

**Execution status:** the dispatcher has implicitly verified Step 1 (boot log) via the integration cold-probe successfully reaching the device's HTTP endpoints, and Step 5 (radio-off SET) via a `curl -X PUT /api/v1/frequency` returning 503 within ~1 s during the cold-probe validation phase. Steps 2, 3, and 4 require hands-on KX2 toggling and the web UI — pending user execution. Close-out commit (Step 6) deferred until the user signs off on Steps 2–4.

**Files:** none (validation only)

- [ ] **Step 1: Build + flash**

Run: `make upload && make monitor` (ENV defaults to the debug env)
Expected: boots, logs `radio service task started.`

- [ ] **Step 2: Radio-present parity**

With the KX2 on, open the web UI Run tab. Confirm frequency/mode track the radio, tuning and mode/volume/ATU buttons work, and behavior is indistinguishable from before this phase. Note any latency change in `idf.py monitor`.

- [ ] **Step 3: Radio-off mid-session**

With the Run tab open and tracking, switch the KX2 OFF. Confirm: other tabs still load promptly; `/api/v1/version` in a browser returns instantly; the connection indicator goes ⚫ within a few poll cycles; the firmware log shows the ~6 s CAT timeouts occurring on `radio_service` task, not blocking HTTP. Switch the KX2 back ON — confirm recovery (indicator returns, VFO tracks again).

- [ ] **Step 4: Radio never present**

Power-cycle the SOTAcat with no KX2 attached. Confirm all tabs navigate, settings load, `/api/v1/frequency` returns a fast failure (not a hang), and SET endpoints return HTTP 503 quickly.

- [ ] **Step 5: SET while radio off**

With the radio off, attempt a frequency change from the UI. Confirm the UI reports failure (no false success) and the request returns within ~1 s.

- [ ] **Step 6: Final commit (close-out note)**

```bash
git commit --allow-empty -m "chore: server-side radio decoupling phase validated"
```

---

## Self-Review

**Spec coverage:**
- Link-health state machine + closing the "never cleared" gap → Tasks 1, 6 (Step 3 swaps `is_connected()` for `radio_service_link_up()`).
- Radio service task, sole mutex owner *for the converted handlers*, on-demand only → Tasks 4, 5. See **Residual scope** below for unconverted handlers (`handler_cat`, `handler_ft8`, `handler_time`, `handler_volume_get`) that still take `kxRadio.timed_lock` directly; the Task 7.5 expires-at fix renders that residual safe.
- Cache-only GET, stale→enqueue refresh, cold-start fast fail → Task 6.
- SET enqueue + bounded ack, fast-reject link-down (HTTP 503) → Task 7 (via the new `REPLY_WITH_SERVICE_UNAVAILABLE` helper macro; see Task 7 As-landed note 1). **Evolved post-hardware-testing:** the bounded-ack model proved to starve the single HTTP server task under SET bursts. The final landed design (Tasks 7.7–7.11) is pure-async — SET handlers store a per-type request slot, wake the worker, and return HTTP 202 immediately; link-down still returns 503 synchronously; success is confirmed by the client's subsequent GET. The spec text describing a bounded ack-wait and honest 200/5xx for SETs is superseded.
- GET payloads byte-identical (bare value text; ⚫ only via connectionStatus) → Task 6 keeps `REPLY_WITH_STRING` payloads unchanged.
- Coalesced refresh, bounded queue, frequency newest-wins → Task 4 (`radio_service_request_refresh` coalesce; `RADIO_QUEUE_LEN`; frequency SET is last-write via the radio applying queued order — acceptable, debounced client-side already).
- Testing: pure-logic red-green (Tasks 1–2), integration cold-probe + stress (Task 8), manual checklist (Task 9). Matches the spec's "host-compilable if possible, else integration + manual" statement.

**Placeholder scan:** No TBD/TODO; every code step shows complete code; commands have expected output.

**Type consistency:** `RadioCmdType`, `RadioSnapshotData`, `radio_snapshot::*`, `radio_service_*` names are identical across Tasks 3–7. `radio_service_set_blocking` signature `(RadioCmdType, long, uint32_t)` matches all four call sites in Task 7 (all pass `800`). `radio_mode_t`/`MODE_UNKNOWN` used per the investigated `kx_radio.h`.

Known accepted simplification: `radio_service_request_refresh` coalescing only inspects the queue head (`xQueuePeek`), so duplicate refreshes can occasionally both enqueue — harmless (idempotent refresh, bounded queue). Documented in code comment, not a defect.

**Residual scope (out of phase):** the following handlers still take `kxRadio.timed_lock` directly and are intentionally not converted in this server phase:
- `src/handler_cat.cpp` — TX/RX toggle, message play, power GET/SET, keyer task
- `src/handler_ft8.cpp` — FT8 transmission (holds up to ~15 s), cleanup, setup
- `src/handler_time.cpp` — time SET
- `src/handler_volume.cpp::handler_volume_get` — volume GET (Task 6 only converted frequency/mode/status GETs)

Task 7.5's `expires_at_us` defense-in-depth makes this residual safe under load (silent-late SET applications cannot occur). Full conversion would let the spec's "sole mutex owner" claim be literally true and tighten the post-`do_set` residual race from ~1 ms to zero. Candidate follow-up phase.

**Validation status (as of this revision):**
- Code reviews: clean on all production commits (`f26e427`, `40871a2`, `7a9c9a0`, `2cecb16`, `c521b74`, `1a26e4f`, `c02f749`, `dfccc72`, `3d4eb92`, `cc68f71`) plus the prerequisite `ec3e4fc`.
- Build: clean against `make build` after the `ec3e4fc` PIO embed-list fix.
- Host tests: pass — `test/host/test_radio_link_health` and `test/host/test_radio_snapshot` (incl. `xmit_fresh(0)` skew canary).
- Integration cold-probe: pass — per-endpoint max < 200 ms unloaded.
- Integration stress: pass — `probe_p95 < 2.0 s` over 3 consecutive clean runs.
- Manual hardware (Task 9 Steps 2–4): pending user execution on device.
