# WiFi Connection Fixes Summary

## Issues Identified and Fixed

### 1. **DHCP Server Management (IDF Bug GH-6108/GH-6289)**
**Problem**: The code was stopping and restarting the DHCP server multiple times after initial configuration. There's a known ESP-IDF bug where calling `esp_netif_dhcps_stop()` after the driver is running can leave the DHCP task in STOPPED state even though the API returns ESP_OK.

**Fix**: 
- Initialize the DHCP server once during `wifi_init_softap()` and leave it running
- Always stop DHCP server first since ESP-IDF starts it automatically when creating default AP netif
- Removed DHCP reconfiguration in event handlers
- The 0.0.0.0 gateway configuration is set once and maintained

**Boot Loop Fix**: The initial fix caused a boot loop because we were trying to configure the DHCP server before WiFi was started. Fixed by reordering initialization to call `wifi_init_softap()` after `esp_wifi_start()`.

### 2. **STA Scanning Interference**
**Problem**: The ESP32 was continuously attempting to scan and connect to configured SSIDs even when serving AP clients, causing interference with AP operations.

**Fix**:
- Prevented STA connection attempts when AP clients are connected
- Added 30-second grace period after AP client disconnects before resuming STA scanning
- This prevents the ESP32 from doing concurrent STA/AP operations that can interfere

### 3. **TX Power Level**
**Problem**: The TX power was set to 11dBm which might be too low for reliable initial connections during the association phase.

**Fix**:
- Increased TX power from 11dBm (level 44) to 13dBm (level 52)
- This provides 2dB more power for more reliable initial connections
- Still low enough to minimize interference with the Elecraft receiver

### 4. **State Management**
**Problem**: Various state flags weren't properly managed, leading to race conditions.

**Fix**:
- Properly track DHCP configuration state
- Better tracking of AP client disconnect times
- Improved mDNS service lifecycle management

## Additional Recommendations

### 1. **WiFi Channel Selection**
Consider making the AP channel configurable or implementing automatic channel selection to avoid crowded channels:
```c
// In wifi_init_softap(), instead of fixed channel 1:
ap_config.channel = find_best_channel(); // or make it configurable
```

### 2. **Connection Retry Logic**
If issues persist, consider implementing exponential backoff for connection retries:
```c
static int retry_delay = 1000;
if (connection_failed) {
    vTaskDelay(pdMS_TO_TICKS(retry_delay));
    retry_delay = MIN(retry_delay * 2, 30000); // Max 30 seconds
}
```

### 3. **Enhanced Diagnostics**
Add more diagnostic information when connections fail:
```c
case WIFI_EVENT_AP_STADISCONNECTED:
    wifi_event_ap_stadisconnected_t *event = (wifi_event_ap_stadisconnected_t *)event_data;
    ESP_LOGI(TAG8, "Station disconnected, reason: %d", event->reason);
    // Log specific disconnect reasons for debugging
```

### 4. **iPhone-Specific Optimizations**
Consider these iPhone-specific optimizations:
- Ensure beacon interval is optimal (100ms is good)
- PMF (Protected Management Frames) is already enabled which helps with iOS devices
- The WPA3 SAE support is beneficial for newer iOS versions

### 5. **Alternative Split Networking Approach**
While the 0.0.0.0 gateway is the standard approach for split networking on iOS, you could also consider:
- Using a link-local gateway address (169.254.x.x) instead of 0.0.0.0
- Implementing a captive portal detection bypass

## Testing Recommendations

1. **Monitor DHCP Activity**: Use ESP32 debug logs to verify DHCP offers are being sent:
   ```
   esp_log_level_set("dhcps", ESP_LOG_DEBUG);
   ```

2. **Check Signal Strength**: Have users report RSSI values when connected to verify if 13dBm is sufficient

3. **Long-term Stability**: Test with iPhone connected for extended periods (hours) to ensure stability

4. **Interference Testing**: Verify the 13dBm power level doesn't cause unacceptable interference with the radio

## Expected Behavior After Fixes

1. DHCP server starts once and remains running
2. No STA scanning occurs while AP clients are connected
3. 30-second delay after AP client disconnects before STA scanning resumes
4. More reliable initial connections due to increased TX power
5. Stable long-term connections with proper TCP keepalive 