#pragma once

#include <esp_http_server.h>
#include <memory>
#include <strings.h>  // for size_t

extern void      start_webserver ();
extern bool      url_decode_in_place (char * str);
extern esp_err_t schedule_deferred_reboot (httpd_req_t * req);

extern esp_err_t handler_frequency_get (httpd_req_t *);
extern esp_err_t handler_frequency_put (httpd_req_t *);
extern esp_err_t handler_keyer_put (httpd_req_t *);
extern esp_err_t handler_mode_get (httpd_req_t *);
extern esp_err_t handler_mode_put (httpd_req_t *);
extern esp_err_t handler_msg_put (httpd_req_t *);
extern esp_err_t handler_ota_post (httpd_req_t *);
extern esp_err_t handler_power_get (httpd_req_t *);
extern esp_err_t handler_power_put (httpd_req_t *);
extern esp_err_t handler_volume_get (httpd_req_t *);
extern esp_err_t handler_volume_put (httpd_req_t *);
extern esp_err_t handler_prepareft8_post (httpd_req_t *);
extern esp_err_t handler_reboot_get (httpd_req_t *);
extern esp_err_t handler_ft8_post (httpd_req_t *);
extern esp_err_t handler_cancelft8_post (httpd_req_t *);
extern esp_err_t handler_batteryInfo_get (httpd_req_t *);
extern esp_err_t handler_rssi_get (httpd_req_t *);
extern esp_err_t handler_connectionStatus_get (httpd_req_t *);
extern esp_err_t handler_time_put (httpd_req_t *);
extern esp_err_t handler_settings_get (httpd_req_t *);
extern esp_err_t handler_settings_post (httpd_req_t *);
extern esp_err_t handler_version_get (httpd_req_t *);
extern esp_err_t handler_xmit_put (httpd_req_t *);
extern esp_err_t handler_atu_put (httpd_req_t * req);

/**
 * Helper definition, to be used within a function body.
 * Retrieves a URL query from an httpd request.
 *
 * @param req the httpd_req_t object containing the request
 * @param unsafe_buf a pointer to a newly allocated object containing the query
 */
#define STANDARD_DECODE_QUERY(req, unsafe_buf)                                               \
    /* Get the length of the URL query */                                                    \
    size_t buf_len = httpd_req_get_url_query_len (req) + 1;                                  \
    if (buf_len <= 1)                                                                        \
        REPLY_WITH_FAILURE (req, HTTPD_404_NOT_FOUND, "missing query string");               \
    std::unique_ptr<char[]> buf (new char[buf_len]);                                         \
    if (!buf)                                                                                \
        REPLY_WITH_FAILURE (req, HTTPD_500_INTERNAL_SERVER_ERROR, "heap allocation failed"); \
    char * unsafe_buf = buf.get(); /* reference to an ephemeral buffer */                    \
    /* Get the URL query */                                                                  \
    if (httpd_req_get_url_query_str (req, unsafe_buf, buf_len) != ESP_OK)                    \
        REPLY_WITH_FAILURE (req, HTTPD_404_NOT_FOUND, "query parsing error");                \
    ESP_LOGV (TAG8, "request buffer[%d] = \"%s\"", buf_len, unsafe_buf);


/**
 * Helper definition, to be used within a function body.
 * Given a query string, extracts on parameter by name.
 *
 * @param unsafe_buf buffer containing the complete query
 * @param param_name name of the query parameter
 * @param param_value extracted value of the named query parameter
 */
#define STANDARD_DECODE_PARAMETER(unsafe_buf, param_name, param_value)                               \
    char param_value[128] = {0};                                                                     \
    if (httpd_query_key_value (unsafe_buf, param_name, param_value, sizeof (param_value)) != ESP_OK) \
        REPLY_WITH_FAILURE (req, HTTPD_404_NOT_FOUND, "parameter parsing error");

/**
 * Helper definition, to be used within a function body.
 * Retrieves a query parameter by name, given an httpd_req_t.
 *
 * Note that this helper can be used only once per scoped block. This just a
 * streamlined definition for the common case of a sole parameter. If you need
 * to retrieve multiple parameters, then use STANDARD_DECODE_QUERY, and then as
 * many STANDARD_DECODE_PARAMETER invocations as required.
 *
 * @param req the httpd_req_t object containing the request
 * @param param_name name of the query parameter
 * @param param_value extracted value of the named query parameter
 */
#define STANDARD_DECODE_SOLE_PARAMETER(req, param_name, param_value) \
    STANDARD_DECODE_QUERY (req, unsafe_buf);                         \
    STANDARD_DECODE_PARAMETER (unsafe_buf, param_name, param_value);

/**
 * Logs an error message, sends a JSON-formatted error response, and returns `ESP_FAIL`.
 *
 * @param req     The HTTP request handler (type: `httpd_req_t *`) used to send the response back to the client.
 * @param code    The HTTP status code (type: `httpd_err_code_t`) to be sent as part of the response,
 *                e.g., `HTTPD_500_INTERNAL_SERVER_ERROR`, rather than `500`.
 * @param message The error message (type: `const char *`) that will be logged and included in the
 *                JSON response body.
 *
 * @note
 * - Since this macro includes a `return ESP_FAIL;`, it exits the current
 * function and should be used in functions that return `esp_err_t`.
 *
 * - Regrettably, the "application/json payload" type will get overridden as
 * "text/plain" by the `http_resp_send_err function`. See
 * https://github.com/espressif/esp-idf/blob/d7ca8b94c852052e3bc33292287ef4dd62c9eeb1/components/esp_http_server/src/httpd_txrx.c#L388
 *
 */
#define REPLY_WITH_FAILURE(req, code, message)                                                         \
    do {                                                                                               \
        ESP_LOGE (TAG8, "%s", message);                                                                \
        const char * json_error_template = "{\"error\": \"%s\"}";                                      \
        char         json_error[128];                                                                  \
        snprintf (json_error, sizeof (json_error), json_error_template, message);                      \
        httpd_resp_set_type (req, "application/json"); /* will get clobbered by httpd_resp_send_err */ \
        httpd_resp_send_err (req, code, json_error);                                                   \
        return ESP_FAIL;                                                                               \
    } while (0)

/**
 * Send a 503 Service Unavailable response with a JSON error payload.
 *
 * ESP-IDF's `httpd_err_code_t` enum does not include 503, so we cannot use
 * `REPLY_WITH_FAILURE` here. Instead, set the raw status line directly via
 * `httpd_resp_set_status` (which accepts arbitrary status strings) and send
 * the JSON body via `httpd_resp_send`. Used by radio SET handlers when the
 * radio link is down (no point retrying — fail fast so the client can show
 * a meaningful state).
 *
 * @param req     The HTTP request handler (type: `httpd_req_t *`).
 * @param message The error message (type: `const char *`) logged and included
 *                in the JSON response body.
 */
#define REPLY_WITH_SERVICE_UNAVAILABLE(req, message)                              \
    do {                                                                          \
        ESP_LOGE (TAG8, "%s", message);                                           \
        const char * json_error_template = "{\"error\": \"%s\"}";                 \
        char         json_error[128];                                             \
        snprintf (json_error, sizeof (json_error), json_error_template, message); \
        httpd_resp_set_status (req, "503 Service Unavailable");                   \
        httpd_resp_set_type (req, "application/json");                            \
        httpd_resp_send (req, json_error, HTTPD_RESP_USE_STRLEN);                 \
        return ESP_FAIL;                                                          \
    } while (0)

/**
 * Send a 202 Accepted response with a JSON message payload.
 *
 * Used by radio SET handlers when the command was enqueued to the radio
 * service but no ack arrived within the bounded ack-wait. The command is
 * NOT a failure — it will apply asynchronously in the radio service task;
 * the client confirms the new state via a subsequent GET (e.g. its VFO
 * poll). 202 is a success-class status, so the browser treats it as `.ok`
 * and the client proceeds with no client-side change.
 *
 * ESP-IDF's `httpd_err_code_t` enum does not include 202, so we set the
 * raw status line directly via `httpd_resp_set_status` and send the JSON
 * body via `httpd_resp_send`. Logged at INFO level — 202 is not an error.
 *
 * @param req     The HTTP request handler (type: `httpd_req_t *`).
 * @param message The message (type: `const char *`) logged and included in
 *                the JSON response body.
 */
#define REPLY_WITH_ACCEPTED(req, message)                                         \
    do {                                                                          \
        ESP_LOGI (TAG8, "%s", message);                                           \
        const char * json_msg_template = "{\"message\": \"%s\"}";                 \
        char         json_msg[128];                                               \
        snprintf (json_msg, sizeof (json_msg), json_msg_template, message);       \
        httpd_resp_set_status (req, "202 Accepted");                              \
        httpd_resp_set_type (req, "application/json");                            \
        httpd_resp_send (req, json_msg, HTTPD_RESP_USE_STRLEN);                   \
        return ESP_OK;                                                            \
    } while (0)

/**
 * Logs a success message, sets the HTTP status to "204 No Content", sends an empty response,
 * and exits the current function with `ESP_OK`.
 */
#define REPLY_WITH_SUCCESS()                                   \
    do {                                                       \
        ESP_LOGD (TAG8, "success");                            \
        httpd_resp_set_status (req, "204 No Content");         \
        httpd_resp_set_hdr (req, "Connection", "close");       \
        httpd_resp_set_hdr (req, "Cache-Control", "no-store"); \
        httpd_resp_send (req, NULL, 0);                        \
        return ESP_OK;                                         \
    } while (0)


/**
 * Logs a message using the description and value, then sends an HTTP response
 * with a specified string payload and a "Connection: close" header.
 *
 * @param req         The HTTP request handler (type: `httpd_req_t *`) used to send the response back to the client.
 * @param payload     The response string to be sent to the client. The length of this string is
 *                    determined automatically using `HTTPD_RESP_USE_STRLEN`.
 * @param description A text description of the response, used for logging purposes. This should
 *                    provide context in the log output for easier debugging or tracking.
 */
#define REPLY_WITH_STRING(req, payload, description)               \
    do {                                                           \
        ESP_LOGI (TAG8, "returning " description ": %s", payload); \
        httpd_resp_set_hdr (req, "Connection", "close");           \
        httpd_resp_set_hdr (req, "Cache-Control", "no-store");     \
        httpd_resp_send (req, payload, HTTPD_RESP_USE_STRLEN);     \
        return ESP_OK;                                             \
    } while (0)
