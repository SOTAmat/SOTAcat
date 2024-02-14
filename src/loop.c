#include "esp_log.h"
#include "freertos/FreeRTOS.h"
#include "freertos/task.h"
#include "loop.h"

void loop()
{
    vTaskDelay(pdMS_TO_TICKS(1000));
}