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

// ============================================================================
// Truthful saves: a device REJECTION (4xx/5xx) must not be reported as
// saved, and must not clobber the caches; only a genuine offline failure
// falls back to session-only storage.
// ============================================================================

const saveTargetsMatch = settingsJs.match(/async function saveTuneTargets\(\)[\s\S]*?\n\}/);
const saveMacrosMatch = settingsJs.match(/async function saveCwMacros\(\)[\s\S]*?\n\}/);
const postSettingMatch = settingsJs.match(/async function postSettingToDevice\([\s\S]*?\n\}/);

function makeSaveSandbox(fetchImpl) {
    const calls = { savedTargets: null, savedMacros: null, alerts: [] };
    const sandbox = {
        console,
        fetch: fetchImpl,
        alert: (m) => calls.alerts.push(m),
        Log: { debug: () => () => {}, warn: () => () => {}, error: () => () => {} },
        AppState: { tuneTargets: null, tuneTargetsMobile: false, cwMacros: null },
        normalizeTuneTargets: (t) => t || [],
        saveTuneTargetsToLocalStorage: (t, m) => { calls.savedTargets = { t, m }; },
        saveCwMacrosToLocalStorage: (m) => { calls.savedMacros = m; },
        getCurrentTuneTargets: () => [{ url: 'http://sdr.example/', enabled: true }],
        getCurrentCwMacros: () => [{ label: 'CQ', template: 'CQ CQ' }],
        document: { getElementById: () => null },
        _calls: calls,
    };
    vm.createContext(sandbox);
    if (postSettingMatch) vm.runInContext(postSettingMatch[0], sandbox);
    vm.runInContext(saveTargetsMatch[0], sandbox);
    vm.runInContext(saveMacrosMatch[0], sandbox);
    return sandbox;
}

itAsync('a rejected tune-targets save is reported as refused and caches stay untouched', async () => {
    assertTrue(!!saveTargetsMatch && !!saveMacrosMatch, 'save extraction failed');
    const sb = makeSaveSandbox(async () => ({
        ok: false, status: 400,
        json: async () => ({ error: 'tune targets too large' }),
    }));
    await vm.runInContext('saveTuneTargets()', sb);
    assertEqual(sb._calls.savedTargets, null, 'no cache write on rejection');
    assertEqual(sb.AppState.tuneTargets, null, 'AppState untouched on rejection');
    assertEqual(sb._calls.alerts.length, 1, 'operator told once');
    assertTrue(/not saved|refused/i.test(sb._calls.alerts[0]), `alert says refused: ${sb._calls.alerts[0]}`);
    assertTrue(sb._calls.alerts[0].includes('tune targets too large'), 'server reason shown');
});

itAsync('a rejected CW-macros save is reported as refused and caches stay untouched', async () => {
    const sb = makeSaveSandbox(async () => ({
        ok: false, status: 500,
        json: async () => ({ error: 'failed commit settings to nvs' }),
    }));
    await vm.runInContext('saveCwMacros()', sb);
    assertEqual(sb._calls.savedMacros, null, 'no cache write on rejection');
    assertEqual(sb.AppState.cwMacros, null, 'AppState untouched on rejection');
    assertTrue(/not saved|refused/i.test(sb._calls.alerts[0] || ''), 'alert says refused');
});

itAsync('an accepted save updates the caches and says saved', async () => {
    const sb = makeSaveSandbox(async () => ({ ok: true, status: 200, json: async () => ({}) }));
    await vm.runInContext('saveTuneTargets()', sb);
    assertTrue(!!sb._calls.savedTargets, 'cache written on success');
    assertTrue(/saved\.$/i.test(sb._calls.alerts[0] || ''), `alert says saved: ${sb._calls.alerts[0]}`);
});

itAsync('an offline save falls back to session-only storage and says so', async () => {
    const sb = makeSaveSandbox(async () => { throw new Error('net down'); });
    await vm.runInContext('saveTuneTargets()', sb);
    assertTrue(!!sb._calls.savedTargets, 'session cache written when offline');
    assertTrue(/device unavailable/i.test(sb._calls.alerts[0] || ''), 'alert says device unavailable');
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
