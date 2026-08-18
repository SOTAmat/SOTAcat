#include "radio_park_httpd.h"

#include <atomic>
#include <esp_log.h>
#include <esp_timer.h>
#include <freertos/FreeRTOS.h>
#include <freertos/task.h>

static const char * TAG8 = "sc:radiopark";

// --- state (server-task-only unless noted) ---------------------------

static httpd_handle_t         s_server = nullptr;  // written once in init, read by any task
static RadioParkTable         s_table (RADIO_PARK_MAX);
static radio_park_completer_t s_completers[RADIO_PARK_KINDS] = {};  // per parked kind, set at park time
static esp_timer_handle_t     s_tick         = nullptr;
static bool                   s_tick_running = false;

// Messages from the radio worker to the server task. httpd_queue_work takes
// a pointer that must stay valid until the work runs, so use a small static
// ring claimed with an atomic flag (any task may claim; only the server task
// releases). Ops are serialized in the worker, so occupancy is ~1; the ring
// is headroom for a burst of completions queued behind a slow server task.
struct DoneMsg {
    RadioParkKind     kind;
    uint32_t          gen;
    bool              ok;
    std::atomic<bool> in_use { false };
};
static DoneMsg s_msgs[8];

// --- completion (server task) ----------------------------------------

static void complete (void * handle, RadioParkKind kind, RadioParkOutcome outcome, bool ok) {
    httpd_req_t *          req = (httpd_req_t *) handle;
    radio_park_completer_t fn  = s_completers[(int) kind];
    if (fn)
        fn (req, outcome, ok);
    else {
        // Unreachable: radio_park_request requires a completer. Never leave
        // a socket parked, though.
        ESP_LOGE (TAG8, "no completer for kind %d", (int) kind);
        httpd_resp_send_err (req, HTTPD_500_INTERNAL_SERVER_ERROR, "internal: no completer");
    }
    esp_err_t err = httpd_req_async_handler_complete (req);
    if (err != ESP_OK)
        ESP_LOGE (TAG8, "async complete failed: %s", esp_err_to_name (err));
}

static void ensure_tick() {
    if (s_tick_running || !s_tick) return;
    if (esp_timer_start_periodic (s_tick, (uint64_t) RADIO_PARK_TICK_MS * 1000) == ESP_OK)
        s_tick_running = true;
    else
        ESP_LOGE (TAG8, "failed to start park tick timer");
}

static void maybe_stop_tick() {
    if (s_tick_running && s_table.empty()) {
        esp_timer_stop (s_tick);
        s_tick_running = false;
    }
}

// Work fn: a radio op finished. Runs on the server task.
static void on_op_done (void * arg) {
    DoneMsg *     m    = (DoneMsg *) arg;
    RadioParkKind kind = m->kind;
    uint32_t      gen  = m->gen;
    bool          ok   = m->ok;
    m->in_use.store (false, std::memory_order_release);

    void * h = s_table.on_done (kind, gen);
    if (h)
        complete (h, kind, RadioParkOutcome::DONE, ok);
    maybe_stop_tick();
}

// Work fn: deadline sweep. Runs on the server task.
static void on_park_tick (void *) {
    void *        handles[RADIO_PARK_KINDS];
    RadioParkKind kinds[RADIO_PARK_KINDS];
    int           n = s_table.expire (esp_timer_get_time(), handles, RADIO_PARK_KINDS, kinds);
    for (int i = 0; i < n; ++i)
        complete (handles[i], kinds[i], RadioParkOutcome::TIMEOUT, false);
    maybe_stop_tick();
}

// esp_timer callback (esp_timer task): never touch the table or sockets
// here — just hop onto the server task. A failed post is harmless: the
// timer fires again in RADIO_PARK_TICK_MS.
static void tick_cb (void *) {
    if (s_server)
        httpd_queue_work (s_server, on_park_tick, nullptr);
}

// --- public API --------------------------------------------------------

void radio_park_init (httpd_handle_t server) {
    if (s_server) return;
    if (!s_tick) {
        const esp_timer_create_args_t args = {
            .callback              = tick_cb,
            .arg                   = nullptr,
            .dispatch_method       = ESP_TIMER_TASK,
            .name                  = "radio_park_tick",
            .skip_unhandled_events = true,
        };
        esp_err_t err = esp_timer_create (&args, &s_tick);
        if (err != ESP_OK) {
            ESP_LOGE (TAG8, "failed to create park tick timer: %s", esp_err_to_name (err));
            return;  // s_server stays null -> radio_park_request refuses -> sync fallback
        }
    }
    s_server = server;
    ESP_LOGI (TAG8, "radio park initialised (max %d, get %u ms, set %u ms)",
              RADIO_PARK_MAX, (unsigned) RADIO_PARK_GET_WAIT_MS, (unsigned) RADIO_PARK_SET_WAIT_MS);
}

bool radio_park_request (httpd_req_t * req, RadioParkKind kind, uint32_t gen, uint32_t wait_ms,
                         radio_park_completer_t completer) {
    if (!s_server || !req || !completer) return false;
    if ((int) kind < 0 || (int) kind >= RADIO_PARK_KINDS) return false;
    // Check capacity BEFORE async_begin so we never allocate a copy we then
    // have to unwind. Superseding an occupied kind never grows the table.
    if (!s_table.occupied (kind) && s_table.full())
        return false;

    httpd_req_t * copy = nullptr;
    esp_err_t     err  = httpd_req_async_handler_begin (req, &copy);
    if (err != ESP_OK || !copy) {
        ESP_LOGW (TAG8, "async begin failed: %s", esp_err_to_name (err));
        return false;
    }

#ifdef SOTACAT_SOAK_DIAG
    {
        static int64_t last_diag = 0;
        int64_t        t         = esp_timer_get_time();
        if (t - last_diag > 60'000'000) {
            last_diag = t;
            ESP_LOGI (TAG8, "DIAG httpd stack min-free=%u B; parked=%d",
                      (unsigned) uxTaskGetStackHighWaterMark (NULL) * sizeof (StackType_t), s_table.count());
        }
    }
#endif
    int64_t deadline   = esp_timer_get_time() + (int64_t) wait_ms * 1000;
    void *  superseded = nullptr;
    // Cannot fail: capacity was checked above and kind/handle are valid.
    s_table.park (kind, copy, gen, deadline, &superseded);
    if (superseded)
        complete (superseded, kind, RadioParkOutcome::SUPERSEDED, false);  // with the OLD completer
    s_completers[(int) kind] = completer;
    ensure_tick();
    return true;
}

void radio_park_notify_done (RadioParkKind kind, uint32_t gen, bool ok) {
    if (!s_server) return;
    DoneMsg * m = nullptr;
    for (auto & slot : s_msgs) {
        bool expected = false;
        if (slot.in_use.compare_exchange_strong (expected, true, std::memory_order_acq_rel)) {
            m = &slot;
            break;
        }
    }
    if (!m) {
        ESP_LOGW (TAG8, "done-message ring full; dropping (tick will complete)");
        return;
    }
    m->kind = kind;
    m->gen  = gen;
    m->ok   = ok;
    esp_err_t err = httpd_queue_work (s_server, on_op_done, m);
    if (err != ESP_OK) {
        vTaskDelay (1);  // control queue momentarily full; one retry
        err = httpd_queue_work (s_server, on_op_done, m);
    }
    if (err != ESP_OK) {
        ESP_LOGW (TAG8, "queue_work failed (%s); dropping (tick will complete)", esp_err_to_name (err));
        m->in_use.store (false, std::memory_order_release);
    }
}

int radio_park_count() { return s_table.count(); }
