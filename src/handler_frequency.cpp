#include "globals.h"
#include "kx_radio.h"
#include "timed_lock.h"
#include "webserver.h"

#include <esp_log.h>
#include <esp_timer.h>
static const char * TAG8 = "sc:hdl_freq";

// Frequency cache to reduce radio contention under heavy load
static long          cached_frequency      = 0;
static int64_t       cached_frequency_time = 0;
static const int64_t FREQUENCY_CACHE_US    = 200000;  // 200ms cache

/**
 * Handles a HTTP GET request to retrieve the current frequency from the radio.
 *
 * @param req Pointer to the HTTP request structure.
 * @return ESP_OK on successful frequency retrieval and transmission, appropriate error code otherwise.
 */
esp_err_t handler_frequency_get (httpd_req_t * req) {
    showActivity();

    ESP_LOGV (TAG8, "trace: %s()", __func__);

    long    frequency;
    int64_t now = esp_timer_get_time();

    // Check cache first to reduce radio mutex contention
    if (cached_frequency > 0 && (now - cached_frequency_time) < FREQUENCY_CACHE_US) {
        frequency = cached_frequency;
        ESP_LOGV (TAG8, "returning cached frequency: %ld", frequency);
    }
    else {
        // Cache miss or expired - query radio with timeout
        // Tier 1: Fast timeout for GET operations
        {
            TimedLock lock = kxRadio.timed_lock (RADIO_LOCK_TIMEOUT_FAST_MS, "frequency GET");
            if (lock.acquired()) {
                if (!kxRadio.get_frequency (frequency))
                    frequency = -1;

                if (frequency > 0) {
                    // Update cache
                    cached_frequency      = frequency;
                    cached_frequency_time = now;
                    ESP_LOGD (TAG8, "cached new frequency: %ld", frequency);
                }
            }
            else {
                // Mutex timeout - return stale cache if available
                if (cached_frequency > 0) {
                    frequency = cached_frequency;
                    ESP_LOGW (TAG8, "radio busy - returning stale cached frequency: %ld", frequency);
                }
                else {
                    ESP_LOGW (TAG8, "radio busy - no cached frequency available");
                    REPLY_WITH_FAILURE (req, HTTPD_500_INTERNAL_SERVER_ERROR, "radio busy");
                }
            }
        }  // TimedLock destructor runs here, after radio access is complete
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
    ESP_LOGI (TAG8, "frequency '%d'", freq);
    if (freq <= 0)
        REPLY_WITH_FAILURE (req, HTTPD_404_NOT_FOUND, "invalid frequency");

    // Tier 2: Moderate timeout for SET operations
    TIMED_LOCK_OR_FAIL (req, kxRadio.timed_lock (RADIO_LOCK_TIMEOUT_MODERATE_MS, "frequency SET")) {
        bool success = kxRadio.set_frequency (freq, SC_KX_COMMUNICATION_RETRIES);

        if (!success)
            REPLY_WITH_FAILURE (req, HTTPD_500_INTERNAL_SERVER_ERROR, "failed to set frequency");

        // Invalidate cache after setting new frequency
        cached_frequency      = freq;
        cached_frequency_time = esp_timer_get_time();
        ESP_LOGD (TAG8, "cache updated with new frequency: %d", freq);
    }

    REPLY_WITH_SUCCESS();
}
