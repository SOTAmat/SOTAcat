# Code Review: PR #77 (KH1 support)

Context and sources:
- PR diff fetched from https://github.com/SOTAmat/SOTAcat/pull/77
- KH1 Programmer's Ref (rev A1) and email notes you provided (FO command, HK behavior, exit via SW4T on TUNE).

This review focuses on correctness, protocol compliance, and runtime risks for KH1 FT8 support.

## Key Findings (ordered by severity)

### High
1) KH1 FT8 FO command length is wrong during tone generation
- In `src/handler_ft8.cpp:127` and `src/handler_ft8.cpp:129`, KH1 tone sending uses `FO%02ld;` but writes a fixed length of 5 bytes. If the offset is two digits plus terminator (e.g. `FO07;`), length is 5; but when offset reaches 10-99, length is still 5 and will cut off `;` or include garbage if the buffer contains earlier content. If offset could be 3 digits (or negative), the truncation is worse. This risks malformed CAT commands and tone timing instability.
- Fix: write `strlen(command)` and guarantee `command` is always properly formatted and null-terminated.

2) FO99 exit command length mismatch
- `uart_write_bytes(UART_NUM, "FO99;;", strlen("FO99;"))` in `src/handler_ft8.cpp:222` sends 5 bytes of a 6-byte string (extra `;` in literal). The command on the wire is inconsistent; it will omit the final `;` or include an extra `;` depending on UART buffer state. This may fail to exit FO mode as intended.
- Fix: use a single literal `"FO99;"` and write `strlen("FO99;")`.

### Medium
3) FO offset units appear wrong
- New KH1 FO command expects `FOnn;` where `nn` is 00-99, offset in 1 Hz increments, and enables 1 Hz VFO display. The implementation uses `(eased_frequency - base_frequency)` directly in `src/handler_ft8.cpp:127`, which is in Hz and can exceed 99 by orders of magnitude (FT8 tones are 0-~2500 Hz). This will produce invalid `FOnn;` values.
- Likely intended: use (tone_frequency - base_frequency)/100? or clamp to 0-99? But per the note, nn is 00-98 and offsets the VFO frequency directly by nn Hz. For FT8, you need offsets in Hz (0-2500). That cannot fit in 00-99. So KH1 FO command alone is insufficient to represent FT8 tones unless the baseFreq is adjusted every tone or another command supports a larger offset.
- Implication: current KH1 FT8 TX path cannot generate the full FT8 tone set correctly with FO limited to 0-99 Hz. This is a functional blocker unless the real FO supports larger offsets or an alternate KH1 command exists.

4) KH1 time-setting commands likely missing terminators
- `put_to_kx_command_string("MNTIM", 1);` in `src/handler_time.cpp:165` and `"SW4T"` in `src/handler_time.cpp:181` lack `;` terminators. KH1 CAT commands generally end with `;` (per Elecraft conventions). Missing terminators can cause no-ops or concatenation issues.
- Fix: add `;` to these command strings.

### Medium
5) KH1 display parsing risks (DS1 indexing)
- KH1 `DS1` parsing assumes fixed string positions for frequency and mode: `src/kx_radio.cpp:497` and `src/kx_radio.cpp:523`, plus `src/handler_status.cpp:30` for TX state. Without validation of the DS1 response length and format, this can read garbage or out-of-bounds if display contents differ (e.g., different modes, error states, or firmware changes).
- Fix: validate length and expected positions; or parse based on known separators rather than fixed offsets.

### Low
6) `set_kh1_power` compares strings with `!strcmp(...) == 0` (logic bug)
- `if (!strcmp(test_char, power_level > 0 ? "NORM" : "TX T") == 0)` in `src/kx_radio.cpp:571` is confusing and likely wrong due to precedence. `strcmp` returns 0 on equal; `!strcmp(...)` yields 1 on equal; then `== 0` flips it. The current code toggles when the strings match rather than when they do not.
- Fix: use `if (strcmp(test_char, expected) != 0)`.

7) KH1 TUNE exit path
- KH1 notes say TUNE (equiv CW key-down) must exit via `SW4T;`. The code uses `HK1;` and `HK0;` for FT8 (key down/up) in `src/handler_ft8.cpp:194` and `src/handler_ft8.cpp:220`, not TUNE. If any other path uses TUNE or equivalent, ensure it exits via `SW4T;` on KH1. The PR already uses `SW4T;` for message bank and time menu exit, but not for TUNE explicitly.

## Protocol / Functional Considerations

- FO command range: `FOnn;` supports 00-98; 99 exits. This is not enough for the 0-2500 Hz FT8 audio offset unless the approach changes. A workable approach might be:
  - Set VFO frequency for each tone (FA) and avoid FO, but KH1 VFO changes are only 10 Hz resolution.
  - Use FO for fine 0-98 Hz sub-offset and change FA for coarse 10 Hz steps each tone (may be too slow and create jitter).
  - Use a new KH1 command (if exists) for larger Hz offsets; your note mentions "new KH1 commands missing from the document for fine grained frequency control at 1 Hz precision." If those support full FT8 offsets, they should be used instead of FO.

Given this, actual FT8 TX on KH1 with 1 Hz tone accuracy is not fully supported by the current implementation unless a larger-range 1 Hz offset command exists and is used.

## Confidence on FT8 viability with KH1

With the constraints in the provided documentation, I'm not confident FT8 can be transmitted correctly across the full 6.25 Hz tone spacing using only `FOnn;` (00-98). You need either:
- A command that sets 1 Hz offset across at least 0-2500 Hz (or wider), or
- A way to rapidly adjust VFO in 10 Hz steps combined with FO for 0-98 Hz, with timing tight enough not to disrupt FT8 tone timing.

Given FT8's strict 160 ms symbol timing, repeated VFO adjustments at 10 Hz increments in-band are likely too slow and introduce jitter. So unless the "new KH1 commands" provide a wider 1 Hz offset, FT8 TX fidelity is at risk.

## Suggested Fixes / Questions to Resolve

1) Clarify the new KH1 command for fine 1 Hz control:
- Name, valid range, and response latency. If it supports offsets >99 Hz, replace FO usage in FT8 tone generation with that command.

2) If FO remains the only 1 Hz mechanism, adjust strategy:
- For each tone, compute `coarse = floor(offset_hz / 100) * 100` using FA (10 Hz resolution) and `fine = offset_hz % 100` using FO. This requires fast FA writes and might still be too slow or jittery.

3) Fix FO write length and FO99 exit command.

4) Add command terminators for `MNTIM;` and `SW4T;` if required by KH1.

5) Harden DS1 parsing: check response length, validate expected characters, and handle blanks safely.

## Files referenced
- `src/handler_ft8.cpp`
- `src/kx_radio.cpp`
- `src/handler_time.cpp`
- `src/handler_mode.cpp`
- `src/handler_status.cpp`

---
If you want, I can draft a patch that fixes the high/medium issues and add guards for DS1 parsing once you confirm the full KH1 command set for fine-grained 1 Hz control.
