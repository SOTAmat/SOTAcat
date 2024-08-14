#pragma once

#include <freertos/FreeRTOS.h>
#include <freertos/task.h>

float               get_battery_voltage (void);
float               get_battery_percentage (void);
extern TaskHandle_t xBatteryMonitorHandle;
extern void         battery_monitor_task (void * pvParameter);
