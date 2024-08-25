#include "globals.h"
#include "kx_radio.h"
#include "webserver.h"

#include <esp_log.h>
static const char * TAG8 = "sc:hdl_stat";

/**
 * Handles an HTTP GET request to reboot the device.
 *
 * @param req Pointer to the HTTP request structure.
 * @return ESP_OK, although.
 */
esp_err_t handler_reboot_get (httpd_req_t * req) {
    ESP_LOGV (TAG8, "trace: %s()", __func__);

    schedule_deferred_reboot (req);
    REPLY_WITH_SUCCESS();
}
