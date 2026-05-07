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

console.log(`\n${testsPassed} passed, ${testsFailed} failed`);
if (testsFailed > 0) {
    process.exit(1);
}
