#!/usr/bin/env node
/**
 * Unit tests for the Settings page loaders (settings.js).
 *
 * A successful device read refreshes the app-wide caches (AppState and the
 * localStorage write-through), so values edited from another client are
 * picked up everywhere as soon as any client visits Settings, not just on
 * the Settings page itself.
 *
 * Usage:
 *   node test/unit/test_settings_loaders.js
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

const settingsJs = fs.readFileSync(path.join(__dirname, '../../src/web/settings.js'), 'utf8');
const targetsMatch = settingsJs.match(/async function loadTuneTargets\(\)[\s\S]*?\n\}/);
const macrosMatch = settingsJs.match(/async function loadCwMacros\(\)[\s\S]*?\n\}/);

function makeSandbox(fetchImpl) {
    const calls = { savedTargets: null, savedMacros: null };
    const sandbox = {
        console,
        fetch: fetchImpl,
        Log: { debug: () => () => {}, warn: () => () => {} },
        AppState: { tuneTargets: null, tuneTargetsMobile: false, cwMacros: null },
        normalizeTuneTargets: (t) => t || [],
        saveTuneTargetsToLocalStorage: (t, m) => { calls.savedTargets = { t, m }; },
        saveCwMacrosToLocalStorage: (m) => { calls.savedMacros = m; },
        loadTuneTargetsFromLocalStorage: () => {},
        loadCwMacrosFromLocalStorage: () => {},
        renderTuneTargetsList: () => {},
        renderCwMacrosList: () => {},
        updateCwExampleButtonStates: () => {},
        updateExampleButtonStates: () => {},
        updateTuneTargetsMaxNote: () => {},
        document: { getElementById: () => null },
        _calls: calls,
    };
    vm.createContext(sandbox);
    vm.runInContext(targetsMatch[0], sandbox);
    vm.runInContext(macrosMatch[0], sandbox);
    return sandbox;
}

itAsync('device tune-targets read refreshes AppState and the localStorage cache', async () => {
    assertTrue(!!targetsMatch && !!macrosMatch, 'loader extraction failed');
    const targets = [{ url: 'http://sdr.example/', enabled: true }];
    const sb = makeSandbox(async (url) =>
        ({ ok: true, json: async () => (String(url).includes('tuneTargets') ? { targets, mobile: true } : {}) }));
    await vm.runInContext('loadTuneTargets()', sb);
    assertTrue(Array.isArray(sb.AppState.tuneTargets) && sb.AppState.tuneTargets.length === 1, 'AppState.tuneTargets refreshed');
    assertEqual(sb.AppState.tuneTargetsMobile, true, 'AppState.tuneTargetsMobile refreshed');
    assertTrue(sb._calls.savedTargets && sb._calls.savedTargets.t.length === 1, 'localStorage write-through');
});

itAsync('device CW-macros read refreshes AppState and the localStorage cache', async () => {
    const macros = [{ label: 'CQ', template: 'CQ {MYCALL}' }];
    const sb = makeSandbox(async (url) =>
        ({ ok: true, json: async () => (String(url).includes('cwMacros') ? { macros } : {}) }));
    await vm.runInContext('loadCwMacros()', sb);
    assertTrue(Array.isArray(sb.AppState.cwMacros) && sb.AppState.cwMacros.length === 1, 'AppState.cwMacros refreshed');
    assertTrue(sb._calls.savedMacros && sb._calls.savedMacros.length === 1, 'localStorage write-through');
});

itAsync('a failed device read leaves the caches untouched', async () => {
    const sb = makeSandbox(async () => { throw new Error('offline'); });
    sb.AppState.tuneTargets = [{ url: 'http://keep.example/', enabled: true }];
    sb.AppState.cwMacros = [{ label: 'KEEP', template: 'K' }];
    await vm.runInContext('loadTuneTargets()', sb);
    await vm.runInContext('loadCwMacros()', sb);
    assertEqual(sb.AppState.tuneTargets[0].url, 'http://keep.example/', 'targets preserved offline');
    assertEqual(sb.AppState.cwMacros[0].label, 'KEEP', 'macros preserved offline');
    assertEqual(sb._calls.savedTargets, null, 'no cache write without device data');
    assertEqual(sb._calls.savedMacros, null, 'no cache write without device data');
});

(async () => {
    console.log('\nSettings loaders refresh shared caches');
    for (const t of asyncTests) {
        try { await t.fn(); testsPassed++; console.log(`  ✓ ${t.name}`); }
        catch (e) { testsFailed++; console.log(`  ✗ ${t.name}\n    ${e.message}`); }
    }
    console.log('\n' + '='.repeat(60));
    console.log(`Results: ${testsPassed} passed, ${testsFailed} failed`);
    console.log('='.repeat(60));
    process.exit(testsFailed > 0 ? 1 : 0);
})();
