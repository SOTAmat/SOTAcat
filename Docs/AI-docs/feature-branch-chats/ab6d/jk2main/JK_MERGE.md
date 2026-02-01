# ab6d/jk2main Integration Document

**Branch Base:** kowalski/wip (commit `55fac9f`)  
**Comparison Target:** kowalski/wip (up to commit `a089d86`)
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

## Code Review Findings (Feb 1, 2026)

A deep review of `ab6d/jk2main` relative to `kowalski/wip` was performed.

### 1. Feature Parity with kowalski/wip
The `ab6d/jk2main` branch successfully integrates recent features from `kowalski/wip` (commits up to `a089d86`), including:
- **UI Modernization**: `SPOT` -> `RUN` tab rename, Tune target delimiters `{}`, compact mode, connection loss overlay.
- **QRX Page**: Location-based references, Nearest SOTA, Setup PoLo button.
- **WiFi**: STA IP pinning to `.200`, RSSI reporting for AP clients.
- **Documentation**: New structure in `Documentation/`.

### 2. Architectural Integrity
The driver pattern has been implemented cleanly without disrupting the `kowalski/wip` architecture:
- `KXRadio` class delegates efficiently to `m_driver`.
- Handlers (`handler_cat.cpp`, `handler_frequency.cpp`, etc.) are now agnostic to the specific radio hardware.
- KH1-specific logic is confined to `src/radio_driver_kh1.cpp`.

### 3. Cleanups & Refactoring
- **RunState**: The `SpotState` object has been correctly renamed to `RunState` in `run.js`.
- **CSS Classes**: `spot-container` has been renamed to `run-container` in HTML and CSS.
- **Styling**: Miles column alignment in Chase table is implemented.

### 4. Deviations
No unsupported deviations were found. All changes in `ab6d/jk2main` are either:
- Part of the KH1/Driver refactoring.
- Integrations of features from `kowalski/wip`.

---

## Missing Features from `origin/main`

The following features were added to `origin/main` after the `kowalski/wip` branch diverged and are **not yet present** in `kowalski/wip` (and thus missing from `ab6d/jk2main`). These should be considered for future integration.

### 1. FT8 Power Readback Verification (`586baf4`)
- **Main:** Ensures FT8 power is at 10 watts by reading back the value after setting it.
- **Current:** `ab6d/jk2main` sets the power blindly (via `put_to_kx_menu_item`) in `KXRadioDriver::ft8_prepare` without an explicit read-back verification loop.

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

4. **kowalski/wip UI Features** - Integrated & Committed
   - SPOT → RUN tab rename completed (`run.html`, `run.js`)
   - Connection loss overlay HTML/CSS/JS (index.html, main.js, style.css)
   - QRX as default tab on initial load
   - QRX page with location-based references, Nearest SOTA, PoLo button
   - Tune target delimiters changed from `<>` to `{}`
   - Reference patterns (SOTA/POTA/WWFF/IOTA) in `main.js`
   - Battery time humanization in header display
   - Compact mode toggle in Settings page
   - CSS class refactoring (hidden, feedback classes)

5. **WiFi Improvements** - Integrated & Committed
   - STA IP pinning to `.200` on hotspot connect
   - DHCP revert on disconnect
   - AP client RSSI reporting (weakest client signal)

6. **Documentation**
   - New `Documentation/` tree with user and dev docs
   - Updated README.md with modern structure
   - KH1 code review document at `Docs/AI-docs/.../CR_PR77.md`

7. **Cleanup Tasks** (Previously Pending)
   - **CSS class rename:** `spot-container` → `run-container` ✅
   - **State object rename:** `SpotState` → `RunState` in `run.js` ✅
   - **Miles column alignment:** Add `#chase-table td:nth-child(7) { text-align: right; }` to style.css ✅
   - **localStorage key migration:** `spotCwMessage*` → `runCwMessage*` (Present in `run.js`) ✅

### Locking and Timing (Needs Verification)

- Handlers use `TimedLock` and `TIMED_LOCK_OR_FAIL` macro ✅
- FT8 timing, cache fallback, and timeout tiers should be validated on hardware

---

## FT8 Regression vs `origin/main` (Feb 1, 2026)

### Findings
- **FT8 cleanup can exit without restoring radio state:** `cleanup_ft8_task()` now uses `TimedLock` with a 10s timeout and returns early if the lock is busy, skipping `restore_radio_state()` and leaving the radio in prepared FT8 mode. In `origin/main` this was a blocking `lock_guard`, so cleanup always eventually restored state.
- **FT8 transmit can abort under contention:** `xmit_ft8_task()` now uses a timed lock and exits if it cannot acquire the mutex, which can skip the second transmission if another REST request is holding the lock.
- **FT8 window timing no longer uses UTC:** `msUntilFT8Window()` now uses `esp_timer_get_time()` (uptime) instead of `gettimeofday()` (UTC). This decouples FT8 start times from UTC boundaries and is a behavioral change from `origin/main`.

### Plan to Address
1. **Make cleanup non-failable:** Replace the timed lock in `cleanup_ft8_task()` with a blocking lock or a retry loop (with watchdog resets) so `restore_radio_state()` always runs. Never return early without restoring state.
2. **Harden transmit under lock contention:** If `xmit_ft8_task()` cannot acquire the lock, force cleanup by setting `CancelRadioFT8ModeTime = 1`, clear `ft8TaskInProgress`, and schedule a retry (or return a clear error to the caller) so the radio does not remain prepared.
3. **Handle lock failure in prepare:** When `TIMED_LOCK_OR_FAIL` triggers in `handler_prepareft8_post()`, ensure `CommandInProgress` is cleared, allocated tone buffers are freed, and LED state is reset before returning.
4. **Re-align FT8 timing to UTC:** Switch `msUntilFT8Window()` back to `gettimeofday()` or compute the 15-second boundary from the system clock so FT8 transmissions remain time-accurate.

### Additional FT8 Workflow Findings
- **Cancel can be overridden in transmit:** `waitForFT8Window()` returns early when `CancelRadioFT8ModeTime <= 1`, but `xmit_ft8_task()` immediately overwrites `CancelRadioFT8ModeTime` and proceeds with tones. Suggested fix: re-check cancellation right after `waitForFT8Window()` and return early before updating the watchdog, or gate the watchdog update on `CancelRadioFT8ModeTime > 1`.
- **`CommandInProgress` cleared when `handler_ft8_post()` auto-calls prepare:** When `handler_ft8_post()` calls `handler_prepareft8_post()` internally, the prepare handler clears `CommandInProgress` on success, so the FT8 transmit runs with the busy flag cleared. Suggested fix: reassert `CommandInProgress` after the prepare call or add a prepare option to leave the flag set when invoked by `handler_ft8_post()`.

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

---

## Remaining Tasks

### Hardware Validation
1. **Test on KX2, KX3, and KH1 radios:**
   - Verify all CAT endpoints work correctly.
   - Test FT8 transmission and time sync.
   - Verify `run.js` interactions (frequency tuning, mode switching, etc.).

2. **Complete locking/timing review:**
   - Verify FT8 task lock behavior.
   - Check cache fallback for frequency/mode.

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
