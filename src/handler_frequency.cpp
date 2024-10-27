#include "globals.h"
#include "kx_radio.h"
#include "webserver.h"

#include <memory>

#include <esp_log.h>
static const char * TAG8 = "sc:hdl_freq";

/**
 * Handles a HTTP GET request to retrieve the current frequency from the radio.
 *
 * @param req Pointer to the HTTP request structure.
 * @return ESP_OK on successful frequency retrieval and transmission, appropriate error code otherwise.
 */
esp_err_t handler_frequency_get (httpd_req_t * req) {
    showActivity();

    ESP_LOGV (TAG8, "trace: %s()", __func__);

    long frequency;
    {
        const std::lock_guard<Lockable> lock (kxRadio);
        frequency = kxRadio.get_from_kx ("FA", SC_KX_COMMUNICATION_RETRIES, 11);
    }

    if (frequency <= 0)
        REPLY_WITH_FAILURE (req, HTTPD_500_INTERNAL_SERVER_ERROR, "invalid frequency from radio");

    // Frequency is valid, send response back to phone
    char buf[16];
    snprintf (buf, sizeof (buf), "%ld", frequency);

    REPLY_WITH_STRING (req, buf, "frequency");
}

/**
 * Handles a HTTP PUT request to set a new frequency on the radio.
 * The desired frequency is specified in the URL query string.
 *
 * @param req Pointer to the HTTP request structure.
 * @return ESP_OK on successful frequency update, appropriate error code otherwise.
 */
esp_err_t handler_frequency_put (httpd_req_t * req) {
    showActivity();

    ESP_LOGV (TAG8, "trace: %s()", __func__);

    STANDARD_DECODE_SOLE_PARAMETER (req, "frequency", param_value)
    int freq = atoi (param_value);  // Convert the parameter to an integer
    ESP_LOGI (TAG8, "freqency %d", freq);
    if (freq <= 0)
        REPLY_WITH_FAILURE (req, HTTPD_404_NOT_FOUND, "invalid frequency");

    {
        const std::lock_guard<Lockable> lock (kxRadio);
        if (!kxRadio.put_to_kx ("FA", 11, freq, SC_KX_COMMUNICATION_RETRIES))
            REPLY_WITH_FAILURE (req, HTTPD_500_INTERNAL_SERVER_ERROR, "failed to set frequency");
    }

    REPLY_WITH_SUCCESS();
}
