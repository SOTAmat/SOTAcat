#include "loop.h"
#include "setup.h"

#include "esp_log.h"
static const char * TAG8 = "sc:SOTAcat.";

extern "C" void app_main(void) {
    ESP_LOGV(TAG8, "trace: %s()", __func__);

    setup();

    while (1)
    {
        loop();
    }
}
