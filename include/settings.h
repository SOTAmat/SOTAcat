#pragma once

// ADC Battery measurement
#define BATTERY_SAMPLES_TO_AVERAGE 16
#define BATTERY_CALIBRATION_VALUE  1.006879

// LED behavior
#define LED_FLASH_MSEC    25
#define LED_OFF_TIME_MSEC 3000

// Power management
// Shutdown after 30 minutes of inactivity
#define AUTO_SHUTDOWN_TIME_SECONDS (60 * 30)

// WiFi Settings
#define MAX_RETRY_WIFI_STATION_CONNECT 4

#define MAX_WIFI_SSID_SIZE 32  // see sizeof wifi_ap/sta_config_t.ssid;
#define MAX_WIFI_PASS_SIZE 64  // see sizeof wifi_ap/sta_config_t.password;

extern char g_sta1_ssid[MAX_WIFI_SSID_SIZE];
extern char g_sta1_pass[MAX_WIFI_PASS_SIZE];
extern char g_sta2_ssid[MAX_WIFI_SSID_SIZE];
extern char g_sta2_pass[MAX_WIFI_PASS_SIZE];
extern char g_ap_ssid[MAX_WIFI_SSID_SIZE];
extern char g_ap_pass[MAX_WIFI_PASS_SIZE];

extern void init_settings ();
