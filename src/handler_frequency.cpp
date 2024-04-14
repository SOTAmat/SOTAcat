#include <memory>
#include "globals.h"
#include "kx_radio.h"
#include "webserver.h"

#include <esp_log.h>
static const char * TAG8 = "sc:hdl_freq";

/**
 * Handles a HTTP GET request to retrieve the current frequency from the radio.
 *
 * @param req Pointer to the HTTP request structure.
 * @return ESP_OK on successful frequency retrieval and transmission, appropriate error code otherwise.
 */
esp_err_t handler_frequency_get(httpd_req_t *req)
{
    showActivity();

    ESP_LOGV(TAG8, "trace: %s()", __func__);

    long frequency;
    {
        const std::lock_guard<Lockable> lock(kxRadio);
        frequency = kxRadio.get_from_kx("FA", 2, 11);
    }

    if (frequency <= 0)
        REPLY_WITH_FAILURE(req, 500, "invalid frequency from radio");

    // Frequency is valid, send response back to phone
    char buf[16];
    snprintf(buf, sizeof(buf), "%ld", frequency);

    httpd_resp_send(req, buf, HTTPD_RESP_USE_STRLEN);
    ESP_LOGI(TAG8, "returning frequency: %s", buf);
    return ESP_OK;
}

/**
 * Handles a HTTP PUT request to set a new frequency on the radio.
 * The desired frequency is specified in the URL query string.
 *
 * @param req Pointer to the HTTP request structure.
 * @return ESP_OK on successful frequency update, appropriate error code otherwise.
 */
esp_err_t handler_frequency_put(httpd_req_t *req)
{
    showActivity();

    ESP_LOGV(TAG8, "trace: %s()", __func__);

    // Get the length of the URL query
    size_t buf_len = httpd_req_get_url_query_len(req) + 1;
    if (buf_len <= 1)
        REPLY_WITH_FAILURE(req, 404, "missing query string");

    std::unique_ptr<char[]> buf(new char[buf_len]);
    if (!buf)
        REPLY_WITH_FAILURE(req, 500,  "heap allocation failed");
    char * unsafe_buf = buf.get(); // reference to an ephemeral buffer

    // Get the URL query
    if (httpd_req_get_url_query_str(req, unsafe_buf, buf_len) != ESP_OK)
        REPLY_WITH_FAILURE(req, 404, "query parsing error");

    char param_value[32];
    if (httpd_query_key_value(unsafe_buf, "frequency", param_value, sizeof(param_value)) != ESP_OK)
        REPLY_WITH_FAILURE(req, 404, "parameter parsing error");

    int freq = atoi(param_value); // Convert the parameter to an integer
    ESP_LOGI(TAG8, "freqency %d", freq);
    if (freq <= 0)
        REPLY_WITH_FAILURE(req, 404, "invalid frequency");

    {
        const std::lock_guard<Lockable> lock(kxRadio);
        if (!kxRadio.put_to_kx("FA", 11, freq, 2))
            REPLY_WITH_FAILURE(req, 500, "failed to set frequency");
    }

    REPLY_WITH_SUCCESS();
}
