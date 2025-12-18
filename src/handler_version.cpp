#include "build_info.h"
#include "globals.h"
#include "hardware_specific.h"
#include "webserver.h"

#include <cstdio>
#include <cstring>
#include <memory>

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

    const char * sep1 = ":";  // separator between HW_TYPE_STR and BUILD_DATE_TIME
    const char * sep2 = "-";  // separator between BUILD_DATE_TIME and SC_BUILD_TYPE

    const size_t max_len =
        std::strlen (HW_TYPE_STR) +
        std::strlen (sep1) +
        std::strlen (BUILD_DATE_TIME) +
        std::strlen (sep2) +
        std::strlen (SC_BUILD_TYPE) +
        1;  // NUL

    auto versionString = std::make_unique<char[]> (max_len);

    std::snprintf (versionString.get(), max_len, "%s%s%s%s%s", HW_TYPE_STR, sep1, BUILD_DATE_TIME, sep2, SC_BUILD_TYPE);

    REPLY_WITH_STRING (req, versionString.get(), "version info");
}
