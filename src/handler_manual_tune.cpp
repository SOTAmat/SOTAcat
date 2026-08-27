#include "globals.h"
#include "radio_service.h"
#include "radio_set_http.h"
#include "webserver.h"

#include <esp_log.h>
static const char * TAG8 = "sc:hdl_mtune";

esp_err_t handler_manualTune_put (httpd_req_t * req) {
    showActivity();
    ESP_LOGV (TAG8, "trace: %s()", __func__);

    char query[32];
    char state[8];
    if (httpd_req_get_url_query_str (req, query, sizeof (query)) != ESP_OK ||
        httpd_query_key_value (query, "state", state, sizeof (state)) != ESP_OK ||
        (state[0] != '0' && state[0] != '1') || state[1] != '\0') {
        http_send_error_json (req, HTTPD_404_NOT_FOUND, "invalid manual tune state");
        return ESP_FAIL;
    }

    return radio_set_via_http (req, RadioCmdType::SET_MANUAL_TUNE, state[0] == '1' ? 1 : 0, "manual tune");
}
