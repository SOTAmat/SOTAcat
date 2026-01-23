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

/**
 * HTTP GET handler to retrieve the battery charging state.
 *
 * @param req Pointer to the HTTP request structure.
 * @return ESP_OK on success, or an error code on failure.
 */
esp_err_t handler_batteryCharging_get (httpd_req_t * req) {
    showActivity();

    ESP_LOGV (TAG8, "trace: %s()", __func__);

    const char * result;
    switch (get_battery_charging_state()) {
    case BatteryChargingState::CHARGING:
        result = "1";
        break;
    case BatteryChargingState::NOT_CHARGING:
        result = "0";
        break;
    default:
        result = "unknown";
        break;
    }
    REPLY_WITH_STRING (req, result, "battery charging state");
}

/**
 * HTTP GET handler to retrieve the battery detailed information (returns JSON)
 *
 * @param req Pointer to the HTTP request structure.
 * @return ESP_OK on success, or an error code on failure.
 */
esp_err_t handler_batteryInfo_get (httpd_req_t * req) {
    showActivity();

    ESP_LOGV (TAG8, "trace: %s()", __func__);

    char out_buf[200]; // with 8 params it's ~150 bytes
    batteryInfo_t bat_info;
    int cnt = 0;
    if(get_battery_info(&bat_info) == ESP_OK){
        cnt += snprintf(out_buf+cnt, sizeof(out_buf)-cnt,"{");
        cnt += snprintf(out_buf+cnt, sizeof(out_buf)-cnt,"\"voltage_v\":%4.2f,",bat_info.voltage_average);
        cnt += snprintf(out_buf+cnt, sizeof(out_buf)-cnt,"\"current_ma\":%4.1f,",bat_info.current_average);
        cnt += snprintf(out_buf+cnt, sizeof(out_buf)-cnt,"\"temp_C\":%4.1f,",bat_info.temperature_average);
        cnt += snprintf(out_buf+cnt, sizeof(out_buf)-cnt,"\"soc_pct\":%4.1f,",bat_info.reported_state_of_charge);
        cnt += snprintf(out_buf+cnt, sizeof(out_buf)-cnt,"\"cap_mAh\":%4.1f,",bat_info.reported_capacity);
        cnt += snprintf(out_buf+cnt, sizeof(out_buf)-cnt,"\"tte_hrs\":%4.2f,",bat_info.time_to_empty);
        cnt += snprintf(out_buf+cnt, sizeof(out_buf)-cnt,"\"ttf_hrs\":%4.2f,",bat_info.time_to_full);
        cnt += snprintf(out_buf+cnt, sizeof(out_buf)-cnt,"\"charging\":%s",(bat_info.charging ? "true" : "false"));
        cnt += snprintf(out_buf+cnt, sizeof(out_buf)-cnt,"}");
    }else{
        snprintf(out_buf, sizeof(out_buf),"{}");
        ESP_LOGE (TAG8, "timed out getting bat_info mutex");
    }
    httpd_resp_set_type(req,"application/json");
    REPLY_WITH_STRING (req, out_buf, "battery info message");
}