#!/usr/bin/env node
/**
 * Unit tests for Chase/Scan resume behavior (fix #102).
 *
 * Validates that startScan picks up from where the user left off and that
 * advanceScan increments before tuning (no re-scan of the same row).
 *
 * Usage:
 *   node test/unit/test_chase_resume.js
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

function assertEqual(a, b, m='') {
    if (a !== b) throw new Error(`${m}: expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`);
}

function makeRow(hertz, modeType, opts={}) {
    const classes = new Set(opts.classes || []);
    return {
        dataset: { hertz: String(hertz), modeType: modeType },
        classList: {
            contains(c) { return classes.has(c); },
            add(c) { classes.add(c); },
            remove(c) { classes.delete(c); },
        },
        scrollIntoView() {},
    };
}

function loadSandbox() {
    const tunes = [];
    const sandbox = {
        console: console,
        clickedTunedRow: null,
        ChaseState: {
            scanActive: false,
            scanCurrentIndex: -1,
            scanTimeoutId: null,
        },
        AppState: { scanDwellTimeMs: 100 },
        _mockRows: [],
        getVisibleRows() { return sandbox._mockRows; },
        tuneRadioHz(hz, mode) { tunes.push({ hz, mode }); },
        updateScanButtonLabel() {},
        // Suppress the chain — tests drive advanceScan manually.
        setTimeout() { return 0; },
        clearTimeout() {},
        _tunes: tunes,
    };
    vm.createContext(sandbox);

    const chasePath = path.join(__dirname, '../../src/web/chase.js');
    const code = fs.readFileSync(chasePath, 'utf8');

    const stopMatch = code.match(/function stopScan\(\)\s*\{[\s\S]*?\n\}/);
    const advMatch = code.match(/function advanceScan\(\)\s*\{[\s\S]*?\n\}/);
    const startMatch = code.match(/function startScan\(\)\s*\{[\s\S]*?\n\}/);
    if (!stopMatch || !advMatch || !startMatch) {
        throw new Error('could not extract scan functions from chase.js');
    }
    vm.runInContext(stopMatch[0], sandbox);
    vm.runInContext(advMatch[0], sandbox);
    vm.runInContext(startMatch[0], sandbox);
    return sandbox;
}

console.log('\nChase scan resume (fix #102)');

it('startScan with empty list is a no-op', () => {
    const sb = loadSandbox();
    sb._mockRows = [];
    sb.startScan();
    assertEqual(sb.ChaseState.scanActive, false, 'should not activate');
    assertEqual(sb._tunes.length, 0, 'should not tune');
});

it('startScan with no clicked row and no tuned row starts at top', () => {
    const sb = loadSandbox();
    sb._mockRows = [
        makeRow(7100000, 'CW'),
        makeRow(14200000, 'USB'),
        makeRow(21300000, 'USB'),
    ];
    sb.startScan();
    // advanceScan increments scanCurrentIndex from -1 to 0
    assertEqual(sb._tunes.length, 1);
    assertEqual(sb._tunes[0].hz, 7100000, 'tunes first row');
});

it('startScan resumes from row AFTER clickedTunedRow', () => {
    const sb = loadSandbox();
    const r0 = makeRow(7100000, 'CW');
    const r1 = makeRow(14200000, 'USB');
    const r2 = makeRow(21300000, 'USB');
    sb._mockRows = [r0, r1, r2];
    sb.clickedTunedRow = r1;
    sb.startScan();
    assertEqual(sb._tunes.length, 1);
    assertEqual(sb._tunes[0].hz, 21300000, 'starts after the clicked row');
});

it('startScan falls back to first .tuned-row when no clickedTunedRow', () => {
    const sb = loadSandbox();
    const r0 = makeRow(7100000, 'CW');
    const r1 = makeRow(14200000, 'USB', { classes: ['tuned-row'] });
    const r2 = makeRow(21300000, 'USB');
    sb._mockRows = [r0, r1, r2];
    sb.clickedTunedRow = null;
    sb.startScan();
    assertEqual(sb._tunes.length, 1);
    assertEqual(sb._tunes[0].hz, 21300000, 'starts after the .tuned-row');
});

it('advanceScan increments BEFORE tuning (no repeat of starting row)', () => {
    const sb = loadSandbox();
    const r0 = makeRow(7100000, 'CW');
    const r1 = makeRow(14200000, 'USB');
    sb._mockRows = [r0, r1];
    sb.startScan();             // tunes r0 (index 0)
    sb.advanceScan();           // must tune r1, not r0 again
    assertEqual(sb._tunes.length, 2);
    assertEqual(sb._tunes[0].hz, 7100000);
    assertEqual(sb._tunes[1].hz, 14200000, 'second tune is the next row, not the same row');
});

it('advanceScan records the current row in clickedTunedRow', () => {
    const sb = loadSandbox();
    const r0 = makeRow(7100000, 'CW');
    sb._mockRows = [r0];
    sb.startScan();
    assertEqual(sb.clickedTunedRow, r0, 'clickedTunedRow tracks scan cursor');
});

it('advanceScan wraps to the first row at end of list', () => {
    const sb = loadSandbox();
    const r0 = makeRow(7100000, 'CW');
    const r1 = makeRow(14200000, 'USB');
    sb._mockRows = [r0, r1];
    sb.startScan();             // r0
    sb.advanceScan();           // r1
    sb.advanceScan();           // wrap to r0
    assertEqual(sb._tunes.length, 3);
    assertEqual(sb._tunes[2].hz, 7100000, 'wrapped to first row');
});

it('advanceScan stops scanning when visible rows become empty', () => {
    const sb = loadSandbox();
    sb._mockRows = [makeRow(7100000, 'CW')];
    sb.startScan();
    assertEqual(sb.ChaseState.scanActive, true);
    sb._mockRows = [];          // filter cleared everything
    sb.advanceScan();
    assertEqual(sb.ChaseState.scanActive, false, 'scan deactivated');
    assertEqual(sb.ChaseState.scanCurrentIndex, -1, 'index reset');
});

console.log(`\n${testsPassed} passed, ${testsFailed} failed`);
if (testsFailed > 0) process.exit(1);
