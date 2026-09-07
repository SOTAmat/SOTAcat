#include "globals.h"
#include "kx_radio.h"
#include "json_scan.h"
#include "settings.h"
#include "webserver.h"

#include <esp_err.h>
#include <esp_mac.h>
#include <nvs_flash.h>

#include <cstring>
#include <memory>

#include <esp_log.h>
static const char * TAG8 = "sc:hdl_setg";

/**
 * Definitions for Wi-Fi SSID and password keys and their corresponding global storage variables.
 *
 * - SSID and password keys for STA1 and STA2 (station mode) and AP (access point mode) are defined as constants.
 *   Note: NVS_KEY_NAME_MAX_SIZE is 16 -- size of partition or key names, so the key lengths must abide.
 * - Corresponding global variables (`g_*`) hold the runtime values for these Wi-Fi credentials, with separate
 *   variables for the SSIDs and passwords of STA1, STA2, and the AP, adhering to maximum size constraints.
 */
static const char s_sta1_ssid_key[] = "sta1_ssid";
char              g_sta1_ssid[MAX_WIFI_SSID_SIZE];
static const char s_sta1_pass_key[] = "sta1_pass";
char              g_sta1_pass[MAX_WIFI_PASS_SIZE];
static const char s_sta2_ssid_key[] = "sta2_ssid";
char              g_sta2_ssid[MAX_WIFI_SSID_SIZE];
static const char s_sta2_pass_key[] = "sta2_pass";
char              g_sta2_pass[MAX_WIFI_PASS_SIZE];
static const char s_sta3_ssid_key[] = "sta3_ssid";
char              g_sta3_ssid[MAX_WIFI_SSID_SIZE];
static const char s_sta3_pass_key[] = "sta3_pass";
char              g_sta3_pass[MAX_WIFI_PASS_SIZE];
static const char s_sta1_ip_pin_key[] = "sta1_ip_pin";
bool              g_sta1_ip_pin       = false;
static const char s_sta2_ip_pin_key[] = "sta2_ip_pin";
bool              g_sta2_ip_pin       = false;
static const char s_sta3_ip_pin_key[] = "sta3_ip_pin";
bool              g_sta3_ip_pin       = false;
static const char s_ap_ssid_key[]     = "ap_ssid";
char              g_ap_ssid[MAX_WIFI_SSID_SIZE];
static const char s_ap_pass_key[] = "ap_pass";
char              g_ap_pass[MAX_WIFI_PASS_SIZE];
static const char s_gps_lat_key[] = "gps_lat";
char              g_gps_lat[MAX_GPS_LAT_SIZE];
static const char s_gps_lon_key[] = "gps_lon";
char              g_gps_lon[MAX_GPS_LON_SIZE];
static const char s_callsign_key[] = "callsign";
char              g_callsign[MAX_CALLSIGN_SIZE];
static const char s_license_class_key[] = "license";
char              g_license_class[MAX_LICENSE_CLASS_SIZE];

// Tune targets - URLs to open when tuning (e.g., WebSDR, KiwiSDR)
static const char s_tune_targets_key[] = "tune_targets";
char              g_tune_targets[MAX_TUNE_TARGETS_JSON];
static const char s_tune_targets_mobile_key[] = "tune_mobile";
bool              g_tune_targets_mobile       = false;

// CW Macros - configurable keyer buttons with placeholder support
static const char s_cw_macros_key[] = "cw_macros";
char              g_cw_macros[MAX_CW_MACROS_JSON];

/**
 * Handle to our Non-Volatile Storage while we're in communication with it.
 */
static nvs_handle_t s_nvs_settings_handle;

/**
 * Initialize the NVS (Non-Volatile Storage) for the application.
 *
 * If an error indicating no free pages or a new version of NVS format is found,
 * it erases the NVS storage and tries initializing again.
 * These conditions should be quite rare.
 *
 * Once NVS is initialized successfully, it opens the NVS storage in read-write mode
 * with a namespace "storage" and stores the handle in s_nvs_settings_handle for
 * use throughout this module.
 */
static esp_err_t initialize_nvs () {
    ESP_LOGV (TAG8, "trace: %s()", __func__);

    // Initialize NVS
    esp_err_t ret = nvs_flash_init();
    if (ret == ESP_ERR_NVS_NO_FREE_PAGES || ret == ESP_ERR_NVS_NEW_VERSION_FOUND) {
        ESP_ERROR_CHECK (nvs_flash_erase());
        ret = nvs_flash_init();
    }
    if (ret == ESP_OK)
        ret = nvs_open ("storage", NVS_READWRITE, &s_nvs_settings_handle);

    return ret;
}

/**
 * Apply either the retrieved value from NVS, or if none, the supplied default value.
 */
static void get_nv_string (const char * key, char * value, const char * default_value, size_t size) {
    if (nvs_get_str (s_nvs_settings_handle, key, value, &size) != ESP_OK)
        snprintf (value, size, "%s", default_value);
}

/**
 * Populate application settings with values from NVS, or meaningful defaults.
 */
static void populate_settings () {
    // create a default AP SSID, amended with mac address
    char    default_ap_ssid[] = "SOTAcat-1234";
    uint8_t base_mac_addr[6]  = {0};
    ESP_ERROR_CHECK (esp_read_mac (base_mac_addr, ESP_MAC_EFUSE_FACTORY));
    ESP_LOGI (TAG8, "base mac addr: %02X:%02X:%02X:%02X:%02X:%02X", base_mac_addr[0], base_mac_addr[1], base_mac_addr[2], base_mac_addr[3], base_mac_addr[4], base_mac_addr[5]);
    snprintf (&default_ap_ssid[8], 5, "%02X%02X", base_mac_addr[4], base_mac_addr[5]);

#define GET_NV_STRING(base, def) get_nv_string (s_##base##_key, g_##base, def, sizeof (g_##base) - 1)

    GET_NV_STRING (sta1_ssid, "ham-hotspot");
    GET_NV_STRING (sta1_pass, "sotapota");
    GET_NV_STRING (sta2_ssid, "");
    GET_NV_STRING (sta2_pass, "");
    GET_NV_STRING (sta3_ssid, "");
    GET_NV_STRING (sta3_pass, "");
    GET_NV_STRING (ap_ssid, default_ap_ssid);
    GET_NV_STRING (ap_pass, "12345678");
    GET_NV_STRING (gps_lat, "");
    GET_NV_STRING (gps_lon, "");
    GET_NV_STRING (callsign, "");
    GET_NV_STRING (license_class, "");
    GET_NV_STRING (tune_targets, "");
    GET_NV_STRING (cw_macros, "");

#define GET_NV_BOOL(base)                                                       \
    {                                                                           \
        uint8_t val = 0;                                                        \
        if (nvs_get_u8 (s_nvs_settings_handle, s_##base##_key, &val) == ESP_OK) \
            g_##base = (val != 0);                                              \
        else                                                                    \
            g_##base = false;                                                   \
    }

    GET_NV_BOOL (tune_targets_mobile);
    GET_NV_BOOL (sta1_ip_pin);
    GET_NV_BOOL (sta2_ip_pin);
    GET_NV_BOOL (sta3_ip_pin);
}

/**
 * Initialize application settings by setting up NVS and populating settings with defaults or stored values.
 */
void init_settings () {
    ESP_LOGV (TAG8, "trace: %s()", __func__);

    // Initialize NVS
    ESP_ERROR_CHECK (initialize_nvs());
    populate_settings();
}

/**
 * Construct and return a JSON string containing the current settings for Wi-Fi SSIDs and passwords.
 * The JSON structure includes pairs of keys and values for
 *   station 1 SSID and password,
 *   station 2 SSID and password, and
 *   access point SSID and password.
 *
 * The function dynamically allocates memory for the JSON string.
 * Usage of std::shared_ptr for the character array ensures automatic memory
 * management, preventing memory leaks by deallocating the memory when the
 * shared_ptr is destroyed or goes out of scope.
 *
 * Example of the JSON output:
 *   {"sta1_ssid":"foo","sta1_pass":"barbarbar","sta2_ssid":"baz","sta2_pass":"quuxquux","ap_ssid":"SOTAcat-A480","ap_pass":"12345678"}
 *
 * @return std::shared_ptr<char[]> A shared pointer to a character array containing the JSON string of settings.
 */
/**
 * Copy src into dst as the body of a JSON string, escaping backslash and
 * double-quote. Values are stored raw in NVS (a WiFi password may contain
 * either character); escaping belongs to the JSON boundary. dst must hold
 * up to 2*strlen(src)+1 bytes.
 */
static void json_escape_into (char * dst, size_t dst_size, const char * src) {
    size_t o = 0;
    for (const char * p = src; *p && o + 2 < dst_size; ++p) {
        if (*p == '"' || *p == '\\')
            dst[o++] = '\\';
        dst[o++] = *p;
    }
    dst[o] = '\0';
}

// One key/value JSON field; value is a NUL-terminated global string.
struct KvField {
    const char * key;
    const char * value;
};

/**
 * Build {"key":"value",...} from fields, JSON-escaping each value.
 * raw_tail, when given, is pre-formed JSON appended as the final members
 * (used for the boolean fields of the main settings object).
 */
static std::shared_ptr<char[]> build_kv_json (const KvField fields[], size_t field_count, const char * raw_tail = nullptr) {
    size_t required_size = 2 + 1;  // braces + NUL
    for (size_t i = 0; i < field_count; ++i)
        required_size += strlen (fields[i].key) + 2 * strlen (fields[i].value) + 6;  // quotes, colon, comma
    if (raw_tail)
        required_size += strlen (raw_tail) + 1;

    std::shared_ptr<char[]> buf (new char[required_size]);
    char *                  out = buf.get();
    size_t                  o   = 0;
    out[o++]                    = '{';
    for (size_t i = 0; i < field_count; ++i) {
        if (i)
            out[o++] = ',';
        o += snprintf (out + o, required_size - o, "\"%s\":\"", fields[i].key);
        json_escape_into (out + o, required_size - o, fields[i].value);
        o += strlen (out + o);
        out[o++] = '"';
    }
    if (raw_tail) {
        if (field_count)
            out[o++] = ',';
        o += snprintf (out + o, required_size - o, "%s", raw_tail);
    }
    out[o++] = '}';
    out[o]   = '\0';
    return buf;
}

static std::shared_ptr<char[]> get_settings_json () {
    ESP_LOGV (TAG8, "trace: %s()", __func__);

    const KvField string_fields[] = {
        {s_sta1_ssid_key, g_sta1_ssid},
        {s_sta1_pass_key, g_sta1_pass},
        {s_sta2_ssid_key, g_sta2_ssid},
        {s_sta2_pass_key, g_sta2_pass},
        {s_sta3_ssid_key, g_sta3_ssid},
        {s_sta3_pass_key, g_sta3_pass},
        {s_ap_ssid_key, g_ap_ssid},
        {s_ap_pass_key, g_ap_pass},
    };

    char bools[128];
    snprintf (bools, sizeof (bools), "\"%s\":%s,\"%s\":%s,\"%s\":%s",
              s_sta1_ip_pin_key, g_sta1_ip_pin ? "true" : "false",
              s_sta2_ip_pin_key, g_sta2_ip_pin ? "true" : "false",
              s_sta3_ip_pin_key, g_sta3_ip_pin ? "true" : "false");

    return build_kv_json (string_fields, sizeof (string_fields) / sizeof (string_fields[0]), bools);
}

/**
 * Helper function to store string key-value pairs in NVS.
 * Simply a convenient aliasing to keep the caller clean.
 */
static esp_err_t process (const char * key, const char * value) {
    // Log the key-value pair to the console.
    ESP_LOGI (TAG8, "Storing into NVS the key: %s, with value: %s", key, value);
    return nvs_set_str (s_nvs_settings_handle, key, value);
}

/**
 * Helper function to store boolean key-value pairs in NVS.
 * Booleans are stored as u8 (0 = false, 1 = true).
 */
static esp_err_t process (const char * key, bool value) {
    ESP_LOGI (TAG8, "Storing into NVS the key: %s, with bool value: %s", key, value ? "true" : "false");
    return nvs_set_u8 (s_nvs_settings_handle, key, value ? 1 : 0);
}

/**
 * True when key is one of the allowed[] names. Every settings endpoint owns
 * an explicit key set; anything outside it is logged and dropped, so one
 * endpoint's POST can never write another endpoint's keys (or arbitrary
 * NVS entries).
 */
static bool key_allowed (const char * key, const char * const allowed[], size_t allowed_count) {
    for (size_t i = 0; i < allowed_count; ++i)
        if (strcmp (key, allowed[i]) == 0)
            return true;
    ESP_LOGW (TAG8, "ignoring unknown settings key: %s", key);
    return false;
}

/**
 * Parse the JSON string in content and store each allowed key-value pair.
 * Incoming string will look like:
 *   {"sta1_ssid":"foo","sta1_pass":"barbarbar","sta2_ssid":"baz","sta2_pass":"quuxquux","ap_ssid":"SOTAcat-A480","ap_pass":"12345678"}
 * Also handles boolean values (unquoted true/false):
 *   {"sta1_ip_pin":true,"sta2_ip_pin":false}
 * Keys outside allowed[] are dropped (see key_allowed).
 * NOTE: incoming json variable's content is modified during this operation
 */
static void parse_and_process_json (char * json, const char * const allowed[], size_t allowed_count) {
    char * keyStart  = nullptr;
    char * valStart  = nullptr;
    bool   isKey     = true;   // Start by assuming the first token will be a key.
    bool   isBoolVal = false;  // Track if current value is a boolean
    bool   boolValue = false;  // Store the boolean value

    for (char * p = json; *p; ++p) {
        if (*p == '\\') {
            // Shift characters one to the left to overwrite the backslash.
            char * q = p;
            do
                *q = *(q + 1);
            while (*q++);
            // Since we've shifted everything left, *p now points to the "actual" character.
        }
        else if (*p == '\"') {   // Quotes mark transitions
            if (isKey) {         // Processing a key.
                if (keyStart) {  // If we already have a start, this is the end.
                    *p    = '\0';
                    isKey = false;  // Next token will be a value.
                }
                else  // This is the start of a key.
                    keyStart = p + 1;
            }
            else {               // Processing a value.
                if (valStart) {  // If we already have a start, this is the end.
                    *p = '\0';
                    if (key_allowed (keyStart, allowed, allowed_count))
                        process (keyStart, valStart);  // Process the current key-value pair.
                    keyStart = valStart = nullptr;     // Reset for the next pair.
                    isKey               = true;        // Next token will be a key.
                    isBoolVal           = false;
                }
                else  // This is the start of a value.
                    valStart = p + 1;
            }
        }
        else if (*p == ':') {
            // Check if the value is an unquoted boolean (true/false)
            if (!isKey && !valStart) {
                if (*(p + 1) == 't' && strncmp (p + 1, "true", 4) == 0) {
                    valStart  = p + 1;
                    isBoolVal = true;
                    boolValue = true;
                    p += 4;  // Skip to 'e' of 'true', loop will increment past it
                }
                else if (*(p + 1) == 'f' && strncmp (p + 1, "false", 5) == 0) {
                    valStart  = p + 1;
                    isBoolVal = true;
                    boolValue = false;
                    p += 5;  // Skip to 'e' of 'false', loop will increment past it
                }
            }
            // If not a boolean, continue (next char should be '"' for string value)
        }
        else if (*p == ',' || *p == '}') {
            if (keyStart && valStart) {
                if (key_allowed (keyStart, allowed, allowed_count)) {
                    if (isBoolVal) {
                        process (keyStart, boolValue);  // Boolean overload
                    }
                    else {
                        process (keyStart, valStart);  // String overload
                    }
                }
                keyStart = valStart = nullptr;
                isBoolVal           = false;
            }
            isKey = true;  // Reset for the next key-value pair.
        }
    }
}

/**
 * Retrieve settings from NVS, expressed as JSON structure,
 * and respond to the http request
 */
esp_err_t retrieve_and_send_settings (httpd_req_t * req) {
    std::shared_ptr<char[]> buf = get_settings_json();
    if (!buf)
        REPLY_WITH_FAILURE (req, HTTPD_500_INTERNAL_SERVER_ERROR, "heap allocation failed");

    httpd_resp_set_type (req, "application/json");
    REPLY_WITH_STRING (req, buf.get(), "settings");
}

// ====================================================================================================

/**
 * Respond to the GET request by returning the current settings,
 * expressed as a json string
 */
esp_err_t handler_settings_get (httpd_req_t * req) {
    showActivity();

    ESP_LOGV (TAG8, "trace: %s()", __func__);

    return retrieve_and_send_settings (req);
}

/**
 * Read a POST body into a NUL-terminated heap buffer, looping until the
 * full content length arrives (a single recv may deliver a partial body,
 * which would otherwise parse as truncated-but-valid JSON). On failure the
 * HTTP error (400 oversize, 408 timeout) has already been sent where
 * applicable and nullptr is returned; the caller just returns ESP_FAIL.
 */
static std::unique_ptr<char[]> read_post_body (httpd_req_t * req) {
    // The largest legitimate body is the tune-targets JSON
    // (MAX_TUNE_TARGETS_JSON, 1600 bytes) plus escaping headroom; an
    // unchecked content_len would size an unbounded heap allocation, and
    // ESP-IDF aborts on a failed new.
    static const size_t MAX_POST_BODY = 4096;
    if (req->content_len > MAX_POST_BODY) {
        ESP_LOGE (TAG8, "refusing oversize POST body (%d bytes)", (int)req->content_len);
        http_send_error_json (req, HTTPD_400_BAD_REQUEST, "request body too large");
        return nullptr;
    }

    std::unique_ptr<char[]> buf (new char[req->content_len + 1]());
    size_t                  received = 0;
    while (received < req->content_len) {
        int ret = httpd_req_recv (req, buf.get() + received, req->content_len - received);
        if (ret <= 0) {
            if (ret == HTTPD_SOCK_ERR_TIMEOUT)
                httpd_resp_send_408 (req);
            return nullptr;
        }
        received += ret;
    }
    buf[req->content_len] = '\0';
    return buf;
}

/**
 * Respond to the POST request by parsing the incoming JSON key/value pairs,
 * storing those in NVS.  Subsequently, return those values as confirmation.
 */
esp_err_t handler_settings_post (httpd_req_t * req) {
    showActivity();

    ESP_LOGV (TAG8, "trace: %s()", __func__);

    auto buf = read_post_body (req);
    if (!buf)
        return ESP_FAIL;

    static const char * const SETTINGS_KEYS[] = {
        s_sta1_ssid_key, s_sta1_pass_key,
        s_sta2_ssid_key, s_sta2_pass_key,
        s_sta3_ssid_key, s_sta3_pass_key,
        s_ap_ssid_key, s_ap_pass_key,
        s_sta1_ip_pin_key, s_sta2_ip_pin_key, s_sta3_ip_pin_key};
    parse_and_process_json (buf.get(), SETTINGS_KEYS, sizeof (SETTINGS_KEYS) / sizeof (SETTINGS_KEYS[0]));

    if (nvs_commit (s_nvs_settings_handle) != ESP_OK)
        REPLY_WITH_FAILURE (req, HTTPD_500_INTERNAL_SERVER_ERROR, "failed commit settings to nvs");

    populate_settings();

    // The settings JSON is this request's one and only response; the
    // deferred reboot fires afterwards and can only be logged if it fails.
    esp_err_t result = retrieve_and_send_settings (req);

    if (result == ESP_OK) {
        ESP_LOGI (TAG8, "rebooting to apply new settings");
        if (schedule_deferred_reboot (req) != ESP_OK)
            ESP_LOGE (TAG8, "failed to schedule reboot; new settings apply on next power cycle");
    }

    return result;
}

// ====================================================================================================
// Small key-value settings endpoints (gps, callsign, license)
//
// Each endpoint is a field table; the GET echoes it as JSON and the POST
// stores exactly those keys (the table doubles as the whitelist), commits,
// refreshes the globals, and echoes the endpoint's current values.
// ====================================================================================================

static const KvField GPS_FIELDS[]      = {{s_gps_lat_key, g_gps_lat}, {s_gps_lon_key, g_gps_lon}};
static const KvField CALLSIGN_FIELDS[] = {{s_callsign_key, g_callsign}};
static const KvField LICENSE_FIELDS[]  = {{s_license_class_key, g_license_class}};

static esp_err_t send_kv_settings (httpd_req_t * req, const KvField fields[], size_t field_count) {
    httpd_resp_set_type (req, "application/json");
    httpd_resp_set_hdr (req, "Cache-Control", "no-store");
    auto settings_json = build_kv_json (fields, field_count);
    return httpd_resp_send (req, settings_json.get(), HTTPD_RESP_USE_STRLEN);
}

static esp_err_t handle_kv_settings_post (httpd_req_t * req, const KvField fields[], size_t field_count) {
    auto buf = read_post_body (req);
    if (!buf)
        return ESP_FAIL;

    const char * allowed[8];
    for (size_t i = 0; i < field_count && i < 8; ++i)
        allowed[i] = fields[i].key;
    parse_and_process_json (buf.get(), allowed, field_count);

    if (nvs_commit (s_nvs_settings_handle) != ESP_OK)
        REPLY_WITH_FAILURE (req, HTTPD_500_INTERNAL_SERVER_ERROR, "failed commit settings to nvs");

    populate_settings();

    return send_kv_settings (req, fields, field_count);
}

#define KV_FIELD_COUNT(fields) (sizeof (fields) / sizeof (fields[0]))

esp_err_t handler_gps_settings_get (httpd_req_t * req) {
    showActivity();
    ESP_LOGV (TAG8, "trace: %s()", __func__);
    return send_kv_settings (req, GPS_FIELDS, KV_FIELD_COUNT (GPS_FIELDS));
}

esp_err_t handler_gps_settings_post (httpd_req_t * req) {
    showActivity();
    ESP_LOGV (TAG8, "trace: %s()", __func__);
    return handle_kv_settings_post (req, GPS_FIELDS, KV_FIELD_COUNT (GPS_FIELDS));
}

esp_err_t handler_callsign_settings_get (httpd_req_t * req) {
    showActivity();
    ESP_LOGV (TAG8, "trace: %s()", __func__);
    return send_kv_settings (req, CALLSIGN_FIELDS, KV_FIELD_COUNT (CALLSIGN_FIELDS));
}

esp_err_t handler_callsign_settings_post (httpd_req_t * req) {
    showActivity();
    ESP_LOGV (TAG8, "trace: %s()", __func__);
    return handle_kv_settings_post (req, CALLSIGN_FIELDS, KV_FIELD_COUNT (CALLSIGN_FIELDS));
}

esp_err_t handler_license_settings_get (httpd_req_t * req) {
    showActivity();
    ESP_LOGV (TAG8, "trace: %s()", __func__);
    return send_kv_settings (req, LICENSE_FIELDS, KV_FIELD_COUNT (LICENSE_FIELDS));
}

esp_err_t handler_license_settings_post (httpd_req_t * req) {
    showActivity();
    ESP_LOGV (TAG8, "trace: %s()", __func__);
    return handle_kv_settings_post (req, LICENSE_FIELDS, KV_FIELD_COUNT (LICENSE_FIELDS));
}

// ====================================================================================================
// Tune Targets Settings
// ====================================================================================================

static std::shared_ptr<char[]> get_tune_targets_json () {
    ESP_LOGV (TAG8, "trace: %s()", __func__);

    // Return JSON: {"targets": [...], "mobile": true/false}
    size_t     required_size = 32 + sizeof (g_tune_targets);
    const char format[]      = "{\"targets\":%s,\"mobile\":%s}";

    std::shared_ptr<char[]> buf (new char[required_size]);
    // If g_tune_targets is empty, use empty array
    const char * targets = (g_tune_targets[0] == '\0') ? "[]" : g_tune_targets;
    snprintf (buf.get(), required_size, format, targets, g_tune_targets_mobile ? "true" : "false");

    return buf;
}

static esp_err_t retrieve_and_send_tune_targets (httpd_req_t * req) {
    ESP_LOGV (TAG8, "trace: %s()", __func__);

    httpd_resp_set_type (req, "application/json");
    httpd_resp_set_hdr (req, "Cache-Control", "no-store");
    auto settings_json = get_tune_targets_json();
    return httpd_resp_send (req, settings_json.get(), HTTPD_RESP_USE_STRLEN);
}

esp_err_t handler_tune_targets_get (httpd_req_t * req) {
    showActivity();

    ESP_LOGV (TAG8, "trace: %s()", __func__);

    return retrieve_and_send_tune_targets (req);
}

esp_err_t handler_tune_targets_post (httpd_req_t * req) {
    showActivity();

    ESP_LOGV (TAG8, "trace: %s()", __func__);

    auto buf = read_post_body (req);
    if (!buf)
        return ESP_FAIL;
    char * unsafe_buf = buf.get();

    // Extract the "targets" array; the scanner is string-aware, so bracketed
    // URLs (IPv6 hosts) never truncate it.
    // Expected format: {"targets": ["url1", "url2"], "mobile": true}
    size_t       array_len     = 0;
    const char * array_start   = json_find_array (unsafe_buf, "targets", &array_len);
    if (array_start) {
        if (json_array_count (array_start, array_len) > MAX_TUNE_TARGETS)
            REPLY_WITH_FAILURE (req, HTTPD_400_BAD_REQUEST, "too many tune targets");
        if (array_len < sizeof (g_tune_targets)) {
            snprintf (g_tune_targets, sizeof (g_tune_targets), "%.*s", (int)array_len, array_start);
            nvs_set_str (s_nvs_settings_handle, s_tune_targets_key, g_tune_targets);
            ESP_LOGI (TAG8, "Stored tune targets: %s", g_tune_targets);
        }
        else
            REPLY_WITH_FAILURE (req, HTTPD_400_BAD_REQUEST, "tune targets too large");
    }

    // Find mobile boolean
    char * mobile_start = strstr (unsafe_buf, "\"mobile\"");
    if (mobile_start) {
        g_tune_targets_mobile = (strstr (mobile_start, "true") != nullptr);
        nvs_set_u8 (s_nvs_settings_handle, s_tune_targets_mobile_key, g_tune_targets_mobile ? 1 : 0);
        ESP_LOGI (TAG8, "Stored tune targets mobile: %s", g_tune_targets_mobile ? "true" : "false");
    }

    if (nvs_commit (s_nvs_settings_handle) != ESP_OK)
        REPLY_WITH_FAILURE (req, HTTPD_500_INTERNAL_SERVER_ERROR, "failed commit settings to nvs");

    return retrieve_and_send_tune_targets (req);
}

// ====================================================================================================
// CW Macros Settings
// ====================================================================================================

static std::shared_ptr<char[]> get_cw_macros_json () {
    ESP_LOGV (TAG8, "trace: %s()", __func__);

    // Return JSON: {"macros": [...]}
    size_t     required_size = 16 + sizeof (g_cw_macros);
    const char format[]      = "{\"macros\":%s}";

    std::shared_ptr<char[]> buf (new char[required_size]);
    // If g_cw_macros is empty, use empty array
    const char * macros = (g_cw_macros[0] == '\0') ? "[]" : g_cw_macros;
    snprintf (buf.get(), required_size, format, macros);

    return buf;
}

static esp_err_t retrieve_and_send_cw_macros (httpd_req_t * req) {
    ESP_LOGV (TAG8, "trace: %s()", __func__);

    httpd_resp_set_type (req, "application/json");
    httpd_resp_set_hdr (req, "Cache-Control", "no-store");
    auto settings_json = get_cw_macros_json();
    return httpd_resp_send (req, settings_json.get(), HTTPD_RESP_USE_STRLEN);
}

esp_err_t handler_cw_macros_get (httpd_req_t * req) {
    showActivity();

    ESP_LOGV (TAG8, "trace: %s()", __func__);

    return retrieve_and_send_cw_macros (req);
}

esp_err_t handler_cw_macros_post (httpd_req_t * req) {
    showActivity();

    ESP_LOGV (TAG8, "trace: %s()", __func__);

    auto buf = read_post_body (req);
    if (!buf)
        return ESP_FAIL;

    // Extract the "macros" array (string-aware and depth-counting).
    // Expected format: {"macros": [{"label":"...","template":"..."},...]  }
    size_t       array_len   = 0;
    const char * array_start = json_find_array (buf.get(), "macros", &array_len);
    if (array_start) {
        if (json_array_count (array_start, array_len) > MAX_CW_MACROS)
            REPLY_WITH_FAILURE (req, HTTPD_400_BAD_REQUEST, "too many CW macros");
        if (array_len < sizeof (g_cw_macros)) {
            snprintf (g_cw_macros, sizeof (g_cw_macros), "%.*s", (int)array_len, array_start);
            nvs_set_str (s_nvs_settings_handle, s_cw_macros_key, g_cw_macros);
            ESP_LOGI (TAG8, "Stored CW macros: %s", g_cw_macros);
        }
        else
            REPLY_WITH_FAILURE (req, HTTPD_400_BAD_REQUEST, "CW macros too large");
    }

    if (nvs_commit (s_nvs_settings_handle) != ESP_OK)
        REPLY_WITH_FAILURE (req, HTTPD_500_INTERNAL_SERVER_ERROR, "failed commit settings to nvs");

    return retrieve_and_send_cw_macros (req);
}

// ====================================================================================================
// Radio Type
// ====================================================================================================

esp_err_t handler_radio_type_get (httpd_req_t * req) {
    showActivity();

    ESP_LOGV (TAG8, "trace: %s()", __func__);

    const char * type = kxRadio.get_radio_type_string();
    REPLY_WITH_STRING (req, type, "radio type");
}
