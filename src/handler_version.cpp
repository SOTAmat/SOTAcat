#include "build_info.h"
#include "globals.h"
#include "webserver.h"

#include <esp_log.h>

static const char * TAG8 = "sc:hdl_vers";

/**
 * Handles an HTTP GET request to retrieve the build version information of the software running on the radio.
 * The version is constructed from predefined macros representing the build date/time, and type (Debug/Release).
 *
 * @param req Pointer to the HTTP request structure.
 * @return ESP_OK on successful transmission of version information.
 */
esp_err_t handler_version_get (httpd_req_t * req) {
    showActivity();

    ESP_LOGV (TAG8, "trace: %s()", __func__);

    const size_t MAX_VS_LEN = sizeof (BUILD_DATE_TIME) + sizeof ('-') + sizeof (SC_BUILD_TYPE) + 1;
    char         versionString[MAX_VS_LEN];

    snprintf (versionString, MAX_VS_LEN, "%s-%s", BUILD_DATE_TIME, SC_BUILD_TYPE);

    ESP_LOGI (TAG8, "returning version info: %s", versionString);
    httpd_resp_send (req, versionString, HTTPD_RESP_USE_STRLEN);
    return ESP_OK;
}
