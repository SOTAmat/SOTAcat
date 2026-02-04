# Architecture

**Who this is for:** Developers wanting to understand the codebase

## System Overview

```
┌─────────────┐     WiFi      ┌─────────────┐     CAT      ┌─────────────┐
│   Browser   │◄────────────►│   SOTAcat   │◄────────────►│  KX2/KX3/KH1 │
│   (Phone)   │    HTTP       │   (ESP32)   │    Serial    │   Radio    │
└─────────────┘               └─────────────┘               └─────────────┘
                                    │
                                    ▼
                              ┌─────────────┐
                              │  SOTAmat    │
                              │   (App)     │
                              └─────────────┘
```

## Key Components

### Web Server
- ESP32 serves embedded web UI
- Assets gzip-compressed (`.htmlgz`, `.jsgz`, `.cssgz`)
- REST API for all radio/device operations

### REST API
- `GET/PUT /api/v1/frequency` — VFO frequency
- `GET/PUT /api/v1/mode` — Operating mode
- `GET/PUT /api/v1/power` — TX power
- `PUT /api/v1/keyer?message=<text>` — Send CW
- `PUT /api/v1/xmit` — Toggle TX
- See `src/` for full endpoint list

### CAT Driver
- Serial communication with Elecraft radio
- 38400 baud default (KX2 / KX3)
- 9600 baud default (KH1)
- Handles command/response protocol

### FT8 Synthesis
- Direct FSK generation via VFO manipulation
- No audio required
- Computes and transmits 15-second FT8 sequence
- API: `/api/v1/prepareft8`, `/api/v1/ft8`, `/api/v1/cancelft8`

### SOTAmat Integration
- Bidirectional communication with SOTAmat app
- App can read/set frequency, mode
- Triggers FT8 self-spot sequence

## Source Layout

```
src/
├── main.cpp           # Entry point
├── web/               # Embedded web assets
│   ├── *.html
│   ├── *.js
│   └── *.css
├── ...                # CAT, API, FT8 code
```

---

[← BUILD](BUILD.md) · [Web UI →](Web-UI.md)

