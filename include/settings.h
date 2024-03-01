#pragma once

#include "settings_hardware_specific.h"

// ADC Battery measurement
#define BATTERY_SAMPLES_TO_AVERAGE 16
#define BATTERY_CALIBRATION_VALUE 1.006879

// LED behavior
#define LED_FLASH_MSEC 25
#define LED_OFF_TIME_MSEC 3000

// Power management
// Shutdown after 30 minutes of inactivity
#define AUTO_SHUTDOWN_TIME_SECONDS (60 * 30)

// WiFi Settings
#define MAX_RETRY_WIFI_STATION_CONNECT 3
