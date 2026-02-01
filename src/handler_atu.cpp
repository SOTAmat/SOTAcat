#include "globals.h"
#include "kx_radio.h"
#include "timed_lock.h"
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

    // Tier 3: Critical timeout for ATU tuning operation
    TIMED_LOCK_OR_FAIL (req, kxRadio.timed_lock (RADIO_LOCK_TIMEOUT_CRITICAL_MS, "ATU tune")) {
        if (!kxRadio.tune_atu())
            REPLY_WITH_FAILURE (req, HTTPD_500_INTERNAL_SERVER_ERROR, "Failed to send ATU command");
    }

    REPLY_WITH_SUCCESS();
}
