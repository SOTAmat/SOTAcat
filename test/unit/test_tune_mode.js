#!/usr/bin/env node
/**
 * Unit tests for mode normalization in tuneRadioHz (main.js).
 *
 * Spot sources deliver raw mode strings (FT8, OLIVIA, OTHER, "");
 * normalizeRadioMode maps them onto the set the firmware accepts, and
 * tuneRadioHz tunes frequency-only when no mapping exists.
 *
 * Usage:
 *   node test/unit/test_tune_mode.js
 */

const fs = require('fs');
const path = require('path');
const vm = require('vm');

let testsPassed = 0;
let testsFailed = 0;

function it(name, fn) {
    try { fn(); testsPassed++; console.log(`  ✓ ${name}`); }
    catch (e) { testsFailed++; console.log(`  ✗ ${name}\n    ${e.message}`); }
}

const asyncTests = [];
function itAsync(name, fn) { asyncTests.push({ name, fn }); }

function assertEqual(a, b, m='') {
    if (a !== b) throw new Error(`${m}: expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`);
}
function assertTrue(v, m='') { if (!v) throw new Error(`${m}: expected truthy, got ${v}`); }

const mainJs = fs.readFileSync(path.join(__dirname, '../../src/web/main.js'), 'utf8');
const normMatch = mainJs.match(/function normalizeRadioMode\([\s\S]*?\n\}/);
const tuneMatch = mainJs.match(/async function tuneRadioHz\([\s\S]*?\n\}/);

console.log('\nMode normalization for tuning');

it('main.js defines normalizeRadioMode and tuneRadioHz', () => {
    assertTrue(!!normMatch, 'normalizeRadioMode not found in main.js');
    assertTrue(!!tuneMatch, 'tuneRadioHz not found in main.js');
});

if (normMatch) {
    const normalizeRadioMode = new Function(`${normMatch[0]}\nreturn normalizeRadioMode;`)();

    it('firmware-accepted modes pass through uppercased', () => {
        for (const m of ['LSB','USB','CW','FM','AM','DATA','CW_R','DATA_R','FT8','JS8','PK31','FT4','RTTY','SSB']) {
            assertEqual(normalizeRadioMode(m), m, m);
        }
        assertEqual(normalizeRadioMode('cw'), 'CW', 'lowercase');
        assertEqual(normalizeRadioMode(' ssb '), 'SSB', 'whitespace');
    });

    it('synonyms map onto accepted modes', () => {
        assertEqual(normalizeRadioMode('PSK31'), 'PK31');
        assertEqual(normalizeRadioMode('CW-R'), 'CW_R');
        assertEqual(normalizeRadioMode('DATA-R'), 'DATA_R');
        assertEqual(normalizeRadioMode('PHONE'), 'SSB');
    });

    it('digital modes without a firmware alias map to DATA', () => {
        for (const m of ['PSK','BPSK31','JT65','JT9','MFSK32','OLIVIA','HELL','SSTV','PKT','MSK144']) {
            assertEqual(normalizeRadioMode(m), 'DATA', m);
        }
    });

    it('unmappable modes return null', () => {
        for (const m of ['OTHER', 'UNKNOWN', '', null, undefined, 'XYZ123']) {
            assertEqual(normalizeRadioMode(m), null, String(m));
        }
    });
}

if (normMatch && tuneMatch) {
    function makeSandbox() {
        const puts = [];
        const sandbox = {
            console,
            fetch: (url, opts) => { puts.push(url); return Promise.resolve({ ok: true }); },
            Log: { debug: () => () => {}, warn: () => () => {}, error: () => () => {} },
            AppState: { vfoFrequencyHz: null, vfoMode: null, vfoLastUpdated: 0 },
            LSB_USB_BOUNDARY_HZ: 10000000,
            openTuneTargets: () => {},
            suppressVfoPolling: () => {},
            VFO_ACTION_SUPPRESS_MS: 2000,
            Date: Date,
            _puts: puts,
        };
        vm.createContext(sandbox);
        vm.runInContext(normMatch[0], sandbox);
        vm.runInContext(tuneMatch[0], sandbox);
        return sandbox;
    }

    itAsync('known mode: frequency then mode are PUT', async () => {
        const sb = makeSandbox();
        await vm.runInContext('tuneRadioHz(14074000, "FT8")', sb);
        assertEqual(sb._puts.length, 2, 'two PUTs');
        assertTrue(sb._puts[0].includes('frequency=14074000'), 'frequency first');
        assertTrue(sb._puts[1].includes('mode=FT8'), 'mode second');
    });

    itAsync('unmappable mode: frequency-only tune, no mode PUT', async () => {
        const sb = makeSandbox();
        await vm.runInContext('tuneRadioHz(14285000, "OTHER")', sb);
        assertEqual(sb._puts.length, 1, 'one PUT');
        assertTrue(sb._puts[0].includes('frequency=14285000'), 'frequency PUT');
    });

    itAsync('SSB resolves by frequency boundary', async () => {
        const sb = makeSandbox();
        await vm.runInContext('tuneRadioHz(7180000, "SSB")', sb);
        assertTrue(sb._puts[1].includes('mode=LSB'), '40m SSB is LSB');
        const sb2 = makeSandbox();
        await vm.runInContext('tuneRadioHz(14285000, "ssb")', sb2);
        assertTrue(sb2._puts[1].includes('mode=USB'), '20m SSB is USB');
    });

    itAsync('unmappable mode leaves AppState.vfoMode untouched', async () => {
        const sb = makeSandbox();
        sb.AppState.vfoMode = 'CW';
        await vm.runInContext('tuneRadioHz(14285000, "OTHER")', sb);
        assertEqual(sb.AppState.vfoMode, 'CW', 'mode preserved');
        assertEqual(sb.AppState.vfoFrequencyHz, 14285000, 'frequency updated');
    });
}

// ============================================================================
// Cross-file mode coherence (chase family classification)
// ============================================================================

const chaseJs = fs.readFileSync(path.join(__dirname, '../../src/web/chase.js'), 'utf8');
const chaseApiJs = fs.readFileSync(path.join(__dirname, '../../src/web/chase_api.js'), 'utf8');
const digitalMatch = mainJs.match(/const DIGITAL_FIRMWARE_MODES = \[[^\]]*\];/);
const familyMatch = chaseApiJs.match(/function spotModeFamily\([\s\S]*?\n\}/);

console.log('\nCross-file mode coherence');

it('chase.js does not shadow the shared normalizeRadioMode', () => {
    // Tab scripts share one global scope; a second declaration silently
    // clobbers main.js's firmware-mode mapper once the Chase tab loads.
    assertEqual(/function normalizeRadioMode\s*\(/.test(chaseJs), false,
                'chase.js declares a clashing global normalizeRadioMode');
});

function familySandbox() {
    assertTrue(!!digitalMatch, 'DIGITAL_FIRMWARE_MODES not found in main.js');
    assertTrue(!!familyMatch, 'spotModeFamily not found in chase_api.js');
    const sandbox = { String };
    vm.createContext(sandbox);
    vm.runInContext(normMatch[0], sandbox);
    vm.runInContext(digitalMatch[0], sandbox);
    vm.runInContext(familyMatch[0], sandbox);
    return sandbox;
}

it('DIGI and DIG spots classify as the DATA family', () => {
    const sb = familySandbox();
    assertEqual(vm.runInContext('spotModeFamily("DIGI")', sb), 'DATA', 'DIGI');
    assertEqual(vm.runInContext('spotModeFamily("DIG")', sb), 'DATA', 'DIG');
});

it('native digital firmware modes classify as DATA', () => {
    const sb = familySandbox();
    for (const m of ['RTTY', 'FT8', 'FT4', 'JS8', 'PSK31']) {
        assertEqual(vm.runInContext(`spotModeFamily(${JSON.stringify(m)})`, sb), 'DATA', m);
    }
});

it('phone and CW families are preserved', () => {
    const sb = familySandbox();
    assertEqual(vm.runInContext('spotModeFamily("USB")', sb), 'SSB', 'USB');
    assertEqual(vm.runInContext('spotModeFamily("LSB")', sb), 'SSB', 'LSB');
    assertEqual(vm.runInContext('spotModeFamily("CW")', sb), 'CW', 'CW');
    assertEqual(vm.runInContext('spotModeFamily("FM")', sb), 'FM', 'FM');
});

it('unknown modes classify as OTHER', () => {
    const sb = familySandbox();
    assertEqual(vm.runInContext('spotModeFamily("GIBBERISH")', sb), 'OTHER', 'GIBBERISH');
});

(async () => {
    if (asyncTests.length) console.log('\nAsync tests');
    for (const t of asyncTests) {
        try { await t.fn(); testsPassed++; console.log(`  ✓ ${t.name}`); }
        catch (e) { testsFailed++; console.log(`  ✗ ${t.name}\n    ${e.message}`); }
    }
    console.log('\n' + '='.repeat(60));
    console.log(`Results: ${testsPassed} passed, ${testsFailed} failed`);
    console.log('='.repeat(60));
    process.exit(testsFailed > 0 ? 1 : 0);
})();
