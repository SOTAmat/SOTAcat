# ab6d/jk2main Integration Follow-up

Last updated: 2026-02-01
Scope: confirm kowalski/wip parity after ab6d/jk2main merge into origin/main, and list follow-up actions.

---

## Current state (origin/main)

- ab6d/jk2main has been merged into origin/main (merge commit dddb72f).
- Driver architecture and KH1 support are in main.
- The review below focuses only on remaining kowalski/wip deltas that should still be ported.

---

## Conceptually incorporated from kowalski/wip

- RUN tab rename and run page exist in main (UI labels and navigation).
- Connection loss overlay and polling timeouts are present.
- QRX is the default tab on load.
- Location-based references, Nearest SOTA, and PoLo setup button are present.
- Tune target placeholders use {} delimiters.
- WiFi .200 pinning on Android hotspot and AP client RSSI reporting are present.
- Documentation tree exists under Documentation/ and README is modernized.

---

## Missing from origin/main (needs porting)

### 1) Battery time display humanization
Files: `src/web/main.js`, `src/web/style.css`
Action:
- Update `formatBatteryTime()` to match kowalski/wip behavior:
  - arrow uses "charging" and "discharging" types,
  - minutes-only for <= 98 minutes,
  - rounded hours for larger values,
  - remove the "99+" format.
- Update `updateBatteryInfo()` calls to pass "charging"/"discharging".
- If matching wip exactly, remove the `#battery-time` CSS block (verify if desired).

### 2) Refresh label text and no-wrap
Files: `src/web/chase.html`, `src/web/chase.js`, `src/web/style.css`
Action:
- Change "Last refresh ..." to "Refreshed ..." in HTML and JS.
- Add `white-space: nowrap;` to `#last-refresh-time`.

### 3) CSS class refactor for UI toggles
Files: `src/web/chase.js`, `src/web/settings.js`, `src/web/style.css`
Action:
- Replace `row.style.cursor = "pointer"` with `row.classList.add("cursor-pointer")`.
- Replace `row.style.display` toggles with `hidden` class add/remove.
- Replace `document.body.style.overflow` toggles with `overflow-hidden` class.
- Add missing CSS utilities (`.cursor-pointer`, `.overflow-hidden`) if absent.
- Keep existing `hidden` and `collapsed` classes.

### 4) clangd false positives in timed_lock.h
Files: `include/timed_lock.h`
Action:
- Wrap `RADIO_LOCK_TIMEOUT_*` constants with:
  `NOLINTBEGIN(clang-diagnostic-unused-const-variable)` and `NOLINTEND(...)`.
- Update `TIMED_LOCK_OR_FAIL` macro to avoid initializer-in-if pattern.

### 5) Documentation cleanup (partial)
Files: `Documentation/Hardware.md`, `Documentation/Hardware/`, `docs/README.md`
Action:
- Move hardware PDFs into `Documentation/Hardware/`.
- Update links in `Documentation/Hardware.md` to new path.
- Add `docs/README.md` sentinel describing the geolocation helper (create `docs/` if missing).
- Consider removing `docs-cursor/README.md` if it is obsolete.

### 6) README heading polish (optional)
Files: `README.md`
Action:
- Convert the two hero headings to `###` and remove extra blank lines in "In the Field" section to match wip.

---

## Intentionally NOT ported from kowalski/wip

- Do not remove KH1 references from the About page. origin/main supports KH1.

---

## Future session checklist (apply missing items)

1. Create a fresh branch from origin/main.
2. Apply the missing items above in order; keep changes minimal and scoped.
3. Update any affected UI tests (`test/integration/test_ui.py`, `test/unit/test_qrx.js`) if behavior changes.
4. Re-run a diff against kowalski/wip to confirm parity.
5. Share changes for review; do not merge without review.
