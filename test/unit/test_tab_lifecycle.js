#!/usr/bin/env node
/**
 * Unit tests for tab lifecycle and page-shell behavior (main.js, run.js).
 *
 * - loadActiveTab maps every historical tab name onto a current one and
 *   falls back to the default for unknown values.
 * - openTab ignores re-entrant calls while a switch is in flight.
 * - A manual firmware version check records its bookkeeping (timestamps,
 *   retry-timer stop) before reporting.
 * - The run page's PoLo button is enabled only when a VFO frequency exists.
 * - The visibility handler aborts requests frozen mid-flight so its
 *   refreshes are not skipped by the pollers' in-flight guards.
 *
 * Usage:
 *   node test/unit/test_tab_lifecycle.js
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

const mainJs = fs.readFileSync(path.join(__dirname, '../../src/web/main.js'), 'utf8');
const runJs = fs.readFileSync(path.join(__dirname, '../../src/web/run.js'), 'utf8');

// ---- loadActiveTab -------------------------------------------------------
console.log('\nloadActiveTab migration and validation');
const loadTabMatch = mainJs.match(/function loadActiveTab\(\)[\s\S]*?\n\}/);
if (loadTabMatch) {
    function tabFor(stored) {
        const sandbox = { localStorage: { getItem: () => stored } };
        vm.createContext(sandbox);
        vm.runInContext(loadTabMatch[0], sandbox);
        return vm.runInContext('loadActiveTab()', sandbox);
    }
    it('nothing stored -> default', () => assertEqual(tabFor(null), 'qrx'));
    it('current names pass through', () => {
        for (const t of ['run', 'chase', 'qrx', 'settings', 'about']) assertEqual(tabFor(t), t, t);
    });
    it('every historical name maps to a current tab', () => {
        assertEqual(tabFor('spot'), 'run', 'spot');
        assertEqual(tabFor('cat'), 'run', 'cat');
        assertEqual(tabFor('wrx'), 'qrx', 'wrx');
        assertEqual(tabFor('sota'), 'chase', 'sota');
        assertEqual(tabFor('pota'), 'chase', 'pota');
    });
    it('unknown garbage falls back to the default', () => assertEqual(tabFor('nonsense'), 'qrx'));
} else {
    it('loadActiveTab found in main.js', () => assertTrue(false, 'extraction failed'));
}

// ---- openTab re-entrancy -------------------------------------------------
const openTabMatch = mainJs.match(/async function openTab\(tabName\)[\s\S]*?\n\}/);

function makeOpenTabSandbox() {
    let releaseFetch;
    const fetchGate = new Promise((res) => { releaseFetch = res; });
    const state = { fetches: 0, appearing: 0 };
    const el = { classList: { add() {}, remove() {} }, innerHTML: '' };
    const sandbox = {
        console,
        Log: { debug: () => () => {}, warn: () => () => {}, error: () => () => {} },
        pollingPaused: false,
        AppState: { currentTabName: null, tabSwitchInProgress: false },
        cleanupCurrentTab: () => {},
        saveActiveTab: () => {},
        loadTabScriptIfNeeded: async () => {},
        alert: () => {},
        document: {
            querySelectorAll: () => [],
            getElementById: () => el,
        },
        window: { onChaseAppearing: async () => { state.appearing++; } },
        fetch: async () => { state.fetches++; await fetchGate; return { ok: true, text: async () => '<div/>' }; },
        _state: state,
        _releaseFetch: () => releaseFetch(),
    };
    vm.createContext(sandbox);
    vm.runInContext(openTabMatch ? openTabMatch[0] : 'function openTab(){}', sandbox);
    return sandbox;
}

itAsync('openTab ignores a second call while a switch is in flight', async () => {
    assertTrue(!!openTabMatch, 'openTab extraction failed');
    const sb = makeOpenTabSandbox();
    const first = vm.runInContext('openTab("chase")', sb);
    await new Promise((r) => setImmediate(r));           // let first reach its fetch
    const second = vm.runInContext('openTab("chase")', sb); // re-entrant call
    await new Promise((r) => setImmediate(r));
    assertEqual(sb._state.fetches, 1, 'second call must not fetch');
    sb._releaseFetch();
    await first;
    await second;
    assertEqual(sb._state.appearing, 1, 'appearing hook ran once');
    assertEqual(sb.AppState.tabSwitchInProgress, false, 'guard released');
});

itAsync('openTab accepts a new switch after the previous completes', async () => {
    const sb = makeOpenTabSandbox();
    const first = vm.runInContext('openTab("chase")', sb);
    sb._releaseFetch();
    await first;
    await vm.runInContext('openTab("chase")', sb);
    assertEqual(sb._state.fetches, 2, 'subsequent switch fetches again');
});

// ---- manual version check bookkeeping ------------------------------------
const versionMatch = mainJs.match(/async function checkFirmwareVersion\([\s\S]*?\n\}/);

itAsync('manual version check records bookkeeping before reporting', async () => {
    assertTrue(!!versionMatch, 'checkFirmwareVersion extraction failed');
    const store = {};
    const calls = { retryStop: 0 };
    const sandbox = {
        console,
        Log: { debug: () => () => {}, info: () => () => {}, warn: () => () => {}, error: () => () => {} },
        shouldCheckVersion: () => true,
        AbortController: class { constructor() { this.signal = {}; } abort() {} },
        setTimeout: () => 0,
        clearTimeout: () => {},
        Date: Date,
        fetch: async (url) => {
            if (String(url).includes('/api/v1/version')) return { ok: true, text: async () => 'K5EM_1:260801:1200-R' };
            return { ok: true, json: async () => ({ tag_name: 'v260825.1000', assets: [] }) };
        },
        normalizeVersion: (v) => (String(v).includes('260825') ? 2000 : 1000),
        localStorage: { setItem: (k, v) => { store[k] = v; }, getItem: () => null },
        confirm: () => false,
        alert: () => {},
        openTab: () => {},
        stopVersionCheckRetryTimer: () => { calls.retryStop++; },
        AppState: {},
        VERSION_CHECK_TIMEOUT_MS: 1000,
        GITHUB_RELEASES_API: 'https://api.github.com/x',
        VERSION_CHECK_STORAGE_KEY: 'vck',
        VERSION_CHECK_SUCCESS_KEY: 'vcs',
    };
    vm.createContext(sandbox);
    vm.runInContext(versionMatch[0], sandbox);
    const msg = await vm.runInContext('checkFirmwareVersion(true)', sandbox);
    assertTrue(typeof msg === 'string' && msg.includes('new firmware'), `report returned: ${JSON.stringify(msg)}`);
    assertTrue('vck' in store, 'check timestamp recorded');
    assertTrue('vcs' in store, 'success timestamp recorded');
    assertEqual(calls.retryStop, 1, 'retry timer stopped');
});

// ---- run-page PoLo gating -------------------------------------------------
console.log('\nRun-page PoLo gating');
const spotBtnMatch = runJs.match(/function updateSpotButtonStates\(\)[\s\S]*?\n\}/);
if (spotBtnMatch) {
    function poloDisabledWith(freq) {
        const btns = {};
        const mk = (id) => (btns[id] = { disabled: undefined });
        const sandbox = {
            AppState: { vfoFrequencyHz: freq },
            getLocationBasedReference: () => '',
            isValidSpotReference: () => false,
            Log: { debug: () => () => {} },
            document: { getElementById: (id) => mk(id) },
        };
        vm.createContext(sandbox);
        vm.runInContext(spotBtnMatch[0], sandbox);
        vm.runInContext('updateSpotButtonStates()', sandbox);
        return btns['polo-spot-button'].disabled;
    }
    it('PoLo disabled while no VFO frequency is known', () => assertEqual(poloDisabledWith(null), true));
    it('PoLo enabled once a frequency exists', () => assertEqual(poloDisabledWith(14074000), false));
} else {
    it('updateSpotButtonStates found in run.js', () => assertTrue(false, 'extraction failed'));
}

// ---- visibility refresh ---------------------------------------------------
const visMatch = mainJs.match(/function onVisibilityRefresh\(\)[\s\S]*?\n\}/);
itAsync('visibility handler aborts frozen requests then refreshes', async () => {
    assertTrue(!!visMatch, 'onVisibilityRefresh not found in main.js (named handler required)');
    const calls = { aborts: 0, conn: 0, vfo: 0, batt: 0 };
    const controller = { abort: () => { calls.aborts++; } };
    const sandbox = {
        document: { visibilityState: 'visible' },
        pollingPaused: false,
        connectionStatusController: controller,
        vfoController: null,
        batteryController: controller,
        Log: { debug: () => () => {} },
        updateConnectionStatus: () => { calls.conn++; },
        fetchVfoState: () => { calls.vfo++; },
        updateBatteryInfo: () => { calls.batt++; },
    };
    vm.createContext(sandbox);
    vm.runInContext(visMatch[0], sandbox);
    vm.runInContext('onVisibilityRefresh()', sandbox);
    assertEqual(calls.aborts, 2, 'both frozen controllers aborted (null one skipped)');
    assertTrue(calls.conn === 1 && calls.vfo === 1 && calls.batt === 1, 'all three refreshers called');
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
