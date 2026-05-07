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
        const r = fn();
        if (r && typeof r.then === 'function') {
            r.then(() => {
                testsPassed++;
                console.log(`  ✓ ${name}`);
            }).catch((e) => {
                testsFailed++;
                console.log(`  ✗ ${name}`);
                console.log(`    ${e.message}`);
                failures.push({ name, error: e.message });
            });
        } else {
            testsPassed++;
            console.log(`  ✓ ${name}`);
        }
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

describe('Spots.refresh()', () => {
    it('fetches spots and stores them', async () => {
        const sb = makeSandbox();
        // Override the stub to return real-looking data
        sb.fetchAndProcessSpots = async () => ([
            { hertz: 14250000, mode: 'USB' },
            { hertz: 7100000, mode: 'CW' },
        ]);
        const result = await sb.Spots.refresh({ force: true });
        assertEqual(result.length, 2, 'returns fetched spots');
        assertEqual(sb.Spots.getAll().length, 2, 'state populated');
    });

    it('rate-limited calls return cached data without fetching', async () => {
        const sb = makeSandbox();
        let callCount = 0;
        sb.fetchAndProcessSpots = async () => { callCount++; return [{ hertz: 14250000 }]; };
        await sb.Spots.refresh({ force: true });
        await sb.Spots.refresh({ force: false });    // should be rate-limited
        assertEqual(callCount, 1, 'second call did not refetch');
    });

    it('force=true bypasses rate limit', async () => {
        const sb = makeSandbox();
        let callCount = 0;
        sb.fetchAndProcessSpots = async () => { callCount++; return []; };
        await sb.Spots.refresh({ force: true });
        await sb.Spots.refresh({ force: true });
        assertEqual(callCount, 2, 'both forced calls fetched');
    });

    it('concurrent refresh calls dedupe to one fetch', async () => {
        const sb = makeSandbox();
        let callCount = 0;
        sb.fetchAndProcessSpots = async () => {
            callCount++;
            // Hold the fetch open briefly
            await new Promise(r => setTimeout(r, 10));
            return [];
        };
        await Promise.all([
            sb.Spots.refresh({ force: true }),
            sb.Spots.refresh({ force: true }),
            sb.Spots.refresh({ force: true }),
        ]);
        assertEqual(callCount, 1, 'in-flight call deduped');
    });
});

describe('Spots subscribers', () => {
    it('subscribe is called when refresh completes', async () => {
        const sb = makeSandbox();
        sb.fetchAndProcessSpots = async () => [{ hertz: 14250000 }];
        let received = null;
        sb.Spots.subscribe(spots => { received = spots; });
        await sb.Spots.refresh({ force: true });
        assertTrue(received, 'subscriber fired');
        assertEqual(received.length, 1, 'received the spots');
    });

    it('multiple subscribers all fire', async () => {
        const sb = makeSandbox();
        sb.fetchAndProcessSpots = async () => [];
        let count = 0;
        sb.Spots.subscribe(() => { count++; });
        sb.Spots.subscribe(() => { count++; });
        await sb.Spots.refresh({ force: true });
        assertEqual(count, 2, 'both subscribers fired');
    });

    it('unsubscribe stops further calls', async () => {
        const sb = makeSandbox();
        sb.fetchAndProcessSpots = async () => [];
        let count = 0;
        const cb = () => { count++; };
        sb.Spots.subscribe(cb);
        await sb.Spots.refresh({ force: true });
        sb.Spots.unsubscribe(cb);
        await sb.Spots.refresh({ force: true });
        assertEqual(count, 1, 'only fired once');
    });

    it('self-unsubscribe during notify does not skip peers', async () => {
        const sb = makeSandbox();
        sb.fetchAndProcessSpots = async () => [];
        let aFired = 0;
        let bFired = 0;
        const a = () => { aFired++; sb.Spots.unsubscribe(a); };
        const b = () => { bFired++; };
        sb.Spots.subscribe(a);
        sb.Spots.subscribe(b);
        await sb.Spots.refresh({ force: true });
        assertEqual(aFired, 1, 'a fired once');
        assertEqual(bFired, 1, 'b also fired (was not skipped by a unsubscribing)');
    });
});

describe('Spots auto-refresh', () => {
    it('startAutoRefresh sets state, schedules next time', () => {
        const sb = makeSandbox();
        sb.Spots.startAutoRefresh();
        assertEqual(sb.Spots.isAutoRefreshEnabled(), true, 'enabled flag set');
        assertTrue(sb.Spots.getNextAutoRefreshTime() > Date.now(), 'next time scheduled');
        sb.Spots.stopAutoRefresh();   // clean up timer
    });

    it('stopAutoRefresh clears state', () => {
        const sb = makeSandbox();
        sb.Spots.startAutoRefresh();
        sb.Spots.stopAutoRefresh();
        assertEqual(sb.Spots.isAutoRefreshEnabled(), false, 'flag cleared');
        assertEqual(sb.Spots.getNextAutoRefreshTime(), 0, 'next time cleared');
    });

    it('startAutoRefresh persists to localStorage', () => {
        const sb = makeSandbox();
        sb.Spots.startAutoRefresh();
        assertEqual(sb.localStorage.getItem('chaseAutoRefreshEnabled'), 'true', 'persisted');
        sb.Spots.stopAutoRefresh();
    });
});

// Wait for any pending async its before reporting
setTimeout(() => {
    console.log(`\n${testsPassed} passed, ${testsFailed} failed`);
    if (testsFailed > 0) process.exit(1);
}, 100);
