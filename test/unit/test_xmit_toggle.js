#!/usr/bin/env node
/**
 * Unit tests for toggleXmit / sendXmitRequest (main.js).
 *
 * The XMIT button is optimistic: it flips immediately, and it must revert
 * when the radio refuses the PUT (503 while the keyer or FT8 owns the
 * radio, or the link is down) or the request never arrives. Nothing else
 * ever writes AppState.isXmitActive, so a missed revert leaves the UI
 * transmit state inverted for every later toggle: an on-air hazard.
 *
 * Usage:
 *   node test/unit/test_xmit_toggle.js
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
const fetchQuietMatch = mainJs.match(/function fetchQuiet\([\s\S]*?\n\}/);
const sendXmitMatch = mainJs.match(/function sendXmitRequest\([\s\S]*?\n\}/);
const toggleMatch = mainJs.match(/function toggleXmit\([\s\S]*?\n\}/);
const syncMatch = mainJs.match(/function syncXmitButtonState\([\s\S]*?\n\}/);
const seqMatch = mainJs.match(/let xmitToggleSeq = \d+;/);

function makeSandbox(fetchImpl) {
    const classes = new Set();
    const state = { classes, fetches: [] };
    const sandbox = {
        fetch: (url, options) => { state.fetches.push(url); return fetchImpl(url, options); },
        Log: { error: () => () => {}, debug: () => () => {} },
        document: {
            getElementById: (id) => (id === 'xmit-button' ? {
                classList: {
                    add: (c) => classes.add(c),
                    remove: (c) => classes.delete(c),
                    contains: (c) => classes.has(c),
                },
            } : null),
        },
        AppState: { isXmitActive: false },
        _state: state,
    };
    vm.createContext(sandbox);
    vm.runInContext(fetchQuietMatch[0], sandbox);
    if (seqMatch) vm.runInContext(seqMatch[0], sandbox);
    vm.runInContext(sendXmitMatch[0], sandbox);
    vm.runInContext(syncMatch[0], sandbox);
    vm.runInContext(toggleMatch[0], sandbox);
    return sandbox;
}

const tick = () => new Promise((r) => setImmediate(r));

itAsync('an accepted PUT keeps the optimistic TX state', async () => {
    assertTrue(!!fetchQuietMatch && !!sendXmitMatch && !!toggleMatch && !!syncMatch,
               'extractions failed');
    const sb = makeSandbox(async () => ({ ok: true, status: 204 }));
    vm.runInContext('toggleXmit()', sb);
    assertEqual(sb.AppState.isXmitActive, true, 'optimistic flip');
    await tick();
    assertEqual(sb.AppState.isXmitActive, true, 'state kept after 204');
    assertTrue(sb._state.classes.has('active'), 'button shows TX');
    assertTrue(sb._state.fetches[0].includes('state=1'), 'PUT state=1');
});

itAsync('a refused PUT (503, radio busy) reverts state and button', async () => {
    const sb = makeSandbox(async () => ({ ok: false, status: 503 }));
    vm.runInContext('toggleXmit()', sb);
    assertEqual(sb.AppState.isXmitActive, true, 'optimistic flip happens first');
    await tick();
    assertEqual(sb.AppState.isXmitActive, false, 'state reverted after 503');
    assertTrue(!sb._state.classes.has('active'), 'button no longer shows TX');
});

itAsync('a network failure reverts state and button', async () => {
    const sb = makeSandbox(async () => { throw new Error('net down'); });
    vm.runInContext('toggleXmit()', sb);
    await tick();
    assertEqual(sb.AppState.isXmitActive, false, 'state reverted on network failure');
    assertTrue(!sb._state.classes.has('active'), 'button no longer shows TX');
});

itAsync('a late failure never clobbers a newer toggle', async () => {
    // Toggle on (reply delayed), off (ok), on (ok); then the FIRST request
    // fails. The stale failure must not revert the newest successful state.
    let failFirst;
    let call = 0;
    const sb = makeSandbox((url) => {
        call++;
        if (call === 1) return new Promise((resolve) => { failFirst = () => resolve({ ok: false, status: 503 }); });
        return Promise.resolve({ ok: true, status: 204 });
    });
    vm.runInContext('toggleXmit()', sb);  // -> TX, reply pending
    vm.runInContext('toggleXmit()', sb);  // -> RX, ok
    vm.runInContext('toggleXmit()', sb);  // -> TX, ok
    await tick();
    failFirst();
    await tick();
    assertEqual(sb.AppState.isXmitActive, true, 'stale failure ignored');
    assertTrue(sb._state.classes.has('active'), 'button still shows TX');
});

(async () => {
    console.log('\ntoggleXmit / sendXmitRequest');
    for (const t of asyncTests) {
        try { await t.fn(); testsPassed++; console.log(`  ✓ ${t.name}`); }
        catch (e) { testsFailed++; console.log(`  ✗ ${t.name}\n    ${e.message}`); }
    }
    console.log('\n' + '='.repeat(60));
    console.log(`Results: ${testsPassed} passed, ${testsFailed} failed`);
    console.log('='.repeat(60));
    process.exit(testsFailed > 0 ? 1 : 0);
})();
