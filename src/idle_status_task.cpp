#include <math.h>
#include <time.h>
#include "driver/gpio.h"
#include "enter_deep_sleep.h"
#include "freertos/FreeRTOS.h"
#include "freertos/task.h"
#include "get_battery_voltage.h"
#include "globals.h"
#include "settings.h"

#include "esp_log.h"
static const char * TAG8 = "sc:idletask";

// ====================================================================================================
void idle_status_task(void *pvParameter)
{
    while (1)
    {
        get_battery_voltage();

        // Get the current time
        time_t now;
        time(&now); // Time in seconds

        int blinks = ceil((now - LastUserActivityUnixTime) / (AUTO_SHUTDOWN_TIME_SECONDS / 4.0));
        ESP_LOGV(TAG8, "blinks %d", blinks);
        if (blinks > 4)
        {
            gpio_set_level(LED_BLUE, LED_ON);
            gpio_set_level(LED_RED, LED_ON);
            vTaskDelay(LED_FLASH_MSEC * 15 / portTICK_PERIOD_MS);
            gpio_set_level(LED_BLUE, LED_OFF);
            gpio_set_level(LED_RED, LED_OFF);

            // Power off, the user has been idle for the limit.
            ESP_LOGI(TAG8, "powering off due to inactivity");

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

// ====================================================================================================
static TaskHandle_t showUserActivityBlinkTaskHandle = NULL;

// LED Control Task
void activityLedBlinkTask(void *param) 
{
    while(true)
    {
        // Wait for the signal to turn off the LED with after a timeout
        if (ulTaskNotifyTake(pdTRUE, pdMS_TO_TICKS(LED_FLASH_MSEC)) == pdTRUE) 
        {
            // If we received a notification, it means the timer was reset
            // Continue to wait again for 50ms or for another reset
            continue;
        }

        gpio_set_level(LED_RED, LED_OFF);
    }
}

// Function called by handlers to show the user that a command was received
// by blinking the LED.  Needs to handle the reentrancy case where a new
// command is received before the LED is done blinking.
// This runs as a low priority task so it can be interrupted by real work.
void showActivity()
{
    // The first time we setup the task that will turn off the LED
    if (showUserActivityBlinkTaskHandle == NULL) {
        xTaskCreate(activityLedBlinkTask, "ActivityLEDblinkControlTask", 2048, NULL, tskIDLE_PRIORITY, &showUserActivityBlinkTaskHandle);
    }

    // Reset the inactivity timer and remember how long it has been since the last user activity
    time(&LastUserActivityUnixTime);
    gpio_set_level(LED_RED, LED_ON);

    // Signal the LED control task to reset its wait timer
    xTaskNotifyGive(showUserActivityBlinkTaskHandle);
}
