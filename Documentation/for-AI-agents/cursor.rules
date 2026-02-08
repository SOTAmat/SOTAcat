# SOTAcat Documentation (Cursor)

This folder contains Cursor-focused notes for navigating the SOTAcat firmware repo. For user and developer docs, use the `Documentation/` tree.

## Project Overview

SOTAcat is ESP32-C3 firmware that serves an embedded web UI and REST API for wireless control of Elecraft radios. It connects to supported radios over serial CAT and provides a browser UI plus integration with the SOTAmat mobile app for FT8 self-spotting.

Supported radios:

- **Elecraft KX2**
- **Elecraft KX3**
- **Elecraft KH1**

## Technology Stack

- **Platform**: ESP32-C3 (Seeed XIAO ESP32C3) with ESP-IDF
- **Build System**: PlatformIO + Makefile wrapper targets
- **Language**: C++17 for firmware, HTML/CSS/JS for the web UI
- **Web Assets**: Gzip-compressed and embedded in the firmware binary
- **FT8 Encoder**: `lib/ft8_encoder`

## Repo Map

```text
SOTAcat/
|-- src/                     # Firmware source
|   |-- main.cpp             # Entry point
|   |-- webserver.cpp        # REST API + static asset server
|   |-- wifi.cpp             # WiFi/AP management
|   |-- kx_radio.cpp         # CAT protocol core
|   |-- radio_driver_*.cpp   # Radio-specific drivers (KX/KH1)
|   |-- handler_*.cpp        # REST API handlers
|   `-- web/                 # Embedded web UI (HTML/JS/CSS)
|-- include/                 # Public headers and interfaces
|-- lib/ft8_encoder/         # FT8 encoding library
|-- scripts/                 # Build helpers (asset compression)
|-- test/                    # Unit + integration tests
|-- Documentation/           # Canonical user/dev docs
|-- platformio.ini           # PlatformIO configuration
|-- sdkconfig.seeed_xiao_esp32c3_*  # ESP-IDF configs
`-- partition_definitions/   # Partition tables
```

## Key Features

- **Embedded Web UI**: RUN, CHASE, QRX, Settings, About pages for phone browsers
- **REST API**: Frequency/mode/bandwidth, keyer, TX toggle, status, time, settings, ATU, volume, OTA, battery
- **FT8 Synthesis**: Prepare/schedule/tx sequences from the device
- **SOTAmat Integration**: App-driven FT8 self-spot workflows
- **Power + Battery**: MAX17260 fuel gauge, idle status, deep sleep support

## Core Firmware Areas

- **Web server + API handlers**: `src/webserver.cpp`, `src/handler_*.cpp`
- **Radio drivers**: `src/radio_driver_kx*`, `src/radio_driver_kh1*`
- **CAT protocol core**: `src/kx_radio.cpp`
- **FT8**: `src/handler_ft8.cpp`, `lib/ft8_encoder/`
- **Battery + power**: `src/battery_monitor.cpp`, `src/max17260.cpp`, `src/enter_deep_sleep.cpp`
- **Web UI assets**: `src/web/*` (embedded via build scripts)

## Build and Flash

See `Documentation/dev/BUILD.md` for full detail. Quick examples:

```bash
make build
make upload
make ota-upload
```

PlatformIO environments:

- `seeed_xiao_esp32c3_debug`
- `seeed_xiao_esp32c3_release`

## Testing

- **Unit tests**: `test/unit/` (web UI logic)
- **Integration/perf tests**: `test/integration/` (Python harness)

## Related Docs

- Developer: `Documentation/dev/BUILD.md`, `Documentation/dev/Architecture.md`, `Documentation/dev/Web-UI.md`
- User: `Documentation/user/Getting-Started.md`, `Documentation/user/UI-Tour.md`, `Documentation/user/Troubleshooting.md`
