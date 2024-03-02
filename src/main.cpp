#include "esp_log.h"
#include "loop.h"
#include "setup.h"

const char *TAG = "SOTAmat";

extern "C" void app_main(void) {
    ESP_LOGI(TAG, "app_main() started");

    setup();

    while (1)
    {
        loop();
    }
}
