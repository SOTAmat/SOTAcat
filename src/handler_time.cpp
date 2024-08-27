#include "globals.h"
#include "kx_radio.h"
#include "webserver.h"

#include <memory>

#include <esp_log.h>
static const char * TAG8 = "sc:hdl_time";

/**
 * Represents a time in hours, minutes, and seconds.
 */
struct time_hms {
    int hrs;
    int min;
    int sec;
};

/**
 * Converts two character digits into an integer.
 *
 * @param ten Character for the tens place.
 * @param one Character for the ones place.
 * @return Combined integer value.
 */
inline int decode_couplet (char ten, char one) {
    // note high bit 0x80 may be set on tens digit of each couplet, to represent the decimal point
    return 10 * ((ten & 0x7f) - '0') + one - '0';
}

/**
 * Retrieves and decodes the time from a radio device into a time_hms structure.
 *
 * @param radio_time Pointer to store the decoded time.
 * @return true if successful, false otherwise.
 */
static bool get_radio_time (time_hms * radio_time) {
    ESP_LOGV (TAG8, "trace: %s()", __func__);
    char buf[sizeof ("DS@@123456af;")];                                                          // sizeof arg looks like expected response
    if (!kxRadio.get_from_kx_string ("DS", SC_KX_COMMUNICATION_RETRIES, buf, sizeof (buf) - 1))  // read time from VFO A)
        return false;
    buf[sizeof (buf) - 1] = '\0';
    ESP_LOGV (TAG8, "time as read on display is %s", buf);

    // expect buf to look like
    //          DS@@1²3´5¶af;
    // index    0123456789012
    // note high bit 0x80 may be set on tens digit of each couplet, to represent the decimal point
    radio_time->hrs = decode_couplet (buf[4], buf[5]);
    radio_time->min = decode_couplet (buf[6], buf[7]);
    radio_time->sec = decode_couplet (buf[8], buf[9]);
    ESP_LOGV (TAG8, "radio time is %02d:%02d:%02d", radio_time->hrs, radio_time->min, radio_time->sec);
    return true;
}

/**
 * Converts a long integer timestamp into a time_hms structure.
 *
 * @param long_time Timestamp to convert.
 * @param client_time Pointer to store the converted time.
 * @return true on success, false on failure.
 */
static bool convert_client_time (long int long_time, time_hms * client_time) {
    ESP_LOGV (TAG8, "trace: %s()", __func__);
    // Convert long int to time_t
    time_t my_time = static_cast<time_t> (long_time);

    // Convert to UTC time structure
    struct tm * utc_time = gmtime (&my_time);

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
 * Adjusts a single time component (H/M/S) on a radio device
 * based on the provided direction and magnitude.
 *
 * @param selector Component to adjust (e.g., "SWT19;" for hours).
 * @param diff Amount to adjust, positive for up, negative for down.
 */
static void adjust_component (char const * selector, int diff) {
    ESP_LOGV (TAG8, "trace: %s('%s', %d)", __func__, selector, diff);

    if (!diff)
        return;

    size_t abs_diff = std::abs (diff);
    assert (abs_diff <= 60);
    const size_t adjustment_size             = (sizeof ("SWTnn;") - 1) + abs_diff * (sizeof ("UP;") - 1) + 1;
    char         adjustment[adjustment_size] = {0};
    strcat (adjustment, selector);
    for (int ii = diff; ii > 0; --ii)
        strcat (adjustment, "UP;");
    for (int ii = diff; ii < 0; ++ii)
        strcat (adjustment, "DN;");
    ESP_LOGV (TAG8, "adjustment should be %s", adjustment);
    kxRadio.put_to_kx_command_string (adjustment, 1);

    // empirically determined delay to allow radio to complete the action
    vTaskDelay (pdMS_TO_TICKS (30 * abs_diff));
}

/**
 * Sets the time on the radio using the provided parameter value.
 *
 * @param param_value New time value as a string.
 * @return true on successful update, false on failure.
 */
static bool set_time (char const * param_value) {
    ESP_LOGV (TAG8, "trace: %s()", __func__);

    long     time_value = atoi (param_value);  // Convert the parameter to an integer
    time_hms client_time;
    if (!convert_client_time (time_value, &client_time))
        return false;

    const std::lock_guard<Lockable> lock (kxRadio);
    time_hms                        radio_time;
    kxRadio.put_to_kx ("MN", 3, 73, SC_KX_COMMUNICATION_RETRIES);  // enter time menu
    if (!get_radio_time (&radio_time))                             // read the screen; VFO A shows the time
        return false;

    // set synced time in this order (sec, min, hrs) to be most sensitive to current time
    if (radio_time.sec != client_time.sec)
        adjust_component ("SWT20;", client_time.sec - radio_time.sec);
    if (radio_time.min != client_time.min)
        adjust_component ("SWT27;", client_time.min - radio_time.min);
    if (radio_time.hrs != client_time.hrs)
        adjust_component ("SWT19;", client_time.hrs - radio_time.hrs);
    kxRadio.put_to_kx ("MN", 3, 255, SC_KX_COMMUNICATION_RETRIES);  // exit time menu
    return true;
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

    if (!set_time (param_value))
        REPLY_WITH_FAILURE (req, HTTPD_500_INTERNAL_SERVER_ERROR, "failed to set time");

    REPLY_WITH_SUCCESS();
}
