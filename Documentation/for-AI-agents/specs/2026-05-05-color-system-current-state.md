# SOTAcat Color System — Current State (2026-05-05)

**Status:** authoritative current truth. Supersedes the 2026-05-02 design spec for "what's actually in the code today." The original spec remains valuable as the design *rationale* — read it for philosophy, branch decisions, and the why behind the structure. This file is the *what*: every token, every consumer, every open item.

**Branch:** `feat/color-redesign` (~50 commits since `b7fa231` on `main`).

---

## 1. What changed from the original 2026-05-02 spec

Three structural reversals worth knowing before you read anything else:

1. **Dark mode dropped** (2026-05-03). Real-device testing revealed extensive coverage gaps (sub-cards / headings / Run-page cards / Chase rows all inadequately covered). Rather than chase every uncovered selector, the project committed to **light mode only** for the dominant context: outdoor SOTA activations in direct sun. All `[data-theme="dark"]` CSS, the AUTO/LIGHT/DARK toggle UI, `localStorage["sotacat-theme"]`, the no-flash inline `<head>` script, and the `data-theme` attribute mechanism — gone. Spec sections that referenced dark theme are now historical only.

2. **Mode brightness restored** (2026-05-05, "v2 palette"). The Phase-1 darkening of CW (`#228be6` → `#1864ab`) and PHONE (`#40c057` → `#1f7330`) for white-text WCAG AA was reversed. All filled mode badges now use **dark text** on the original brighter shades. DATA reverted from orange-shifted `#f08c00` back to its historical yellow `#fab005` (matches the user-facing UI-Tour doc's "yellow = DATA" description). Modes feel like *colored badges* again, not heavy dim wells.

3. **Operational color slots reassigned.** Cyan/teal originally meant "transient operational state" (scan, MyCall, auto-refresh). After the user adopted ham2k Polo's brand teal `#006783` for the PoLo-log button, the rest of the operational stack moved to violet: scan = `#5f3dc4`, auto-refresh = same family. SPOT announcements (SOTAmāt, SMS) took the now-vacant orange slot at `#fd7e14` ("Big Orange Splot"). ATU got its own magenta-violet `#be4bdb` so it can't be misread as XMIT-red. MyCall stopped sharing the scan/violet family — when it has `.active` (chase phone-mode toggle TX) it pulses red-critical, identical to XMIT.

---

## 2. Final palette — all tokens, all values

All defined in `src/web/style.css :root`. Light theme only (no `[data-theme="dark"]` block exists).

### 2.1 Mode hues — Tier 1 (filled badge backgrounds, dark text)

| Token | Value | Text color | Contrast | Used by |
|---|---|---|---|---|
| `--mode-cw` | `#228be6` | `var(--gray-9)` `#212529` | 5.2:1 ✓ AA | `#btn-cw.active`, `.btn-msg.msg-mode-cw`, `.btn-mycall.msg-mode-cw`, `.btn-cw-macro`, `.btn-xmit.msg-mode-cw`, `[data-keyer-family="cw"] #cw-freeform-send`, `.mode-cell-CW` |
| `--mode-voice` | `#40c057` | dark | 7.4:1 ✓ AAA | same pattern for SSB/AM/FM (`*.msg-mode-voice`, `.mode-cell-SSB/AM/FM`, etc.) |
| `--mode-data` | `#fab005` | dark | 10.8:1 ✓ AAA | same pattern for DATA (`*.msg-mode-data`, `[data-keyer-family="data"] #cw-freeform-send`, `.mode-cell-DATA`) |

Inactive but enabled mode buttons use a derived 30 % tint over the dark mode-bar:

```css
#btn-cw   { background: color-mix(in srgb, var(--mode-cw)    30%, var(--surface-op-modebar)); }
#btn-ssb, #btn-am, #btn-fm
          { background: color-mix(in srgb, var(--mode-voice) 30%, var(--surface-op-modebar)); }
#btn-data { background: color-mix(in srgb, var(--mode-data)  30%, var(--surface-op-modebar)); }
```

Three states are visually distinct: full-saturated active → pale tinted inactive-enabled → opaque-gray-dimmed disabled.

### 2.2 Mode hues — Tier 2 (text/fill on dark surface, brighter shades)

For text on the always-dark VFO display, and the band-range graph stripes.

| Token | Value | Used by |
|---|---|---|
| `--mode-cw-on-dark` | `#4dabf7` | `.mode-display.msg-mode-cw` (VFO mode tag), band-range stripe when current mode is CW |
| `--mode-voice-on-dark` | `#69db7c` | same for voice |
| `--mode-data-on-dark` | `#ffd43b` | same for DATA |

The band-range stripe rule (`run.js` `updateBandRangeGraph()`) uses a small mapping:
```js
const STRIPE_TOKEN_BY_CATEGORY = {
    CW: "--mode-cw-on-dark",
    DATA: "--mode-data-on-dark",
    PHONE: "--mode-voice-on-dark",   // PHONE category → voice token (intentional naming bridge)
};
```

### 2.3 State colors

| Token | Value | Used by |
|---|---|---|
| `--state-critical` | `#e03131` | XMIT pulse (`.btn-xmit.active`), MyCall.active pulse (chase phone-mode TX), license/privilege denied, hard errors |
| `--state-critical-pastel-bg` | `#fff5f5` | denied / error pill background |
| `--state-critical-pastel-fg` | `#c92a2a` | denied / error pill text + border |
| `--status-ok-bg` | `#ebfbee` | success / allowed pill background |
| `--status-ok-fg` | `#2b8a3e` | success / allowed pill text + border (also voice-mode-derived `#1f7330` is *not* this token) |
| `--status-ok-border` | `#b2f2bb` | success pill border |
| `--status-na-bg` | `#f1f3f5` | "not applicable" pill bg (license classes you don't hold) |
| `--status-na-fg` | `#6c757d` | NA pill text |
| `--status-na-border` | `#dee2e6` | NA pill border |

### 2.4 Action / interaction colors

| Token | Value | Used by |
|---|---|---|
| `--action-primary` | `#212529` | charcoal — generic press-to-do (Tune Spot, Send, Spot non-PoLo override applies on top, etc.); also `.btn-band.active` selection chrome |
| `--action-on-primary` | `#ffffff` | text on action buttons |
| `--action-secondary-border` | `#212529` | outlined / ghost button border (2px) |

### 2.5 Operational palette additions (v2)

| Token | Value | Used by |
|---|---|---|
| `--polo` | `#006783` | `#polo-spot-button` and `#polo-chase-button` only — ham2k Polo brand color, white text |
| `--spot` | `#fd7e14` | `.btn-spot` (SOTAmāt, Spot SMS, QRT SMS), dark text. PoLo override above wins by ID specificity for the polo-specific buttons. |
| `--atu` | `#be4bdb` | `.btn-tune` (Tune ATU), white text |
| `--scan-idle` | `#5f3dc4` | `.btn-scan` base, white text |
| `--scan-active-min` | `#7950f2` | `.btn-scan.active` base, also `.btn-auto-refresh-active` base, white text |
| `--scan-active-max` | `#9775fa` | `pulse-scan` keyframe peak |
| `--link` | `#0d6efd` | `a {}` (text only — never a filled button); `text-decoration: underline` except inside `#chase-table` where it's dropped |
| `--link-visited` | `#6f42c1` | visited links |

### 2.6 Surfaces

| Token | Value | Role |
|---|---|---|
| `--surface-page` | `#eceef2` | body background (Phase 0 token, finally applied to body in 2026-05-04 mobile-compaction commit) |
| `--surface-card` | `#ffffff` | cards, tables, forms |
| `--surface-op-header` | `#0f1419` | tab bar / app header (always dark) |
| `--surface-op-vfo` | `#15181c` | VFO display (always dark) |
| `--surface-op-modebar` | `#181d22` | mode-buttons strip (always dark) |

### 2.7 Text on operational (dark) surfaces

| Token | Value | Role |
|---|---|---|
| `--text-on-op` | `#f8f9fa` | white text on the dark op zones |
| `--text-op-accent` | `#ffd43b` | amber on dark — VFO mode tag default (overridden per-mode by Tier 2 colors) |
| `--text-op-data` | `#74c0fc` | (defined but no longer used after header readouts went uniform white) |

### 2.8 Borders

| Token | Value | Role |
|---|---|---|
| `--border-default-new` | `#dee2e6` | card edges, dividers (2px) |
| `--border-strong` | `#212529` | strong section breaks, table headers (3px) |

### 2.9 Band rainbow (chase table)

27 band-color tokens defined as RGB triplets (`--band-160m: 124, 252, 0;` etc.) in `:root`. Applied via `rgba(var(--band-XXm), var(--band-opacity))` where `--band-opacity: 0.35`. All 27 unchanged from the original Phase 3 tokenization. Light-only now (no `--band-opacity-dark`).

### 2.10 Program badges (chase table type column)

Nine `--program-{sota,pota,wwff,gma,iota,wca,zlota,wwbota,hema}` tokens. Hand-picked per ham-radio program convention. Unchanged.

### 2.11 Tokens deliberately deleted

These were defined at various points and removed for cleanliness. Don't reintroduce them.

- `--primary` / `--primary-dark` / `--primary-light` / `--success` / `--success-dark` / `--danger` / `--danger-dark` / `--warning` / `--warning-dark` — Mantine-style legacy shims, removed in Phase 6 cleanup. Every consumer migrated to specific new tokens.
- `--mode-cw-color` / `--mode-data-color` / `--mode-phone-color` — Tier 2 duplicates of `--mode-*-on-dark`, removed in v2 commit `ccd1a12`.
- `--state-transient` (was `#1098ad` cyan) — replaced by violet scan tokens; consumers migrated. Removed in v2 commit `5d68dd5`.
- `--mode-cw-enabled` / `--mode-voice-enabled` / `--mode-data-enabled` — original Mantine pale tints, removed in Phase 1 cockpit work; later replaced by `color-mix()` inactive tints (Section 2.1 above).
- `@keyframes pulse-transient-bg` — partner to `--state-transient`, removed in v2.
- `@media (prefers-contrast: high)` block — removed in Phase 6; the new design's defaults (thicker borders, larger targets, redundant icons, brighter colors) supersede.

---

## 3. Per-element treatment

Quick reference for "what color is X right now":

| Element | Treatment |
|---|---|
| App header (always-dark zone) | bg `--surface-op-header` (`#0f1419`); white text; readouts (voltage/time/RSSI) all uniform white (no cyan split) |
| Tab bar (bottom of screen, always-dark) | bg `--surface-op-header`; **active tab marked by 3px white *over*-bar** (border-top, not border-bottom — bottom border collides with Android gesture indicator) |
| VFO display (always-dark) | bg `--surface-op-vfo`; horizontal flex; freq text neutral white at 32px; mode tag colored by current mode using `--mode-*-on-dark` tokens; `flex-wrap: wrap` so warning text drops below |
| Mode bar (always-dark) | bg `--surface-op-modebar`; per-mode buttons per Section 2.1 |
| Mode buttons | three-state: active = full saturated mode color + dark text; inactive enabled = `color-mix` 30% mode color over modebar (still has white text from base); disabled = gray + 60% opacity |
| XMIT button | base = mode-colored when in PHONE; disabled (gray + tooltip) in CW/DATA modes; `.active` = red-critical pulsing |
| Scan button | base = `--scan-idle` violet; `.active` = `--scan-active-min` violet pulsing via `pulse-scan` keyframes (`#7950f2 ↔ #9775fa`) |
| MyCall button (chase) | base = mode color (msg-mode-* class); `.active` (phone toggle-TX) = red-critical pulsing |
| Msg / Macro buttons | mode-colored per current mode; dark text on bright mode bg |
| Key button (`#cw-freeform-send`) | mode-colored per `data-keyer-family` (cw → blue, data → amber); dark text; disabled state inherits `.btn:disabled` opacity 0.6 (faded) |
| Spot buttons (SOTAmāt, SMS, QRT) | `--spot` orange; dark text |
| PoLo log buttons | `--polo` teal; white text. Override on `#polo-spot-button` and `#polo-chase-button` IDs. |
| ATU (Tune ATU) button | `--atu` magenta-violet; white text; momentary action (no on/off state) |
| Action buttons (Tune Spot, Send, etc.) | `--action-primary` charcoal; white text |
| Band buttons | inactive = gray; active = `--action-primary` charcoal (selection chrome, not a brand color) |
| Toggle switches | off = gray; on = `--action-primary` charcoal (drops original blue → no CW collision) |
| Frequency steppers (`+5k` etc.) | outlined neutral charcoal; both up and down identical (drops the green/red value-judgment coding); text labels (`+5k`, `−3k`) preserved |
| Status pills | `.status-pill .ok` (green pastel + ✓), `.status-pill .no` (red pastel + ✕), `.status-pill .na` (neutral gray, no icon). Redundant icons for color-blind operators. |
| License-class badges | `.license-badge` outlined-letter circles in 3 states: `.allowed` (green), `.user-class.denied` (red — your class can't use this freq/mode), `.denied` (gray faded — class doesn't apply). The status-pill conversion from Phase 3 was reverted; original outlined-letter design restored. |
| Hyperlinks | `--link` blue + underline globally; `#chase-table a` drops the underline (color alone in dense tabular context); `:visited` = `--link-visited` purple |
| Chase table even-row alternation | `tbody tr.even-row { background: var(--gray-2); }` (`#e9ecef`) — strong enough to be visible in sun, weaker than the tuned-row tint |
| Chase tuned (current) row | bg + 8px left-marker bar both at the same color (currently still set to old teal `rgba(16,152,173,0.30)` — **PENDING UPDATE** to derive from `--scan-idle` violet; see §6) |
| My-spot row (chase) | cream bg `--bg-my-spot` `#fffbeb` + 4px amber bottom border (becomes 8px left-marker amber when also tuned) |
| Spot-age gradient (chase UTC column) | `chase.js` `spotAgeColor()` — light theme only; HSL ramp `hsl(0, 80%, 97%→75%)` from 5min to 60min |

---

## 4. Per-page rules

The "cockpit" pattern still applies, with mobile-specific compaction:

- **Operational pages** (`qrx.html`, `chase.html`, `run.html`): app header + VFO + mode bar always live in the dark always-dark zone at top.
- **Configuration pages** (`settings.html`, `about.html`): tabs only in the dark zone; body fully light, no operational chrome.
- **Tab order** (`index.html`): `QRX | CHASE | RUN | SETTINGS | ABOUT` (was already correct in code).

### Mobile horizontal compaction (`@media (max-width: 480px)`)

Edge-to-edge cards on phones — recovers ~52 px of horizontal content width on iPhone 15. From the Phase 3+ baseline:
- `#content-area` padding: 12px → 0 horizontal (kept 80px bottom for tab-bar clearance)
- `.section-card` margin: 8px → 0 horizontal, 8px between stacked cards
- `.section-card` border-radius: 8px → 6px
- `.section-content` padding: 12px → 8px horizontal
- `.section-header` padding: 12px → 10px horizontal
- `.settings-card` padding: 20px → 10px horizontal

Card differentiation in edge-to-edge mode comes from the body bg (`--surface-page` `#eceef2`, ~7 % darker than card white) + subtle shadow + section header bg (`--gray-1`).

### Tune card vertical tightening (commit `16531a3`)

To make the entire Tune card fit a single iPhone 15 viewport without scrolling:
- `.section-content` padding `--space-lg` → `--space-md`
- Grid `margin-bottom` (freq/band/mode grids) `--space-lg` → `--space-md`
- `.vfo-display` margin-bottom `--space-lg` → `--space-md`
- `.mode-grid` padding `--space-md` → `--space-sm`

---

## 5. Font policy

- **All buttons** use `var(--font-family)` (sans-serif: `-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, ...`). One font for every clickable thing. Includes mode buttons, tab buttons, action buttons, scan button, segmented control (none currently — was removed with theme toggle), `.btn-xmit` (originally tried mono, switched to sans after Android-Courier-fallback complaint).
- **Tabular-numeric / data readouts** use `var(--font-mono)` which is `ui-monospace, "SF Mono", "Roboto Mono", Monaco, "Cascadia Mono", monospace` (the Android-friendly stack). Used on: VFO frequency, voltage / time / RSSI in header, mode tag, frequency labels.
- **License-badge letters** use `var(--font-mono)` for uniform single-letter circle appearance.
- **Body / general text** uses `var(--font-family)` sans.

---

## 6. Open / pending work

These are explicitly *not done* and a fresh context should pick them up:

### 6a. Tuned-row chase color (was being worked on when session paused)

`#chase-table .tuned-row` currently still uses the OLD teal:
```css
background: rgba(16, 152, 173, 0.30);
border-left: 8px solid rgba(16, 152, 173, 0.30);
```

**Should be:** derived from `--scan-idle` violet so it visually matches the operational scanning palette. Suggested:
```css
background: color-mix(in srgb, var(--scan-idle) 30%, transparent);
border-left: 8px solid color-mix(in srgb, var(--scan-idle) 30%, transparent);
```

The same-color-as-row-tint approach is intentional — the adjacent UTC column (immune to row highlighting) provides the natural visual edge.

The companion `#chase-table .my-spot-row.tuned-row` rule already overrides background and border to amber/cream — should stay; my-spot wins precedence over tuned-row.

### 6b. Scan-active outline visibility on chase page (was being worked on when session paused)

`.btn-scan.active` currently has `border: 2px solid var(--scan-active-max)` (= `#9775fa`). Because the bg pulses through that same value, the border becomes invisible at one phase of the cycle. User wants it always visible.

**Suggested:** swap to `border: 3px solid var(--white);` — high-contrast crisp outline on violet. Width bump to 3px reinforces "this is selected/on" per the outline standardization principle.

### 6c. Outline standardization (broader rule from earlier user request)

User stated rule: **visible outline = "this button is on / selected / active"**. Momentary action buttons should never be outlined. The full pattern (from the swatches HTML) was:

| Button | Active state | Outline? |
|---|---|---|
| Mode (CW/SSB/etc.) | active (current mode) | should add outline cue alongside background |
| Band (40m/20m/etc.) | active (current band) | should add outline cue |
| Scan | active (scanning) | yes (see 6b above) |
| XMIT | active (transmitting) | yes — currently has it (`#a51111` red border) |
| Auto-refresh | active | yes |
| MyCall | active (chase phone TX) | yes |
| ATU, Tune Spot, Send, Spot, PoLo, Msg, Macros, Key | — momentary action, no on/off | **never outlined** |

Audit current `.btn-*` rules and remove stray borders from momentary buttons; add deliberate outlines (white or charcoal, depending on bg) to the seven stateful "on/active" cases listed above. **Not started.**

### 6d. Deferred design questions (memory file)

`~/.claude/projects/-home-jeff-Dropbox-workspace-motes-SOTAcat/memory/color_redesign_deferred.md` tracks four design questions raised during early phases. Status now:

- **A. Mode-bar dark background** — *still open.* User asked "why the black rectangular background on Run?" and chose to defer. The dark mode-bar zone is still in the design. Decide: keep cockpit / drop to partial cockpit / something else.
- **B. Mode color consistency across UI** — *resolved.* Phase 6 cleanup converted all consumers off `--primary`/etc. shims to direct `var(--mode-cw)`/etc. references. Verified.
- **C. ATU button toggle vs regular** — *resolved.* User clarified ATU is a momentary action button (Toggle TX is the "phone toggle" button; ATU is press-to-tune). Now styled as `--atu` magenta momentary button.
- **D. Band selector active vs CW collision** — *resolved.* Band-active uses `--action-primary` charcoal, no longer collides with CW.

### 6e. Final hardware verification (from the original plan)

Task 21 of the original implementation plan: real-phone testing in actual sun + actual gloves + deuteranopia simulator. The user has been doing iterative phone testing throughout, but a holistic final pass against the v2 palette hasn't been formally signed off.

---

## 7. Build / file references

- **Single CSS file:** `src/web/style.css` (~2400 lines). All tokens at top in `:root`.
- **Entry HTML:** `src/web/index.html` (only full page; the rest are HTML *fragments* injected by tab routing).
- **Per-page fragments:** `src/web/{qrx,chase,run,settings,about}.html`.
- **Per-page JS:** `src/web/{main,qrx,chase,run,settings,bandprivileges}.js`. Mode-color logic concentrated in `run.js updateModeDisplay()` (line ~104) and `chase.js updateMyCallButton()` (line ~594).
- **Asset compression:** `python3 scripts/compress_web_assets.py`. Generates `*.htmlgz` / `*.cssgz` / `*.jsgz` artifacts in `src/web/` for ESP-IDF embedded serving. **Gitignored** (per `.gitignore` line ~96). Regenerate locally for the dev server but don't commit.
- **Dev server:** `python3 -m http.server 8080 --directory src/web`.
- **Original spec:** `Documentation/for-AI-agents/specs/2026-05-02-color-system-design.md` — read for design *rationale* only; the *current state* is this file.
- **Original plan:** `Documentation/for-AI-agents/plans/2026-05-02-color-system-implementation.md` — phased migration history; phases 4-5 reverted (dark mode dropped); phase 6 cleanup completed.

---

## 8. Glossary of decisions worth remembering

- **Cockpit aesthetic** = header + VFO + mode bar always dark, regardless of theme. Originally chose to support both light and dark themes; dark dropped, but the always-dark operational chrome stayed.
- **Two-tier mode colors** = Tier 1 (`--mode-cw` etc.) for filled button bg; Tier 2 (`--mode-cw-on-dark` etc.) for text/fill on dark surfaces. Different shades by design — different contrast contexts.
- **PoLo's deliberate exception** = the only `.btn-spot` instance with `--polo` teal instead of the family `--spot` orange. Because PoLo is a logging action with its own brand identity (ham2k), distinct from generic spot announcements.
- **Outline = on/active** (proposed rule, partially applied) — see §6c.
- **Color-mix for inactive mode tints** — modern CSS `color-mix(in srgb, var(--mode-cw) 30%, var(--surface-op-modebar))`. Browser support is fine on iPhone 15 / Pixel 10 (Safari 16.2+, Chrome 111+).
- **Phone + gloves is the dominant interaction context** — touch targets ≥48px, prefer 56–72px for primary controls. No hairline borders on tappable surfaces. Body type ≥14px; primary readouts (VFO frequency) 32px.
- **One commit per logical change** — the branch has ~50 small, bisectable commits. Don't squash unless about to merge.
