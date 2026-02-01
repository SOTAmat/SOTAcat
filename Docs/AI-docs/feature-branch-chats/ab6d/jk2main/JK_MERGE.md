# ab6d/jk2main Integration Document

**Branch Base:** kowalski/wip (commit `55fac9f`)  
**Last Updated:** February 1, 2026  
**Purpose:** Integrate KH1 radio support from `main` into `kowalski/wip` architecture using a driver abstraction layer

---

## Overview

The `ab6d/jk2main` branch was created from `kowalski/wip` to:
1. Add Elecraft KH1 radio support (from PR #77 on `main`)
2. Refactor radio-specific code into device drivers (`IRadioDriver` interface)
3. Keep handlers and web UI radio-agnostic
4. Incorporate minimal, targeted changes to `kowalski/wip` architecture

---

## Current Status Summary

### Completed (✅)

1. **Radio Driver Architecture** - Fully implemented
   - `IRadioDriver` interface in `include/radio_driver.h`
   - `KXRadioDriver` in `src/radio_driver_kx.cpp/.h` (for KX2/KX3)
   - `KH1RadioDriver` in `src/radio_driver_kh1.cpp/.h` (for KH1)
   - `KXRadio` class updated to use `m_driver` pointer with runtime selection
   - Driver selection via `select_driver()` based on detected `RadioType`

2. **Handler Refactoring** - All handlers use driver abstraction
   - `handler_atu.cpp` - Uses `kxRadio.tune_atu()` (driver routes to correct command)
   - `handler_cat.cpp` - Uses `kxRadio.set_xmit_state()`, `play_message_bank()`, `send_keyer_message()`
   - `handler_frequency.cpp` - Uses `kxRadio.get_frequency()`, `set_frequency()`
   - `handler_mode_bandwidth.cpp` - Uses `kxRadio.get_mode()`, `set_mode()`
   - `handler_ft8.cpp` - Uses `kxRadio.ft8_prepare()`, `ft8_tone_on/off()`, `ft8_set_tone()`
   - `handler_time.cpp` - Uses `kxRadio.sync_time()`
   - `handler_status.cpp` - Uses `kxRadio.get_xmit_state()`
   - `handler_volume.cpp` - Uses `kxRadio.get_volume()`, `set_volume()` with `supports_volume()` check

3. **KH1 Radio Support** - Fully integrated
   - Detection at 9600 baud via `;I;` / `KH1;` response
   - Frequency/mode reading via DS1 display parsing
   - Power control via LOW/HIGH toggle (SW2H command)
   - FT8 transmission via FO command for frequency offset (00-99 Hz range)
   - Time setting via MNTIM menu and ENVU/ENVD for adjustments
   - ATU tuning via SW3T command
   - Transmit toggle via HK1/HK0 commands
   - `supports_keyer()` returns false (KH1 has no CW keyer memories)
   - `supports_volume()` returns false (KH1 has no AF gain CAT control)

4. **kowalski/wip UI Features** - Integrated in local working tree
   - SPOT → RUN tab rename completed (`run.html`, `run.js`)
   - Connection loss overlay HTML/CSS/JS (index.html, main.js, style.css)
   - QRX as default tab on initial load
   - QRX page with location-based references, Nearest SOTA, PoLo button
   - Tune target delimiters changed from `<>` to `{}`
   - Reference patterns (SOTA/POTA/WWFF/IOTA) in `main.js`
   - Battery time humanization in header display
   - Compact mode toggle in Settings page
   - CSS class refactoring (hidden, feedback classes)

5. **WiFi Improvements** - Integrated in local working tree
   - STA IP pinning to `.200` on hotspot connect
   - DHCP revert on disconnect
   - AP client RSSI reporting (weakest client signal)

6. **Documentation**
   - New `Documentation/` tree with user and dev docs
   - Updated README.md with modern structure
   - KH1 code review document at `Docs/AI-docs/.../CR_PR77.md`

### Minor Cleanup Needed (🔶)

1. **CSS class rename:** `spot-container` → `run-container`
   - In `src/web/style.css` and `src/web/run.html`

2. **State object rename:** `SpotState` → `RunState` in `run.js`

3. **Miles column alignment:** Add `#chase-table td:nth-child(7) { text-align: right; }` to style.css

4. **localStorage key migration:** `spotCwMessage*` → `runCwMessage*` (if not already done)

### Locking and Timing (Needs Verification)

- Handlers use `TimedLock` and `TIMED_LOCK_OR_FAIL` macro ✅
- FT8 timing, cache fallback, and timeout tiers should be validated on hardware

---

## Working Tree Status

The local working tree has uncommitted changes that incorporate features from kowalski/wip commits made after the branch was created. These changes were manually integrated rather than merged/cherry-picked, so they don't appear in the commit history.

**Uncommitted files with kowalski/wip integrations:**
- `src/web/main.js` - Connection detection, compact mode, tune targets
- `src/web/index.html` - QRX default tab, connection overlay
- `src/web/style.css` - Compact mode CSS, connection overlay styles
- `src/web/settings.html` - Compact mode checkbox
- `src/web/settings.js` - Compact mode handlers
- `src/wifi.cpp` - STA IP pinning, AP client RSSI
- `src/web/qrx.js` - Location-based references, Nearest SOTA
- And others (see `git status`)

**New untracked files:**
- `src/web/run.html` / `run.js` - Renamed from spot.html/js
- `Documentation/` - New documentation tree
- `test/unit/test_qrx.js` - QRX page unit tests

---

## Deviations from kowalski/wip (Justified by Driver Architecture)

The following deviations are intentional and required for KH1 support:

### 1. New Files (Driver Architecture)

These files exist only in `ab6d/jk2main`:
- `include/radio_driver.h` - IRadioDriver interface
- `src/radio_driver_kx.cpp` / `.h` - KX2/KX3 driver
- `src/radio_driver_kh1.cpp` / `.h` - KH1 driver

### 2. KXRadio Class Changes

The `KXRadio` class has new members and methods:
- `m_driver` pointer for runtime driver selection
- `select_driver()` method
- High-level driver-forwarding methods (`get_frequency()`, `set_mode()`, etc.)
- `RadioType::KH1` enum value added

### 3. Handler Changes

Handlers call driver-abstracted methods instead of raw CAT commands. This is necessary for:
- Volume control (KH1 doesn't support AF gain CAT control)
- TX/RX toggle (different commands per radio)
- Message playback (different button sequences per radio)
- Keyer (not supported on KH1)
- FT8 tone generation (different mechanism on KH1)
- Time sync (different menu system on KH1)
- ATU tuning (different switch commands per radio)

Example - `handler_cat.cpp` TX toggle:
```cpp
// kowalski/wip (KX-only):
const char * command = xmit ? "TX;" : "RX;";
kxRadio.put_to_kx_command_string(command, 1);

// jk2main (driver abstraction - supports KX and KH1):
kxRadio.set_xmit_state(xmit != 0);
// Driver routes to "TX;"/"RX;" for KX, "HK1;"/"HK0;" for KH1
```

---

## Remaining Tasks

### Before Commit

1. **Rename CSS class:** `spot-container` → `run-container`
   - `src/web/style.css`: Change `.spot-container` to `.run-container`
   - `src/web/run.html`: Change `class="spot-container"` to `class="run-container"`

2. **Rename state object:** `SpotState` → `RunState` in `run.js`

3. **Add Miles column alignment:**
   ```css
   #chase-table td:nth-child(7) {
       text-align: right;
   }
   ```

4. **Commit all changes** with a descriptive message

### After Commit (Validation)

5. **Hardware validation:**
   - Test on KX2, KX3, and KH1 radios
   - Verify all CAT endpoints work correctly
   - Test FT8 transmission and time sync

6. **Complete locking/timing review:**
   - Verify FT8 task lock behavior
   - Check cache fallback for frequency/mode

---

## Files to Commit

Based on `git status`, the following changes need to be committed:

**Modified files:**
- `.clangd`
- `Docs/AI-docs/feature-branch-chats/ab6d/jk2main/JK_MERGE.md`
- `README.md`
- `firmware/webtools/manifest.json`
- `include/build_info.h`
- `platformio.ini`
- `src/CMakeLists.txt`
- `src/web/chase.js`
- `src/web/index.html`
- `src/web/main.js`
- `src/web/qrx.html`
- `src/web/qrx.js`
- `src/web/settings.html`
- `src/web/settings.js`
- `src/web/style.css`
- `src/webserver.cpp`
- `src/wifi.cpp`
- `test/integration/*`

**Deleted files:**
- `src/web/spot.html`
- `src/web/spot.js`

**New untracked files:**
- `Docs/README.md`
- `Documentation/` (entire directory)
- `src/web/run.html`
- `src/web/run.js`
- `test/unit/test_qrx.js`

---

## Architecture Decision: Driver Pattern

The driver pattern was chosen because:

1. **Separation of Concerns** - Radio-specific code is isolated in driver files
2. **Extensibility** - New radios can be added by implementing `IRadioDriver`
3. **Handler Simplicity** - Handlers don't need `switch` statements on `RadioType`
4. **Feature Detection** - `supports_keyer()`, `supports_volume()` allow graceful degradation
5. **Testing** - Drivers can be unit tested in isolation

The pattern follows the Strategy design pattern with runtime selection based on detected radio type.

---

*Document last updated: February 1, 2026*
