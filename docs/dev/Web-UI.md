# Web UI Development

**Who this is for:** Developers modifying the web interface

## Asset Pipeline

Web assets in `src/web/` are:
1. Gzip-compressed during build
2. Converted to C byte arrays
3. Embedded in firmware binary
4. Served by ESP32 web server

### Dual-wiring rule (read this before adding files)

Every file under `src/web/` must be registered in **two** places — both are required:

1. **`src/CMakeLists.txt`** — add the file to the `EMBED_FILES` list so the build embeds it in the firmware binary.
2. **`src/webserver.cpp`** — add an entry to the `asset_map` so the HTTP server knows what URL path to serve it from.

Miss the CMakeLists entry → the file isn't in the binary (build- or link-time error). Miss the `asset_map` entry → the file is in the binary but unreachable, and the browser gets `ERR_EMPTY_RESPONSE`. The second mode is the silent failure — always grep both files when adding a new asset.

## File Structure

```
src/web/
├── index.html         # Main SPA shell
├── qrx.html           # QRX tab content
├── chase.html         # CHASE tab content
├── run.html           # RUN tab content
├── settings.html      # Settings tab content
├── about.html         # About tab content
├── main.js            # Core app logic, AppState, tuneRadioHz, RADIO_CAPABILITIES
├── qrx.js             # QRX functionality
├── chase.js           # CHASE functionality (consumes spots.js)
├── chase_api.js       # Spothole API client (used by spots.js)
├── run.js             # RUN functionality + band-range chart + spot ticks
├── settings.js        # Settings functionality
├── style.css          # All styling
├── bandprivileges.js  # FCC band data, mode helpers, MODE_SNAP_HZ
└── spots.js           # Global spot store: fetch, cache, subscribe/notify, auto-refresh
```

`bandprivileges.js` is a shared module loaded globally from `index.html`.
Both `run.js` (badges, warning states, button enablement, and the VFO
band-range bar) and `chase.js` (per-row privilege flagging) read from
`FCC_AMATEUR_PRIVILEGES` and use the bandwidth/edge helpers. It also
exposes `MODE_SNAP_HZ` — per-mode snap step in Hz used by drag-to-tune
on the band-range chart (CW = 100, DATA = 500, SSB/AM = 1000, FM = 5000).

### Spots Module (`spots.js`)

`spots.js` is the single source of truth for spot data. Any page that
needs spots (CHASE, RUN's spot-tick row) reads from this module instead
of fetching directly. Loaded globally from `index.html` and exposed as
the `Spots` global.

**Public API:**

- `Spots.getAll()` — current spot array (`null` before first load).
- `Spots.refresh({ force, location, fetchOptions })` — fetch from
  Spothole. Returns the array (or cached spots if rate-limited).
- `Spots.clear()` — drop in-memory spots + localStorage cache. Auto-refresh
  state and the rate-limit clock are intentionally preserved (this is a
  data reset, not a state-machine reset).
- `Spots.subscribe(cb)` / `Spots.unsubscribe(cb)` — page callbacks fired
  with the new array whenever a refresh completes. Always unsubscribe on
  teardown — `chase.js` and `run.js` both subscribe on tab-enter and
  unsubscribe on leave.
- `Spots.startAutoRefresh()` / `Spots.stopAutoRefresh()` /
  `Spots.isAutoRefreshEnabled()` / `Spots.loadAutoRefreshPref()` —
  60 s auto-refresh state machine. Preference persists to
  `localStorage["chaseAutoRefreshEnabled"]`.
- `Spots.getLastFetchCompleteTime()` / `Spots.getNextAutoRefreshTime()` —
  for "Refreshed Ns ago" / "Next refresh in Ns" UI.

**Rate-limit and dedup semantics:**

- A 60 s rate-limit gate between API calls. `force=true` bypasses the
  gate (for manual refresh / auto-refresh tick) but does **not** bypass
  in-flight dedup.
- Concurrent `refresh()` calls dedup to a single fetch — additional
  callers receive the in-flight promise.
- `lastFetchTime` advances *before* the fetch resolves, so a network
  failure still counts against the 60 s gate. Auto-refresh has its own
  timer chain that retries regardless.
- `_notify()` snapshots the subscriber set before iterating so a
  subscriber that calls `unsubscribe()` on itself or a peer during
  notify doesn't cause peers to be silently skipped.

**Cache:** `localStorage["chaseSpotCache"]` (1 h TTL, matching
`CHASE_HISTORY_DURATION_SECONDS`). The key name is preserved for
compatibility with caches from earlier chase-only versions.

**Design context:** `docs/superpowers/specs/2026-05-06-spot-ticks-design.md`
and `docs/superpowers/plans/2026-05-06-spot-ticks.md`.

### Radio Capabilities (in `main.js`)

`main.js` declares `RADIO_CAPABILITIES`, a per-radio record describing the
native bands and modes each supported transceiver can use *without* a
transverter. Each band/mode value is `"TXRX"` (transmit + receive) or
`"RX"` (receive-only). Absent entries mean the radio cannot tune there at
all. `Unknown` maps to `null`, which downstream code treats as
permissive (no filtering, no gating).

Accessors:

- `getRadioBands(radioType, requireTx)` / `getRadioModes(radioType, requireTx)`
  — list bands or modes; pass `requireTx=true` to filter to TX-capable.
- `radioCanTransmit(radioType, band, mode)` — boolean.
- `getRadioBandCapabilities(radioType)` — back-compat wrapper used by
  `chase.js` for opt-out band filtering of spots; returns the full
  RX-or-TX band list so receive-only allocations (e.g. KX2 on 160 m)
  still appear when the user has the filter on.

Real users operate radios beyond their native list via external
transverters (e.g. KX2 + 2 m transverter). UI gating that strictly
disables controls based on this table would lock those users out, so the
chase-page filter is opt-in via a setting and the run-page band/mode
buttons are *not* gated on radio capability today. Add escape hatches
(or wait for a transverter-aware capability layer) before changing that.

## UI → API Mapping

| User Action | API Call |
|-------------|----------|
| Tap spot in CHASE | `PUT /api/v1/frequency` + `PUT /api/v1/mode` |
| Change band | `PUT /api/v1/frequency` |
| Change mode | `PUT /api/v1/mode` |
| Send CW/data macro | `PUT /api/v1/keyer?message=...` (expanded; `{MYREF}` keyed without the hyphen per CW convention) — sent as CW in CW/CW-R, as RTTY in DATA + FSK-D, as PSK31 in DATA + PSK-D; forces CW otherwise |
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

### Spot ticks on the Run page

Above the license-class stack, `run.js` renders a separate
`.vfo-band-range-spots-row` containing one `.vfo-band-range-spot-tick`
per spot whose `hertz` falls within the current band's `[bandMin,
bandMax]`. `buildSpotTickData(spots, bandStart, bandEnd)` is the pure
helper that filters and computes `leftPct` + `modeCategory` for each
tick — it's the unit-testable seam (see `test/unit/test_run_spot_ticks.js`).

Ticks are colored by mode category (`cw` / `data` / `phone` / `other`,
see `style.css` `[data-mode]` selectors). The pointer handler on
`#vfo-band-range` short-circuits when `event.target.closest(".vfo-band-range-spot-tick")`
matches — instead of drag-to-tune, a spot tick tap calls
`tuneRadioHz(spotHz, spotMode)` directly. There is **no** drag
semantics for spot ticks: tap-only on both mouse and touch.

The spots row is rebuilt on each `Spots` subscriber callback, but
rebuild is deferred while `RunState.isDragging` is true so a live drag
doesn't reflow the row under the user's finger/cursor.

#### Drag-to-tune (mouse) and tap-to-jump (touch)

The drag/tap pipeline below applies to the VFO tick, **not** spot ticks.

`setupBandRangeDrag()` (run.js) wires a `pointerdown` listener to the
persistent `#vfo-band-range` container. The handler reads
`event.pointerType` and branches on `"touch"` vs anything else. Pixel-X
is mapped to frequency via the cached overlay rect (`bandMin + frac *
(bandMax - bandMin)`), then snapped to a mode-specific step from
`MODE_SNAP_HZ` in `bandprivileges.js` (CW = 100 Hz, DATA = 500 Hz,
PHONE = 1 kHz, FM = 5 kHz), then clamped to the current band's overall
`[bandMin, bandMax]`.

**Mouse**: `pointerdown` applies the position eagerly (instant click
feedback), `pointermove` updates the visual tick and fires throttled CAT
writes at ~15 Hz (66 ms) by calling `setFrequencyImmediate()` directly —
this bypasses the 300 ms debounce in `setFrequency()` so the rig retunes
live. `setPointerCapture()` keeps the drag tracking even if the cursor
wanders out of the container. On `pointerup`/`pointercancel` a final
canonical `setFrequency()` lands the released value through the
debounced path.

**Touch**: tap-to-jump only — no live finger-tracking. `pointerdown`
records state but does not commit (so a finger landing on the chart
while reaching to scroll the page doesn't accidentally retune).
`pointermove` is ignored (the chart rows are too small to drag
precisely with a finger, and continuous CAT writes would fight native
scroll). `preventDefault()` and `setPointerCapture()` are skipped so the
browser is free to hand off the gesture to scroll/zoom. On `pointerup`,
the final position is computed from the release coordinates and
committed via `setFrequency()`. On `pointercancel` (the browser's
signal that scroll has taken over), nothing is committed.

VFO read polling is suppressed automatically because the path updates
`RunState.lastUserAction`, which `getCurrentVfoState()` already checks
(existing 2 s window).

The overlay itself stays `pointer-events: none` so segment `title=`
tooltips on the rows below keep firing on hover. Only the 2 px tick
gets `pointer-events: auto` — needed both to differentiate the cursor
on desktop (`ew-resize` over the tick, `col-resize` elsewhere,
`grabbing` while `#vfo-band-range.is-dragging`) and to ensure the tick
is hit-testable on touch (the parent handler still receives the event
via bubbling). Cursor rules are gated by `@media (pointer: fine)` since
cursors don't apply on touch.

## Modifying the UI

1. Edit files in `src/web/`
2. Build: `make build`
3. Upload: `make upload` or `make ota-upload`
4. Hard-refresh browser (Ctrl+Shift+R)

---

[← Architecture](Architecture.md)

