#include "loop.h"

#include <freertos/FreeRTOS.h>
#include <freertos/task.h>

void loop () {
    vTaskDelay (pdMS_TO_TICKS (1000));
}
