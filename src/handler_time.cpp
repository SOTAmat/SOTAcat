#include "globals.h"
#include "radio_driver.h"
#include "radio_service.h"
#include "radio_http.h"
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

    long time_value = 0;
    if (!parse_long_param (param_value, time_value) || time_value < 0)
        REPLY_WITH_FAILURE (req, HTTPD_400_BAD_REQUEST, "invalid time value");
    RadioTimeHms client_time;
    if (!convert_client_time (time_value, &client_time))
        REPLY_WITH_FAILURE (req, HTTPD_400_BAD_REQUEST, "invalid time value");

    // Slot args are a single long: pack as UTC seconds since midnight; the
    // worker unpacks to h/m/s and calls sync_time.
    long secs = client_time.hrs * 3600L + client_time.min * 60L + client_time.sec;
    return radio_set_via_http (req, RadioCmdType::SET_TIME, secs, "time sync");
}
