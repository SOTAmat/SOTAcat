#!/usr/bin/env node
/**
 * Unit tests for spots.js
 *
 * Usage:
 *   node test/unit/test_spots.js
 */

const fs = require('fs');
const path = require('path');
const vm = require('vm');

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
    if (actual !== expected) {
        throw new Error(`${msg}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
    }
}

function assertTrue(value, msg = '') {
    if (!value) throw new Error(`${msg}: expected truthy, got ${value}`);
}

function assertNull(value, msg = '') {
    if (value !== null) throw new Error(`${msg}: expected null, got ${JSON.stringify(value)}`);
}

// Minimal browser-like sandbox
function makeSandbox() {
    const storage = {};
    const sandbox = {
        console: console,
        Date: Date,
        Promise: Promise,
        setTimeout: setTimeout,
        clearTimeout: clearTimeout,
        JSON: JSON,
        localStorage: {
            getItem: (k) => (k in storage ? storage[k] : null),
            setItem: (k, v) => { storage[k] = String(v); },
            removeItem: (k) => { delete storage[k]; },
            _storage: storage,
        },
        // Stub Log so spots.js can call Log.info/.warn/.error/.debug
        Log: {
            info: () => () => {},
            warn: () => () => {},
            error: () => () => {},
            debug: () => () => {},
        },
        // chase_api.js's fetchAndProcessSpots — stubbed for tests
        fetchAndProcessSpots: async () => [],
        // main.js's getLocation — stubbed for tests
        getLocation: async () => null,
    };
    vm.createContext(sandbox);

    const spotsJsPath = path.join(__dirname, '../../src/web/spots.js');
    const spotsJsCode = fs.readFileSync(spotsJsPath, 'utf8');
    vm.runInContext(spotsJsCode, sandbox);

    return sandbox;
}

describe('Spots module shell', () => {
    it('Spots is exposed', () => {
        const { Spots } = makeSandbox();
        assertTrue(Spots, 'Spots global should be defined');
    });

    it('Spots.getAll() returns null before any load', () => {
        const { Spots } = makeSandbox();
        assertNull(Spots.getAll(), 'initial getAll() should be null');
    });
});

describe('Spots cache (localStorage)', () => {
    it('saveCache writes JSON with timestamp', () => {
        const sb = makeSandbox();
        sb.Spots._saveCache([{ hertz: 14250000, mode: 'USB' }]);
        const raw = sb.localStorage.getItem('chaseSpotCache');
        assertTrue(raw, 'cache key should exist');
        const parsed = JSON.parse(raw);
        assertEqual(parsed.spots.length, 1, 'one spot saved');
        assertTrue(parsed.timestamp > 0, 'timestamp set');
    });

    it('restoreCache populates spots when fresh', () => {
        const sb = makeSandbox();
        sb.localStorage.setItem('chaseSpotCache', JSON.stringify({
            spots: [{ hertz: 14250000 }, { hertz: 7100000 }],
            timestamp: Date.now() - 1000,  // 1 second ago
        }));
        const restored = sb.Spots._restoreCache();
        assertEqual(restored, true, 'restoreCache returns true on success');
        assertEqual(sb.Spots.getAll().length, 2, 'spots populated from cache');
    });

    it('restoreCache discards stale entries', () => {
        const sb = makeSandbox();
        const stale = (3600 + 60) * 1000;  // older than TTL
        sb.localStorage.setItem('chaseSpotCache', JSON.stringify({
            spots: [{ hertz: 14250000 }],
            timestamp: Date.now() - stale,
        }));
        const restored = sb.Spots._restoreCache();
        assertEqual(restored, false, 'restoreCache returns false on stale');
        assertNull(sb.Spots.getAll(), 'spots not populated');
        assertEqual(sb.localStorage.getItem('chaseSpotCache'), null, 'stale entry removed');
    });

    it('Spots.clear() empties cache and state', () => {
        const sb = makeSandbox();
        sb.Spots._saveCache([{ hertz: 14250000 }]);
        sb.Spots._restoreCache();
        sb.Spots.clear();
        assertNull(sb.Spots.getAll(), 'state cleared');
        assertEqual(sb.localStorage.getItem('chaseSpotCache'), null, 'cache cleared');
    });
});

console.log(`\n${testsPassed} passed, ${testsFailed} failed`);
if (testsFailed > 0) {
    process.exit(1);
}
