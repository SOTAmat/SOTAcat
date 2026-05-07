#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const vm = require('vm');

let testsPassed = 0;
let testsFailed = 0;

function it(name, fn) {
    Promise.resolve()
        .then(fn)
        .then(() => { testsPassed++; console.log(`  ✓ ${name}`); })
        .catch((e) => { testsFailed++; console.log(`  ✗ ${name}\n    ${e.message}`); });
}

function assertEqual(a, b, m='') {
    if (a !== b) throw new Error(`${m}: expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`);
}

function makeSandbox() {
    const calls = [];
    const sandbox = {
        console: console,
        Date: Date,
        Promise: Promise,
        setTimeout: setTimeout,
        AppState: { vfoFrequencyHz: 0, vfoMode: null, vfoLastUpdated: 0 },
        Log: {
            info: () => () => {}, warn: () => () => {},
            error: () => () => {}, debug: () => () => {},
        },
        // Stubs for things tuneRadioHz calls in main.js
        openTuneTargets: (freq, mode) => calls.push(['openTuneTargets', freq, mode]),
        LSB_USB_BOUNDARY_HZ: 10000000,
        // fetch stub records calls and resolves OK
        fetch: async (url, opts) => {
            calls.push(['fetch', url, opts && opts.method]);
            return { ok: true };
        },
        _calls: calls,
    };
    vm.createContext(sandbox);

    // Load just the tuneRadioHz function from main.js
    const mainJsPath = path.join(__dirname, '../../src/web/main.js');
    const mainJsCode = fs.readFileSync(mainJsPath, 'utf8');
    const fnMatch = mainJsCode.match(/async function tuneRadioHz\(frequency, mode\) \{[\s\S]*?\n\}/);
    if (!fnMatch) throw new Error("tuneRadioHz not found in main.js");
    vm.runInContext(fnMatch[0], sandbox);

    return sandbox;
}

console.log('\nshared tuneRadioHz');

it('USB 14.250 stays USB', async () => {
    const sb = makeSandbox();
    await sb.tuneRadioHz(14250000, 'SSB');
    assertEqual(sb.AppState.vfoMode, 'USB', 'SSB above boundary -> USB');
    assertEqual(sb.AppState.vfoFrequencyHz, 14250000);
});

it('SSB at 7.100 becomes LSB', async () => {
    const sb = makeSandbox();
    await sb.tuneRadioHz(7100000, 'SSB');
    assertEqual(sb.AppState.vfoMode, 'LSB', 'SSB below boundary -> LSB');
});

it('CW stays CW', async () => {
    const sb = makeSandbox();
    await sb.tuneRadioHz(14025000, 'CW');
    assertEqual(sb.AppState.vfoMode, 'CW');
});

setTimeout(() => {
    console.log(`\n${testsPassed} passed, ${testsFailed} failed`);
    if (testsFailed > 0) process.exit(1);
}, 100);
