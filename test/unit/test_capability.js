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
const nativeBandsSrc  = extract(/var RADIO_NATIVE_BANDS = \{[\s\S]*?\n\};/, 'RADIO_NATIVE_BANDS');
const capabilitySrc   = extract(/var CapabilityState = \{[\s\S]*?^\};/m, 'CapabilityState');

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
