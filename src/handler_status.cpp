#include "driver/gpio.h"
#include "esp_http_server.h"
#include "kx_commands.h"
#include "globals.h"
#include "settings.h"
#include <mutex>

#include "esp_log.h"
static const char * TAG8 = "sc:hdl_stat";

esp_err_t handler_connectionStatus_get(httpd_req_t *req)
{
    showActivity();

    ESP_LOGV(TAG8, "trace: %s()", __func__);

    long transmitting;
    {
        const std::lock_guard<Lock> lock(RadioPortLock);
        transmitting = get_from_kx("TQ", 2, 1);
    }

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
    ESP_LOGI(TAG8, "returning connection status: %s", symbol);
    return ESP_OK;
}
