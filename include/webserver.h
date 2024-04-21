#pragma once

#include <esp_http_server.h>

extern void start_webserver();

extern esp_err_t handler_frequency_get(httpd_req_t *);
extern esp_err_t handler_frequency_put(httpd_req_t *);
extern esp_err_t handler_mode_get(httpd_req_t *);
extern esp_err_t handler_mode_put(httpd_req_t *);
extern esp_err_t handler_rxBandwidth_get(httpd_req_t *);
extern esp_err_t handler_rxBandwidth_put(httpd_req_t *);
extern esp_err_t handler_prepareft8_post(httpd_req_t *);
extern esp_err_t handler_ft8_post(httpd_req_t *);
extern esp_err_t handler_cancelft8_post(httpd_req_t *);
extern esp_err_t handler_batteryPercent_get(httpd_req_t *);
extern esp_err_t handler_batteryVoltage_get(httpd_req_t *);
extern esp_err_t handler_connectionStatus_get(httpd_req_t *);
extern esp_err_t handler_time_put(httpd_req_t *);
extern esp_err_t handler_settings_get(httpd_req_t *);
extern esp_err_t handler_settings_post(httpd_req_t *);
extern esp_err_t handler_version_get(httpd_req_t *);

#define REPLY_WITH_FAILURE(req, code, message) do {\
        ESP_LOGE(TAG8, message);\
        httpd_resp_send_##code(req);\
        return ESP_FAIL;\
    } while (0)

#define REPLY_WITH_SUCCESS() do {\
        ESP_LOGD(TAG8, "success");\
        httpd_resp_send(req, "OK", HTTPD_RESP_USE_STRLEN);\
        return ESP_OK;\
    } while (0)
