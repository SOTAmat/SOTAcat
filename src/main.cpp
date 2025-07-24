#include "loop.h"
#include "setup.h"

#include <esp_log.h>
static const char * TAG8 = "sc:SOTAcat.";

extern "C" void app_main () {
    ESP_LOGV (TAG8, "trace: %s()", __func__);
    esp_log_level_set("mdns", ESP_LOG_DEBUG);
    setup();

    while (1) loop();
}
