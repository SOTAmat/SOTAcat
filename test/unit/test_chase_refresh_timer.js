#!/usr/bin/env node
/**
 * Unit tests for the Chase refresh-timer state on tab appearance (chase.js).
 *
 * When the tab renders spots restored from the localStorage cache, the
 * "Refreshed N ago" timer must reflect the cache's fetch time, not zero.
 *
 * Usage:
 *   node test/unit/test_chase_refresh_timer.js
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

const chaseJs = fs.readFileSync(path.join(__dirname, '../../src/web/chase.js'), 'utf8');
const appearingMatch = chaseJs.match(/(?:async )?function onChaseAppearing\([\s\S]*?\n\}/);

function makeSandbox(spots) {
    const sandbox = {
        console,
        Log: { debug: () => () => {}, info: () => () => {}, warn: () => () => {} },
        ChaseState: { lastRefreshCompleteTime: 0, sortField: 'time', descending: true },
        Spots: {
            getAll: () => spots,
            _restoreCache: () => {},
            loadAutoRefreshPref: () => false,
            startAutoRefresh: () => {},
            getLastFetchCompleteTime: () => 1756100000000,
        },
        updateChaseTable: () => {},
        refreshChaseJson: () => {},
        startRefreshTimer: () => {},
        updateSortIndicators: () => {},
        document: { querySelectorAll: () => [], getElementById: () => null },
        ensureCallSignLoaded: async () => {},
        ensureLicenseClassLoaded: async () => {},
        getLocation: async () => null,
        loadCwMacrosAsync: async () => {},
        attachChaseEventListeners: () => {},
        updateAutoRefreshButton: () => {},
        loadRadioType: async () => {},
        loadFilterBandsSetting: () => {},
        loadScanDwellTime: () => {},
        loadUnitsSetting: () => {},
        subscribeToVfo: () => {},
        startGlobalVfoPolling: () => {},
        updateMyCallButton: () => {},
        updateTunedRowHighlight: () => {},
        updateScanButtonLabel: () => {},
        setTimeout: () => 0,
        clearInterval: () => {},
        setInterval: () => 0,
    };
    vm.createContext(sandbox);
    vm.runInContext(appearingMatch[0], sandbox);
    return sandbox;
}

console.log('\nChase refresh timer on tab appearance');

it('chase.js defines onChaseAppearing', () => {
    if (!appearingMatch) throw new Error('onChaseAppearing not found');
});

(async () => {
    if (appearingMatch) {
        const asyncCases = [
            ['cache-restored render adopts the cached fetch time', async () => {
                const sb = makeSandbox([{ id: 1 }]);
                await vm.runInContext('onChaseAppearing()', sb);
                assertEqual(sb.ChaseState.lastRefreshCompleteTime, 1756100000000,
                    'timer state must come from Spots.getLastFetchCompleteTime()');
            }],
            ['cold start (no spots) leaves the fresh-fetch path in charge', async () => {
                const sb = makeSandbox(null);
                await vm.runInContext('onChaseAppearing()', sb);
                assertEqual(sb.ChaseState.lastRefreshCompleteTime, 0,
                    'no cache: refreshChaseJson owns the timestamp');
            }],
        ];
        for (const [name, fn] of asyncCases) {
            try { await fn(); testsPassed++; console.log(`  ✓ ${name}`); }
            catch (e) { testsFailed++; console.log(`  ✗ ${name}\n    ${e.message}`); }
        }
    }

    console.log('\n' + '='.repeat(60));
    console.log(`Results: ${testsPassed} passed, ${testsFailed} failed`);
    console.log('='.repeat(60));
    process.exit(testsFailed > 0 ? 1 : 0);
})();
