#include "battery_monitor.h"
#include "globals.h"
#include "hardware_specific.h"
#include "max17260.h"
#include "settings.h"

#include <esp_log.h>
static const char * TAG8 = "sc:batmon..";

const int REPORTING_TIME_SEC = 10;

/**
 * Measures and calculates the battery voltage by averaging several ADC samples.
 * If ADC read or calibration fails, it logs an error and returns -1.0.
 * The voltage is adjusted based on a calibration constant.
 *
 * @return Calculated battery voltage in volts, or -1.0f if there's an error.
 */
float get_analog_battery_voltage (void) {
    uint32_t VbattMillivolts = 0;
    int      raw             = 0;
    int      millivolts      = 0;

    for (int i = 0; i < BATTERY_SAMPLES_TO_AVERAGE; i++) {
        if (adc_oneshot_read (Global_adc1_handle, ADC_CHANNEL_2, &raw) != ESP_OK) {
            ESP_LOGE (TAG8, "failed to read ADC channel");
            return -1.0f;
        }
        if (adc_cali_raw_to_voltage (Global_cali_handle, raw, &millivolts) != ESP_OK) {
            ESP_LOGE (TAG8, "adc raw to calibrated failed.");
            millivolts = raw;
        }
        VbattMillivolts += millivolts;
    }

    float Vbattf = BATTERY_CALIBRATION_VALUE * (2.0f * VbattMillivolts / BATTERY_SAMPLES_TO_AVERAGE / 1000.0f);

    ESP_LOGV (TAG8, "analog battery voltage: %.3f V", Vbattf);
    return Vbattf;
}

/**
 * Voltage thresholds for linearly interpolating battery percentage,
 * from a full charge (4.2V) down to a fully discharged state (3.27V).
 */
static const float BatteryVoltageTable[] = {4.2, 4.15, 4.11, 4.08, 4.02, 3.98, 3.95, 3.91, 3.87, 3.85, 3.84, 3.82, 3.8, 3.79, 3.77, 3.75, 3.73, 3.71, 3.69, 3.61, 3.27};

/**
 * Converts the measured battery voltage into a percentage based on a predefined voltage table.
 * It uses linear interpolation between known voltage values to calculate the percentage.
 *
 * @param voltage Measured battery voltage in volts.
 * @return Battery charge percentage, or -1.0f if the voltage is out of range.
 */
float get_analog_battery_percentage (float voltage) {
    if (voltage >= 4.2f)
        return 100.0f;
    if (voltage <= 3.27f)
        return 0.0f;

    float prior_voltage = BatteryVoltageTable[0];
    for (int i = 1; i < sizeof (BatteryVoltageTable) / sizeof (BatteryVoltageTable[0]); i++) {
        if (voltage >= BatteryVoltageTable[i]) {
            // Find the fractional position between the two voltage steps and then linearly interpolate the percentage between the two steps.
            float fraction = (voltage - BatteryVoltageTable[i]) / (prior_voltage - BatteryVoltageTable[i]);
            return 100.0f - ((i - fraction) * 5.0f);
        }
        prior_voltage = BatteryVoltageTable[i];
    }
    return -1.0f;
}

#define I2C_MASTER_NUM       (I2C_NUM_0)
#define I2C_MASTER_FREQ_HZ   (400000)
#define SMBUS_TIMEOUT_MS     (1000)  // Timeout after this time if no ack received
#define BATTERY_POLL_TIME_MS (5000)  // Approximate rate at which to poll the battery info

static bool                    max17260_detected = false;
static float                   vbat_analog       = 0;
static float                   vpct_analog       = 0;
static float                   vbat_digital      = 0;
static float                   vpct_digital      = 0;
static max17260_saved_params_t params;

float get_battery_voltage (void) {
    if (max17260_detected)
        return vbat_digital;
    else
        return vbat_analog;
}

float get_battery_percentage (void) {
    if (max17260_detected)
        return vpct_digital;
    else
        return vpct_analog;
}

static void i2c_setup (void) {
    i2c_config_t conf;
    conf.mode             = I2C_MODE_MASTER;
    conf.sda_io_num       = I2C_SDA_PIN;
    conf.scl_io_num       = I2C_SCL_PIN;
    conf.sda_pullup_en    = GPIO_PULLUP_DISABLE;
    conf.scl_pullup_en    = GPIO_PULLUP_DISABLE;
    conf.clk_flags        = 0;
    conf.master.clk_speed = I2C_MASTER_FREQ_HZ;
    i2c_param_config (I2C_MASTER_NUM, &conf);

    i2c_driver_install (I2C_MASTER_NUM, I2C_MODE_MASTER, 0, 0, 0);
}

static void i2c_teardown (void) {
    i2c_driver_delete (I2C_MASTER_NUM);
}

void battery_monitor_task (void * _pvParameter) {
    Max17620 dig_bat_mon;

    if (HW_TYPE == SOTAcat_HW_Type::K5EM_1) {
        // Determine if we have a digital battery monitor
        i2c_setup();

        // Set up the SMBus for the digital battery monitor
        smbus_info_t * smbus_info = smbus_malloc();
        smbus_init (smbus_info, I2C_MASTER_NUM, MAX_1726x_ADDR);
        smbus_set_timeout (smbus_info, SMBUS_TIMEOUT_MS / portTICK_PERIOD_MS);

        // Instantiate the digital battery monitor driver
        max17620_setup_t battery_setup;
        dig_bat_mon.default_setup (&battery_setup);
        esp_err_t bat_mon_err = dig_bat_mon.init (smbus_info, &battery_setup);

        // Check for the digital battery monitor
        if (bat_mon_err == ESP_OK) {
            max17260_detected = true;
            dig_bat_mon.read_learned_params (&params);
        }
        else {  // No digital battery monitor dectected, free resources
            smbus_free (&smbus_info);
            i2c_teardown();
        }
    }

    uint32_t cnt = 0;
    while (true) {
        vbat_analog = get_analog_battery_voltage();
        vpct_analog = get_analog_battery_percentage (vbat_analog);
        if (max17260_detected) {
            max17260_info_t bat_info;
            dig_bat_mon.poll (&bat_info);
            vbat_digital = bat_info.voltage_average;
            vpct_digital = bat_info.reported_state_of_charge;
            if (!(cnt % REPORTING_TIME_SEC)) {
                ESP_LOGI (TAG8, "battery: %4.2fV %4.1f%% %5.1fmA %s", vbat_digital, vpct_digital, bat_info.current_average, (bat_info.charging ? "charging" : "discharging"));
            }
        }
        else {
            if (!(cnt % REPORTING_TIME_SEC))
                ESP_LOGI (TAG8, "battery: %4.2fV %4.2f%%", get_battery_voltage(), get_battery_percentage());
        }

        ESP_LOGI (TAG8, "Free heap: %" PRIu32, esp_get_free_heap_size());

        vTaskDelay (BATTERY_POLL_TIME_MS / portTICK_PERIOD_MS);
        cnt++;
    }
}
