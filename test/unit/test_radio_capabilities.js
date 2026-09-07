#!/usr/bin/env node
/**
 * Unit tests for radio capability table (src/web/main.js)
 *
 * Covers:
 * - RADIO_CAPABILITIES nested record shape
 * - getRadioBands (with and without requireTx)
 * - getRadioBandCapabilities back-compat (used by chase.js)
 *
 * Usage:
 *   node test/unit/test_radio_capabilities.js
 */

const fs = require('fs');
const path = require('path');
const vm = require('vm');

// ============================================================================
// Test framework (minimal; same shape as the other test_*.js files)
// ============================================================================

let testsPassed = 0;
let testsFailed = 0;
const failures = [];

function describe(name, fn) {
    console.log(`\n${name}`);
    fn();
}

function it(name, fn) {
    try {
        fn();
        testsPassed++;
        console.log(`  ✓ ${name}`);
    } catch (e) {
        testsFailed++;
        console.log(`  ✗ ${name}`);
        console.log(`    ${e.message}`);
        failures.push({ name, error: e.message });
    }
}

function assertEqual(actual, expected, msg = '') {
    const a = JSON.stringify(actual);
    const e = JSON.stringify(expected);
    if (a !== e) {
        throw new Error(`${msg}: expected ${e}, got ${a}`);
    }
}

function assertTrue(value, msg = '') {
    if (!value) throw new Error(`${msg}: expected truthy, got ${value}`);
}

function assertFalse(value, msg = '') {
    if (value) throw new Error(`${msg}: expected falsy, got ${value}`);
}

function assertNull(value, msg = '') {
    if (value !== null) throw new Error(`${msg}: expected null, got ${JSON.stringify(value)}`);
}

function assertArrayEqualUnordered(actual, expected, msg = '') {
    const a = [...actual].sort();
    const e = [...expected].sort();
    assertEqual(a, e, msg);
}

// ============================================================================
// Extract RADIO_CAPABILITIES + accessors from main.js into a sandbox
// ============================================================================

const sandbox = { console };
vm.createContext(sandbox);

const mainJsPath = path.join(__dirname, '../../src/web/main.js');
const mainJsCode = fs.readFileSync(mainJsPath, 'utf8');

const radioCapMatch = mainJsCode.match(/const RADIO_CAPABILITIES = \{[\s\S]*?\n\};/);
const getRadioBandsMatch = mainJsCode.match(/function getRadioBands\([\s\S]*?\n\}/);

for (const [name, m] of [
    ['RADIO_CAPABILITIES', radioCapMatch],
    ['getRadioBands', getRadioBandsMatch],
]) {
    if (!m) {
        console.error(`Could not extract ${name} from main.js`);
        process.exit(1);
    }
    // const declarations don't become sandbox globals; rewrite to var so
    // we can access the table directly in tests (functions already do).
    vm.runInContext(m[0].replace(/^const /, 'var '), sandbox);
}

const {
    RADIO_CAPABILITIES,
    getRadioBands,
} = sandbox;

// ============================================================================
// Tests
// ============================================================================

describe('Table shape', () => {
    it('Has KX2, KX3, KH1, Unknown entries', () => {
        assertTrue('KX2' in RADIO_CAPABILITIES);
        assertTrue('KX3' in RADIO_CAPABILITIES);
        assertTrue('KH1' in RADIO_CAPABILITIES);
        assertTrue('Unknown' in RADIO_CAPABILITIES);
    });

    it('Unknown is null (permissive sentinel)', () => {
        assertNull(RADIO_CAPABILITIES.Unknown);
    });
});

describe('KX2 bands', () => {
    it('160m is RX-only', () => {
        assertEqual(RADIO_CAPABILITIES.KX2.bands['160m'], 'RX');
    });

    it('Does not list 6m (KX2 has no 6m hardware)', () => {
        assertFalse('6m' in RADIO_CAPABILITIES.KX2.bands);
    });

    it('80m through 10m are TXRX', () => {
        for (const b of ['80m','60m','40m','30m','20m','17m','15m','12m','10m']) {
            assertEqual(RADIO_CAPABILITIES.KX2.bands[b], 'TXRX', `KX2 ${b}`);
        }
    });
});

describe('KX3 bands', () => {
    it('160m through 6m are all TXRX', () => {
        for (const b of ['160m','80m','60m','40m','30m','20m','17m','15m','12m','10m','6m']) {
            assertEqual(RADIO_CAPABILITIES.KX3.bands[b], 'TXRX', `KX3 ${b}`);
        }
    });
});

describe('KH1 bands', () => {
    it('Covers 40m / 30m / 20m / 17m / 15m only', () => {
        assertArrayEqualUnordered(
            Object.keys(RADIO_CAPABILITIES.KH1.bands),
            ['40m','30m','20m','17m','15m'],
        );
    });

    it('All listed bands are TXRX', () => {
        for (const b of ['40m','30m','20m','17m','15m']) {
            assertEqual(RADIO_CAPABILITIES.KH1.bands[b], 'TXRX', `KH1 ${b}`);
        }
    });
});

describe('KH1 modes', () => {
    it('CW is TXRX', () => {
        assertEqual(RADIO_CAPABILITIES.KH1.modes.CW, 'TXRX');
    });

    it('USB and LSB are RX-only (used for FT8 receive)', () => {
        assertEqual(RADIO_CAPABILITIES.KH1.modes.USB, 'RX');
        assertEqual(RADIO_CAPABILITIES.KH1.modes.LSB, 'RX');
    });

    it('DATA, AM, FM are absent', () => {
        assertFalse('DATA' in RADIO_CAPABILITIES.KH1.modes);
        assertFalse('AM' in RADIO_CAPABILITIES.KH1.modes);
        assertFalse('FM' in RADIO_CAPABILITIES.KH1.modes);
    });
});

describe('getRadioBands', () => {
    it('KX2 with requireTx=false includes 160m', () => {
        const bands = getRadioBands('KX2', false);
        assertTrue(bands.includes('160m'), '160m present (RX counted)');
    });

    it('KX2 with requireTx=true excludes 160m', () => {
        const bands = getRadioBands('KX2', true);
        assertFalse(bands.includes('160m'), '160m excluded (TX-only filter)');
    });

    it('KH1 lists exactly 5 bands', () => {
        const bands = getRadioBands('KH1');
        assertEqual(bands.length, 5);
    });

    it('Unknown returns null', () => {
        assertNull(getRadioBands('Unknown'));
    });

    it('Unrecognized radio name returns null', () => {
        assertNull(getRadioBands('FT-818'));
    });
});

// ============================================================================
// Summary
// ============================================================================

console.log('\n' + '='.repeat(60));
// ============================================================================
// getRadioFrequencySpanHz: per-radio tunable span derived from the
// capability table + BAND_PLAN, replacing hardcoded KX2-only limits.
// ============================================================================

describe('getRadioFrequencySpanHz', () => {
    const spanMatch = mainJsCode.match(/function getRadioFrequencySpanHz\([\s\S]*?\n\}/);
    const bandPlanMatch = mainJsCode.match(/const BAND_PLAN = \{[\s\S]*?\n\};/);
    const bandsFnMatch = mainJsCode.match(/function getRadioBands\([\s\S]*?\n\}/);

    it('main.js defines getRadioFrequencySpanHz', () => {
        assertTrue(!!spanMatch, 'getRadioFrequencySpanHz not found in main.js');
    });

    function spanFor(radioType, filterBandsEnabled = true) {
        const sb = {
            console,
            AppState: { radioType, filterBandsEnabled },
            HF_MIN_FREQUENCY_HZ: 1800000,
            HF_MAX_FREQUENCY_HZ: 29700000,
        };
        vm.createContext(sb);
        // consts live in script scope, not on the context; run all pieces
        // as ONE script so the function closes over them.
        vm.runInContext(
            [bandPlanMatch[0], radioCapMatch[0], bandsFnMatch[0], spanMatch[0],
             'globalThis.__span = getRadioFrequencySpanHz;'].join('\n'),
            sb
        );
        return sb.__span();
    }

    it('KX2 span is 160m..10m (1.8-29.7 MHz)', () => {
        assertEqual(spanFor('KX2'), { min: 1800000, max: 29700000 });
    });

    it('KX3 span reaches 6m (54 MHz)', () => {
        assertEqual(spanFor('KX3'), { min: 1800000, max: 54000000 });
    });

    it('KH1 span is 40m..15m (7-21.45 MHz)', () => {
        assertEqual(spanFor('KH1'), { min: 7000000, max: 21450000 });
    });

    it('unknown radio falls back to the full HF span', () => {
        assertEqual(spanFor('Unknown'), { min: 1800000, max: 29700000 });
    });

    it('band-filter opt-out (transverter use) removes the restriction', () => {
        assertNull(spanFor('KX2', false), 'opted-out span must be null (no clamp)');
    });

    it('run.js adjustFrequency clamps via the derived span', () => {
        const runJsCode = fs.readFileSync(path.join(__dirname, '../../src/web/run.js'), 'utf8');
        const adjMatch = runJsCode.match(/function adjustFrequency\([\s\S]*?\n\}/);
        assertTrue(!!adjMatch, 'adjustFrequency not found in run.js');
        assertTrue(/getRadioFrequencySpanHz\(\)/.test(adjMatch[0]),
                   'adjustFrequency must derive its bounds from the radio capabilities');
    });
});

console.log(`Results: ${testsPassed} passed, ${testsFailed} failed`);
if (failures.length > 0) {
    console.log('\nFailures:');
    for (const f of failures) {
        console.log(`  - ${f.name}: ${f.error}`);
    }
}
console.log('='.repeat(60));

process.exit(testsFailed > 0 ? 1 : 0);
