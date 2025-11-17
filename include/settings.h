#pragma once

#include "esp_err.h"    // For esp_err_t
#include "webserver.h"  // For httpd_req_t

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
extern char g_sta3_ssid[MAX_WIFI_SSID_SIZE];
extern char g_sta3_pass[MAX_WIFI_PASS_SIZE];
extern char g_ap_ssid[MAX_WIFI_SSID_SIZE];
extern char g_ap_pass[MAX_WIFI_PASS_SIZE];

#define MAX_GPS_LAT_SIZE 32
#define MAX_GPS_LON_SIZE 32
extern char g_gps_lat[MAX_GPS_LAT_SIZE];
extern char g_gps_lon[MAX_GPS_LON_SIZE];

#define MAX_CALLSIGN_SIZE 16
extern char g_callsign[MAX_CALLSIGN_SIZE];

void      init_settings ();
esp_err_t retrieve_and_send_settings (httpd_req_t * req);
esp_err_t handler_settings_get (httpd_req_t * req);
esp_err_t handler_settings_post (httpd_req_t * req);
esp_err_t handler_gps_settings_get (httpd_req_t * req);
esp_err_t handler_gps_settings_post (httpd_req_t * req);
esp_err_t handler_callsign_settings_get (httpd_req_t * req);
esp_err_t handler_callsign_settings_post (httpd_req_t * req);
