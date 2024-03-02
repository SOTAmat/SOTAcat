#include "driver/gpio.h"
#include "esp_http_server.h"
#include "esp_log.h"
#include "kx_commands.h"
#include "globals.h"
#include "settings.h"

esp_err_t handler_connectionStatus_get(httpd_req_t *req)
{
    showActivity();

    ESP_LOGI(TAG, "%s()", __func__);

    xSemaphoreTake(KXCommunicationMutex, portMAX_DELAY);
    long transmitting = get_from_kx("TQ", 2, 1);
    xSemaphoreGive(KXCommunicationMutex);

    const char * symbol;
    switch (transmitting) {
        case 0:
            symbol = "🟢";
            break;
        case 1:
            symbol = "🔴";
            break;
        default: // includes transmitting == -1, the failure case
            symbol = "⚪";
    }
    httpd_resp_send(req, symbol, HTTPD_RESP_USE_STRLEN);
    ESP_LOGI(TAG, "Returning connection status: %s", symbol);
    return ESP_OK;
}
