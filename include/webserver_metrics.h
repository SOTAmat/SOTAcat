#pragma once

#include <esp_timer.h>
#include <atomic>

/**
 * Web server performance metrics tracking
 *
 * Collects timing data for HTTP requests to help diagnose performance issues.
 * Enable with CONFIG_SOTACAT_WEBSERVER_METRICS or compile-time define.
 */

#ifdef CONFIG_SOTACAT_WEBSERVER_METRICS

struct WebServerMetrics {
    // Request counters
    std::atomic<uint32_t> total_requests{0};
    std::atomic<uint32_t> active_requests{0};
    std::atomic<uint32_t> failed_requests{0};
    std::atomic<uint32_t> timeout_requests{0};

    // Timing statistics (microseconds)
    std::atomic<uint64_t> total_request_time_us{0};
    std::atomic<uint64_t> min_request_time_us{UINT64_MAX};
    std::atomic<uint64_t> max_request_time_us{0};

    // Resource usage
    std::atomic<uint32_t> peak_concurrent_requests{0};
    std::atomic<uint32_t> socket_exhaustion_count{0};

    // Chunked transfer stats
    std::atomic<uint32_t> chunked_transfers{0};
    std::atomic<uint32_t> chunk_retry_count{0};

    // Session tracking
    std::atomic<uint32_t> new_sessions{0};
    std::atomic<uint32_t> reused_sessions{0};

    void record_request_start() {
        total_requests++;
        uint32_t active = ++active_requests;

        // Update peak if needed
        uint32_t current_peak = peak_concurrent_requests.load();
        while (active > current_peak &&
               !peak_concurrent_requests.compare_exchange_weak(current_peak, active)) {
            // Retry if another thread updated it
        }
    }

    void record_request_end(uint64_t duration_us, bool success) {
        active_requests--;

        if (!success) {
            failed_requests++;
            return;
        }

        total_request_time_us += duration_us;

        // Update min
        uint64_t current_min = min_request_time_us.load();
        while (duration_us < current_min &&
               !min_request_time_us.compare_exchange_weak(current_min, duration_us)) {
        }

        // Update max
        uint64_t current_max = max_request_time_us.load();
        while (duration_us > current_max &&
               !max_request_time_us.compare_exchange_weak(current_max, duration_us)) {
        }
    }

    void record_chunked_transfer() {
        chunked_transfers++;
    }

    void record_chunk_retry() {
        chunk_retry_count++;
    }

    void record_timeout() {
        timeout_requests++;
    }

    void record_socket_exhaustion() {
        socket_exhaustion_count++;
    }

    void record_session(bool is_new) {
        if (is_new)
            new_sessions++;
        else
            reused_sessions++;
    }

    uint64_t get_avg_request_time_us() const {
        uint32_t total = total_requests.load();
        if (total == 0) return 0;
        return total_request_time_us.load() / total;
    }

    void reset() {
        total_requests = 0;
        active_requests = 0;
        failed_requests = 0;
        timeout_requests = 0;
        total_request_time_us = 0;
        min_request_time_us = UINT64_MAX;
        max_request_time_us = 0;
        peak_concurrent_requests = 0;
        socket_exhaustion_count = 0;
        chunked_transfers = 0;
        chunk_retry_count = 0;
        new_sessions = 0;
        reused_sessions = 0;
    }
};

// Global metrics instance
extern WebServerMetrics g_webserver_metrics;

// RAII helper for request timing
class RequestTimer {
private:
    int64_t start_time;
    bool success;

public:
    RequestTimer() : start_time(esp_timer_get_time()), success(false) {
        g_webserver_metrics.record_request_start();
    }

    ~RequestTimer() {
        uint64_t duration = esp_timer_get_time() - start_time;
        g_webserver_metrics.record_request_end(duration, success);
    }

    void mark_success() {
        success = true;
    }
};

#define WEBSERVER_METRICS_REQUEST_TIMER() RequestTimer _req_timer
#define WEBSERVER_METRICS_SUCCESS() _req_timer.mark_success()
#define WEBSERVER_METRICS_CHUNKED() g_webserver_metrics.record_chunked_transfer()
#define WEBSERVER_METRICS_CHUNK_RETRY() g_webserver_metrics.record_chunk_retry()
#define WEBSERVER_METRICS_TIMEOUT() g_webserver_metrics.record_timeout()
#define WEBSERVER_METRICS_SOCKET_EXHAUSTION() g_webserver_metrics.record_socket_exhaustion()
#define WEBSERVER_METRICS_SESSION(is_new) g_webserver_metrics.record_session(is_new)

#else

// No-op macros when metrics disabled
#define WEBSERVER_METRICS_REQUEST_TIMER()
#define WEBSERVER_METRICS_SUCCESS()
#define WEBSERVER_METRICS_CHUNKED()
#define WEBSERVER_METRICS_CHUNK_RETRY()
#define WEBSERVER_METRICS_TIMEOUT()
#define WEBSERVER_METRICS_SOCKET_EXHAUSTION()
#define WEBSERVER_METRICS_SESSION(is_new)

#endif // CONFIG_SOTACAT_WEBSERVER_METRICS
