#include "esp_log.h"
#include "esp_wifi.h"
#include "globals.h"
#include "lwip/ip4_addr.h"
#include "mdns.h"
#include "settings.h"
#include "wifi.h"

static int s_retry_num = 0;
static bool s_connected = false;

void wifi_init_ap()
{
    ESP_LOGI(TAG, "Initializing WiFi in AP mode");

    esp_netif_t *ap_netif = esp_netif_create_default_wifi_ap();

    wifi_config_t wifi_config = {
        .ap = {
            .ssid = "SOTAcat",
            .ssid_len = strlen("SOTAcat"),
            .channel = 1,
            .password = "12345678",
            .max_connection = 4,
            .authmode = WIFI_AUTH_WPA_WPA2_PSK},
    };

    if (strlen("12345678") == 0)
    {
        wifi_config.ap.authmode = WIFI_AUTH_OPEN;
    }

    ESP_ERROR_CHECK(esp_wifi_set_mode(WIFI_MODE_AP));
    ESP_ERROR_CHECK(esp_wifi_set_config(WIFI_IF_AP, &wifi_config));
    ESP_ERROR_CHECK(esp_wifi_start());

    // Configure DHCP server
    ESP_LOGI(TAG, "Configuring DHCP server");
    esp_netif_ip_info_t info;
    memset(&info, 0, sizeof(info));
    IP4_ADDR(&info.ip, 192, 168, 4, 1);
    IP4_ADDR(&info.gw, 0, 0, 0, 0); // Zero gateway address
    IP4_ADDR(&info.netmask, 255, 255, 255, 0);
    esp_netif_dhcps_stop(ap_netif); // Stop DHCP server before setting new IP info
    esp_netif_set_ip_info(ap_netif, &info);
    esp_netif_dhcps_start(ap_netif); // Restart DHCP server with new settings

    s_connected = true;
    ESP_LOGI(TAG, "Wi-Fi AP set up complete");
}

// ====================================================================================================
void wifi_init_sta()
{
    s_retry_num = 0;
    s_connected = false;

    ESP_LOGI(TAG, "Initializing WiFi in STA mode");

    esp_netif_create_default_wifi_sta();

    wifi_init_config_t cfg = WIFI_INIT_CONFIG_DEFAULT();
    ESP_ERROR_CHECK(esp_wifi_init(&cfg));
    ESP_ERROR_CHECK(esp_wifi_set_mode(WIFI_MODE_STA));

    wifi_config_t wifi_config = {
        .sta = {
            .ssid = WIFI_STA_SSID,
            .password = WIFI_STA_PASS},
    };

    ESP_ERROR_CHECK(esp_wifi_set_config(ESP_IF_WIFI_STA, &wifi_config));
    ESP_ERROR_CHECK(esp_wifi_start());

    ESP_LOGI(TAG, "============ Connecting to WiFi...");
    ESP_ERROR_CHECK(esp_wifi_connect());
}

// ====================================================================================================
static void wifi_event_handler(void *arg, esp_event_base_t event_base,
                               int32_t event_id, void *event_data)
{
    ESP_LOGI(TAG, "WiFi event handler called with event_base: %s, event_id: %ld", event_base, event_id);

    if (event_base == WIFI_EVENT && event_id == WIFI_EVENT_STA_DISCONNECTED)
    {
        if (!s_connected && s_retry_num < MAX_RETRY_WIFI_STATION_CONNECT)
        {
            ESP_LOGI(TAG, "Retrying to connect to the WiFi network...");
            s_retry_num++;
            esp_wifi_connect();
        }
        else
        {
            ESP_LOGI(TAG, "============ Failed to connect to home WiFi, setting up stand-alone AP mode...");
            wifi_init_ap(); // Switch to AP mode
        }
    }
    else if (   (event_base == IP_EVENT && event_id == IP_EVENT_STA_GOT_IP) ||
                (event_base == WIFI_EVENT && event_id == WIFI_EVENT_STA_CONNECTED))
    {
        s_connected = true;
        s_retry_num = 0;
        ESP_LOGI(TAG, "============ Success connecting to existing WiFi network...");
    }
}

// ====================================================================================================
void wifi_init()
{
    s_connected = false;

    // Initialize the TCP/IP stack
    ESP_ERROR_CHECK(esp_netif_init());
    ESP_ERROR_CHECK(esp_event_loop_create_default());

    // Register event handler for Wi-Fi events
    ESP_ERROR_CHECK(esp_event_handler_register(WIFI_EVENT, ESP_EVENT_ANY_ID, &wifi_event_handler, NULL));

    wifi_init_sta(); // Start by trying to connect to the Wi-Fi network
    // If the timer expires, we will switch to AP mode using the event handler to detect the failure

    // Wait here for a successful connection to the Wi-Fi network: either as a station or as an AP.
    while (!s_connected)
    {
        vTaskDelay(pdMS_TO_TICKS(500));
    }
    ESP_LOGI(TAG, "WiFi initialization complete, returning.");
}

// ====================================================================================================
void start_mdns_service()
{
    // Initialize mDNS service
    ESP_ERROR_CHECK(mdns_init());

    // Set the hostname
    ESP_ERROR_CHECK(mdns_hostname_set("sotacat"));

    // Set the default instance
    ESP_ERROR_CHECK(mdns_instance_name_set("SOTAcat SOTAmat Service"));

    // You can also add services to announce
    mdns_service_add(NULL, "_http", "_tcp", 80, NULL, 0);
}