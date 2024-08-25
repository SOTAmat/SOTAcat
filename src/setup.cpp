#include "setup.h"
#include "battery_monitor.h"
#include "enter_deep_sleep.h"
#include "globals.h"
#include "hardware_specific.h"
#include "idle_status_task.h"
#include "kx_radio.h"
#include "settings.h"
#include "setup_adc.h"
#include "webserver.h"
#include "wifi.h"

#include <driver/gpio.h>
#include <esp_wifi.h>
#include <freertos/FreeRTOS.h>
#include <freertos/task.h>

#include <esp_log.h>
static const char * TAG8 = "sc:setup...";

time_t       LastUserActivityUnixTime;
bool         CommandInProgress         = false;
TaskHandle_t xInactivityWatchdogHandle = NULL;

/**
 * Start a watchdog timer to shut the unit down if we aren't able to fully initialize within 60 seconds,
 * and our battery is below the BATTERY_SHUTOFF_PERCENTAGE
 */
void startup_watchdog_timer (void * _) {
    do {
        vTaskDelay (pdMS_TO_TICKS (60000));
    }
    // We will never turn off if the unit is plugged in and is charging,
    // as the battery voltage will never dip below 80%.
    while (get_battery_percentage() >= BATTERY_SHUTOFF_PERCENTAGE);

    ESP_LOGI (TAG8, "Startup watchdog timer expired, and battery not charged; shutting down.");
    enter_deep_sleep();
}

// ====================================================================================================
void radio_connection_task (void * pvParameters) {
    TaskNotifyConfig * config = (TaskNotifyConfig *)pvParameters;
    ESP_LOGI (TAG8, "Attempting to connect to radio...");
    // kxRadio is statically initialized as a singleton, but we
    // do need to connect SOTACAT to its ACC port
    {
        const std::lock_guard<Lockable> lock (kxRadio);
        kxRadio.connect();
    }
    ESP_LOGI (TAG8, "Radio connected, exiting search task.");
    xTaskNotify (config->setup_task_handle, config->notification_bit, eSetBits);
    vTaskDelete (NULL);
}

void start_radio_connection_task (TaskNotifyConfig * config) {
    xTaskCreate (&radio_connection_task, "radio_task", 4096, (void *)config, SC_TASK_PRIORITY_NORMAL, NULL);
}

// ====================================================================================================
void setup () {
    // We no longer need to set the log level here, as it is set in the platformio.ini file
    // differently for each build target.  I only leave it here if in the future you want
    // to have the platformio.ini use "Debug" or "Informational" for debug builds, and
    // "Informational" or "Warning" for release builds.  In that case for deep debug you can set
    // "ESP_LOG_VERBOSE" here.
    // esp_log_level_set ("*", ESP_LOG_VERBOSE);
#if 0
    for (int i = 0; i < 5; i++)
    {
        ESP_LOGI(TAG8, "setup starting soon: waiting for debug console connection");
        vTaskDelay(pdMS_TO_TICKS(1000));
    }
#endif
    ESP_LOGV (TAG8, "trace: %s()", __func__);

    set_hardware_specific();

    //  Turn on the board LED to indicate that we are starting up
    gpio_set_direction (LED_BLUE, GPIO_MODE_OUTPUT);
    gpio_set_direction (LED_RED, GPIO_MODE_OUTPUT);
    if (LED_RED_SUPL > 0) {
        gpio_set_direction (LED_RED_SUPL, GPIO_MODE_OUTPUT);
        gpio_set_level (LED_RED_SUPL, 1);
    }
    gpio_set_level (LED_BLUE, LED_ON);
    gpio_set_level (LED_RED, LED_ON);

    UBaseType_t currentPriority = uxTaskPriorityGet (NULL);
    ESP_LOGI (TAG8, "current setup() task priority is %d", currentPriority);

    // Note the current time since our inactivity power down time will be based on this.
    time (&LastUserActivityUnixTime);
    // Start a watchdog timer to shut the unit down if we aren't able to fully initialize within 60 seconds.
    TaskHandle_t xSetupWatchdogHandle = NULL;
    xTaskCreate (&startup_watchdog_timer, "startup_watchdog_task", 2048, NULL, SC_TASK_PRIORITY_NORMAL, &xSetupWatchdogHandle);
    ESP_LOGI (TAG8, "shutdown watchdog started.");

    // Initialize and restore settings
    init_settings();

    // Start battery monitoring by enabling the ADC
    setup_adc();

    // Start WiFi task
    TaskHandle_t     setup_task_handle = xTaskGetCurrentTaskHandle();
    TaskNotifyConfig wifi_config       = {setup_task_handle, (1 << 0)};
    TaskNotifyConfig radio_config      = {setup_task_handle, (1 << 1)};

    ESP_LOGI (TAG8, "Starting WiFi task...");
    start_wifi_task (&wifi_config);  // Start WiFi task
    ESP_LOGI (TAG8, "Starting radio connection task...");
    start_radio_connection_task (&radio_config);  // Start radio connection task in parallel

    // Wait for WiFi connection
    uint32_t notification_value;
    xTaskNotifyWait (0, 0, &notification_value, portMAX_DELAY);

    // Setup battery monitoring task
    TaskHandle_t xBatteryMonitorHandle = NULL;
    xTaskCreate (&battery_monitor_task, "battery_monitor_task", 2048, NULL, SC_TASK_PRIORITY_IDLE + 1, &xBatteryMonitorHandle);
    ESP_LOGI (TAG8, "battery_monitor task started.");

    gpio_set_level (LED_RED, LED_OFF);
    ESP_LOGI (TAG8, "wifi initialized.");

    // mDNS is now started in the WiFi task
    // // After connecting to WiFi, start mDNS service
    // start_mdns_service();
    // ESP_LOGI (TAG8, "mdns initialized.");

    // Start the web server
    start_webserver();
    ESP_LOGI (TAG8, "webserver initialized.");

    // Flash the LED to indicate we are done with Wifi
    for (int i = 0; i < 3; i++) {
        gpio_set_level (LED_BLUE, LED_OFF);
        gpio_set_level (LED_RED, LED_ON);
        vTaskDelay (pdMS_TO_TICKS (100));
        gpio_set_level (LED_BLUE, LED_ON);
        gpio_set_level (LED_RED, LED_OFF);
        vTaskDelay (pdMS_TO_TICKS (100));
    }

    // Wait for radio connection
    xTaskNotifyWait (0, 0, &notification_value, portMAX_DELAY);
    ESP_LOGI (TAG8, "radio connection established.");

    //  We exit with the LED off.
    gpio_set_level (LED_BLUE, LED_OFF);

    // Cancel the startup watchdog timer task
    vTaskDelete (xSetupWatchdogHandle);
    ESP_LOGI (TAG8, "setup watchdog canceled.");

    // Setup quiescent LED flashing timer
    xTaskCreate (&idle_status_task, "sleep_status_task", 2048, NULL, SC_TASK_PRIORITY_IDLE, &xInactivityWatchdogHandle);
    ESP_LOGI (TAG8, "idle task started.");
}
