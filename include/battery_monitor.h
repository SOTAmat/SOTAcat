#pragma once

#include <freertos/FreeRTOS.h>
#include <freertos/task.h>
#include "max17260.h"

typedef max17260_info_t batteryInfo_t;

bool                 get_battery_is_smart(void);
float                get_battery_voltage (void);
float                get_battery_percentage (void);
esp_err_t            get_battery_info(batteryInfo_t*);

extern TaskHandle_t xBatteryMonitorHandle;
extern void         battery_monitor_task (void * pvParameter);
