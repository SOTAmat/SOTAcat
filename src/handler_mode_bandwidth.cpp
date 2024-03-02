#include "driver/gpio.h"
#include "esp_http_server.h"
#include "esp_log.h"
#include "kx_commands.h"
#include "globals.h"
#include "settings.h"

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

radio_mode_t get_radio_mode()
{
    ESP_LOGI(TAG, "get_radio_mode()");

    xSemaphoreTake(KXCommunicationMutex, portMAX_DELAY);
    long mode = get_from_kx("MD", 2, 1);
    xSemaphoreGive(KXCommunicationMutex);

    return static_cast<radio_mode_t>(mode);
}

esp_err_t handler_mode_get(httpd_req_t *req)
{
    showActivity();

    ESP_LOGI(TAG, "handler_mode_get()");

    radio_mode_t mode = get_radio_mode();
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
        ESP_LOGI(TAG, "ERROR: Bad mode received: %d", mode);
        httpd_resp_send_500(req);
        return ESP_FAIL;
    }
    return ESP_OK;
}

esp_err_t handler_rxBandwidth_get(httpd_req_t *req)
{
    showActivity();

    ESP_LOGI(TAG, "handler_rxBandwidth_get()");

    radio_mode_t mode = get_radio_mode();
    ESP_LOGI(TAG, "handler_rxBandwidth_get() mode = %c", mode + '0');

    switch (mode)
    {
    case MODE_LSB:
    case MODE_USB:
        httpd_resp_send(req, "SSB", HTTPD_RESP_USE_STRLEN);
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
        ESP_LOGI(TAG, "ERROR: Bad mode received: %d", mode);
        httpd_resp_send_500(req);
        return ESP_FAIL;
    }
    return ESP_OK;
}

// ====================================================================================================
esp_err_t handler_rxBandwidth_put(httpd_req_t *req)
{
    showActivity();

    ESP_LOGI(TAG, "handler_rxBandwidth_put()");

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
            ESP_LOGI(TAG, "handler_rxBandwidth_put() called with query: %s", buf);

            char bw[32] = {0};
            // Parse the 'bw' parameter from the query
            if (httpd_query_key_value(buf, "bw", bw, sizeof(bw)) == ESP_OK)
            {
                xSemaphoreTake(KXCommunicationMutex, portMAX_DELAY);
                // Send the mode to the radio based on the "bw" parameter
                if (strcmp(bw, "SSB") == 0)
                {
                    // Get the radio's current frequency, and if it is less than 10 MHz, set the mode to LSB, otherwise set it to USB
                    long frequency = get_from_kx("FA", 2, 11);
                    if (frequency > 0)
                    {
                        if (frequency < 10000000)
                            put_to_kx("MD", 1, MODE_LSB, 2);
                        else
                            put_to_kx("MD", 1, MODE_USB, 2);
                    }
                }
                else if (strcmp(bw, "USB") == 0)
                    put_to_kx("MD", 1, MODE_USB, 2);
                else if (strcmp(bw, "LSB") == 0)
                    put_to_kx("MD", 1, MODE_LSB, 2);
                else if (strcmp(bw, "CW") == 0)
                    put_to_kx("MD", 1, MODE_CW, 2);
                else if (strcmp(bw, "FM") == 0)
                    put_to_kx("MD", 1, MODE_FM, 2);
                else if (strcmp(bw, "AM") == 0)
                    put_to_kx("MD", 1, MODE_AM, 2);
                else if (strcmp(bw, "DATA") == 0 || strcmp(bw, "FT8") == 0 || strcmp(bw, "JS8") == 0 || strcmp(bw, "PSK31") == 0 || strcmp(bw, "FT4") == 0 || strcmp(bw, "RTTY") == 0) // FT8, JS8, PSK31, FT4, RTTY
                    put_to_kx("MD", 1, MODE_DATA, 2);
                else if (strcmp(bw, "CW-R") == 0)
                    put_to_kx("MD", 1, MODE_CW_R, 2);
                else if (strcmp(bw, "DATA-R") == 0)
                    put_to_kx("MD", 1, MODE_DATA_R, 2);
                else
                    httpd_resp_send_500(req); // Bad request if mode is not valid
                xSemaphoreGive(KXCommunicationMutex);

                // Send a response back
                httpd_resp_send(req, "OK", HTTPD_RESP_USE_STRLEN);
            }
            else
                httpd_resp_send_404(req); // Parameter not found
        }
        else
            httpd_resp_send_404(req); // Query parsing error

        delete[] buf;
    }
    else
        httpd_resp_send_404(req); // No query string

    return ESP_OK;
}

esp_err_t handler_mode_put(httpd_req_t *req)
{
    showActivity();

    ESP_LOGI(TAG, "handler_mode_put()");

    httpd_resp_send_404(req); // No query string
    return ESP_FAIL;
}
