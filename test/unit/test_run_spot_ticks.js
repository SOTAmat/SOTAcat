#!/usr/bin/env node
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

function assertClose(a, b, eps=0.01) {
    if (Math.abs(a - b) > eps) throw new Error(`expected ~${b}, got ${a}`);
}

function loadHelper() {
    const sandbox = { console: console };
    vm.createContext(sandbox);

    // Load bandprivileges.js (provides getModeCategory)
    const bpPath = path.join(__dirname, '../../src/web/bandprivileges.js');
    vm.runInContext(fs.readFileSync(bpPath, 'utf8'), sandbox);

    // Extract just buildSpotTickData from run.js
    const runJsPath = path.join(__dirname, '../../src/web/run.js');
    const runJsCode = fs.readFileSync(runJsPath, 'utf8');
    const fnMatch = runJsCode.match(/function buildSpotTickData\(spots, bandStart, bandEnd\) \{[\s\S]*?\n\}/);
    if (!fnMatch) throw new Error('buildSpotTickData not found in run.js');
    vm.runInContext(fnMatch[0], sandbox);

    return sandbox.buildSpotTickData;
}

console.log('\nbuildSpotTickData');

it('filters out-of-band spots', () => {
    const fn = loadHelper();
    const ticks = fn(
        [
            { hertz: 14250000, mode: 'USB', activatorCallsign: 'W1AW', modeType: 'SSB' },
            { hertz: 7100000,  mode: 'CW',  activatorCallsign: 'K1DX', modeType: 'CW' },
            { hertz: 28500000, mode: 'USB', activatorCallsign: 'N5RS', modeType: 'SSB' },
        ],
        14000000, 14350000  // 20m
    );
    assertEqual(ticks.length, 1, 'only the 20m spot');
    assertEqual(ticks[0].callsign, 'W1AW');
});

it('positions tick at correct percentage', () => {
    const fn = loadHelper();
    const ticks = fn(
        [{ hertz: 14175000, mode: 'USB', activatorCallsign: 'X', modeType: 'SSB' }],
        14000000, 14350000
    );
    // 175k / 350k = 50%
    assertClose(ticks[0].leftPct, 50);
});

it('maps mode to category for coloring', () => {
    const fn = loadHelper();
    const ticks = fn(
        [
            { hertz: 14000001, mode: 'CW',  activatorCallsign: 'A', modeType: 'CW' },
            { hertz: 14000002, mode: 'USB', activatorCallsign: 'B', modeType: 'SSB' },
            { hertz: 14000003, mode: 'FT8', activatorCallsign: 'C', modeType: 'DATA' },
            { hertz: 14000004, mode: 'XYZ', activatorCallsign: 'D', modeType: 'OTHER' },
        ],
        14000000, 14350000
    );
    assertEqual(ticks[0].modeCategory, 'cw');
    assertEqual(ticks[1].modeCategory, 'phone');
    assertEqual(ticks[2].modeCategory, 'data');
    assertEqual(ticks[3].modeCategory, 'other');
});

it('handles boundary frequencies inclusively', () => {
    const fn = loadHelper();
    const ticks = fn(
        [
            { hertz: 14000000, mode: 'CW', activatorCallsign: 'lo', modeType: 'CW' },
            { hertz: 14350000, mode: 'CW', activatorCallsign: 'hi', modeType: 'CW' },
        ],
        14000000, 14350000
    );
    assertEqual(ticks.length, 2, 'both edges included');
    assertClose(ticks[0].leftPct, 0);
    assertClose(ticks[1].leftPct, 100);
});

it('handles empty input', () => {
    const fn = loadHelper();
    assertEqual(fn([], 14000000, 14350000).length, 0);
    assertEqual(fn(null, 14000000, 14350000).length, 0);
});

console.log(`\n${testsPassed} passed, ${testsFailed} failed`);
if (testsFailed > 0) process.exit(1);
