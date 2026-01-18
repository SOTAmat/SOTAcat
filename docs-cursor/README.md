# SOTAcat Documentation

This folder contains Cursor-specific documentation for the SOTAcat firmware project.

## Project Overview

SOTAcat is an ESP32 firmware project that provides a bridge between the SotamatApp mobile application and Elecraft KX2/KX3 transceivers. The firmware runs on an ESP32 module and communicates via:

- **WiFi REST API**: With SotamatApp mobile application
- **Serial CAT Protocol**: With Elecraft KX2/KX3 transceivers

## Technology Stack

- **Platform**: ESP32 (ESP-IDF framework)
- **Build System**: PlatformIO / ESP-IDF
- **Language**: C++ (C++17)
- **Hardware**: ESP32-C3 (Seeed XIAO ESP32C3)

## Project Structure

```
SOTAcat/
├── src/                     # Source code
│   ├── main.cpp            # Entry point
│   ├── webserver.cpp       # REST API server
│   ├── wifi.cpp            # WiFi management
│   ├── kx_radio.cpp        # Elecraft CAT communication
│   ├── handler_*.cpp       # REST API handlers
│   └── web/                # Web UI files (HTML/JS/CSS)
├── include/                # Header files
│   ├── webserver.h
│   ├── wifi.h
│   ├── kx_radio.h
│   └── ...
├── platformio.ini          # PlatformIO configuration
├── sdkconfig.*             # ESP-IDF configuration files
└── partition_definitions/  # Partition table definitions
```

## Key Features

### REST API Endpoints

The firmware exposes REST API endpoints for:
- **CAT Control**: Frequency, mode, bandwidth settings
- **FT8 Transmission**: Schedule and send FT8 messages
- **Status**: Query transceiver and device status
- **Settings**: Configure device parameters
- **OTA Updates**: Over-the-air firmware updates
- **Battery Monitoring**: Battery status and management

### Core Components

- **Web Server**: HTTP server for REST API and web UI
- **WiFi Manager**: WiFi connection and access point management
- **KX Radio Interface**: Elecraft CAT protocol implementation
- **FT8 Handler**: FT8 message generation and transmission
- **Battery Monitor**: MAX17260 fuel gauge integration

### Hardware Integration

- **Elecraft KX2/KX3**: Connected via ACC serial port (CAT protocol)
- **MAX17260**: Battery fuel gauge IC
- **ESP32-C3**: Main microcontroller (Seeed XIAO ESP32C3)

## Build and Flash

### Using PlatformIO

```bash
# Build for Seeed XIAO ESP32C3
pio run -e seeed_xiao_esp32c3_release

# Upload firmware
pio run -e seeed_xiao_esp32c3_release -t upload

# Monitor serial output
pio device monitor
```

### Build Configurations

- `seeed_xiao_esp32c3_debug`: Debug build with logging
- `seeed_xiao_esp32c3_release`: Release build optimized for production

## Integration with SotamatApp

The firmware communicates with SotamatApp via REST API over WiFi:
- SotamatApp discovers SOTACAT device on local network
- REST API calls control transceiver and schedule FT8 messages
- Real-time status updates via API polling

For integration details with SotamatApp, see the workspace documentation at `../docs-cursor/workspace/README.md` (when workspace is open) or the SotamatApp project documentation.

## CAT Protocol

The firmware implements Elecraft CAT protocol commands:
- Frequency setting and querying
- Mode selection (SSB, CW, FT8, etc.)
- Bandwidth control
- Status queries
- VFO control

## FT8 Message Transmission

The firmware can:
- Generate FT8 messages based on SOTA/POTA spot data
- Schedule transmission at coordinated times
- Control transceiver to send messages
- Handle timing synchronization

## Configuration Files

- `platformio.ini`: PlatformIO build configuration
- `sdkconfig.defaults`: Default ESP-IDF configuration
- `sdkconfig.seeed_xiao_esp32c3_*`: Platform-specific configurations
- Partition tables: Define flash memory layout

## Development Notes

- WiFi power levels are reduced to minimize interference with HF bands
- Boot logging is disabled to avoid confusing Elecraft radios
- Deep sleep support for battery conservation
- OTA update capability for field updates

