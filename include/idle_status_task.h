#pragma once

#include <ctime>
#include <freertos/FreeRTOS.h>
#include <freertos/task.h>

extern TaskHandle_t xInactivityWatchdogHandle;
extern time_t       LastUserActivityUnixTime;
extern void         idle_status_task (void * pvParameter);
