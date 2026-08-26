#include "battery_monitor.h"
#include "globals.h"
#include "webserver.h"
#include "wifi.h"

#include <esp_log.h>
static const char * TAG8 = "sc:hdl_batt";

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
 * HTTP GET handler to retrieve the battery detailed information (returns JSON)
 *
 * @param req Pointer to the HTTP request structure.
 * @return ESP_OK on success, or an error code on failure.
 */
esp_err_t handler_batteryInfo_get (httpd_req_t * req) {
    showActivity();

    ESP_LOGV (TAG8, "trace: %s()", __func__);

    const int     outbuf_size = 200;  // with 8 params the smart case json output is ~185 bytes
    char          out_buf[outbuf_size];
    batteryInfo_t bat_info;
    int           cnt = 0;
    if (get_battery_is_smart()) {
        if (get_battery_info (&bat_info) == ESP_OK) {
            cnt += snprintf (out_buf + cnt, outbuf_size - cnt, "{");
            cnt += snprintf (out_buf + cnt, outbuf_size - cnt, "\"is_smart\":true,");
            cnt += snprintf (out_buf + cnt, outbuf_size - cnt, "\"voltage_v\":%4.2f,", bat_info.voltage_average);
            cnt += snprintf (out_buf + cnt, outbuf_size - cnt, "\"current_ma\":%4.1f,", bat_info.current_average);
            cnt += snprintf (out_buf + cnt, outbuf_size - cnt, "\"temp_c\":%4.1f,", bat_info.temperature_average);
            cnt += snprintf (out_buf + cnt, outbuf_size - cnt, "\"state_of_charge_pct\":%4.1f,", bat_info.reported_state_of_charge);
            cnt += snprintf (out_buf + cnt, outbuf_size - cnt, "\"capacity_mah\":%4.1f,", bat_info.reported_capacity);
            cnt += snprintf (out_buf + cnt, outbuf_size - cnt, "\"time_to_empty_hrs\":%4.2f,", bat_info.time_to_empty);
            cnt += snprintf (out_buf + cnt, outbuf_size - cnt, "\"time_to_full_hrs\":%4.2f,", bat_info.time_to_full);
            cnt += snprintf (out_buf + cnt, outbuf_size - cnt, "\"charging\":%s", (bat_info.charging ? "true" : "false"));
            cnt += snprintf (out_buf + cnt, outbuf_size - cnt, "}");
            if (cnt >= outbuf_size) {
                ESP_LOGE (TAG8, "tried to write past buffer building smart batteryInfo json");
            }
        }
        else {
            ESP_LOGE (TAG8, "timed out getting bat_info mutex");
        }
    }
    else {  // analog battery
        cnt += snprintf (out_buf, sizeof (out_buf), "{");
        cnt += snprintf (out_buf + cnt, outbuf_size - cnt, "\"is_smart\":false,");
        cnt += snprintf (out_buf + cnt, outbuf_size - cnt, "\"voltage_v\":%4.2f,", get_battery_voltage());
        cnt += snprintf (out_buf + cnt, outbuf_size - cnt, "\"state_of_charge_pct\":%4.1f", get_battery_percentage());
        cnt += snprintf (out_buf + cnt, outbuf_size - cnt, "}");
        if (cnt >= outbuf_size) {
            ESP_LOGE (TAG8, "tried to write past buffer building analog batteryInfo json");
        }
    }
    httpd_resp_set_type (req, "application/json");
    REPLY_WITH_STRING (req, out_buf, "battery info message");
}
