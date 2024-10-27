#include "globals.h"
#include "settings.h"
#include "webserver.h"

#include <esp_err.h>
#include <esp_mac.h>
#include <nvs_flash.h>

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
static const char s_ap_ssid_key[] = "ap_ssid";
char              g_ap_ssid[MAX_WIFI_SSID_SIZE];
static const char s_ap_pass_key[] = "ap_pass";
char              g_ap_pass[MAX_WIFI_PASS_SIZE];

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
        strncpy (value, default_value, size);
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
    GET_NV_STRING (ap_ssid, default_ap_ssid);
    GET_NV_STRING (ap_pass, "12345678");
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
static std::shared_ptr<char[]> get_settings_json () {
    ESP_LOGV (TAG8, "trace: %s()", __func__);

    // It is critically important that the
    // required_size, format, and sprintf varargs
    // are all in close correspondence.

    // {              // 1
    // "foo":"bar",   // sizeof(foo) + sizeof(bar) + 6 for extras
    // }              // 1
    size_t required_size = 1 +
                           sizeof (s_sta1_ssid_key) + sizeof (g_sta1_ssid) + 6 +
                           sizeof (s_sta1_pass_key) + sizeof (g_sta1_pass) + 6 +
                           sizeof (s_sta2_ssid_key) + sizeof (g_sta2_ssid) + 6 +
                           sizeof (s_sta2_pass_key) + sizeof (g_sta2_pass) + 6 +
                           sizeof (s_ap_ssid_key) + sizeof (g_ap_ssid) + 6 +
                           sizeof (s_ap_pass_key) + sizeof (g_ap_pass) + 6 +
                           1;
    const char format[] = "{\"%s\":\"%s\",\"%s\":\"%s\",\"%s\":\"%s\",\"%s\":\"%s\",\"%s\":\"%s\",\"%s\":\"%s\"}";

    std::shared_ptr<char[]> buf (new char[required_size]);
    snprintf (buf.get(), required_size, format, s_sta1_ssid_key, g_sta1_ssid, s_sta1_pass_key, g_sta1_pass, s_sta2_ssid_key, g_sta2_ssid, s_sta2_pass_key, g_sta2_pass, s_ap_ssid_key, g_ap_ssid, s_ap_pass_key, g_ap_pass);

    return buf;
}

/**
 * Helper function to store key value pairs in NVS.
 * Simply a convenient aliasing to keep the caller clean.
 */
static esp_err_t process (const char * key, const char * value) {
    // Log the key-value pair to the console.
    ESP_LOGI (TAG8, "Storing into NVS the key: %s, with value: %s", key, value);
    return nvs_set_str (s_nvs_settings_handle, key, value);
}

/**
 * Parse the JSON string in content and call the process function for each key-value pair.
 * Incoming string will look like:
 *   {"sta1_ssid":"foo","sta1_pass":"barbarbar","sta2_ssid":"baz","sta2_pass":"quuxquux","ap_ssid":"SOTAcat-A480","ap_pass":"12345678"}
 * NOTE: incoming json variable's content is modified during this operation
 */
static void parse_and_process_json (char * json) {
    char * keyStart = nullptr;
    char * valStart = nullptr;
    bool   isKey    = true;  // Start by assuming the first token will be a key.

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
                    process (keyStart, valStart);   // Process the current key-value pair.
                    keyStart = valStart = nullptr;  // Reset for the next pair.
                    isKey               = true;     // Next token will be a key.
                }
                else  // This is the start of a value.
                    valStart = p + 1;
            }
        }
        else if (*p == ':')
            continue;  // Skip the colon itself.
        else if (*p == ',' || *p == '}') {
            if (keyStart && valStart) {  // In case of no closing quote for value.
                process (keyStart, valStart);
                keyStart = valStart = nullptr;
            }
            isKey = true;  // Reset for the next key-value pair.
        }
    }
}

/**
 * Retrieve settings from NVS, expressed as JSON structure,
 * and respond to the http request
 */
static esp_err_t retrieve_and_send_settings (httpd_req_t * req) {
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
 * Respond to the POST request by parsing the incoming JSON key/value pairs,
 * storing those in NVS.  Subsequently, return those values as confirmation.
 */
esp_err_t handler_settings_post (httpd_req_t * req) {
    showActivity();

    ESP_LOGV (TAG8, "trace: %s()", __func__);

    std::unique_ptr<char[]> buf (new char[req->content_len]);
    if (!buf)
        REPLY_WITH_FAILURE (req, HTTPD_500_INTERNAL_SERVER_ERROR, "heap allocation failed");

    char * unsafe_buf = buf.get();  // reference to an ephemeral buffer

    // Get the content
    int ret = httpd_req_recv (req, unsafe_buf, req->content_len);
    if (ret <= 0)
        REPLY_WITH_FAILURE (req, HTTPD_404_NOT_FOUND, "post content not received");

    parse_and_process_json (unsafe_buf);

    if (nvs_commit (s_nvs_settings_handle) != ESP_OK)
        REPLY_WITH_FAILURE (req, HTTPD_500_INTERNAL_SERVER_ERROR, "failed commit settings to nvs");

    populate_settings();

    esp_err_t result = retrieve_and_send_settings (req);

    if (result == ESP_OK) {
        // Reboot with the new settings
        ESP_LOGI (TAG8, "rebooting to apply new settings");

        result = schedule_deferred_reboot (req);
        if (result != ESP_OK)
            REPLY_WITH_FAILURE (req, HTTPD_500_INTERNAL_SERVER_ERROR, "Failed to schedule reboot");

        REPLY_WITH_SUCCESS();
    }

    return result;
}
