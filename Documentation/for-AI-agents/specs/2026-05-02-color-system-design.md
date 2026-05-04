# SOTAcat Color System Redesign — Design Spec

**Date:** 2026-05-02
**Status:** Approved (brainstorm complete; awaiting implementation plan)
**Scope:** All web UI files under `src/web/`

## 1. Goals

Replace the current overloaded color system in `src/web/` with a disciplined, dual-theme token system that:

1. **Eliminates the mode × status × action color collisions** in the current design (where blue carries 11+ meanings, red carries 6, etc.).
2. **Adds a dark theme** for indoor/evening use, alongside a refined light theme for outdoor sunlight legibility.
3. **Makes every primary control glove-operable** on a small phone screen (touch targets ≥48px, prefer 56–72px).
4. **Preserves the canonical mode-color mapping** (CW=blue, voice/phone=green, data=amber) — operator-learned recognition that must not be disrupted.
5. **Adopts a "cockpit" aesthetic** that embraces what SOTAcat is: a radio control panel, not a generic mobile app.

## 2. Constraints (locked inputs)

These are fixed inputs to the design. They are not up for revisiting during implementation.

| Constraint | Source |
|---|---|
| **Use context** | Mixed: significant outdoor activation use AND meaningful indoor use (chasing, planning). Both must be supported. |
| **Theme strategy** | Two themes: light + dark, with `prefers-color-scheme` auto-detection plus manual override. Stored in `localStorage["sotacat-theme"]` as `"auto" \| "light" \| "dark"`. |
| **Phone + gloves is the dominant interaction context.** | Touch targets ≥48px, prefer 56–72px for primary controls. No hairline (1px) borders on tappable surfaces. Body type ≥14px; primary readouts (VFO frequency, callsign) 16–22px+. |
| **Mode → color mapping is canonical.** | CW=blue, voice/phone (SSB/AM/FM)=green, DATA=amber. Hue family is immutable; saturation/luminance/treatment can vary. |
| **Active tab order:** | `QRX | CHASE | RUN | SETTINGS | ABOUT` |
| **Aesthetic direction:** | "Cockpit" — operational chrome (header, VFO, mode bar) is **always dark in both themes**; only data/config surfaces theme. |
| **Palette character:** | Saturated light theme (sunlight legibility); calm dark theme (indoor comfort). |

## 3. Out of scope

- Layout changes beyond what color refactoring requires (e.g., not redesigning the spot-list information architecture).
- Redesigning the band-rainbow color assignments in the chase table — keep all 27 hues as-is, tokenize only.
- Redesigning program-badge colors (SOTA/POTA/WWFF/etc.) — keep as-is, tokenize only.
- Replacing the existing CSS architecture (no migration to Tailwind, CSS-in-JS, etc.) — stay with vanilla CSS custom properties.
- Modifying the gzipped-asset build flow.

## 4. Design — token system

### 4.1 Surfaces

Operational chrome (header, VFO, mode bar) is **always dark** in both themes. Only the page body and cards theme.

| Token | Light theme | Dark theme | Role |
|---|---|---|---|
| `--surface-page` | `#eceef2` | `#0a0d10` | Body background |
| `--surface-card` | `#ffffff` | `#181d22` | Cards, tables, forms |
| `--surface-op-header` | `#0f1419` | `#0f1419` | Tab bar / app header (always dark) |
| `--surface-op-vfo` | `#15181c` | `#15181c` | VFO display (always dark) |
| `--surface-op-modebar` | `#181d22` | `#181d22` | Mode buttons strip (always dark) |

### 4.2 Text

| Token | Light theme | Dark theme | Role |
|---|---|---|---|
| `--text-primary` | `#212529` | `#f1f3f5` | Body, table data, labels |
| `--text-secondary` | `#6c757d` | `#adb5bd` | Metadata, hints |
| `--text-on-op` | `#f8f9fa` | `#f8f9fa` | Text on dark operational zones (always light) |
| `--text-op-accent` | `#ffd43b` | `#ffd43b` | VFO mode tag, header title (amber on dark) |
| `--text-op-data` | `#74c0fc` | `#74c0fc` | Voltage, time, RX-meter readouts (cyan on dark) |

### 4.3 Mode hues — locked mapping

Mode badges live primarily on the dark mode bar in both themes, so a single value works for both themes. Filled badge.

| Token | Value | Mode | Text color | Contrast vs text |
|---|---|---|---|---|
| `--mode-cw` | `#1864ab` | CW | white (`#ffffff`) | **6.0:1** ✓ AA |
| `--mode-voice` | `#1f7330` | SSB / AM / FM / phone | white (`#ffffff`) | **5.2:1** ✓ AA |
| `--mode-data` | `#f08c00` | DATA / digital | dark (`var(--gray-9)` = `#212529`) | **8.4:1** ✓ AA |

CW and voice use white text on darker shades. **DATA uses dark text** — amber's luminance is high enough that white text cannot meet WCAG AA at any reasonable shade. This matches the original SOTAcat design (the data button always had dark text). The mode-color *families* (blue / green / amber) remain locked per operator convention; only the specific shades changed to satisfy contrast.

### 4.4 Action accent

Single accent for primary actions, deliberately not in any mode hue family. Charcoal — distinctive, glove-friendly, neutral.

| Token | Light theme | Dark theme | Role |
|---|---|---|---|
| `--action-primary` | `#212529` | `#f1f3f5` | Primary action button bg |
| `--action-on-primary` | `#ffffff` | `#0a0d10` | Text on action button |
| `--action-secondary-border` | `#212529` | `#f1f3f5` | Outlined/ghost variant border (2px) |

### 4.5 Critical state — XMIT and hard errors

Red is reserved. **Only** for: TX active (RF on air), license/privilege denied. Everywhere else where red was used today (scan, MyCall, freq-down) gets a different color.

| Token | Light theme | Dark theme | Role |
|---|---|---|---|
| `--state-critical` | `#e03131` | `#e03131` | XMIT pulse bg, critical action bg |
| `--state-critical-pastel-bg` | `#fff5f5` | `#3b1f1f` | Denied/error pill bg |
| `--state-critical-pastel-fg` | `#c92a2a` | `#ff8787` | Denied/error pill text + border |

Pastel variant carries a redundant **✕** icon (mirrors the **✓** on success pills) so allowed/denied remains distinguishable for operators with red-green color vision deficiency.

### 4.6 Transient state — scan, MyCall, working

New introduction: cyan. Means "operational state in progress, not critical." Distinct from XMIT-red and from any mode hue.

| Token | Value | Role |
|---|---|---|
| `--state-transient` | `#1098ad` | Scan pulse, MyCall pulse, auto-refresh active glow. White text. Pulse animation when used in active-state context. |

### 4.7 Status — allowed / success

Pastel pill with redundant ✓ icon (for color-blind operators).

| Token | Light theme | Dark theme |
|---|---|---|
| `--status-ok-bg` | `#ebfbee` | `#1f2e23` |
| `--status-ok-fg` | `#2b8a3e` | `#69db7c` |
| `--status-ok-border` | `#b2f2bb` | `#2b8a3e` |

### 4.8 Status — neutral / not-applicable

Used for license-class badges that don't apply to the operator (denied = "not for me", not "wrong"). No red connotation.

| Token | Light theme | Dark theme |
|---|---|---|
| `--status-na-bg` | `#f1f3f5` | `#1c1f23` |
| `--status-na-fg` | `#6c757d` | `#adb5bd` |
| `--status-na-border` | `#dee2e6` | `#2b3036` |

### 4.9 Borders / dividers

Thicker than today's 1px hairlines (≥2px) so they survive sun glare and signal touchability under gloves.

| Token | Light theme | Dark theme | Width |
|---|---|---|---|
| `--border-default` | `#dee2e6` | `#2b3036` | 2px |
| `--border-strong` | `#212529` | `#000000` | 3px |

## 5. Design — special domain colors

### 5.1 Band rainbow (chase table)

**Keep all 27 band-color hues.** Operator-learned ("20m is gold, 40m is royal blue") — changing them costs recognition for no gain.

- Tokenize as `--band-160m`, `--band-80m`, ... `--band-76GHz` (full list in current `style.css`).
- Hue values unchanged.
- **Theme-aware opacity:** introduce `--band-opacity-light: 0.35` and `--band-opacity-dark: 0.55`. Apply via `color-mix()` or layered background — same visual weight on both surfaces.

Text contrast on band cells:
- Light theme: dark text (`#212529`) on the tinted background.
- Dark theme: light text (`#f1f3f5`) for most bands; dark text on the few yellow/gold bands (20m, 17m, 24GHz, 47GHz) where light text would fail contrast.

### 5.2 Type / program badges

**Keep all hand-picked colors.** Like band colors, these are learned. Tokenize as `--program-sota`, `--program-pota`, `--program-wwff`, `--program-gma`, `--program-iota`, `--program-wca`, `--program-zlota`, `--program-wwbota`, `--program-hema`. Same colors in both themes; sit on table cells as solid filled badges.

### 5.3 License-class badges

- **Allowed by my class:** `--status-ok-*` tokens + ✓ icon.
- **Not in my privileges:** `--status-na-*` tokens (neutral gray; no error connotation). Drop today's half-opacity treatment.

### 5.4 Spot-age gradient (chase.js)

Refactor the inline `style.backgroundColor = hsl(...)` (currently `chase.js:950`) into a function that consults `data-theme` on `<html>`:

- **Light theme:** `hsl(0, 80%, L%)` where `L` ranges from 97% (fresh, 0 min) to 75% (60+ min).
- **Dark theme:** `hsl(0, S%, L%)` where `S` ranges from 0% to 50% and `L` ranges from 14% to 26% (warm dim → muted red, never harsh).

### 5.5 My-spot row highlight

Theme-aware:
- **Light:** `background: #fff8e1`, `border-left: 4px solid #f59e0b`.
- **Dark:** `background: #2a2418`, `border-left: 4px solid #f59e0b`.

### 5.6 VFO warnings

VFO is always in the dark operational zone, so existing warning treatments still apply:
- **Mode warning** (operator on illegal mode for band): 3px amber border (`--mode-data` color), warning-blend bg `#3d3520`.
- **Privilege violation** (out of license-class privileges): 3px red border (`--state-critical`), danger-blend bg `#4a2a2d`.

### 5.7 Activation-mode cells (chase table)

Reference `--mode-cw`, `--mode-voice`, `--mode-data` directly. Same look as today; one source of truth.

### 5.8 Auto-refresh active state

Use `--state-transient` (cyan) glow. Same vocabulary as scan/MyCall — both mean "operational state in progress."

### 5.9 Tab bar — active page indicator

Active tab: `--text-on-op` (bright white) text + 3px white underline on the dark header. **No color, just brightness + weight.** This avoids every collision and works on dark in both themes.

Inactive tab text: `--text-secondary`-equivalent dimmed gray.

### 5.10 Frequency steppers (up / down)

Drop green/red (which encoded direction as value judgment). Both buttons become `--action-secondary` (outlined neutral) with arrow icons (▲/▼) doing the directional work.

### 5.11 Toggle switches

- **On:** `--action-primary` (charcoal in light theme; light fill in dark theme).
- **Off:** mid-gray (`#adb5bd` light; `#495057` dark).
- Slider thumb: white in light theme; charcoal in dark theme when on.

## 6. Design — per-page treatment + theme switching

### 6.1 Page archetypes

Two archetypes. Each page belongs to exactly one.

**Operational pages** — `qrx.html`, `chase.html`, `run.html` (and `wrx.html` if/when present):
- Tabs + VFO + mode bar all live in the dark operational zone.
- Operational chrome is the same in both themes (always dark).
- Body cards (data tables, action button rows, message panels) flip with theme.

**Configuration pages** — `settings.html`, `about.html`:
- Tabs only in the dark operational zone.
- No VFO, no mode bar.
- Body fully themes — entire page goes light or dark, no operational carve-outs.

### 6.2 Tab order

`QRX | CHASE | RUN | SETTINGS | ABOUT` (left-to-right).

### 6.3 Theme-switching mechanism

- **Control:** Three-state segmented control (`AUTO` / `LIGHT` / `DARK`) at the top of `settings.html`.
- **Default:** `AUTO`. Follows OS `prefers-color-scheme` via `matchMedia("(prefers-color-scheme: dark)")`.
- **Persistence:** `localStorage["sotacat-theme"]` stores `"auto" | "light" | "dark"`.
- **Application:** Single `data-theme="light|dark"` attribute on `<html>`. All CSS-var resolution keys off this attribute. Switching is one DOM mutation; no flash.
- **No-flash on cold load:** Inline `<script>` in `<head>` of every HTML page reads localStorage and sets `data-theme` synchronously, before stylesheet load.

```html
<script>
  (function() {
    var saved = localStorage.getItem('sotacat-theme') || 'auto';
    var dark = saved === 'dark' || (saved === 'auto' &&
      window.matchMedia('(prefers-color-scheme: dark)').matches);
    document.documentElement.setAttribute('data-theme', dark ? 'dark' : 'light');
  })();
</script>
```

When `AUTO` is selected and the OS preference changes mid-session, the `matchMedia` listener flips the attribute live.

## 7. Migration plan — six phases

Each phase is independently shippable and testable on real hardware.

### Phase 0 — Foundation
**Goal:** Add new token system to `style.css` as new `--vars` alongside the old ones. Add compat shims so existing CSS keeps working: e.g., `--primary: var(--mode-cw); --success: var(--status-ok-fg);`. Nothing visually changes for users.
**Files:** `src/web/style.css` (additions only).

### Phase 1 — Operational chrome (cockpit pattern)
**Goal:** Convert tab bar, VFO display, and mode bar to the always-dark cockpit treatment on operational pages. VFO frequency text becomes neutral. Tab order updates to `QRX | CHASE | RUN | SETTINGS | ABOUT`. Touch targets sized for gloves (≥60×60px on mode buttons, action buttons, primary controls).
- Active tab: white text + 3px white underline (drops blue).
- VFO: dark surface, neutral white frequency, amber mode tag.
- Mode bar: dark surface, filled mode badges.
**Files:** `style.css`, `index.html`, `run.html`, `chase.html`, `qrx.html`, `main.js`.

### Phase 2 — Component sweeps
**Goal:** Per-component pass: buttons, status pills, toggle switches, frequency steppers, message buttons. Apply redundant ✓/✕ icons to allowed/denied pills. Move scan/MyCall/auto-refresh-active to `--state-transient` (cyan); reserve red for XMIT and hard errors only. Up/down freq steppers become outlined neutrals with arrow icons.
**Files:** `style.css` primarily; minor HTML/JS for icon insertion in status pills.

### Phase 3 — Special-domain refactors
**Goal:** Tokenize band-rainbow as `--band-{name}`. Tokenize program badges as `--program-{name}`. License-class badges adopt `--status-ok-*` + ✓ for allowed, `--status-na-*` for not-applicable. My-spot row uses theme-aware values. Spot-age JS in `chase.js:950` becomes a function that consults `data-theme` on `<html>`.
**Files:** `style.css`, `chase.js`, `bandprivileges.js`.

### Phase 4 — Dark theme
**Goal:** Add `[data-theme="dark"]` CSS block to `style.css`. Every theme-aware token gets its dark value (per Section 4). Manually setting `<html data-theme="dark">` in DevTools should fully flip the UI. Operational chrome is unchanged (already dark in both themes).
**Files:** `style.css` (one new block).

### Phase 5 — Theme toggle UI + persistence
**Goal:** Add the three-state segmented control to the top of `settings.html`. JS reads/writes `localStorage["sotacat-theme"]`; on page load, applies stored value or follows `prefers-color-scheme` for `auto`. All theme application via `data-theme` on `<html>`. Inline no-flash script in `<head>` of every page.
**Files:** `settings.html`, `settings.js`, `main.js`, `<head>` of every HTML page.

### Phase 6 — Cleanup
**Goal:** Remove compat shims (`--primary`, `--success`, etc. that aliased to new tokens). Remove unreferenced old colors. Retire the old `@media (prefers-contrast: high)` block — its job is now done by the general design (thicker borders, larger targets, redundant icons).
**Files:** `style.css` only.

## 8. Per-phase testing protocol

Before marking any phase complete, verify on a real phone:

- **Outdoor in sun** — VFO frequency legible at arm's length, mode badges distinguishable, action buttons visible.
- **Indoor / dim** — no eye strain, status pills readable, no harsh contrast spikes.
- **With gloves** — all primary controls tappable without mis-taps, no accidental adjacent-button presses.
- **Color-blind sanity check** — view through a deuteranopia simulator (browser DevTools → Rendering → Emulate vision deficiency); allowed/denied pills still distinguishable via the ✓/✕ icon.
- **Theme flip mid-session** (Phase 5+) — switching via the segmented control updates the UI instantly, no flash, no broken styles.
- **Cold load with stored dark preference** (Phase 5+) — page renders in dark theme on first paint, no light-flash.

## 9. Risks

- **Operator relearning.** Cyan = scan (was red). White underline = active tab (was blue). Outlined neutrals = freq steppers (were green/red). Mitigation: brief release-note + optional inline help popup on first launch after upgrade.
- **Theme-flash on cold load.** If `data-theme` isn't set before CSS parses, user sees a brief light flash even when dark is preferred. Mitigation: inline `<script>` in `<head>` of every HTML page (see §6.3).
- **Gzipped HTML files** in `src/web/` need regenerating after every HTML change. Mitigation: verify the existing build flow regenerates `*.htmlgz` and `*.jsgz` after each phase; document if not.
- **Compat shims (Phase 0–5) hide breakage.** The shim `--primary: var(--mode-cw)` means any rule still using `--primary` will work but won't look right (fights modes again). Mitigation: Phase 6 cleanup is mandatory. Track shimmed tokens in a comment block in `style.css` so they're easy to delete.
- **Band-cell text contrast on dark theme** — at 0.55 opacity, light bands (20m gold, 17m yellow, 24GHz, 47GHz) need dark text; saturated bands need light text. Mitigation: per-band text-color override for the few outliers; verify each band cell against WCAG AA in Phase 3.
- **Deuteranopia coverage on charts/graphs.** Band-range graph stripes (`run.js:399`) currently use mode colors; with mode mapping locked, stripes still rely on hue. Mitigation: ensure stripes are also distinguishable by pattern or position, not hue alone (out of scope for Phase 1; consider as Phase 7 if needed).

## 10. Open questions / future work

- Whether to retire the existing `@media (prefers-contrast: high)` block entirely in Phase 6, or keep it as an extra-contrast layer. Recommendation: retire — the new design's defaults already meet or exceed what that block provided.
- Whether to add a "boost" sub-mode for direct sunlight (one-tap brightness/saturation amplification beyond Light). Not in current scope; revisit after Phase 5 if outdoor users report needing it.
- Whether the band-range graph in Run (`run.js:399`) needs additional visual encoding (pattern/position) for full color-blind support. Out of scope for this redesign; flag for future work.

---

## Postscript (2026-05-03) — Dark mode dropped

Sections §4 dark-theme columns, §5 dark-theme overrides, §6.3 (theme switching mechanism), and Phase 4–5 of the migration plan are **historical only**. After real-device testing on the user's phone, dark mode coverage gaps were extensive (sub-cards, headings, Run-page cards, Chase row highlighting all inadequately covered). Rather than chase down every uncovered selector, the project committed to **light mode only** going forward, optimized for the dominant context: outdoor SOTA activations in direct sunlight.

The light-theme tokens defined in §4 remain in use — they describe the single-theme defaults. The `[data-theme]` attribute mechanism, the `localStorage["sotacat-theme"]` key, and the AUTO/LIGHT/DARK segmented control have all been removed from the codebase.
