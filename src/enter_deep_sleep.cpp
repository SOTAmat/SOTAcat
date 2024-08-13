#include "enter_deep_sleep.h"
#include "hardware_specific.h"
#include "settings.h"
#include "setup_adc.h"

#include <driver/rtc_io.h>
#include <esp_sleep.h>
#include <esp_wifi.h>

#include <esp_log.h>
static const char * TAG8 = "sc:sleep...";

void enter_deep_sleep () {
    ESP_LOGV (TAG8, "trace: %s()", __func__);

    ESP_LOGI (TAG8, "preparing for deep sleep:");
    esp_wifi_stop();
    ESP_LOGI (TAG8, "wifi is stopped.");
    shutdown_adc();
    ESP_LOGI (TAG8, "adc is shutdown.");

    // Return all the GPIO pins to their isolated state so that there isn't current drain when sleeping
    gpio_set_level (LED_BLUE, LED_OFF);
    gpio_set_direction (LED_BLUE, GPIO_MODE_INPUT);
    gpio_pullup_dis (LED_BLUE);
    gpio_pulldown_dis (LED_BLUE);

    gpio_set_level (LED_RED, LED_OFF);
    gpio_set_direction (LED_RED, GPIO_MODE_INPUT);
    gpio_pullup_dis (LED_RED);
    gpio_pulldown_dis (LED_RED);

    if (LED_RED_SUPL > 0) {
        gpio_set_direction (LED_RED_SUPL, GPIO_MODE_INPUT);
        gpio_pullup_dis (LED_RED_SUPL);
        gpio_pulldown_dis (LED_RED_SUPL);
    }

#ifndef SEEED_XIAO
    rtc_gpio_isolate (LED_BLUE);
    rtc_gpio_isolate (LED_RED);
    rtc_gpio_isolate (LED_RED_SUPL);
#endif
    ESP_LOGI (TAG8, "all gpio pins off and isolated.");

    // esp_sleep_pd_config(ESP_PD_DOMAIN_XTAL, ESP_PD_OPTION_OFF);
    // esp_sleep_pd_config(ESP_PD_DOMAIN_CPU, ESP_PD_OPTION_OFF);
    // esp_sleep_pd_config(ESP_PD_DOMAIN_RTC8M, ESP_PD_OPTION_OFF);
    // esp_sleep_pd_config(ESP_PD_DOMAIN_VDDSDIO, ESP_PD_OPTION_OFF);

    ESP_LOGI (TAG8, "entering deep sleep...");
    ESP_LOGI (TAG8, "goodnight!");
    esp_deep_sleep_start();
}
