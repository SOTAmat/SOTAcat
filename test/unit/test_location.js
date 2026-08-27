#!/usr/bin/env node
/**
 * Unit tests for location plumbing (main.js saveGpsToDevice + qrx.js
 * hasValidLocation).
 *
 * The geolocation bridge returns coordinates as URL-parameter strings;
 * saveGpsToDevice is the single writer of AppState.gpsOverride, so it must
 * pin the coordinate type to finite numbers no matter what callers pass;
 * hasValidLocation() consumers reject anything else.
 *
 * Usage:
 *   node test/unit/test_location.js
 */

const fs = require('fs');
const path = require('path');
const vm = require('vm');

let testsPassed = 0;
let testsFailed = 0;
const asyncTests = [];
function itAsync(name, fn) { asyncTests.push({ name, fn }); }
function assertTrue(v, m='') { if (!v) throw new Error(`${m}: expected truthy, got ${v}`); }
function assertEqual(a, b, m='') {
    if (a !== b) throw new Error(`${m}: expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`);
}

const mainJs = fs.readFileSync(path.join(__dirname, '../../src/web/main.js'), 'utf8');
const qrxJs = fs.readFileSync(path.join(__dirname, '../../src/web/qrx.js'), 'utf8');
const saveMatch = mainJs.match(/async function saveGpsToDevice\([\s\S]*?\n\}/);
const guardMatch = qrxJs.match(/function hasValidLocation\([\s\S]*?\n\}/);
if (!saveMatch || !guardMatch) {
    console.error('could not extract saveGpsToDevice / hasValidLocation');
    process.exit(1);
}
const hasValidLocation = new Function(`${guardMatch[0]}\nreturn hasValidLocation;`)();

function makeSandbox() {
    const sandbox = {
        console,
        fetch: async () => ({ ok: true }),
        AppState: { gpsOverride: null },
        localStorage: { store: {}, setItem(k, v) { this.store[k] = v; } },
        clearDistanceCache: () => {},
        Spots: { clear: () => {} },
        JSON: JSON,
    };
    vm.createContext(sandbox);
    vm.runInContext(saveMatch[0], sandbox);
    return sandbox;
}

itAsync('bridge-style string coordinates are stored as finite numbers', async () => {
    const sb = makeSandbox();
    await vm.runInContext('saveGpsToDevice("37.8917", "-122.1180")', sb);
    assertEqual(typeof sb.AppState.gpsOverride.latitude, 'number', 'latitude type');
    assertEqual(typeof sb.AppState.gpsOverride.longitude, 'number', 'longitude type');
    assertTrue(hasValidLocation(sb.AppState.gpsOverride),
        'gpsOverride from string input must satisfy hasValidLocation');
});

itAsync('numeric coordinates pass through unchanged', async () => {
    const sb = makeSandbox();
    await vm.runInContext('saveGpsToDevice(37.8917, -122.118)', sb);
    assertEqual(sb.AppState.gpsOverride.latitude, 37.8917);
    assertEqual(sb.AppState.gpsOverride.longitude, -122.118);
    assertTrue(hasValidLocation(sb.AppState.gpsOverride));
});

itAsync('localStorage cache also receives numbers', async () => {
    const sb = makeSandbox();
    await vm.runInContext('saveGpsToDevice("0", "-78.5")', sb);
    const cached = JSON.parse(sb.localStorage.store['cachedGpsLocation']);
    assertEqual(typeof cached.latitude, 'number', 'cached latitude type');
    assertEqual(cached.latitude, 0, 'zero latitude preserved');
    assertTrue(hasValidLocation(cached));
});

(async () => {
    console.log('\nLocation plumbing');
    for (const t of asyncTests) {
        try { await t.fn(); testsPassed++; console.log(`  ✓ ${t.name}`); }
        catch (e) { testsFailed++; console.log(`  ✗ ${t.name}\n    ${e.message}`); }
    }
    console.log('\n' + '='.repeat(60));
    console.log(`Results: ${testsPassed} passed, ${testsFailed} failed`);
    console.log('='.repeat(60));
    process.exit(testsFailed > 0 ? 1 : 0);
})();
