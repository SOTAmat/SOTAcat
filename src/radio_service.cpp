#include "radio_service.h"

#include "globals.h"
#include "kx_radio.h"
#include "radio_link_health.h"
#include "radio_snapshot.h"
#include "timed_lock.h"

#include <atomic>
#include <esp_log.h>
#include <esp_task_wdt.h>
#include <esp_timer.h>
#include <freertos/FreeRTOS.h>
#include <freertos/queue.h>
#include <freertos/task.h>

static const char * TAG8 = "sc:radiosvc";

static constexpr size_t RADIO_QUEUE_LEN = 8;

struct RadioCmd {
    RadioCmdType   type;
    long           arg;
    TaskHandle_t   waiter;        // non-null for SETs
    uint32_t       seq;           // 0 for refresh requests, non-zero for SETs
    int64_t        expires_at_us; // 0 = no expiry (refresh); else absolute esp_timer_get_time() deadline
};

static QueueHandle_t      s_queue = nullptr;
static RadioLinkHealth    s_health;
static std::atomic<bool>  s_link_up { false };
static std::atomic<bool>  s_started { false };

// Generation counter for set-blocking notifications. Pack (seq, result_bit)
// into the 32-bit notify value so a wait that picks up a stale notification
// (a previously timed-out SET's worker reply) can be detected and ignored.
// Starts at 1 to keep 0 reserved as "no notification yet" sentinel.
static std::atomic<uint32_t> s_next_seq { 1 };

// During link-down, refresh requests are throttled to one CAT probe per
// LINK_DOWN_PROBE_INTERVAL_US. Without this, every stale-snapshot GET
// enqueues a refresh, the queue fills with refreshes, and each takes
// ~6 s of blocking CAT to a dead radio + ESP_LOGI("Retrying...") spam.
// Under client polling that saturates WiFi/HTTP scheduling and degrades
// every endpoint (even ones that don't touch the radio). 10 s is a
// recovery balance: fast enough to feel responsive after re-plugging
// the radio, slow enough to keep the system idle when it stays dead.
static constexpr int64_t    LINK_DOWN_PROBE_INTERVAL_US = 10'000'000;  // 10 s
static std::atomic<int64_t> s_last_cat_attempt_us { 0 };

// Mirror health into an atomic so handlers read it lock-free.
static void publish_health() { s_link_up.store (s_health.is_up(), std::memory_order_release); }

bool radio_service_link_up() { return s_link_up.load (std::memory_order_acquire); }

// --- the worker -----------------------------------------------------

static void do_refresh (RadioCmdType which) {
    int64_t  now = esp_timer_get_time();
    s_last_cat_attempt_us.store (now, std::memory_order_release);
    TimedLock lock = kxRadio.timed_lock (portMAX_DELAY, "radiosvc refresh");
    // portMAX_DELAY is safe: only this task ever takes the radio mutex,
    // so it is never actually contended; the lock is kept only to keep
    // the kxRadio is_locked() assertions in DELEGATE_BOOL happy.
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
}

// IMPORTANT: We may have waited an unbounded time on the radio mutex
// because unconverted handlers (FT8, keyer, handler_cat, time SET,
// handler_volume_get) still take it directly. cmd.expires_at_us is the
// handler's ack window (SET_ACK_TIMEOUT_MS, defined in radio_service.h);
// if it has long since passed, the handler has already replied to the
// client. NOTE: with the 202-Accepted contract a timed-out SET handler
// replies 202 (not 500), so an async application AFTER expiry is exactly
// what the client expects — it confirms via a later GET. The expiry
// skip below stays only as a safeguard against an extreme late
// application; once all radio-mutex-taking handlers route through this
// task the wait is bounded and the check becomes a near no-op.
static int do_set (const RadioCmd & cmd) {
    int64_t   now  = esp_timer_get_time();
    s_last_cat_attempt_us.store (now, std::memory_order_release);
    TimedLock lock = kxRadio.timed_lock (portMAX_DELAY, "radiosvc set");
    if (cmd.expires_at_us != 0 && esp_timer_get_time() > cmd.expires_at_us) {
        // Handler already gave up; do NOT apply the radio change.
        // Honest-failure contract: user saw 500, must not silently apply later.
        ESP_LOGW (TAG8, "SET expired before mutex acquired (waited >%lld ms past deadline); skipping",
                  (long long) ((esp_timer_get_time() - cmd.expires_at_us) / 1000));
        s_health.record_failure();
        publish_health();
        return 0;
    }
    bool ok = false;
    switch (cmd.type) {
    case RadioCmdType::SET_FREQUENCY:
        ok = kxRadio.set_frequency (cmd.arg, SC_KX_COMMUNICATION_RETRIES);
        if (ok) radio_snapshot::set_frequency (cmd.arg, now);
        break;
    case RadioCmdType::SET_MODE:
        ok = kxRadio.set_mode ((radio_mode_t)cmd.arg, SC_KX_COMMUNICATION_RETRIES);
        if (ok) radio_snapshot::set_mode (cmd.arg, now);
        break;
    case RadioCmdType::SET_VOLUME:
        ok = kxRadio.set_volume (cmd.arg);
        break;
    case RadioCmdType::SET_POWER:
        ok = kxRadio.set_power (cmd.arg);
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

static void radio_service_task (void *) {
    ESP_ERROR_CHECK (esp_task_wdt_add (NULL));
    for (;;) {
        ESP_ERROR_CHECK (esp_task_wdt_reset());
        RadioCmd cmd;
        if (xQueueReceive (s_queue, &cmd, pdMS_TO_TICKS (1000)) != pdTRUE)
            continue;  // idle: nothing queued (on-demand only)

        if (cmd.waiter) {
            int result = do_set (cmd);
            // Pack (seq << 1) | result_bit so the waiter can verify the
            // notification is for THIS call, not a prior timed-out one.
            // Always notify, even when do_set skipped on expiry — the waiter
            // task may have moved on but the notification keeps the seq-tag
            // invariant intact (the next SET will see notev_seq != my_seq
            // and loop past it).
            uint32_t notev = (cmd.seq << 1) | ((result == 1) ? 1u : 0u);
            xTaskNotify (cmd.waiter, notev, eSetValueWithOverwrite);
        } else {
            // Refresh: throttle during link-down to avoid 6 s × N CAT thrash
            // and ESP_LOGI("Retrying...") spam (kx_radio.cpp:87 at INFO level).
            // Drop the refresh if link is known-down AND we attempted recently;
            // otherwise proceed (one CAT probe per LINK_DOWN_PROBE_INTERVAL_US
            // during link-down acts as the recovery probe).
            int64_t now = esp_timer_get_time();
            if (!s_link_up.load (std::memory_order_acquire) &&
                (now - s_last_cat_attempt_us.load (std::memory_order_acquire))
                < LINK_DOWN_PROBE_INTERVAL_US) {
                ESP_LOGD (TAG8, "skipping refresh during link-down probe window");
                continue;  // skip CAT; loop back to dequeue next
            }
            do_refresh (cmd.type);
        }
    }
}

void radio_service_start() {
    if (s_started.load (std::memory_order_acquire))
        return;
    QueueHandle_t q = xQueueCreate (RADIO_QUEUE_LEN, sizeof (RadioCmd));
    if (!q) {
        ESP_LOGE (TAG8, "failed to create radio service queue");
        abort();
    }
    s_queue = q;
    xTaskCreate (&radio_service_task, "radio_service", 4096, NULL,
                 SC_TASK_PRIORITY_NORMAL, NULL);
    s_started.store (true, std::memory_order_release);
    ESP_LOGI (TAG8, "radio service task started");
}

// --- producer API (called from HTTP handler tasks) ------------------

void radio_service_request_refresh (RadioCmdType which) {
    if (!s_queue) return;
    // Coalesce: only the queue head is inspectable via xQueuePeek, so we
    // collapse this to a single check. Duplicates past the head can still
    // enqueue — harmless (refresh is idempotent, bounded queue catches it).
    RadioCmd peek;
    if (uxQueueMessagesWaiting (s_queue) > 0 &&
        xQueuePeek (s_queue, &peek, 0) == pdTRUE &&
        peek.waiter == nullptr && peek.type == which)
        return;
    RadioCmd cmd { which, 0, nullptr, 0, 0 };  // expires_at_us=0 = no expiry
    xQueueSend (s_queue, &cmd, 0);  // drop if full — a later poll retries
}

// Sequence-tagged blocking SET. Returns:
//   1  = applied and confirmed
//   0  = failed (radio answered but command failed, or could not enqueue)
//  -1  = rejected immediately: link known-down
//   2  = enqueued, no ack within timeout — will apply asynchronously
//
// The hazard this guards against: ESP-IDF esp_http_server runs HTTP
// handlers on a single task, so two back-to-back SETs share a waiter
// TaskHandle. If call N times out at 800ms but its worker reply lands
// afterwards, call N+1's xTaskNotifyWait will pick up N's stale
// notification and treat it as its own ack — a wrong-result leak. We tag
// each notification with a per-call sequence number and loop past any
// notification carrying a different seq.
int radio_service_set_blocking (RadioCmdType type, long arg, uint32_t timeout_ms) {
    if (!radio_service_link_up())
        return -1;  // fast reject, sub-millisecond
    if (!s_queue)
        return 0;

    uint32_t my_seq = s_next_seq.fetch_add (1, std::memory_order_relaxed);
    if (my_seq == 0)  // wrap (essentially never): skip the reserved value
        my_seq = s_next_seq.fetch_add (1, std::memory_order_relaxed);

    // Compute deadline BEFORE enqueue so the worker can see it and skip a
    // SET whose handler has already given up (the worker may sit blocked on
    // the radio mutex behind an unconverted handler for many seconds).
    int64_t  deadline_us = esp_timer_get_time() + (int64_t) timeout_ms * 1000;
    RadioCmd cmd { type, arg, xTaskGetCurrentTaskHandle(), my_seq, deadline_us };
    xTaskNotifyStateClear (NULL);
    if (xQueueSend (s_queue, &cmd, pdMS_TO_TICKS (50)) != pdTRUE)
        return 0;  // queue full -> treat as failure

    // Bounded wait, but loop past notifications carrying a different seq
    // (those are leftovers from an earlier SET that already timed out
    // and whose worker reply landed on us anyway).
    for (;;) {
        int64_t  remaining_us = deadline_us - esp_timer_get_time();
        if (remaining_us <= 0)
            return 2;  // timeout — enqueued, will apply async (caller maps to 202)
        uint32_t wait_ticks = pdMS_TO_TICKS ((uint32_t) ((remaining_us + 999) / 1000));
        if (wait_ticks == 0) wait_ticks = 1;

        uint32_t notev = 0;
        if (xTaskNotifyWait (0, 0xFFFFFFFF, &notev, wait_ticks) != pdTRUE)
            return 2;  // timeout — enqueued, will apply async (caller maps to 202)

        uint32_t notev_seq    = notev >> 1;
        uint32_t notev_result = notev & 1u;
        if (notev_seq != my_seq)
            continue;  // stale (from a prior timed-out SET); keep waiting
        return (int) notev_result;
    }
}
