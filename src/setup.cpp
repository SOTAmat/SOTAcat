#include <driver/gpio.h>
#include <esp_wifi.h>
#include "enter_deep_sleep.h"
#include "get_battery_voltage.h"
#include "globals.h"
#include "idle_status_task.h"
#include "kx_radio.h"
#include "settings.h"
#include "settings_hardware_specific.h"
#include "setup.h"
#include "setup_adc.h"
#include "webserver.h"
#include "wifi.h"

#include <esp_log.h>
static const char *TAG8 = "sc:setup...";

time_t LastUserActivityUnixTime;
bool CommandInProgress = false;
TaskHandle_t xInactivityWatchdogHandle = NULL;

/**
 * Start a watchdog timer to shut the unit down if we aren't able to fully initialize within 60 seconds,
 * and our battery is below the BATTERY_SHUTOFF_PERCENTAGE
 */
void startup_watchdog_timer(void *_)
{
    do
    {
        vTaskDelay(pdMS_TO_TICKS(60000));
    } 
    // We will never turn off if the unit is plugged in and is charging,
    // as the battery voltage will never dip below 80%.
    while (get_battery_percentage(get_battery_voltage()) >= BATTERY_SHUTOFF_PERCENTAGE);

    ESP_LOGI(TAG8, "Startup watchdog timer expired, and battery not charged; shutting down.");
    enter_deep_sleep();
}

// ====================================================================================================
void setup()
{
    esp_log_level_set("*", ESP_LOG_VERBOSE);
#if 0
    for (int i = 0; i < 5; i++)
    {
        ESP_LOGI(TAG8, "setup starting soon: waiting for debug console connection");
        vTaskDelay(pdMS_TO_TICKS(1000));
    }
#endif
    ESP_LOGV(TAG8, "trace: %s()", __func__);

    //  Turn on the board LED to indicate that we are starting up
    gpio_set_direction(LED_BLUE, GPIO_MODE_OUTPUT);
    gpio_set_direction(LED_RED, GPIO_MODE_OUTPUT);
    gpio_set_direction(LED_RED_SUPL, GPIO_MODE_OUTPUT);
    gpio_set_level(LED_RED_SUPL, 1);
    gpio_set_level(LED_BLUE, LED_ON);
    gpio_set_level(LED_RED, LED_ON);

    UBaseType_t currentPriority = uxTaskPriorityGet(NULL);
    ESP_LOGI(TAG8, "current setup() task priority is %d", currentPriority);

    // Note the current time since our inactivity power down time will be based on this.
    time(&LastUserActivityUnixTime);
    // Start a watchdog timer to shut the unit down if we aren't able to fully initialize within 60 seconds.
    TaskHandle_t xSetupWatchdogHandle = NULL;
    xTaskCreate(&startup_watchdog_timer, "startup_watchdog_task", 2048, NULL, SC_TASK_PRIORITY_NORMAL, &xSetupWatchdogHandle);
    ESP_LOGI(TAG8, "shutdown watchdog started.");

    // Initialize and restore settings
    init_settings();

    // Start battery monitoring by enabling the ADC
    setup_adc();

    // Initialize Wi-Fi as AP
    wifi_init();
    gpio_set_level(LED_RED, LED_OFF);
    ESP_LOGI(TAG8, "wifi initialized.");

    // After connecting to WiFi, start mDNS service
    start_mdns_service();
    ESP_LOGI(TAG8, "mdns initialized.");

    // Start the web server
    start_webserver();
    ESP_LOGI(TAG8, "webserver initialized.");

    // Flash the LED to indicate we are done with Wifi
    for (int i = 0; i < 3; i++)
    {
        gpio_set_level(LED_BLUE, LED_OFF);
        gpio_set_level(LED_RED, LED_ON);
        vTaskDelay(pdMS_TO_TICKS(100));
        gpio_set_level(LED_BLUE, LED_ON);
        gpio_set_level(LED_RED, LED_OFF);
        vTaskDelay(pdMS_TO_TICKS(100));
    }

    // kxRadio is statically initialized as a singleton, but we
    // do need to connect SOTACAT to its ACC port
    {
        const std::lock_guard<Lockable> lock(kxRadio);
        kxRadio.connect();  // this will block until radio connected
    }
    ESP_LOGI(TAG8, "radio connection established");

    //  We exit with the LED off.
    gpio_set_level(LED_BLUE, LED_OFF);

    // Cancel the startup watchdog timer task
    vTaskDelete(xSetupWatchdogHandle);
    ESP_LOGI(TAG8, "setup watchdog canceled.");

    // Setup quiescent LED flashing timer
    xTaskCreate(&idle_status_task, "sleep_status_task", 2048, NULL, SC_TASK_PRIORITY_IDLE, &xInactivityWatchdogHandle);
    ESP_LOGI(TAG8, "idle task started.");
}
