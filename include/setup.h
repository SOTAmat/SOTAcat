#pragma once
#include <cstdint>
#include <freertos/FreeRTOS.h>
#include <freertos/task.h>

extern void setup ();

typedef struct
{
    TaskHandle_t setup_task_handle;
    uint32_t     notification_bit;
} TaskNotifyConfig;

extern void start_radio_connection_task (TaskNotifyConfig * config);
