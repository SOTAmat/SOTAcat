# Spot Ticks on the Run-Page Band Bar — Design

**Status:** Approved for planning
**Date:** 2026-05-06

## Goal

Add a row at the top of the run page's stacked band bar that shows ticks
for active spots. Each tick is colored by mode (CW/DATA/PHONE).
Tapping a tick tunes the radio to that spot. Spots are sourced from
the existing chase data feed, refactored to a global module so any
page can read or refresh them.

## Architecture

Two units of work:

1. **`spots.js`** — new module that owns spot fetching, caching,
   localStorage persistence, and auto-refresh. Replaces the equivalent
   logic currently in `chase.js`.
2. **Run-page consumer** — `run.js` subscribes to spot updates and
   `updateBandRangeDisplay()` learns to render a new spots row at the
   top of the stack.

The split keeps the band-range renderer free of HTTP concerns and
keeps fetch/cache free of DOM concerns.

## Components

### New: `src/web/spots.js`

Module-private state:

```
SpotsState:
  spots: Array | null
  lastFetchTime: number
  lastFetchPromise: Promise | null
  autoRefreshEnabled: boolean
  autoRefreshTimeoutId: number | null
  nextAutoRefreshTime: number
  subscribers: Set<fn>
```

Public surface:

- `Spots.getAll()` → current spots array, or `null` if never loaded.
- `Spots.refresh({ force, location, fetchOptions })` → `Promise<spots>`.
  Respects `MIN_REFRESH_INTERVAL_MS`. Dedupes in-flight calls via
  `lastFetchPromise`.
- `Spots.startAutoRefresh()` / `Spots.stopAutoRefresh()` /
  `Spots.isAutoRefreshEnabled()`.
- `Spots.getNextAutoRefreshTime()` for chase's countdown UI.
- `Spots.subscribe(cb)` / `Spots.unsubscribe(cb)`. `cb(spots)` fires
  whenever the cache changes (after a fetch resolves, or after cache
  restore on page load).

Internal:

- `notify()` — invokes every subscriber with current spots.
- `scheduleAutoRefresh()` — chains the next 60s timeout.
- `saveCache()` / `loadCache()` — localStorage; reuses chase's existing
  storage key so existing caches keep working.

Constants moved from `chase.js`:

- `MIN_REFRESH_INTERVAL_MS = 60000`
- `AUTO_REFRESH_INTERVAL_MS = 60000`
- `API_SPOT_LIMIT = 500`

### Changed: `src/web/chase.js`

Becomes a consumer of `spots.js`:

- Delete `saveSpotsToCache()`, `loadSpotsFromCache()`, the auto-refresh
  timer state in `ChaseState`, the min-refresh gate in
  `loadSpotData()`, and the in-line auto-refresh chain.
- The "Refresh" button calls `Spots.refresh({ force: true })`.
- The "Auto-refresh" checkbox calls
  `Spots.startAutoRefresh()` / `Spots.stopAutoRefresh()`.
- The 1-second UI countdown (`ChaseState.refreshTimerInterval`) stays
  in chase — it's display-only and reads `Spots.getNextAutoRefreshTime()`.
- `chase.js` subscribes to spots so the table re-renders if a refresh
  fires while chase is open.

`AppState.latestChaseJson` is removed. A grep across `src/web/` will
confirm there are no surviving readers; if any are found outside chase,
they migrate to `Spots.getAll()` in the same change.

### Changed: `src/web/run.js`

- On init, `Spots.subscribe(() => updateBandRangeDisplay())`.
- `updateBandRangeDisplay()` gains a new section that builds the
  spots row, prepended to the stack.

### Changed: `updateBandRangeDisplay()` — spots row rendering

Inserted **before** the existing license-rows loop (so the row appears
visually on top):

```
const spots = Spots.getAll() || [];
const inBandSpots = spots.filter(s => s.hertz >= bandStart && s.hertz <= bandEnd);

const spotsRow = <div class="vfo-band-range-row vfo-band-range-spots-row">
  <span class="vfo-band-range-label" />            // empty, preserves alignment
  <div class="vfo-band-range-track">
    for each spot:
      <div class="vfo-band-range-spot-tick"
           data-mode="cw|data|phone|other"
           data-hz="..."
           data-mode-raw="..."
           style="left: pct(hz)%"
           title="callsign · freq MHz · mode" />
  </div>
</div>
```

Mode-category mapping reuses `getModeCategory()` from
`bandprivileges.js` — same logic the renderer already uses for stripe
colors, so coloring is consistent. `OTHER` modes (per Spothole's
`modeType`) get `data-mode="other"` and a neutral gray.

### New: `src/web/style.css`

Add to the existing `.vfo-band-range` block:

- `.vfo-band-range-spots-row` — same height as license rows. Track
  background `transparent` to let the VFO background show through;
  ticks already provide the only meaningful contrast in this row.
- `.vfo-band-range-spot-tick` — `position: absolute`, `width: 3px`,
  `margin-left: -1.5px`, full row height, `pointer-events: auto`.
- `.vfo-band-range-spot-tick[data-mode="cw"]` → `var(--mode-cw-color)`.
- Same for `data`, `phone`. New `--mode-other-color` (gray).
- `::before` invisible hitbox extending click area to ~24×row-height
  per tick, for gloved-finger touch targets.

## Data Flow

```
Spothole API
   │
   ▼
spots.js  ──► localStorage cache
   │  notify(spots)
   ├────────────────────────────────┐
   ▼                                ▼
chase.js                          run.js
  • renders spot table              • updateBandRangeDisplay()
  • shows "next refresh in Ns"      • renders spots row + ticks
  • toggles auto-refresh            • re-renders on band/mode/freq change
```

**Fetch trigger sources:**

1. Chase "Refresh" button → `Spots.refresh({ force: true })`.
2. Chase "Auto-refresh" toggle → `Spots.startAutoRefresh()`.
3. Run page **does not** trigger fetches. If chase has never been
   opened and localStorage is empty, the run-page spots row renders
   empty until chase fetches.

**Re-render triggers for the spots row:**

- Spots cache changes → subscriber callback → `updateBandRangeDisplay()`.
- VFO band/mode/freq change → existing call sites already invoke
  `updateBandRangeDisplay()`.

## Tap-to-Tune

1. `pointerdown` on a `.vfo-band-range-spot-tick` reads `data-hz` and
   `data-mode-raw`.
2. Calls the existing chase-table tune-to-spot code path. The
   implementation locates that function in `chase.js` and extracts it
   to a shared helper (likely in `main.js` next to `AppState`) so both
   pages call the same code. No duplication.
3. `event.stopPropagation()` so the band-range drag-to-tune handler
   doesn't also fire on the same gesture.

The existing `vfo-band-range-overlay` (VFO tick + bandwidth window) is
`pointer-events: none` to keep segment tooltips firing. The new spots
row sits inside the stack, not the overlay, so its ticks receive
pointer events normally; the row's empty background passes through to
the band-range parent's drag-to-tune via the same bubbling that license
rows already use.

## Error Handling & Edge Cases

- **Fetch fails** — `Spots.refresh()` rejects; chase shows the existing
  alert; run page keeps showing whatever ticks it had. No new error UI.
- **localStorage unavailable / corrupt** — existing try/catch from
  chase moves into `spots.js` unchanged.
- **Empty Spothole result** — row renders with zero ticks. No "no
  spots" placeholder.
- **VFO out of band** — existing code hides the entire
  `#vfo-band-range` with `.hidden`; the spots row goes with it.
- **Spot at exact band edge** — same `pct()` mapping as VFO tick; tick
  sits at 0 % or 100 %.
- **Refresh during drag-to-tune** — subscriber callback invokes
  `updateBandRangeDisplay()` which calls `stack.replaceChildren(frag)`,
  destroying DOM mid-drag. Mitigation: gate the spots-row rebuild on
  the absence of `is-dragging` on the container; if `is-dragging`,
  skip the rebuild and run it on `dragend`. (Chase auto-refreshes every
  60 s, so this collision is real.)
- **License-class set change** — already handled by full re-render.
  Spots row regenerates with the rest.
- **`modeType === "OTHER"`** — renders gray; tooltip shows raw mode.

## Visual Spec

```
┌──┬──────────────────────────────────────────────────────┐
│  │   • •     ••       •            •  •          •      │  ← spots row (~5px)
├──┼──────────────────────────────────────────────────────┤
│E │█████████████████████████████████████████████████████ │
│A │█████████████████████████████████████████████████████ │
│G │█████████████████████████████████████████████████████ │
│T │░░░░░░░░░░░░░░░░░░░░█████░░░░░░░░░░░░░░░░░░░░░░░░░░░░ │
└──┴──────────────────────────────────────────────────────┘
              ▲ VFO tick (white) + bandwidth window span all rows
```

- Tick width: 3 px, mid-tick alignment via `margin-left: -1.5px`.
- Tick height: same as license rows (~5 px).
- Tick colors via existing CSS vars: `--mode-cw-color` (blue),
  `--mode-data-color` (amber), `--mode-phone-color` (green), plus new
  `--mode-other-color` (gray).
- Tap-target hitbox via `::before` pseudo-element ~24 px wide.
  Compromise between the project's ≥48 px gloved-finger guideline and
  the reality that 48 px hitboxes overlap aggressively when spots
  cluster.
- Tooltip: native `title=` attribute, same as segment tooltips. Format:
  `"<callsign> · <freq>MHz · <mode>"`.

## Density / Multiple Spots at Same Frequency

Ticks stack visually; last-rendered wins z-order. No bucketing or
fan-out. Tap-to-tune picks the topmost tick at the tapped position
(natural DOM behavior). Acceptable per user direction — the bar is
approximate at high density.

## Spot Filtering

- Only spots with `bandStart ≤ hertz ≤ bandEnd` for the currently
  displayed band.
- No age filter beyond what Spothole returns.
- All `modeType` values are rendered, including `OTHER`.

## Testing

**Unit-testable helper:**

```
buildSpotTickData(spots, bandStart, bandEnd)
  → Array<{ leftPct, modeCategory, hz, modeRaw, callsign, title }>
```

Pure function, easy to assert on.

**Manual verification:**

- Load chase to populate spots; switch to run; verify ticks render.
- Tap a tick → VFO tunes to spot frequency and mode.
- Switch bands → ticks update for the new band.
- Toggle license-class visibility → spots row remains correctly placed
  on top.
- Clear localStorage → run page shows empty spots row until chase
  fetches.
- Auto-refresh fires while drag-to-tune is active → drag is not
  disrupted; ticks update on drag release.

## Out of Scope

- A refresh affordance on the run page (chase auto-refresh feeds run
  in the background).
- Run-page-initiated fetches (passive consumer only).
- Tick fan-out / bucketing for density.
- Distinct colors for SSB vs AM vs FM (collapsed to PHONE).
