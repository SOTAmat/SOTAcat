# Color System Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement the color system redesign specified in `Documentation/for-AI-agents/specs/2026-05-02-color-system-design.md` — a dual-theme token system with the cockpit aesthetic, glove-friendly ergonomics, and rationalized mode/state/action color separation.

**Architecture:** Vanilla CSS custom properties drive all theming. A single `data-theme="light|dark"` attribute on `<html>` selects the variant. New tokens are introduced alongside the existing ones with compat shims, enabling phased migration. An inline `<head>` script applies the theme before stylesheet load to prevent flash-of-wrong-theme on cold load. Web assets are gzipped via `scripts/compress_web_assets.py` for ESP-IDF embedded serving.

**Tech Stack:** Vanilla HTML/CSS/JavaScript. PlatformIO + ESP-IDF firmware build. Python 3 script for asset compression. Target hardware: Seeed XIAO ESP32-C3.

**Tab order is already correct in code** (`QRX | CHASE | RUN | SETTINGS | ABOUT` in `src/web/index.html` lines 23-46). The spec mentions updating it; verify on inspection but no change is needed.

**Repeated commands referenced throughout:**
- Compress web assets (run after any change in `src/web/`):
  ```bash
  python scripts/compress_web_assets.py
  ```
  **Note:** the resulting `*.htmlgz` / `*.cssgz` / `*.jsgz` files are gitignored (`.gitignore` line ~96, "generated at build time"). Regenerate them locally for the dev server / firmware build, but **do not commit them**. Every `git add` line in this plan stages source files only.
- Visual verification (no automated tests for the web UI exist — verification is manual):
  - Serve the assets via `python3 -m http.server 8080 --directory src/web` and open `http://localhost:8080/index.html` in a browser.
  - For phone-scale verification, use Chrome/Safari DevTools device emulation set to **iPhone SE (375 × 667)** and rotate to portrait.
  - For deuteranopia checks: Chrome DevTools → Rendering → Emulate vision deficiency → "Deuteranopia".

---

## Phase 0 — Foundation

Add new token system to `style.css` as new `--vars` alongside the old ones. Add compat shims so existing CSS keeps working. Nothing visually changes for users.

### Task 1: Add new token system + compat shims to style.css

**Files:**
- Modify: `src/web/style.css` (the `:root` block at the top)

- [ ] **Step 1: Read the current `:root` block to know what's there**

```bash
grep -n "^:root\|^}$" src/web/style.css | head -10
```
Expected: shows the line numbers of `:root {` and the closing `}`. Note them for the next step.

- [ ] **Step 2: Insert new token system at the END of the existing `:root` block (just before its closing `}`)**

Add this block. Keep existing tokens above it untouched for now.

```css
    /* ========================================================================
       NEW TOKEN SYSTEM (Phase 0 — Color Redesign 2026-05-02)
       Spec: Documentation/for-AI-agents/specs/2026-05-02-color-system-design.md
       ======================================================================== */

    /* Surfaces */
    --surface-page: #eceef2;
    --surface-card: #ffffff;
    --surface-op-header: #0f1419;   /* always dark, both themes */
    --surface-op-vfo: #15181c;      /* always dark, both themes */
    --surface-op-modebar: #181d22;  /* always dark, both themes */

    /* Text */
    --text-primary-new: #212529;
    --text-secondary-new: #6c757d;
    --text-on-op: #f8f9fa;          /* always light text on dark op zones */
    --text-op-accent: #ffd43b;      /* amber on dark — VFO mode tag, header title */
    --text-op-data: #74c0fc;        /* cyan on dark — voltage, time, RX-meter */

    /* Mode hues — locked mapping (same in both themes) */
    --mode-cw: #1c7ed6;
    --mode-voice: #2f9e44;
    --mode-data: #f08c00;

    /* Action accent */
    --action-primary: #212529;
    --action-on-primary: #ffffff;
    --action-secondary-border: #212529;

    /* Critical state — XMIT, hard errors */
    --state-critical: #e03131;
    --state-critical-pastel-bg: #fff5f5;
    --state-critical-pastel-fg: #c92a2a;

    /* Transient state — scan, MyCall, working */
    --state-transient: #1098ad;

    /* Status — allowed / success */
    --status-ok-bg: #ebfbee;
    --status-ok-fg: #2b8a3e;
    --status-ok-border: #b2f2bb;

    /* Status — neutral / not-applicable */
    --status-na-bg: #f1f3f5;
    --status-na-fg: #6c757d;
    --status-na-border: #dee2e6;

    /* Borders */
    --border-default-new: #dee2e6;
    --border-strong: #212529;

    /* Band rainbow opacity (theme-aware via Phase 4) */
    --band-opacity: 0.35;

    /* ========================================================================
       COMPAT SHIMS — old tokens aliased to new equivalents.
       Phase 6 will delete these after every consumer migrates.
       Keep this list maintained; remove an alias only when the old token has
       zero remaining references in the file.
       ======================================================================== */
    --primary: var(--mode-cw);
    --primary-dark: #1864ab;
    --primary-light: #4dabf7;
    --success: var(--status-ok-fg);
    --success-dark: #2b8a3e;
    --danger: var(--state-critical);
    --danger-dark: #c92a2a;
    --warning: var(--mode-data);
    --warning-dark: #d9480f;
```

Note: do NOT delete the existing `--primary`, `--success`, etc. lines yet — they get *overwritten* by the shim block below them (CSS cascading via property re-declaration in the same `:root`). Both forms work; the shim block at the end takes precedence.

- [ ] **Step 3: Regenerate gzipped assets**

```bash
python scripts/compress_web_assets.py
```
Expected: prints lines like `Compressed: src/web/style.css →`.

- [ ] **Step 4: Visually verify nothing changed**

```bash
python3 -m http.server 8080 --directory src/web &
SERVER_PID=$!
sleep 1
echo "Open http://localhost:8080/index.html in browser. Check Run/Chase/QRX/Settings — visually identical to before. Check DevTools → Computed styles → confirm new tokens like --mode-cw are defined on :root."
echo "When done, press Enter to stop the server."
read
kill $SERVER_PID
```
Expected: identical pixel output to before this task. New tokens appear in DevTools.

- [ ] **Step 5: Commit**

```bash
git add src/web/style.css
git commit -m "phase 0: add color-redesign token system + shims"
```

---

## Phase 1 — Operational chrome (cockpit pattern)

Convert the tab bar, VFO display, and mode bar to the always-dark cockpit treatment. VFO frequency text becomes neutral. Touch targets sized for gloves.

### Task 2: Convert main app header + tab bar to dark cockpit

**Files:**
- Modify: `src/web/style.css` (`.mainHeaderContainer`, `.tabBar`, tab button styles)

- [ ] **Step 1: Find the existing header and tab bar rules**

```bash
grep -n "\.mainHeaderContainer\|\.tabBar\|\.tabActive\|tab-button" src/web/style.css | head -20
```
Note line numbers of each rule for the edits below.

- [ ] **Step 2: Replace `.mainHeaderContainer` rule**

Find the existing `.mainHeaderContainer { ... }` block and replace its body with:

```css
.mainHeaderContainer {
    background: var(--surface-op-header);
    color: var(--text-on-op);
    padding: 8px 12px;
    border-bottom: 1px solid #2b3036;
}
```

- [ ] **Step 3: Update header status/health text colors**

Find `.status-container` and `.health-container` rules. Their text inherits white from the parent now, but explicit data-readout colors should use cyan:

```css
.status-container,
.health-container {
    color: var(--text-on-op);
    font-family: 'JetBrains Mono', 'Courier New', monospace;
    font-size: 12px;
}
.status-container span,
.health-container span {
    color: var(--text-op-data);
}
```

- [ ] **Step 4: Replace `.tabBar` rule**

```css
.tabBar {
    display: flex;
    background: var(--surface-op-header);
    border-bottom: 1px solid #2b3036;
    padding: 0;
}
```

- [ ] **Step 5: Replace tab button rules**

Find `.tabBar button` (and any related `.tab-button`, `.tabActive`) rules and replace with:

```css
.tabBar button {
    flex: 1;
    background: transparent;
    color: #6c757d;
    border: none;
    border-bottom: 3px solid transparent;
    padding: 12px 4px;
    font-size: 11px;
    font-weight: 700;
    letter-spacing: 1.5px;
    text-transform: uppercase;
    font-family: 'JetBrains Mono', 'Courier New', monospace;
    cursor: pointer;
    min-height: 56px;          /* glove-friendly */
}

.tabBar button .tabIcons {
    font-size: 18px;
    margin-bottom: 2px;
    display: block;
}

.tabBar button.tabActive {
    color: var(--text-on-op);
    border-bottom-color: var(--text-on-op);
    background: rgba(255, 255, 255, 0.04);
}
```

- [ ] **Step 6: Regenerate assets and visually verify**

```bash
python scripts/compress_web_assets.py
python3 -m http.server 8080 --directory src/web &
SERVER_PID=$!
sleep 1
echo "Verify on http://localhost:8080/index.html (and DevTools iPhone SE emulation):"
echo "  - Header background is dark #0f1419"
echo "  - Header text is white; voltage/time/wifi readouts are cyan"
echo "  - Tab bar is dark; active tab has white text + 3px white underline"
echo "  - Inactive tabs are gray"
echo "  - Each tab button is at least 56px tall (DevTools → inspect)"
echo "Press Enter when done."
read
kill $SERVER_PID
```

- [ ] **Step 7: Commit**

```bash
git add src/web/style.css
git commit -m "phase 1: dark cockpit header + tab bar"
```

### Task 3: Convert VFO display to dark cockpit

**Files:**
- Modify: `src/web/style.css` (VFO selectors)
- Reference: `src/web/run.html` and `src/web/qrx.html` for VFO markup

- [ ] **Step 1: Identify VFO selectors**

```bash
grep -n "vfo\|VFO\|frequency-display\|freq-display" src/web/style.css | head -20
grep -n "vfo\|class=\"freq" src/web/run.html src/web/qrx.html 2>/dev/null | head -20
```
Note the exact class/id names used for the VFO container, frequency text, and mode tag.

- [ ] **Step 2: Replace VFO container rule**

Use the actual selector found in Step 1 (likely `.vfo-container`, `.vfo-display`, `#vfo`, or similar). Replace with:

```css
/* Replace the actual selector for the VFO container */
.vfo-display {
    background: var(--surface-op-vfo);
    padding: 14px 16px;
    border-bottom: 1px solid #2b3036;
    display: flex;
    align-items: baseline;
    gap: 12px;
}
```

- [ ] **Step 3: Replace VFO frequency text rule (drops blue, becomes neutral)**

```css
/* The selector for the frequency number text (was probably color: var(--primary)) */
.vfo-frequency {
    color: var(--text-on-op);
    font-family: 'JetBrains Mono', 'Courier New', monospace;
    font-size: 26px;
    font-weight: 700;
    letter-spacing: 0.5px;
}
```

- [ ] **Step 4: Replace VFO mode tag rule**

```css
.vfo-mode {
    color: var(--text-op-accent);
    font-family: 'JetBrains Mono', 'Courier New', monospace;
    font-size: 12px;
    font-weight: 700;
    letter-spacing: 1.5px;
    text-transform: uppercase;
}
```

- [ ] **Step 5: Update VFO warning border tokens**

The two warning states (mode warning, privilege violation) keep their existing blend backgrounds but reference new tokens:

```css
.vfo-display.warning-mode {
    border: 3px solid var(--mode-data);
    background: var(--bg-warning-blend);  /* existing */
}
.vfo-display.warning-privilege {
    border: 3px solid var(--state-critical);
    background: var(--bg-danger-blend);   /* existing */
}
```

- [ ] **Step 6: Regenerate assets and verify**

```bash
python scripts/compress_web_assets.py
python3 -m http.server 8080 --directory src/web &
SERVER_PID=$!
sleep 1
echo "Verify on Run page (http://localhost:8080/run.html or via tab from index):"
echo "  - VFO background is dark #15181c"
echo "  - Frequency text is bright white (NOT blue)"
echo "  - Mode tag is amber"
echo "  - Warning border still works when mode is illegal for band"
echo "Press Enter when done."
read
kill $SERVER_PID
```

- [ ] **Step 7: Commit**

```bash
git add src/web/style.css
git commit -m "phase 1: VFO display dark cockpit, freq text neutral"
```

### Task 4: Convert mode bar to dark cockpit + glove-sized buttons

**Files:**
- Modify: `src/web/style.css` (mode button selectors)

- [ ] **Step 1: Identify mode bar and mode-button selectors**

```bash
grep -n "btn-cw\|btn-ssb\|btn-am\|btn-fm\|btn-data\|mode-cw-enabled\|mode-voice-enabled\|mode-data-enabled\|mode-bar\|modeBar" src/web/style.css | head -30
```

- [ ] **Step 2: Add mode bar container rule** (find or create `.mode-bar` / equivalent)

```css
.mode-bar {
    background: var(--surface-op-modebar);
    padding: 8px;
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(80px, 1fr));
    gap: 8px;
    border-bottom: 2px solid #0a0d10;
}
```

- [ ] **Step 3: Update generic mode button base rule + per-mode variants**

Replace mode-button styles with this consolidated set. The per-mode classes (`.mode-cw`, `.mode-voice`, `.mode-data`) reference the new tokens. The disabled state stays gray. The "enabled but not active" pale tints from the old design are dropped — modes are now a binary active/disabled visual.

```css
.mode-bar button,
.mode-button {
    height: 60px;                  /* glove-friendly minimum */
    border-radius: 4px;
    color: var(--text-on-op);
    font-weight: 800;
    font-size: 16px;
    letter-spacing: 1px;
    border: 2px solid rgba(0, 0, 0, 0.4);
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    background: #495057;           /* base / disabled */
}

.mode-bar button:disabled {
    background: #495057;
    color: #adb5bd;
    cursor: not-allowed;
    opacity: 0.6;
}

/* Active mode by class — apply via JS when the mode is selected */
.mode-bar button.active.mode-cw,
.mode-button.active.mode-cw       { background: var(--mode-cw); }
.mode-bar button.active.mode-voice,
.mode-button.active.mode-voice    { background: var(--mode-voice); }
.mode-bar button.active.mode-data,
.mode-button.active.mode-data     { background: var(--mode-data); }

/* Specific button IDs — preserve existing JS contracts */
#btn-cw.active   { background: var(--mode-cw); }
#btn-ssb.active,
#btn-am.active,
#btn-fm.active   { background: var(--mode-voice); }
#btn-data.active { background: var(--mode-data); }
```

- [ ] **Step 4: Find any HTML/JS currently toggling old `.mode-cw-enabled` / `.mode-voice-enabled` / `.mode-data-enabled` classes; replace with `.active` toggling**

```bash
grep -rn "mode-cw-enabled\|mode-voice-enabled\|mode-data-enabled" src/web/*.html src/web/*.js
```
Expected: list of files using those classes. For each, change the JS to toggle `.active` instead. If a file applies these classes via `setAttribute` or `classList.add/remove`, update accordingly. If the only uses are in CSS selectors (and the classes are never toggled at runtime), no JS change is needed — only the CSS in step 3 above.

- [ ] **Step 5: Regenerate assets and verify**

```bash
python scripts/compress_web_assets.py
python3 -m http.server 8080 --directory src/web &
SERVER_PID=$!
sleep 1
echo "Verify on Run page:"
echo "  - Mode bar background is dark #181d22"
echo "  - Each mode button is at least 60×60px"
echo "  - Active mode shows correct color: CW=blue, SSB=green, DATA=amber"
echo "  - Inactive modes are dark gray"
echo "  - Tap any mode → it activates with the right color"
echo "Press Enter when done."
read
kill $SERVER_PID
```

- [ ] **Step 6: Commit**

```bash
git add src/web/style.css src/web/*.js src/web/*.html
git commit -m "phase 1: mode bar dark cockpit, glove-sized targets"
```

---

## Phase 2 — Component sweeps

Per-component pass: action buttons, status pills, toggles, freq steppers. Apply redundant ✓/✕ icons. Move scan/MyCall/auto-refresh-active to cyan.

### Task 5: Convert primary action buttons to charcoal accent

**Files:**
- Modify: `src/web/style.css` (`.btn-primary`, action buttons by id)

- [ ] **Step 1: Identify all primary-action button selectors**

```bash
grep -n "btn-primary\|btn-tune\|btn-spot\|btn-send\|btn-xmit\|btn-scan\|btn-mycall" src/web/style.css | head -30
```

- [ ] **Step 2: Replace `.btn-primary` and primary action variants**

```css
.btn-primary {
    background: var(--action-primary);
    color: var(--action-on-primary);
    border: 2px solid var(--action-primary);
    border-radius: 6px;
    height: 60px;                    /* glove-friendly */
    padding: 0 16px;
    font-weight: 700;
    font-size: 14px;
    letter-spacing: 0.5px;
    cursor: pointer;
}

.btn-primary:hover { opacity: 0.85; }
.btn-primary:active { opacity: 0.7; }

.btn-secondary {
    background: transparent;
    color: var(--action-primary);
    border: 2px solid var(--action-secondary-border);
    border-radius: 6px;
    height: 60px;
    padding: 0 16px;
    font-weight: 700;
    font-size: 14px;
    cursor: pointer;
}

.btn-secondary:hover { opacity: 0.85; }
.btn-secondary:active { opacity: 0.7; }
/* Note: opacity-based feedback works in both themes without per-theme overrides */
```

- [ ] **Step 3: XMIT button — separate critical-state styling**

```css
.btn-xmit {
    background: #495057;
    color: var(--text-on-op);
    border: 2px solid #343a40;
    border-radius: 6px;
    height: 60px;
    padding: 0 16px;
    font-weight: 800;
    font-size: 14px;
    letter-spacing: 1px;
    cursor: pointer;
    font-family: 'JetBrains Mono', 'Courier New', monospace;
}

.btn-xmit.active {
    background: var(--state-critical);
    border-color: #a51111;
    animation: pulse-critical 1.4s ease-in-out infinite;
}

@keyframes pulse-critical {
    0%, 100% { opacity: 1; }
    50% { opacity: 0.55; }
}
```

- [ ] **Step 4: Spot/Send/Tune buttons inherit `.btn-primary` — verify HTML uses that class**

```bash
grep -rn "btn-tune\|btn-spot\|btn-send\|class=\"btn" src/web/*.html | head -20
```
If any use only an ID without `.btn-primary`, add the class to the HTML, e.g.:
```html
<!-- before -->
<button id="btn-tune-spot">Tune Spot</button>
<!-- after -->
<button id="btn-tune-spot" class="btn-primary">Tune Spot</button>
```

- [ ] **Step 5: Regenerate assets and verify**

```bash
python scripts/compress_web_assets.py
python3 -m http.server 8080 --directory src/web &
SERVER_PID=$!
sleep 1
echo "Verify on Run page:"
echo "  - Tune Spot, Send, etc. are charcoal-filled with white text"
echo "  - Buttons are 60px tall"
echo "  - XMIT button is gray; tap to activate → red pulsing"
echo "Press Enter when done."
read
kill $SERVER_PID
```

- [ ] **Step 6: Commit**

```bash
git add src/web/style.css src/web/*.html
git commit -m "phase 2: action buttons charcoal accent + glove targets"
```

### Task 6: Status pills with redundant ✓/✕ icons

**Files:**
- Modify: `src/web/style.css` (status pill styles)
- Modify: `src/web/bandprivileges.js` and any other JS that emits status pills

- [ ] **Step 1: Find status pill selectors and JS that creates them**

```bash
grep -n "pill\|badge\|allowed\|denied" src/web/style.css | head -20
grep -rn "ALLOWED\|DENIED\|allowed\|denied" src/web/*.js | head -20
```

- [ ] **Step 2: Define status pill base + variants**

```css
.status-pill {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    padding: 6px 12px;
    border-radius: 14px;
    font-size: 12px;
    font-weight: 600;
    border: 1.5px solid;
    line-height: 1;
}

.status-pill.ok {
    background: var(--status-ok-bg);
    color: var(--status-ok-fg);
    border-color: var(--status-ok-border);
}

.status-pill.no {
    background: var(--state-critical-pastel-bg);
    color: var(--state-critical-pastel-fg);
    border-color: var(--state-critical-pastel-fg);
}

.status-pill.na {
    background: var(--status-na-bg);
    color: var(--status-na-fg);
    border-color: var(--status-na-border);
}

/* Icon prefix is added via ::before — no HTML change needed for the icon itself */
.status-pill.ok::before { content: "✓"; font-weight: 700; }
.status-pill.no::before { content: "✕"; font-weight: 700; }
```

- [ ] **Step 3: Update JS that creates pills**

Find the function(s) in `bandprivileges.js` (and others) that build status badges and ensure they emit `<span class="status-pill ok|no|na">LABEL</span>`. Example transform:

```javascript
// before (illustrative — match the actual code)
function buildPrivilegeBadge(klass, allowed) {
    const span = document.createElement('span');
    span.className = allowed ? 'badge-allowed' : 'badge-denied';
    span.textContent = klass;
    return span;
}

// after
function buildPrivilegeBadge(klass, allowed) {
    const span = document.createElement('span');
    span.className = 'status-pill ' + (allowed ? 'ok' : 'na');
    span.textContent = klass;
    return span;
}
```

The icon (✓ or ✕) is added by CSS `::before` automatically; no JS change for the glyph is needed. Use `na` (neutral gray) for "not in my privileges" and `no` (red pastel) only for hard rule violations.

- [ ] **Step 4: Regenerate assets and verify**

```bash
python scripts/compress_web_assets.py
python3 -m http.server 8080 --directory src/web &
SERVER_PID=$!
sleep 1
echo "Verify on a page that shows license badges (likely Run or QRX):"
echo "  - 'Allowed' badges show ✓ in green pastel"
echo "  - 'Not in my privileges' badges show neutral gray (no icon, no red)"
echo "  - DevTools → Rendering → Emulate vision deficiency → Deuteranopia: ✓ icon still distinguishes allowed"
echo "Press Enter when done."
read
kill $SERVER_PID
```

- [ ] **Step 5: Commit**

```bash
git add src/web/style.css src/web/*.js
git commit -m "phase 2: status pills with redundant ✓/✕ icons"
```

### Task 7: Move scan / MyCall / auto-refresh to cyan transient state

**Files:**
- Modify: `src/web/style.css` (selectors for these buttons)

- [ ] **Step 1: Find existing scan/MyCall/auto-refresh selectors**

```bash
grep -n "btn-scan\|btn-mycall\|auto-refresh\|btn-refresh" src/web/style.css | head -20
```

- [ ] **Step 2: Add transient-state styles**

```css
.btn-scan,
.btn-mycall,
.btn-refresh {
    background: #495057;
    color: var(--text-on-op);
    border: 2px solid #343a40;
    border-radius: 6px;
    height: 60px;
    padding: 0 16px;
    font-weight: 700;
    font-size: 13px;
    letter-spacing: 1px;
    cursor: pointer;
}

.btn-scan.active,
.btn-mycall.active,
.btn-refresh.active,
.btn-auto-refresh-active {
    background: var(--state-transient);
    border-color: #0c7e8c;
    animation: pulse-transient 1.6s ease-in-out infinite;
}

@keyframes pulse-transient {
    0%, 100% { opacity: 1; }
    50% { opacity: 0.6; }
}

/* Auto-refresh active — non-button (e.g., a glow on the table refresh icon) */
.auto-refresh-glow {
    box-shadow: 0 0 12px rgba(16, 152, 173, 0.55);
    border-color: var(--state-transient) !important;
}
```

- [ ] **Step 3: Find any inline color: red / background: var(--danger) on these buttons in JS and remove**

```bash
grep -rn "btn-scan\|btn-mycall\|auto-refresh" src/web/*.js | grep -i "style\|color\|background" | head -20
```
If JS sets inline colors for these buttons, switch to toggling `.active` class instead.

- [ ] **Step 4: Regenerate assets and verify**

```bash
python scripts/compress_web_assets.py
python3 -m http.server 8080 --directory src/web &
SERVER_PID=$!
sleep 1
echo "Verify:"
echo "  - Tap Scan → button becomes cyan pulsing"
echo "  - Tap MyCall → button becomes cyan pulsing"
echo "  - Auto-refresh active → cyan glow"
echo "  - XMIT pulses red (unchanged); cyan and red coexist visibly distinct"
echo "Press Enter when done."
read
kill $SERVER_PID
```

- [ ] **Step 5: Commit**

```bash
git add src/web/style.css src/web/*.js
git commit -m "phase 2: scan/MyCall/auto-refresh use cyan transient state"
```

### Task 8: Toggle switches — charcoal-on, gray-off

**Files:**
- Modify: `src/web/style.css` (toggle switch selectors)

- [ ] **Step 1: Find toggle switch CSS**

```bash
grep -n "toggle\|switch\|slider" src/web/style.css | head -20
```

- [ ] **Step 2: Replace toggle styling**

The exact selectors will depend on existing markup. Adapt this template:

```css
/* Container — input[type=checkbox] is hidden; .toggle-track is the visible switch */
.toggle-track {
    position: relative;
    display: inline-block;
    width: 52px;
    height: 28px;
    background: #adb5bd;
    border-radius: 14px;
    cursor: pointer;
    transition: background 0.15s;
    flex-shrink: 0;
}

.toggle-track::after {
    content: '';
    position: absolute;
    top: 3px;
    left: 3px;
    width: 22px;
    height: 22px;
    background: #ffffff;
    border-radius: 50%;
    transition: transform 0.15s;
}

input[type="checkbox"]:checked + .toggle-track,
.toggle-track.on {
    background: var(--action-primary);
}

input[type="checkbox"]:checked + .toggle-track::after,
.toggle-track.on::after {
    transform: translateX(24px);
}

/* Hidden checkbox */
.toggle-input {
    position: absolute;
    opacity: 0;
    pointer-events: none;
}
```

- [ ] **Step 3: Regenerate and verify**

```bash
python scripts/compress_web_assets.py
python3 -m http.server 8080 --directory src/web &
SERVER_PID=$!
sleep 1
echo "Verify on Settings page:"
echo "  - Toggle off = gray track + white thumb"
echo "  - Toggle on = charcoal track + white thumb shifted right"
echo "  - Tap area is at least 28px tall (smaller than 48px target — for gloves this is OK only because the row containing the toggle is the tap area; see Task 11 for row sizing)"
echo "Press Enter when done."
read
kill $SERVER_PID
```

- [ ] **Step 4: Commit**

```bash
git add src/web/style.css
git commit -m "phase 2: toggles charcoal-on, drops blue"
```

### Task 9: Frequency steppers — outlined neutrals with arrows

**Files:**
- Modify: `src/web/style.css`
- Reference: search for the actual freq stepper markup

- [ ] **Step 1: Find freq stepper selectors and HTML**

```bash
grep -rn "btn-freq\|freq-up\|freq-down\|stepper" src/web/*.css src/web/*.html src/web/*.js | head -20
```

- [ ] **Step 2: Replace freq stepper styling**

```css
.btn-freq,
.btn-freq.up,
.btn-freq.down {
    background: transparent;
    color: var(--action-primary);
    border: 2px solid var(--action-primary);
    border-radius: 4px;
    width: 56px;
    height: 48px;
    font-weight: 800;
    font-size: 18px;
    cursor: pointer;
    display: inline-flex;
    align-items: center;
    justify-content: center;
}

.btn-freq:active {
    background: rgba(0, 0, 0, 0.08);
}
```

- [ ] **Step 3: Update HTML to use arrow glyphs** (if buttons have text instead of arrows)

If existing markup is `<button class="btn-freq up">Up</button>`, change to:
```html
<button class="btn-freq up" aria-label="Increase frequency">▲</button>
<button class="btn-freq down" aria-label="Decrease frequency">▼</button>
```

- [ ] **Step 4: Regenerate and verify**

```bash
python scripts/compress_web_assets.py
python3 -m http.server 8080 --directory src/web &
SERVER_PID=$!
sleep 1
echo "Verify on Run/QRX page where freq is adjustable:"
echo "  - Up and down both look identical (outlined charcoal with arrow)"
echo "  - No green/red coding"
echo "  - Each button at least 48px tall × 56px wide"
echo "Press Enter when done."
read
kill $SERVER_PID
```

- [ ] **Step 5: Commit**

```bash
git add src/web/style.css src/web/*.html
git commit -m "phase 2: freq steppers outlined neutrals (drops good/bad coding)"
```

---

## Phase 3 — Special-domain refactors

### Task 10: Tokenize band rainbow

**Files:**
- Modify: `src/web/style.css` (the existing band-color block)

- [ ] **Step 1: Find existing band-color rules**

```bash
grep -n "rgba.*0\.35\|rgba.*0\.4" src/web/style.css | head -30
grep -n "\.band-160\|\.band-80\|\.band-40\|\.band-20" src/web/style.css | head -10
```

- [ ] **Step 2: Add band-color tokens to `:root`** (insert into the new-token block from Task 1)

```css
    /* Band rainbow — solid hue tokens, opacity applied separately */
    --band-160m: 124, 252, 0;       /* lime green */
    --band-80m:  229, 80, 229;
    --band-60m:  0, 0, 139;
    --band-40m:  89, 89, 255;
    --band-30m:  98, 217, 98;
    --band-20m:  242, 196, 12;
    --band-17m:  242, 242, 97;
    --band-15m:  204, 161, 102;
    --band-12m:  178, 34, 34;
    --band-10m:  255, 105, 180;
    --band-6m:   255, 0, 0;
    --band-2m:   255, 20, 147;
    --band-70cm: 153, 153, 0;
    --band-23cm: 90, 184, 199;
    --band-2200m: 255, 69, 0;
    --band-600m:  30, 144, 255;
    --band-11m:   0, 255, 0;
    --band-8m:    127, 0, 241;
    --band-5m:    224, 224, 224;
    --band-4m:    204, 0, 68;
    --band-1-25m: 204, 255, 0;      /* 1.25m */
    --band-2-4GHz: 255, 127, 80;    /* 2.4GHz */
    --band-5-8GHz: 204, 0, 153;
    --band-10GHz:  105, 105, 105;
    --band-24GHz:  243, 237, 198;
    --band-47GHz:  255, 231, 134;
    --band-76GHz:  186, 249, 216;
```

(Tokens store the RGB triplets so opacity can be applied via `rgba(var(--band-20m), var(--band-opacity))`.)

- [ ] **Step 3: Replace existing band-cell rules to use the tokens**

Replace each existing band rule. Pattern:

```css
/* before */
.band-20m { background-color: rgba(242, 196, 12, 0.35); }

/* after */
.band-20m { background-color: rgba(var(--band-20m), var(--band-opacity)); }
```

Apply this transform to all 27 band rules. Bands 17m and any other special-opacity rules should still use `var(--band-opacity)` — the value is uniform now.

- [ ] **Step 4: Regenerate and visually verify chase table**

```bash
python scripts/compress_web_assets.py
python3 -m http.server 8080 --directory src/web &
SERVER_PID=$!
sleep 1
echo "Verify on Chase page (http://localhost:8080/chase.html):"
echo "  - Each band cell looks visually identical to before (same color, same opacity 0.35)"
echo "Press Enter when done."
read
kill $SERVER_PID
```

- [ ] **Step 5: Commit**

```bash
git add src/web/style.css
git commit -m "phase 3: tokenize band-rainbow, opacity now theme-aware"
```

### Task 11: Tokenize program/type badges

**Files:**
- Modify: `src/web/style.css` (program badge rules)

- [ ] **Step 1: Find program-badge rules**

```bash
grep -n "sota\|pota\|wwff\|gma\|iota\|wca\|zlota\|wwbota\|hema" src/web/style.css | head -20
```

- [ ] **Step 2: Add program tokens to `:root`**

```css
    /* Type / program badges */
    --program-sota:   #8b4513;
    --program-pota:   #2f855a;
    --program-wwff:   #d69e2e;
    --program-gma:    #805ad5;
    --program-iota:   #3182ce;
    --program-wca:    #744210;
    --program-zlota:  #4b0082;
    --program-wwbota: #38a169;
    --program-hema:   #d69e2e;
```

- [ ] **Step 3: Replace each program-badge rule to reference tokens**

```css
/* Pattern */
.badge-sota { background: var(--program-sota); color: #ffffff; }
.badge-pota { background: var(--program-pota); color: #ffffff; }
.badge-wwff { background: var(--program-wwff); color: #212529; }
.badge-gma  { background: var(--program-gma);  color: #ffffff; }
.badge-iota { background: var(--program-iota); color: #ffffff; }
.badge-wca  { background: var(--program-wca);  color: #ffffff; }
.badge-zlota { background: var(--program-zlota); color: #ffffff; }
.badge-wwbota { background: var(--program-wwbota); color: #ffffff; }
.badge-hema { background: var(--program-hema); color: #212529; }
```

Use the actual selectors from Step 1.

- [ ] **Step 4: Regenerate and verify**

```bash
python scripts/compress_web_assets.py
echo "Visual check: Chase page → program badges identical to before."
```

- [ ] **Step 5: Commit**

```bash
git add src/web/style.css
git commit -m "phase 3: tokenize program badges"
```

### Task 12: Spot-age gradient — theme-aware function

**Files:**
- Modify: `src/web/chase.js` (around line 950 — search for the `hsl(0, 80%` literal)

- [ ] **Step 1: Find the existing inline HSL assignment**

```bash
grep -n "hsl(0\|backgroundColor.*hsl\|lightness" src/web/chase.js | head -10
```

- [ ] **Step 2: Extract the lightness calculation into a theme-aware helper**

In `chase.js`, add this function near the top of the file (or in an appropriate utility section):

```javascript
/**
 * Compute spot-age background color for a given age in minutes.
 * Theme-aware: light theme returns warm pink-to-red; dark theme returns
 * warm dim-to-muted-red. Returns 'transparent' for fresh spots (<5 min).
 */
function spotAgeColor(ageMinutes) {
    if (ageMinutes < 5) return 'transparent';
    const theme = document.documentElement.getAttribute('data-theme') || 'light';
    const t = Math.min(1, (ageMinutes - 5) / 55);  // 5min → 0.0, 60min → 1.0

    if (theme === 'dark') {
        // hsl(0, 0%→50%, 14%→26%)
        const sat = Math.round(t * 50);
        const lit = Math.round(14 + t * 12);
        return `hsl(0, ${sat}%, ${lit}%)`;
    }
    // light: hsl(0, 80%, 97%→75%)
    const lit = Math.round(97 - t * 22);
    return `hsl(0, 80%, ${lit}%)`;
}
```

- [ ] **Step 3: Replace the inline lightness calculation site (around line 950) to call the helper**

Find the existing block (likely something like):
```javascript
utcCell.style.backgroundColor = `hsl(0, 80%, ${lightness}%)`;
```

Replace with:
```javascript
utcCell.style.backgroundColor = spotAgeColor(ageMinutes);
```

Make sure `ageMinutes` is the variable name in scope; if not, adapt to whatever the surrounding code calls it.

- [ ] **Step 4: Regenerate and verify in light theme**

```bash
python scripts/compress_web_assets.py
python3 -m http.server 8080 --directory src/web &
SERVER_PID=$!
sleep 1
echo "Verify on Chase page (light theme — default at this phase):"
echo "  - Fresh spots (just received): no background tint"
echo "  - Older spots: progressive pink → red tint"
echo "  - Use DevTools console: document.documentElement.setAttribute('data-theme','dark') and refresh — spots should now use dim warm tints (verify after Phase 4)"
echo "Press Enter when done."
read
kill $SERVER_PID
```

- [ ] **Step 5: Commit**

```bash
git add src/web/chase.js
git commit -m "phase 3: spot-age gradient theme-aware"
```

### Task 13: License-class badges — adopt status pill tokens

**Files:**
- Modify: `src/web/style.css` (license-badge rules)
- Modify: `src/web/bandprivileges.js`

- [ ] **Step 1: Find license-badge rules**

```bash
grep -n "license\|licence\|class-extra\|class-general\|class-tech\|user-class" src/web/style.css | head -20
```

- [ ] **Step 2: Apply status-pill tokens to license badges**

License badges are a *use* of the status-pill system, not a separate component. Define `.license-badge` as a small modifier on top of `.status-pill` (uppercase, slightly tighter):

```css
.license-badge {
    /* used together with .status-pill .ok|.na — inherits everything else */
    font-size: 11px;
    text-transform: uppercase;
    letter-spacing: 0.5px;
}
```

Then apply the combined classes in markup: `<span class="status-pill ok license-badge">EXTRA</span>` for allowed, `<span class="status-pill na license-badge">TECH</span>` for not-applicable. The ✓ icon comes from the `.status-pill.ok::before` rule defined in Task 6. No separate per-state license-badge rules needed.

- [ ] **Step 3: Update bandprivileges.js if it uses old class names**

```bash
grep -n "denied\|allowed\|class-" src/web/bandprivileges.js | head -20
```
Replace any `'badge-denied'` / `'badge-allowed'` / similar with `'status-pill ok license-badge'` (allowed) or `'status-pill na license-badge'` (not in your privileges).

- [ ] **Step 4: Regenerate and verify**

```bash
python scripts/compress_web_assets.py
python3 -m http.server 8080 --directory src/web &
SERVER_PID=$!
sleep 1
echo "Verify license-class badges (likely on Run page or band-privileges section):"
echo "  - Your class: green pastel + ✓"
echo "  - Higher classes: neutral gray (no icon, no error)"
echo "  - DevTools deuteranopia sim: ✓ icon still distinguishes"
echo "Press Enter when done."
read
kill $SERVER_PID
```

- [ ] **Step 5: Commit**

```bash
git add src/web/style.css src/web/bandprivileges.js
git commit -m "phase 3: license badges adopt status-pill tokens"
```

### Task 14: My-spot row highlight — theme-aware

**Files:**
- Modify: `src/web/style.css` (my-spot rule)

- [ ] **Step 1: Find my-spot styling**

```bash
grep -n "my-spot\|myspot\|bg-my-spot\|border-my-spot" src/web/style.css | head -10
```

- [ ] **Step 2: Replace my-spot rule (light values stay similar; dark variant added in Phase 4)**

```css
.my-spot {
    background: #fff8e1;
    border-left: 4px solid #f59e0b;
    /* Dark theme override added in Phase 4's [data-theme="dark"] block */
}
```

(Phase 4 will add the corresponding `[data-theme="dark"] .my-spot { background: #2a2418; ... }`.)

- [ ] **Step 3: Regenerate and verify**

```bash
python scripts/compress_web_assets.py
echo "Visual check: Chase page my-spot row still highlighted; same look as before in light theme."
```

- [ ] **Step 4: Commit**

```bash
git add src/web/style.css
git commit -m "phase 3: my-spot rule prepared for theme override"
```

---

## Phase 4 — Dark theme

### Task 15: Add `[data-theme="dark"]` block

**Files:**
- Modify: `src/web/style.css` (append a single block at the end)

- [ ] **Step 1: Append dark theme overrides**

Append at the END of `style.css`:

```css
/* ============================================================================
   DARK THEME (Phase 4 — Color Redesign 2026-05-02)
   Activated by html[data-theme="dark"] (set by inline script in <head>).
   Operational chrome (header, VFO, mode bar) is always dark — no override needed.
   ============================================================================ */
[data-theme="dark"] {
    /* Surfaces */
    --surface-page: #0a0d10;
    --surface-card: #181d22;

    /* Text */
    --text-primary-new: #f1f3f5;
    --text-secondary-new: #adb5bd;

    /* Action accent — inverts (light fill on dark theme) */
    --action-primary: #f1f3f5;
    --action-on-primary: #0a0d10;
    --action-secondary-border: #f1f3f5;

    /* Status pills — darker bgs, lighter text */
    --state-critical-pastel-bg: #3b1f1f;
    --state-critical-pastel-fg: #ff8787;

    --status-ok-bg: #1f2e23;
    --status-ok-fg: #69db7c;
    --status-ok-border: #2b8a3e;

    --status-na-bg: #1c1f23;
    --status-na-fg: #adb5bd;
    --status-na-border: #2b3036;

    /* Borders */
    --border-default-new: #2b3036;
    --border-strong: #000000;

    /* Band-rainbow opacity bumped for visibility on dark */
    --band-opacity: 0.55;

    /* Compat shims also need dark overrides for any consumer not yet migrated */
    --primary: var(--mode-cw);            /* unchanged hue */
    --success: var(--status-ok-fg);
    --danger: var(--state-critical);
    --warning: var(--mode-data);
}

/* Body / page-level surfaces. Use with whatever the page-bg selector is. */
[data-theme="dark"] body {
    background: var(--surface-page);
    color: var(--text-primary-new);
}

/* Cards */
[data-theme="dark"] .section-card,
[data-theme="dark"] .settings-card,
[data-theme="dark"] .card,
[data-theme="dark"] table {
    background: var(--surface-card);
    color: var(--text-primary-new);
}

/* Toggle dark variant */
[data-theme="dark"] .toggle-track {
    background: #495057;
}
[data-theme="dark"] input[type="checkbox"]:checked + .toggle-track,
[data-theme="dark"] .toggle-track.on {
    background: var(--action-primary);  /* light fill */
}
[data-theme="dark"] .toggle-track::after {
    background: #ffffff;
}
[data-theme="dark"] input[type="checkbox"]:checked + .toggle-track::after,
[data-theme="dark"] .toggle-track.on::after {
    background: #212529;
}

/* My-spot row */
[data-theme="dark"] .my-spot {
    background: #2a2418;
    color: var(--text-primary-new);
}

/* Band cells in dark theme — bands needing dark text (yellow/gold) */
[data-theme="dark"] .band-20m,
[data-theme="dark"] .band-17m,
[data-theme="dark"] .band-24GHz,
[data-theme="dark"] .band-47GHz,
[data-theme="dark"] .band-1-25m {
    color: #212529;
}
/* All other bands need light text on dark surface */
[data-theme="dark"] [class*="band-"] {
    color: var(--text-primary-new);
}
/* Specificity will resolve correctly because the per-band-with-dark-text rules
   above use single-class selectors and come first. If the override doesn't take,
   add !important to the dark-text bands. */
```

- [ ] **Step 2: Manually test dark theme via DevTools**

```bash
python scripts/compress_web_assets.py
python3 -m http.server 8080 --directory src/web &
SERVER_PID=$!
sleep 1
echo "In browser console: document.documentElement.setAttribute('data-theme','dark')"
echo "Verify:"
echo "  - Body becomes near-black"
echo "  - Cards become #181d22 (dark gray)"
echo "  - Operational chrome (header, VFO, mode bar) is UNCHANGED — still dark"
echo "  - Status pills have inverted bg/fg"
echo "  - Toggle on = light fill, off = mid-gray"
echo "  - Band cells readable (light text on bands; dark text on yellow bands)"
echo "Then: document.documentElement.setAttribute('data-theme','light') — back to normal"
echo "Press Enter when done."
read
kill $SERVER_PID
```

- [ ] **Step 3: Commit**

```bash
git add src/web/style.css
git commit -m "phase 4: add [data-theme=dark] CSS block"
```

---

## Phase 5 — Theme toggle UI + persistence

### Task 16: Add no-flash inline `<script>` to all HTML pages

**Files:**
- Modify: `src/web/index.html`, `src/web/about.html`, `src/web/chase.html`, `src/web/qrx.html`, `src/web/run.html`, `src/web/settings.html`

- [ ] **Step 1: Insert inline script just inside `<head>`, BEFORE `<link rel="stylesheet">`**

For each HTML file in `src/web/`, add this `<script>` block as the first child of `<head>` (immediately after `<meta charset="UTF-8" />` is fine):

```html
<script>
    (function () {
        try {
            var saved = localStorage.getItem('sotacat-theme') || 'auto';
            var prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
            var dark = saved === 'dark' || (saved === 'auto' && prefersDark);
            document.documentElement.setAttribute('data-theme', dark ? 'dark' : 'light');
        } catch (e) {
            document.documentElement.setAttribute('data-theme', 'light');
        }
    })();
</script>
```

This block must appear before the stylesheet `<link>` so the attribute is set before CSS computes.

- [ ] **Step 2: Verify each file**

```bash
for f in src/web/index.html src/web/about.html src/web/chase.html src/web/qrx.html src/web/run.html src/web/settings.html; do
    grep -q "sotacat-theme" "$f" && echo "OK: $f" || echo "MISSING: $f"
done
```
Expected: all six lines say "OK".

- [ ] **Step 3: Regenerate and verify no-flash**

```bash
python scripts/compress_web_assets.py
python3 -m http.server 8080 --directory src/web &
SERVER_PID=$!
sleep 1
echo "In browser console: localStorage.setItem('sotacat-theme','dark'); location.reload();"
echo "Verify: page loads in dark theme on first paint, no light flash visible."
echo "Then: localStorage.removeItem('sotacat-theme'); location.reload();"
echo "Expected: theme follows OS preference; no flash."
echo "Press Enter when done."
read
kill $SERVER_PID
```

- [ ] **Step 4: Commit**

```bash
git add src/web/*.html
git commit -m "phase 5: no-flash inline theme script in all pages"
```

### Task 17: Add theme toggle segmented control to settings.html

**Files:**
- Modify: `src/web/settings.html` (add the segmented control near the top of the settings body)
- Modify: `src/web/style.css` (add segmented control styling)

- [ ] **Step 1: Add segmented control markup**

In `src/web/settings.html`, find the start of the settings list / first settings card and insert this block at the top:

```html
<div class="settings-row" id="theme-row">
    <div class="settings-label">
        <div class="label">Theme</div>
        <div class="meta" id="theme-meta">Auto follows system</div>
    </div>
    <div class="seg-control" role="radiogroup" aria-label="Theme">
        <button class="seg-btn" data-theme-value="auto" role="radio">AUTO</button>
        <button class="seg-btn" data-theme-value="light" role="radio">LIGHT</button>
        <button class="seg-btn" data-theme-value="dark" role="radio">DARK</button>
    </div>
</div>
```

(Adapt `.settings-row` / `.settings-label` to whatever the existing settings markup uses — match the pattern of an adjacent setting.)

- [ ] **Step 2: Add segmented control styling to style.css**

```css
.seg-control {
    display: inline-flex;
    background: rgba(0, 0, 0, 0.04);
    border: 2px solid var(--border-default-new);
    border-radius: 8px;
    overflow: hidden;
    padding: 2px;
    gap: 0;
}

.seg-btn {
    background: transparent;
    color: var(--text-secondary-new);
    border: none;
    padding: 10px 18px;
    font-size: 12px;
    font-weight: 700;
    border-radius: 6px;
    cursor: pointer;
    font-family: 'JetBrains Mono', 'Courier New', monospace;
    letter-spacing: 1px;
    min-height: 44px;
}

.seg-btn.active {
    background: var(--action-primary);
    color: var(--action-on-primary);
}

[data-theme="dark"] .seg-control {
    background: rgba(255, 255, 255, 0.04);
    border-color: var(--border-default-new);
}
```

- [ ] **Step 3: Regenerate and verify (without functionality yet)**

```bash
python scripts/compress_web_assets.py
python3 -m http.server 8080 --directory src/web &
SERVER_PID=$!
sleep 1
echo "On Settings page: confirm the AUTO/LIGHT/DARK segmented control appears at the top. Buttons don't do anything yet — that's Task 18."
echo "Press Enter when done."
read
kill $SERVER_PID
```

- [ ] **Step 4: Commit**

```bash
git add src/web/settings.html src/web/style.css
git commit -m "phase 5: add theme toggle segmented control to settings"
```

### Task 18: Wire up settings.js theme toggle logic

**Files:**
- Modify: `src/web/settings.js`

- [ ] **Step 1: Append theme toggle init function**

Add to `settings.js`:

```javascript
function initThemeToggle() {
    const buttons = document.querySelectorAll('#theme-row .seg-btn');
    const meta = document.getElementById('theme-meta');
    const mql = window.matchMedia('(prefers-color-scheme: dark)');

    function applyTheme(value) {
        const dark = value === 'dark' || (value === 'auto' && mql.matches);
        document.documentElement.setAttribute('data-theme', dark ? 'dark' : 'light');
    }

    function updateUi(value) {
        buttons.forEach(b => {
            b.classList.toggle('active', b.dataset.themeValue === value);
        });
        if (meta) {
            meta.textContent = value === 'auto'
                ? 'Auto follows system'
                : (value === 'dark' ? 'Dark theme' : 'Light theme');
        }
    }

    function setTheme(value) {
        localStorage.setItem('sotacat-theme', value);
        applyTheme(value);
        updateUi(value);
    }

    buttons.forEach(b => {
        b.addEventListener('click', () => setTheme(b.dataset.themeValue));
    });

    // React to OS preference changes when set to auto
    mql.addEventListener('change', () => {
        if ((localStorage.getItem('sotacat-theme') || 'auto') === 'auto') {
            applyTheme('auto');
        }
    });

    // Initial UI sync (theme attr was already set by the inline <head> script)
    const current = localStorage.getItem('sotacat-theme') || 'auto';
    updateUi(current);
}

// Call from existing init function, or on DOMContentLoaded if no init pattern exists
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initThemeToggle);
} else {
    initThemeToggle();
}
```

If `settings.js` already has a single init function called on load, integrate `initThemeToggle()` into that flow instead of attaching a second listener.

- [ ] **Step 2: Regenerate and verify**

```bash
python scripts/compress_web_assets.py
python3 -m http.server 8080 --directory src/web &
SERVER_PID=$!
sleep 1
echo "On Settings page:"
echo "  - The currently-active button is highlighted (matches what's stored / OS preference)"
echo "  - Click LIGHT → page flips to light, button highlight moves, meta text updates"
echo "  - Click DARK → page flips to dark"
echo "  - Click AUTO → page follows OS preference; meta says 'Auto follows system'"
echo "  - Reload page: theme persists; segmented control still shows the right active state"
echo "  - Switch to another tab (Run/Chase) and back: still themed correctly"
echo "Press Enter when done."
read
kill $SERVER_PID
```

- [ ] **Step 3: Commit**

```bash
git add src/web/settings.js
git commit -m "phase 5: wire up theme toggle logic + persistence"
```

---

## Phase 6 — Cleanup

### Task 19: Remove compat shims from `:root`

**Files:**
- Modify: `src/web/style.css`

- [ ] **Step 1: Confirm no consumers reference the old tokens**

```bash
for tok in primary primary-dark primary-light success success-dark danger danger-dark warning warning-dark; do
    n=$(grep -c "var(--$tok)" src/web/style.css)
    echo "$tok: $n references"
done
```
Expected: each line shows 0 references. If any non-zero, a Phase 1–4 task missed converting it — go fix that consumer first, then return.

- [ ] **Step 2: Delete the compat shim block from `:root`**

Remove the block in `:root` that starts with `/* COMPAT SHIMS */` (added in Task 1) and the duplicate `--primary`, `--success`, etc. in the dark-theme block.

Also remove the OLD original `--primary: #228be6;` etc. lines that predated this redesign (the originals from before Task 1) — they were left in place because the shim block overrode them, but now both can go.

- [ ] **Step 3: Regenerate and verify nothing breaks**

```bash
python scripts/compress_web_assets.py
python3 -m http.server 8080 --directory src/web &
SERVER_PID=$!
sleep 1
echo "Smoke test all pages: QRX, Chase, Run, Settings, About — visually unchanged from end of Phase 5."
echo "Press Enter when done."
read
kill $SERVER_PID
```

- [ ] **Step 4: Commit**

```bash
git add src/web/style.css
git commit -m "phase 6: remove compat shims"
```

### Task 20: Remove unreferenced old colors and the prefers-contrast block

**Files:**
- Modify: `src/web/style.css`

- [ ] **Step 1: Identify candidates for removal**

```bash
# Old enabled-tint mode classes
for tok in mode-cw-enabled mode-voice-enabled mode-data-enabled mode-cw-color mode-data-color mode-phone-color; do
    n=$(grep -c "var(--$tok)\|\.$tok" src/web/style.css)
    echo "$tok: $n references"
done
```

For each token with 0 references in CSS *and* in JS (`grep -rn "$tok" src/web/*.js`), delete the `:root` declaration.

- [ ] **Step 2: Remove the `@media (prefers-contrast: high)` block**

```bash
grep -n "prefers-contrast" src/web/style.css
```
Note the line number, then delete the entire block from `@media (prefers-contrast: high) {` through its closing `}`. The new design's defaults (thicker borders, larger touch targets, redundant icons) cover what that block provided.

- [ ] **Step 3: Regenerate and verify**

```bash
python scripts/compress_web_assets.py
python3 -m http.server 8080 --directory src/web &
SERVER_PID=$!
sleep 1
echo "Smoke test all pages — visually unchanged from end of Task 19."
echo "Press Enter when done."
read
kill $SERVER_PID
```

- [ ] **Step 4: Commit**

```bash
git add src/web/style.css
git commit -m "phase 6: remove unused tokens + prefers-contrast block"
```

---

## Final verification (cross-phase)

### Task 21: End-to-end on real hardware (or full DevTools emulation if hardware unavailable)

**Files:** None (verification only)

- [ ] **Step 1: Build and flash the firmware (or use the dev server if hardware is unavailable)**

```bash
make build
make upload
```
Or for dev-server-only verification:
```bash
python3 -m http.server 8080 --directory src/web
```

- [ ] **Step 2: Run the per-phase test protocol from spec §8**

For each scenario, exercise every operational page (QRX, Chase, Run) and the configuration pages (Settings, About):

- **Outdoor in sun:** VFO frequency legible at arm's length; mode badges distinguishable; action buttons visible; tab indicator clear.
- **Indoor / dim:** No eye strain; status pills readable; no harsh contrast spikes; switch to dark theme — same.
- **With gloves:** All primary controls tappable; no accidental adjacent-button presses; mode buttons / action buttons / tab buttons all comfortably hit-able.
- **Color-blind sanity:** DevTools → Rendering → Emulate vision deficiency → Deuteranopia. Allowed/denied pills still distinguishable via ✓/✕ icon.
- **Theme flip mid-session:** Switching via the segmented control updates the UI instantly; no flash; no broken styles.
- **Cold load with stored dark preference:** `localStorage.setItem('sotacat-theme','dark')` then full reload → page renders dark on first paint with no light flash.

- [ ] **Step 3: Document any deviations and create follow-up issues**

If anything doesn't pass, file a separate task. Do not paper over with a quick CSS hack — return to the appropriate phase task and fix it properly. Update the spec doc if the design needs revision.

- [ ] **Step 4: Tag the release**

```bash
git tag -a "v-color-redesign-2026-05-02" -m "Color system redesign complete (6 phases)"
```

---

## Self-review notes

This plan was reviewed against the spec on 2026-05-02. Coverage:

| Spec section | Covered by |
|---|---|
| §4.1 Surfaces (light + dark + always-dark op zones) | Tasks 1, 2, 3, 4, 15 |
| §4.2 Text tokens | Tasks 1, 2, 3, 15 |
| §4.3 Mode hues — locked mapping | Tasks 1, 4 |
| §4.4 Action accent | Tasks 1, 5, 15 |
| §4.5 Critical state + ✕ icon | Tasks 1, 5, 6, 15 |
| §4.6 Transient state (cyan) | Tasks 1, 7 |
| §4.7 Status — allowed (✓) | Tasks 1, 6, 13, 15 |
| §4.8 Status — neutral / not-applicable | Tasks 1, 13, 15 |
| §4.9 Borders ≥2px | Tasks 1, 2, 4, 5, 9, 17 |
| §5.1 Band rainbow tokenized + theme-aware opacity | Tasks 10, 15 |
| §5.2 Program badges tokenized | Task 11 |
| §5.3 License badges with new tokens | Task 13 |
| §5.4 Spot-age gradient theme-aware | Task 12 |
| §5.5 My-spot row theme-aware | Tasks 14, 15 |
| §5.6 VFO warnings | Task 3 |
| §5.7 Activation-mode cells use mode tokens | Implicit via Task 4 (mode tokens replace one-offs) |
| §5.8 Auto-refresh active uses transient | Task 7 |
| §5.9 Tab bar — white text + underline | Task 2 |
| §5.10 Frequency steppers neutral | Task 9 |
| §5.11 Toggle switches charcoal-on | Tasks 8, 15 |
| §6.1 Page archetypes | Tasks 2-4 (operational), default cards/forms unchanged structure for config |
| §6.2 Tab order (already correct in code) | No change needed; verified during writing |
| §6.3 Theme switching mechanism | Tasks 16, 17, 18 |
| §7 Six-phase migration | Phases 0–6 = Tasks 1–20 |
| §8 Per-phase testing | Embedded in each task's verify step + Task 21 |
| §9 Risks (theme flash, gzip regen, shim creep) | Mitigated by Task 16 (inline script), gzip step in every task, Task 19 (shim removal) |
