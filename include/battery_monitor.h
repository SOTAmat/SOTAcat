#pragma once

#include <freertos/FreeRTOS.h>
#include <freertos/task.h>

enum class BatteryChargingState {
    UNKNOWN,
    NOT_CHARGING,
    CHARGING
};

extern BatteryChargingState g_battery_charging_state;

BatteryChargingState get_battery_charging_state (void);
float                get_battery_voltage (void);
float                get_battery_percentage (void);

extern TaskHandle_t xBatteryMonitorHandle;
extern void         battery_monitor_task (void * pvParameter);
