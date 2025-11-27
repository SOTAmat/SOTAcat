#include "globals.h"
#include "webserver.h"
#include "webserver_metrics.h"

#include <esp_log.h>

static const char * TAG8 = "sc:hdl_metr";

#ifdef CONFIG_SOTACAT_WEBSERVER_METRICS

// Global metrics instance
WebServerMetrics g_webserver_metrics;

/**
 * Handles an HTTP GET request to retrieve webserver performance metrics.
 * Returns JSON with request counts, timing statistics, and resource usage.
 *
 * @param req Pointer to the HTTP request structure.
 * @return ESP_OK on successful transmission of metrics.
 */
esp_err_t handler_metrics_get (httpd_req_t * req) {
    showActivity();

    ESP_LOGV (TAG8, "trace: %s()", __func__);

    char json[768];
    snprintf (json, sizeof (json),
              "{"
              "\"total_requests\":%lu,"
              "\"active_requests\":%lu,"
              "\"failed_requests\":%lu,"
              "\"avg_time_ms\":%.1f,"
              "\"min_time_ms\":%.1f,"
              "\"max_time_ms\":%.1f,"
              "\"peak_concurrent\":%lu,"
              "\"timeouts\":%lu,"
              "\"socket_exhaustion\":%lu,"
              "\"chunked_transfers\":%lu,"
              "\"chunk_retries\":%lu,"
              "\"new_sessions\":%lu,"
              "\"reused_sessions\":%lu"
              "}",
              g_webserver_metrics.total_requests.load(),
              g_webserver_metrics.active_requests.load(),
              g_webserver_metrics.failed_requests.load(),
              g_webserver_metrics.get_avg_request_time_us() / 1000.0,
              g_webserver_metrics.min_request_time_us.load() == UINT64_MAX
                  ? 0.0
                  : g_webserver_metrics.min_request_time_us.load() / 1000.0,
              g_webserver_metrics.max_request_time_us.load() / 1000.0,
              g_webserver_metrics.peak_concurrent_requests.load(),
              g_webserver_metrics.timeout_requests.load(),
              g_webserver_metrics.socket_exhaustion_count.load(),
              g_webserver_metrics.chunked_transfers.load(),
              g_webserver_metrics.chunk_retry_count.load(),
              g_webserver_metrics.new_sessions.load(),
              g_webserver_metrics.reused_sessions.load());

    ESP_LOGI (TAG8, "returning metrics: %s", json);
    httpd_resp_set_type (req, "application/json");
    httpd_resp_set_hdr (req, "Connection", "close");
    httpd_resp_send (req, json, HTTPD_RESP_USE_STRLEN);
    return ESP_OK;
}

/**
 * Handles an HTTP POST request to reset webserver performance metrics.
 *
 * @param req Pointer to the HTTP request structure.
 * @return ESP_OK on successful reset.
 */
esp_err_t handler_metrics_post (httpd_req_t * req) {
    showActivity();

    ESP_LOGV (TAG8, "trace: %s()", __func__);

    g_webserver_metrics.reset();

    ESP_LOGI (TAG8, "metrics reset");
    httpd_resp_set_type (req, "application/json");
    httpd_resp_set_hdr (req, "Connection", "close");
    httpd_resp_sendstr (req, "{\"status\":\"reset\"}");
    return ESP_OK;
}

#else

// Stub handlers when metrics are disabled
esp_err_t handler_metrics_get (httpd_req_t * req) {
    httpd_resp_set_type (req, "application/json");
    httpd_resp_set_hdr (req, "Connection", "close");
    httpd_resp_sendstr (req, "{\"error\":\"metrics_disabled\"}");
    return ESP_OK;
}

esp_err_t handler_metrics_post (httpd_req_t * req) {
    httpd_resp_set_type (req, "application/json");
    httpd_resp_set_hdr (req, "Connection", "close");
    httpd_resp_sendstr (req, "{\"error\":\"metrics_disabled\"}");
    return ESP_OK;
}

#endif // CONFIG_SOTACAT_WEBSERVER_METRICS
