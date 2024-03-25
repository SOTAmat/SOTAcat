#include "driver/gpio.h"
#include "esp_http_server.h"
#include "globals.h"
#include "settings.h"

#include <esp_log.h>
static const char *TAG8 = "sc:hdl_batt";

float get_battery_voltage(void)
{
    uint32_t VbattMillivolts = 0;
    int raw = 0;
    int millivolts = 0;

    for (int i = 0; i < BATTERY_SAMPLES_TO_AVERAGE; i++)
    {
        if (adc_oneshot_read(Global_adc1_handle, ADC_CHANNEL_2, &raw) != ESP_OK)
        {
            ESP_LOGE(TAG8, "failed to read ADC channel");
            return -1.0f;
        }
        if (adc_cali_raw_to_voltage(Global_cali_handle, raw, &millivolts) != ESP_OK)
        {
            ESP_LOGE(TAG8, "adc raw to calibrated failed.");
            millivolts = raw;
        }
        VbattMillivolts += millivolts;
    }

    float Vbattf = BATTERY_CALIBRATION_VALUE * (2.0f * VbattMillivolts / BATTERY_SAMPLES_TO_AVERAGE / 1000.0f);

    ESP_LOGV(TAG8, "battery voltage: %.3f V", Vbattf);
    return Vbattf;
}

static const float BatteryVoltageTable[] = {4.2, 4.15, 4.11, 4.08, 4.02, 3.98, 3.95, 3.91, 3.87, 3.85, 3.84, 3.82, 3.8, 3.79, 3.77, 3.75, 3.73, 3.71, 3.69, 3.61, 3.27};

float get_battery_percentage(float voltage)
{
    if (voltage >= 4.2f)
        return 100.0f;
    if (voltage <= 3.27f)
        return 0.0f;

    float prior_voltage = BatteryVoltageTable[0];
    for (int i = 1; i < sizeof(BatteryVoltageTable) / sizeof(BatteryVoltageTable[0]); i++)
    {
        if (voltage >= BatteryVoltageTable[i])
        {
            // Find the fractional position between the two voltage steps and then linearly interpolate the percentage between the two steps.
            float fraction = (voltage - BatteryVoltageTable[i]) / (prior_voltage - BatteryVoltageTable[i]);
            return 100.0f - ((i - fraction) * 5.0f);
        }
        prior_voltage = BatteryVoltageTable[i];
    }
    return -1.0f;
}

esp_err_t handler_batteryPercent_get(httpd_req_t *req)
{
    showActivity();

    ESP_LOGV(TAG8, "trace: %s()", __func__);

    float batt_voltage = get_battery_voltage();
    char out_buff[40];
    snprintf(out_buff, sizeof(out_buff), "%.0f", get_battery_percentage(batt_voltage));
    httpd_resp_send(req, out_buff, HTTPD_RESP_USE_STRLEN);
    ESP_LOGI(TAG8, "returning batteryPercent: %s", out_buff);
    return ESP_OK;
}

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
