#!/usr/bin/env node
/**
 * Unit tests for fetchQuiet and sendKeys (main.js).
 *
 * fetchQuiet logs HTTP-level failures (not only network rejections) and
 * hands the response back so callers can act. sendKeys enforces the
 * firmware's parameter limit client-side (the keyer message is decoded
 * into a 128-byte buffer while still URL-encoded, so the ENCODED length is
 * what matters) and tells the operator whenever the CW did not go out.
 *
 * Usage:
 *   node test/unit/test_send_keys.js
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
const sendKeysMatch = mainJs.match(/(?:async )?function sendKeys\([\s\S]*?\n\}/);
const limitMatch = mainJs.match(/const KEYER_MESSAGE_ENCODED_LIMIT = \d+;/);

function makeSandbox(fetchImpl) {
    const state = { errors: [], alerts: [], fetches: [] };
    const sandbox = {
        fetch: (url, options) => { state.fetches.push(url); return fetchImpl(url, options); },
        Log: { error: () => (...a) => state.errors.push(a.join(' ')), debug: () => () => {} },
        alert: (msg) => state.alerts.push(msg),
        encodeURIComponent,
        _state: state,
    };
    vm.createContext(sandbox);
    vm.runInContext(fetchQuietMatch[0], sandbox);
    if (limitMatch) vm.runInContext(limitMatch[0], sandbox);
    vm.runInContext(sendKeysMatch[0], sandbox);
    return sandbox;
}

itAsync('fetchQuiet logs an HTTP failure and returns the response', async () => {
    assertTrue(!!fetchQuietMatch && !!sendKeysMatch, 'extractions failed');
    const sb = makeSandbox(async () => ({ ok: false, status: 404 }));
    const r = await vm.runInContext('fetchQuiet("/api/v1/x", {}, "T")', sb);
    assertTrue(r && r.status === 404, 'response returned to caller');
    assertTrue(sb._state.errors.some((e) => e.includes('404')), 'HTTP status logged');
});

itAsync('fetchQuiet logs a network failure and resolves undefined', async () => {
    const sb = makeSandbox(async () => { throw new Error('net down'); });
    const r = await vm.runInContext('fetchQuiet("/api/v1/x", {}, "T")', sb);
    assertEqual(r, undefined, 'no response on network failure');
    assertTrue(sb._state.errors.some((e) => e.includes('net down')), 'network error logged');
});

itAsync('sendKeys PUTs the encoded message', async () => {
    const sb = makeSandbox(async () => ({ ok: true }));
    await vm.runInContext('sendKeys("CQ CQ DE KI6SLA K")', sb);
    assertEqual(sb._state.fetches.length, 1, 'one PUT');
    assertTrue(sb._state.fetches[0].includes('message=CQ%20CQ%20DE%20KI6SLA%20K'), 'encoded message in URL');
    assertEqual(sb._state.alerts.length, 0, 'no alert on success');
});

itAsync('sendKeys refuses a message whose ENCODED form exceeds the firmware buffer', async () => {
    const sb = makeSandbox(async () => ({ ok: true }));
    // 50 spaces encode to %20 each: raw length 59, encoded length 159 > 127.
    await vm.runInContext(`sendKeys("A${' '.repeat(50)}BCDEFGHI")`, sb);
    assertEqual(sb._state.fetches.length, 0, 'no PUT for an over-long message');
    assertEqual(sb._state.alerts.length, 1, 'operator told');
    assertTrue(sb._state.alerts[0].toLowerCase().includes('too long'), 'alert says too long');
});

itAsync('sendKeys alerts when the firmware refuses the message', async () => {
    const sb = makeSandbox(async () => ({ ok: false, status: 404 }));
    await vm.runInContext('sendKeys("CQ TEST")', sb);
    assertEqual(sb._state.alerts.length, 1, 'operator told on HTTP failure');
});

itAsync('sendKeys alerts when the request never reaches the device', async () => {
    const sb = makeSandbox(async () => { throw new Error('offline'); });
    await vm.runInContext('sendKeys("CQ TEST")', sb);
    assertEqual(sb._state.alerts.length, 1, 'operator told on network failure');
});

itAsync('sendKeys ignores empty messages', async () => {
    const sb = makeSandbox(async () => ({ ok: true }));
    await vm.runInContext('sendKeys("")', sb);
    assertEqual(sb._state.fetches.length, 0, 'no PUT for empty message');
    assertEqual(sb._state.alerts.length, 0, 'no alert for empty message');
});

(async () => {
    console.log('\nfetchQuiet / sendKeys');
    for (const t of asyncTests) {
        try { await t.fn(); testsPassed++; console.log(`  ✓ ${t.name}`); }
        catch (e) { testsFailed++; console.log(`  ✗ ${t.name}\n    ${e.message}`); }
    }
    console.log('\n' + '='.repeat(60));
    console.log(`Results: ${testsPassed} passed, ${testsFailed} failed`);
    console.log('='.repeat(60));
    process.exit(testsFailed > 0 ? 1 : 0);
})();
