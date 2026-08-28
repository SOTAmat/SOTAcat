#include "globals.h"
#include "radio_service.h"
#include "radio_http.h"
#include "webserver.h"

#include <esp_log.h>
static const char * TAG8 = "sc:hdl_atu.";

/**
 * Handles an HTTP PUT request to initiate ATU (Antenna Tuning Unit) tuning.
 * This function sends the appropriate command based on the detected radio type:
 * - KX3: SWT44
 * - KX2: SWT20
 * - KH1: SW3T
 *
 * @param req Pointer to the HTTP request structure.
 * @return ESP_OK on success, or an error code on failure.
 */
esp_err_t handler_atu_put (httpd_req_t * req) {
    showActivity();

    ESP_LOGV (TAG8, "trace: %s()", __func__);

    return radio_set_via_http (req, RadioCmdType::SET_ATU, 0, "ATU tune");
}
