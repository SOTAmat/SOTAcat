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
- `PUT /api/v1/keyer?message=<text>` — Send text as CW, or as RTTY/PSK31 when the radio is already in DATA mode with FSK-D or PSK-D sub-mode
- `PUT /api/v1/xmit` — Toggle TX
- See `src/` for full endpoint list

### Radio service and async handlers
`esp_http_server` runs every request on **one task**, so radio CAT I/O never
happens in a handler. A dedicated **radio service task** (`src/radio_service.cpp`)
owns CAT I/O for the HTTP layer: handlers read a mutex-guarded **snapshot** or
drop a command in a per-type **slot** (newest-wins; volume deltas accumulate),
and — when they need the radio's answer — **park** the request
(`httpd_req_async_handler_begin`, `src/radio_park_httpd.cpp`) so the server
task carries on while the worker completes it. Link health (3 consecutive CAT
failures → down, first success → up) drives ⚫ and the 503 fast-path. FT8
transmission holds the radio mutex directly and the worker yields to it.

Radio endpoint contract (`frequency`, `mode`, `connectionStatus`, `volume`, `atu`):

| Case | Response |
|------|----------|
| GET, radio healthy | bare-text value ≤~300 ms old (parks up to 300 ms for a refresh) |
| GET during FT8 | last-known value, instantly |
| GET, radio link down | `503` "radio link down" (instant; the header's `connectionStatus` shows ⚫). API clients that poll only `frequency`/`mode` (SOTAmat) get an honest signal instead of a stale value |
| PUT applied | `204 No Content` |
| PUT refused by radio | `500` |
| PUT confirmation slower than 1.5 s | `202 Accepted` — confirm via a later GET |
| PUT superseded by a newer same-kind PUT | `202` "superseded" |
| PUT, radio link down | `503` "radio link down" (synchronous) |
| PUT during FT8 | `503` "radio busy (FT8)" (synchronous) |
| PUT bad parameter | `404` / `500` |
| PUT then immediate GET | reads the new value |

Background, timelines (simple, overlapped, radio-off, FT8, lock contention), the
link-health state machine, budgets, validation record and known limitations:
[Radio-Access.md](Radio-Access.md). Contract test:
`test/integration/test_radio_contract.py` (runs against hardware or the mock).

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

### Key Web Modules

The web UI is a small set of focused JS modules. See [Web-UI.md](Web-UI.md) for APIs and implementation notes.

- **`spots.js`** — single source of truth for spot data. Owns fetch, localStorage cache, rate-limit/dedup, auto-refresh, and a subscribe/notify channel that any page (CHASE, RUN, ...) reads from.
- **`bandprivileges.js`** — FCC privilege tables (HF + VHF/UHF), mode categories, bandwidth/edge helpers, and `MODE_SNAP_HZ` used by drag-to-tune.
- **`main.js`** — `tuneRadioHz()` (band/mode-aware tune; SSB auto-sideband by frequency), `RADIO_CAPABILITIES` (per-radio native band/mode table), `AppState` (including the opt-out `filterBandsEnabled` for CHASE).
- **`run.js`** — band-range chart, spot-tick rendering on the chart, drag-to-tune (mouse) / tap-to-jump (touch), tap-to-tune on spot ticks.
- **`chase.js`** — spot list + scan; consumes `spots.js`, applies optional radio-band filter.

### Radio Capabilities and Transverters

`main.js` holds `RADIO_CAPABILITIES`, a per-radio table of native bands and modes (KX2 / KX3 / KH1; unknown radios = `null` = permissive). It's read by:

- The CHASE band filter (`AppState.filterBandsEnabled`, default on, exposed in Settings as "Show only bands my radio can access") — opt-out so transverter users can disable it.
- Helper `getRadioBands(radioType, requireTx)` lists a radio's bands; the chase band filter consumes it.

The run-page band/mode buttons are deliberately **not** gated by this table — gating them would lock out users running transverters.

### Firmware Distribution

GitHub Releases is the authoritative firmware source (#100). The OTA flow and the `make github-release` target both target the project's Releases page directly; mirrors are not trusted.

## Source Layout

```
src/
├── main.cpp           # Entry point
├── web/               # Embedded web assets
│   ├── *.html
│   ├── *.js           # spots.js, run.js, chase.js, main.js, settings.js, ...
│   └── *.css
├── ...                # CAT, API, FT8 code
```

Any new file added under `src/web/` must be wired in *two* places — see [Web-UI.md → Asset Pipeline](Web-UI.md#asset-pipeline).

---

[← BUILD](BUILD.md) · [Web UI →](Web-UI.md)

