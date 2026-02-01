# Changes in main Branch Not Present in kowalski/wip Branch

**Branch Split Point:** `82d567a` - "Remove submodule esp32-smbus, rely on pio lib_deps"  
**Analysis Date:** January 23, 2026  
**Base Branch:** kowalski/wip  
**Target Branch:** main

This document catalogs changes added to `main` after the split from `kowalski/wip` that do **not** exist in `kowalski/wip` (even if implemented differently). Items verified as present in `kowalski/wip` have been removed.

## JK2 Integration Plan (ab6d/jk2main)

This plan assumes the current working tree already contains the partial radio-driver refactor (new `IRadioDriver` in `include/radio_driver.h` and drivers in `src/radio_driver_kx.*` / `src/radio_driver_kh1.*`). The goal is to finish the refactor, validate locking and timing behavior from `kowalski/wip`, then merge in the latest `origin/kowalski/wip` changes.

### 1) Finish the radio-driver refactor
1. Inventory remaining radio-specific logic outside drivers.
   - `src/handler_volume.cpp` still uses `kxRadio.get_from_kx` / `kxRadio.put_to_kx` with KX-only AG commands. Decide: add volume methods to `IRadioDriver` (preferred) or gate the handler by `RadioType` or a new `supports_volume` capability.
   - Search for any other direct `get_from_kx` / `put_to_kx` usage and move to driver methods.
2. Expand the driver interface as needed.
   - Add `get_volume` / `set_volume` (or `supports_audio_gain`) to `IRadioDriver`.
   - Implement in `KXRadioDriver`; return false in `KH1RadioDriver` and have the handler return 404 for unsupported features.
3. Keep handlers radio-agnostic.
   - Handlers should call `kxRadio.*` high-level methods only (no RadioType branching, no DSx parsing).
   - Update `KXRadio` to forward any new methods to `m_driver`.
4. Make sure build includes new files.
   - Add new driver `.cpp` / `.h` files to any build lists if needed.
   - `include/radio_driver.h` should stay in `include/`; driver headers can stay in `src/` if they are private.
5. Commit the refactor as its own change before merging `origin/kowalski/wip`.

### 2) Locking and timing regression review
The refactor must preserve the `kowalski/wip` concurrency protections (radio mutex plus timeouts).

Checklist:
- Every radio access in HTTP handlers runs inside `TimedLock` or `TIMED_LOCK_OR_FAIL`.
- `xmit_ft8_task` holds a single `TimedLock` for the entire transmission and only uses `kxRadio.ft8_*` inside that lock.
- `handler_prepareft8_post` grabs a lock only for the setup phase, then releases it before background tasks start.
- `KXRadio::connect()` is still called under a lock during setup (`setup.cpp` uses `timed_lock(portMAX_DELAY, "radio connect")`).
- `get_from_kx` / `put_to_kx` are not called from any context that does not already hold the lock.
- Timeouts still match operation tiers (FAST, MODERATE, CRITICAL, FT8) and no new lock bypasses were introduced.

If any regression is found:
- Restore `TimedLock` blocks around any new direct `kxRadio` or UART calls.
- Avoid taking locks inside driver methods (keep locks at the handler or task layer to prevent deadlocks).
- Reintroduce cached-frequency and cached-mode fallback behavior if it was removed or weakened.

### 3) Incorporate latest `origin/kowalski/wip` changes
`origin/kowalski/wip` has moved ahead since `ab6d/jk2main`. The current delta includes UI and docs updates such as connection-loss overlay, QRX page changes, and README/docs modernization.

Recommended sequence:
1. Fetch latest:
   - `git fetch origin`
2. Finish and commit the refactor work on `ab6d/jk2main` (keep it a single focused commit).
3. Rebase or merge:
   - Preferred: `git rebase origin/kowalski/wip`
   - Alternative: `git merge origin/kowalski/wip`
4. Resolve likely conflicts in:
   - `README.md`
   - `Docs/...` (documentation structure and placeholders)
   - `src/web/*` (QRX/chase UI changes, CSS refactors, labels)
5. After merging, re-run the KH1 validations:
   - Detection at 9600 baud (`;I;` / `KH1;`)
   - CAT endpoints (`/frequency`, `/mode`, `/xmit`, `/atu`, `/power`, `/time`)
   - FT8 transmit and cleanup path and watchdog
   - Unsupported features: keyer and volume should return a clear error on KH1
6. Build and flash for at least one KX and one KH1 test cycle if possible.

## Summary

The following functionality appears only in `main` and is missing from `kowalski/wip`:

- Elecraft KH1 radio support (PR #77)
- Time interval selectors (15m/30m) and POTA time filtering to match SOTA
- KH1 support review document and AI documentation structure additions
- Cursor documentation file (`docs-cursor/README.md`)

## Major Feature Additions

### 1. Elecraft KH1 Radio Support (PR #77)

**Commits:**
- `b9b9253` (2026-01-11) - Adding support for the Elecraft KH1 (#77) by WR7D
- `7946d8f` (2026-01-11) - Release build for initial KH1 support
- `09f5ab4` (2026-01-11) - Add attribution to Wayne and WR7D for adding KH1 support
- `d0fee64` (2026-01-11) - Attribution change and official version update
- `6f8fe27` (2026-01-15) - Power-set-fix (#78) - Removed power setting functionality, Min power button changes radio to LOW mode

**Files Changed:**
- `include/kx_radio.h` - Added `RadioType::KH1` enum value and KH1-specific methods
- `src/kx_radio.cpp` - Added KH1 detection, frequency/mode reading, power setting, and CAT command handling
- `src/handler_atu.cpp` - KH1-specific ATU handling
- `src/handler_cat.cpp` - KH1-specific CAT command handling
- `src/handler_frequency.cpp` - KH1 frequency handling
- `src/handler_ft8.cpp` - KH1 FT8 transmission support with FO command
- `src/handler_mode_bandwidth.cpp` - KH1 mode and bandwidth handling
- `src/handler_status.cpp` - KH1 status reading via DS1 display parsing
- `src/handler_time.cpp` - KH1 time setting (no seconds support, different menu/button functions)
- `src/web/about.html` - Updated radio type display
- `src/web/cat.js` - KH1 support additions
- `src/web/settings.html` - KH1-related settings

**Key Implementation Details:**
- KH1 uses different CAT command set compared to KX2/KX3
- KH1 detection via baud rate (9600) and different OM command response
- Frequency and mode reading via DS1 display parsing (different from KX2/KX3)
- Power control limited to two preset levels (LOW/HIGH)
- FT8 transmission uses FO command for frequency offset (00-99 Hz range)
- Time setting uses MNTIM and SW4T commands (different from KX2/KX3)
- No CW keyer memories support on KH1

**Documentation:**
- `Docs/AI-docs/feature-branch-chats/PR77-WR7D-KH1-support/CR_PR77.md` - Code review document with detailed analysis

**Impact:** This is a **major feature addition** that enables SOTACAT to work with the Elecraft KH1 radio. The implementation required significant changes to the radio communication layer and multiple handlers.

---

### 2. Time Interval Selectors and POTA Time Filter

**Commits:**
- `96e41fd` (2025-10-05) - Added 15m and 30m time interval selectors. Add time filter to POTA to match SOTA. Improved SOTA Watch API rate limiting cache code

**Files Changed:**
- `src/web/main.js` - Time interval selector logic (34 lines added/modified)
- `src/web/pota.html` - Time interval selector UI (24 lines added)
- `src/web/pota.js` - POTA time filtering (31 lines modified)
- `src/web/sota.html` - Time interval selector updates
- `src/web/sota.js` - SOTA time filtering improvements (57 lines added/modified)
- `firmware/webtools/manifest.json` - Version bump
- `include/build_info.h` - Version bump

**Key Features:**
- Added 15-minute and 30-minute time interval selectors (in addition to existing intervals)
- Added time filter to POTA page to match SOTA functionality
- Improved SOTA Watch API rate limiting cache implementation

**Impact:** **Medium** - Enhances filtering capabilities and improves API efficiency.

---

## Documentation Additions Missing from kowalski/wip

### 3. AI Documentation Directory Structure

**Commits:**
- `f5273f6` (2026-01-11) - Created a place to hold AI generated .md documents for future reference

**Files Changed:**
- `Docs/AI-docs/feature-branch-chats/` - New directory structure
- `Docs/AI-docs/feature-branch-chats/PR77-WR7D-KH1-support/CR_PR77.md` - KH1 code review document

---

### 4. Cursor Documentation

**Commits:**
- `52de9f1` (2026-01-18) - Cursor Readme

**Files Changed:**
- `docs-cursor/README.md` - Cursor documentation (125 lines)

---

## Notes

- WebSDR/tune targets, SDR mobile enablement, and band/mode sideband logic are already present in `kowalski/wip` (implemented differently), so they are intentionally omitted here.
- The branch split occurred at commit `82d567a` ("Remove submodule esp32-smbus, rely on pio lib_deps").

---

*Document updated on January 23, 2026*
# Changes in main Branch Not Present in kowalski/wip Branch

**Branch Split Point:** `82d567a` - "Remove submodule esp32-smbus, rely on pio lib_deps"  
**Analysis Date:** January 23, 2026  
**Base Branch:** kowalski/wip  
**Target Branch:** main

This document catalogs all changes that were added to the `main` branch after the split from `kowalski/wip` that have not been incorporated into `kowalski/wip`. The analysis includes commits from August 5, 2025 through January 23, 2026.

## Summary

A total of **33 commits** were added to `main` that are not present in `kowalski/wip`. These changes include:

- **Major Feature Additions:**
  - Elecraft KH1 radio support (PR #77)
  - WebSDR integration
  - SDR mobile launch control
  - Time interval selectors for SOTA/POTA
  - Dynamic bidirectional band/mode button updates

- **UI/UX Improvements:**
  - CAT page card/sub-card styling
  - Settings page enhancements
  - About page improvements
  - WiFi help popup styling
  - Frequency display consistency improvements

- **Bug Fixes and Enhancements:**
  - FT8 power read-back verification
  - Idle status task improvements for USB power detection
  - Power setting fixes (PR #78)
  - Version string build improvements

- **Documentation and Infrastructure:**
  - AI documentation directory structure
  - README updates
  - Cursor documentation

---

## Major Feature Additions

### 1. Elecraft KH1 Radio Support (PR #77)

**Commits:**
- `b9b9253` (2026-01-11) - Adding support for the Elecraft KH1 (#77) by WR7D
- `7946d8f` (2026-01-11) - Release build for initial KH1 support
- `09f5ab4` (2026-01-11) - Add attribution to Wayne and WR7D for adding KH1 support
- `d0fee64` (2026-01-11) - Attribution change and official version update
- `6f8fe27` (2026-01-15) - Power-set-fix (#78) - Removed power setting functionality, Min power button changes radio to LOW mode

**Files Changed:**
- `include/kx_radio.h` - Added `RadioType::KH1` enum value and KH1-specific methods
- `src/kx_radio.cpp` - Added KH1 detection, frequency/mode reading, power setting, and CAT command handling
- `src/handler_atu.cpp` - KH1-specific ATU handling
- `src/handler_cat.cpp` - KH1-specific CAT command handling
- `src/handler_frequency.cpp` - KH1 frequency handling
- `src/handler_ft8.cpp` - KH1 FT8 transmission support with FO command
- `src/handler_mode_bandwidth.cpp` - KH1 mode and bandwidth handling
- `src/handler_status.cpp` - KH1 status reading via DS1 display parsing
- `src/handler_time.cpp` - KH1 time setting (no seconds support, different menu/button functions)
- `src/web/about.html` - Updated radio type display
- `src/web/cat.js` - KH1 support additions
- `src/web/settings.html` - KH1-related settings

**Key Implementation Details:**
- KH1 uses different CAT command set compared to KX2/KX3
- KH1 detection via baud rate (9600) and different OM command response
- Frequency and mode reading via DS1 display parsing (different from KX2/KX3)
- Power control limited to two preset levels (LOW/HIGH)
- FT8 transmission uses FO command for frequency offset (00-99 Hz range)
- Time setting uses MNTIM and SW4T commands (different from KX2/KX3)
- No CW keyer memories support on KH1

**Documentation:**
- `Docs/AI-docs/feature-branch-chats/PR77-WR7D-KH1-support/CR_PR77.md` - Code review document with detailed analysis

**Impact:** This is a **major feature addition** that enables SOTACAT to work with the Elecraft KH1 radio. The implementation required significant changes to the radio communication layer and multiple handlers.

---

### 2. WebSDR Integration

**Commits:**
- `dc02bd5` (2025-10-04) - Add WebSDR integration feature to SOTACAT: tune the Elecraft and the WebSDR in a separate Browser tab

**Files Changed:**
- `include/settings.h` - Added WebSDR settings structure
- `src/handler_settings.cpp` - WebSDR settings handler
- `src/web/main.js` - WebSDR integration JavaScript (79 lines added)
- `src/web/settings.html` - WebSDR configuration UI
- `src/web/settings.js` - WebSDR settings management (79 lines added)
- `src/webserver.cpp` - WebSDR endpoint registration
- `README.md` - Documentation updates
- `firmware/webtools/manifest.json` - Version bump
- `include/build_info.h` - Version bump

**Key Features:**
- Allows users to configure WebSDR/KiwiSDR URLs
- Opens WebSDR in separate browser tab synchronized with Elecraft radio frequency
- Enables simultaneous monitoring on WebSDR while operating the radio

**Impact:** **Medium** - Adds useful feature for operators who want to monitor their signal on WebSDR while transmitting.

---

### 3. SDR Mobile Launch Control

**Commits:**
- `d71085a` (2025-10-04) - Add SDR mobile launch control and adjust frequency display units to be consistent between SOTA and POTA (KHz)

**Files Changed:**
- `include/settings.h` - SDR mobile settings
- `src/handler_settings.cpp` - SDR mobile handler
- `src/web/main.js` - SDR mobile launch functionality (185 lines modified)
- `src/web/settings.html` - SDR mobile configuration UI
- `src/web/settings.js` - SDR mobile settings management
- `src/web/sota.html` - Frequency display unit consistency
- `src/web/sota.js` - Frequency display updates
- `firmware/webtools/manifest.json` - Version bump
- `include/build_info.h` - Version bump

**Key Features:**
- Mobile-friendly SDR launch control
- Consistent frequency display units (KHz) across SOTA and POTA pages
- Enhanced mobile user experience for SDR integration

**Impact:** **Medium** - Improves mobile usability and display consistency.

---

### 4. Time Interval Selectors and POTA Time Filter

**Commits:**
- `96e41fd` (2025-10-05) - Added 15m and 30m time interval selectors. Add time filter to POTA to match SOTA. Improved SOTA Watch API rate limiting cache code

**Files Changed:**
- `src/web/main.js` - Time interval selector logic (34 lines added/modified)
- `src/web/pota.html` - Time interval selector UI (24 lines added)
- `src/web/pota.js` - POTA time filtering (31 lines modified)
- `src/web/sota.html` - Time interval selector updates
- `src/web/sota.js` - SOTA time filtering improvements (57 lines added/modified)
- `firmware/webtools/manifest.json` - Version bump
- `include/build_info.h` - Version bump

**Key Features:**
- Added 15-minute and 30-minute time interval selectors (in addition to existing intervals)
- Added time filter to POTA page to match SOTA functionality
- Improved SOTA Watch API rate limiting cache implementation

**Impact:** **Medium** - Enhances filtering capabilities and improves API efficiency.

---

### 5. Dynamic Bidirectional Band/Mode Button Updates

**Commits:**
- `1ab7688` (2025-09-27) - Dynamically update band and mode buttons bidirectionally. Ensure proper sideband when changing bands and radio is in SSB mode

**Files Changed:**
- `src/web/cat.html` - Band/mode button UI updates (24 lines modified)
- `src/web/cat.js` - Bidirectional update logic (196 lines modified)
- `src/web/style.css` - Button styling updates (16 lines added)
- `firmware/webtools/manifest.json` - Version bump
- `include/build_info.h` - Version bump

**Key Features:**
- Band and mode buttons update dynamically based on radio state
- Bidirectional synchronization between UI and radio
- Proper sideband handling when changing bands in SSB mode

**Impact:** **Medium** - Improves user experience by keeping UI in sync with radio state.

---

## UI/UX Improvements

### 6. CAT Page Card/Sub-Card Styling

**Commits:**
- `08ac428` (2025-09-28) - Update formatting of CAT page to use the card and sub-card style used by Settings and About pages

**Files Changed:**
- `src/web/cat.html` - Applied card/sub-card styling structure
- `src/web/style.css` - Styling updates

**Impact:** **Low** - Consistency improvement for UI design.

---

### 7. Settings Page Styling Enhancements

**Commits:**
- `eab76a3` (2025-09-27) - Enhance Settings page styling
- `82c8ddf` (2025-09-28) - Remove battery voltage display - Update settings styles and formatting

**Files Changed:**
- `src/web/settings.html` - Styling improvements
- `src/web/settings.js` - Battery voltage display removal
- `src/web/style.css` - CSS updates

**Impact:** **Low** - UI polish and cleanup.

---

### 8. About Page Improvements

**Commits:**
- `ebd67cf` (2025-09-28) - Apply the settings.html card and sub-card styling to the about.html page
- `43f4ee8` (2025-09-27) - Move version info from header to about page
- `a52c201` (2025-09-28) - Update version information display on the About page
- `ca3bdf8` (2025-08-13) - Improve margins on About page (by Jeff Kowalski)

**Files Changed:**
- `src/web/about.html` - Styling and layout updates
- `src/web/about.js` - Version display logic
- `src/web/index.html` - Header cleanup (version info moved)

**Impact:** **Low** - UI consistency and information organization.

---

### 9. WiFi Help Popup Styling

**Commits:**
- `db660f7` (2025-09-27) - Enhance WiFi help popup styling. Fix cherry-pick merge errors

**Files Changed:**
- `src/web/style.css` - WiFi popup styling
- Related HTML/JS files

**Impact:** **Low** - UI polish.

---

### 10. Frequency Display and Button Improvements

**Commits:**
- `72148c2` (2025-09-27) - Updated frequency change buttons and instruction text
- `33e0697` (2025-09-27) - Adjust frequency value font size to match af48bc0841f341f29c25e9557c4289664d32016c
- `4dc6813` (2025-09-27) - Compressed layout of GPS Location entry and fixed bug with Clear not updating textbox
- `a331ecf` (2025-09-28) - Minor UI layout changes
- `f46753c` (2025-09-28) - Swap row order in SOTA table settings header to match POTA

**Files Changed:**
- `src/web/cat.html` - Frequency button updates
- `src/web/cat.js` - Frequency change logic
- `src/web/settings.html` - GPS layout compression
- `src/web/sota.html` - Header row order
- `src/web/style.css` - Font size adjustments

**Impact:** **Low** - UI improvements and bug fixes.

---

## Bug Fixes and Enhancements

### 11. FT8 Power Read-Back Verification

**Commits:**
- `586baf4` (2025-10-01) - Ensure FT8 power is at 10 watts with read-back

**Files Changed:**
- `src/handler_ft8.cpp` - Added power read-back verification (11 lines modified)
- `firmware/webtools/manifest.json` - Version bump
- `include/build_info.h` - Version bump

**Key Changes:**
- Added verification that FT8 power is correctly set to 10 watts
- Reads back power setting to confirm it was applied

**Impact:** **Medium** - Ensures FT8 transmission power is correct.

---

### 12. Idle Status Task USB Power Detection

**Commits:**
- `e03c177` (2025-10-01) - Update idle_status_task to prevent shutdown during USB power detection and adjust LED blink behavior accordingly

**Files Changed:**
- `src/idle_status_task.cpp` - USB power detection logic (7 lines modified)

**Key Changes:**
- Prevents shutdown during USB power detection
- Adjusts LED blink behavior for USB power state

**Impact:** **Medium** - Prevents unintended shutdowns during power detection.

---

### 13. Version String Build Improvements

**Commits:**
- `311d88b` (2025-09-28) - Only update version strings on real builds, not other PIO tasks

**Files Changed:**
- Build scripts - Version string update logic

**Impact:** **Low** - Build process improvement.

---

### 14. HTTPS Geolocation Service Change

**Commits:**
- `e168b1d` (2025-09-27) - Change IP address geolocation to a service that supports HTTPS for browsers that require it. Fixed bug with cherry-pick from KC6X's moving of SOTAMAT button from SOTA/POTA pages to CAT page

**Files Changed:**
- `src/web/main.js` - Geolocation service URL update

**Impact:** **Low** - Browser compatibility improvement.

---

## Documentation and Infrastructure

### 15. AI Documentation Directory Structure

**Commits:**
- `f5273f6` (2026-01-11) - Created a place to hold AI generated .md documents for future reference
- `52de9f1` (2026-01-18) - Cursor Readme

**Files Changed:**
- `Docs/AI-docs/feature-branch-chats/` - New directory structure
- `docs-cursor/README.md` - Cursor documentation (125 lines)

**Impact:** **Low** - Documentation organization.

---

### 16. README Updates

**Commits:**
- `839a948` (2025-10-04) - Update README.md to clarify availability of pre-made SOTACAT modules and provide purchase link for Justin K5EM's products

**Files Changed:**
- `README.md` - Added information about pre-made modules and K5EM store link

**Impact:** **Low** - Documentation update.

---

### 17. Build Asset Management

**Commits:**
- `2c9f4dd` (2026-01-23) - Ignore dynamically created *.*gz web assets
- `894b1bf` (2026-01-18) - Merge branch 'main' of github.com:SOTAmat/SOTAcat

**Files Changed:**
- `.gitignore` - Added pattern for dynamically created gzip assets

**Impact:** **Low** - Build process cleanup.

---

## Architecture and Code Structure Differences

### Lockable vs TimedLock

**Key Difference:** The `main` branch uses a `Lockable` base class pattern, while `kowalski/wip` uses a `TimedLock` composition pattern. This affects how radio locking is implemented:

- **main:** Uses `Lockable` base class with `TIMED_LOCK_OR_FAIL` macro
- **kowalski/wip:** Uses `TimedLock` composition with different locking semantics

**Files Affected:**
- `include/lockable.h` - Present in main, different approach in kowalski/wip
- `include/timed_lock.h` - Present in kowalski/wip, removed in main
- `src/lockable.cpp` - Present in main
- `src/kx_radio.cpp` - Different locking implementations

---

### Web UI Architecture

**Major Differences:**
- **main:** Separate pages for SOTA (`sota.html/js`) and POTA (`pota.html/js`)
- **kowalski/wip:** Unified chase page (`chase.html/js`) with Spot/QRX pages

**Files Present in main but not kowalski/wip:**
- `src/web/sota.html` / `src/web/sota.js`
- `src/web/pota.html` / `src/web/pota.js`

**Files Present in kowalski/wip but not main:**
- `src/web/chase.html` / `src/web/chase.js`
- `src/web/chase_api.js`
- `src/web/spot.html` / `src/web/spot.js`
- `src/web/qrx.html` / `src/web/qrx.js`
- `src/web/bandprivileges.js`

---

## Files Added in main (Not in kowalski/wip)

1. `Docs/AI-docs/feature-branch-chats/PR77-WR7D-KH1-support/CR_PR77.md` - KH1 code review
2. `docs-cursor/README.md` - Cursor documentation
3. `src/web/sota.html` / `src/web/sota.js` - SOTA page
4. `src/web/pota.html` / `src/web/pota.js` - POTA page
5. `include/lockable.h` / `src/lockable.cpp` - Lockable implementation
6. `docs/geolocation/bridge.js` / `docs/geolocation/index.html` - Geolocation bridge (removed in kowalski/wip)

---

## Files Removed in main (Present in kowalski/wip)

1. `src/web/chase.html` / `src/web/chase.js` - Unified chase page
2. `src/web/chase_api.js` - Chase API
3. `src/web/spot.html` / `src/web/spot.js` - Spot page
4. `src/web/qrx.html` / `src/web/qrx.js` - QRX page
5. `src/web/bandprivileges.js` - Band privileges
6. `src/handler_volume.cpp` - Volume handler (removed in main)
7. `include/timed_lock.h` - TimedLock header
8. `test/integration/` - Integration test suite (removed in main)
9. `test/mock_server/` - Mock server (removed in main)
10. `Makefile` - Build convenience Makefile (removed in main)

---

## Recommendations for Merging

### High Priority (Must Merge)

1. **KH1 Radio Support** - This is a major feature that significantly expands hardware compatibility. The implementation is well-documented and includes attribution.

2. **WebSDR Integration** - Useful feature that enhances the user experience without major architectural changes.

3. **FT8 Power Read-Back** - Important bug fix that ensures correct transmission power.

### Medium Priority (Should Merge)

4. **Time Interval Selectors** - Enhances filtering capabilities.

5. **SDR Mobile Launch Control** - Improves mobile user experience.

6. **Dynamic Band/Mode Updates** - Improves UI responsiveness and user experience.

7. **Idle Status Task USB Power Detection** - Prevents unintended shutdowns.

### Low Priority (Consider Merging)

8. **UI/UX Improvements** - Various styling and layout improvements for consistency.

9. **Documentation Updates** - README and documentation improvements.

10. **Build Process Improvements** - Version string and asset management improvements.

### Architecture Considerations

- **Locking Mechanism:** The `main` branch uses `Lockable` while `kowalski/wip` uses `TimedLock`. This will require careful merging to maintain consistency.

- **Web UI Structure:** The branches have fundamentally different web UI architectures (separate SOTA/POTA pages vs unified chase page). Merging will require choosing one approach or creating a hybrid.

---

## Statistics

- **Total Commits:** 33 commits in main not in kowalski/wip
- **Files Changed:** 88 files with 6,658 insertions and 13,537 deletions (net reduction due to removal of test infrastructure and unified chase page)
- **Date Range:** August 5, 2025 - January 23, 2026
- **Major Features:** 5 (KH1 support, WebSDR, SDR mobile, time filters, dynamic updates)
- **Bug Fixes:** 4 (FT8 power, USB power detection, version strings, geolocation)

---

## Notes

- Some commits in main were authored by Jeff Kowalski but were cherry-picked or merged into main after the branch split.
- The branch split occurred at commit `82d567a` ("Remove submodule esp32-smbus, rely on pio lib_deps").
- The `kowalski/wip` branch has significantly more commits (150+ commits) with extensive UI refactoring, test infrastructure, and modern web development practices.
- The `main` branch has focused more on hardware support (KH1) and specific feature additions.

---

*Document generated on January 23, 2026*
