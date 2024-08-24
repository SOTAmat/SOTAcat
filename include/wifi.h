#pragma once

#include "setup.h"
#include <stdbool.h>

#ifdef __cplusplus
extern "C" {
#endif

/**
 * @brief Initialize the WiFi subsystem in APSTA mode.
 *
 * This function sets up both the Access Point (AP) and Station (STA) modes,
 * configures the event handlers, and starts the WiFi system.
 */
void wifi_init (void);

/**
 * @brief Start the mDNS service.
 *
 * This function initializes and starts the mDNS (multicast DNS) service,
 * also known in the Apple world as the Bonjour service,
 * allowing the device to be discoverable on the local network with a name
 * in the form of <hostname>.local.
 */
bool start_mdns_service (void);

/**
 * @brief Start the WiFi task.
 *
 * This function creates and starts a FreeRTOS task that manages WiFi operations,
 * including initialization, connection management, and mDNS service startup.
 *
 * @param config Pointer to a TaskNotifyConfig structure containing task notification details.
 */
void start_wifi_task (TaskNotifyConfig * config);

/**
 * @brief Check if WiFi is connected.
 *
 * This function returns the current WiFi connection status.
 *
 * @return true if WiFi is connected (either in STA mode or AP mode with a client connected), false otherwise.
 */
bool is_wifi_connected (void);

#ifdef __cplusplus
}
#endif