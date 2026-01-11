#include "globals.h"
#include "kx_radio.h"
#include "radio_driver.h"
#include "timed_lock.h"
#include "webserver.h"

#include <cassert>
#include <cstdlib>
#include <cstring>
#include <ctime>
#include <memory>

#include <esp_log.h>
static const char * TAG8 = "sc:hdl_time";

/**
 * Converts a long integer timestamp into a time_hms structure.
 *
 * @param long_time Timestamp to convert.
 * @param client_time Pointer to store the converted time.
 * @return true on success, false on failure.
 */
static bool convert_client_time (long int long_time, RadioTimeHms * client_time) {
    ESP_LOGV (TAG8, "trace: %s()", __func__);
    // Convert long int to time_t
    time_t my_time = static_cast<time_t> (long_time);

    // Convert to UTC time structure
    struct tm * utc_time = std::gmtime (&my_time);

    if (utc_time) {
        // Extract hours, minutes, and seconds
        client_time->hrs = utc_time->tm_hour;
        client_time->min = utc_time->tm_min;
        client_time->sec = utc_time->tm_sec;
        return true;
    }

    ESP_LOGE (TAG8, "error converting time %ld", long_time);
    return false;
}

/**
 * Handles an HTTP PUT request to update the time setting on the radio.
 *
 * @param req Pointer to the HTTP request structure.  The "time" query parameter
 *            is expected to hold the seconds since UTC epoch.
 */
esp_err_t handler_time_put (httpd_req_t * req) {
    showActivity();

    ESP_LOGV (TAG8, "trace: %s()", __func__);

    STANDARD_DECODE_SOLE_PARAMETER (req, "time", param_value);

    long     time_value = atoi (param_value);  // Convert the parameter to an integer
    RadioTimeHms client_time;
    if (!convert_client_time (time_value, &client_time))
        REPLY_WITH_FAILURE (req, HTTPD_400_BAD_REQUEST, "invalid time value");

    // Tier 3: Critical timeout for time setting
    TIMED_LOCK_OR_FAIL (req, kxRadio.timed_lock (RADIO_LOCK_TIMEOUT_CRITICAL_MS, "time SET")) {
        if (!kxRadio.sync_time (client_time))
            REPLY_WITH_FAILURE (req, HTTPD_500_INTERNAL_SERVER_ERROR, "failed to sync radio time");
    }

    REPLY_WITH_SUCCESS();
}
