// handler_atu.cpp
#include "globals.h"
#include "kx_radio.h"
#include "timed_lock.h"
#include "webserver.h"

#include <memory>

#include <esp_log.h>
static const char * TAG8 = "sc:hdl_atu.";

/**
 * Handles an HTTP PUT request to initiate ATU (Antenna Tuning Unit) tuning.
 * This function sends the appropriate command based on the detected radio type:
 * - KX3: SWT44
 * - KX2: SWT20
 *
 * @param req Pointer to the HTTP request structure.
 * @return ESP_OK on success, or an error code on failure.
 */
esp_err_t handler_atu_put (httpd_req_t * req) {
    showActivity();

    ESP_LOGV (TAG8, "trace: %s()", __func__);

    const char * command = nullptr;

    // Tier 3: Critical timeout for ATU tuning operation
    TIMED_LOCK_OR_FAIL (req, kxRadio.timed_lock (RADIO_LOCK_TIMEOUT_CRITICAL_MS, "ATU tune")) {
        // Determine the correct command based on radio type
        switch (kxRadio.get_radio_type()) {
        case RadioType::KX3:
            command = "SWT44;";
            ESP_LOGI (TAG8, "Initiating ATU tune on KX3");
            break;
        case RadioType::KX2:
            command = "SWT20;";
            ESP_LOGI (TAG8, "Initiating ATU tune on KX2");
            break;
        default:
            ESP_LOGE (TAG8, "Unknown radio type, cannot initiate ATU tune");
            REPLY_WITH_FAILURE (req, HTTPD_500_INTERNAL_SERVER_ERROR, "Unknown radio type");
        }

        // Send the command to the radio
        if (!kxRadio.put_to_kx_command_string (command, 1))
            REPLY_WITH_FAILURE (req, HTTPD_500_INTERNAL_SERVER_ERROR, "Failed to send ATU command");
    }

    REPLY_WITH_SUCCESS();
}
