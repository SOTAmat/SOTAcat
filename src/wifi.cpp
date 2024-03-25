#include <esp_wifi.h>
#include <lwip/ip4_addr.h>
#include <mdns.h>
#include "settings.h"
#include "wifi.h"

#include <esp_log.h>
static const char * TAG8 = "sc:wifi....";

static int  s_client_trial = 0;     // client currently undergoing connection; 1 or 2 representing g_sta's
static int  s_retry_num    = 0;     // connection retry of current client
static bool s_connected    = false;

static void wifi_init_ap()
{
    ESP_LOGV(TAG8, "trace: %s()", __func__);

    esp_netif_t *ap_netif = esp_netif_create_default_wifi_ap();

    wifi_config_t wifi_config = { };
    memset(&wifi_config, 0, sizeof(wifi_config_t));

    ESP_LOGI(TAG8, "wifi ap ssid: %s", g_ap_ssid);
    strcpy((char *)wifi_config.ap.ssid, g_ap_ssid);
    wifi_config.ap.ssid_len = (uint8_t)strlen(g_ap_ssid);
    if (strlen(g_ap_pass) == 0)
        wifi_config.ap.authmode = WIFI_AUTH_OPEN;
    else
        strcpy((char *)wifi_config.ap.password, g_ap_pass);
    wifi_config.ap.channel = 1;
    wifi_config.ap.authmode = WIFI_AUTH_WPA_WPA2_PSK;
    wifi_config.ap.max_connection = 6;

    ESP_ERROR_CHECK(esp_wifi_set_mode(WIFI_MODE_AP));
    ESP_ERROR_CHECK(esp_wifi_set_config(WIFI_IF_AP, &wifi_config));
    ESP_ERROR_CHECK(esp_wifi_start());

    // Configure DHCP server
    ESP_LOGI(TAG8, "configuring dhcp server.");
    esp_netif_ip_info_t info = { };
    memset(&info, 0, sizeof(esp_netif_ip_info_t));
    IP4_ADDR(&info.ip, 192, 168, 4, 1);
    IP4_ADDR(&info.gw, 0, 0, 0, 0);  // zero gateway address
    IP4_ADDR(&info.netmask, 255, 255, 255, 0);
    esp_netif_dhcps_stop(ap_netif);  // stop DHCP server before setting new IP info
    esp_netif_set_ip_info(ap_netif, &info);
    esp_netif_dhcps_start(ap_netif); // restart DHCP server with new settings

    s_connected = true;
    ESP_LOGI(TAG8, "wifi ap setup complete.");
}

// ====================================================================================================
static void wifi_init_sta(const char * ssid, const char * password)
{
    ESP_LOGV(TAG8, "trace: %s(ssid = '%s')", __func__, ssid);

    s_retry_num = 0;
    s_connected = false;

    if (s_client_trial < 2) // we haven't tried an earlier client; need first-time initialization in STA mode
        esp_netif_create_default_wifi_sta();

    wifi_config_t wifi_config = { };
    memset(&wifi_config, 0, sizeof(wifi_config));
    strcpy((char *)wifi_config.sta.ssid, ssid);
    strcpy((char *)wifi_config.sta.password, password);

    ESP_ERROR_CHECK(esp_wifi_set_mode(WIFI_MODE_STA));
    ESP_ERROR_CHECK(esp_wifi_set_config(WIFI_IF_STA, &wifi_config));
    ESP_ERROR_CHECK(esp_wifi_start());

    ESP_LOGI(TAG8, "connecting to wifi");
    ESP_ERROR_CHECK(esp_wifi_connect());
}

// ====================================================================================================
static void wifi_event_handler(void *arg,
                               esp_event_base_t event_base,
                               int32_t event_id,
                               void *event_data)
{
    ESP_LOGV(TAG8, "trace: %s(event_base = '%s', event_id = %ld)", __func__, event_base, event_id);

    if (event_base == WIFI_EVENT && event_id == WIFI_EVENT_STA_DISCONNECTED)
    {
        if (!s_connected)
        {
            if (s_retry_num < MAX_RETRY_WIFI_STATION_CONNECT)
            {
                ESP_LOGI(TAG8, "retrying to connect to the wifi network");
                s_retry_num++;
                esp_wifi_connect();
            }
            else if (s_client_trial < 2 && strlen(g_sta2_ssid) > 0) {
                ESP_LOGI(TAG8, "switching to connect to the second wifi network");
                s_client_trial = 2;
                wifi_init_sta(g_sta2_ssid, g_sta2_pass); // start by trying to connect to the Wi-Fi network
            }
            else
            {
                ESP_LOGI(TAG8, "failed to connect as client to network, setting up access-point mode");
                wifi_init_ap(); // Switch to AP mode
            }
        }
        else
        {
            // formerly connected, but now getting a disconnected event => must be entering sleep
            ESP_LOGI(TAG8, "disconnected from wifi network");
            s_connected = false;
            s_retry_num = 0;
        }
    }
    else if ((event_base == IP_EVENT && event_id == IP_EVENT_STA_GOT_IP) ||
             (event_base == WIFI_EVENT && event_id == WIFI_EVENT_STA_CONNECTED))
    {
        s_connected = true;
        s_retry_num = 0;
        ESP_LOGI(TAG8, "connected as client to existing wifi network.");
    }
}

// ====================================================================================================
// Set wifi TX power level down a bit to reduce battery load and avoid radio interference.
static void wifi_attenuate_power()
{
    ESP_LOGV(TAG8, "trace: %s()", __func__);

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
    ESP_ERROR_CHECK(esp_wifi_get_max_tx_power(&curr_wifi_power));
    ESP_LOGI(TAG8, "default max tx power: %d", curr_wifi_power);

    const int8_t MAX_TX_PWR = 44; // level 5 - 2dBm = 11dBm, per chart above
    ESP_LOGI(TAG8, "setting wifi max power to %d", MAX_TX_PWR);
    ESP_ERROR_CHECK(esp_wifi_set_max_tx_power(MAX_TX_PWR));

    ESP_ERROR_CHECK(esp_wifi_get_max_tx_power(&curr_wifi_power));
    ESP_LOGI(TAG8, "confirmed new max tx power: %d", curr_wifi_power);
}

// ====================================================================================================
void wifi_init()
{
    ESP_LOGV(TAG8, "trace: %s()", __func__);

    s_connected = false;

    // Initialize the TCP/IP stack
    ESP_ERROR_CHECK(esp_netif_init());

    ESP_ERROR_CHECK(esp_event_loop_create_default());

    // Register event handler for Wi-Fi events
    ESP_ERROR_CHECK(esp_event_handler_register(WIFI_EVENT, ESP_EVENT_ANY_ID, &wifi_event_handler, NULL));

    // Basic initialization common to all STA and AP modes
    wifi_init_config_t cfg = WIFI_INIT_CONFIG_DEFAULT();
    ESP_ERROR_CHECK(esp_wifi_init(&cfg));

    // Pick the "best" initial network and try to connect
    // If the event handler detects too many connection retries, it will progress
    // to the next best network
    if (strlen(g_sta1_ssid) > 0)
    {
        s_client_trial = 1; // use first of two possible STA clients
        wifi_init_sta(g_sta1_ssid, g_sta1_pass); // start by trying to connect to the Wi-Fi network
    }
    else if (strlen(g_sta2_ssid) > 0)
    {
        s_client_trial = 1; // use second of two possible STA clients
        wifi_init_sta(g_sta2_ssid, g_sta2_pass); // start by trying to connect to the Wi-Fi network
    }
    else
        wifi_init_ap();

    wifi_attenuate_power();

    // Wait here for a successful connection to the Wi-Fi network: either as a station or as an AP.
    while (!s_connected)
        vTaskDelay(pdMS_TO_TICKS(500));

    ESP_LOGI(TAG8, "wifi initialization complete.");
}

// ====================================================================================================
void start_mdns_service()
{
    ESP_LOGV(TAG8, "trace: %s()", __func__);

    // Initialize mDNS service
    ESP_ERROR_CHECK(mdns_init());

    // Set the hostname
    ESP_ERROR_CHECK(mdns_hostname_set("sotacat"));

    // Set the default instance
    ESP_ERROR_CHECK(mdns_instance_name_set("SOTAcat SOTAmat Service"));

    // You can also add services to announce
    mdns_service_add(NULL, "_http", "_tcp", 80, NULL, 0);
}
