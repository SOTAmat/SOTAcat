#include <math.h>
#include <time.h>
#include "driver/gpio.h"
#include "enter_deep_sleep.h"
#include "esp_log.h"
#include "freertos/FreeRTOS.h"
#include "freertos/task.h"
#include "get_battery_voltage.h"
#include "globals.h"
#include "settings.h"

// ====================================================================================================
void idle_status_task(void *pvParameter)
{
    while (1)
    {

        if (NewCommandReceived)
        {
            // Reset the timer
            NewCommandReceived = false;
            time(&LastUserActivityUnixTime);
            gpio_set_level(LED_RED, LED_OFF);
        }

        get_battery_voltage();

        // Get the current time
        time_t now;
        time(&now); // Time in seconds

        int blinks = ceil((now - LastUserActivityUnixTime) / (AUTO_SHUTDOWN_TIME_SECONDS / 4.0));
        ESP_LOGI(TAG, "Blinks %d", blinks);
        if (blinks > 4)
        {
            gpio_set_level(LED_BLUE, LED_ON);
            gpio_set_level(LED_RED, LED_ON);
            vTaskDelay(LED_FLASH_MSEC * 15 / portTICK_PERIOD_MS);
            gpio_set_level(LED_BLUE, LED_OFF);
            gpio_set_level(LED_RED, LED_OFF);

            // Power off, the user has been idle for the limit.
            ESP_LOGI(TAG, "Powering off due to inactivity");

            enter_deep_sleep();
        }

        for (int i = 1; i <= blinks; i++)
        {
            gpio_set_level(LED_BLUE, CommandInProgress ? LED_OFF : LED_ON); // LED on
            vTaskDelay(LED_FLASH_MSEC / portTICK_PERIOD_MS);

            gpio_set_level(LED_BLUE, CommandInProgress ? LED_ON : LED_OFF); // LED off
            vTaskDelay((4 * LED_FLASH_MSEC) / portTICK_PERIOD_MS);
        }

        vTaskDelay(LED_OFF_TIME_MSEC / portTICK_PERIOD_MS);
    }
}