#include "idle_status_task.h"
#include "battery_monitor.h"
#include "enter_deep_sleep.h"
#include "globals.h"
#include "hardware_specific.h"
#include "settings.h"

#include <driver/gpio.h>
#include <math.h>
#include <time.h>

#include "esp_timer.h"
#include "max17260.h"
#include "smbus.h"
#include <driver/i2c.h>

#include <esp_log.h>
static const char * TAG8 = "sc:idletask";

/**
 * Task that continuously monitors and manages the system status based on battery level, heap usage,
 * and user activity. The task handles power management by initiating a shutdown if the system has
 * been idle beyond a set threshold and the battery level is too low. It also manages signaling
 * user activity and system status via LEDs.
 *
 * @param _pvParameter Unused parameter
 */
void idle_status_task (void * _pvParameter) {
    while (1) {
        size_t _free  = 0;
        size_t _alloc = 0;

        multi_heap_info_t hinfo;
        heap_caps_get_info (&hinfo, MALLOC_CAP_DEFAULT);
        _free  = hinfo.total_free_bytes;
        _alloc = hinfo.total_allocated_bytes;
        ESP_LOGV (TAG8, "heap: %u (used %u, free %u) [bytes]", _alloc + _free, _alloc, _free);

        // Get the current time
        time_t now;
        time (&now);  // Time in seconds

        int blinks = ceil ((now - LastUserActivityUnixTime) / (AUTO_SHUTDOWN_TIME_SECONDS / 4.0));
        ESP_LOGV (TAG8, "blinks %d", blinks);

        // Count USB detection as a user event
        if (gpio_get_level (USB_DET_PIN)) {
            ESP_LOGV (TAG8, "USB power connected");
            blinks = 1;
        }

        if (blinks > 4) {
            if (get_battery_percentage() < BATTERY_SHUTOFF_PERCENTAGE) {
                gpio_set_level (LED_BLUE, LED_ON);
                gpio_set_level (LED_RED, LED_ON);
                vTaskDelay (LED_FLASH_MSEC * 15 / portTICK_PERIOD_MS);
                gpio_set_level (LED_BLUE, LED_OFF);
                gpio_set_level (LED_RED, LED_OFF);

                // Power off, the user has been idle for the limit.
                ESP_LOGI (TAG8, "powering off due to inactivity");

                enter_deep_sleep();
            }
            else {
                // The user has been idle for the limit, but we have enough battery to keep running.
                // If we are plugged in via USB, we will never power off because the battery will
                // remain charged above 80%.
                // Reset the timers as if the user has been active.
                showActivity();
            }
        }

        for (int i = 1; i <= blinks; i++) {
            gpio_set_level (LED_BLUE, CommandInProgress ? LED_OFF : LED_ON);  // LED on
            vTaskDelay (LED_FLASH_MSEC / portTICK_PERIOD_MS);

            gpio_set_level (LED_BLUE, CommandInProgress ? LED_ON : LED_OFF);  // LED off
            vTaskDelay ((4 * LED_FLASH_MSEC) / portTICK_PERIOD_MS);
        }

        vTaskDelay (LED_OFF_TIME_MSEC / portTICK_PERIOD_MS);
    }
}

/**
 * Task handle for controlling the activity LED blink pattern.
 */
static TaskHandle_t showUserActivityBlinkTaskHandle = NULL;

/**
 * Task to control the blinking of an activity LED. The task waits for a notification to reset its
 * timer and turns off the LED after a specified timeout. This task manages the visual indication
 * of the system activity and command responses.
 *
 * @param _param Unused parameter
 */
void activityLedBlinkTask (void * _param) {
    while (true) {
        // Wait for the signal to turn off the LED with after a timeout
        if (ulTaskNotifyTake (pdTRUE, pdMS_TO_TICKS (LED_FLASH_MSEC)) == pdTRUE) {
            // If we received a notification, it means the timer was reset
            // Continue to wait again for 50ms or for another reset
            continue;
        }

        gpio_set_level (LED_RED, LED_OFF);
    }
}

/**
 * Triggers the LED to indicate that a command has been received and resets the user inactivity timer.
 * This function initializes the blink task on the first call and subsequently notifies the task to reset
 * the LED timeout whenever a new activity is detected. It ensures that the user is visually informed
 * of the system's responsiveness to commands.
 * Needs to handle the reentrancy case where a new command is received before the LED is done blinking.
 * This runs as a low priority task so it can be interrupted by real work.
 */
void showActivity () {
    // The first time we setup the task that will turn off the LED
    if (showUserActivityBlinkTaskHandle == NULL)
        xTaskCreate (activityLedBlinkTask, "ActivityLEDblinkControlTask", 2048, NULL, SC_TASK_PRIORITY_LOW, &showUserActivityBlinkTaskHandle);

    // Reset the inactivity timer to the current time, so we can remember when the user was last active.
    time (&LastUserActivityUnixTime);
    gpio_set_level (LED_RED, LED_ON);

    // Signal the LED control task to reset its wait timer
    xTaskNotifyGive (showUserActivityBlinkTaskHandle);
}
