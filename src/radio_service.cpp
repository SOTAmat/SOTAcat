#include "radio_service.h"

#include "globals.h"
#include "kx_radio.h"
#include "radio_link_health.h"
#include "radio_park_httpd.h"
#include "radio_snapshot.h"
#include "timed_lock.h"

#include <atomic>
#include <esp_log.h>
#include <esp_task_wdt.h>
#include <esp_timer.h>
#include <freertos/FreeRTOS.h>
#include <freertos/semphr.h>
#include <freertos/task.h>

static const char * TAG8 = "sc:radiosvc";

// During link-down, refresh CAT probes are throttled to one per this
// interval. Without it, every stale-snapshot GET sets the refresh slot,
// the worker runs a ~6 s blocking CAT to a dead radio + ESP_LOGI spam,
// and under client polling that saturates WiFi/HTTP scheduling and
// degrades every endpoint. 10 s balances recovery latency against idle.
static constexpr int64_t LINK_DOWN_PROBE_INTERVAL_US = 10'000'000;  // 10 s

// The worker is normally the radio mutex's only contender, but FT8 and
// the unconverted handler_cat/handler_time paths take it directly. Bound
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

// Refresh slots, indexed [type - REFRESH_FREQUENCY], i.e. 0..2.
static bool s_refresh_pending[3] = { false, false, false };

struct PendingSet {
    long     arg           = 0;
    int64_t  expires_at_us = 0;
    uint32_t gen           = 0;      // bumped on every arm; reported on completion
    bool     valid         = false;
};
// SET slots, indexed [type - SET_FREQUENCY], i.e. 0..4.
static PendingSet s_set_pending[5];
static uint32_t   s_set_gen[5] = { 0, 0, 0, 0, 0 };  // last armed generation per type

// Map a worker op to the park-table kind whose parked request it satisfies.
// Returns false for ops no handler can park on (SET_POWER today).
static bool park_kind_of (RadioCmdType t, RadioParkKind & k) {
    switch (t) {
    case RadioCmdType::REFRESH_FREQUENCY: k = RadioParkKind::GET_FREQUENCY; return true;
    case RadioCmdType::REFRESH_MODE:      k = RadioParkKind::GET_MODE;      return true;
    case RadioCmdType::REFRESH_XMIT:      k = RadioParkKind::GET_XMIT;      return true;
    case RadioCmdType::SET_FREQUENCY:     k = RadioParkKind::SET_FREQUENCY; return true;
    case RadioCmdType::SET_MODE:          k = RadioParkKind::SET_MODE;      return true;
    case RadioCmdType::SET_VOLUME:        k = RadioParkKind::SET_VOLUME;    return true;
    case RadioCmdType::SET_ATU:           k = RadioParkKind::SET_ATU;       return true;
    default:                              return false;
    }
}

// Tell any parked HTTP request that its op finished. Called with the radio
// mutex RELEASED (do_refresh/do_set scope their TimedLock), so a slow
// httpd control-queue post can never extend a radio hold.
static void notify_done (RadioCmdType t, uint32_t gen, bool ok) {
    RadioParkKind k;
    if (park_kind_of (t, k))
        radio_park_notify_done (k, gen, ok);
}

static void publish_health() { s_link_up.store (s_health.is_up(), std::memory_order_release); }

bool radio_service_link_up() { return s_link_up.load (std::memory_order_acquire); }

// --- the worker -----------------------------------------------------

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
    }
    if (ok) s_health.record_success();
    else    s_health.record_failure();
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
    bool ok = false;
    switch (type) {
    case RadioCmdType::SET_FREQUENCY:
        ok = kxRadio.set_frequency (arg, SC_KX_COMMUNICATION_RETRIES);
        if (ok) radio_snapshot::set_frequency (arg, now);
        break;
    case RadioCmdType::SET_MODE:
        ok = kxRadio.set_mode ((radio_mode_t)arg, SC_KX_COMMUNICATION_RETRIES);
        if (ok) radio_snapshot::set_mode (arg, now);
        break;
    case RadioCmdType::SET_VOLUME:
        ok = kxRadio.set_volume (arg);
        break;
    case RadioCmdType::SET_POWER:
        ok = kxRadio.set_power (arg);
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
        for (int i = 0; i < 5; ++i) {
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

        // Drain refresh slots (freq, mode, xmit).
        for (int i = 0; i < 3; ++i) {
            bool pending;
            xSemaphoreTake (s_req_mutex, portMAX_DELAY);
            pending              = s_refresh_pending[i];
            s_refresh_pending[i] = false;
            xSemaphoreGive (s_req_mutex);
            if (!pending)
                continue;
            // Throttle refresh CAT during link-down so a dead radio plus
            // active client polling cannot saturate the system. One CAT
            // probe per LINK_DOWN_PROBE_INTERVAL_US acts as the recovery
            // probe; the rest are dropped (the next GET re-sets the slot).
            int64_t now = esp_timer_get_time();
            if (!s_link_up.load (std::memory_order_acquire) &&
                (now - s_last_cat_attempt_us.load (std::memory_order_acquire))
                < LINK_DOWN_PROBE_INTERVAL_US) {
                ESP_LOGD (TAG8, "skipping refresh during link-down probe window");
                continue;
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
    if (idx < 0 || idx > 2 || !s_req_mutex)
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
    if (idx < 0 || idx > 4)
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
