# Spot Ticks on the Run-Page Band Bar — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a row of mode-colored ticks at the top of the run page's stacked band bar, showing every spot whose frequency falls in the currently displayed band; tapping a tick tunes the radio to that spot.

**Architecture:** Lift spot fetching/caching out of `chase.js` into a new global module `spots.js` (subscribe/notify, localStorage, auto-refresh). `chase.js` and `run.js` both consume it. `run.js`'s `updateBandRangeDisplay()` learns to render a new spots row. The chase-page `tuneRadioHz()` helper moves to `main.js` so both pages can call it.

**Tech Stack:** Vanilla ES2017 JavaScript (no bundler), Node-based unit tests using `vm` sandboxes (`make test-unit`), ESP-IDF gzip embed pipeline (`scripts/compress_web_assets.py` auto-gzips anything in `src/web/`).

**Spec:** `docs/superpowers/specs/2026-05-06-spot-ticks-design.md`

---

## File Structure

**New files:**

- `src/web/spots.js` — global spot fetching/caching/auto-refresh module. ~250 LOC.
- `test/unit/test_spots.js` — Node test suite for `spots.js`.
- `test/unit/test_run_spot_ticks.js` — Node test suite for the `buildSpotTickData()` helper inside `run.js`.

**Modified files:**

- `src/web/chase.js` — strip out cache, fetch, auto-refresh state; consume `Spots.*` instead. Extract `tuneRadioHz` to `main.js`.
- `src/web/main.js` — remove `AppState.latestChaseJson` field; add `tuneRadioHz` (extracted from chase). Update GPS-override path to call `Spots.clear()`.
- `src/web/run.js` — add `buildSpotTickData()`, render spots row in `updateBandRangeDisplay()`, subscribe to `Spots`, add tap-to-tune.
- `src/web/run.html` — no change needed (the new spots row is appended dynamically inside `#vfo-band-range-stack`).
- `src/web/style.css` — add `.vfo-band-range-spots-row` and `.vfo-band-range-spot-tick` rules; add `--mode-other-color`.
- `src/web/index.html` — add `<script src="spots.js"></script>` to the always-loaded scripts.
- `src/CMakeLists.txt` — add `web/spots.jsgz` to the `EMBED_FILES` list.

---

## Task 1: Scaffold `spots.js` and wire it into the build

**Files:**
- Create: `src/web/spots.js`
- Create: `test/unit/test_spots.js`
- Modify: `src/web/index.html` (add script tag)
- Modify: `src/CMakeLists.txt` (add embed entry)

- [ ] **Step 1: Write the failing test**

Create `test/unit/test_spots.js`:

```javascript
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
        fn();
        testsPassed++;
        console.log(`  ✓ ${name}`);
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

console.log(`\n${testsPassed} passed, ${testsFailed} failed`);
if (testsFailed > 0) {
    process.exit(1);
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node test/unit/test_spots.js`
Expected: FAIL with "Cannot find module" or similar — `spots.js` doesn't exist yet.

- [ ] **Step 3: Create the minimal `spots.js` shell**

Create `src/web/spots.js`:

```javascript
// ============================================================================
// Spots module — global spot fetching, caching, and auto-refresh
// ============================================================================
// Owns the lifecycle for spot data so any page (chase, run, ...) can read
// or refresh from a single source of truth. Replaces the equivalent
// localStorage + fetch + auto-refresh logic that previously lived in chase.js.

const SPOTS_CACHE_KEY = "chaseSpotCache";   // reused so existing caches keep working
const SPOTS_CACHE_TTL_SECONDS = 3600;        // matches CHASE_HISTORY_DURATION_SECONDS
const SPOTS_MIN_REFRESH_INTERVAL_MS = 60000;
const SPOTS_AUTO_REFRESH_INTERVAL_MS = 60000;
const SPOTS_API_LIMIT = 500;

const SpotsState = {
    spots: null,                  // Array | null
    lastFetchTime: 0,             // ms since epoch of last fetch attempt
    lastFetchPromise: null,       // in-flight de-dupe
    lastFetchCompleteTime: 0,     // for chase's "Refreshed Ns ago" UI
    autoRefreshEnabled: false,
    autoRefreshTimeoutId: null,
    nextAutoRefreshTime: 0,
    subscribers: new Set(),
};

const Spots = {
    getAll() { return SpotsState.spots; },
};
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node test/unit/test_spots.js`
Expected: PASS — both shell tests green.

- [ ] **Step 5: Wire `spots.js` into `index.html`**

Edit `src/web/index.html`. Find the existing always-loaded script block:

```html
        <script src="chase_api.js"></script>
        <script src="main.js"></script>
        <script src="bandprivileges.js"></script>
```

Replace with:

```html
        <script src="chase_api.js"></script>
        <script src="main.js"></script>
        <script src="bandprivileges.js"></script>
        <script src="spots.js"></script>
```

- [ ] **Step 6: Wire `spots.jsgz` into the embed list**

Edit `src/CMakeLists.txt`. Find:

```
        "web/bandprivileges.jsgz"
```

Add a new line immediately after it:

```
        "web/bandprivileges.jsgz"
        "web/spots.jsgz"
```

- [ ] **Step 7: Commit**

```bash
git add src/web/spots.js test/unit/test_spots.js src/web/index.html src/CMakeLists.txt
git commit -m "spots: scaffold global spots module"
```

---

## Task 2: localStorage cache in `spots.js`

**Files:**
- Modify: `src/web/spots.js`
- Modify: `test/unit/test_spots.js`

- [ ] **Step 1: Add the failing test**

In `test/unit/test_spots.js`, add a new `describe` block before the closing `console.log`:

```javascript
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node test/unit/test_spots.js`
Expected: FAIL — `Spots._saveCache is not a function`.

- [ ] **Step 3: Implement the cache methods**

Edit `src/web/spots.js`. Add to the `Spots` object literal (after `getAll`, before the closing `};`):

```javascript
    _saveCache(spots) {
        try {
            localStorage.setItem(SPOTS_CACHE_KEY, JSON.stringify({
                spots: spots,
                timestamp: Date.now(),
            }));
        } catch (e) {
            Log.warn("Spots")("Failed to save cache:", e);
        }
    },

    _restoreCache() {
        try {
            const cached = localStorage.getItem(SPOTS_CACHE_KEY);
            if (!cached) return false;

            const { spots, timestamp } = JSON.parse(cached);
            const ageMs = Date.now() - timestamp;
            if (ageMs > SPOTS_CACHE_TTL_SECONDS * 1000) {
                localStorage.removeItem(SPOTS_CACHE_KEY);
                return false;
            }

            SpotsState.spots = spots;
            SpotsState.lastFetchCompleteTime = timestamp;
            Log.info("Spots")(`Restored ${spots.length} spots (age ${Math.round(ageMs / 1000)}s)`);
            return true;
        } catch (e) {
            Log.warn("Spots")("Failed to restore cache:", e);
            localStorage.removeItem(SPOTS_CACHE_KEY);
            return false;
        }
    },

    clear() {
        SpotsState.spots = null;
        SpotsState.lastFetchCompleteTime = 0;
        try {
            localStorage.removeItem(SPOTS_CACHE_KEY);
        } catch (e) {
            // best-effort
        }
    },
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node test/unit/test_spots.js`
Expected: PASS — all six tests green.

- [ ] **Step 5: Commit**

```bash
git add src/web/spots.js test/unit/test_spots.js
git commit -m "spots: localStorage cache"
```

---

## Task 3: Fetch / refresh with rate limit and de-dupe

**Files:**
- Modify: `src/web/spots.js`
- Modify: `test/unit/test_spots.js`

- [ ] **Step 1: Add the failing tests**

In `test/unit/test_spots.js`, add a new `describe` block:

```javascript
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
```

Then change the closing `console.log` line so the file works as an async runner. Replace:

```javascript
console.log(`\n${testsPassed} passed, ${testsFailed} failed`);
if (testsFailed > 0) {
    process.exit(1);
}
```

with:

```javascript
// Wait for any pending async its before reporting
setTimeout(() => {
    console.log(`\n${testsPassed} passed, ${testsFailed} failed`);
    if (testsFailed > 0) process.exit(1);
}, 100);
```

Also wrap the async `it()` bodies. Update the `it` helper to handle promises — replace the existing `it` function:

```javascript
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node test/unit/test_spots.js`
Expected: FAIL — `Spots.refresh is not a function`.

- [ ] **Step 3: Implement Spots.refresh()**

Edit `src/web/spots.js`. Add to the `Spots` object literal (after `clear`):

```javascript
    async refresh({ force = false, location = undefined, fetchOptions = undefined } = {}) {
        // Dedupe concurrent calls — return whichever fetch is already in flight.
        if (SpotsState.lastFetchPromise) {
            return SpotsState.lastFetchPromise;
        }

        // Rate limit (skipped when force=true)
        const now = Date.now();
        if (!force && now - SpotsState.lastFetchTime < SPOTS_MIN_REFRESH_INTERVAL_MS) {
            Log.info("Spots")(`Rate limited; ${Math.round((now - SpotsState.lastFetchTime) / 1000)}s since last fetch`);
            return SpotsState.spots;
        }

        SpotsState.lastFetchTime = now;

        const opts = fetchOptions || {
            max_age: SPOTS_CACHE_TTL_SECONDS,
            limit: SPOTS_API_LIMIT,
            dedupe: true,
        };

        const promise = (async () => {
            try {
                const loc = location !== undefined
                    ? location
                    : (typeof getLocation === "function" ? await getLocation() : null);
                const spots = await fetchAndProcessSpots(opts, loc, true);
                SpotsState.spots = spots;
                SpotsState.lastFetchCompleteTime = Date.now();
                this._saveCache(spots);
                this._notify();
                Log.info("Spots")(`Updated: ${spots.length} spots`);
                return spots;
            } finally {
                SpotsState.lastFetchPromise = null;
            }
        })();

        SpotsState.lastFetchPromise = promise;
        return promise;
    },

    getLastFetchCompleteTime() {
        return SpotsState.lastFetchCompleteTime;
    },

    _notify() {
        for (const cb of SpotsState.subscribers) {
            try {
                cb(SpotsState.spots);
            } catch (e) {
                Log.warn("Spots")("subscriber threw:", e);
            }
        }
    },
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node test/unit/test_spots.js`
Expected: PASS — all tests including the four new async ones.

- [ ] **Step 5: Commit**

```bash
git add src/web/spots.js test/unit/test_spots.js
git commit -m "spots: refresh with rate limit and dedupe"
```

---

## Task 4: Subscribe / notify

**Files:**
- Modify: `src/web/spots.js`
- Modify: `test/unit/test_spots.js`

- [ ] **Step 1: Add the failing tests**

In `test/unit/test_spots.js`, add:

```javascript
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
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node test/unit/test_spots.js`
Expected: FAIL — `Spots.subscribe is not a function`.

- [ ] **Step 3: Implement subscribe / unsubscribe**

Edit `src/web/spots.js`. Add to the `Spots` object literal:

```javascript
    subscribe(cb) {
        SpotsState.subscribers.add(cb);
    },

    unsubscribe(cb) {
        SpotsState.subscribers.delete(cb);
    },
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node test/unit/test_spots.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/web/spots.js test/unit/test_spots.js
git commit -m "spots: subscribe/notify"
```

---

## Task 5: Auto-refresh state machine

**Files:**
- Modify: `src/web/spots.js`
- Modify: `test/unit/test_spots.js`

- [ ] **Step 1: Add the failing tests**

In `test/unit/test_spots.js`, add:

```javascript
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node test/unit/test_spots.js`
Expected: FAIL — `Spots.startAutoRefresh is not a function`.

- [ ] **Step 3: Implement auto-refresh methods**

Edit `src/web/spots.js`. Add to the `Spots` object literal:

```javascript
    startAutoRefresh() {
        SpotsState.autoRefreshEnabled = true;
        try { localStorage.setItem("chaseAutoRefreshEnabled", "true"); } catch (e) {}
        this._scheduleNext();
    },

    stopAutoRefresh() {
        SpotsState.autoRefreshEnabled = false;
        try { localStorage.setItem("chaseAutoRefreshEnabled", "false"); } catch (e) {}
        if (SpotsState.autoRefreshTimeoutId) {
            clearTimeout(SpotsState.autoRefreshTimeoutId);
            SpotsState.autoRefreshTimeoutId = null;
        }
        SpotsState.nextAutoRefreshTime = 0;
    },

    isAutoRefreshEnabled() {
        return SpotsState.autoRefreshEnabled;
    },

    loadAutoRefreshPref() {
        // Read persisted preference (used by chase.js on init).
        // Does NOT auto-start the timer; call startAutoRefresh() if true.
        try {
            return localStorage.getItem("chaseAutoRefreshEnabled") === "true";
        } catch (e) {
            return false;
        }
    },

    getNextAutoRefreshTime() {
        return SpotsState.nextAutoRefreshTime;
    },

    _scheduleNext() {
        if (SpotsState.autoRefreshTimeoutId) {
            clearTimeout(SpotsState.autoRefreshTimeoutId);
            SpotsState.autoRefreshTimeoutId = null;
        }
        if (!SpotsState.autoRefreshEnabled) return;

        SpotsState.nextAutoRefreshTime = Date.now() + SPOTS_AUTO_REFRESH_INTERVAL_MS;
        SpotsState.autoRefreshTimeoutId = setTimeout(async () => {
            Log.debug("Spots")("Auto-refresh triggered");
            try {
                await Spots.refresh({ force: true });
            } catch (e) {
                Log.warn("Spots")("Auto-refresh failed:", e);
            }
            // Schedule the next one whether the fetch succeeded or not, so a
            // transient network blip doesn't stop the chain.
            if (SpotsState.autoRefreshEnabled) Spots._scheduleNext();
        }, SPOTS_AUTO_REFRESH_INTERVAL_MS);
    },
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node test/unit/test_spots.js`
Expected: PASS — all tests including the three new ones.

- [ ] **Step 5: Commit**

```bash
git add src/web/spots.js test/unit/test_spots.js
git commit -m "spots: auto-refresh state machine"
```

---

## Task 6: Refactor `chase.js` to consume `spots.js`

This is the largest mechanical change. The goal: chase.js stops owning fetch/cache/auto-refresh state, becomes a consumer.

**Files:**
- Modify: `src/web/chase.js`
- Modify: `src/web/main.js` (remove `latestChaseJson` from `AppState`, add `Spots.clear()` call)

- [ ] **Step 1: Delete `saveSpotsToCache` and `restoreSpotsFromCache` from chase.js**

Edit `src/web/chase.js`. Delete the two functions at lines ~57-92:

```javascript
// Save spot data to localStorage for cross-reload persistence
function saveSpotsToCache(spots) {
    ...
}

// Restore spot data from localStorage if not stale.
function restoreSpotsFromCache() {
    ...
}
```

- [ ] **Step 2: Delete `loadAutoRefreshEnabled` and `saveAutoRefreshEnabled` helpers**

Edit `src/web/chase.js`. Delete the two functions at lines ~170-182:

```javascript
function loadAutoRefreshEnabled() {
    ...
}

function saveAutoRefreshEnabled(enabled) {
    ...
}
```

Find call sites (`grep -n "loadAutoRefreshEnabled\|saveAutoRefreshEnabled" src/web/chase.js`) and update each:

- Calls to `loadAutoRefreshEnabled()` → `Spots.loadAutoRefreshPref()`. The first such read (on chase init) should additionally call `Spots.startAutoRefresh()` if the pref is `true`.
- Calls to `saveAutoRefreshEnabled(true)` → `Spots.startAutoRefresh()`.
- Calls to `saveAutoRefreshEnabled(false)` → `Spots.stopAutoRefresh()`.

- [ ] **Step 3: Replace `startAutoRefresh` / `stopAutoRefresh` / `scheduleNextAutoRefresh` bodies**

Edit `src/web/chase.js`. Replace the three functions defined at lines ~252-314 with thin wrappers that defer to `Spots`:

```javascript
function startAutoRefresh() {
    Spots.startAutoRefresh();

    // Clear suggestion state since user accepted
    ChaseState.suggestingAutoRefresh = false;
    if (ChaseState.suggestionRevertTimeoutId) {
        clearTimeout(ChaseState.suggestionRevertTimeoutId);
        ChaseState.suggestionRevertTimeoutId = null;
    }

    updateRefreshButtonLabel();
    updateRefreshTimer();
}

function stopAutoRefresh() {
    Spots.stopAutoRefresh();

    // Clear suggestion state
    ChaseState.suggestingAutoRefresh = false;
    if (ChaseState.suggestionRevertTimeoutId) {
        clearTimeout(ChaseState.suggestionRevertTimeoutId);
        ChaseState.suggestionRevertTimeoutId = null;
    }

    updateRefreshButtonLabel();
    updateRefreshTimer();
}
```

Delete `scheduleNextAutoRefresh` entirely. Find its three internal call sites in chase.js (`grep -n "scheduleNextAutoRefresh" src/web/chase.js` — at lines ~263, 1214, 1238 in the pre-refactor numbering) and delete them; `Spots._scheduleNext` chains itself.

- [ ] **Step 4: Remove auto-refresh fields from `ChaseState`**

Edit `src/web/chase.js`. In the `ChaseState` object literal (top of file, around lines 18-51), delete these three lines:

```javascript
    autoRefreshEnabled: false,
    autoRefreshTimeoutId: null,
    nextAutoRefreshTime: 0,
```

Find any remaining references to these fields (`grep -n "ChaseState.autoRefreshEnabled\|ChaseState.autoRefreshTimeoutId\|ChaseState.nextAutoRefreshTime" src/web/chase.js`) and replace:
- `ChaseState.autoRefreshEnabled` → `Spots.isAutoRefreshEnabled()`
- `ChaseState.nextAutoRefreshTime` → `Spots.getNextAutoRefreshTime()`
- Any `ChaseState.autoRefreshTimeoutId` reference → delete the whole timeout-management block (it's all in `Spots._scheduleNext` now).

- [ ] **Step 5: Refactor `refreshChaseJson()` to call `Spots.refresh()`**

Edit `src/web/chase.js`. Replace the body of `refreshChaseJson(force, isAutoRefresh, userInitiated)` (around lines 1156-1247) with:

```javascript
async function refreshChaseJson(force, isAutoRefresh = false, userInitiated = false) {
    const refreshButton = document.getElementById("refresh-button");

    try {
        if (refreshButton) {
            refreshButton.textContent = "Refreshing...";
            refreshButton.disabled = true;
        }

        await Spots.refresh({ force });
        // updateChaseTable runs via the Spots subscriber installed in
        // attachChaseEventListeners(); explicitly calling it here would
        // double-render.
        ChaseState.lastRefreshCompleteTime = Spots.getLastFetchCompleteTime();
        startRefreshTimer();

        // After a manual refresh, show "Auto-refresh?" prompt for 3 seconds
        if (userInitiated && !Spots.isAutoRefreshEnabled()) {
            if (ChaseState.suggestionRevertTimeoutId) {
                clearTimeout(ChaseState.suggestionRevertTimeoutId);
            }
            ChaseState.suggestingAutoRefresh = true;
            ChaseState.suggestionRevertTimeoutId = setTimeout(() => {
                ChaseState.suggestingAutoRefresh = false;
                ChaseState.suggestionRevertTimeoutId = null;
                updateRefreshButtonLabel();
            }, AUTO_SUGGEST_PROMPT_MS);
        }
    } catch (error) {
        Log.error("Chase")("Refresh error:", error);
        if (force && !isAutoRefresh) {
            alert("Failed to fetch spots from Spothole API. Please check your internet connection and try again.");
        }
    } finally {
        if (refreshButton) {
            updateRefreshButtonLabel();
            refreshButton.disabled = false;
        }
    }
}
```

- [ ] **Step 6: Replace `AppState.latestChaseJson` reads with `Spots.getAll()`**

Run: `grep -n "latestChaseJson" src/web/chase.js`

Two readers in chase.js (around lines 1016 and 1408):

- Line ~1016 in `updateChaseTable`: replace `const data = await AppState.latestChaseJson;` with `const data = Spots.getAll();` (drop the `await` — `Spots.getAll()` is synchronous).
- Line ~1408: replace `if (AppState.latestChaseJson !== null)` with `if (Spots.getAll() !== null)`.

Delete the writes:

- Line ~83 (inside the deleted `restoreSpotsFromCache` — already gone).
- Line ~1198 (`AppState.latestChaseJson = spots;` inside `refreshChaseJson` — already replaced).

- [ ] **Step 7: Subscribe `updateChaseTable` to spot changes on chase init**

Edit `src/web/chase.js`. In `attachChaseEventListeners()` (around line 1254), at the very end (just before the closing `}`), add:

```javascript
    // Re-render table whenever spots change (manual refresh, auto-refresh,
    // or cache restore on page load).
    Spots.subscribe(() => {
        if (typeof updateChaseTable === "function") {
            updateChaseTable();
        }
    });
```

- [ ] **Step 8: Restore cache on chase page appearance**

Edit `src/web/chase.js`. Find `onChaseAppearing` (or equivalent — `grep -n "onChaseAppearing\|onAppearing" src/web/chase.js`). Near the start of that function, add:

```javascript
    // Restore cached spots so the table renders something immediately.
    if (Spots.getAll() === null) {
        Spots._restoreCache();
    }
```

If `_restoreCache` was successful, also fire the subscribers manually so the table renders (cache restore doesn't go through `refresh()`, so no notify happens). Replace the snippet above with:

```javascript
    if (Spots.getAll() === null) {
        if (Spots._restoreCache()) {
            // _restoreCache populates state but doesn't notify; render now.
            if (typeof updateChaseTable === "function") updateChaseTable();
        }
    }
```

Also, if the auto-refresh preference is set, start it:

```javascript
    if (Spots.loadAutoRefreshPref()) {
        Spots.startAutoRefresh();
    }
```

- [ ] **Step 9: Edit main.js — remove `latestChaseJson` field and use `Spots.clear()`**

Edit `src/web/main.js`. In the `AppState` object literal (around line 82), delete the line:

```javascript
    latestChaseJson: null,
```

In the GPS-override path (around line 1358), replace:

```javascript
        AppState.latestChaseJson = null;
        localStorage.removeItem("chaseSpotCache");
```

with:

```javascript
        Spots.clear();
```

- [ ] **Step 10: Run unit tests**

Run: `make test-unit`
Expected: PASS — all existing tests including spots tests stay green. (No tests for chase.js exist; this is a refactor.)

- [ ] **Step 11: Manual verification**

Build firmware (`make build`) and flash. Then:

1. Open chase tab → spots load. Refresh button works.
2. Toggle auto-refresh → button state changes, countdown ticks down.
3. Wait 60s → auto-refresh fires, table updates.
4. Reload page → cached spots show immediately.
5. Set GPS override (settings) → spot list clears, next refresh repopulates.

If any of these regress, fix and re-test before committing.

- [ ] **Step 12: Commit**

```bash
git add src/web/chase.js src/web/main.js
git commit -m "chase: consume spots module"
```

---

## Task 7: Extract `tuneRadioHz` to `main.js`

The chase-page row-click handler calls `tuneRadioHz(hertz, mode)`. Run-page tap-to-tune needs the same behavior. Move the function to `main.js` so both pages share it; `chase.js` retains a tiny wrapper that calls the shared function and then runs chase-only UI updates.

**Files:**
- Modify: `src/web/main.js` (add `tuneRadioHz`)
- Modify: `src/web/chase.js` (replace `tuneRadioHz` with a wrapper)
- Create: `test/unit/test_tune.js`

- [ ] **Step 1: Write the failing test**

Create `test/unit/test_tune.js`:

```javascript
#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const vm = require('vm');

let testsPassed = 0;
let testsFailed = 0;

function it(name, fn) {
    Promise.resolve()
        .then(fn)
        .then(() => { testsPassed++; console.log(`  ✓ ${name}`); })
        .catch((e) => { testsFailed++; console.log(`  ✗ ${name}\n    ${e.message}`); });
}

function assertEqual(a, b, m='') {
    if (a !== b) throw new Error(`${m}: expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`);
}

function makeSandbox() {
    const calls = [];
    const sandbox = {
        console: console,
        Date: Date,
        Promise: Promise,
        setTimeout: setTimeout,
        AppState: { vfoFrequencyHz: 0, vfoMode: null, vfoLastUpdated: 0 },
        Log: {
            info: () => () => {}, warn: () => () => {},
            error: () => () => {}, debug: () => () => {},
        },
        // Stubs for things tuneRadioHz calls in main.js
        openTuneTargets: (freq, mode) => calls.push(['openTuneTargets', freq, mode]),
        LSB_USB_BOUNDARY_HZ: 10000000,
        // fetch stub records calls and resolves OK
        fetch: async (url, opts) => {
            calls.push(['fetch', url, opts && opts.method]);
            return { ok: true };
        },
        _calls: calls,
    };
    vm.createContext(sandbox);

    // Load just the tuneRadioHz function from main.js
    const mainJsPath = path.join(__dirname, '../../src/web/main.js');
    const mainJsCode = fs.readFileSync(mainJsPath, 'utf8');
    const fnMatch = mainJsCode.match(/async function tuneRadioHz\(frequency, mode\) \{[\s\S]*?\n\}/);
    if (!fnMatch) throw new Error("tuneRadioHz not found in main.js");
    vm.runInContext(fnMatch[0], sandbox);

    return sandbox;
}

console.log('\nshared tuneRadioHz');

it('USB 14.250 stays USB', async () => {
    const sb = makeSandbox();
    await sb.tuneRadioHz(14250000, 'SSB');
    assertEqual(sb.AppState.vfoMode, 'USB', 'SSB above boundary -> USB');
    assertEqual(sb.AppState.vfoFrequencyHz, 14250000);
});

it('SSB at 7.100 becomes LSB', async () => {
    const sb = makeSandbox();
    await sb.tuneRadioHz(7100000, 'SSB');
    assertEqual(sb.AppState.vfoMode, 'LSB', 'SSB below boundary -> LSB');
});

it('CW stays CW', async () => {
    const sb = makeSandbox();
    await sb.tuneRadioHz(14025000, 'CW');
    assertEqual(sb.AppState.vfoMode, 'CW');
});

setTimeout(() => {
    console.log(`\n${testsPassed} passed, ${testsFailed} failed`);
    if (testsFailed > 0) process.exit(1);
}, 100);
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node test/unit/test_tune.js`
Expected: FAIL — `tuneRadioHz not found in main.js`.

- [ ] **Step 3: Move `tuneRadioHz` to `main.js`**

Cut from `src/web/chase.js` (lines ~342-380) the entire `tuneRadioHz` function and the comment above it:

```javascript
// Tune radio to specified frequency (Hz) and mode (adjusts SSB sideband based on frequency)
async function tuneRadioHz(frequency, mode) {
    let useMode = mode.toUpperCase();
    if (useMode === "SSB") {
        if (frequency < LSB_USB_BOUNDARY_HZ) useMode = "LSB";
        else useMode = "USB";
    }

    openTuneTargets(frequency, useMode);

    try {
        const freqResponse = await fetch(`/api/v1/frequency?frequency=${frequency}`, { method: "PUT" });
        if (!freqResponse.ok) {
            Log.error("Chase")("Frequency update failed");
            return;
        }
        Log.debug("Chase")("Frequency updated:", frequency);

        const modeResponse = await fetch(`/api/v1/mode?mode=${useMode}`, { method: "PUT" });
        if (!modeResponse.ok) {
            Log.error("Chase")("Mode update failed");
            return;
        }
        Log.debug("Chase")("Mode updated:", useMode);

        AppState.vfoFrequencyHz = frequency;
        AppState.vfoMode = useMode;
        AppState.vfoLastUpdated = Date.now();
        updateTunedRowHighlight();
        updateMyCallButton();
    } catch (error) {
        Log.error("Chase")("Tune radio error:", error);
    }
}
```

Paste it into `src/web/main.js`, immediately above the `loadTabScriptIfNeeded` function (around line 1117). Adjust two lines so the shared function doesn't depend on chase-only DOM updaters:

- Replace `Log.error("Chase")(...)` with `Log.error("Tune")(...)` (3 instances).
- Replace `Log.debug("Chase")(...)` with `Log.debug("Tune")(...)` (2 instances).
- Remove the two chase-only calls at the bottom:

```javascript
    updateTunedRowHighlight();
    updateMyCallButton();
```

Replace them with a notification hook:

```javascript
    // Notify any page-specific listeners (chase row highlight, etc.).
    if (typeof onTuneRadioComplete === "function") onTuneRadioComplete();
```

- [ ] **Step 4: Add chase-side `onTuneRadioComplete` wrapper**

Edit `src/web/chase.js`. At the location where `tuneRadioHz` used to be (now empty), add:

```javascript
// Hook called by the shared tuneRadioHz() in main.js after a tune completes.
// Updates chase-only UI (row highlight + PoLo button enable state).
function onTuneRadioComplete() {
    updateTunedRowHighlight();
    updateMyCallButton();
}
```

- [ ] **Step 5: Run unit tests**

Run: `node test/unit/test_tune.js`
Expected: PASS.

Run: `make test-unit`
Expected: PASS — all suites green.

- [ ] **Step 6: Manual verification**

Build, flash, open chase tab, click a spot row → radio tunes, row highlight updates. (Behavior identical to before; this is a pure extraction.)

- [ ] **Step 7: Commit**

```bash
git add src/web/main.js src/web/chase.js test/unit/test_tune.js
git commit -m "tune: extract tuneRadioHz to main.js"
```

---

## Task 8: Pure helper `buildSpotTickData()` with tests

**Files:**
- Modify: `src/web/run.js` (add helper, no rendering yet)
- Create: `test/unit/test_run_spot_ticks.js`

- [ ] **Step 1: Write the failing test**

Create `test/unit/test_run_spot_ticks.js`:

```javascript
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

console.log(`\n${testsPassed} passed, ${testsFailed} failed`);
if (testsFailed > 0) process.exit(1);
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node test/unit/test_run_spot_ticks.js`
Expected: FAIL — `buildSpotTickData not found in run.js`.

- [ ] **Step 3: Implement `buildSpotTickData()`**

Edit `src/web/run.js`. Find the line `// License classes ordered most-accessible → most-restricted` (around line 287). Just above it, insert:

```javascript
// ============================================================================
// Spot ticks on band-range chart
// ============================================================================
// Pure helper: turn a list of spots into the data needed to render ticks
// on the spots row. Mode categories are lowercased to match CSS data-mode
// attribute values (cw / data / phone / other).
function buildSpotTickData(spots, bandStart, bandEnd) {
    if (!spots || !Array.isArray(spots)) return [];
    const span = bandEnd - bandStart;
    if (span <= 0) return [];

    const out = [];
    for (const spot of spots) {
        const hz = spot.hertz;
        if (typeof hz !== "number") continue;
        if (hz < bandStart || hz > bandEnd) continue;

        const rawMode = spot.mode || "";
        const category = getModeCategory(rawMode);
        let modeCategory = category.toLowerCase();   // "cw" | "data" | "phone"

        // OTHER bucket: Spothole's modeType is "OTHER" for unrecognized data
        // modes; bandprivileges.getModeCategory() defaults unknown to PHONE,
        // which would mis-color them. Trust the upstream modeType here.
        if (spot.modeType === "OTHER") modeCategory = "other";

        const leftPct = ((hz - bandStart) / span) * 100;
        const freqMHz = (hz / 1e6).toFixed(3);
        const callsign = spot.activatorCallsign || spot.spothole_dx_call || "?";

        out.push({
            leftPct,
            modeCategory,
            hz,
            modeRaw: rawMode,
            callsign,
            title: `${callsign} · ${freqMHz} MHz · ${rawMode}`,
        });
    }
    return out;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node test/unit/test_run_spot_ticks.js`
Expected: PASS — all five tests green.

Run: `make test-unit`
Expected: PASS — every suite green.

- [ ] **Step 5: Commit**

```bash
git add src/web/run.js test/unit/test_run_spot_ticks.js
git commit -m "run: buildSpotTickData helper"
```

---

## Task 9: Render the spots row + CSS

**Files:**
- Modify: `src/web/run.js` (extend `updateBandRangeDisplay`)
- Modify: `src/web/style.css`

- [ ] **Step 1: Add CSS for the spots row and ticks**

Edit `src/web/style.css`. Find the `.vfo-band-range` block (around line 407). At the top of that rule, add the new CSS variable:

```css
.vfo-band-range {
    --mode-cw-color: #4dabf7;     /* CW    — blue   */
    --mode-data-color: #ffd43b;   /* DATA  — amber  */
    --mode-phone-color: #51cf66;  /* PHONE — green  */
    --mode-other-color: #adb5bd;  /* OTHER — gray   */
    --label-width: 14px;
    --row-gap: 0;
    --row-height: 5px;
    ...
}
```

After the existing `.vfo-band-range-tick.out-of-priv` rule (around line 495), add:

```css
/* Spots row: rendered above the license rows. Track is transparent so
   ticks float over the VFO background; ticks are colored per mode. */
.vfo-band-range-spots-row {
    /* Same layout as .vfo-band-range-row — inherits .vfo-band-range-row */
}

.vfo-band-range-spots-row .vfo-band-range-track {
    background: transparent;
    box-shadow: none;
    overflow: visible;   /* let ticks extend slightly past the track */
}

.vfo-band-range-spot-tick {
    position: absolute;
    top: 0;
    bottom: 0;
    width: 3px;
    margin-left: -1.5px;
    pointer-events: auto;
    cursor: pointer;
}

.vfo-band-range-spot-tick[data-mode="cw"]    { background: var(--mode-cw-color); }
.vfo-band-range-spot-tick[data-mode="data"]  { background: var(--mode-data-color); }
.vfo-band-range-spot-tick[data-mode="phone"] { background: var(--mode-phone-color); }
.vfo-band-range-spot-tick[data-mode="other"] { background: var(--mode-other-color); }

/* Invisible touch hitbox extending the tappable area to ~24px wide.
   Compromise between project's >=48px gloved-finger guideline and
   the reality that 48px hitboxes overlap aggressively when spots cluster. */
.vfo-band-range-spot-tick::before {
    content: "";
    position: absolute;
    top: -4px;
    bottom: -4px;
    left: -10px;
    right: -10px;
}
```

- [ ] **Step 2: Render the spots row in `updateBandRangeDisplay()`**

Edit `src/web/run.js`. Find `function updateBandRangeDisplay()` (around line 327). The function currently builds rows in this order: license rows → overlay. We want spots row → license rows → overlay. Insert the new row construction *just after* the `frag = document.createDocumentFragment()` line (around line 363) and before `for (const cls of rowsTopToBottom)`:

```javascript
    // Spots row (top of stack). Built before license rows so DOM order
    // gives us correct visual stacking — first child is topmost.
    const spotsRow = document.createElement("div");
    spotsRow.className = "vfo-band-range-row vfo-band-range-spots-row";

    const spotsLabel = document.createElement("span");
    spotsLabel.className = "vfo-band-range-label";
    spotsLabel.textContent = "";  // empty — no label for the spots row
    spotsRow.appendChild(spotsLabel);

    const spotsTrack = document.createElement("div");
    spotsTrack.className = "vfo-band-range-track";

    const allSpots = (typeof Spots !== "undefined") ? Spots.getAll() : null;
    const tickData = buildSpotTickData(allSpots, bandStart, bandEnd);
    for (const t of tickData) {
        const tick = document.createElement("div");
        tick.className = "vfo-band-range-spot-tick";
        tick.dataset.mode = t.modeCategory;
        tick.dataset.hz = String(t.hz);
        tick.dataset.modeRaw = t.modeRaw;
        tick.style.left = `${t.leftPct}%`;
        tick.title = t.title;
        spotsTrack.appendChild(tick);
    }

    spotsRow.appendChild(spotsTrack);
    frag.appendChild(spotsRow);
```

- [ ] **Step 3: Manual verification**

Build, flash. Open chase to populate spots. Switch to run tab.

Expected:
- A new thin row at the top of the band-range stack with colored dots at spot frequencies.
- Switch bands → ticks update for the new band.
- Hover a tick (desktop) or long-press (mobile) → tooltip shows callsign + freq + mode.

If you see no ticks: check that `Spots.getAll()` returns data in DevTools console. If a build error occurs (unknown CSS var, etc.), check the CSS edit.

- [ ] **Step 4: Commit**

```bash
git add src/web/run.js src/web/style.css
git commit -m "run: render spots row on band bar"
```

---

## Task 10: Subscribe run.js to spot updates + drag-collision guard

**Files:**
- Modify: `src/web/run.js`

- [ ] **Step 1: Subscribe on run-page init**

Edit `src/web/run.js`. Find the run-page bootstrap (`grep -n "onRunAppearing\|setupBandRangeDrag" src/web/run.js`). After `setupBandRangeDrag()` is called during init, add:

```javascript
    // Re-render band range whenever spots change, so newly-arrived spots
    // appear as ticks without the user having to switch tabs.
    if (typeof Spots !== "undefined") {
        Spots.subscribe(onSpotsChanged);
    }
```

Define `onSpotsChanged` at module scope (near `setupBandRangeDrag`):

```javascript
function onSpotsChanged() {
    // Skip rebuild while a drag-to-tune is in progress; replaceChildren
    // would destroy the tick the user is dragging.
    const container = document.getElementById("vfo-band-range");
    if (container && container.classList.contains("is-dragging")) {
        // Schedule a single rebuild on drag end.
        RunState.spotsRebuildPending = true;
        return;
    }
    updateBandRangeDisplay();
}
```

- [ ] **Step 2: Trigger deferred rebuild on drag end**

Edit `src/web/run.js`. In `onBandRangeDragEnd` (around line 564), at the end of the function (after the existing `if (shouldCommit)` block), add:

```javascript
    // If a spots refresh fired during the drag, run the deferred rebuild.
    if (RunState.spotsRebuildPending) {
        RunState.spotsRebuildPending = false;
        updateBandRangeDisplay();
    }
```

Find the `RunState` definition (`grep -n "const RunState" src/web/run.js`) and add the new field. Wherever it lives, ensure it has:

```javascript
    spotsRebuildPending: false,
```

If the field isn't initialized in `RunState`, JavaScript will treat reads as `undefined` (falsy) and writes will create the property — but explicit is better. Add the line.

- [ ] **Step 3: Unsubscribe when leaving the run tab**

Find `cleanupCurrentTab` or the run-disappearing cleanup (`grep -n "onRunDisappearing\|cleanup" src/web/run.js`). If a per-tab cleanup hook exists, add:

```javascript
    if (typeof Spots !== "undefined") {
        Spots.unsubscribe(onSpotsChanged);
    }
```

If no such hook exists in run.js, leave the subscriber in place — the `Set` deduplicates by reference, so re-entering run will not stack subscribers, and `onSpotsChanged` checks `document.getElementById("vfo-band-range")` and bails if the run tab isn't mounted.

- [ ] **Step 4: Manual verification**

Build, flash. Open chase tab, then run tab. Trigger a chase auto-refresh (or click chase Refresh while watching run via inspector). Then return to run.

Expected:
- Spots row updates without a tab switch when a refresh happens.
- During a drag-to-tune on run, a refresh does not snap the dragged tick — drag stays smooth.
- After releasing the drag, the spots row reflects the latest refresh.

- [ ] **Step 5: Commit**

```bash
git add src/web/run.js
git commit -m "run: subscribe to spots, defer rebuild during drag"
```

---

## Task 11: Tap-to-tune on spot ticks

**Files:**
- Modify: `src/web/run.js`

- [ ] **Step 1: Add the click handler**

Edit `src/web/run.js`. Find `setupBandRangeDrag()` (around line 598). At the end of that function, add:

```javascript
    // Tap-to-tune on spot ticks. Listener is on the persistent container so
    // it survives updateBandRangeDisplay() rebuilds. We stop propagation so
    // the drag-to-tune handler doesn't also re-tune to the click position.
    container.addEventListener("click", (event) => {
        const tick = event.target.closest(".vfo-band-range-spot-tick");
        if (!tick) return;
        event.stopPropagation();

        const hz = Number(tick.dataset.hz);
        const modeRaw = tick.dataset.modeRaw || "";
        if (!Number.isFinite(hz)) return;

        Log.info("Run")(`Tap-to-tune to spot: ${hz} Hz, mode ${modeRaw}`);
        tuneRadioHz(hz, modeRaw);
    });
```

Note: a click event also fires after pointerdown/pointerup on touch and mouse. Drag-to-tune uses `pointerdown` directly, but since the spot tick handler runs on `click` (which fires after pointerup), we also need to suppress the pointerdown handler from starting a drag when the target is a spot tick. Add a check at the top of `onBandRangeDragStart` (around line 500):

```javascript
function onBandRangeDragStart(event) {
    // Skip if the pointerdown landed on a spot tick — its click handler
    // takes care of the tune, and we don't want a phantom drag commit.
    if (event.target && event.target.closest && event.target.closest(".vfo-band-range-spot-tick")) {
        return;
    }
    if (event.button !== 0) return;
    ...
}
```

- [ ] **Step 2: Manual verification**

Build, flash. Open chase to populate spots, switch to run.

Test cases:
1. Tap a CW tick (blue) → radio tunes to that frequency, mode becomes CW.
2. Tap a phone tick (green) → radio tunes, mode picks USB or LSB based on frequency (LSB_USB_BOUNDARY_HZ rule).
3. Tap a data tick (amber) → mode becomes DATA.
4. Drag the band-range bar (not on a tick) → still works; VFO follows finger.
5. Tap an empty area of the spots row → no tune, no drag commit (drag handler will fire and pin the tick at the click position — that's the existing behavior, not a regression).

- [ ] **Step 3: Commit**

```bash
git add src/web/run.js
git commit -m "run: tap-to-tune on spot ticks"
```

---

## Task 12: Final integration check

- [ ] **Step 1: Run full unit test suite**

Run: `make test-unit`
Expected: every suite green.

- [ ] **Step 2: Manual integration verification**

Build, flash. Walk through these scenarios:

1. Cold-load (cleared localStorage) → run tab shows empty spots row, no ticks. Switch to chase, refresh → spots load, switch back to run, ticks appear.
2. Auto-refresh on chase → 60s later, run-tab spots row updates without user interaction (test by leaving run tab visible and waiting).
3. GPS override change in settings → run tab spots row clears immediately (Spots.clear()).
4. Switch bands rapidly → spots row updates each time without flicker.
5. Toggle license-class visibility (settings) → spots row stays at top, license rows below regenerate correctly.
6. Out-of-band VFO (e.g., 11m) → entire band-range hides, including spots row.
7. Drag-to-tune while auto-refresh fires → drag stays smooth, no snap; on release, ticks update.
8. Tap each color of tick → radio tunes correctly.

- [ ] **Step 3: Final commit (if any cleanup needed)**

If any verification revealed a bug, fix it on top of the relevant earlier task with a follow-up commit. No bug → no commit needed; the feature is done.
