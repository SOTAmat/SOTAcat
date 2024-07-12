#pragma once

#include <esp_http_server.h>

extern void start_webserver();
extern bool url_decode_in_place (char * str);

extern esp_err_t handler_frequency_get (httpd_req_t *);
extern esp_err_t handler_frequency_put (httpd_req_t *);
extern esp_err_t handler_keyer_put (httpd_req_t *);
extern esp_err_t handler_mode_get (httpd_req_t *);
extern esp_err_t handler_mode_put (httpd_req_t *);
extern esp_err_t handler_msg_put (httpd_req_t *);
extern esp_err_t handler_power_get (httpd_req_t *);
extern esp_err_t handler_power_put (httpd_req_t *);
extern esp_err_t handler_prepareft8_post (httpd_req_t *);
extern esp_err_t handler_ft8_post (httpd_req_t *);
extern esp_err_t handler_cancelft8_post (httpd_req_t *);
extern esp_err_t handler_batteryPercent_get (httpd_req_t *);
extern esp_err_t handler_batteryVoltage_get (httpd_req_t *);
extern esp_err_t handler_connectionStatus_get (httpd_req_t *);
extern esp_err_t handler_time_put (httpd_req_t *);
extern esp_err_t handler_settings_get (httpd_req_t *);
extern esp_err_t handler_settings_post (httpd_req_t *);
extern esp_err_t handler_version_get (httpd_req_t *);

/**
 * Helper definition, to be used within a function body.
 * Retrieves a URL query from an httpd request.
 *
 * @param req the httpd_req_t object containing the request
 * @param unsafe_buf a pointer to a newly allocated object containing the query
 */
#define STANDARD_DECODE_QUERY(req, unsafe_buf)                            \
    /* Get the length of the URL query */                                 \
    size_t buf_len = httpd_req_get_url_query_len (req) + 1;               \
    if (buf_len <= 1)                                                     \
        REPLY_WITH_FAILURE (req, 404, "missing query string");            \
    std::unique_ptr<char[]> buf (new char[buf_len]);                      \
    if (!buf)                                                             \
        REPLY_WITH_FAILURE (req, 500, "heap allocation failed");          \
    char * unsafe_buf = buf.get(); /* reference to an ephemeral buffer */ \
    /* Get the URL query */                                               \
    if (httpd_req_get_url_query_str (req, unsafe_buf, buf_len) != ESP_OK) \
        REPLY_WITH_FAILURE (req, 404, "query parsing error");             \
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
    char param_value[64] = {0};                                                                      \
    if (httpd_query_key_value (unsafe_buf, param_name, param_value, sizeof (param_value)) != ESP_OK) \
        REPLY_WITH_FAILURE (req, 404, "parameter parsing error");

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

#define REPLY_WITH_FAILURE(req, code, message) \
    do {                                       \
        ESP_LOGE (TAG8, message);              \
        httpd_resp_send_##code (req);          \
        return ESP_FAIL;                       \
    } while (0)

#define REPLY_WITH_SUCCESS()                                \
    do {                                                    \
        ESP_LOGD (TAG8, "success");                         \
        httpd_resp_send (req, "OK", HTTPD_RESP_USE_STRLEN); \
        return ESP_OK;                                      \
    } while (0)
