# Web UI Development

**Who this is for:** Developers modifying the web interface

## Asset Pipeline

Web assets in `src/web/` are:
1. Gzip-compressed during build
2. Converted to C byte arrays
3. Embedded in firmware binary
4. Served by ESP32 web server

## File Structure

```
src/web/
├── index.html         # Main SPA shell
├── qrx.html           # QRX tab content
├── chase.html         # CHASE tab content
├── run.html           # RUN tab content
├── settings.html      # Settings tab content
├── about.html         # About tab content
├── main.js            # Core app logic
├── qrx.js             # QRX functionality
├── chase.js           # CHASE functionality
├── chase_api.js       # Spothole API client
├── run.js             # RUN functionality
├── settings.js        # Settings functionality
├── style.css          # All styling
└── bandprivileges.js  # FCC band data
```

### Radio capability model

`main.js` owns `RADIO_NATIVE_BANDS` (per-radio hardcoded native bands) and
`CapabilityState` (native ∪ learned, with per-band last-observed frequency).
Auto-learn fires only from radio-confirmed `FA` polls, never from PUT paths.
Learned state persists in localStorage keyed by radio type
(`sotacat_learned_bands_KX2`, etc.), so multiple radios sharing one SOTAcat
keep independent learned sets. See
`Documentation/for-AI-agents/specs/2026-04-21-transverter-awareness-design.md`
for the full design rationale.

## UI → API Mapping

| User Action | API Call |
|-------------|----------|
| Tap spot in CHASE | `PUT /api/v1/frequency` + `PUT /api/v1/mode` |
| Change band | `PUT /api/v1/frequency` |
| Change mode | `PUT /api/v1/mode` |
| Send CW macro | `PUT /api/v1/keyer?message=...` (expanded) |
| Save CW macros | `POST /api/v1/cwMacros` |
| Toggle TX | `PUT /api/v1/xmit` |
| Sync clock | `PUT /api/v1/time` |
| Tune ATU | `PUT /api/v1/atu` |
| Save settings | `POST /api/v1/callsign`, etc. |

## Conventions

### Polling
- `main.js` polls device status every few seconds
- Updates header (UTC, battery, RSSI, connection)

### Error Handling
- Connection loss shows overlay with retry
- 30s timeout triggers "Unable to reach" message

### Mobile-First
- Touch-friendly button sizes
- Responsive layout via CSS
- Compact mode option for denser display

## Modifying the UI

1. Edit files in `src/web/`
2. Build: `make build`
3. Upload: `make upload` or `make ota-upload`
4. Hard-refresh browser (Ctrl+Shift+R)

---

[← Architecture](Architecture.md)

