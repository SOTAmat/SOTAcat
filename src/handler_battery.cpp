#include "globals.h"
#include "settings.h"
#include "battery_monitor.h"
#include "webserver.h"

#include <esp_log.h>
static const char *TAG8 = "sc:hdl_batt";


/**
 * HTTP GET handler to retrieve the battery percentage.
 *
 * @param req Pointer to the HTTP request structure.
 * @return ESP_OK on success, or an error code on failure.
 */
esp_err_t handler_batteryPercent_get(httpd_req_t *req)
{
    showActivity();

    ESP_LOGV(TAG8, "trace: %s()", __func__);

    char out_buff[40];
    snprintf(out_buff, sizeof(out_buff), "%.0f", get_battery_percentage());
    httpd_resp_send(req, out_buff, HTTPD_RESP_USE_STRLEN);
    ESP_LOGI(TAG8, "returning batteryPercent: %s", out_buff);
    return ESP_OK;
}

/**
 * HTTP GET handler to retrieve the battery voltage.
 *
 * @param req Pointer to the HTTP request structure.
 * @return ESP_OK on success, or an error code on failure.
 */
esp_err_t handler_batteryVoltage_get(httpd_req_t *req)
{
    showActivity();

    ESP_LOGV(TAG8, "trace: %s()", __func__);

    float batt_voltage = get_battery_voltage();
    char out_buff[40];
    snprintf(out_buff, sizeof(out_buff), "%0.2f", batt_voltage);
    httpd_resp_send(req, out_buff, HTTPD_RESP_USE_STRLEN);
    ESP_LOGI(TAG8, "returning batteryVoltage: %s", out_buff);
    return ESP_OK;
}
