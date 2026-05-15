#!/usr/bin/env node
/**
 * Tab re-entry rebuild + subscriber-leak regression for chase.js.
 *
 * Validates that re-entering the CHASE tab rebuilds the table from the
 * current spots snapshot, and that the Spots subscriber count stays bounded
 * across attach/leave cycles (no leak from repeated tab switches).
 *
 * Usage:
 *   node test/unit/test_chase_tab_reentry.js
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

function makeDomNode() {
    return {
        addEventListener() {},
        removeEventListener() {},
        querySelector() { return null; },
        querySelectorAll() { return []; },
        cloneNode() { return makeDomNode(); },
        replaceWith() {},
        closest() { return makeDomNode(); },
        getAttribute() { return ''; },
        value: '',
    };
}

function loadSandbox() {
    // Tracks Spots.subscribe / Spots.unsubscribe interleaved with their argument
    // so we can compute the effective subscriber count after any sequence of
    // attach/leave calls.
    const subscribeArgs = [];
    const unsubscribeArgs = [];
    const updateChaseTableCalls = [];

    const sandbox = {
        console: console,
        document: {
            getElementById() { return makeDomNode(); },
            querySelectorAll() { return []; },
            querySelector() { return null; },
            addEventListener() {},
            removeEventListener() {},
        },
        localStorage: {
            getItem() { return null; },
            setItem() {},
            removeItem() {},
        },
        ChaseState: {
            chaseEventListenersAttached: false,
            scanKeyboardListenerAdded: false,
            scanActive: false,
            scanTimeoutId: null,
            scanCurrentIndex: -1,
            modeFilter: null,
            typeFilter: null,
            sortField: 'timestamp',
            lastSortField: 'timestamp',
            descending: true,
            suggestingAutoRefresh: false,
            suggestionRevertTimeoutId: null,
        },
        AppState: {},
        Spots: {
            _spots: null,
            subscribe(cb) { subscribeArgs.push(cb); },
            unsubscribe(cb) { unsubscribeArgs.push(cb); },
            getAll() { return this._spots; },
            isAutoRefreshEnabled() { return false; },
            loadAutoRefreshPref() { return false; },
            startAutoRefresh() {},
            _restoreCache() { return false; },
        },
        updateChaseTable() { updateChaseTableCalls.push(true); },
        loadSortState() {},
        loadGlobalModeFilter() {},
        loadTypeFilter() {},
        saveSortState() {},
        updateSortIndicators() {},
        updateRefreshButtonLabel() {},
        stopAutoRefresh() {},
        clearTimeout() {},
        onChaseKeydown() {},
        // Listener callbacks referenced directly (not via arrow body) — these
        // names must resolve at attachChaseEventListeners call time, so they
        // need to exist in the sandbox even though we don't invoke them.
        onMyCallClick() {},
        launchPoloChase() {},
        toggleScan() {},
        onModeFilterChange() {},
        onTypeFilterChange() {},
        // onChaseLeaving references:
        unsubscribeFromVfo() {},
        updateTunedRowHighlight() {},
        updateMyCallButton() {},
        stopRefreshTimer() {},
        Log: {
            info() { return () => {}; }, warn() { return () => {}; },
            error() { return () => {}; }, debug() { return () => {}; },
        },
        _subscribeArgs: subscribeArgs,
        _unsubscribeArgs: unsubscribeArgs,
        _updateChaseTableCalls: updateChaseTableCalls,
    };
    vm.createContext(sandbox);

    const code = fs.readFileSync(path.join(__dirname, '../../src/web/chase.js'), 'utf8');
    const tests = [
        /function onChaseSpotsChanged\(\)\s*\{[\s\S]*?\n\}/,
        /function stopScan\(\)\s*\{[\s\S]*?\n\}/,
        /function attachChaseEventListeners\(\)\s*\{[\s\S]*?\n\}/,
        /function onChaseLeaving\(\)\s*\{[\s\S]*?\n\}/,
    ];
    for (const re of tests) {
        const m = code.match(re);
        if (!m) throw new Error(`could not extract function for ${re}`);
        vm.runInContext(m[0], sandbox);
    }
    return sandbox;
}

// Compute net effective subscriber count by walking subscribe / unsubscribe
// log in order. (Set-based semantics, mirroring Spots._notify's iteration.)
function effectiveSubscriberCount(subscribes, unsubscribes) {
    const set = new Set();
    for (const cb of subscribes) set.add(cb);
    for (const cb of unsubscribes) set.delete(cb);
    return set.size;
}

console.log('\nChase tab re-entry + subscriber leak');

it('attachChaseEventListeners subscribes onChaseSpotsChanged once', () => {
    const sb = loadSandbox();
    sb.attachChaseEventListeners();
    assertEqual(sb._subscribeArgs.length, 1, 'one subscribe call');
    assertEqual(sb._subscribeArgs[0], sb.onChaseSpotsChanged, 'same fn ref');
});

it('attachChaseEventListeners is idempotent: second call within same session does NOT re-subscribe', () => {
    const sb = loadSandbox();
    sb.attachChaseEventListeners();
    sb.attachChaseEventListeners();
    assertEqual(sb._subscribeArgs.length, 1, 'still one subscribe call');
});

it('onChaseLeaving unsubscribes onChaseSpotsChanged with the same reference', () => {
    const sb = loadSandbox();
    sb.attachChaseEventListeners();
    sb.onChaseLeaving();
    assertEqual(sb._unsubscribeArgs.length, 1, 'one unsubscribe call');
    assertEqual(sb._unsubscribeArgs[0], sb.onChaseSpotsChanged, 'unsubscribes same fn that was subscribed');
});

it('onChaseLeaving resets chaseEventListenersAttached so re-attach is possible', () => {
    const sb = loadSandbox();
    sb.attachChaseEventListeners();
    assertEqual(sb.ChaseState.chaseEventListenersAttached, true);
    sb.onChaseLeaving();
    assertEqual(sb.ChaseState.chaseEventListenersAttached, false, 'flag cleared on leave');
});

it('attach/leave cycle nets zero subscribers (no leak across one cycle)', () => {
    const sb = loadSandbox();
    sb.attachChaseEventListeners();
    sb.onChaseLeaving();
    assertEqual(effectiveSubscriberCount(sb._subscribeArgs, sb._unsubscribeArgs), 0, 'net zero subs');
});

it('three attach/leave cycles still net zero subscribers (no leak across many cycles)', () => {
    const sb = loadSandbox();
    for (let i = 0; i < 3; i++) {
        sb.attachChaseEventListeners();
        sb.onChaseLeaving();
    }
    assertEqual(sb._subscribeArgs.length, 3, 'subscribed 3 times');
    assertEqual(sb._unsubscribeArgs.length, 3, 'unsubscribed 3 times');
    assertEqual(effectiveSubscriberCount(sb._subscribeArgs, sb._unsubscribeArgs), 0, 'net zero subs');
});

it('onChaseSpotsChanged invokes updateChaseTable (tab re-entry rebuild via subscriber)', () => {
    const sb = loadSandbox();
    sb.attachChaseEventListeners();
    // Simulate a Spots notification by calling the subscribed callback directly.
    const cb = sb._subscribeArgs[0];
    cb();
    assertEqual(sb._updateChaseTableCalls.length, 1, 'table rebuild triggered');
});

console.log(`\n${testsPassed} passed, ${testsFailed} failed`);
if (testsFailed > 0) process.exit(1);
