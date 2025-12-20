#include "battery_monitor.h"
#include "globals.h"
#include "webserver.h"
#include "wifi.h"

#include <esp_log.h>
static const char * TAG8 = "sc:hdl_batt";

/**
 * HTTP GET handler to retrieve the battery percentage.
 *
 * @param req Pointer to the HTTP request structure.
 * @return ESP_OK on success, or an error code on failure.
 */
esp_err_t handler_batteryPercent_get (httpd_req_t * req) {
    showActivity();

    ESP_LOGV (TAG8, "trace: %s()", __func__);

    char out_buff[40];
    snprintf (out_buff, sizeof (out_buff), "%.0f", get_battery_percentage());

    REPLY_WITH_STRING (req, out_buff, "battery percent");
}

/**
 * HTTP GET handler to retrieve the battery voltage.
 *
 * @param req Pointer to the HTTP request structure.
 * @return ESP_OK on success, or an error code on failure.
 */
esp_err_t handler_batteryVoltage_get (httpd_req_t * req) {
    showActivity();

    ESP_LOGV (TAG8, "trace: %s()", __func__);

    char out_buff[40];
    snprintf (out_buff, sizeof (out_buff), "%0.2f", get_battery_voltage());

    REPLY_WITH_STRING (req, out_buff, "battery voltage");
}

/**
 * HTTP GET handler to retrieve the WiFi RSSI (signal strength).
 *
 * @param req Pointer to the HTTP request structure.
 * @return ESP_OK on success, or an error code on failure.
 */
esp_err_t handler_rssi_get (httpd_req_t * req) {
    showActivity();

    ESP_LOGV (TAG8, "trace: %s()", __func__);

    char out_buff[8];
    snprintf (out_buff, sizeof (out_buff), "%d", get_rssi());

    REPLY_WITH_STRING (req, out_buff, "RSSI");
}
