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

`bandprivileges.js` is a shared module loaded globally from `index.html`.
Both `run.js` (badges, warning states, button enablement, and the VFO
band-range bar) and `chase.js` (per-row privilege flagging) read from
`FCC_AMATEUR_PRIVILEGES` and use the bandwidth/edge helpers.

## UI → API Mapping

| User Action | API Call |
|-------------|----------|
| Tap spot in CHASE | `PUT /api/v1/frequency` + `PUT /api/v1/mode` |
| Change band | `PUT /api/v1/frequency` |
| Change mode | `PUT /api/v1/mode` |
| Send CW/data macro | `PUT /api/v1/keyer?message=...` (expanded) — sent as CW in CW/CW-R, as RTTY in DATA + FSK-D, as PSK31 in DATA + PSK-D; forces CW otherwise |
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

### VFO Band-Range Stack
The graphic above the frequency display in `run.html` (`#vfo-band-range`)
is rendered by `updateBandRangeDisplay()` in `run.js`, called from
`updatePrivilegeDisplay()`. It is a vertical stack of thin rows
(`.vfo-band-range-stack`), one per currently-visible license class —
top = most-restrictive (E), bottom = least (T or N). Visibility is decided
by `getVisibleLicenseClasses()`, which mirrors the badge-visibility rule:
N and A only appear when the configured license is one of those legacy
classes. Each row has a small monospace label and a per-row track.

Within a row, each FCC privilege segment in `FCC_AMATEUR_PRIVILEGES[band]`
that contains the row's class becomes a `.vfo-band-range-segment` div; if
the row's class isn't in `seg.classes`, no segment is rendered for that
range — the empty space *is* the visualization that the class lacks
privileges there. The chart is **operator-centric** with respect to the
radio's currently-selected mode (mapped to a category via
`getModeCategory()`):
- If the current mode category is in `seg.modes`, the segment renders as
  a single solid `.vfo-band-range-mode-stripe` colored by the current
  mode (`--mode-cw-color` / `--mode-data-color` / `--mode-phone-color`).
  Other modes that may also be allowed in the segment are deliberately
  not depicted.
- If the current mode is not in `seg.modes`, the segment renders one
  stripe per mode that *is* allowed (in stable `MODE_CATEGORIES` order).
  The visual "solid vs striped" distinction is the cue that "you'd need
  to switch modes here".

Mode stripe positions inside a segment do not correspond to frequency
sub-ranges (all listed modes are permitted across the full segment
width) — they're a "which alternative modes are available here" key.
Tooltips show the full FCC mode list per segment regardless of which
stripes are rendered.

A single `.vfo-band-range-overlay` is appended last; it spans the whole
row stack and contains the white-or-red tick (`.vfo-band-range-tick`) at
the dial frequency and the translucent bandwidth window
(`.vfo-band-range-bandwidth`). The overlay's `left` is offset by
`var(--label-width)` so its 0–100% maps onto the same frequency axis as
the per-row tracks. Mode bandwidth comes from `getModeBandwidth` and
`getSignal{Lower,Upper}Edge` in `bandprivileges.js`.

## Modifying the UI

1. Edit files in `src/web/`
2. Build: `make build`
3. Upload: `make upload` or `make ota-upload`
4. Hard-refresh browser (Ctrl+Shift+R)

---

[← Architecture](Architecture.md)

