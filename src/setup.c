#include <time.h>
#include "driver/gpio.h"
#include "enter_deep_sleep.h"
#include "esp_log.h"
#include "esp_netif.h"
#include "esp_wifi.h"
#include "globals.h"
#include "idle_status_task.h"
#include "kx_commands.h"
#include "nvs_flash.h"
#include "settings.h"
#include "setup.h"
#include "setup_adc.h"
#include "uart_connect.h"
#include "webserver.h"
#include "wifi.h"

time_t LastUserActivityUnixTime;
bool NewCommandReceived = true;
bool CommandInProgress = false;

// ====================================================================================================
static void initialize_nvs()
{
    // Initialize NVS
    esp_err_t ret = nvs_flash_init();
    if (ret == ESP_ERR_NVS_NO_FREE_PAGES || ret == ESP_ERR_NVS_NEW_VERSION_FOUND)
    {
        ESP_ERROR_CHECK(nvs_flash_erase());
        ret = nvs_flash_init();
    }
    ESP_ERROR_CHECK(ret);
}

// ====================================================================================================
void startup_watchdog_timer()
{
    // Start a watchdog timer to shut the unit down if we aren't able to fully initialize within 60 seconds.
    vTaskDelay(pdMS_TO_TICKS(60000));
    ESP_LOGI(TAG, "Startup watchdog timer expired.  Shutting down.");
    enter_deep_sleep();
}

// ====================================================================================================
void setup()
{
    // for (int i = 0; i < 5; i++)
    // {
    //     ESP_LOGI(TAG, "Setup starting soon: waiting for debug console connection");
    //     vTaskDelay(pdMS_TO_TICKS(1000));
    // }

    ESP_LOGI(TAG, "Setup starting...");

    //  Turn on the board LED to indicate that we are starting up
    gpio_set_direction(LED_BLUE, GPIO_MODE_OUTPUT);
    gpio_set_direction(LED_RED, GPIO_MODE_OUTPUT);
    gpio_set_direction(LED_RED_SUPL, GPIO_MODE_OUTPUT);
    gpio_set_level(LED_RED_SUPL, 1);
    gpio_set_level(LED_BLUE, LED_ON);
    gpio_set_level(LED_RED, LED_ON);

    UBaseType_t currentPriority = uxTaskPriorityGet(NULL);
    ESP_LOGI(TAG, "Current setup() task priority is %d", currentPriority);

    // Note the current time since our inactivity power down time will be based on this.
    time(&LastUserActivityUnixTime);
    // Start a watchdog timer to shut the unit down if we aren't able to fully initialize within 60 seconds.
    TaskHandle_t xSetupWatchdogHandle = NULL;
    xTaskCreate(&startup_watchdog_timer, "startup_watchdog_task", 2048, NULL, 5, &xSetupWatchdogHandle);
    ESP_LOGI(TAG, "Shutdown watchdog started...");

    // Initialize NVS
    initialize_nvs();
    ESP_LOGI(TAG, "NVS initialized");

    // Start battery monitoring by enabling the ADC
    setup_adc();

    // Initialize Wi-Fi as AP
    wifi_init();
    gpio_set_level(LED_RED, LED_OFF);
    ESP_LOGI(TAG, "WiFi initialized");

    // After connecting to WiFi, start mDNS service
    start_mdns_service();
    ESP_LOGI(TAG, "mDNS initialized");

    // Start the web server
    start_webserver();
    ESP_LOGI(TAG, "Web Server initialized");

    //  Flash the LED to indicate we are done with Wifi
    for (int i = 0; i < 3; i++)
    {
        gpio_set_level(LED_BLUE, LED_OFF);
        gpio_set_level(LED_RED, LED_ON);
        vTaskDelay(pdMS_TO_TICKS(100));
        gpio_set_level(LED_BLUE, LED_ON);
        gpio_set_level(LED_RED, LED_OFF);
        vTaskDelay(pdMS_TO_TICKS(100));
    }

    // Find out what Baud rate the radio is running at by trying the possibilities until we get a valid response back.
    // Once found, if the baud rate is not 38400, force it to 38400 for FSK use (FT8, etc.)
    uart_connect();
    ESP_LOGI(TAG, "Radio connection established");

    empty_kx_input_buffer(600);

    //  We exit with the LED off.
    gpio_set_level(LED_BLUE, LED_OFF);

    // Cancel the startup watchdog timer task
    vTaskDelete(xSetupWatchdogHandle);
    ESP_LOGI(TAG, "Starting watchdog canceled...");

    // Setup quiescent LED flashing timer
    xTaskCreate(&idle_status_task, "sleep_status_task", 2048, NULL, 1, NULL);
    ESP_LOGI(TAG, "Idle task started...");
}
