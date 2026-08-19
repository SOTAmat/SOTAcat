# SOTAcat Mock API Server

Simulates the SOTAcat device API for offline UI development and testing.

## Usage

From this directory, use any of these methods:

```bash
# Using uv (recommended - auto-installs dependencies)
uv run server.py

# Using pipx (auto-installs dependencies)
pipx run server.py

# Using pip (manual install)
pip install flask flask-cors
python server.py
```

With options:

```bash
uv run server.py --port 8080 --web-dir ../../src/web
```

Then open http://localhost:8080 in your browser.

## Features

- Serves the web UI static files
- Mocks all `/api/v1/*` endpoints with stateful behavior
- PUT/POST requests update the mock state
- Debug endpoints to inspect/modify state

## API Endpoints

### Device State
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/v1/version` | Firmware version string |
| GET | `/api/v1/frequency` | Current VFO frequency (bare text, Hz) |
| PUT | `/api/v1/frequency?frequency=X` | Set frequency (Hz) → 204 / 202 / 500 / 503 / 404 |
| GET | `/api/v1/mode` | Current mode (bare text) |
| PUT | `/api/v1/mode?mode=X` | Set mode (CW, USB, LSB, SSB=auto sideband, …) |
| GET | `/api/v1/batteryInfo` | Battery information (JSON) |
| GET | `/api/v1/rssi` | WiFi signal strength |
| GET | `/api/v1/connectionStatus` | Radio link glyph: ⚫ down · ⚪ FT8/unknown · 🔴 TX · 🟢 idle |

### Radio Control
| Method | Endpoint | Description |
|--------|----------|-------------|
| PUT | `/api/v1/power?power=X` | Set power (0 or 15) |
| PUT | `/api/v1/xmit?state=X` | TX toggle (0=RX, 1=TX) |
| PUT | `/api/v1/msg?bank=X` | Play CW message (1, 2, or 3) |
| PUT | `/api/v1/keyer?message=X` | Send CW text |
| PUT | `/api/v1/atu` | Trigger ATU tune → 204 / 202 / 503 |
| PUT | `/api/v1/volume?delta=X` | Adjust volume → 204 / 202 / 503 |

The radio endpoints follow the firmware's async-handler contract
(`docs/dev/Radio-Access.md`): GETs answer within ~300 ms with a fresh or
last-known value, or 503 while the radio link is down; PUTs return 204 once
the (simulated) radio confirmed, 202 if confirmation outran 1.5 s or a newer
same-kind PUT superseded it, 503 while the link is down or FT8 holds the
radio. Tune the emulation with `--radio-latency MS` / `--radio-dead`, or live:

```bash
curl -X POST http://localhost:8080/api/v1/_debug/state \
  -H "Content-Type: application/json" \
  -d '{"radio_dead": true}'          # or {"radio_latency_ms": 2000} / {"ft8": true}
```

`test/integration/test_radio_contract.py` asserts this contract against
either the mock or real hardware (`make -C test/integration test-contract-mock`).

The mock also serves the firmware's rigctld face (Hamlib NET rigctl,
`src/rigctld_server.cpp`) on TCP `--rigctld-port` (default 4532; 0 disables):
one client at a time, GETs from the same simulated radio state, SETs through
the same queue as HTTP PUTs, `RPRT -6` while the link is down and `-9` during
FT8. `test/integration/test_rigctld.py` asserts that contract against the
mock or hardware (`make -C test/integration test-rigctld-mock`).

### Settings
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET/POST | `/api/v1/callsign` | Operator callsign |
| GET/POST | `/api/v1/gps` | GPS location override |
| GET/POST | `/api/v1/tuneTargets` | WebSDR/KiwiSDR targets |
| GET/POST | `/api/v1/settings` | WiFi configuration |
| PUT | `/api/v1/time?time=X` | Sync device time |

### Debug (Mock Server Only)
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/v1/_debug/state` | View all mock state |
| POST | `/api/v1/_debug/state` | Modify mock state |
| POST | `/api/v1/_debug/reset` | Reset to defaults |

## Testing Scenarios

### Simulate low battery
```bash
curl -X POST http://localhost:8080/api/v1/_debug/state \
  -H "Content-Type: application/json" \
  -d '{"battery": 15}'
```

### Simulate poor WiFi signal
```bash
curl -X POST http://localhost:8080/api/v1/_debug/state \
  -H "Content-Type: application/json" \
  -d '{"rssi": -85}'
```

### Simulate different frequency/mode
```bash
curl -X POST http://localhost:8080/api/v1/_debug/state \
  -H "Content-Type: application/json" \
  -d '{"frequency": 7074000, "mode": "DATA"}'
```

### Reset to defaults
```bash
curl -X POST http://localhost:8080/api/v1/_debug/reset
```
