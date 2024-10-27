#include "build_info.h"
#include "globals.h"
#include "hardware_specific.h"
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

    const size_t MAX_VS_LEN = strlen (HW_TYPE_STR) + sizeof (":") + sizeof (BUILD_DATE_TIME) + sizeof ('-') + sizeof (SC_BUILD_TYPE) + 1;
    char         versionString[MAX_VS_LEN];
    snprintf (versionString, MAX_VS_LEN, "%s:%s-%s", HW_TYPE_STR, BUILD_DATE_TIME, SC_BUILD_TYPE);

    REPLY_WITH_STRING (req, versionString, "version info");
}
