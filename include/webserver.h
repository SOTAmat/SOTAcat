#pragma once

#include "esp_http_server.h"

extern long last_known_frequency;

extern const uint8_t index_html_srt[] asm("_binary_index_html_start");
extern const uint8_t index_html_end[] asm("_binary_index_html_end");
extern const uint8_t main_js_srt[] asm("_binary_main_js_start");
extern const uint8_t main_js_end[] asm("_binary_main_js_end");
extern const uint8_t style_css_srt[] asm("_binary_style_css_start");
extern const uint8_t style_css_end[] asm("_binary_style_css_end");
extern const uint8_t sclogo_png_srt[] asm("_binary_sclogo_png_start");
extern const uint8_t sclogo_png_end[] asm("_binary_sclogo_png_end");
extern const uint8_t favicon_ico_srt[] asm("_binary_favicon_ico_start");
extern const uint8_t favicon_ico_end[] asm("_binary_favicon_ico_end");

extern const uint8_t sota_html_srt[] asm("_binary_sota_html_start");
extern const uint8_t sota_html_end[] asm("_binary_sota_html_end");
extern const uint8_t sota_js_srt[]   asm("_binary_sota_js_start");
extern const uint8_t sota_js_end[]   asm("_binary_sota_js_end");

extern const uint8_t pota_html_srt[] asm("_binary_pota_html_start");
extern const uint8_t pota_html_end[] asm("_binary_pota_html_end");
extern const uint8_t pota_js_srt[]   asm("_binary_pota_js_start");
extern const uint8_t pota_js_end[]   asm("_binary_pota_js_end");

extern const uint8_t settings_html_srt[] asm("_binary_settings_html_start");
extern const uint8_t settings_html_end[] asm("_binary_settings_html_end");

extern const uint8_t about_html_srt[]   asm("_binary_about_html_start");
extern const uint8_t about_html_end[]   asm("_binary_about_html_end");


void start_webserver();

esp_err_t handler_frequency_get();
esp_err_t handler_frequency_put();
esp_err_t handler_mode_get();
esp_err_t handler_mode_put();
esp_err_t handler_rxBandwidth_get();
esp_err_t handler_rxBandwidth_put();
esp_err_t handler_prepareft8_post();
esp_err_t handler_ft8_post();
esp_err_t handler_cancelft8_post();
esp_err_t handler_batteryPercent_get();
esp_err_t handler_batteryVoltage_get();
esp_err_t handler_connectionStatus_get();

// Structure to map URI to symbol
typedef struct
{
    const char *uri;
    const void *asset_start;
    const void *asset_end;
    const char *asset_type;
    long cache_time; // Cache time in seconds
} asset_entry_t;

// Lookup table array
extern asset_entry_t asset_map[];

// Define a struct to hold API name and function pointer
typedef struct
{
    const char *api_name;
    int (*handler_func)(httpd_req_t *);
} api_handler_t;
