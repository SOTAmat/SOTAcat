#pragma once

#include <freertos/FreeRTOS.h>
#include <freertos/task.h>
#include "max17260.h"

enum class BatteryChargingState {
    UNKNOWN,
    NOT_CHARGING,
    CHARGING
};

typedef max17260_info_t batteryInfo_t;

BatteryChargingState get_battery_charging_state (void);
float                get_battery_voltage (void);
float                get_battery_percentage (void);
esp_err_t            get_battery_info(batteryInfo_t*);

extern TaskHandle_t xBatteryMonitorHandle;
extern void         battery_monitor_task (void * pvParameter);
