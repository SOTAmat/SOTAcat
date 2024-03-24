#pragma once

#include "esp_err.h"
#include "esp_http_server.h"

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
