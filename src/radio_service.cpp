#include "radio_service.h"

#include "globals.h"
#include "kx_radio.h"
#include "radio_driver.h"  // RadioTimeHms
#include "radio_link_health.h"
#include "radio_park_httpd.h"
#include "radio_snapshot.h"
#include "timed_lock.h"

#include <atomic>
#include <esp_task_wdt.h>
#include <esp_timer.h>
#include <freertos/FreeRTOS.h>
#include <freertos/semphr.h>
#include <freertos/task.h>
#ifdef SOTACAT_SOAK_DIAG
#include <esp_heap_caps.h>
#endif

#include <esp_log.h>
static const char * TAG8 = "sc:radiosvc";

// During link-down, recovery probes are throttled to one per this interval.
// Without it, every stale-snapshot GET would drive a CAT to a dead radio and
// under client polling that saturates WiFi/HTTP scheduling. A probe is a
// single TQ; ping (~0.2 s on a dead radio — see probe_link), so 5 s costs
// nothing noticeable and bounds recovery latency at ~5 s after power-on.
static constexpr int64_t LINK_DOWN_PROBE_INTERVAL_US = 5'000'000;  // 5 s

// The worker is normally the radio mutex's only contender, but FT8 and
// the CW keyer task take it directly. Bound
// the worker's lock-acquire so a worker wake can never sit past the 20 s
// task watchdog waiting for the mutex. On failure the slot is re-armed
// and retried on a later wake. Must stay well under the 20 s WDT; do NOT
// use RADIO_LOCK_TIMEOUT_FT8_MS.
static constexpr uint32_t WORKER_LOCK_TIMEOUT_MS = 3000;

static RadioLinkHealth      s_health;
static std::atomic<bool>    s_link_up { false };
static std::atomic<bool>    s_started { false };
static std::atomic<int64_t> s_last_cat_attempt_us { 0 };
static std::atomic<TaskHandle_t> s_worker { nullptr };

// All pending work is held as per-type slots (not a FIFO queue), so a
// burst of N requests of the same type collapses to one automatically:
// newest-wins for frequency/mode/power/atu, accumulate for volume (a
// delta). Protected by s_req_mutex. The worker drains every slot on each
// wake; handlers set a slot and notify the worker. SET handlers are thus
// pure fire-and-forget — they never block the single HTTP server task.
static SemaphoreHandle_t s_req_mutex = nullptr;

// Refresh slots, indexed [type - REFRESH_FREQUENCY].
static bool s_refresh_pending[RADIO_REFRESH_KINDS] = {};

struct PendingSet {
    long     arg           = 0;
    int64_t  expires_at_us = 0;
    uint32_t gen           = 0;      // bumped on every arm; reported on completion
    bool     valid         = false;
};
// SET slots, indexed [type - SET_FREQUENCY].
static PendingSet s_set_pending[RADIO_SET_KINDS];
static uint32_t   s_set_gen[RADIO_SET_KINDS] = {};  // last armed generation per type

bool radio_service_park_kind (RadioCmdType t, RadioParkKind & k) {
    switch (t) {
    case RadioCmdType::REFRESH_FREQUENCY: k = RadioParkKind::GET_FREQUENCY; return true;
    case RadioCmdType::REFRESH_MODE:      k = RadioParkKind::GET_MODE;      return true;
    case RadioCmdType::REFRESH_XMIT:      k = RadioParkKind::GET_XMIT;      return true;
    case RadioCmdType::REFRESH_POWER:     k = RadioParkKind::GET_POWER;     return true;
    case RadioCmdType::REFRESH_VOLUME:    k = RadioParkKind::GET_VOLUME;    return true;
    case RadioCmdType::SET_FREQUENCY:     k = RadioParkKind::SET_FREQUENCY; return true;
    case RadioCmdType::SET_MODE:          k = RadioParkKind::SET_MODE;      return true;
    case RadioCmdType::SET_VOLUME:        k = RadioParkKind::SET_VOLUME;    return true;
    case RadioCmdType::SET_POWER:         k = RadioParkKind::SET_POWER;     return true;
    case RadioCmdType::SET_ATU:           k = RadioParkKind::SET_ATU;       return true;
    case RadioCmdType::SET_XMIT:          k = RadioParkKind::SET_XMIT;      return true;
    case RadioCmdType::SET_MSG:           k = RadioParkKind::SET_MSG;       return true;
    case RadioCmdType::SET_TIME:          k = RadioParkKind::SET_TIME;      return true;
    default:                              return false;
    }
}

// Tell any parked HTTP request that its op finished. Called with the radio
// mutex RELEASED (do_refresh/do_set scope their TimedLock), so a slow
// httpd control-queue post can never extend a radio hold.
static void notify_done (RadioCmdType t, uint32_t gen, bool ok) {
    RadioParkKind k;
    if (radio_service_park_kind (t, k))
        radio_park_notify_done (k, gen, ok);
}

static void publish_health() { s_link_up.store (s_health.is_up(), std::memory_order_release); }

bool radio_service_link_up() { return s_link_up.load (std::memory_order_acquire); }

// --- the worker -----------------------------------------------------

// Called with the radio mutex HELD, right after a CAT op failed and was
// recorded. Confirm cheaply and immediately instead of waiting for the next
// two slow ops: up to LINK_DOWN_FAIL_THRESHOLD-1 TQ; pings (~100 ms timeout
// each). Dead radio -> link down ~0.5 s after the first failed op, not ~8 s
// later (a failed FA;/MD; refresh costs ~4 s each). Ping succeeds -> the
// failure was transient (radio busy, or it REFUSED a command — not a link
// problem) -> reset the counter (anti-flap, and refusals no longer count
// against the link).
static void fast_confirm_link (int64_t now) {
    for (int i = 1; i < RadioLinkHealth::LINK_DOWN_FAIL_THRESHOLD && s_health.is_up(); ++i) {
        long st = -1;
        if (kxRadio.get_xmit_state (st)) {
            radio_snapshot::set_xmit_state (st, now);
            s_health.record_success();
            return;
        }
        s_health.record_failure();
    }
}

// Link-down recovery probe: one cheap TQ; ping (~100 ms timeout x2) instead
// of whatever refresh happens to be armed — a dead-radio FA;/MD; refresh
// costs ~8-10 s, which made recovery take up to ~20 s after power-on.
// Returns true if the radio answered (link is up again; caller proceeds
// with the real refresh). Stamps s_last_cat_attempt_us either way.
static bool probe_link() {
    TimedLock lock = kxRadio.timed_lock (WORKER_LOCK_TIMEOUT_MS, "radiosvc probe");
    if (!lock.acquired())
        return false;
    esp_task_wdt_reset();
    int64_t now = esp_timer_get_time();
    s_last_cat_attempt_us.store (now, std::memory_order_release);
    long st = -1;
    bool ok = kxRadio.get_xmit_state (st);
    if (ok) {
        radio_snapshot::set_xmit_state (st, now);
        s_health.record_success();
    } else
        s_health.record_failure();
    publish_health();
    return ok;
}

// Returns true if the radio mutex was acquired and a refresh was attempted
// (*ok_out = CAT success); false if the lock could not be acquired (FT8 /
// handler_cat held it) — the caller re-arms the slot for a later wake. A
// failed acquire never reaches the radio, so it is not a CAT attempt and
// does not touch the snapshot.
static bool do_refresh (RadioCmdType which, bool & ok_out) {
    ok_out = false;
    // The lock is bounded by WORKER_LOCK_TIMEOUT_MS, not portMAX_DELAY:
    // FT8 and the unconverted handler_cat/handler_time paths also contend
    // for the radio mutex, so an unbounded wait could sit past the 20 s
    // task watchdog — which is exactly why the bound and the FT8 skip exist.
    TimedLock lock = kxRadio.timed_lock (WORKER_LOCK_TIMEOUT_MS, "radiosvc refresh");
    if (!lock.acquired())
        return false;
    // WDT budget starts now, not before the (up to 3 s) lock wait: a dead-
    // radio FA;/MD; refresh alone can take ~4-8 s, a SET ~18 s.
    esp_task_wdt_reset();
    int64_t now = esp_timer_get_time();
    s_last_cat_attempt_us.store (now, std::memory_order_release);
    bool ok = false;
    if (which == RadioCmdType::REFRESH_FREQUENCY) {
        long hz = 0;
        ok = kxRadio.get_frequency (hz) && hz > 0;
        if (ok) radio_snapshot::set_frequency (hz, now);
    } else if (which == RadioCmdType::REFRESH_MODE) {
        radio_mode_t m = MODE_UNKNOWN;
        ok = kxRadio.get_mode (m) && m > MODE_UNKNOWN;
        if (ok) radio_snapshot::set_mode ((long)m, now);
    } else if (which == RadioCmdType::REFRESH_XMIT) {
        long st = -1;
        ok = kxRadio.get_xmit_state (st);
        if (ok) radio_snapshot::set_xmit_state (st, now);
    } else if (which == RadioCmdType::REFRESH_POWER) {
        long p = -1;
        ok = kxRadio.get_power (p) && p >= 0;
        if (ok) radio_snapshot::set_power (p, now);
    } else if (which == RadioCmdType::REFRESH_VOLUME) {
        long v = -1;
        ok = kxRadio.get_volume (v) && v >= 0;
        if (ok) radio_snapshot::set_volume (v, now);
    }
    if (ok) s_health.record_success();
    else {
        s_health.record_failure();
        fast_confirm_link (now);
    }
    publish_health();
    ok_out = ok;
    return true;
}

// expires_at_us is the worker's apply window (SET_APPLY_DEADLINE_MS, 5 s).
// SET handlers are fire-and-forget (HTTP 202); the client confirms the
// outcome via a later GET. The expiry skip guards against applying a SET
// long after the user's action — e.g. one that sat while the worker was
// stuck behind a ~13 s FT8 transmission holding the radio mutex.
// Returns true if the radio mutex was acquired — whether the SET was then
// applied (*ok_out = true), expired-skipped, or CAT-failed (*ok_out =
// false); false if the lock could not be acquired (FT8 / handler_cat held
// it), in which case the caller re-arms the slot.
static bool do_set (RadioCmdType type, long arg, int64_t expires_at_us, bool & ok_out) {
    ok_out = false;
    TimedLock lock = kxRadio.timed_lock (WORKER_LOCK_TIMEOUT_MS, "radiosvc set");
    if (!lock.acquired())
        return false;
    // WDT budget starts after the lock wait (see do_refresh). A dead-radio
    // set_frequency/set_mode/set_power costs ~18 s (3 attempts x two 2 s
    // "long command" reads + gaps) — measured 2026-08-17 — so the 3 s lock
    // wait must not be inside the same 20 s budget.
    esp_task_wdt_reset();
    int64_t now = esp_timer_get_time();
    if (expires_at_us != 0 && now > expires_at_us) {
        // Expiry says nothing about the radio — no CAT was attempted, so it
        // is neither a link failure nor a probe. (Counting it as a failure
        // flipped the link down after ordinary SETs queued behind FT8.)
        ESP_LOGW (TAG8, "SET expired before mutex acquired (>%lld ms past deadline); skipping",
                  (long long) ((now - expires_at_us) / 1000));
        return true;
    }
    s_last_cat_attempt_us.store (now, std::memory_order_release);
    // Suspicious (last op failed, link not yet down): pre-flight a 0.2 s TQ;
    // ping rather than spend up to ~18 s discovering the radio is gone. No
    // answer -> this SET fails fast and honestly (parked PUT -> 500) and the
    // pings drive the link down; an answer resets the counter (transient).
    if (s_health.consecutive_failures() > 0) {
        long st = -1;
        if (kxRadio.get_xmit_state (st)) {
            radio_snapshot::set_xmit_state (st, now);
            s_health.record_success();
        } else {
            ESP_LOGW (TAG8, "SET skipped: radio not answering pre-flight ping");
            s_health.record_failure();
            fast_confirm_link (now);
            publish_health();
            return true;  // ok_out stays false
        }
    }
    bool ok = false;
    switch (type) {
    case RadioCmdType::SET_FREQUENCY:
        ok = kxRadio.set_frequency (arg, SC_KX_COMMUNICATION_RETRIES);
        if (ok) radio_snapshot::set_frequency (arg, now);
        break;
    case RadioCmdType::SET_MODE: {
        radio_mode_t m = (radio_mode_t) arg;
        if (arg == RADIO_MODE_SSB_AUTO) {
            // Frequency slot drains before mode, so the snapshot already
            // reflects a tune queued ahead of this SET (a failed tune left
            // the radio — and the snapshot — on the old frequency, which is
            // then the right basis too). Snapshot mutex is leaf-level, safe
            // to take under the radio lock. Nothing cached: read it live.
            long f = radio_snapshot::get().frequency_hz;
            if (f <= 0) {
                long hz = 0;
                if (kxRadio.get_frequency (hz) && hz > 0) {
                    f = hz;
                    radio_snapshot::set_frequency (hz, now);
                }
            }
            if (f <= 0) {
                ESP_LOGE (TAG8, "SSB requested but frequency unknown; cannot pick sideband");
                ok = false;
                break;
            }
            m = (f < RADIO_SSB_LSB_USB_BOUNDARY_HZ) ? MODE_LSB : MODE_USB;
            ESP_LOGI (TAG8, "SSB at %ld Hz -> %s", f, m == MODE_LSB ? "LSB" : "USB");
        }
        ok = kxRadio.set_mode (m, SC_KX_COMMUNICATION_RETRIES);
        if (ok) radio_snapshot::set_mode ((long) m, now);
        break;
    }
    case RadioCmdType::SET_VOLUME:
        ok = kxRadio.set_volume (arg);
        // Volume is a delta; the absolute value is unknown until re-read.
        break;
    case RadioCmdType::SET_POWER:
        ok = kxRadio.set_power (arg);
        if (ok) radio_snapshot::set_power (arg, now);
        break;
    case RadioCmdType::SET_ATU:
        ok = kxRadio.tune_atu();
        break;
    case RadioCmdType::SET_XMIT:
        ok = kxRadio.set_xmit_state (arg != 0);
        if (ok) radio_snapshot::set_xmit_state (arg != 0 ? 1 : 0, now);
        break;
    case RadioCmdType::SET_MSG:
        ok = kxRadio.play_message_bank ((int) arg);
        break;
    case RadioCmdType::SET_TIME: {
        RadioTimeHms t;
        t.hrs = (int) (arg / 3600);
        t.min = (int) ((arg / 60) % 60);
        t.sec = (int) (arg % 60);
        ok    = kxRadio.sync_time (t);
        break;
    }
    default:
        ok = false;
        break;
    }
    if (ok) s_health.record_success();
    else {
        s_health.record_failure();
        fast_confirm_link (now);
    }
    publish_health();
    ok_out = ok;
    return true;
}

static void radio_service_task (void *) {
    ESP_ERROR_CHECK (esp_task_wdt_add (NULL));
    for (;;) {
        ESP_ERROR_CHECK (esp_task_wdt_reset());
        // Wait for a request, or wake every 1 s anyway to service the
        // task watchdog. pdTRUE clears the notification count, so any
        // number of producer notifications collapse into one wake — we
        // drain every slot below regardless.
        ulTaskNotifyTake (pdTRUE, pdMS_TO_TICKS (1000));

#ifdef SOTACAT_SOAK_DIAG
        // Soak diagnostics (build with -DSOTACAT_SOAK_DIAG): every 60 s.
        {
            static int64_t last_diag = 0;
            int64_t        t         = esp_timer_get_time();
            if (t - last_diag > 60'000'000) {
                last_diag = t;
                ESP_LOGI (TAG8, "DIAG worker stack min-free=%u B; heap free=%u largest=%u min-ever=%u",
                          (unsigned) uxTaskGetStackHighWaterMark (NULL) * sizeof (StackType_t),
                          (unsigned) heap_caps_get_free_size (MALLOC_CAP_8BIT),
                          (unsigned) heap_caps_get_largest_free_block (MALLOC_CAP_8BIT),
                          (unsigned) heap_caps_get_minimum_free_size (MALLOC_CAP_8BIT));
            }
        }
#endif

        // FT8 owns the radio for the whole transmission (handler_ft8.cpp
        // holds the radio mutex continuously, ~27 s including the window
        // wait). Do NO CAT work while FT8 is active: leave SET and refresh
        // slots armed; they drain on a later wake once FT8 clears. The loop
        // still hits esp_task_wdt_reset() and the 1 s ulTaskNotifyTake
        // timeout, so the watchdog stays fed. FT8 timing takes precedence.
        if (Ft8RadioExclusive)
            continue;

        // Drain SET slots first (freq, mode, volume, power, atu order:
        // a tune sets frequency then mode, matching the client).
        // Each drained CAT op can block several seconds on an unreachable
        // radio (a SET retries 3x with ~6 s readback each), so the task
        // watchdog is serviced before every op rather than only once per
        // loop — otherwise draining two pending SETs in one pass could
        // exceed the WDT timeout without an intervening reset.
        for (int i = 0; i < RADIO_SET_KINDS; ++i) {
            PendingSet ps;
            xSemaphoreTake (s_req_mutex, portMAX_DELAY);
            ps                     = s_set_pending[i];
            s_set_pending[i].valid = false;
            s_set_pending[i].arg   = 0;  // reset volume accumulator
            xSemaphoreGive (s_req_mutex);
            if (ps.valid) {
                ESP_ERROR_CHECK (esp_task_wdt_reset());
                RadioCmdType st = (RadioCmdType) ((int) RadioCmdType::SET_FREQUENCY + i);
                bool         ok = false;
                if (do_set (st, ps.arg, ps.expires_at_us, ok)) {
                    notify_done (st, ps.gen, ok);
                } else {
                    // Couldn't get the radio (FT8 / handler_cat held it).
                    // Re-arm so a later wake retries — unless the command has
                    // expired, or a newer SET of this type already arrived.
                    if (ps.expires_at_us == 0 || esp_timer_get_time() <= ps.expires_at_us) {
                        xSemaphoreTake (s_req_mutex, portMAX_DELAY);
                        if (!s_set_pending[i].valid)
                            s_set_pending[i] = ps;
                        xSemaphoreGive (s_req_mutex);
                    }
                }
            }
        }

        // Drain refresh slots (freq, mode, xmit, power, volume).
        for (int i = 0; i < RADIO_REFRESH_KINDS; ++i) {
            bool pending;
            xSemaphoreTake (s_req_mutex, portMAX_DELAY);
            pending              = s_refresh_pending[i];
            s_refresh_pending[i] = false;
            xSemaphoreGive (s_req_mutex);
            if (!pending)
                continue;
            // Link down: throttle to one cheap probe per interval (the rest
            // of the stale-GET refreshes are dropped; the next GET re-arms).
            // Only when the ping succeeds do we spend the full refresh.
            if (!s_link_up.load (std::memory_order_acquire)) {
                int64_t now = esp_timer_get_time();
                if ((now - s_last_cat_attempt_us.load (std::memory_order_acquire))
                    < LINK_DOWN_PROBE_INTERVAL_US) {
                    ESP_LOGD (TAG8, "skipping refresh during link-down probe window");
                    continue;
                }
                ESP_ERROR_CHECK (esp_task_wdt_reset());
                if (!probe_link())
                    continue;  // still down; probe again after the interval
            }
            // See the SET-drain note above: a refresh CAT op also blocks
            // several seconds on a dead radio, so reset the WDT per op.
            ESP_ERROR_CHECK (esp_task_wdt_reset());
            RadioCmdType rt = (RadioCmdType) ((int) RadioCmdType::REFRESH_FREQUENCY + i);
            bool         ok = false;
            if (do_refresh (rt, ok)) {
                notify_done (rt, 0, ok);
            } else {
                xSemaphoreTake (s_req_mutex, portMAX_DELAY);
                s_refresh_pending[i] = true;   // re-arm; retried next wake
                xSemaphoreGive (s_req_mutex);
            }
        }
    }
}

void radio_service_start() {
    if (s_started.load (std::memory_order_acquire))
        return;
    s_req_mutex = xSemaphoreCreateMutex();
    if (!s_req_mutex) {
        ESP_LOGE (TAG8, "failed to create radio service mutex");
        abort();
    }
    // Called right after kxRadio.connect() succeeded — that handshake was a
    // real CAT exchange, so the link starts UP. Without this the first
    // seconds after boot showed ⚫ and 503'd every SET until a GET-driven
    // probe happened to run.
    s_health.record_success();
    publish_health();
    TaskHandle_t worker = nullptr;
    xTaskCreate (&radio_service_task, "radio_service", 4096, NULL,
                 SC_TASK_PRIORITY_NORMAL, &worker);
    s_worker.store (worker, std::memory_order_release);
    s_started.store (true, std::memory_order_release);
    ESP_LOGI (TAG8, "radio service task started");
}

// --- producer API (called from HTTP handler tasks) ------------------

void radio_service_request_refresh (RadioCmdType which) {
    int idx = (int) which - (int) RadioCmdType::REFRESH_FREQUENCY;
    if (idx < 0 || idx >= RADIO_REFRESH_KINDS || !s_req_mutex)
        return;
    xSemaphoreTake (s_req_mutex, portMAX_DELAY);
    s_refresh_pending[idx] = true;
    xSemaphoreGive (s_req_mutex);
    TaskHandle_t w = s_worker.load (std::memory_order_acquire);
    if (w)
        xTaskNotifyGive (w);
}

int radio_service_set (RadioCmdType type, long arg, uint32_t * gen_out) {
    if (!radio_service_link_up())
        return -1;  // fast reject, sub-millisecond — link known-down
    if (!s_req_mutex)
        return -1;  // service not started yet
    int idx = (int) type - (int) RadioCmdType::SET_FREQUENCY;
    if (idx < 0 || idx >= RADIO_SET_KINDS)
        return -1;  // not a SET command type
    int64_t expires = esp_timer_get_time() + (int64_t) SET_APPLY_DEADLINE_MS * 1000;
    xSemaphoreTake (s_req_mutex, portMAX_DELAY);
    if (type == RadioCmdType::SET_VOLUME && s_set_pending[idx].valid)
        s_set_pending[idx].arg += arg;   // volume is a delta — accumulate
    else
        s_set_pending[idx].arg = arg;    // newest-wins
    s_set_pending[idx].expires_at_us = expires;
    s_set_pending[idx].gen           = ++s_set_gen[idx];
    s_set_pending[idx].valid         = true;
    uint32_t gen = s_set_pending[idx].gen;
    xSemaphoreGive (s_req_mutex);
    if (gen_out) *gen_out = gen;
    TaskHandle_t w = s_worker.load (std::memory_order_acquire);
    if (w)
        xTaskNotifyGive (w);
    return 0;  // accepted — applies asynchronously
}
