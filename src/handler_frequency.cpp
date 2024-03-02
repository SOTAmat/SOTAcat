#include "driver/gpio.h"
#include "esp_http_server.h"
#include "kx_commands.h"
#include "globals.h"
#include "settings.h"

#include "esp_log.h"
static const char * TAG8 = "sc:hdl_freq";

esp_err_t handler_frequency_get(httpd_req_t *req)
{
    showActivity();

    ESP_LOGV(TAG8, "trace: %s()", __func__);

    RadioPortLock.lock();
    long frequency = get_from_kx("FA", 2, 11);
    RadioPortLock.unlock();

    // Validate that frequency is a positive integer
    if (frequency > 0)
    {
        // Frequency is valid, send response back to phone
        char out_buff[16];

        snprintf(out_buff, sizeof(out_buff), "%ld", frequency);

        httpd_resp_send(req, out_buff, HTTPD_RESP_USE_STRLEN);
        ESP_LOGI(TAG8, "returning frequency: %s", out_buff);
        return ESP_OK;
    }

    ESP_LOGE(TAG8, "invalid frequency string from radio");

    httpd_resp_send_500(req);
    return ESP_FAIL;
}

// ====================================================================================================
esp_err_t handler_frequency_put(httpd_req_t *req)
{
    showActivity();

    ESP_LOGV(TAG8, "trace: %s()", __func__);

    // Get the length of the URL query
    size_t buf_len = httpd_req_get_url_query_len(req) + 1;
    if (buf_len > 1)
    {
        char *buf = new char[buf_len];
        if (!buf)
        {
            httpd_resp_send_500(req);
            return ESP_FAIL;
        }

        // Get the URL query
        if (httpd_req_get_url_query_str(req, buf, buf_len) == ESP_OK)
        {
            char param_value[32];

            ESP_LOGD(TAG8, "handler_frequency_put called with: %s", buf);

            // Parse the 'frequency' parameter from the query
            if (httpd_query_key_value(buf, "frequency", param_value, sizeof(param_value)) == ESP_OK)
            {
                int freq = atoi(param_value); // Convert the parameter to an integer

                RadioPortLock.lock();
                if (freq > 0 && put_to_kx("FA", 11, freq, 2))
                    httpd_resp_send(req, "OK", HTTPD_RESP_USE_STRLEN);
                else
                    httpd_resp_send_500(req); // Bad request if frequency is not positive
                RadioPortLock.unlock();
            }
            else
                httpd_resp_send_500(req); // Parameter not found
        }
        else
            httpd_resp_send_404(req); // Query parsing error

        delete[] buf;
    }
    else
        httpd_resp_send_404(req); // No query string

    return ESP_OK;
}
