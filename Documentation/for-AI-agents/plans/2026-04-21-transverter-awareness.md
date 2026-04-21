# Transverter Awareness Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a per-radio capability model (native ∪ learned bands) driving dynamic CAT-page band buttons and chase-filter behavior, so KX2/KX3/KH1 owners with or without transverters see only the bands their radio can reach — with auto-learning from radio-confirmed `FA` polls and a Forget escape hatch in settings.

**Architecture:** A pure-frontend change. `src/web/main.js` owns corrected native-band tables, a `CapabilityState` helper module that merges native + learned bands per radio type and manages localStorage persistence. `src/web/run.js` renders the band-button grid dynamically with a dangler-avoiding column count. The VFO poll loop in `run.js` calls `CapabilityState.observe(freqHz)` after each successful `FA` read, which may append to learned and trigger a re-render. `src/web/chase.js` adds a plausible-transverter tier (2m/70cm/23cm) for KX2/KX3 in `applyTableFilters()`. `src/web/settings.html/js` adds a "Radio & Transverters" read-only panel with per-band Forget buttons. No firmware or backend changes.

**Tech Stack:** Vanilla JS (ES modules not used — script-tag load order), no build step (web assets gzip-embedded in ESP32 firmware at build time). Node `vm` sandbox for unit tests (existing pattern from `test_bandprivileges.js`).

**Branch:** `fix/99-transverter-awareness` (already created off `fix/99-vhf-uhf-privileges`). All commits land there.

**Spec:** `Documentation/for-AI-agents/specs/2026-04-21-transverter-awareness-design.md` (cross-reference for any ambiguity).

---

## File Structure

**New files:**
- `test/unit/test_capability.js` — sandbox-loaded tests for capability merging, auto-learn, forget, `bestColumnCount`.

**Modified files:**
- `src/web/main.js` — replace `RADIO_BAND_CAPABILITIES` with per-radio native lists, add `.initial` values for 6m/2m/1p25m/70cm/23cm, add `CapabilityState` object (load/save/observe/forget/getBands/getLastFreqHz).
- `src/web/run.html` — empty out the hardcoded `.band-grid`, keep wrapper.
- `src/web/run.js` — new `bestColumnCount()`, `renderBandButtons()`; update `selectBand()` to use `CapabilityState.getLastFreqHz(band) ?? BAND_PLAN[band].initial`; hook `CapabilityState.observe()` into VFO poll; switch band-button clicks to event delegation.
- `src/web/chase.js` — `applyTableFilters()` extends allowed-bands list with plausible-transverter tier for KX2/KX3 + learned bands.
- `src/web/settings.html` — new "Radio & Transverters" card between "Account" and "Display".
- `src/web/settings.js` — render the new card on load + on `capabilitychange` event; wire Forget buttons.
- `src/web/style.css` — remove fixed `grid-template-columns` on `.band-grid` (line 485).
- `Documentation/user/UI-Tour.md` — describe dynamic band buttons + the new settings panel.
- `Documentation/dev/Web-UI.md` — one-paragraph note on the capability model.

**Commit cadence:** one commit per task. Each commit keeps the full test suite green (`make test-unit`).

---

## Task 1: Unit test scaffolding for CapabilityState

Create the test file early so every subsequent capability-related task is TDD.

**Files:**
- Create: `test/unit/test_capability.js`

- [ ] **Step 1: Create the test file with a sandbox loader that extracts what we need from main.js**

Mirror the pattern from `test/unit/test_bandprivileges.js:82-132`. Extract `BAND_PLAN`, `getBandFromFrequency`, `RADIO_NATIVE_BANDS`, and `CapabilityState` from `src/web/main.js`. `CapabilityState` and `RADIO_NATIVE_BANDS` don't exist yet — the test will initially fail to load, which is what we want.

Write to `test/unit/test_capability.js`:

```js
#!/usr/bin/env node
/**
 * Unit tests for the radio capability model in main.js.
 *
 * Covers:
 * - Native band tables for KX2 / KX3 / KH1 / Unknown
 * - CapabilityState auto-learn from observed FA
 * - Last-observed frequency tracking per band
 * - Forget removes band + its lastFreqHz
 * - Per-radio localStorage namespacing
 * - bestColumnCount() dangler avoidance
 *
 * Usage: node test/unit/test_capability.js
 */

const fs = require('fs');
const path = require('path');
const vm = require('vm');

let testsPassed = 0;
let testsFailed = 0;
const failures = [];

function describe(name, fn) { console.log(`\n${name}`); fn(); }
function it(name, fn) {
    try { fn(); testsPassed++; console.log(`  ✓ ${name}`); }
    catch (e) { testsFailed++; console.log(`  ✗ ${name}`); console.log(`    ${e.message}`);
                failures.push({ name, error: e.message }); }
}
function assertEqual(actual, expected, msg = '') {
    const a = JSON.stringify(actual), e = JSON.stringify(expected);
    if (a !== e) throw new Error(`${msg}: expected ${e}, got ${a}`);
}
function assertTrue(v, msg = '') { if (!v) throw new Error(`${msg}: expected truthy, got ${v}`); }
function assertFalse(v, msg = '') { if (v) throw new Error(`${msg}: expected falsy, got ${v}`); }
function assertIncludes(arr, v, msg = '') {
    if (!arr.includes(v)) throw new Error(`${msg}: expected ${JSON.stringify(arr)} to include ${JSON.stringify(v)}`);
}
function assertExcludes(arr, v, msg = '') {
    if (arr.includes(v)) throw new Error(`${msg}: expected ${JSON.stringify(arr)} NOT to include ${JSON.stringify(v)}`);
}

// ============================================================================
// In-memory localStorage mock
// ============================================================================
function makeLocalStorage() {
    const store = new Map();
    return {
        getItem: (k) => store.has(k) ? store.get(k) : null,
        setItem: (k, v) => store.set(k, String(v)),
        removeItem: (k) => store.delete(k),
        clear: () => store.clear(),
        _dump: () => Object.fromEntries(store),
    };
}

// ============================================================================
// Load helpers from main.js into a sandbox
// ============================================================================
const mainJsPath = path.join(__dirname, '../../src/web/main.js');
const mainJsCode = fs.readFileSync(mainJsPath, 'utf8');

function extract(re, label) {
    const m = mainJsCode.match(re);
    if (!m) { console.error(`Could not extract ${label} from main.js`); process.exit(1); }
    return m[0];
}

const bandPlanSrc     = extract(/const BAND_PLAN = \{[\s\S]*?\n\};/, 'BAND_PLAN');
const getBandFnSrc    = extract(/function getBandFromFrequency\(frequencyHz\) \{[\s\S]*?\n\}/, 'getBandFromFrequency');
const nativeBandsSrc  = extract(/const RADIO_NATIVE_BANDS = \{[\s\S]*?\n\};/, 'RADIO_NATIVE_BANDS');
const capabilitySrc   = extract(/const CapabilityState = \{[\s\S]*?^\};/m, 'CapabilityState');

function freshSandbox() {
    const AppState = { radioType: null };
    const listeners = [];
    const sandbox = {
        AppState,
        localStorage: makeLocalStorage(),
        console,
        document: {
            dispatchEvent: (evt) => listeners.forEach(l => l(evt)),
            addEventListener: (_name, fn) => listeners.push(fn),
        },
        CustomEvent: function(name, init) { this.type = name; this.detail = init && init.detail; },
        Log: { debug: () => () => {}, info: () => () => {}, warn: () => () => {}, error: () => () => {} },
    };
    vm.createContext(sandbox);
    vm.runInContext(bandPlanSrc, sandbox);
    vm.runInContext(getBandFnSrc, sandbox);
    vm.runInContext(nativeBandsSrc, sandbox);
    vm.runInContext(capabilitySrc, sandbox);
    return sandbox;
}

// ============================================================================
// Tests
// ============================================================================

describe('Native band tables', () => {
    it('KX2 covers HF only — no 160m, no 6m', () => {
        const { RADIO_NATIVE_BANDS } = freshSandbox();
        assertEqual(RADIO_NATIVE_BANDS['KX2'],
            ['80m','60m','40m','30m','20m','17m','15m','12m','10m']);
    });
    it('KX3 covers HF + 6m + 160m', () => {
        const { RADIO_NATIVE_BANDS } = freshSandbox();
        assertEqual(RADIO_NATIVE_BANDS['KX3'],
            ['160m','80m','60m','40m','30m','20m','17m','15m','12m','10m','6m']);
    });
    it('KH1 covers a small HF subset', () => {
        const { RADIO_NATIVE_BANDS } = freshSandbox();
        assertEqual(RADIO_NATIVE_BANDS['KH1'], ['40m','20m','17m','15m','10m']);
    });
    it('Unknown → null (show all)', () => {
        const { RADIO_NATIVE_BANDS } = freshSandbox();
        assertEqual(RADIO_NATIVE_BANDS['Unknown'], null);
    });
});

describe('CapabilityState.getBands', () => {
    it('KX2 with no learned returns native', () => {
        const s = freshSandbox();
        s.AppState.radioType = 'KX2';
        s.CapabilityState.load();
        assertEqual(s.CapabilityState.getBands(),
            ['80m','60m','40m','30m','20m','17m','15m','12m','10m']);
    });
    it('Unknown returns null (filter off)', () => {
        const s = freshSandbox();
        s.AppState.radioType = 'Unknown';
        s.CapabilityState.load();
        assertEqual(s.CapabilityState.getBands(), null);
    });
});

describe('CapabilityState.observe (auto-learn)', () => {
    it('observing a native-band FA updates lastFreqHz but does not append to learned', () => {
        const s = freshSandbox();
        s.AppState.radioType = 'KX2';
        s.CapabilityState.load();
        const added = s.CapabilityState.observe(14225000); // 20m
        assertFalse(added, 'native freq should not trigger learn');
        assertEqual(s.CapabilityState.getLastFreqHz('20m'), 14225000);
        assertExcludes(s.CapabilityState.getLearnedBands(), '20m');
    });
    it('observing 146.580 MHz on KX2 appends 2m to learned', () => {
        const s = freshSandbox();
        s.AppState.radioType = 'KX2';
        s.CapabilityState.load();
        const added = s.CapabilityState.observe(146580000);
        assertTrue(added, 'should return true on new learn');
        assertIncludes(s.CapabilityState.getBands(), '2m');
        assertEqual(s.CapabilityState.getLastFreqHz('2m'), 146580000);
    });
    it('observing same new band twice only learns it once', () => {
        const s = freshSandbox();
        s.AppState.radioType = 'KX2';
        s.CapabilityState.load();
        assertTrue(s.CapabilityState.observe(146580000));
        assertFalse(s.CapabilityState.observe(146520000),
            'second observation of 2m should not re-learn');
        assertEqual(s.CapabilityState.getLastFreqHz('2m'), 146520000);
    });
    it('unparseable frequency is ignored (no learn, no crash)', () => {
        const s = freshSandbox();
        s.AppState.radioType = 'KX2';
        s.CapabilityState.load();
        assertFalse(s.CapabilityState.observe(999999999999)); // above all bands
        assertFalse(s.CapabilityState.observe(null));
        assertFalse(s.CapabilityState.observe(NaN));
    });
});

describe('CapabilityState.forget', () => {
    it('removes band and its lastFreqHz', () => {
        const s = freshSandbox();
        s.AppState.radioType = 'KX3';
        s.CapabilityState.load();
        s.CapabilityState.observe(146580000);
        assertIncludes(s.CapabilityState.getBands(), '2m');
        s.CapabilityState.forget('2m');
        assertExcludes(s.CapabilityState.getBands(), '2m');
        assertEqual(s.CapabilityState.getLastFreqHz('2m'), null);
    });
    it('forget on a non-learned band is a no-op', () => {
        const s = freshSandbox();
        s.AppState.radioType = 'KX3';
        s.CapabilityState.load();
        s.CapabilityState.forget('2m'); // nothing to forget
        assertExcludes(s.CapabilityState.getBands(), '2m');
    });
});

describe('Per-radio localStorage namespacing', () => {
    it('KX2 and KX3 keep separate learned sets', () => {
        const s = freshSandbox();
        s.AppState.radioType = 'KX2';
        s.CapabilityState.load();
        s.CapabilityState.observe(146580000);
        // Switch radio
        s.AppState.radioType = 'KX3';
        s.CapabilityState.load();
        assertExcludes(s.CapabilityState.getLearnedBands(), '2m');
        // Switch back
        s.AppState.radioType = 'KX2';
        s.CapabilityState.load();
        assertIncludes(s.CapabilityState.getLearnedBands(), '2m');
    });
});

describe('Persistence round-trip', () => {
    it('learned bands survive a reload', () => {
        const s1 = freshSandbox();
        s1.AppState.radioType = 'KX2';
        s1.CapabilityState.load();
        s1.CapabilityState.observe(146580000);
        const dump = s1.localStorage._dump();
        // Simulate a page reload: new sandbox, same localStorage contents
        const s2 = freshSandbox();
        for (const [k, v] of Object.entries(dump)) s2.localStorage.setItem(k, v);
        s2.AppState.radioType = 'KX2';
        s2.CapabilityState.load();
        assertIncludes(s2.CapabilityState.getLearnedBands(), '2m');
        assertEqual(s2.CapabilityState.getLastFreqHz('2m'), 146580000);
    });
});

// ============================================================================
// Results
// ============================================================================
console.log(`\n${'='.repeat(60)}`);
console.log(`Results: ${testsPassed} passed, ${testsFailed} failed`);
console.log('='.repeat(60));
if (testsFailed > 0) {
    console.log('\nFailures:');
    failures.forEach(f => console.log(`  ✗ ${f.name}\n    ${f.error}`));
    process.exit(1);
}
```

- [ ] **Step 2: Run the test file and confirm it fails (extractor error is OK)**

Run: `node test/unit/test_capability.js`
Expected: the script exits non-zero with a message like `Could not extract RADIO_NATIVE_BANDS from main.js`. That's the scaffold confirming it would run the tests once the symbols exist.

- [ ] **Step 3: Commit**

```bash
git add test/unit/test_capability.js
git commit -m "add failing test scaffold for capability model"
```

---

## Task 2: Replace RADIO_BAND_CAPABILITIES with RADIO_NATIVE_BANDS

Native tables only. `CapabilityState` wired up next task.

**Files:**
- Modify: `src/web/main.js` (around lines 421-433)

- [ ] **Step 1: Edit `src/web/main.js` — replace the existing `RADIO_BAND_CAPABILITIES` constant and `getRadioBandCapabilities()` function**

Find the block at `src/web/main.js:421-433`:

```js
// Radio band capabilities for filtering chase spots
// KX2/KX3 both cover the same HF bands plus 6m
// null = show all bands (no filtering)
const RADIO_BAND_CAPABILITIES = {
    "KX2": ["160m", "80m", "60m", "40m", "30m", "20m", "17m", "15m", "12m", "10m", "6m"],
    "KX3": ["160m", "80m", "60m", "40m", "30m", "20m", "17m", "15m", "12m", "10m", "6m"],
    "Unknown": null  // null = show all bands (no filtering)
};

// Get list of bands a radio can access (returns array or null for all bands)
function getRadioBandCapabilities(radioType) {
    return RADIO_BAND_CAPABILITIES[radioType] || null;
}
```

Replace with:

```js
// ============================================================================
// Per-radio native band tables
// ============================================================================
// Bands the radio can reach *without* a transverter. Auto-learned bands
// (from observed FA polls) are merged in at runtime by CapabilityState.
// null = unknown radio → show all bands (no filtering).
const RADIO_NATIVE_BANDS = {
    "KX2": ["80m", "60m", "40m", "30m", "20m", "17m", "15m", "12m", "10m"],
    "KX3": ["160m", "80m", "60m", "40m", "30m", "20m", "17m", "15m", "12m", "10m", "6m"],
    "KH1": ["40m", "20m", "17m", "15m", "10m"],
    "Unknown": null,
};

// Plausible transverter bands shown in chase filter for IF-capable radios
// (KX2/KX3) even before any auto-learn has happened. KH1 gets native only.
const PLAUSIBLE_TRANSVERTER_BANDS = ["2m", "70cm", "23cm"];

// Get the full list of bands a radio can access (native ∪ learned), or null
// for "show all". Used by chase filtering and band-button rendering.
function getRadioBandCapabilities(radioType) {
    return CapabilityState.getBands();
}
```

Note: the function signature is preserved so existing callers in `chase.js:1058` keep working. Internally it now delegates to `CapabilityState` (added in Task 3). Until Task 3 lands, this call will fail — that is expected; we'll land them together.

- [ ] **Step 2: Also add `.initial` values for VHF/UHF bands in `BAND_PLAN`**

In `src/web/main.js:391-419`, edit these five entries:

```js
"6m":    { min: 50000000, max: 54000000, initial: 50125000 },
"2m":    { min: 144000000, max: 148000000, initial: 146580000 },
"1p25m": { min: 222000000, max: 225000000, initial: 223500000 },
"70cm":  { min: 420000000, max: 450000000, initial: 446580000 },
"23cm":  { min: 1240000000, max: 1300000000, initial: 1294500000 },
```

HF entries stay as-is.

- [ ] **Step 3: Do not run tests yet — Task 3 adds the missing `CapabilityState` — proceed directly**

The intermediate state is broken; that's fine. One commit will cover both.

---

## Task 3: Add CapabilityState to main.js

**Files:**
- Modify: `src/web/main.js` (append after the `RADIO_NATIVE_BANDS` block from Task 2)

- [ ] **Step 1: Insert the `CapabilityState` object immediately after `PLAUSIBLE_TRANSVERTER_BANDS`**

```js
// ============================================================================
// CapabilityState — per-radio native + learned bands (localStorage-backed)
// ============================================================================
// Shape stored per radio at key `sotacat_learned_bands_{radioType}`:
//   { learned: ["2m", "70cm"], lastFreqHz: { "2m": 146580000, "20m": 14225000 } }
// lastFreqHz tracks the most recently observed FA for *every* band (native
// and learned), used as the click target for band buttons on the CAT page.
//
// Dispatches a `capabilitychange` event on `document` whenever learned/
// lastFreqHz change, so the UI can re-render.
const CapabilityState = {
    _learned: [],
    _lastFreqHz: {},

    _storageKey() {
        const rt = AppState.radioType || "Unknown";
        return `sotacat_learned_bands_${rt}`;
    },

    // Called after AppState.radioType is known (page load, reconnect)
    load() {
        this._learned = [];
        this._lastFreqHz = {};
        try {
            const raw = localStorage.getItem(this._storageKey());
            if (raw) {
                const parsed = JSON.parse(raw);
                if (Array.isArray(parsed.learned)) this._learned = parsed.learned.slice();
                if (parsed.lastFreqHz && typeof parsed.lastFreqHz === "object") {
                    this._lastFreqHz = { ...parsed.lastFreqHz };
                }
            }
        } catch (e) {
            Log.warn("Capability")("Failed to parse learned bands:", e.message);
        }
        this._emit();
    },

    _save() {
        try {
            localStorage.setItem(this._storageKey(),
                JSON.stringify({ learned: this._learned, lastFreqHz: this._lastFreqHz }));
        } catch (e) {
            Log.warn("Capability")("Failed to save learned bands:", e.message);
        }
    },

    _emit() {
        if (typeof document !== "undefined" && document.dispatchEvent) {
            document.dispatchEvent(new CustomEvent("capabilitychange"));
        }
    },

    // Returns native ∪ learned (ordered: native-in-frequency-order, then learned
    // in learn order). Returns null for "Unknown" (no filtering).
    getBands() {
        const native = RADIO_NATIVE_BANDS[AppState.radioType];
        if (native === null || native === undefined) return null;
        // De-dup: learned should never overlap native, but be defensive.
        const out = native.slice();
        for (const b of this._learned) if (!out.includes(b)) out.push(b);
        return out;
    },

    getLearnedBands() {
        return this._learned.slice();
    },

    getLastFreqHz(band) {
        const v = this._lastFreqHz[band];
        return typeof v === "number" ? v : null;
    },

    // Called from the VFO poll loop after a successful FA read.
    // Returns true iff a NEW band was appended to learned.
    // Caller should NOT call this from PUT-request paths (selectBand, spot click).
    observe(frequencyHz) {
        if (typeof frequencyHz !== "number" || !isFinite(frequencyHz)) return false;
        const band = getBandFromFrequency(frequencyHz);
        if (!band) return false;
        const prevLast = this._lastFreqHz[band];
        this._lastFreqHz[band] = frequencyHz;
        const native = RADIO_NATIVE_BANDS[AppState.radioType];
        if (native === null || native === undefined) {
            // Unknown radio: track lastFreqHz but never learn.
            if (prevLast !== frequencyHz) this._save();
            return false;
        }
        const known = native.includes(band) || this._learned.includes(band);
        if (!known) {
            this._learned.push(band);
            this._save();
            this._emit();
            return true;
        }
        if (prevLast !== frequencyHz) this._save();
        return false;
    },

    // Remove a learned band + its lastFreqHz. No-op if not learned.
    forget(band) {
        const idx = this._learned.indexOf(band);
        if (idx === -1) return;
        this._learned.splice(idx, 1);
        delete this._lastFreqHz[band];
        this._save();
        this._emit();
    },
};
```

- [ ] **Step 2: Run the capability tests**

Run: `node test/unit/test_capability.js`
Expected: all tests pass.

- [ ] **Step 3: Run the full unit-test suite to confirm no regressions**

Run: `make test-unit`
Expected: all four test files pass. (The `test_bandprivileges.js` sandbox doesn't load the new constants, so it's unaffected.)

- [ ] **Step 4: Commit**

```bash
git add src/web/main.js test/unit/test_capability.js
git commit -m "add CapabilityState for per-radio native+learned bands (#99)"
```

---

## Task 4: bestColumnCount helper + its tests

**Files:**
- Modify: `src/web/run.js` (add helper near top, before `updateBandDisplay`)
- Modify: `test/unit/test_capability.js` (add a describe block)

- [ ] **Step 1: Add the failing test block**

Append to `test/unit/test_capability.js`, just before the Results section:

```js
describe('bestColumnCount — dangler avoidance', () => {
    // Extract the helper from run.js the same way we extract from main.js
    const runJsPath = path.join(__dirname, '../../src/web/run.js');
    const runJsCode = fs.readFileSync(runJsPath, 'utf8');
    const bestColMatch = runJsCode.match(/function bestColumnCount\(n\) \{[\s\S]*?\n\}/);
    if (!bestColMatch) { throw new Error('bestColumnCount not found in run.js'); }
    const ctx = {}; vm.createContext(ctx);
    vm.runInContext(bestColMatch[0], ctx);
    const { bestColumnCount } = ctx;

    it('returns n for n = 1, 2, 3', () => {
        assertEqual(bestColumnCount(1), 1);
        assertEqual(bestColumnCount(2), 2);
        assertEqual(bestColumnCount(3), 3);
    });
    it('never leaves a dangler for n in 4..20', () => {
        for (let n = 4; n <= 20; n++) {
            const cols = bestColumnCount(n);
            const lastRow = n % cols;
            assertTrue(lastRow === 0 || lastRow >= 2,
                `n=${n} cols=${cols} lastRow=${lastRow}`);
        }
    });
    it('prefers 3 or 4 cols when possible (only 5 for n=13)', () => {
        for (let n = 4; n <= 20; n++) {
            const cols = bestColumnCount(n);
            if (n === 13) assertEqual(cols, 5);
            else assertTrue(cols === 3 || cols === 4, `n=${n} got ${cols}`);
        }
    });
});
```

- [ ] **Step 2: Run it and confirm failure**

Run: `node test/unit/test_capability.js`
Expected: throws `bestColumnCount not found in run.js`.

- [ ] **Step 3: Add `bestColumnCount` to `src/web/run.js`**

Insert near the top of `run.js`, above `updateBandDisplay` (around line 148):

```js
// Pick a grid column count that avoids a "dangler" — a single button alone
// on the last row. Tries 3, 4, then 5 columns; returns the first count whose
// last row has 0 or ≥2 buttons. For n ≤ 3, returns n itself.
function bestColumnCount(n) {
    if (n <= 3) return Math.max(n, 1);
    for (const cols of [3, 4, 5]) {
        if (n % cols !== 1) return cols;
    }
    return 3;
}
```

- [ ] **Step 4: Run tests**

Run: `make test-unit`
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add src/web/run.js test/unit/test_capability.js
git commit -m "add bestColumnCount helper for band-grid layout"
```

---

## Task 5: Dynamic band-button rendering (run.html + run.js + style.css)

Replace hardcoded buttons with a `renderBandButtons()` call and switch to event delegation so newly-added buttons work.

**Files:**
- Modify: `src/web/run.html:45-52`
- Modify: `src/web/run.js` (multiple spots)
- Modify: `src/web/style.css:485-487`

- [ ] **Step 1: Empty the hardcoded band-grid in `run.html`**

Replace lines 45-52:

```html
<!-- Band Selection -->
<div class="band-grid">
    <button class="btn btn-band" id="btn-40m" data-band="40m">40m</button>
    <button class="btn btn-band" id="btn-20m" data-band="20m">20m</button>
    <button class="btn btn-band" id="btn-17m" data-band="17m">17m</button>
    <button class="btn btn-band" id="btn-15m" data-band="15m">15m</button>
    <button class="btn btn-band" id="btn-12m" data-band="12m">12m</button>
    <button class="btn btn-band" id="btn-10m" data-band="10m">10m</button>
</div>
```

With:

```html
<!-- Band Selection (populated at runtime by renderBandButtons) -->
<div class="band-grid" id="band-grid"></div>
```

- [ ] **Step 2: Remove the fixed column count from `.band-grid` in `style.css`**

In `src/web/style.css:485-487`, replace:

```css
.band-grid {
    grid-template-columns: repeat(3, 1fr);
}
```

With:

```css
.band-grid {
    /* grid-template-columns set inline after renderBandButtons() to avoid danglers */
    grid-template-columns: repeat(3, 1fr);
}
```

Keep the fallback value so the grid looks sane before JS runs — JS will overwrite with the best count.

- [ ] **Step 3: Add `renderBandButtons()` and label helper to `run.js`**

Insert in `run.js` near `bestColumnCount` (just above `updateBandDisplay`):

```js
// Human-friendly band labels for buttons (e.g. "1p25m" → "1.25m")
function bandLabel(band) {
    if (band === "1p25m") return "1.25m";
    return band;
}

// Render the CAT-page band-button grid from the current capability set.
// Idempotent — safe to call repeatedly (e.g. on every capabilitychange).
function renderBandButtons() {
    const grid = document.getElementById("band-grid");
    if (!grid) return;
    const bands = CapabilityState.getBands();
    // Unknown radio (null) → show HF defaults as a graceful fallback
    const list = bands || ["40m","20m","17m","15m","12m","10m"];
    grid.innerHTML = "";
    for (const band of list) {
        const btn = document.createElement("button");
        btn.className = "btn btn-band";
        btn.id = `btn-${band}`;
        btn.setAttribute("data-band", band);
        btn.textContent = bandLabel(band);
        grid.appendChild(btn);
    }
    grid.style.gridTemplateColumns = `repeat(${bestColumnCount(list.length)}, 1fr)`;
    updateBandDisplay(); // re-apply active-state highlight for current VFO
}
```

- [ ] **Step 4: Replace direct-attach click handler with event delegation**

In `run.js`, find the block at lines 1029-1035:

```js
// Band selection buttons
document.querySelectorAll(".btn-band[data-band]").forEach((button) => {
    button.addEventListener("click", () => {
        const band = button.getAttribute("data-band");
        selectBand(band);
    });
});
```

Replace with:

```js
// Band selection buttons (delegated — buttons are rendered dynamically by renderBandButtons)
const bandGrid = document.getElementById("band-grid");
if (bandGrid) {
    bandGrid.addEventListener("click", (evt) => {
        const btn = evt.target.closest(".btn-band[data-band]");
        if (!btn) return;
        selectBand(btn.getAttribute("data-band"));
    });
}
```

- [ ] **Step 5: Update `selectBand` to use last-observed freq with fallback**

In `run.js:483-524`, change the frequency-setting line:

From:
```js
setFrequency(BAND_PLAN[band].initial);
```

To:
```js
const target = CapabilityState.getLastFreqHz(band) ?? BAND_PLAN[band].initial;
if (target == null) {
    Log.warn("Spot")(`No target freq for band ${band}; ignoring click`);
    return;
}
setFrequency(target);
```

This also defensively handles bands without an `.initial` value (e.g. 30m, 60m in the current map — though those won't appear as buttons for HF-only radios either).

- [ ] **Step 6: Call `renderBandButtons()` from init and on capability change**

Find where `run.js` initializes the page. Grep for `initializeRunPage` or the block that binds the click handlers (around line 1022). Insert two hooks:

a) Right after the bandGrid delegation block added in Step 4, before the next `// Mode selection buttons` comment:

```js
// Initial render + react to learned-band changes
renderBandButtons();
document.addEventListener("capabilitychange", () => renderBandButtons());
```

b) Verify the VFO poll integration (next task will wire `CapabilityState.observe` into the poll loop).

- [ ] **Step 7: Start the dev server / use the device to visually confirm**

Because these are web assets baked into firmware, build and OTA-upload:

```bash
make ota && make ota-upload
```

Open the device UI in a browser. Expected (assuming KX3 connected):
- 11 band buttons laid out without a dangler (bestColumnCount(11)=4 → 3 rows of 4,4,3).
- Clicking 20m tunes to the last-observed freq (or 14.225 MHz if never observed).
- Active-band highlight follows the radio's VFO.

If no real device: run the manual CAT-page-only check by opening `src/web/run.html` in a browser with a stub `AppState` and mocked `fetch` — verify the grid renders. Browser-only visual check is sufficient for this task.

- [ ] **Step 8: Run unit tests**

Run: `make test-unit`
Expected: all pass.

- [ ] **Step 9: Commit**

```bash
git add src/web/run.html src/web/run.js src/web/style.css
git commit -m "render CAT-page band buttons dynamically from capability"
```

---

## Task 6: Wire observe() into the VFO poll

Auto-learn fires only from polled `FA` — not from PUT paths.

**Files:**
- Modify: `src/web/run.js` (in `getCurrentVfoState` and `startVfoUpdates`)

- [ ] **Step 1: Add `CapabilityState.observe(newFreq)` inside the poll's frequency-change block**

In `run.js:568-578`, after `updateBandDisplay()` is called:

```js
if (frequency) {
    const newFreq = parseInt(frequency, 10);
    if (newFreq !== AppState.vfoFrequencyHz) {
        AppState.vfoFrequencyHz = newFreq;
        RunState.lastFrequencyChange = Date.now();
        updateFrequencyDisplay();
        updateBandDisplay();
        CapabilityState.observe(newFreq); // auto-learn from radio-confirmed FA
        Log.debug("Spot")("Frequency updated from radio:", AppState.vfoFrequencyHz);
        changed = true;
    }
}
```

- [ ] **Step 2: Also call `observe()` for the initial VFO read**

In `run.js:628-633`, after the first successful fetch in `startVfoUpdates`:

```js
if (frequency) {
    AppState.vfoFrequencyHz = parseInt(frequency, 10);
    updateFrequencyDisplay();
    updateBandDisplay();
    CapabilityState.observe(AppState.vfoFrequencyHz);
    Log.debug("Spot")("Initial frequency loaded:", AppState.vfoFrequencyHz);
}
```

- [ ] **Step 3: Verify auto-learn does NOT fire from click paths**

Read `selectBand` (`run.js:484`), the delegated band-click handler, and the chase spot-click handler. Confirm none of them call `CapabilityState.observe()`. They must rely on the *next* poll to confirm and maybe learn. If any such call exists, remove it.

- [ ] **Step 4: Run unit tests**

Run: `make test-unit`
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add src/web/run.js
git commit -m "wire CapabilityState.observe into VFO poll for auto-learn"
```

---

## Task 7: Capability-aware page-load bootstrap

Make sure `CapabilityState.load()` runs after `AppState.radioType` is set, and before first `renderBandButtons()` / chase filter pass.

**Files:**
- Modify: `src/web/main.js` (wherever `loadRadioType` is awaited during init)

- [ ] **Step 1: Find the boot sequence**

Grep for `loadRadioType` callers:

```bash
grep -n "loadRadioType" src/web/*.js
```

Expected: a single caller in `main.js` inside an init/DOMContentLoaded block.

- [ ] **Step 2: Add `CapabilityState.load()` immediately after `await loadRadioType()`**

Example:

```js
await loadRadioType();
CapabilityState.load();
```

If the init function isn't `async` and uses `.then()` on `loadRadioType`, chain it:

```js
loadRadioType().then(() => {
    CapabilityState.load();
    // …any downstream init that depends on capability (e.g. chase filter refresh)
});
```

- [ ] **Step 3: Re-run the chase filter after capability loads**

If `applyTableFilters` (or equivalent) was called at init *before* `CapabilityState.load()`, invoke it again after. Safest approach: listen for `capabilitychange`:

In whichever file initializes the chase page (likely `chase.js`), near where `applyTableFilters` is first bound, add:

```js
document.addEventListener("capabilitychange", () => applyTableFilters());
```

- [ ] **Step 4: Run unit tests**

Run: `make test-unit`
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add src/web/main.js src/web/chase.js
git commit -m "load CapabilityState after radio type; re-filter on change"
```

---

## Task 8: Chase filter — plausible-transverter tier

**Files:**
- Modify: `src/web/chase.js` (in `applyTableFilters`, around line 1055)

- [ ] **Step 1: Add a chase-filter test to `test_capability.js`**

Append another describe block:

```js
describe('Chase filter allowed-bands computation', () => {
    // This test exercises a helper we are about to add to main.js so that the
    // filter decision is testable without a DOM. Name it chaseAllowedBands().
    it('KH1: native only, no 2m/70cm/23cm', () => {
        const s = freshSandbox();
        s.AppState.radioType = 'KH1';
        s.CapabilityState.load();
        const allowed = s.chaseAllowedBands();
        assertIncludes(allowed, '20m');
        assertExcludes(allowed, '2m');
        assertExcludes(allowed, '70cm');
        assertExcludes(allowed, '23cm');
    });
    it('KX2 with no learned: native + plausible transverter bands', () => {
        const s = freshSandbox();
        s.AppState.radioType = 'KX2';
        s.CapabilityState.load();
        const allowed = s.chaseAllowedBands();
        assertIncludes(allowed, '20m');   // native
        assertIncludes(allowed, '2m');    // plausible
        assertIncludes(allowed, '70cm');
        assertIncludes(allowed, '23cm');
        assertExcludes(allowed, '160m');  // not on KX2
    });
    it('KX3: native includes 6m + plausible transverter bands', () => {
        const s = freshSandbox();
        s.AppState.radioType = 'KX3';
        s.CapabilityState.load();
        const allowed = s.chaseAllowedBands();
        assertIncludes(allowed, '6m');
        assertIncludes(allowed, '160m');
        assertIncludes(allowed, '2m');
    });
    it('Unknown: null (show all)', () => {
        const s = freshSandbox();
        s.AppState.radioType = 'Unknown';
        s.CapabilityState.load();
        assertEqual(s.chaseAllowedBands(), null);
    });
});
```

Also add two extracts near the top-level `extract(...)` calls in the test file:

```js
const plausibleSrc    = extract(/const PLAUSIBLE_TRANSVERTER_BANDS = \[[\s\S]*?\];/, 'PLAUSIBLE_TRANSVERTER_BANDS');
const chaseAllowedSrc = extract(/function chaseAllowedBands\(\) \{[\s\S]*?\n\}/, 'chaseAllowedBands');
```

…and inside `freshSandbox()`, after the existing `vm.runInContext(...)` calls, add in order:

```js
vm.runInContext(plausibleSrc, sandbox);
vm.runInContext(chaseAllowedSrc, sandbox);
```

Order matters — `chaseAllowedBands` references `PLAUSIBLE_TRANSVERTER_BANDS`, which must already be in scope.

- [ ] **Step 2: Run and confirm failure**

Run: `node test/unit/test_capability.js`
Expected: fails on `chaseAllowedBands not found in main.js`.

- [ ] **Step 3: Add `chaseAllowedBands()` to `main.js`**

Insert below `CapabilityState` in `main.js`:

```js
// Compute the allowed-bands list for chase-filter purposes.
// null = no filtering (Unknown radio or filter disabled upstream).
function chaseAllowedBands() {
    const radioType = AppState.radioType;
    const native = RADIO_NATIVE_BANDS[radioType];
    if (native === null || native === undefined) return null;
    const out = native.slice();
    for (const b of CapabilityState.getLearnedBands()) {
        if (!out.includes(b)) out.push(b);
    }
    // KH1 has no IF-transverter architecture — no plausible tier.
    if (radioType === "KX2" || radioType === "KX3") {
        for (const b of PLAUSIBLE_TRANSVERTER_BANDS) {
            if (!out.includes(b)) out.push(b);
        }
    }
    return out;
}
```

- [ ] **Step 4: Rewire `applyTableFilters` in `chase.js` to use the new helper**

In `src/web/chase.js:1055-1059`:

From:
```js
let allowedBands = null;
if (AppState.filterBandsEnabled && AppState.radioType) {
    allowedBands = getRadioBandCapabilities(AppState.radioType);
}
```

To:
```js
let allowedBands = null;
if (AppState.filterBandsEnabled && AppState.radioType) {
    allowedBands = chaseAllowedBands();
}
```

`getRadioBandCapabilities` stays in `main.js` (it's exported-by-global-scope); we simply stop calling it from the chase filter since `chaseAllowedBands` has the full per-radio rule. If nothing else references `getRadioBandCapabilities`, you may delete it in a follow-up cleanup — but leave it now to keep this task focused.

- [ ] **Step 5: Run unit tests**

Run: `make test-unit`
Expected: all pass.

- [ ] **Step 6: Manual / OTA sanity check (optional if no hardware)**

With a KH1 connected: enable "Show only bands my radio can access" in Settings → Chase Filters. The chase table should hide all 2m/70cm spots. With a KX2/KX3: those spots should be visible even before any auto-learn.

- [ ] **Step 7: Commit**

```bash
git add src/web/main.js src/web/chase.js test/unit/test_capability.js
git commit -m "extend chase filter with plausible transverter tier (#99)"
```

---

## Task 9: Settings page — Radio & Transverters panel

Read-only status + Forget buttons.

**Files:**
- Modify: `src/web/settings.html` (insert a new card)
- Modify: `src/web/settings.js` (render + wire Forget clicks)

- [ ] **Step 1: Add the HTML card between "Display" and "Chase Filters"**

In `src/web/settings.html`, insert this block immediately *before* the `<!-- Display Settings Card -->` comment at line 556:

```html
<!-- Radio & Transverters Card -->
<div class="settings-card">
    <h2>Radio &amp; Transverters</h2>
    <p class="settings-info">
        Detected radio and bands SOTAcat has learned from the radio's reported frequency.
        Transverter bands are learned automatically the first time you QSY to them.
    </p>
    <p class="settings-info">
        Radio: <span id="settings-radio-type">Detecting…</span>
    </p>
    <p class="settings-info">Auto-learned transverter bands:</p>
    <ul id="settings-learned-bands" class="learned-band-list">
        <li class="learned-band-none">(none)</li>
    </ul>
</div>
```

- [ ] **Step 2: Add minimal styling for the list**

In `src/web/style.css`, append:

```css
.learned-band-list {
    list-style: none;
    padding-left: 0;
    margin-top: var(--space-xs);
}
.learned-band-list li {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: var(--space-xs) 0;
}
.learned-band-list .btn-forget {
    padding: 2px var(--space-sm);
    font-size: 0.85em;
}
.learned-band-none {
    color: var(--text-muted, #888);
    font-style: italic;
}
```

If `--text-muted` isn't defined, the comma fallback uses `#888`.

- [ ] **Step 3: Render the panel from `settings.js`**

Add to `src/web/settings.js`. Find the init function (grep for the handler that reads `filter-bands-enabled`; the new code belongs in the same init path). Add:

```js
function renderRadioTransverterPanel() {
    const typeEl = document.getElementById("settings-radio-type");
    const listEl = document.getElementById("settings-learned-bands");
    if (!typeEl || !listEl) return;
    typeEl.textContent = AppState.radioType || "Detecting…";
    listEl.innerHTML = "";
    const learned = CapabilityState.getLearnedBands();
    if (learned.length === 0) {
        const li = document.createElement("li");
        li.className = "learned-band-none";
        li.textContent = "(none)";
        listEl.appendChild(li);
        return;
    }
    for (const band of learned) {
        const li = document.createElement("li");
        const label = document.createElement("span");
        const hz = CapabilityState.getLastFreqHz(band);
        const mhz = hz ? (hz / 1e6).toFixed(3) + " MHz" : "—";
        label.textContent = `${bandLabel(band)} — last seen ${mhz}`;
        const btn = document.createElement("button");
        btn.className = "btn btn-secondary btn-forget";
        btn.textContent = "Forget";
        btn.addEventListener("click", () => {
            CapabilityState.forget(band); // will emit capabilitychange → re-render
        });
        li.appendChild(label);
        li.appendChild(btn);
        listEl.appendChild(li);
    }
}
```

- [ ] **Step 4: Wire it into settings init + capability change**

In whatever function settings.js runs on page load, call `renderRadioTransverterPanel()` once, and subscribe to re-render:

```js
renderRadioTransverterPanel();
document.addEventListener("capabilitychange", renderRadioTransverterPanel);
```

Note: `bandLabel` was defined in `run.js`. To avoid a load-order gotcha, duplicate the one-liner in `settings.js`:

```js
function bandLabel(band) { return band === "1p25m" ? "1.25m" : band; }
```

(YAGNI — no need to extract to a shared module for two call sites.)

- [ ] **Step 5: Manual verification**

Load Settings in a browser. Expected:
- "Radio: KX3" (or whatever is connected).
- "(none)" if nothing learned.
- After auto-learning 2m on the CAT page, the settings panel shows `2m — last seen 146.580 MHz — [Forget]`.
- Clicking Forget removes the entry and removes the 2m button from the CAT page without a reload.

- [ ] **Step 6: Run unit tests**

Run: `make test-unit`
Expected: all pass.

- [ ] **Step 7: Commit**

```bash
git add src/web/settings.html src/web/settings.js src/web/style.css
git commit -m "add Radio & Transverters settings panel with Forget"
```

---

## Task 10: Documentation updates

**Files:**
- Modify: `Documentation/user/UI-Tour.md` (line 52 + Settings section)
- Modify: `Documentation/dev/Web-UI.md` (near the `bandprivileges.js` mention)

- [ ] **Step 1: Update `Documentation/user/UI-Tour.md`**

Find line 52:

```
- Band buttons (40m, 20m, 17m, 15m, 12m, 10m)
```

Replace with:

```
- Band buttons (populated from the detected radio — HF bands on KX2, HF + 6m on KX3, KH1's subset, plus any transverter bands SOTAcat has learned)
```

After line 89 (before "Display settings (compact mode, scan dwell time)"), add a new bullet:

```
- Radio & Transverters panel (shows the detected radio and any auto-learned transverter bands; each learned band has a Forget button)
```

- [ ] **Step 2: Update `Documentation/dev/Web-UI.md`**

Find the existing mention of `bandprivileges.js` (line 30). Below the file-tree section, add a short paragraph describing the capability model. Grep first:

```bash
grep -n "bandprivileges" Documentation/dev/Web-UI.md
```

Just after the tree, insert (adjust wording to match surrounding prose style):

```markdown
### Radio capability model

`main.js` owns `RADIO_NATIVE_BANDS` (per-radio hardcoded native bands) and
`CapabilityState` (native ∪ learned, with per-band last-observed frequency).
Auto-learn fires only from radio-confirmed `FA` polls, never from PUT paths.
Learned state persists in localStorage keyed by radio type
(`sotacat_learned_bands_KX2`, etc.), so multiple radios sharing one SOTAcat
keep independent learned sets. See
`Documentation/for-AI-agents/specs/2026-04-21-transverter-awareness-design.md`
for the full design rationale.
```

- [ ] **Step 3: Commit**

```bash
git add Documentation/user/UI-Tour.md Documentation/dev/Web-UI.md
git commit -m "document dynamic band buttons and capability model (#99)"
```

- [ ] **Step 4: Note screenshot refresh as follow-up**

Screenshots (`Documentation/images/run-tune.png`, `settings-display-and-chase-filters.png`) should be refreshed after manual verification on hardware. This is explicitly deferred per the spec — no action in this plan.

---

## Task 11: Full-stack manual verification

**Files:** none (manual tests)

- [ ] **Step 1: OTA-upload the branch**

```bash
make ota && make ota-upload
```

- [ ] **Step 2: Run through the scenarios from the spec's "Manual / integration" list**

Mark each:

- [ ] KX2 with no transverter: native HF buttons only; Forget list empty; chase filter with KX2 hides no HF but shows 2m/70cm as plausible.
- [ ] KX2 + external 2m transverter: QSY radio to 146.580; observe button appears; CAT page re-renders with 2m button without reload.
- [ ] KX3 without module: 2m still learnable via auto-learn after QSY.
- [ ] KX3 with KXV3-2M module: first QSY to 2m learns it; persists after page reload.
- [ ] KH1: HF subset only; no 2m/70cm buttons; chase filter hides VHF spots; auto-learn never fires for VHF.
- [ ] Forget: clicking Forget in settings removes the button from CAT page and entry from Settings list, without reload.
- [ ] Disconnect/reconnect: learned state survives (localStorage is per-radio).

- [ ] **Step 3: Verify no console errors in DevTools during any of the above**

- [ ] **Step 4: Confirm full unit suite green**

Run: `make test-unit`
Expected: 4 test files, all passing (177 pre-existing + new capability tests).

- [ ] **Step 5: Push branch + open PR**

Ask the user first whether they want the PR opened now. Do not push or open a PR without explicit approval — per global CLAUDE.md, this is a shared-state action.

---

## Notes for the executor

- **Branch is already created.** `fix/99-transverter-awareness` is checked out and based on `fix/99-vhf-uhf-privileges`. The spec commit (`09f7d2b`) is the first one on the branch. All new commits stack on top.
- **No firmware or C++ changes.** If you find yourself modifying `src/` (not `src/web/`) or `include/`, stop — something's wrong.
- **Web assets build into firmware via PlatformIO.** To see UI changes on a real device you must `make ota && make ota-upload`. Pure-logic changes can be validated via `make test-unit` alone.
- **Event-driven re-render, no polling.** `CapabilityState` emits `capabilitychange` on every mutation. UI code listens; do not add your own polling for learned-band changes.
- **Do not let PUT-path code call `CapabilityState.observe()`.** The auto-learn contract is strict: poll-only. A violation would cause the "click a 2m spot → 2m shows up even though radio can't reach it" bug.
