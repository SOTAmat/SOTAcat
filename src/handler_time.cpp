#include <esp_http_server.h>
#include <memory>
#include "globals.h"
#include "kx_radio.h"

#include <esp_log.h>
static const char * TAG8 = "sc:hdl_time";

struct time_hms {
    int hrs;
    int min;
    int sec;
};

inline int decode_couplet(char ten, char one) {
    return 10 * ((ten & 0x7f) - '0') + one - '0';
}

static bool get_radio_time(time_hms * radio_time) {
    ESP_LOGV(TAG8, "trace: %s()", __func__);
    char buf[sizeof("DS@@123456af;")];  // sizeof arg looks like expected response
    if (!kxRadio.get_from_kx_string("DS", 2, buf, sizeof(buf)-1))  // read time from VFO A)
        return false;
    buf[sizeof(buf)-1] = '\0';
    ESP_LOGV(TAG8, "time as read on display is %s", buf);

    // expect buf to look like
    //          DS@@1²3´5¶af;
    // index    0123456789012
    // note high bit 0x80 is set on ones digit of each couplet, to represent the decimal point
    radio_time->hrs = decode_couplet(buf[4], buf[5]);
    radio_time->min = decode_couplet(buf[6], buf[7]);
    radio_time->sec = decode_couplet(buf[8], buf[9]);
    ESP_LOGV(TAG8, "radio time is %02d:%02d:%02d", radio_time->hrs, radio_time->min, radio_time->sec);
    return true;
}

static bool convert_client_time(long int long_time, time_hms * client_time) {
    ESP_LOGV(TAG8, "trace: %s()", __func__);
    // Convert long int to time_t
    time_t my_time = static_cast<time_t>(long_time);

    // Convert to UTC time structure
    struct tm *utc_time = gmtime(&my_time);

    if (utc_time) {
        // Extract hours, minutes, and seconds
        client_time->hrs = utc_time->tm_hour;
        client_time->min = utc_time->tm_min;
        client_time->sec = utc_time->tm_sec;
        return true;
    }

    ESP_LOGE(TAG8, "error converting time %ld", long_time);
    return false;
}

static void adjust_component(char const * selector, int diff) {
    ESP_LOGV(TAG8, "trace: %s('%s', %d)", __func__, selector, diff);

    char dir[6 + 3 * 60] = {};  // size: "SWTnn;" = 6, + "UP;"|"DN;" = 3, * at most once per sec or min or hour = 60
    strcpy(dir, selector);
    for (int ii = diff; ii > 0; --ii)
        strcat(dir, "UP;");
    for (int ii = diff; ii < 0; ++ii)
        strcat(dir, "DN;");
    ESP_LOGI(TAG8, "adjustment should be %s", dir);
    kxRadio.put_to_kx_command_string(dir, 1);
}

static bool set_time (char const * param_value) {
    ESP_LOGV(TAG8, "trace: %s()", __func__);

    long     time_value = atoi (param_value);  // Convert the parameter to an integer
    time_hms client_time;
    if (!convert_client_time (time_value, &client_time))
        return false;

    const std::lock_guard<Lockable> lock(kxRadio);
    time_hms radio_time;
    kxRadio.put_to_kx("MN", 3, 73, 2); // enter time menu
    if (!get_radio_time (&radio_time)) // read the screen; VFO A shows the time
        return false;

    // set synced time in this order (sec, min, hrs) to be most sensitive to current time
    if (radio_time.sec != client_time.sec)
        adjust_component ("SWT20;", client_time.sec - radio_time.sec);
    if (radio_time.min != client_time.min)
        adjust_component ("SWT27;", client_time.min - radio_time.min);
    if (radio_time.hrs != client_time.hrs)
        adjust_component ("SWT19;", client_time.hrs - radio_time.hrs);
    kxRadio.put_to_kx ("MN", 3, 255, 2);  // exit time menu
    return true;
}

esp_err_t handler_time_put(httpd_req_t *req)
{
    showActivity();

    ESP_LOGV(TAG8, "trace: %s()", __func__);

    // Get the length of the URL query
    size_t buf_len = httpd_req_get_url_query_len(req) + 1;
    if (buf_len <= 1)
    {
        httpd_resp_send_404(req); // No query string
        return ESP_FAIL;
    }

    std::unique_ptr<char[]> buf(new char[buf_len]);
    if (!buf)
    {
        httpd_resp_send_500(req);
        return ESP_FAIL;
    }

    // Get the URL query
    if (httpd_req_get_url_query_str(req, buf.get(), buf_len) != ESP_OK)
    {
        httpd_resp_send_404(req); // No query string
        return ESP_FAIL;
    }

    char param_value[32];
    if (httpd_query_key_value(buf.get(), "time", param_value, sizeof(param_value)) != ESP_OK)
    {
        httpd_resp_send_404(req); // Query parsing error
        return ESP_FAIL;
    }

    if (!set_time(param_value))
    {
        httpd_resp_send_500(req);
        return ESP_FAIL;
    }

    httpd_resp_send(req, "OK", HTTPD_RESP_USE_STRLEN);
    return ESP_OK;
}
