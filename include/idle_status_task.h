#pragma once

extern TaskHandle_t xInactivityWatchdogHandle;
extern time_t LastUserActivityUnixTime;
void idle_status_task(void *pvParameter);