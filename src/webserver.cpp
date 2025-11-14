#include "webserver.h"
#include "globals.h"
#include "kx_radio.h"
#include "settings.h"

#include <ctype.h>
#include <memory>

#include <esp_timer.h>

#include <esp_log.h>
static const char * TAG8 = "sc:webserve";

#define DECLARE_ASSET(asset)                                           \
    extern const uint8_t asset##_end[] asm ("_binary_" #asset "_end"); \
    extern const uint8_t asset##_srt[] asm ("_binary_" #asset "_start");

DECLARE_ASSET (about_html)
DECLARE_ASSET (about_js)
DECLARE_ASSET (cat_html)
DECLARE_ASSET (cat_js)
DECLARE_ASSET (favicon_ico)
DECLARE_ASSET (index_html)
DECLARE_ASSET (main_js)
DECLARE_ASSET (pota_html)
DECLARE_ASSET (pota_js)
DECLARE_ASSET (sclogo_png)
DECLARE_ASSET (settings_html)
DECLARE_ASSET (settings_js)
DECLARE_ASSET (sota_html)
DECLARE_ASSET (sota_js)
DECLARE_ASSET (style_css)

/**
 * Structure to map web URI to embedded binary asset locations.
 */
typedef struct
{
    const char *    uri;
    const uint8_t * asset_start;
    const uint8_t * asset_end;
    const char *    asset_type;
    long            cache_time;  // Cache time in seconds
} asset_entry_t;

/**
 * Represents an array of asset entries to facilitate URI to asset mapping.
 */
static const asset_entry_t asset_map[] = {
    // uri               asset_start        asset_end          asset_type         cache_time
    // ================= ================== ================== ================== ======================
    {"/",              index_html_srt,    index_html_end,    "text/html",       60}, // 1 minute cache
    {"/index.html",    index_html_srt,    index_html_end,    "text/html",       60},
    {"/style.css",     style_css_srt,     style_css_end,     "text/css",        60},
    {"/main.js",       main_js_srt,       main_js_end,       "text/javascript", 60},
    {"/sclogo.png",    sclogo_png_srt,    sclogo_png_end,    "image/png",       0 }, // Cache forever
    {"/favicon.ico",   favicon_ico_srt,   favicon_ico_end,   "image/x-icon",    0 },
    {"/sota.html",     sota_html_srt,     sota_html_end,     "text/html",       60},
    {"/sota.js",       sota_js_srt,       sota_js_end,       "text/javascript", 60},
    {"/pota.html",     pota_html_srt,     pota_html_end,     "text/html",       60},
    {"/pota.js",       pota_js_srt,       pota_js_end,       "text/javascript", 60},
    {"/settings.html", settings_html_srt, settings_html_end, "text/html",       60},
    {"/settings.js",   settings_js_srt,   settings_js_end,   "text/javascript", 60},
    {"/cat.html",      cat_html_srt,      cat_html_end,      "text/html",       60},
    {"/cat.js",        cat_js_srt,        cat_js_end,        "text/javascript", 60},
    {"/about.html",    about_html_srt,    about_html_end,    "text/html",       60},
    {"/about.js",      about_js_srt,      about_js_end,      "text/javascript", 60},
    {NULL,             NULL,              NULL,              NULL,              0 }  // Sentinel to mark end of array
};

/**
 * Structure mapping API names to their corresponding handler functions.
 */
typedef struct
{
    int          method;
    const char * api_name;
    esp_err_t (*handler_func) (httpd_req_t *);
    bool requires_radio;
} api_handler_t;

/**
 *  GET, PUT, POST handlers
 */
static const api_handler_t api_handlers[] = {
    // method     api_name            handler_func                  requires_radio
    // ========== =================== ============================= =============
    {HTTP_GET,  "batteryPercent",   handler_batteryPercent_get,   false},
    {HTTP_GET,  "batteryVoltage",   handler_batteryVoltage_get,   false},
    {HTTP_GET,  "connectionStatus", handler_connectionStatus_get, false}, // disconnected radio /is/ a status
    {HTTP_GET,  "frequency",        handler_frequency_get,        true },
    {HTTP_GET,  "mode",             handler_mode_get,             true },
    {HTTP_GET,  "power",            handler_power_get,            true },
    {HTTP_GET,  "reboot",           handler_reboot_get,           false},
    {HTTP_GET,  "rxBandwidth",      handler_mode_get,             true }, // alias for "mode"
    {HTTP_GET,  "settings",         handler_settings_get,         false},
    {HTTP_GET,  "version",          handler_version_get,          false},
    {HTTP_PUT,  "frequency",        handler_frequency_put,        true },
    {HTTP_PUT,  "keyer",            handler_keyer_put,            true },
    {HTTP_PUT,  "mode",             handler_mode_put,             true },
    {HTTP_PUT,  "msg",              handler_msg_put,              true },
    {HTTP_PUT,  "power",            handler_power_put,            true },
    {HTTP_PUT,  "rxBandwidth",      handler_mode_put,             true }, // alias for "mode"
    {HTTP_PUT,  "time",             handler_time_put,             true },
    {HTTP_PUT,  "xmit",             handler_xmit_put,             true },
    {HTTP_PUT,  "atu",              handler_atu_put,              true },
    {HTTP_POST, "prepareft8",       handler_prepareft8_post,      true },
    {HTTP_POST, "ft8",              handler_ft8_post,             true },
    {HTTP_POST, "cancelft8",        handler_cancelft8_post,       true },
    {HTTP_POST, "settings",         handler_settings_post,        false},
    {HTTP_POST, "ota",              handler_ota_post,             false},
    {HTTP_GET,  "gps",              handler_gps_settings_get,     false},
    {HTTP_POST, "gps",              handler_gps_settings_post,    false},
    {0,         NULL,               NULL,                         false}  // Sentinel to mark end of array
};

/**
 * Handles incoming HTTP requests by matching them against registered API handlers.
 * @param method The HTTP method of the incoming request.
 * @param api_name The endpoint of the API being requested.
 * @param handlers Array of handler structures.
 * @param req Pointer to the HTTP request.
 * @return ESP_OK on success, ESP_FAIL on failure.
 */
static int find_and_execute_api_handler (int method, const char * api_name, const api_handler_t * handlers, httpd_req_t * req) {
    ESP_LOGV (TAG8, "trace: %s(method=%d, api='%s')", __func__, method, api_name);

    // Ignore any query string if there is one:
    size_t compare_length = strcspn (api_name, "?");

    for (const api_handler_t * handler = handlers; handler->api_name != NULL; ++handler)
        if (method == handler->method &&
            strncmp (api_name, handler->api_name, compare_length) == 0) {
            if (kxRadio.is_connected() || !handler->requires_radio)
                return handler->handler_func (req);
            else
                REPLY_WITH_FAILURE (req, HTTPD_500_INTERNAL_SERVER_ERROR, "radio not connected");
        }

    REPLY_WITH_FAILURE (req, HTTPD_404_NOT_FOUND, "handler not found");
}

/**
 * Sends a memory region as an HTTP chunked response.
 * @param req Pointer to the HTTP request.
 * @param start Pointer to the beginning of the data buffer.
 * @param end Pointer to one past the last byte of the data buffer.
 * @return ESP_OK on successful transmission, or an error code if the send fails.
 */
static esp_err_t send_file_chunked (httpd_req_t * req, const uint8_t * start, const uint8_t * end) {
    const size_t CHUNK_SIZE = 1024;  // Send in 1KB chunks
    size_t       total_size = end - start - 1;
    size_t       sent       = 0;

    while (sent < total_size) {
        size_t to_send = MIN (CHUNK_SIZE, total_size - sent);
        int    ret     = httpd_resp_send_chunk (req, (const char *)(start + sent), to_send);

        if (ret != ESP_OK) {
            // Connection closed by client
            httpd_resp_send_chunk (req, NULL, 0);  // Terminate chunked response
            return ret;
        }

        sent += to_send;

        // Give other tasks a chance to run, but only for very large files
        // Small delays add up and can cause request queueing
        if (sent < total_size && total_size > 32768) {  // Only delay for files >32KB
            vTaskDelay (pdMS_TO_TICKS(5));  // 5ms delay
        }
    }

    // Send final chunk
    return httpd_resp_send_chunk (req, NULL, 0);
}

/**
 * Serves dynamic file content based on the URI in the HTTP request.
 * @param req Pointer to the HTTP request.
 * @return ESP_OK if the file is found and sent, ESP_FAIL otherwise.
 */
static esp_err_t dynamic_file_handler (httpd_req_t * req) {
    const char * requested_path = req->uri;

    bool                  found_file = false;
    const asset_entry_t * asset_ptr  = asset_map;

    while (asset_ptr->uri != NULL && !found_file)
        if (strcmp (requested_path, asset_ptr->uri) == 0)
            found_file = true;
        else
            ++asset_ptr;

    if (!found_file)
        return ESP_FAIL;

    // Set headers
    httpd_resp_set_type (req, asset_ptr->asset_type);

    // Add cache headers
    char cache_header[64];
    if (asset_ptr->cache_time > 0)
        snprintf (cache_header, sizeof (cache_header), "max-age=%ld", asset_ptr->cache_time);
    else
        snprintf (cache_header, sizeof (cache_header), "max-age=31536000");  // 1 year (cache forever)
    httpd_resp_set_hdr (req, "Cache-Control", cache_header);

    // Use chunked transfer for large files
    size_t file_size = asset_ptr->asset_end - asset_ptr->asset_start - 1;
    if (file_size > 4096) {  // Chunk files larger than 4KB
        ESP_LOGI (TAG8, "sending chunked asset");
        return send_file_chunked (req,
                                  asset_ptr->asset_start,
                                  asset_ptr->asset_end);
    }
    else {  // Small files can be sent in one go
        ESP_LOGI (TAG8, "sending bulk (unchunked) asset");
        return httpd_resp_send (req, (const char *)asset_ptr->asset_start, file_size);
    }
}

/**
 * Main handler for HTTP requests, routes to appropriate API or file handler.
 * @param req Pointer to the HTTP request.
 * @return ESP_OK on successful handling, ESP_FAIL on error or if no handler is found.
 */
static esp_err_t my_http_request_handler (httpd_req_t * req) {
    ESP_LOGI (TAG8, "HTTP Request received: %s %s from %s session", req->method == HTTP_GET ? "GET" : req->method == HTTP_POST ? "POST"
                                                                                                                               : "OTHER",
              req->uri,
              req->sess_ctx ? "existing" : "new");
    const char * requested_uri = req->uri;

    // 1. Check for REST API calls
    if (starts_with (requested_uri, "/api/v1/")) {
        const char * api_name = requested_uri + sizeof ("/api/v1/") - 1;  // Correct the offset
        return find_and_execute_api_handler (req->method, api_name, api_handlers, req);
    }

    // 2. Check for Web Page Assets
    if (starts_with (requested_uri, "/"))
        return dynamic_file_handler (req);

    // 3. Default / Not Found - should not be possible to reach this code.
    //    Not found errors would happen in the dynamic_file_handler in step 2.
    return ESP_FAIL;
}

/**
 * Custom URI matcher matches all, allowing passage to our request handler
 * @param _uri1 unused
 * @param _uri2 unused
 * @param _uri_len unused
 * @return Always returns true, implementing a catch-all matcher.
 */
static bool custom_uri_matcher (const char * _uri1, const char * _uri2, unsigned int _uri_len) {
    return true;  // since we want a catch-all, we always match
}

/**
 * Initializes and starts the web server with specified configurations.
 */
void start_webserver () {
    ESP_LOGV (TAG8, "trace: %s", __func__);

    httpd_config_t config      = HTTPD_DEFAULT_CONFIG();
    config.max_uri_handlers    = 6;
    config.uri_match_fn        = custom_uri_matcher;
    config.server_port         = 80;  // Explicitly set port 80 for mobile compatibility
    config.lru_purge_enable    = true;
    config.max_open_sockets    = 7;     // Increase from default of 4
    config.recv_wait_timeout   = 10;    // seconds - reduced for faster fail-fast behavior
    config.send_wait_timeout   = 10;    // seconds - reduced for faster fail-fast behavior
    config.stack_size          = 8192;  // bytes
    config.keep_alive_enable   = true;
    config.keep_alive_idle     = 5;  // 5 seconds
    config.keep_alive_interval = 5;  // 5 seconds
    config.keep_alive_count    = 3;  // 3 probes

    httpd_handle_t server = NULL;
    esp_err_t      ret    = httpd_start (&server, &config);
    if (ret != ESP_OK) {
        ESP_LOGE (TAG8, "Failed to start webserver: %s", esp_err_to_name (ret));
    }
    else {
        ESP_LOGI (TAG8, "Webserver started successfully on port %d", config.server_port);
        httpd_uri_t uri_api = {
            .uri      = "/",  // Not used: we match all URIs based on the custom_uri_matcher
            .method   = HTTP_GET,
            .handler  = my_http_request_handler,  // The universal routing handler
            .user_ctx = NULL};
        httpd_register_uri_handler (server, &uri_api);
        uri_api.method = HTTP_PUT;
        httpd_register_uri_handler (server, &uri_api);
        uri_api.method = HTTP_POST;
        httpd_register_uri_handler (server, &uri_api);

        ESP_LOGI (TAG8, "defined webserver callbacks.");
    }
}

/**
 * Decodes a URL-encoded string in place, replacing special characters.
 * @param str A pointer to the character array holding the URL-encoded string.
 * @return Always returns true after decoding, so that it can be used in a conditional expression chain.
 */
bool url_decode_in_place (char * str) {
    char * dst = str;
    int    a   = -1;
    int    b   = -1;
    while (*str) {
        if ((*str == '%') &&
            ((a = str[1]) && (b = str[2])) &&
            (isxdigit (a) && isxdigit (b))) {
            if (a >= 'a')
                a -= 'a' - 'A';
            if (a >= 'A')
                a -= ('A' - 10);
            else
                a -= '0';

            if (b >= 'a')
                b -= 'a' - 'A';
            if (b >= 'A')
                b -= ('A' - 10);
            else
                b -= '0';

            *dst++ = 16 * a + b;
            str += 3;
        }
        else if (*str == '+') {
            *dst++ = ' ';
            str++;
        }
        else
            *dst++ = *str++;
    }
    *dst = '\0';

    return true;
}

/**
 * Schedules a deferred system reboot.
 * @param req Pointer to the HTTP request object (httpd_req_t). This is passed to allow the
 *            function to respond with failure in case of an error, but it is not modified
 *            within the function.
 * @return
 *   - ESP_OK on successful scheduling of the reboot.
 *   - ESP_ERR_* code on failure, indicating the specific error that occurred.
 */
esp_err_t schedule_deferred_reboot (httpd_req_t * req) {
    const uint64_t REBOOT_DELAY_US = 2000000;  // 1.5 seconds in microseconds

    // use a unique_ptr with a custom deleter for proper resource management
    auto deleter = [] (esp_timer_handle_t * t) {
        if (t && *t) {
            esp_timer_delete (*t);
            delete t;
        }
    };
    std::unique_ptr<esp_timer_handle_t, decltype (deleter)> timer (new esp_timer_handle_t (nullptr), deleter);

    const esp_timer_create_args_t timer_args = {
        .callback = [] (void * arg) {
            esp_restart();
        },
        .arg                   = nullptr,
        .dispatch_method       = ESP_TIMER_TASK,
        .name                  = "reboot_timer",
        .skip_unhandled_events = false};

    esp_err_t timer_create_result = esp_timer_create (&timer_args, timer.get());
    if (timer_create_result != ESP_OK) {
        ESP_LOGE (TAG8, "Failed to create timer: %s", esp_err_to_name (timer_create_result));
        return timer_create_result;
    }

    esp_err_t timer_start_result = esp_timer_start_once (*timer, REBOOT_DELAY_US);
    if (timer_start_result != ESP_OK) {
        ESP_LOGE (TAG8, "Failed to start timer: %s", esp_err_to_name (timer_start_result));
        return timer_start_result;
    }

    return ESP_OK;
}
