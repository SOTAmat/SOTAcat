#include <memory>
#include "globals.h"
#include "kx_radio.h"
#include "webserver.h"

#include <esp_log.h>
static const char * TAG8 = "sc:hdl_mode";

/**
 * Enumeration of radio operation modes.
 */
typedef enum
{
    MODE_UNKNOWN = 0,
    MODE_LSB = 1,
    MODE_USB = 2,
    MODE_CW = 3,
    MODE_FM = 4,
    MODE_AM = 5,
    MODE_DATA = 6,
    MODE_CW_R = 7,
    MODE_DATA_R = 9
} radio_mode_t;

/**
 * Retrieves the current operating mode of the radio.
 * @return The current mode as a value from the radio_mode_t enumeration.
 */
 radio_mode_t get_radio_mode()
{
    ESP_LOGV(TAG8, "trace: %s()", __func__);

    long mode;
    {
        const std::lock_guard<Lockable> lock(kxRadio);
        mode = kxRadio.get_from_kx("MD", 2, 1);
    }
    return static_cast<radio_mode_t>(mode);
}

/**
 * Handles an HTTP GET request to retrieve the current operating mode of the radio.
 * @param req Pointer to the HTTP request structure.
 * @return ESP_OK if the mode is successfully retrieved and sent; otherwise, an error code.
 */
esp_err_t handler_mode_get(httpd_req_t *req)
{
    showActivity();

    ESP_LOGV(TAG8, "trace: %s()", __func__);

    radio_mode_t mode = get_radio_mode();
    ESP_LOGI(TAG8, "mode = %c", mode + '0');

    switch (mode)
    {
    case MODE_LSB:
        httpd_resp_send(req, "LSB", HTTPD_RESP_USE_STRLEN);
        break;
    case MODE_USB:
        httpd_resp_send(req, "USB", HTTPD_RESP_USE_STRLEN);
        break;
    case MODE_CW:
        httpd_resp_send(req, "CW", HTTPD_RESP_USE_STRLEN);
        break;
    case MODE_FM:
        httpd_resp_send(req, "FM", HTTPD_RESP_USE_STRLEN);
        break;
    case MODE_AM:
        httpd_resp_send(req, "AM", HTTPD_RESP_USE_STRLEN);
        break;
    case MODE_DATA:
        httpd_resp_send(req, "DATA", HTTPD_RESP_USE_STRLEN);
        break;
    case MODE_CW_R:
        httpd_resp_send(req, "CW-R", HTTPD_RESP_USE_STRLEN);
        break;
    case MODE_DATA_R:
        httpd_resp_send(req, "DATA-R", HTTPD_RESP_USE_STRLEN);
        break;
    default:
        REPLY_WITH_FAILURE(req, 500, "unrecognized mode");
    }
    return ESP_OK;
}

/**
 * Placeholder handler for setting the radio mode via an HTTP PUT request.
 * @param req Pointer to the HTTP request structure.
 * @return ESP_ERR_NOT_FOUND as the function is not implemented.
 */
esp_err_t handler_mode_put(httpd_req_t *req)
{
    showActivity();

    ESP_LOGV(TAG8, "trace: %s()", __func__);

    REPLY_WITH_FAILURE(req, 404, "(not implemented)");
}

/**
 * Delegates handling to `handler_mode_get` for retrieving the receiver bandwidth.
 * This is redundant with handler_mode_get and serves as an alias.
 * @param req Pointer to the HTTP request structure.
 * @return Result of `handler_mode_get` function.
 */
esp_err_t handler_rxBandwidth_get(httpd_req_t *req)
{
    return handler_mode_get(req);
}

/**
 * Handles an HTTP PUT request to set the receiver bandwidth, which indirectly sets the radio mode.
 * Parses the 'bw' parameter from the HTTP request and adjusts the radio mode accordingly.
 * @param req Pointer to the HTTP request structure.
 * @return ESP_OK if the bandwidth mode is successfully set; otherwise, an error code.
 */
esp_err_t handler_rxBandwidth_put(httpd_req_t *req)
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

    char bw[32] = {0};
    // Parse the 'bw' parameter from the query
    if (httpd_query_key_value(buf.get(), "bw", bw, sizeof(bw)) != ESP_OK)
        REPLY_WITH_FAILURE(req, 404, "parameter parsing error");

    ESP_LOGI(TAG8, "requesting bw = '%s'", bw);

    {
        const std::lock_guard<Lockable> lock(kxRadio);

        // Send the mode to the radio based on the "bw" parameter
        if (strcmp(bw, "SSB") == 0)
        {
            // Get the radio's current frequency, and if it is less than 10 MHz, set the mode to LSB, otherwise set it to USB
            long frequency = kxRadio.get_from_kx("FA", 2, 11);
            if (frequency > 0)
            {
                if (frequency < 10000000)
                    kxRadio.put_to_kx("MD", 1, MODE_LSB, 2);
                else
                    kxRadio.put_to_kx("MD", 1, MODE_USB, 2);
            }
        }
        else if (strcmp(bw, "USB") == 0)
            kxRadio.put_to_kx("MD", 1, MODE_USB, 2);
        else if (strcmp(bw, "LSB") == 0)
            kxRadio.put_to_kx("MD", 1, MODE_LSB, 2);
        else if (strcmp(bw, "CW") == 0)
            kxRadio.put_to_kx("MD", 1, MODE_CW, 2);
        else if (strcmp(bw, "FM") == 0)
            kxRadio.put_to_kx("MD", 1, MODE_FM, 2);
        else if (strcmp(bw, "AM") == 0)
            kxRadio.put_to_kx("MD", 1, MODE_AM, 2);
        else if (strcmp(bw, "DATA") == 0 || strcmp(bw, "FT8") == 0 || strcmp(bw, "JS8") == 0 || strcmp(bw, "PSK31") == 0 || strcmp(bw, "FT4") == 0 || strcmp(bw, "RTTY") == 0) // FT8, JS8, PSK31, FT4, RTTY
            kxRadio.put_to_kx("MD", 1, MODE_DATA, 2);
        else if (strcmp(bw, "CW-R") == 0)
            kxRadio.put_to_kx("MD", 1, MODE_CW_R, 2);
        else if (strcmp(bw, "DATA-R") == 0)
            kxRadio.put_to_kx("MD", 1, MODE_DATA_R, 2);
        else
            REPLY_WITH_FAILURE(req, 404, "invalid bw");
    }

    REPLY_WITH_SUCCESS();
}
