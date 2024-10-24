// Modified wifi.cpp
#include "esp_err.h"
#include "esp_log.h"
#include "esp_netif.h"
#include "esp_netif_types.h"
#include <string.h>

#include "globals.h"
#include "settings.h"
#include "wifi.h"

#include <esp_mac.h>
#include <esp_wifi.h>
#include <freertos/FreeRTOS.h>
#include <freertos/task.h>
#include <lwip/ip4_addr.h>
#include <mdns.h>

#include <esp_log.h>

// Add at top with other includes
#include "lwip/netdb.h"
#include "lwip/sockets.h"
#include "lwip/tcp.h"

static const char * TAG8 = "sc:wifi....";

// Shared variables accessed from multiple contexts
static volatile bool s_sta_connected       = false;
static volatile bool s_ap_client_connected = false;
static volatile bool wifi_connected        = false;

static bool          s_wifi_sta_started = false;
static bool          s_wifi_ap_started  = false;
static bool          s_dhcp_configured  = false;
static int           retry_count        = 0;
static esp_netif_t * sta_netif;
static esp_netif_t * ap_netif;
// Add this line:
static bool          mdns_started          = false;

// Add these at the top of wifi.cpp
#define WIFI_CONNECT_TIMEOUT_MS          10000
#define WIFI_STATE_TRANSITION_TIMEOUT_MS 5000
#define WIFI_RECONNECT_BACKOFF_BASE_MS   1000
#define WIFI_MAX_BACKOFF_MS              32000

// Function to handle Wi-Fi events
static void wifi_event_handler (void * arg, esp_event_base_t event_base, int32_t event_id, void * event_data) {
    ESP_LOGV (TAG8, "trace: %s(event_base = '%s', event_id = %ld)", __func__, event_base, event_id);

    if (event_base == WIFI_EVENT) {
        switch (event_id) {
        case WIFI_EVENT_STA_START:
            ESP_LOGI (TAG8, "WIFI_EVENT_STA_START");
            s_wifi_sta_started = true;
            break;
        case WIFI_EVENT_STA_STOP:
            ESP_LOGI (TAG8, "WIFI_EVENT_STA_STOP");
            s_wifi_sta_started = false;
            wifi_connected     = false;
            break;
        case WIFI_EVENT_STA_CONNECTED:
            ESP_LOGI (TAG8, "WIFI_EVENT_STA_CONNECTED");
            s_sta_connected = true;
            wifi_connected  = true;
            break;
        case WIFI_EVENT_STA_DISCONNECTED:
            ESP_LOGI (TAG8, "WIFI_EVENT_STA_DISCONNECTED");
            s_sta_connected = false;
            wifi_connected  = false;

            if (retry_count < MAX_RETRY_WIFI_STATION_CONNECT) {
                ESP_LOGI (TAG8, "Retrying connection to SSID...");
                esp_err_t err = esp_wifi_connect();
                if (err != ESP_OK) {
                    ESP_LOGE (TAG8, "Failed to initiate STA connection: %s", esp_err_to_name (err));
                    // Delay a short time before retrying
                    vTaskDelay (pdMS_TO_TICKS (150));
                }
                retry_count++;
            }
            else {
                ESP_LOGI (TAG8, "Maximum retry attempts reached. Switching SSID or resetting state.");
                retry_count = 0;
                // Optionally switch SSID or reset state to trigger alternate logic
            }

            // Add these lines
            if (mdns_started) {
                mdns_free();
                mdns_started = false;
                ESP_LOGI (TAG8, "mDNS stopped due to disconnection");
            }
            break;

        case WIFI_EVENT_AP_START:
            ESP_LOGI (TAG8, "WIFI_EVENT_AP_START");
            s_wifi_ap_started = true;
            break;
        case WIFI_EVENT_AP_STOP:
            ESP_LOGI (TAG8, "WIFI_EVENT_AP_STOP");
            s_wifi_ap_started = false;
            break;

        case WIFI_EVENT_AP_STACONNECTED: {
            wifi_event_ap_staconnected_t * event = (wifi_event_ap_staconnected_t *)event_data;
            ESP_LOGI (TAG8, "Station " MACSTR " connected, aid=%d", MAC2STR (event->mac), event->aid);
            s_ap_client_connected = true;
            wifi_connected        = true;

            // Check current settings before reapplying AP settings
            esp_netif_ip_info_t current_ip_info;
            esp_netif_get_ip_info (ap_netif, &current_ip_info);

            esp_netif_ip_info_t desired_ip_info;
            IP4_ADDR (&desired_ip_info.ip, 192, 168, 4, 1);
            IP4_ADDR (&desired_ip_info.gw, 0, 0, 0, 0);  // Non-routable gateway
            IP4_ADDR (&desired_ip_info.netmask, 255, 255, 255, 0);
            s_dhcp_configured = true;

            if (memcmp (&current_ip_info, &desired_ip_info, sizeof (esp_netif_ip_info_t)) != 0) {
                // Only reapply if the configuration has changed
                esp_netif_set_ip_info (ap_netif, &desired_ip_info);
            }
            break;
        }

        case WIFI_EVENT_AP_STADISCONNECTED: {
            wifi_event_ap_stadisconnected_t * event = (wifi_event_ap_stadisconnected_t *)event_data;
            ESP_LOGI (TAG8, "Station " MACSTR " disconnected, AID=%d", MAC2STR (event->mac), event->aid);

            // Check if this was the last client
            wifi_sta_list_t sta_list;
            esp_err_t       err = esp_wifi_ap_get_sta_list (&sta_list);
            if (err == ESP_OK && sta_list.num == 0) {
                s_ap_client_connected = false;
                wifi_connected        = s_sta_connected;
                s_dhcp_configured     = false;
            }
            break;
        }
        default:
            break;
        }
    }
    else if (event_base == IP_EVENT) {
        switch (event_id) {
        case IP_EVENT_STA_GOT_IP: {
            ip_event_got_ip_t * event = (ip_event_got_ip_t *)event_data;
            ESP_LOGI (TAG8, "Got IP: " IPSTR, IP2STR (&event->ip_info.ip));
            wifi_connected = true;
            break;
        }
        case IP_EVENT_STA_LOST_IP:
            ESP_LOGI (TAG8, "Lost IP address.");
            wifi_connected = false;
            break;
        default:
            break;
        }
    }
}

static void wifi_init_softap () {
    ESP_LOGV (TAG8, "trace: %s()", __func__);

    ESP_LOGI (TAG8, "Setting up soft AP");
    wifi_config_t    wifi_config = {};
    wifi_ap_config_t ap_config   = {
          .ssid            = "",
          .password        = "",
          .ssid_len        = 0,
          .channel         = 1,
          .authmode        = WIFI_AUTH_WPA2_PSK,
          .ssid_hidden     = 0,
          .max_connection  = 8,
          .beacon_interval = 100,
          .pairwise_cipher = WIFI_CIPHER_TYPE_CCMP,
          .ftm_responder   = false,
          .pmf_cfg         = {
                              .capable  = true,
                              .required = false},
          .sae_pwe_h2e = WPA3_SAE_PWE_BOTH
    };
    memcpy (&wifi_config.ap, &ap_config, sizeof (wifi_ap_config_t));

    strlcpy ((char *)wifi_config.ap.ssid, g_ap_ssid, sizeof (wifi_config.ap.ssid));
    wifi_config.ap.ssid_len = strlen (g_ap_ssid);
    strlcpy ((char *)wifi_config.ap.password, g_ap_pass, sizeof (wifi_config.ap.password));

    if (strlen (g_ap_pass) == 0) {
        wifi_config.ap.authmode = WIFI_AUTH_OPEN;
    }

    ESP_ERROR_CHECK (esp_wifi_set_config (WIFI_IF_AP, &wifi_config));

    esp_netif_ip_info_t ip_info;
    IP4_ADDR (&ip_info.ip, 192, 168, 4, 1);
    IP4_ADDR (&ip_info.gw, 0, 0, 0, 0);  // Set gateway to 0.0.0.0 to indicate no internet route
    IP4_ADDR (&ip_info.netmask, 255, 255, 255, 0);
    ESP_ERROR_CHECK (esp_netif_dhcps_stop (ap_netif));
    ESP_ERROR_CHECK (esp_netif_set_ip_info (ap_netif, &ip_info));
    ESP_ERROR_CHECK (esp_netif_dhcps_start (ap_netif));

    ESP_LOGI (TAG8, "Soft AP setup complete. SSID:%s", g_ap_ssid);
}

static void wifi_init_sta (const char * ssid, const char * password) {
    ESP_LOGI (TAG8, "Attempting SSID:%s", ssid);
    wifi_config_t wifi_config = {};

    strlcpy ((char *)wifi_config.sta.ssid, ssid, sizeof (wifi_config.sta.ssid));
    strlcpy ((char *)wifi_config.sta.password, password, sizeof (wifi_config.sta.password));
    wifi_config.sta.scan_method        = WIFI_FAST_SCAN;
    wifi_config.sta.sort_method        = WIFI_CONNECT_AP_BY_SIGNAL;
    wifi_config.sta.threshold.authmode = WIFI_AUTH_WPA2_PSK;

    ESP_ERROR_CHECK (esp_wifi_set_config (WIFI_IF_STA, &wifi_config));

    ESP_LOGI (TAG8, "Station configuration set to access AP SSID:%s", ssid);
}

// Function to reduce Wi-Fi transmit power
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
    ESP_LOGI (TAG8, "default max tx power: %d", curr_wifi_power);

    const int8_t MAX_TX_PWR = 44;  // level 5 - 2dBm = 11dBm
    ESP_LOGI (TAG8, "setting wifi max power to %d", MAX_TX_PWR);
    ESP_ERROR_CHECK (esp_wifi_set_max_tx_power (MAX_TX_PWR));

    ESP_ERROR_CHECK (esp_wifi_get_max_tx_power (&curr_wifi_power));
    ESP_LOGI (TAG8, "confirmed new max tx power: %d", curr_wifi_power);
}

// Function to initialize Wi-Fi
void wifi_init () {
    ESP_LOGV (TAG8, "trace: %s()", __func__);

    s_sta_connected       = false;
    s_ap_client_connected = false;
    wifi_connected        = false;
    s_wifi_ap_started     = false;

    ESP_ERROR_CHECK (esp_netif_init());
    ESP_ERROR_CHECK (esp_event_loop_create_default());

    sta_netif = esp_netif_create_default_wifi_sta();
    ap_netif  = esp_netif_create_default_wifi_ap();

    wifi_init_config_t cfg = WIFI_INIT_CONFIG_DEFAULT();
    ESP_ERROR_CHECK (esp_wifi_init (&cfg));

    // Set storage to RAM before any other WiFi calls
    ESP_ERROR_CHECK (esp_wifi_set_storage (WIFI_STORAGE_RAM));

    ESP_ERROR_CHECK (esp_event_handler_register (WIFI_EVENT, ESP_EVENT_ANY_ID, &wifi_event_handler, NULL));
    ESP_ERROR_CHECK (esp_event_handler_register (IP_EVENT, IP_EVENT_STA_GOT_IP, &wifi_event_handler, NULL));

    ESP_ERROR_CHECK (esp_wifi_set_mode (WIFI_MODE_APSTA));

    // Clear any existing WiFi configuration
    wifi_config_t wifi_config = {};
    ESP_ERROR_CHECK (esp_wifi_set_config (WIFI_IF_STA, &wifi_config));

    // Clear AP configuration as well
    wifi_config_t ap_config      = {};
    ap_config.ap.channel         = 1;
    ap_config.ap.max_connection  = 4;
    ap_config.ap.beacon_interval = 100;
    ESP_ERROR_CHECK (esp_wifi_set_config (WIFI_IF_AP, &ap_config));
    wifi_init_softap();

    // Disconnect if we're connected to any AP
    esp_err_t err = esp_wifi_disconnect();
    if (err != ESP_OK && err != ESP_ERR_WIFI_NOT_STARTED) {
        ESP_LOGE (TAG8, "Error disconnecting Wi-Fi: %s", esp_err_to_name (err));
    }

    ESP_ERROR_CHECK (esp_wifi_start());

    wifi_attenuate_power();

    ESP_LOGI (TAG8, "wifi initialization complete");
}

bool start_mdns_service () {
    ESP_LOGV (TAG8, "trace: %s()", __func__);

    // Stop any existing mDNS service first
    mdns_free();

    ESP_LOGI (TAG8, "starting mdns service");
    esp_err_t err = mdns_init();
    if (err) {
        ESP_LOGE (TAG8, "mDNS Init failed: %d", err);
        return false;
    }

    // Set the hostname
    err = mdns_hostname_set ("sotacat");
    if (err != ESP_OK) {
        ESP_LOGE (TAG8, "mDNS hostname set failed: %s", esp_err_to_name (err));
        mdns_free();
        return false;
    }

    // Set the default instance
    err = mdns_instance_name_set ("SOTAcat SOTAmat Service");
    if (err != ESP_OK) {
        ESP_LOGE (TAG8, "mDNS instance name set failed: %s", esp_err_to_name (err));
        mdns_free();
        return false;
    }

    // Add service
    err = mdns_service_add (NULL, "_http", "_tcp", 80, NULL, 0);
    if (err != ESP_OK) {
        ESP_LOGE (TAG8, "mDNS service add failed: %s", esp_err_to_name (err));
        mdns_free();
        return false;
    }

    ESP_LOGI (TAG8, "mDNS service started successfully");
    return true;
}

void wifi_task (void * pvParameters) {
    TaskNotifyConfig * config = (TaskNotifyConfig *)pvParameters;

    wifi_init();

    const int  CONNECT_ATTEMPT_TIME_MS      = 5000;   // 5 seconds timeout
    const int  CONNECTION_CHECK_INTERVAL_MS = 10000;  // Check connection every 10 seconds
    int        current_ssid                 = 1;
    TickType_t attempt_start_time           = -CONNECT_ATTEMPT_TIME_MS;
    TickType_t last_connection_check_time   = 0;
    bool       mdns_started                 = false;
    bool       previously_connected         = false;
    bool       sta_mode_aborted             = false;

    enum WifiState {
        NO_CONNECTION,
        CONNECTING,
        CONNECTED
    } wifi_state = NO_CONNECTION;

    while (true) {
        TickType_t current_time = xTaskGetTickCount();

        switch (wifi_state) {
        case NO_CONNECTION:
            if (wifi_connected) {
                wifi_state = CONNECTED;
                break;
            }

            if (mdns_started) {
                mdns_free();
                mdns_started = false;
                ESP_LOGI (TAG8, "mDNS stopped due to lost connection");
            }

            if (!s_wifi_sta_started || (current_time - attempt_start_time) * portTICK_PERIOD_MS >= CONNECT_ATTEMPT_TIME_MS) {
                esp_wifi_disconnect();

                const char * ssid     = NULL;
                const char * password = NULL;

                if (strlen (g_sta1_ssid) == 0 && strlen (g_sta2_ssid) == 0) {
                    if (!sta_mode_aborted) {
                        ESP_LOGE (TAG8, "Both SSIDs are empty. Aborting station mode connection attempts.");
                        sta_mode_aborted = true;
                    }
                }
                else {
                    sta_mode_aborted = false;  // Reset the flag if at least one SSID is available
                    if (current_ssid == 1 && strlen (g_sta1_ssid) > 0) {
                        ssid         = g_sta1_ssid;
                        password     = g_sta1_pass;
                        current_ssid = 2;
                    }
                    else if (strlen (g_sta2_ssid) > 0) {
                        ssid         = g_sta2_ssid;
                        password     = g_sta2_pass;
                        current_ssid = 1;
                    }
                    else {
                        current_ssid = (current_ssid == 1) ? 2 : 1;
                    }
                }

                if (ssid != NULL && !sta_mode_aborted) {
                    wifi_init_sta (ssid, password);
                    ESP_LOGI (TAG8, "Attempting connection to SSID: %s", ssid);
                    esp_err_t err = esp_wifi_connect();
                    if (err != ESP_OK) {
                        ESP_LOGE (TAG8, "Failed to initiate STA connection: %s", esp_err_to_name (err));
                    }
                    attempt_start_time = current_time;
                    retry_count        = 0;
                    wifi_state         = CONNECTING;
                }
                else {
                    vTaskDelay (pdMS_TO_TICKS (CONNECT_ATTEMPT_TIME_MS));
                }
            }
            break;

        case CONNECTING:
            if (wifi_connected) {
                wifi_state = CONNECTED;
                ESP_LOGI (TAG8, "Connection established");
            }
            else if (!s_wifi_sta_started || (current_time - attempt_start_time) * portTICK_PERIOD_MS >= CONNECT_ATTEMPT_TIME_MS) {
                wifi_state = NO_CONNECTION;
                ESP_LOGI (TAG8, "Connection attempt failed or timed out. Will try next SSID.");
            }
            break;

        case CONNECTED:
            if (!wifi_connected) {
                wifi_state = NO_CONNECTION;
                ESP_LOGI (TAG8, "All connections lost");
                attempt_start_time = current_time;  // Reset the timer for immediate attempt
                break;
            }

            // Periodic connection check
            if ((current_time - last_connection_check_time) * portTICK_PERIOD_MS >= CONNECTION_CHECK_INTERVAL_MS) {
                last_connection_check_time = current_time;

                wifi_ap_record_t ap_info;
                esp_err_t        err = esp_wifi_sta_get_ap_info (&ap_info);

                if (err == ESP_OK) {
                    ESP_LOGI (TAG8, "WiFi still connected to SSID: %s, RSSI: %d", ap_info.ssid, ap_info.rssi);
                }
                else {
                    ESP_LOGW (TAG8, "Failed to get AP info, error: %s", esp_err_to_name (err));

                    // Attempt to reconnect
                    err = esp_wifi_connect();
                    if (err != ESP_OK) {
                        ESP_LOGE (TAG8, "Failed to initiate reconnection: %s", esp_err_to_name (err));
                        wifi_state         = NO_CONNECTION;
                        attempt_start_time = current_time;
                    }
                    else {
                        ESP_LOGI (TAG8, "Reconnection attempt initiated");
                    }
                }
            }

            if (!mdns_started) {
                if (s_sta_connected) {  // Only start mDNS in station mode
                    static int mdns_retry_count = 0;
                    if (start_mdns_service()) {
                        mdns_started     = true;
                        mdns_retry_count = 0;
                        ESP_LOGI (TAG8, "mDNS service started");
                    }
                    else {
                        mdns_retry_count++;
                        ESP_LOGE (TAG8, "Failed to start mDNS service (attempt %d), will retry in 5 seconds", mdns_retry_count);
                        if (mdns_retry_count >= 3) {
                            ESP_LOGW (TAG8, "Multiple mDNS start failures, forcing WiFi reconnection");
                            wifi_state       = NO_CONNECTION;  // Force reconnection
                            mdns_retry_count = 0;
                        }
                        vTaskDelay (pdMS_TO_TICKS (5000));
                    }
                }
            }
            else {
                // Periodically verify mDNS is working
                static uint32_t last_mdns_check = 0;
                uint32_t        now             = xTaskGetTickCount();
                if ((now - last_mdns_check) * portTICK_PERIOD_MS >= 30000) {  // Check every 30 seconds
                    last_mdns_check = now;

                    esp_err_t err = mdns_service_instance_name_set ("_http", "_tcp", "SOTAcat SOTAmat Service");
                    if (err != ESP_OK) {
                        ESP_LOGW (TAG8, "mDNS service check failed, restarting service");
                        mdns_free();
                        mdns_started = false;
                    }
                }
            }

            if (!previously_connected) {
                xTaskNotify (config->setup_task_handle, config->notification_bit, eSetBits);
                previously_connected = true;
                ESP_LOGI (TAG8, "Initial connection established, setup task notified");
            }

            // Re-add the DHCP server reconfiguration logic
            if (s_ap_client_connected && !s_dhcp_configured) {
                esp_netif_ip_info_t ip_info;
                IP4_ADDR (&ip_info.ip, 192, 168, 4, 1);
                IP4_ADDR (&ip_info.gw, 0, 0, 0, 0);  // Set gateway to 0.0.0.0 to indicate no internet route
                IP4_ADDR (&ip_info.netmask, 255, 255, 255, 0);
                ESP_ERROR_CHECK (esp_netif_dhcps_stop (ap_netif));
                ESP_ERROR_CHECK (esp_netif_set_ip_info (ap_netif, &ip_info));
                ESP_ERROR_CHECK (esp_netif_dhcps_start (ap_netif));
                s_dhcp_configured = true;
                ESP_LOGI (TAG8, "AP mode: DHCP server reconfigured with non-routable gateway");
            }

            // Configure TCP keepalive
            if (s_sta_connected) {
                int sock = socket (AF_INET, SOCK_STREAM, IPPROTO_TCP);
                if (sock >= 0) {
                    int keepalive = 1;
                    int keepidle  = 5;  // Idle time before starting keepalive (seconds)
                    int keepintvl = 3;  // Interval between keepalive probes (seconds)
                    int keepcnt   = 3;  // Number of keepalive probes before disconnect

                    setsockopt (sock, SOL_SOCKET, SO_KEEPALIVE, &keepalive, sizeof (keepalive));
                    setsockopt (sock, IPPROTO_TCP, TCP_KEEPIDLE, &keepidle, sizeof (keepidle));
                    setsockopt (sock, IPPROTO_TCP, TCP_KEEPINTVL, &keepintvl, sizeof (keepintvl));
                    setsockopt (sock, IPPROTO_TCP, TCP_KEEPCNT, &keepcnt, sizeof (keepcnt));

                    close (sock);
                    ESP_LOGV (TAG8, "TCP keepalive configured");
                }
                else {
                    ESP_LOGW (TAG8, "Failed to create socket for keepalive configuration");
                }
            }

            break;
        }

        vTaskDelay (pdMS_TO_TICKS (333));
    }
}

void start_wifi_task (TaskNotifyConfig * config) {
    ESP_LOGV (TAG8, "trace: %s()", __func__);

    xTaskCreate (&wifi_task, "wifi_task", 4096, (void *)config, SC_TASK_PRIORITY_NORMAL, NULL);
}

bool is_wifi_connected () {
    return wifi_connected;
}

