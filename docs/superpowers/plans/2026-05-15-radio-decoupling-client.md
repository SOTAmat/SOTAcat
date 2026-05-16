# Radio Decoupling — Client-Side Phase Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the web UI's client-only actions (SMS/QRT/Polo/SOTAmāt) usable immediately and stop the Run-tab VFO poller from generating doomed traffic when the radio link is down — so the reported "can't send QRT after switching the radio off" disappears, independent of the server-side phase.

**Architecture:** (1) `onSpotAppearing()` enables the client-only buttons synchronously from localStorage-cached location instead of behind three awaited backend fetches; the backend refreshes fire un-awaited and re-sync button/macro state when they land. (2) `getCurrentVfoState()` consults the existing `AppState.connectionState` (already maintained by the `connectionStatus` poll) and skips polling while the link is not `"connected"`, resuming on recovery. The existing ⚫ `#connection-status` indicator already communicates the state — no new UI.

**Tech Stack:** Vanilla JS (`src/web/run.js`, `src/web/main.js`), custom Node test harness (`test/unit/`), mock server (`test/mock_server/server.py`), gzip-embedded assets (`scripts/compress_web_assets.py`, auto-run by the PlatformIO pre-build).

**Spec:** `docs/superpowers/specs/2026-05-15-radio-decoupling-design.md`

**Independence:** This phase requires no firmware change and ships on its own. With the server-side phase also deployed, link-down is detected faster and more cheaply, but this phase alone fixes the user-visible complaint.

---

## Test convention

`test/unit/test_run.js` is a custom harness (`describe`/`it`/`assertEqual`/`assertTrue`, `node test/unit/test_run.js`) that **re-declares the pure helper under test inside the test file** and asserts its behavior (see its existing `buildQrtSmsUri`/`mapModeForSotamat` blocks). This plan follows that established pattern: the pure decision functions live in `run.js`, and the test file contains a verbatim copy under test. Run a single file with `node test/unit/test_run.js`; run all unit tests with `make test-unit`.

## File Structure

- Modify `src/web/run.js`:
  - add pure `vfoPollAllowed(connectionState)` helper
  - add pure `clientOnlyButtonState(ref)` helper
  - rewrite `updateSpotButtonStates()` to use `clientOnlyButtonState()`
  - rewrite `onSpotAppearing()` ordering (sync enable, un-awaited refresh)
  - guard `getCurrentVfoState()` with `vfoPollAllowed()`
- Modify `src/web/main.js`: split a synchronous `restoreLocationFromCache()` out of `getLocation()` so location is available before any fetch.
- Modify `test/unit/test_run.js`: add tests for the two pure helpers.
- Regenerate embedded assets via `scripts/compress_web_assets.py`.

---

### Task 1: Pure `vfoPollAllowed()` helper (TDD)

**Files:**
- Modify: `src/web/run.js` (add helper near `getCurrentVfoState`, ~run.js:1013)
- Test: `test/unit/test_run.js`

- [ ] **Step 1: Write the failing test**

Append to `test/unit/test_run.js` (before the final summary/exit lines):

```javascript
describe('vfoPollAllowed', () => {
    // Verbatim copy of the helper under test (mirrors run.js).
    function vfoPollAllowed(connectionState) {
        return connectionState === "connected";
    }

    it('allows polling only when connected', () => {
        assertTrue(vfoPollAllowed("connected"), "connected");
        assertEqual(vfoPollAllowed("reconnecting"), false, "reconnecting");
        assertEqual(vfoPollAllowed("disconnected"), false, "disconnected");
        assertEqual(vfoPollAllowed(undefined), false, "undefined");
    });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node test/unit/test_run.js`
Expected: FAIL — the new `describe` block errors because the assertions exercise a not-yet-existing contract... actually this copy is self-contained and will PASS. To make this a real red-green, instead first add the **production** call site test that fails. Replace the test body above with a guard assertion against `run.js` source:

```javascript
const fs = require('fs');
describe('vfoPollAllowed wired into getCurrentVfoState', () => {
    const src = fs.readFileSync(__dirname + '/../../src/web/run.js', 'utf8');
    it('defines vfoPollAllowed', () => {
        assertTrue(/function vfoPollAllowed\s*\(/.test(src), "helper defined in run.js");
    });
    it('getCurrentVfoState early-returns when poll not allowed', () => {
        assertTrue(/vfoPollAllowed\s*\(\s*AppState\.connectionState\s*\)/.test(src),
            "getCurrentVfoState consults vfoPollAllowed(AppState.connectionState)");
    });
});
```

Run: `node test/unit/test_run.js`
Expected: FAIL — both assertions fail (`helper defined in run.js`, `getCurrentVfoState consults...`).

- [ ] **Step 3: Write minimal implementation**

In `src/web/run.js`, immediately above `async function getCurrentVfoState()` (run.js:1014), add:

```javascript
// Pure: VFO polling is only worthwhile while the device link is
// healthy. When connectionState is "reconnecting"/"disconnected" the
// poll would just pile doomed requests onto a starving device.
function vfoPollAllowed(connectionState) {
    return connectionState === "connected";
}
```

Then, as the very first statement inside `getCurrentVfoState()` (before the existing `if (RunState.isUpdatingVfo) return;`), add:

```javascript
    if (!vfoPollAllowed(AppState.connectionState)) {
        Log.debug("Spot")("Skipping VFO poll — link not connected");
        return;
    }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node test/unit/test_run.js`
Expected: PASS — both regex assertions pass; existing tests still pass (summary shows 0 failed).

- [ ] **Step 5: Commit**

```bash
git add src/web/run.js test/unit/test_run.js
git commit -m "feat: gate Run-tab VFO polling on connection health"
```

---

### Task 2: Synchronous location restore in `main.js`

**Files:**
- Modify: `src/web/main.js` (`getLocation`, ~main.js:1517)
- Test: `test/unit/test_run.js`

- [ ] **Step 1: Write the failing test**

Append to `test/unit/test_run.js`:

```javascript
describe('restoreLocationFromCache wired in main.js', () => {
    const fs = require('fs');
    const src = fs.readFileSync(__dirname + '/../../src/web/main.js', 'utf8');
    it('defines restoreLocationFromCache', () => {
        assertTrue(/function restoreLocationFromCache\s*\(/.test(src),
            "restoreLocationFromCache defined");
    });
    it('getLocation delegates the cache path to it', () => {
        assertTrue(/restoreLocationFromCache\s*\(\s*\)/.test(src),
            "getLocation calls restoreLocationFromCache()");
    });
});
```

Run: `node test/unit/test_run.js`
Expected: FAIL — both assertions fail.

- [ ] **Step 2: Extract the synchronous cache path**

In `src/web/main.js`, just above `async function getLocation()` (main.js:1517), add a synchronous extraction of the existing localStorage block:

```javascript
// Synchronous: populate AppState.gpsOverride from the localStorage
// cache only (no fetch). Lets location-dependent UI (spot buttons)
// initialize before any backend round-trip. Returns the location or
// null. Idempotent.
function restoreLocationFromCache() {
    if (AppState.gpsOverride) return AppState.gpsOverride;
    const cached = localStorage.getItem("cachedGpsLocation");
    if (!cached) return null;
    try {
        const parsed = JSON.parse(cached);
        if (parsed.latitude != null && parsed.longitude != null) {
            AppState.gpsOverride = {
                latitude: parseFloat(parsed.latitude),
                longitude: parseFloat(parsed.longitude),
            };
            Log.debug("GPS")("Restored location from localStorage");
            return AppState.gpsOverride;
        }
    } catch (e) {
        Log.warn("GPS")("Invalid cachedGpsLocation in localStorage");
    }
    return null;
}
```

- [ ] **Step 3: Make `getLocation()` reuse it**

In `getLocation()`, replace the in-memory check and the localStorage block (the lines from `if (AppState.gpsOverride) return AppState.gpsOverride;` through the `localStorageLocation` assignment) with:

```javascript
    // Fast path: in-memory / localStorage (synchronous).
    const cachedLocation = restoreLocationFromCache();
```

Then update the later fallback in `getLocation()` that returned `localStorageLocation` to return `cachedLocation` instead (same variable role). Leave the `/api/v1/gps` NVRAM fetch and the KPH default fallback unchanged.

- [ ] **Step 4: Run test to verify it passes**

Run: `node test/unit/test_run.js`
Expected: PASS — both new assertions pass; existing tests unaffected.

- [ ] **Step 5: Commit**

```bash
git add src/web/main.js test/unit/test_run.js
git commit -m "refactor: synchronous restoreLocationFromCache extracted from getLocation"
```

---

### Task 3: Pure `clientOnlyButtonState()` + rewire `updateSpotButtonStates()` (TDD)

**Files:**
- Modify: `src/web/run.js` (`updateSpotButtonStates`, run.js:1351)
- Test: `test/unit/test_run.js`

- [ ] **Step 1: Write the failing test**

Append to `test/unit/test_run.js`:

```javascript
describe('clientOnlyButtonState', () => {
    // Verbatim copy under test (mirrors run.js).
    const SOTA_REF_PATTERN2 = /^[A-Z0-9]{1,4}\/[A-Z]{2}-\d{3}$/;
    const POTA_REF_PATTERN2 = /^[A-Z]{1,2}-\d{4,5}$/;
    function isValidSpotReference2(ref) {
        if (!ref) return false;
        return SOTA_REF_PATTERN2.test(ref) || POTA_REF_PATTERN2.test(ref);
    }
    function clientOnlyButtonState(ref) {
        const valid = isValidSpotReference2(ref);
        // SOTAmāt always enabled (app has its own GPS); SMS/QRT/Polo
        // need a valid location-based reference. NONE of these depend
        // on the radio or any backend fetch.
        return { sotamat: true, sms: valid, qrt: valid, polo: valid };
    }

    it('SOTAmāt always enabled', () => {
        assertTrue(clientOnlyButtonState("").sotamat, "no ref");
        assertTrue(clientOnlyButtonState("W6/NC-423").sotamat, "valid ref");
    });
    it('SMS/QRT/Polo follow reference validity', () => {
        const none = clientOnlyButtonState("");
        assertEqual(none.qrt, false, "qrt disabled without ref");
        const sota = clientOnlyButtonState("W6/NC-423");
        assertTrue(sota.qrt, "qrt enabled with SOTA ref");
        const pota = clientOnlyButtonState("US-1234");
        assertTrue(pota.sms, "sms enabled with POTA ref");
    });

    const fs = require('fs');
    const src = fs.readFileSync(__dirname + '/../../src/web/run.js', 'utf8');
    it('run.js defines clientOnlyButtonState and uses it in updateSpotButtonStates', () => {
        assertTrue(/function clientOnlyButtonState\s*\(/.test(src), "helper defined");
        assertTrue(/clientOnlyButtonState\s*\(/.test(src.split('function updateSpotButtonStates')[1] || ''),
            "updateSpotButtonStates uses the helper");
    });
});
```

Run: `node test/unit/test_run.js`
Expected: FAIL — the `run.js defines clientOnlyButtonState...` assertion fails (helper not yet in run.js). The pure-copy assertions pass (they test the spec'd behavior).

- [ ] **Step 2: Add the helper and rewire**

In `src/web/run.js`, immediately above `function updateSpotButtonStates()` (run.js:1351), add:

```javascript
// Pure: which client-only action buttons should be enabled for a
// given location reference. Independent of radio link and of any
// backend fetch — depends solely on the (cached) reference string.
function clientOnlyButtonState(ref) {
    const valid = isValidSpotReference(ref);
    return { sotamat: true, sms: valid, qrt: valid, polo: valid };
}
```

Replace the body of `updateSpotButtonStates()` with:

```javascript
    const ref = getLocationBasedReference() || "";
    const st = clientOnlyButtonState(ref);

    const sotamatBtn = document.getElementById("sotamat-button");
    const smsSpotBtn = document.getElementById("sms-spot-button");
    const smsQrtBtn = document.getElementById("sms-qrt-button");
    const poloSpotBtn = document.getElementById("polo-spot-button");

    if (sotamatBtn) sotamatBtn.disabled = !st.sotamat;
    if (smsSpotBtn) smsSpotBtn.disabled = !st.sms;
    if (smsQrtBtn) smsQrtBtn.disabled = !st.qrt;
    if (poloSpotBtn) poloSpotBtn.disabled = !st.polo;

    Log.debug("Spot")(`buttons: sotamat on, sms/qrt/polo ${st.qrt ? "on" : "off"}, ref="${ref}"`);
```

- [ ] **Step 3: Run test to verify it passes**

Run: `node test/unit/test_run.js`
Expected: PASS — all assertions in the block pass; existing tests unaffected.

- [ ] **Step 4: Commit**

```bash
git add src/web/run.js test/unit/test_run.js
git commit -m "feat: pure clientOnlyButtonState drives spot button enablement"
```

---

### Task 4: Reorder `onSpotAppearing()` — enable buttons before backend fetches

**Files:**
- Modify: `src/web/run.js` (`onSpotAppearing`, run.js:1635)
- Test: `test/unit/test_run.js`

- [ ] **Step 1: Write the failing test**

Append to `test/unit/test_run.js`:

```javascript
describe('onSpotAppearing ordering', () => {
    const fs = require('fs');
    const src = fs.readFileSync(__dirname + '/../../src/web/run.js', 'utf8');
    const fn = src.split('async function onSpotAppearing')[1].split('\n}')[0];

    it('calls updateSpotButtonStates before any awaited backend fetch', () => {
        const idxButtons = fn.indexOf('updateSpotButtonStates(');
        const idxAwaitCall = fn.indexOf('await ensureCallSignLoaded');
        const idxAwaitLoc = fn.indexOf('await getLocation');
        const idxAwaitMac = fn.indexOf('await loadCwMacrosAsync');
        assertTrue(idxButtons > -1, "updateSpotButtonStates called");
        assertTrue(idxAwaitCall === -1, "no awaited ensureCallSignLoaded");
        assertTrue(idxAwaitLoc === -1, "no awaited getLocation");
        assertTrue(idxAwaitMac === -1, "no awaited loadCwMacrosAsync");
    });
    it('restores location synchronously before enabling buttons', () => {
        const idxRestore = fn.indexOf('restoreLocationFromCache(');
        const idxButtons = fn.indexOf('updateSpotButtonStates(');
        assertTrue(idxRestore > -1 && idxRestore < idxButtons,
            "restoreLocationFromCache() precedes updateSpotButtonStates()");
    });
});
```

Run: `node test/unit/test_run.js`
Expected: FAIL — `no awaited ensureCallSignLoaded` etc. fail (current code awaits them) and `restoreLocationFromCache() precedes...` fails.

- [ ] **Step 2: Rewrite `onSpotAppearing()`**

Replace the entire body of `async function onSpotAppearing()` (run.js:1635-1662) with:

```javascript
    Log.info("Spot")("tab appearing");
    loadCollapsibleStates();

    // Enable client-only actions IMMEDIATELY from cached identity.
    // QRT/Spot SMS, Polo and SOTAmāt need neither the radio nor the
    // device server — only the cached location reference. Restoring
    // location from localStorage is synchronous, so the buttons are
    // live before any network round-trip.
    restoreLocationFromCache();
    renderCwMacroButtons();           // from cached AppState.cwMacros (may be empty)
    attachSpotEventListeners();
    syncXmitButtonState();
    updateSpotButtonStates();

    // Refresh identity/macros/license from the backend WITHOUT blocking
    // the UI. Each refresh re-syncs the pieces it owns when it lands.
    // A starved/absent device simply means these never resolve — the
    // buttons stay usable regardless.
    ensureCallSignLoaded().catch(() => {});
    getLocation().then(() => updateSpotButtonStates()).catch(() => {});
    loadCwMacrosAsync().then(() => renderCwMacroButtons()).catch(() => {});
    ensureLicenseClassLoaded().catch(() => {});

    startVfoUpdates();
```

> Rationale: `updateSpotButtonStates()` and `renderCwMacroButtons()`
> are idempotent and already re-invoked elsewhere, so calling them
> again from the un-awaited `.then()` handlers is safe. `startVfoUpdates()`
> still runs, but its periodic `getCurrentVfoState()` is now gated by
> `vfoPollAllowed()` from Task 1, so a down link produces no doomed
> polling. `ensureLicenseClassLoaded()` previously gated the first VFO
> read; privilege badges simply refresh on its `.then` via the existing
> `getCurrentVfoState()` → `updatePrivilegeDisplay()` path on the next
> allowed poll.

- [ ] **Step 3: Run test to verify it passes**

Run: `node test/unit/test_run.js`
Expected: PASS — ordering assertions pass; full suite shows 0 failures.

- [ ] **Step 4: Commit**

```bash
git add src/web/run.js test/unit/test_run.js
git commit -m "fix: enable QRT/SMS/Polo before backend fetches in onSpotAppearing"
```

---

### Task 5: Regenerate embedded assets + full unit suite

**Files:**
- Modify (generated): `src/web/run.jsgz`, `src/web/main.jsgz`

- [ ] **Step 1: Run prettier to match house style**

The repo uses `.prettierrc` (4-space, 120 col, es5 trailing commas), no eslint.
Run: `npx prettier --write src/web/run.js src/web/main.js`
Expected: files reformatted in place (or "unchanged" if already compliant). Re-run `node test/unit/test_run.js` → still PASS (the source-regex assertions tolerate whitespace; if any now fails due to formatting, adjust the regex in the test to be whitespace-insensitive and re-commit).

- [ ] **Step 2: Regenerate gzip assets**

Run: `python3 scripts/compress_web_assets.py`
Expected: prints per-file compression lines including `run.js` and `main.js`; `src/web/run.jsgz` and `src/web/main.jsgz` updated (newer mtime). (The PlatformIO pre-build also does this automatically; running it explicitly keeps the committed `*gz` in sync and lets the mock-server/UI test serve the new code.)

- [ ] **Step 3: Run the whole unit suite**

Run: `make test-unit`
Expected: every `test/unit/test_*.js` runs; final line per file shows passes, 0 failures across the suite.

- [ ] **Step 4: Commit**

```bash
git add src/web/run.js src/web/main.js src/web/run.jsgz src/web/main.jsgz
git commit -m "chore: reformat + regenerate embedded web assets"
```

---

### Task 6: Integration (mock server) + manual validation

**Files:** none (validation only)

- [ ] **Step 1: UI test against the mock server**

Run: `cd test/integration && ./run_tests.py --ui --mock`
Expected: UI suite passes against `test/mock_server/server.py` serving `../../src/web`. (If the harness needs setup first: `make test-setup`.)

- [ ] **Step 2: Manual — QRT works with the device unreachable**

Serve the UI from the mock server (`cd test/mock_server && python3 server.py --port 8080 --web-dir ../../src/web`), open `http://localhost:8080`, set a valid SOTA/POTA reference so it's cached, then **stop the mock server** (simulates the device/radio gone). Reload is not needed — switch to the Run tab. Confirm: SOTAmāt/Spot SMS/QRT SMS/Tell PoLo are **enabled** and the QRT SMS button opens the SMS composer. Before this phase the buttons stayed greyed out.

- [ ] **Step 3: Manual — polling backs off on link loss**

With the UI open and connected to the mock server, stop the server and watch the console: within `DISCONNECT_THRESHOLD` connection polls the ⚫ indicator/overlay appears and `getCurrentVfoState()` logs "Skipping VFO poll — link not connected" instead of firing `/api/v1/frequency`+`/api/v1/mode`. Restart the server → polling resumes, VFO tracks again.

- [ ] **Step 4: Optional — on real hardware**

If a device is available, flash a build that includes the regenerated assets (`make upload`), open the Run tab with the KX2 on, then switch the KX2 off: confirm the QRT SMS button stays usable and VFO polling backs off. (Full responsiveness of *other* tabs requires the server-side phase; this phase alone keeps the client-only buttons and poll-gating correct.)

- [ ] **Step 5: Close-out commit**

```bash
git commit --allow-empty -m "chore: client-side radio decoupling phase validated"
```

---

## Self-Review

**Spec coverage:**
- Ungate client-only buttons from awaited backend fetches → Tasks 2, 3, 4 (sync location restore, pure button-state helper, reordered `onSpotAppearing`).
- Stop/back-off VFO polling on link-down, reuse existing `connectionState`/⚫ indicator, no new UI → Task 1 (`vfoPollAllowed` gate on `AppState.connectionState`, which the existing `connectionStatus` poll already maintains).
- Out of scope (per user selection): blanket fetch timeouts — not introduced; the un-awaited fetches in Task 4 simply don't block, no `AbortController` added.
- Independence from server phase → stated in header; Task 6 Step 4 notes the cross-phase interaction honestly.
- Testing: pure helpers get red-green unit tests in the existing harness (Tasks 1,3) plus source-wiring assertions (Tasks 1,2,4); integration via mock server + manual (Task 6). Matches the spec's client testing approach.

**Placeholder scan:** No TBD/TODO; every step shows complete code and exact commands with expected output. Task 1 Step 2 deliberately replaces a self-passing test with a real failing wiring assertion so red-green is genuine.

**Type/name consistency:** `vfoPollAllowed`, `clientOnlyButtonState`, `restoreLocationFromCache` are spelled identically across run.js/main.js edits and their tests. `AppState.connectionState` values (`"connected"`/`"reconnecting"`/`"disconnected"`) match `main.js` as investigated. `restoreLocationFromCache()` is defined in Task 2 before Task 4 references it. `updateSpotButtonStates()`/`renderCwMacroButtons()` idempotency relied on in Task 4 matches their investigated bodies.

Fixed during review: a typo in the Task 3 heading ("rew=ire" → "rewire").
