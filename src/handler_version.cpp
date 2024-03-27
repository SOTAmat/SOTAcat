#include <esp_http_server.h>
#include "globals.h"
#include "build_info.h"

#include <esp_log.h>

static const char *TAG8 = "sc:hdl_version";

esp_err_t handler_version_get(httpd_req_t *req)
{
    showActivity();

    ESP_LOGV(TAG8, "trace: %s()", __func__);

// 64 for BUILD_DATE_TIME, 1 for '-', 16 for SC_BUILD_TYPE, 1 for '\0'
#define MAX_VS_LEN (64 + 1 + 16 + 1)

    char versionString[MAX_VS_LEN];

    snprintf(versionString, MAX_VS_LEN, "%s-%s", BUILD_DATE_TIME, SC_BUILD_TYPE);

    httpd_resp_send(req, versionString, HTTPD_RESP_USE_STRLEN);

    ESP_LOGI(TAG8, "returning version info: %s", versionString);
    return ESP_OK;
}
