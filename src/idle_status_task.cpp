#include <driver/gpio.h>
#include <math.h>
#include <time.h>
#include "enter_deep_sleep.h"
#include "get_battery_voltage.h"
#include "globals.h"
#include "idle_status_task.h"
#include "settings.h"
#include "settings_hardware_specific.h"

#include <esp_log.h>
static const char *TAG8 = "sc:idletask";

// ====================================================================================================
void idle_status_task(void *pvParameter)
{
    while (1)
    {
        float batv = get_battery_voltage();

        size_t _free = 0;
        size_t _alloc = 0;
        multi_heap_info_t hinfo;
        heap_caps_get_info(&hinfo, MALLOC_CAP_DEFAULT);
        _free = hinfo.total_free_bytes;
        _alloc = hinfo.total_allocated_bytes;
        ESP_LOGV(TAG8, "heap: %u (used %u, free %u) [bytes]", _alloc + _free, _alloc, _free);

        // Get the current time
        time_t now;
        time(&now); // Time in seconds

        int blinks = ceil((now - LastUserActivityUnixTime) / (AUTO_SHUTDOWN_TIME_SECONDS / 4.0));
        ESP_LOGV(TAG8, "blinks %d", blinks);
        if (blinks > 4)
        {
            if (get_battery_percentage(batv) < BATTERY_SHUTOFF_PERCENTAGE)
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
            else
            {
                // The user has been idle for the limit, but we have enough battery to keep running.
                // If we are plugged in via USB, we will never power off because the battery will
                // remain charged above 80%.
                // Reset the timers as if the user has been active.
                showActivity();
            }
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
    while (true)
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
    if (showUserActivityBlinkTaskHandle == NULL)
    {
        xTaskCreate(activityLedBlinkTask, "ActivityLEDblinkControlTask", 2048, NULL, SC_TASK_PRIORITY_LOW, &showUserActivityBlinkTaskHandle);
    }

    // Reset the inactivity timer to the current time, so we can remember when the user was last active.
    time(&LastUserActivityUnixTime);
    gpio_set_level(LED_RED, LED_ON);

    // Signal the LED control task to reset its wait timer
    xTaskNotifyGive(showUserActivityBlinkTaskHandle);
}
