#pragma once

#include <esp_adc/adc_oneshot.h>

extern bool CommandInProgress;
extern void showActivity ();

extern adc_oneshot_unit_handle_t   Global_adc1_handle;
extern adc_oneshot_unit_init_cfg_t Global_init_config1;
extern adc_cali_handle_t           Global_cali_handle;
extern adc_oneshot_chan_cfg_t      Global_chan_cfg;

extern "C" bool starts_with (const char * string, const char * prefix);

#define SC_TASK_PRIORITY_HIGHEST 8
#define SC_TASK_PRIORITY_HIGH    6
#define SC_TASK_PRIORITY_NORMAL  5
#define SC_TASK_PRIORITY_LOW     4
#define SC_TASK_PRIORITY_IDLE    1

#define BATTERY_SHUTOFF_PERCENTAGE 70.0f
