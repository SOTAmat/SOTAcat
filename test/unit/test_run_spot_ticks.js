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

// ============================================================================
// Spot lifecycle: tap-to-tune, defer-during-drag, unsubscribe on tab exit
// ============================================================================

function loadLifecycleSandbox() {
    const subscribeCalls = [];
    const unsubscribeCalls = [];
    const tunes = [];
    const updateCalls = [];
    const listeners = {};

    const mockContainer = {
        _hasDragging: false,
        classList: {
            contains(c) { return c === "is-dragging" && mockContainer._hasDragging; },
            add() {},
            remove() {},
        },
        addEventListener(name, fn) { listeners[name] = fn; },
        querySelector() { return null; },
    };

    const sandbox = {
        console: console,
        Number: Number,
        document: {
            getElementById(id) { return id === "vfo-band-range" ? mockContainer : null; },
            addEventListener() {},
            removeEventListener() {},
            querySelectorAll() { return []; },
        },
        window: {},
        RunState: { spotsRebuildPending: false },
        AppState: {},
        Spots: {
            subscribe(cb) { subscribeCalls.push(cb); },
            unsubscribe(cb) { unsubscribeCalls.push(cb); },
        },
        tuneRadioHz(hz, mode) { tunes.push({ hz, mode }); },
        updateBandRangeDisplay() { updateCalls.push(true); },
        stopVfoUpdates() {},
        Log: {
            info() { return () => {}; }, warn() { return () => {}; },
            error() { return () => {}; }, debug() { return () => {}; },
        },
        // Stubs for setupBandRangeDrag's references we don't exercise here.
        onBandRangeDragStart() {},
        _subscribeCalls: subscribeCalls,
        _unsubscribeCalls: unsubscribeCalls,
        _tunes: tunes,
        _updateCalls: updateCalls,
        _listeners: listeners,
        _mockContainer: mockContainer,
    };
    vm.createContext(sandbox);

    const code = fs.readFileSync(path.join(__dirname, '../../src/web/run.js'), 'utf8');

    const onSpotsChangedMatch = code.match(/function onSpotsChanged\([^)]*\)\s*\{[\s\S]*?\n\}/);
    const setupDragMatch = code.match(/function setupBandRangeDrag\(\)\s*\{[\s\S]*?\n\}/);
    const onSpotLeavingMatch = code.match(/function onSpotLeaving\(\)\s*\{[\s\S]*?\n\}/);
    if (!onSpotsChangedMatch || !setupDragMatch || !onSpotLeavingMatch) {
        throw new Error('could not extract lifecycle functions from run.js');
    }
    vm.runInContext(onSpotsChangedMatch[0], sandbox);
    vm.runInContext(setupDragMatch[0], sandbox);
    vm.runInContext(onSpotLeavingMatch[0], sandbox);
    return sandbox;
}

console.log('\nSpot tick lifecycle');

it('onSpotsChanged rebuilds the band range immediately when not dragging', () => {
    const sb = loadLifecycleSandbox();
    sb._mockContainer._hasDragging = false;
    sb.onSpotsChanged();
    assertEqual(sb._updateCalls.length, 1, 'rebuild called');
    assertEqual(sb.RunState.spotsRebuildPending, false, 'no pending flag');
});

it('onSpotsChanged defers rebuild while drag is in progress', () => {
    const sb = loadLifecycleSandbox();
    sb._mockContainer._hasDragging = true;
    sb.onSpotsChanged();
    assertEqual(sb._updateCalls.length, 0, 'no rebuild during drag');
    assertEqual(sb.RunState.spotsRebuildPending, true, 'pending flag set');
});

it('tap on a spot tick calls tuneRadioHz with the tick\'s hz and mode', () => {
    const sb = loadLifecycleSandbox();
    sb.setupBandRangeDrag();
    const click = sb._listeners.click;
    if (typeof click !== 'function') throw new Error('click listener not registered');

    let propagationStopped = false;
    const tick = {
        dataset: { hz: '14250000', modeRaw: 'USB' },
    };
    click({
        target: { closest(sel) { return sel === '.vfo-band-range-spot-tick' ? tick : null; } },
        stopPropagation() { propagationStopped = true; },
    });
    assertEqual(sb._tunes.length, 1, 'tuned once');
    assertEqual(sb._tunes[0].hz, 14250000);
    assertEqual(sb._tunes[0].mode, 'USB');
    assertEqual(propagationStopped, true, 'stops propagation so drag handler skips');
});

it('tap outside any spot tick is a no-op (drag-to-tune still handles it)', () => {
    const sb = loadLifecycleSandbox();
    sb.setupBandRangeDrag();
    const click = sb._listeners.click;
    let propagationStopped = false;
    click({
        target: { closest() { return null; } },
        stopPropagation() { propagationStopped = true; },
    });
    assertEqual(sb._tunes.length, 0, 'no tune');
    assertEqual(propagationStopped, false, 'propagation untouched so drag handler can run');
});

it('tap with invalid hz (NaN) is a no-op', () => {
    const sb = loadLifecycleSandbox();
    sb.setupBandRangeDrag();
    const click = sb._listeners.click;
    const tick = { dataset: { hz: 'not-a-number', modeRaw: 'CW' } };
    click({
        target: { closest() { return tick; } },
        stopPropagation() {},
    });
    assertEqual(sb._tunes.length, 0, 'invalid hz: no tune');
});

it('onSpotLeaving unsubscribes the same callback that was subscribed', () => {
    const sb = loadLifecycleSandbox();
    sb.onSpotLeaving();
    assertEqual(sb._unsubscribeCalls.length, 1, 'unsubscribed once');
    assertEqual(sb._unsubscribeCalls[0], sb.onSpotsChanged, 'unsubscribes onSpotsChanged');
});

console.log(`\n${testsPassed} passed, ${testsFailed} failed`);
if (testsFailed > 0) process.exit(1);
