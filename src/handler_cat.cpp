#include "globals.h"
#include "kx_radio.h"
#include "radio_park_httpd.h"
#include "radio_service.h"
#include "radio_set_http.h"
#include "radio_snapshot.h"
#include "timed_lock.h"
#include "webserver.h"

#include <esp_timer.h>

#include <cstdlib>
#include <cstring>
#include <freertos/FreeRTOS.h>
#include <freertos/task.h>

#include <esp_log.h>
static const char * TAG8 = "sc:hdl_cat.";

/**
 * Handles an HTTP PUT request to enable/disable transmit
 *
 * @param req Pointer to the HTTP request structure.  The "state" query parameter
 *            is expected to hold either "0" (turn off transmission), or any other
 *            integer (turn on transmission)
 */
esp_err_t handler_xmit_put (httpd_req_t * req) {
    showActivity();

    ESP_LOGV (TAG8, "trace: %s()", __func__);

    STANDARD_DECODE_SOLE_PARAMETER (req, "state", param_value);
    ESP_LOGI (TAG8, "setting xmit to '%s'", param_value);

    long xmit = 0;
    if (!parse_long_param (param_value, xmit))
        REPLY_WITH_FAILURE (req, HTTPD_404_NOT_FOUND, "invalid state");

    return radio_set_via_http (req, RadioCmdType::SET_XMIT, xmit != 0 ? 1 : 0, "TX/RX toggle");
}

/**
 * Handles an HTTP PUT request to play a pre-recorded message from bank 1 or 2
 *
 * @param req Pointer to the HTTP request structure.  The "bank" query parameter
 *            is expected to hold either "1" or "2".
 */
esp_err_t handler_msg_put (httpd_req_t * req) {
    showActivity();

    ESP_LOGV (TAG8, "trace: %s()", __func__);

    STANDARD_DECODE_SOLE_PARAMETER (req, "bank", param_value);
    ESP_LOGI (TAG8, "playing message bank '%s'", param_value);

    long bank = 0;
    if (!parse_long_param (param_value, bank) || bank <= 0)
        REPLY_WITH_FAILURE (req, HTTPD_404_NOT_FOUND, "invalid bank");

    return radio_set_via_http (req, RadioCmdType::SET_MSG, bank, "message play");
}

/**
 * Handles an HTTP GET request to retrieve the current power level.
 *
 * This function processes the HTTP GET request and retrieves the current power level
 * from the radio. The power level is then sent back as the HTTP response.
 *
 * @param req Pointer to the HTTP request structure.
 */
static void send_power (httpd_req_t * req, const RadioSnapshotData & snap) {
    if (!snap.has_power()) {
        // Never read successfully: unsupported on this radio, or not yet probed.
        ESP_LOGE (TAG8, "power read not supported");
        http_send_error_json (req, HTTPD_404_NOT_FOUND, "power read not supported");
        return;
    }
    char buf[16];
    snprintf (buf, sizeof (buf), "%ld", snap.power);
    ESP_LOGI (TAG8, "returning power: %s", buf);
    http_send_string (req, buf);
}

static void power_get_complete (httpd_req_t * req, RadioParkOutcome, bool) {
    send_power (req, radio_snapshot::get());
}

esp_err_t handler_power_get (httpd_req_t * req) {
    showActivity();
    ESP_LOGV (TAG8, "trace: %s()", __func__);

    RadioSnapshotData snap = radio_snapshot::get();
    int64_t           now  = esp_timer_get_time();
    if (snap.power_fresh (now)) {
        send_power (req, snap);
        return ESP_OK;
    }
    // Same shape as handler_frequency_get: arm a refresh; park if the link
    // is up; otherwise answer from the snapshot.
    if (!Ft8RadioExclusive) {
        radio_service_request_refresh (RadioCmdType::REFRESH_POWER);
        if (!radio_service_link_up())
            REPLY_WITH_SERVICE_UNAVAILABLE (req, "radio link down");  // see handler_frequency_get
        if (radio_park_request (req, RadioParkKind::GET_POWER, 0, RADIO_PARK_GET_WAIT_MS, power_get_complete))
            return ESP_OK;
    }
    send_power (req, snap);
    return snap.has_power() ? ESP_OK : ESP_FAIL;
}

/**
 * Handles an HTTP PUT request to set the power level.
 *
 * This function processes the HTTP PUT request by decoding the "power" query parameter,
 * which specifies the new power level to set. It sends a command to the radio to update
 * the power level accordingly.
 *
 * @param req Pointer to the HTTP request structure. The "power" query parameter
 *            is expected to hold a string representing the new power level.
 */
esp_err_t handler_power_put (httpd_req_t * req) {
    showActivity();

    ESP_LOGV (TAG8, "trace: %s()", __func__);

    STANDARD_DECODE_SOLE_PARAMETER (req, "power", param_value);
    ESP_LOGI (TAG8, "setting power to '%s'", param_value);

    long desired_power = 0;
    if (!parse_long_param (param_value, desired_power) || desired_power < 0)
        REPLY_WITH_FAILURE (req, HTTPD_404_NOT_FOUND, "invalid power");

    return radio_set_via_http (req, RadioCmdType::SET_POWER, desired_power, "power change");
}

/**
 * Background task that actually transmits a CW keyer message. Spawned from the
 * httpd server task so the single httpd worker stays free to service status,
 * frequency, and mode polls during the prolonged on-air transmission.
 *
 * Ownership:
 * pvParameter is a heap-allocated, null-terminated message string
 * transferred from handler_keyer_put(); this task frees it.
 * The caller is also responsible for having claimed the keyer via
 * kxRadio.try_begin_keyer_operation(); this task releases the claim via
 * kxRadio.end_keyer_operation().
 */
static void keyer_task (void * pvParameter) {
    char * message = (char *)pvParameter;

    {
        // Tier 3: critical timeout - keying can take up to ~15s for long messages.
        TimedLock lock = kxRadio.timed_lock (RADIO_LOCK_TIMEOUT_CRITICAL_MS, "keyer task");
        if (lock.acquired()) {
            if (!kxRadio.send_keyer_message (message))
                ESP_LOGE (TAG8, "keyer send failed for message '%s'", message);
        }
        else {
            ESP_LOGE (TAG8, "keyer task could not acquire radio lock for '%s'", message);
        }
    }

    kxRadio.end_keyer_operation();
    free (message);
    vTaskDelete (NULL);
}

/**
 * Handles an HTTP PUT request to send a Morse code message.
 *
 * The actual keying is dispatched to a background FreeRTOS task so that this
 * handler (and therefore the single httpd server task) returns immediately
 * and remains available to service status, frequency, and mode polls while
 * the transmission is on the air. handler_connectionStatus_get consults
 * kxRadio.is_keyer_active() to report 🔴 during this window without waiting
 * on the radio mutex.
 *
 * @param req Pointer to the HTTP request structure. The "message" query parameter
 *            is expected to hold the text to be transmitted in Morse code.
 */
esp_err_t handler_keyer_put (httpd_req_t * req) {
    showActivity();

    ESP_LOGV (TAG8, "trace: %s()", __func__);

    if (!kxRadio.supports_keyer())
        REPLY_WITH_FAILURE (req, HTTPD_404_NOT_FOUND, "Morse keying not supported on this radio");

    STANDARD_DECODE_SOLE_PARAMETER (req, "message", param_value);

    url_decode_in_place (param_value);
    ESP_LOGI (TAG8, "keying message '%s'", param_value);

    if (!kxRadio.try_begin_keyer_operation())
        REPLY_WITH_FAILURE (req, HTTPD_500_INTERNAL_SERVER_ERROR, "keyer busy, please retry");

    char * message_copy = strdup (param_value);
    if (!message_copy) {
        kxRadio.end_keyer_operation();
        REPLY_WITH_FAILURE (req, HTTPD_500_INTERNAL_SERVER_ERROR, "heap allocation failed");
    }

    if (xTaskCreate (&keyer_task, "keyer_task", 4096, message_copy, SC_TASK_PRIORITY_NORMAL, NULL) != pdPASS) {
        free (message_copy);
        kxRadio.end_keyer_operation();
        REPLY_WITH_FAILURE (req, HTTPD_500_INTERNAL_SERVER_ERROR, "failed to start keyer task");
    }

    REPLY_WITH_SUCCESS();
}
