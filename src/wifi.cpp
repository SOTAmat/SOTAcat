#include "wifi.h"
#include "globals.h"
#include "settings.h"

#include <esp_mac.h>
#include <esp_wifi.h>
#include <freertos/FreeRTOS.h>
#include <freertos/task.h>
#include <lwip/ip4_addr.h>
#include <mdns.h>

#include <esp_log.h>
static const char * TAG8 = "sc:wifi....";

#define MAX_QUICK_CONNECT_ATTEMPTS           1
#define PAUSE_BETWEEN_CONNECTION_ATTEMPTS_MS 2000  // We pause between connection attempts to allow access point connections a chance to complete

static bool          wifi_connected        = false;
static bool          s_sta_connected       = false;
static bool          s_ap_active           = false;
static bool          s_ap_client_connected = false;
static esp_netif_t * sta_netif;
static esp_netif_t * ap_netif;
static char          s_current_ssid[32] = {0};

// Function to initialize and start the WiFi Access Point
static void wifi_init_ap () {
    ESP_LOGV (TAG8, "trace: %s()", __func__);

    wifi_config_t wifi_config = {};
    memset (&wifi_config, 0, sizeof (wifi_config_t));

    ESP_LOGI (TAG8, "Initializing WiFi AP with SSID: %s", g_ap_ssid);
    strcpy ((char *)wifi_config.ap.ssid, g_ap_ssid);
    wifi_config.ap.ssid_len = (uint8_t)strlen (g_ap_ssid);
    if (strlen (g_ap_pass) == 0)
        wifi_config.ap.authmode = WIFI_AUTH_OPEN;
    else
        strcpy ((char *)wifi_config.ap.password, g_ap_pass);
    wifi_config.ap.channel        = 1;
    wifi_config.ap.authmode       = WIFI_AUTH_WPA_WPA2_PSK;
    wifi_config.ap.max_connection = 2;

    esp_err_t ret = esp_wifi_set_config (WIFI_IF_AP, &wifi_config);
    if (ret != ESP_OK) {
        ESP_LOGE (TAG8, "Failed to set AP config: %s", esp_err_to_name (ret));
        return;
    }

    ESP_LOGI (TAG8, "Configuring DHCP server for AP mode.");
    esp_netif_ip_info_t info = {};
    memset (&info, 0, sizeof (esp_netif_ip_info_t));
    IP4_ADDR (&info.ip, 192, 168, 4, 1);
    IP4_ADDR (&info.gw, 0, 0, 0, 0);  // Intentionally set a zero gateway address so that iPhones will not route internet traffic through the ESP32 AP.
    IP4_ADDR (&info.netmask, 255, 255, 255, 0);
    esp_netif_dhcps_stop (ap_netif);  // stop DHCP server before setting new IP info
    ret = esp_netif_set_ip_info (ap_netif, &info);
    if (ret != ESP_OK) {
        ESP_LOGE (TAG8, "Failed to set AP IP info: %s", esp_err_to_name (ret));
        return;
    }
    ret = esp_netif_dhcps_start (ap_netif);
    if (ret != ESP_OK) {
        ESP_LOGE (TAG8, "Failed to start DHCP server: %s", esp_err_to_name (ret));
        return;
    }

    wifi_mode_t mode;
    esp_wifi_get_mode (&mode);
    ESP_LOGI (TAG8, "Current WiFi mode: %d", mode);

    s_ap_active = true;
    ESP_LOGI (TAG8, "WiFi AP setup complete. SSID: %s, Channel: %d", g_ap_ssid, wifi_config.ap.channel);
}

// Function to initialize and start the WiFi Station mode
static void wifi_init_sta (const char * ssid, const char * password) {
    ESP_LOGV (TAG8, "trace: %s(ssid = '%s')", __func__, ssid);

    wifi_config_t wifi_config = {};
    memset (&wifi_config, 0, sizeof (wifi_config));
    strcpy ((char *)wifi_config.sta.ssid, ssid);
    strcpy ((char *)wifi_config.sta.password, password);

    esp_err_t err = esp_wifi_set_config (WIFI_IF_STA, &wifi_config);
    if (err != ESP_OK) {
        ESP_LOGE (TAG8, "Failed to set WiFi STA config: %s", esp_err_to_name (err));
        return;
    }

    err = esp_wifi_connect();
    if (err != ESP_OK) {
        ESP_LOGE (TAG8, "Failed to connect to WiFi: %s", esp_err_to_name (err));
        return;
    }

    strncpy (s_current_ssid, ssid, sizeof (s_current_ssid) - 1);
    s_current_ssid[sizeof (s_current_ssid) - 1] = '\0';

    ESP_LOGI (TAG8, "Attempting to connect to WiFi: %s", ssid);
}

// Function to stop AP mode
static void stop_ap_mode () {
    if (s_ap_active) {
        ESP_LOGI (TAG8, "Stopping AP mode");
        ESP_ERROR_CHECK (esp_wifi_set_mode (WIFI_MODE_STA));
        s_ap_active           = false;
        s_ap_client_connected = false;
    }
}

// Function to stop STA mode
static void stop_sta_mode () {
    if (s_sta_connected) {
        ESP_LOGI (TAG8, "Disconnecting from STA mode");
        ESP_ERROR_CHECK (esp_wifi_disconnect());
        s_sta_connected = false;
        memset (s_current_ssid, 0, sizeof (s_current_ssid));
    }
}

// Function to handle WiFi events
static void wifi_event_handler (void *           arg,
                                esp_event_base_t event_base,
                                int32_t          event_id,
                                void *           event_data) {
    static int  quick_connect_attempts     = 0;
    static bool trying_ssid1               = true;
    static bool initial_connection_attempt = true;

    if (event_base == WIFI_EVENT) {
        if (event_id == WIFI_EVENT_AP_STACONNECTED) {
            wifi_event_ap_staconnected_t * event = (wifi_event_ap_staconnected_t *)event_data;
            ESP_LOGI (TAG8, "Station " MACSTR " connected to AP, AID=%d", MAC2STR (event->mac), event->aid);
            s_ap_client_connected = true;
            stop_sta_mode();  // Stop trying to connect as a station
        }
        else if (event_id == WIFI_EVENT_AP_STADISCONNECTED) {
            wifi_event_ap_stadisconnected_t * event = (wifi_event_ap_stadisconnected_t *)event_data;
            ESP_LOGI (TAG8, "Station " MACSTR " disconnected from AP, AID=%d", MAC2STR (event->mac), event->aid);
            s_ap_client_connected = false;

            if (!s_sta_connected) {
                // Restart STA connection attempts
                quick_connect_attempts     = 0;
                trying_ssid1               = true;
                initial_connection_attempt = true;
                wifi_init_sta (g_sta1_ssid, g_sta1_pass);
            }
        }
        else if (event_id == WIFI_EVENT_STA_START) {
            ESP_LOGI (TAG8, "STA mode started. Attempting initial connection to SSID1: %s", g_sta1_ssid);
            strncpy (s_current_ssid, g_sta1_ssid, sizeof (s_current_ssid) - 1);
            s_current_ssid[sizeof (s_current_ssid) - 1] = '\0';
            esp_wifi_connect();
        }
        else if (event_id == WIFI_EVENT_STA_DISCONNECTED) {
            if (initial_connection_attempt) {
                ESP_LOGI (TAG8, "Initial connection attempt to %s failed.", s_current_ssid);
                initial_connection_attempt = false;
            }
            else if (s_sta_connected)
                ESP_LOGI (TAG8, "Disconnected from STA network: %s", s_current_ssid);

            s_sta_connected = false;

            if (!s_ap_client_connected) {
                if (quick_connect_attempts < MAX_QUICK_CONNECT_ATTEMPTS) {
                    quick_connect_attempts++;
                    ESP_LOGI (TAG8, "Quick reconnect attempt %d/%d to %s", quick_connect_attempts, MAX_QUICK_CONNECT_ATTEMPTS, s_current_ssid);
                    esp_wifi_connect();
                    vTaskDelay (pdMS_TO_TICKS (PAUSE_BETWEEN_CONNECTION_ATTEMPTS_MS));
                }
                else {
                    quick_connect_attempts = 0;
                    trying_ssid1           = !trying_ssid1;  // Switch to the other SSID

                    if (trying_ssid1) {
                        ESP_LOGI (TAG8, "Attempting to connect to SSID1: %s", g_sta1_ssid);
                        wifi_init_sta (g_sta1_ssid, g_sta1_pass);
                    }
                    else {
                        ESP_LOGI (TAG8, "Attempting to connect to SSID2: %s", g_sta2_ssid);
                        wifi_init_sta (g_sta2_ssid, g_sta2_pass);
                    }
                }

                // Ensure AP mode is active when not connected to any network
                if (!s_ap_active) {
                    ESP_LOGI (TAG8, "Restarting AP mode");
                    ESP_ERROR_CHECK (esp_wifi_set_mode (WIFI_MODE_APSTA));
                    wifi_init_ap();
                }
            }
        }
    }
    else if (event_base == IP_EVENT && event_id == IP_EVENT_STA_GOT_IP) {
        ip_event_got_ip_t * event = (ip_event_got_ip_t *)event_data;
        ESP_LOGI (TAG8, "Connected to network: %s, IP address: " IPSTR, s_current_ssid, IP2STR (&event->ip_info.ip));
        s_sta_connected            = true;
        quick_connect_attempts     = 0;
        initial_connection_attempt = false;
        stop_ap_mode();  // Stop AP mode when STA connection is successful
    }
}

// Function to reduce WiFi transmit power
static void wifi_attenuate_power () {
    ESP_LOGV (TAG8, "trace: %s()", __func__);
    /*
     * Wifi TX power levels are quantized.
     * See https://demo-dijiudu.readthedocs.io/en/latest/api-reference/wifi/esp_wifi.html
     * | range     | level             | net pwr  |
     * |-----------+-------------------+----------|
     * | [78, 127] | level0            | 19.5 dBm |
     * | [76, 77]  | level1            | 19   dBm |
     * | [74, 75]  | level2            | 18.5 dBm |
     * | [68, 73]  | level3            | 17   dBm |
     * | [60, 67]  | level4            | 15   dBm |
     * | [52, 59]  | level5            | 13   dBm |
     * | [44, 51]  | level5 -  2.0 dBm | 11   dBm |  <-- we'll use this
     * | [34, 43]  | level5 -  4.5 dBm |  8.5 dBm |
     * | [28, 33]  | level5 -  6.0 dBm |  7   dBm |
     * | [20, 27]  | level5 -  8.0 dBm |  5   dBm |
     * | [8,  19]  | level5 - 11.0 dBm |  2   dBm |
     * | [-128, 7] | level5 - 14.0 dBm | -1   dBM |
     */
    // Not required, but we read the starting power just for informative purposes
    int8_t curr_wifi_power = 0;
    ESP_ERROR_CHECK (esp_wifi_get_max_tx_power (&curr_wifi_power));
    ESP_LOGI (TAG8, "Default max TX power: %d", curr_wifi_power);

    const int8_t MAX_TX_PWR = 44;  // level 5 - 2dBm = 11dBm
    ESP_LOGI (TAG8, "Setting WiFi max power to %d", MAX_TX_PWR);
    ESP_ERROR_CHECK (esp_wifi_set_max_tx_power (MAX_TX_PWR));

    ESP_ERROR_CHECK (esp_wifi_get_max_tx_power (&curr_wifi_power));
    ESP_LOGI (TAG8, "Confirmed new max TX power: %d", curr_wifi_power);
}

// Function to initialize WiFi
void wifi_init () {
    ESP_LOGV (TAG8, "trace: %s()", __func__);

    s_sta_connected       = false;
    s_ap_client_connected = false;

    ESP_ERROR_CHECK (esp_netif_init());
    ESP_ERROR_CHECK (esp_event_loop_create_default());

    sta_netif = esp_netif_create_default_wifi_sta();
    ap_netif  = esp_netif_create_default_wifi_ap();
    ESP_ERROR_CHECK (esp_event_handler_register (WIFI_EVENT, ESP_EVENT_ANY_ID, &wifi_event_handler, NULL));
    ESP_ERROR_CHECK (esp_event_handler_register (IP_EVENT, IP_EVENT_STA_GOT_IP, &wifi_event_handler, NULL));

    wifi_init_config_t cfg = WIFI_INIT_CONFIG_DEFAULT();
    ESP_ERROR_CHECK (esp_wifi_init (&cfg));
    ESP_ERROR_CHECK (esp_wifi_set_mode (WIFI_MODE_APSTA));

    // Initialize AP mode
    wifi_init_ap();

    // Start WiFi and give the Access Point time to start
    ESP_ERROR_CHECK (esp_wifi_start());
    vTaskDelay (pdMS_TO_TICKS (2000));

    // Now initialize STA mode
    wifi_init_sta (g_sta1_ssid, g_sta1_pass);

    wifi_attenuate_power();

    ESP_LOGI (TAG8, "WiFi initialization complete. Waiting for connection...");

    // Continue trying to connect indefinitely
    while (!s_sta_connected && !s_ap_client_connected)
        vTaskDelay (pdMS_TO_TICKS (1000));  // Check every second

    ESP_LOGI (TAG8, "WiFi connection established to %s", s_sta_connected ? s_current_ssid : "AP client");
}

// Function to start mDNS service
void start_mdns_service () {
    ESP_LOGV (TAG8, "trace: %s()", __func__);

    // Initialize mDNS service
    ESP_ERROR_CHECK (mdns_init());

    // Set the hostname
    ESP_ERROR_CHECK (mdns_hostname_set ("sotacat"));

    // Set the default instance
    ESP_ERROR_CHECK (mdns_instance_name_set ("SOTAcat SOTAmat Service"));

    // You can also add services to announce
    mdns_service_add (NULL, "_http", "_tcp", 80, NULL, 0);
}

void wifi_task (void * pvParameters) {
    TaskNotifyConfig * config = (TaskNotifyConfig *)pvParameters;
    wifi_init();

    bool was_connected = false;
    while (true) {
        bool is_connected = s_sta_connected || s_ap_client_connected;
        if (is_connected && !was_connected) {
            xTaskNotify (config->setup_task_handle, config->notification_bit, eSetBits);
            was_connected = true;
        }
        else if (!is_connected)
            was_connected = false;

        vTaskDelay (pdMS_TO_TICKS (1000));
    }
}

void start_wifi_task (TaskNotifyConfig * config) {
    xTaskCreate (&wifi_task, "wifi_task", 4096, (void *)config, SC_TASK_PRIORITY_NORMAL, NULL);
}

bool is_wifi_connected () {
    return wifi_connected;
}
