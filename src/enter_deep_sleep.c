#include "driver/rtc_io.h"
#include "enter_deep_sleep.h"
#include <esp_wifi.h>
#include "esp_log.h"
#include "esp_sleep.h"
#include "globals.h"
#include "settings.h"
#include "setup_adc.h"
#include "WiFi.h"

void enter_deep_sleep()
{
    ESP_LOGI(TAG, "Entering deep sleep...");
    esp_wifi_stop();
    ESP_LOGI(TAG, "Wifi stopped...");
    shutdown_adc();
    ESP_LOGI(TAG, "ADC shutdown...");

    // Return all the GPIO pins to their isolated state so that there isn't current drain when sleeping
    gpio_set_level(LED_BLUE, LED_OFF);
    gpio_set_direction(LED_BLUE, GPIO_MODE_INPUT);
    gpio_pullup_dis(LED_BLUE);
    gpio_pulldown_dis(LED_BLUE);

    gpio_set_level(LED_RED, LED_OFF);
    gpio_set_direction(LED_RED, GPIO_MODE_INPUT);
    gpio_pullup_dis(LED_RED);
    gpio_pulldown_dis(LED_RED);

    gpio_set_direction(LED_RED_SUPL, GPIO_MODE_INPUT);
    gpio_pullup_dis(LED_RED_SUPL);
    gpio_pulldown_dis(LED_RED_SUPL);

#ifndef SEEED_XIAO
    rtc_gpio_isolate(LED_BLUE);
    rtc_gpio_isolate(LED_RED);
    rtc_gpio_isolate(LED_RED_SUPL);
#endif
    ESP_LOGI(TAG, "GPIO's off and isolated...");

    // esp_sleep_pd_config(ESP_PD_DOMAIN_XTAL, ESP_PD_OPTION_OFF);
    // esp_sleep_pd_config(ESP_PD_DOMAIN_CPU, ESP_PD_OPTION_OFF);
    // esp_sleep_pd_config(ESP_PD_DOMAIN_RTC8M, ESP_PD_OPTION_OFF);
    // esp_sleep_pd_config(ESP_PD_DOMAIN_VDDSDIO, ESP_PD_OPTION_OFF);

    ESP_LOGI(TAG, "Entering Deep Sleep...");
    ESP_LOGI(TAG, "Goodnight!");
    esp_deep_sleep_start();
}
