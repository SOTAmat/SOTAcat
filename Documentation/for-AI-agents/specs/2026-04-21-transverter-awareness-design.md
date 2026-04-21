# Issue #99 Item (3) — Transverter awareness & radio capability model

Brainstormed 2026-04-21. Design for item (3) of GitHub issue #99. Item (2) (VHF/UHF privilege-table extension) already landed on branch `fix/99-vhf-uhf-privileges`.

## Context

Item (2) fixed the false "No amateur privileges" warning by extending FCC privilege data to VHF/UHF. The radio reports transverted frequencies and SOTAcat now checks privileges correctly. Item (3) is the next step: make SOTAcat's UI actually *usable* on transverter bands — band buttons, chase-spot filtering — and do it without checkboxes in settings for every conceivable option.

Goals:
- Zero-config for the 95% case. Detect radio capabilities; don't ask the user to configure what the radio already knows.
- Correct native band tables (current code is wrong for KX2 and missing entirely for KH1).
- Support KX2+external xvrt (rdarden's case), KX3+internal KXV3-2M module, KX3+external xvrt, and KH1 natively.
- Minimal settings surface — transparency + escape hatch only.

## Radio capability model

Each radio's capability set = **native ∪ options ∪ learned**.

### Native bands (hardcoded per radio)

| Radio | Bands |
|---|---|
| KX2 | 80, 60, 40, 30, 20, 17, 15, 12, 10m |
| KX3 | 160, 80, 60, 40, 30, 20, 17, 15, 12, 10, 6m |
| KH1 | 40, 20, 17, 15, 10m (CW-only QRP) |
| Unknown | `null` → show all bands |

Current `RADIO_BAND_CAPABILITIES` in `src/web/main.js:424-428` is wrong (KX2 claims 160m and 6m). Corrected table replaces it.

### Option-detected bands (deferred)

Parsing `OM` to detect KX3 internal modules (e.g. KXV3-2M adds 2m) is **deferred**. Without it, a KX3+KXV3-2M owner's 2m button appears after their first QSY to 2m via the auto-learn path — acceptable onboarding cost, no backend changes. Future enhancement if desired.

### Auto-learned bands (per-radio localStorage)

Rule: **if observed `FA` maps to a band not in native ∪ options ∪ learned → append to learned, persist, re-render UI.**

- Learn source: polled `FA` only (radio-confirmed). Never from our PUT requests or spot clicks.
- No radio-type branch — KH1 won't report out-of-native frequencies, so the trigger naturally never fires there.
- Storage key: `sotacat_learned_bands_KX2` / `..._KX3` / `..._KH1`
- Shape: `[{ band: "2m", lastFreqHz: 146580000 }, ...]`
- Also tracks **last-observed frequency per band** for *all* bands (native too), used as the band-button click target (see "CAT page band buttons" below).

## UI changes

### CAT page band buttons

File: `src/web/run.html` (currently hardcodes 6 HF buttons at lines 45-52), `src/web/run.js`.

- Replace hardcoded buttons with empty `<div id="band-grid"></div>`.
- New `renderBandButtons()` in `run.js`, called on page load and on capability change.
- **Ordering**: native bands in frequency order, then learned bands appended.
- **Click target**: last-observed freq for this band on this radio. Fallback to `BAND_PLAN[band].initial` if never observed.
- **No learning** from button click — learning fires only on the subsequent poll's confirmed `FA`.

### BAND_PLAN `.initial` additions

File: `src/web/main.js:391`. Add to VHF/UHF entries (adventure frequencies where convention exists):

| Band | `.initial` | Notes |
|---|---|---|
| 6m | 50.125 MHz | SSB weak-signal calling |
| 2m | 146.580 MHz | SOTA/adventure freq (US) |
| 1.25m | 223.500 MHz | National FM simplex |
| 70cm | 446.580 MHz | SOTA/adventure freq (US) |
| 23cm | 1294.500 MHz | National simplex |

HF `.initial` values unchanged.

### Dynamic column count

Files: `src/web/run.js` (compute), `src/web/style.css:485` (remove fixed `repeat(3, 1fr)`).

Pick column count to guarantee last row has ≥ 2 buttons (avoid "dangler" — sole button on own row). Applied as inline `grid-template-columns` on `.band-grid` after render.

```js
function bestColumnCount(n) {
    if (n <= 3) return Math.max(n, 1);
    for (const cols of [3, 4, 5]) {
        if (n % cols !== 1) return cols;
    }
    return 3;
}
```

Only N=13 requires 5 cols; 3 and 4 cols suffice for all other realistic N (1–20).

### Settings page — "Radio & Transverters" section

File: `src/web/settings.html`, `src/web/settings.js`. New compact section, below callsign/license.

Read-only status line showing detected radio + auto-learned bands with per-entry Forget button:

```
Radio: KX3
Auto-learned transverter bands:
  • 2m — last seen 146.580 MHz — [Forget]
  • 70cm — last seen 446.580 MHz — [Forget]
```

If nothing learned: show `(none)`. No add button — auto-learn does that.

Existing `filterBandsEnabled` toggle unchanged.

### Chase filter

File: `src/web/chase.js:1050` (`applyChaseFilters`).

- Filter OFF: all spots (unchanged).
- Filter ON, per radio:
  - **KX2/KX3**: native ∪ options ∪ learned ∪ **plausible transverter bands** (2m, 70cm, 23cm). The plausible tier is shown even before learning so user can bootstrap via spot click. Radio ignoring the PUT means no learn happens — matches the rule.
  - **KH1**: native only. No "plausible transverter" tier — KH1 has no transverter IF architecture, so 2m/70cm spots would be pure clutter with no-op clicks.
  - **Unknown**: `null` → all bands (unchanged).

## Data flow

**Page load**:
1. Read localStorage: `filterBandsEnabled`, `sotacat_learned_bands_{radioType}`.
2. Fetch `/api/v1/radioType` → `AppState.radioType`.
3. Compute capability set = native(radioType) ∪ learned.
4. `renderBandButtons()` + `applyChaseFilters()`.

**VFO poll (3s)**:
- Observed `FA` → `getBandFromFrequency()`.
- If band ≠ null and not in capability set: append to learned, persist, re-render.
- If band already known: update `lastFreqHz[band]` (for all bands — used by button click).

**Band button click**: PUT `FA = lastFreqHz[band] ?? BAND_PLAN[band].initial`.

**Chase spot click**: PUT `FA`/`MD` (existing behavior, unchanged). Auto-learn fires only if next poll confirms.

**Forget click**: remove from `learnedBands[radioType]` and `lastFreqHz[band]`; persist; re-render.

## Edge cases

- **Disconnect/reconnect**: radio type re-detected; learned state persists (per-radio keyed).
- **Different radios on one SOTAcat over its life**: each has its own localStorage key; switching between them shows the right bands.
- **Garbage `FA`**: `getBandFromFrequency()` returns null → no learn.
- **Radio reports band it can't actually reach** (e.g. corrupted FA response): 2m gets learned, button tunes via FA, radio ignores, `lastFreqHz` stays stale. User can Forget it. Low-severity cosmetic issue.
- **User physically removes a transverter**: stale learned entry until Forget clicked. TTL auto-expiry deferred — premature optimization.
- **Band boundary frequency** (e.g. exactly 144.000 MHz): `getBandFromFrequency()` uses inclusive bounds — deterministic assignment to one band. Fine.

## Persistence summary

| State | Location |
|---|---|
| Native band tables | JS constants (compile-time) |
| Radio type | In-memory; re-detected per connect |
| Auto-learned bands (per radio) | localStorage |
| Last-observed freq per band (per radio) | localStorage (in same learned-bands blob) |
| `filterBandsEnabled` | localStorage (unchanged, existing key `sotacat_filter_bands`) |

**No backend/firmware changes required.**

## Testing

**New unit tests** (under `test/unit/`):
- Capability-set merging for each radio type (with and without learned bands).
- `bestColumnCount(n)` for n ∈ [1..20]: assert `n % result !== 1` whenever n > 3.
- Auto-learn: observed in-capability freq updates `lastFreqHz` only; out-of-capability band gets appended.
- Forget: removes band and its `lastFreqHz`.
- Chase filter: KH1 hides 2m spots; KX2/KX3 show 2m/70cm/23cm even unlearned; filter OFF shows all.

**Manual / integration**:
- KX2 + external xvrt on 2m (rdarden, real hardware — his original report).
- KX3 without module: 2m still learnable via auto-learn path.
- KX3 with KXV3-2M: 2m learned on first QSY; button appears next session.
- KH1: no VHF buttons; filter hides VHF spots; auto-learn never fires.

**Regression**: existing unit tests (177 at time of writing, across `test_bandprivileges.js`, `test_battery_charging.js`, `test_qrx.js`, `test_run.js`) continue to pass.

## Documentation updates

- **`Documentation/user/UI-Tour.md`**: "RUN — Operate" section currently lists "Band buttons (40m, 20m, 17m, 15m, 12m, 10m)" as a fixed set. Update to describe dynamic band buttons — native bands for the detected radio, plus auto-learned transverter bands. Add a short note in the Settings section pointing to the new "Radio & Transverters" read-only panel (detected radio, auto-learned bands, per-band Forget).
- **`Documentation/dev/Web-UI.md`**: Brief note near the existing `bandprivileges.js` mention describing the new per-radio capability model (native ∪ options ∪ learned) and where learned-state persists (localStorage, per-radio key).
- **Screenshots**: once the UI lands, refresh `Documentation/images/run-tune.png` (band-button row will look different) and `Documentation/images/settings-display-and-chase-filters.png` (new Radio & Transverters section visible). Screenshot capture is out of scope for the implementation plan — do it after manual verification on real hardware.

## Deferred / out of scope

- **OM-parse for KX3 options**: skipped in initial implementation; auto-learn covers the UX. Future enhancement if pre-populating buttons is worth backend changes.
- **TTL auto-forget** of learned bands.
- **Multiple XV slots on same band with different offsets**: can't distinguish; last-observed wins.
- **Cross-client sync** of learned state (NVS): rejected in favor of localStorage. Reconsider if users complain about phone/laptop state divergence.
- **Mode-aware chase filtering for KH1** (CW-only): out of scope for this change.

## Files to modify

- `src/web/main.js` — corrected `RADIO_BAND_CAPABILITIES`, new BAND_PLAN `.initial` values, learned-state load/save helpers, capability-set computation.
- `src/web/run.html` — replace hardcoded band buttons with `<div id="band-grid"></div>`.
- `src/web/run.js` — `renderBandButtons()`, `bestColumnCount()`, updated `selectBand()`, integration with poll loop.
- `src/web/chase.js` — updated filter with "plausible transverter bands" tier for KX2/KX3.
- `src/web/settings.html`, `src/web/settings.js` — new "Radio & Transverters" section with Forget buttons.
- `src/web/style.css` — remove fixed column count on `.band-grid`; will be set inline after render.
- `test/unit/` — new test file(s) for capability merging, column count, auto-learn, filter behavior.
- `Documentation/user/UI-Tour.md` — describe dynamic band buttons + Radio & Transverters settings panel.
- `Documentation/dev/Web-UI.md` — brief note on per-radio capability model and learned-state persistence.

No changes to firmware (C++) or backend handlers.
