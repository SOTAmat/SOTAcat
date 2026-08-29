#!/usr/bin/env node
/**
 * Unit tests for the run page's VFO wiring (run.js + main.js).
 *
 * The run page consumes the shared main.js VFO poller through the
 * subscribe/notify API; its subscriber skips display writes while the
 * operator is editing the frequency field; the shared poller honors a
 * post-user-action suppression window; the set-frequency debounce never
 * lets a stale timer clear a newer one's handle.
 *
 * Usage:
 *   node test/unit/test_run_vfo.js
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
function assertTrue(v, m='') { if (!v) throw new Error(`${m}: expected truthy, got ${v}`); }
function assertEqual(a, b, m='') {
    if (a !== b) throw new Error(`${m}: expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`);
}

const runJs = fs.readFileSync(path.join(__dirname, '../../src/web/run.js'), 'utf8');
const mainJs = fs.readFileSync(path.join(__dirname, '../../src/web/main.js'), 'utf8');

console.log('\nRun page uses the shared VFO stack');

it('run.js no longer defines its own polling stack', () => {
    for (const fn of ['getCurrentVfoState', 'startVfoUpdates', 'stopVfoUpdates', 'notifyVfoSubscribers']) {
        assertTrue(!new RegExp(`function ${fn}\\(`).test(runJs), `run.js still defines ${fn}`);
    }
});

it('main.js owns the subscriber fan-out', () => {
    assertTrue(/function notifyVfoSubscribers\(/.test(mainJs), 'notifyVfoSubscribers must live in main.js');
});

it('run page subscribes on appearing and unsubscribes on leaving', () => {
    const appearing = runJs.match(/async function onSpotAppearing\(\)[\s\S]*?\n\}/);
    const leaving = runJs.match(/function onSpotLeaving\(\)[\s\S]*?\n\}/);
    assertTrue(appearing && appearing[0].includes('subscribeToVfo('), 'onSpotAppearing must subscribeToVfo');
    assertTrue(appearing && appearing[0].includes('startGlobalVfoPolling('), 'onSpotAppearing must start global polling');
    assertTrue(leaving && leaving[0].includes('unsubscribeFromVfo('), 'onSpotLeaving must unsubscribeFromVfo');
});

const subMatch = runJs.match(/function onRunVfoChanged\([\s\S]*?\n\}/);
it('run.js defines onRunVfoChanged', () => {
    assertTrue(!!subMatch, 'onRunVfoChanged not found in run.js');
});

if (subMatch) {
    function makeSubSandbox() {
        const calls = [];
        const sandbox = {
            RunState: { isEditingFrequency: false },
            updateFrequencyDisplay: () => calls.push('freq'),
            updateBandDisplay: () => calls.push('band'),
            updateModeDisplay: () => calls.push('mode'),
            // The privilege redraw is queued (coalesced per animation frame),
            // not called directly; a queue request counts as the update.
            queuePrivilegeRedraw: () => calls.push('priv'),
            updateSpotButtonStates: () => calls.push('buttons'),
            _calls: calls,
        };
        vm.createContext(sandbox);
        vm.runInContext(subMatch[0], sandbox);
        return sandbox;
    }

    it('subscriber updates all displays when not editing', () => {
        const sb = makeSubSandbox();
        vm.runInContext('onRunVfoChanged(14074000, "FT8")', sb);
        for (const c of ['freq', 'band', 'mode', 'priv']) {
            assertTrue(sb._calls.includes(c), `missing ${c} update`);
        }
    });

    it('subscriber writes nothing while the operator edits the frequency field', () => {
        const sb = makeSubSandbox();
        sb.RunState.isEditingFrequency = true;
        vm.runInContext('onRunVfoChanged(14074000, "FT8")', sb);
        assertEqual(sb._calls.length, 0, 'no display writes during editing');
    });
}

const setFreqMatch = runJs.match(/function setFrequency\(frequencyHz\)[\s\S]*?\n\}/);
it('run.js defines setFrequency', () => assertTrue(!!setFreqMatch, 'setFrequency not found'));

if (setFreqMatch) {
    itAsync('stale debounce timer never clears a newer handle', async () => {
        const timers = [];
        let nextId = 100;
        const sandbox = {
            RunState: { pendingFrequencyUpdate: null },
            FREQUENCY_UPDATE_DEBOUNCE_MS: 300,
            VFO_ACTION_SUPPRESS_MS: 2000,
            AppState: { vfoFrequencyHz: null, vfoLastUpdated: 0 },
            Date: Date,
            setTimeout: (fn) => { const id = nextId++; timers.push({ id, fn }); return id; },
            clearTimeout: () => {},
            setFrequencyImmediate: async () => {},
            suppressVfoPolling: () => {},
            updateFrequencyDisplay: () => {},
            updateBandDisplay: () => {},
            updatePrivilegeDisplay: () => {},
            notifyVfoSubscribers: () => {},
        };
        vm.createContext(sandbox);
        vm.runInContext(setFreqMatch[0], sandbox);

        vm.runInContext('setFrequency(14074000)', sandbox);   // arms timer A
        vm.runInContext('setFrequency(14075000)', sandbox);   // arms timer B (A cleared but we fire it anyway, simulating the already-fired race)
        assertEqual(sandbox.RunState.pendingFrequencyUpdate, timers[1].id, 'newest handle stored');
        await timers[0].fn();                                  // stale timer body runs late
        assertEqual(sandbox.RunState.pendingFrequencyUpdate, timers[1].id,
            'stale timer must not null the newer handle');
        await timers[1].fn();                                  // current timer completes
        assertEqual(sandbox.RunState.pendingFrequencyUpdate, null, 'own completion clears the handle');
    });
}

console.log('\nShared poller suppression window (main.js)');

const fetchVfoMatch = mainJs.match(/async function fetchVfoState\(\)[\s\S]*?\n\}/);
const suppressMatch = mainJs.match(/function suppressVfoPolling\([\s\S]*?\n\}/);

it('main.js defines suppressVfoPolling', () => assertTrue(!!suppressMatch, 'suppressVfoPolling not found'));

if (fetchVfoMatch && suppressMatch) {
    itAsync('fetchVfoState skips entirely inside the suppression window', async () => {
        let fetches = 0;
        const sandbox = {
            fetch: () => { fetches++; return Promise.resolve({ ok: false }); },
            AbortController: class { constructor() { this.signal = {}; } abort() {} },
            setTimeout: () => 0,
            clearTimeout: () => {},
            Date: Date,
            pollingPaused: false,
            isLocalhost: false,
            vfoController: null,
            Log: { debug: () => () => {}, warn: () => () => {}, error: () => () => {} },
            AppState: { vfoFrequencyHz: null, vfoMode: null, vfoLastUpdated: 0, vfoChangeCallbacks: [], vfoPollSuppressedUntil: 0 },
            VFO_TIMEOUT_MS: 1000,
        };
        vm.createContext(sandbox);
        vm.runInContext(suppressMatch[0], sandbox);
        vm.runInContext(fetchVfoMatch[0], sandbox);

        vm.runInContext('suppressVfoPolling(60000)', sandbox);
        await vm.runInContext('fetchVfoState()', sandbox);
        assertEqual(fetches, 0, 'no network traffic while suppressed');

        vm.runInContext('AppState.vfoPollSuppressedUntil = 0', sandbox);
        await vm.runInContext('fetchVfoState()', sandbox);
        assertTrue(fetches > 0, 'polling resumes after the window');
    });

    itAsync('a non-numeric frequency payload never enters AppState', async () => {
        const notified = [];
        const sandbox = {
            fetch: async (url) => ({
                ok: true,
                text: async () => (String(url).includes('frequency') ? 'garbage' : 'cw'),
            }),
            AbortController: class { constructor() { this.signal = {}; } abort() {} },
            setTimeout: () => 0,
            clearTimeout: () => {},
            Date: Date,
            Promise: Promise,
            pollingPaused: false,
            isLocalhost: false,
            vfoController: null,
            Log: { debug: () => () => {}, warn: () => () => {}, error: () => () => {} },
            AppState: {
                vfoFrequencyHz: 14000000, vfoMode: 'CW', vfoLastUpdated: 0,
                vfoChangeCallbacks: [(f, m) => notified.push([f, m])],
                vfoPollSuppressedUntil: 0,
            },
            VFO_TIMEOUT_MS: 1000,
        };
        vm.createContext(sandbox);
        vm.runInContext(fetchVfoMatch[0], sandbox);
        await vm.runInContext('fetchVfoState()', sandbox);
        assertEqual(sandbox.AppState.vfoFrequencyHz, 14000000,
                    'frequency unchanged on a garbage payload');
        assertEqual(notified.length, 0, 'no subscriber churn on a garbage payload');
    });
}

// ============================================================================
// setMode: "SSB" goes to the firmware verbatim (RADIO_MODE_SSB_AUTO picks
// the sideband against the actual radio frequency); the client must not
// guess from a possibly-unknown VFO.
// ============================================================================

const setModeMatch = runJs.match(/async function setMode\([\s\S]*?\n\}/);

function makeSetModeSandbox() {
    const calls = [];
    const sandbox = {
        fetch: async (url) => { calls.push(String(url)); return { ok: true }; },
        suppressVfoPolling: () => {},
        VFO_ACTION_SUPPRESS_MS: 2000,
        AppState: { vfoFrequencyHz: null, vfoMode: 'CW', vfoLastUpdated: 0 },
        resyncVfoFromRadio: () => calls.push('resync'),
        updateModeDisplay: () => {},
        updatePrivilegeDisplay: () => {},
        notifyVfoSubscribers: () => {},
        Date: Date,
        Log: { debug: () => () => {}, error: () => () => {} },
        _calls: calls,
    };
    vm.createContext(sandbox);
    vm.runInContext(setModeMatch[0], sandbox);
    return sandbox;
}

if (setModeMatch) {
    itAsync('setMode sends SSB verbatim and re-reads the resolved sideband', async () => {
        const sb = makeSetModeSandbox();
        await vm.runInContext('setMode("SSB")', sb);
        assertTrue(sb._calls[0].includes('mode=SSB'), `SSB sent verbatim, got ${sb._calls[0]}`);
        assertTrue(sb._calls.includes('resync'), 'resolved sideband re-read from the radio');
        assertEqual(sb.AppState.vfoMode, 'CW', 'no client-side sideband guess written');
    });

    itAsync('setMode applies a plain mode optimistically', async () => {
        const sb = makeSetModeSandbox();
        await vm.runInContext('setMode("CW")', sb);
        assertTrue(sb._calls[0].includes('mode=CW'), 'mode sent');
        assertEqual(sb.AppState.vfoMode, 'CW', 'mode written optimistically');
    });
}

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
