#include "globals.h"
#include "kx_radio.h"
#include "timed_lock.h"
#include "webserver.h"

#include <esp_log.h>
static const char * TAG8 = "sc:hdl_vol.";

/**
 * Handles an HTTP GET request to retrieve the current audio gain (volume).
 *
 * This function retrieves the current AF gain level from the KX2/KX3 radio
 * using the AG command. The value is returned as plain text (0-255).
 *
 * @param req Pointer to the HTTP request structure.
 */
esp_err_t handler_volume_get (httpd_req_t * req) {
    showActivity();

    ESP_LOGV (TAG8, "trace: %s()", __func__);

    long volume = -1;

    // Tier 1: Fast timeout for GET operations
    TIMED_LOCK_OR_FAIL (req, kxRadio.timed_lock (RADIO_LOCK_TIMEOUT_FAST_MS, "volume GET")) {
        volume = kxRadio.get_from_kx ("AG", SC_KX_COMMUNICATION_RETRIES, 3);
    }

    char volume_string[8];
    snprintf (volume_string, sizeof (volume_string), "%ld", volume);

    REPLY_WITH_STRING (req, volume_string, "volume");
}

/**
 * Handles an HTTP PUT request to adjust the audio gain (volume).
 *
 * This function adjusts the AF gain level on the KX2/KX3 radio by a delta value.
 * It reads the current volume, adds the delta (clamped to 0-255), and writes back.
 *
 * @param req Pointer to the HTTP request structure. The "delta" query parameter
 *            specifies the amount to adjust (positive or negative).
 */
esp_err_t handler_volume_put (httpd_req_t * req) {
    showActivity();

    ESP_LOGV (TAG8, "trace: %s()", __func__);

    STANDARD_DECODE_SOLE_PARAMETER (req, "delta", param_value);
    ESP_LOGI (TAG8, "adjusting volume by delta '%s'", param_value);

    long delta = atoi (param_value);

    // Tier 2: Moderate timeout for SET operations (read + write)
    TIMED_LOCK_OR_FAIL (req, kxRadio.timed_lock (RADIO_LOCK_TIMEOUT_MODERATE_MS, "volume SET")) {
        // Read current volume
        long current_volume = kxRadio.get_from_kx ("AG", SC_KX_COMMUNICATION_RETRIES, 3);
        if (current_volume < 0)
            REPLY_WITH_FAILURE (req, HTTPD_500_INTERNAL_SERVER_ERROR, "unable to read current volume");

        // Calculate new volume, clamped to 0-255
        long new_volume = current_volume + delta;
        if (new_volume < 0)
            new_volume = 0;
        if (new_volume > 255)
            new_volume = 255;

        ESP_LOGI (TAG8, "volume: %ld + %ld = %ld", current_volume, delta, new_volume);

        // Set new volume
        if (!kxRadio.put_to_kx ("AG", 3, new_volume, SC_KX_COMMUNICATION_RETRIES))
            REPLY_WITH_FAILURE (req, HTTPD_500_INTERNAL_SERVER_ERROR, "unable to set volume");
    }

    REPLY_WITH_SUCCESS();
}
