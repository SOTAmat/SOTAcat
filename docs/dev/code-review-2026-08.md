# Code Review Backlog — August 2026

Deep review of the client (`src/web` HTML/JS) and backend (`include/*.h`, `src/*.cpp`),
run 2026-08-23. Multi-agent review: 8 finder angles per side, candidates deduplicated,
top correctness claims adversarially verified by independent agents, mechanical claims
spot-checked against source.

This document is the **plan and evidence archive**. The **burndown lives in GitHub
issues** (milestone: `2026-08 code review`): one issue per batch below. No PRs —
we commit as a direct contributor, so each fix branch merges to main locally and
its commit body carries `Fixes #N` plus the finding IDs (e.g. `fix: CR-01 ...`),
which closes the issue when the commit reaches main. With no review gate, the
verification bar is doubled: every batch fully retests on every tier that exists —
host unit suite, firmware build, integration/UI (Playwright), and real hardware via
OTA — and the diff is reviewed before anything merges. This doc is updated only to record fixing commit
hashes in the Status column.

## Scoring

Each finding scored 1–3 on four dimensions:

- **Sev** (severity): 3 = crash/data corruption, 2 = wrong behavior, 1 = hygiene/waste
- **Ease**: 3 = small localized fix, 2 = moderate, 1 = refactor/design work
- **Iso** (isolation): 3 = independent, 2 = shares files with other findings, 1 = needs a refactor vehicle
- **Imp** (real-world user impact): 3 = routine use, 2 = common situations, 1 = rare/invisible
  — *Imp values are the reviewer's estimate; Q adjusts before ranking.*

**Rank** = Sev × Imp, tiebreak by Ease. **Iso** drives batching only.

Verification status: **V** = adversarially verified, **S** = spot-checked code facts,
**R** = reported by finder only (verify before fixing).

## Master table

| ID    | Finding                                                                                        | Where                                          | Ver       | Sev | Ease | Iso | Imp | Batch     | Status |
|-------|------------------------------------------------------------------------------------------------|------------------------------------------------|-----------|-----|------|-----|-----|-----------|--------|
| CR-01 | DATA-REV mode panics device (mode map index ≠ enum)                                            | handler_mode.cpp:23-49                         | V         | 3   | 3    | 3   | 2   | B1        | fixed 726c25b |
| CR-02 | Chunk-send fall-through: silent truncation as HTTP 200, httpd stalls                           | webserver.cpp:171-212                          | V         | 3   | 3    | 3   | 2   | B3        | fixed c214c2b |
| CR-03 | UART retry gives 2 of 3 attempts; busy `?;` recurses unboundedly                               | kx_radio.cpp:86-92,386                         | V         | 3   | 2    | 3   | 2   | B2        | fixed 3c7576b |
| CR-04 | qrx nearest-SOTA search loops forever on empty results at 100 km                               | qrx.js:170-217                                 | V         | 2   | 3    | 2   | 2   | B5        | fixed fd2750f |
| CR-05 | FCC table grants N/T DATA on 80/40/15 CW-only segments                                         | bandprivileges.js:59,74,96                     | V         | 2   | 1    | 3   | 2   | B6 (#107) | open   |
| CR-06 | 60 m channel 5403.5–5406.5 outside BAND_PLAN 5.3–5.4                                           | main.js:398, bandprivileges.js:70              | V         | 2   | 2    | 3   | 1   | B6 (#107) | open   |
| CR-07 | SET during CW keyer TX: 202 accepted then silently dropped                                     | radio_set_http.cpp:76                          | V         | 2   | 3    | 3   | 2   | B4        | fixed 63c5260 |
| CR-08 | tuneTargets POST truncates bracketed/IPv6 URLs into NVS                                        | handler_settings.cpp:632                       | V         | 2   | 3    | 2   | 1   | B11       | open   |
| CR-09 | Keyer message unbounded vs 128 B buffer; fetchQuiet swallows errors                            | main.js:795-802, webserver.h:69                | V         | 2   | 2    | 3   | 2   | B10       | open   |
| CR-10 | Raw spot modes (JT65, OTHER, "") passed verbatim to mode PUT                                   | chase_api.js:196-208, main.js:1131             | V         | 2   | 2    | 2   | 2   | B7        | open   |
| CR-11 | Legacy stored tab names (wrx/cat/sota/pota) → alert + blank on load                            | main.js:1119-1127                              | V         | 2   | 3    | 2   | 2   | B9        | open   |
| CR-12 | Run-tab appear/leave race (unawaited hooks, no re-entrancy guard)                              | run.js:1649-1676, main.js:1272                 | V         | 2   | 2    | 2   | 2   | B9        | open   |
| CR-13 | PoLo spot button enabled with null frequency; failure is log-only                              | run.js:1377,1475-1483                          | V         | 2   | 3    | 2   | 1   | B9        | open   |
| CR-14 | Spot enrichment dead: reads `sig_ref`, only `sig_refs` exists                                  | chase_api.js:280                               | V         | 2   | 2    | 2   | 2   | B7        | open   |
| CR-15 | Coordinate 0 treated as "no location" (falsy check on numbers)                                 | qrx.js:192, main.js:1551                       | V         | 2   | 3    | 2   | 1   | B5        | fixed fd2750f |
| CR-16 | Manual version check returns before timestamp/retry bookkeeping                                | main.js:1831-1877                              | V         | 2   | 3    | 2   | 1   | B9        | open   |
| CR-17 | "Refreshed 0:00 ago" after cache restore (timestamp never set)                                 | chase.js:1217-1232                             | V         | 2   | 3    | 2   | 2   | B7        | open   |
| CR-18 | Mid-edit VFO poll stomps display (no edit-mode suppression)                                    | run.js:1016-1020                               | V         | 1   | 2    | 1   | 2   | B8        | open   |
| CR-19 | run.js duplicates main.js VFO polling stack minus its guards                                   | run.js:1016,1092,865 vs main.js:810+           | V         | 2   | 1    | 1   | 2   | B8        | open   |
| CR-20 | Debounce `finally` nulls shared timer handle without comparison                                | run.js:895-919                                 | V(plaus.) | 1   | 3    | 1   | 1   | B8        | open   |
| CR-21 | CW macros wiped via offline-at-load fallback path                                              | settings.js:463-475                            | V(plaus.) | 2   | 2    | 2   | 1   | B14       | open   |
| CR-22 | visibilitychange refresh no-ops if a controller was in flight                                  | main.js:1367-1374                              | V(plaus.) | 1   | 2    | 2   | 1   | B9        | open   |
| CR-23 | FT8 guard: duplicated struct, defeated by manual clears, unguarded tail                        | handler_ft8.cpp:840,954,986-1098               | V         | 1   | 2    | 3   | 1   | B12       | open   |
| CR-24 | MAX17260 learned params never persisted; dead write_learned_params                             | max17260.cpp:246,316                           | S         | 2   | 2    | 3   | 2   | B17       | open   |
| CR-25 | radio_park drain_all/DRAINED/count unreachable outside tests                                   | radio_park.h:130, radio_set_http.cpp:48        | S         | 1   | 3    | 3   | 1   | B19       | fixed 82c7e52 |
| CR-26 | `m_driver` can never be null; 22 constant-true guards                                          | kx_radio.cpp:122,141,532+                      | S         | 1   | 2    | 3   | 1   | B19       | fixed 82c7e52 |
| CR-27 | Always-true `starts_with(uri,"/")` + unreachable ESP_FAIL tail                                 | webserver.cpp:294-299                          | S         | 1   | 3    | 2   | 1   | B19       | fixed 82c7e52 |
| CR-28 | `#if 0` debug-wait block rots in setup()                                                       | setup.cpp:80                                   | S         | 1   | 3    | 3   | 1   | B19       | fixed 82c7e52 |
| CR-29 | Dead EASE_STEPS define + orphan doc for deleted function                                       | handler_ft8.cpp:337                            | S         | 1   | 3    | 2   | 1   | B19       | fixed 82c7e52 |
| CR-30 | SC_TASK_PRIORITY_HIGH unused                                                                   | globals.h:18                                   | S         | 1   | 3    | 3   | 1   | B19       | fixed 82c7e52 |
| CR-31 | JS dead: getRadioModes/radioCanTransmit; 1-caller wrapper                                      | main.js:475-492                                | S         | 1   | 3    | 2   | 1   | B19       | fixed 82c7e52 |
| CR-32 | Throwaway socket created/configured/closed every 60 s                                          | wifi.cpp:794-820                               | S         | 1   | 3    | 3   | 1   | B18       | open   |
| CR-33 | Every API reply sends `Connection: close` vs configured keep-alive                             | webserver.h:111,125 vs webserver.cpp:328       | S         | 2   | 2    | 3   | 2   | B18       | open   |
| CR-34 | 16-sample ADC average computed and discarded when MAX17260 present                             | battery_monitor.cpp:218                        | S         | 1   | 3    | 2   | 1   | B17       | open   |
| CR-35 | mdns forced to DEBUG log level in every build                                                  | main.cpp:9                                     | S         | 1   | 3    | 3   | 1   | B19       | fixed 82c7e52 |
| CR-36 | "above 80%" comments vs BATTERY_SHUTOFF_PERCENTAGE 70 (×2)                                     | setup.cpp:38, idle_status_task.cpp:85          | S         | 1   | 3    | 2   | 1   | B17       | open   |
| CR-37 | REPORTING_TIME_SEC=10 is a divisor; real cadence 50 s                                          | battery_monitor.cpp:12                         | S         | 1   | 3    | 2   | 1   | B17       | open   |
| CR-38 | REBOOT_DELAY_US comment says 1.5 s, value is 2 s                                               | webserver.cpp:411                              | S         | 1   | 3    | 2   | 1   | B19       | fixed 82c7e52 |
| CR-39 | Volume doc claims 0-255 radio read; snapshot + 0-60 scale; KX/KH1 set_volume contracts diverge | handler_volume.cpp:18, radio_driver_*.cpp      | S/R       | 1   | 2    | 2   | 1   | B19       | fixed 82c7e52 |
| CR-40 | TX-power table marker on 11 dBm row; MAX_TX_PWR=52 is 13 dBm                                   | wifi.cpp:358-371                               | S         | 1   | 3    | 2   | 1   | B19       | fixed 82c7e52 |
| CR-41 | License comment lists T/G/E; UI ships N/A too; POST unvalidated                                | settings.h:44, settings.html:19-24             | S         | 1   | 3    | 2   | 1   | B19       | fixed 82c7e52 |
| CR-42 | handler_reboot TAG8 = "sc:hdl_stat" (collides with status)                                     | handler_reboot.cpp:4                           | S         | 1   | 3    | 3   | 1   | B19       | fixed 82c7e52 |
| CR-43 | MAX_TUNE_TARGETS/MAX_CW_MACROS unused in C++; JS re-hardcodes 5/8                              | settings.h:49-57, settings.js:125,457          | S         | 1   | 2    | 2   | 1   | B11       | open   |
| CR-44 | CancelRadioFT8ModeTime doc says Unix epoch; writers use boot clock; 0/1 sentinels undocumented | handler_ft8.cpp:33                             | R         | 1   | 3    | 2   | 1   | B19       | fixed 82c7e52 |
| CR-45 | JSON POST body-read block copied 6× with drift (uninit buffer, 404 vs 408)                     | handler_settings.cpp:340+                      | S         | 2   | 2    | 1   | 1   | B11       | open   |
| CR-46 | GET dance copied 5× with drift; no radio_get_via_http counterpart                              | handler_frequency.cpp:49 et al.                | R         | 2   | 1    | 1   | 1   | B15       | open   |
| CR-47 | adjust_kh1_time_component verbatim copy of KX version                                          | radio_driver_kh1.cpp:102 vs kx.cpp:27          | R         | 1   | 2    | 1   | 1   | B13       | open   |
| CR-48 | KH1 reimplements write-verify loop; no WDT feed; leaf band limit                               | radio_driver_kh1.cpp:150                       | R         | 2   | 2    | 1   | 1   | B13       | open   |
| CR-49 | 8 hand-rolled DS fixed-offset extractions, inconsistent buffers                                | radio_driver_kh1.cpp:25+                       | R         | 1   | 2    | 1   | 1   | B13       | open   |
| CR-50 | settings.js re-implements main.js loaders; caches left stale                                   | settings.js:22,133,463                         | R         | 2   | 2    | 1   | 1   | B14       | open   |
| CR-51 | wait_for_tx_end: TQ every 100 ms × 60 s, results discarded                                     | radio_driver_kx.cpp:222                        | R         | 1   | 2    | 2   | 1   | B16       | open   |
| CR-52 | SET_VOLUME discards driver-known level; forces re-read round trips                             | radio_service.cpp:290, radio_driver_kx.cpp:121 | R         | 1   | 2    | 2   | 1   | B16       | open   |
| CR-53 | Three ping-and-record-health paths disagree (throttle stamp)                                   | radio_service.cpp:109,126,238                  | R         | 2   | 2    | 2   | 1   | B16       | open   |
| CR-54 | Per-command UART timeout table hardcoded in transport; KH1 DS pinned at 100 ms                 | kx_radio.cpp:302,477                           | R         | 2   | 2    | 2   | 1   | B16       | open   |
| CR-55 | Orphan generated assets (wrx/spot/nearest/pois .gz) + nohup.out in src/web                     | src/web/                                       | S         | 1   | 3    | 3   | 1   | B19       | fixed 82c7e52 |
| CR-56 | .gitignore byte-identical duplicate rules (lines 99, 116)                                      | .gitignore                                     | S         | 1   | 3    | 3   | 1   | B19       | fixed 82c7e52 |
| CR-57 | timed_lock.h usage example shows 4-arg TIMED_LOCK_OR_FAIL; macro takes 2 | timed_lock.h:41 vs :124 | S | 1 | 3 | 3 | 1 | B19 (#129) | fixed 82c7e52 |
| CR-58 | max_uri_handlers=6; exactly 3 handlers registered | webserver.cpp:292,317-321 | S | 1 | 3 | 3 | 1 | B19 (#129) | fixed 82c7e52 |

## Refuted during verification (do not fix)

- **NaN frequency poisoning** — both pollers check `response.ok`; firmware never returns
  200 with a non-numeric body on those endpoints.
- **FT8 concurrent flag stomp** (part of CR-23's original claim) — single httpd task
  serializes all handlers; the pre-acquisition clears are dead no-ops, not a race.
- **Tab migration "unrecoverable without clearing site data"** (CR-11 sub-claim) — one
  tap on any tab button self-heals; failure mode is ERR_EMPTY_RESPONSE, not 404.

## Batches → GitHub issues

One issue per batch, milestone `2026-08 code review`. Verified fixes never share a PR
with speculative refactors; batches marked *verify-first* re-confirm the finder claims
before changing code.

| Batch | Issue title | Findings | Notes |
|-------|-------------|----------|-------|
| B1 (#112) | Mode map panics on DATA-REV (crash loop) | CR-01 | critical, standalone; test: mode 9 name lookup |
| B2 (#113) | UART retry accounting and busy-recursion | CR-03 | host-testable |
| B3 (#114) | Chunk-send failure handling in asset server | CR-02 | abort on error; no fall-through |
| B4 (#115) | Return 503 for SETs during CW keyer TX | CR-07 | mirror FT8 branch using is_keyer_active() |
| B5 (#116) | qrx robustness: search loop + zero coordinates | CR-04, CR-15 | one file |
| B6 (#107) | → existing issue #107 (US-centric band plan) | CR-05, CR-06 | schema redesign; needs design |
| B7 (#117) | Chase data path: enrichment, mode normalization, refresh timer | CR-10, CR-14, CR-17 | one pipeline |
| B8 (#118) | Consolidate VFO polling onto main.js stack | CR-18, CR-19, CR-20 | refactor is the fix vehicle |
| B9 (#119) | Tab lifecycle fixes in main.js | CR-11, CR-12, CR-13, CR-16, CR-22 | migration map, re-entrancy guard, button gating |
| B10 (#120) | Surface silent HTTP failures (fetchQuiet, keyer length) | CR-09 | helper + callers |
| B11 (#121) | handler_settings: bracket bug then consolidation | CR-08, CR-45, CR-43 | fix truncation first, refactor second, enforce MAX_* |
| B12 (#122) | FT8 command-guard cleanup | CR-23 | behavior-preserving; watch the 986-1098 tail |
| B13 (#123) | Radio driver dedup (verify-first) | CR-47, CR-48, CR-49 | shared helpers for KX/KH1 |
| B14 (#124) | Settings page reuses main.js loaders (verify-first) | CR-50, CR-21 | single cache-write site |
| B15 (#125) | radio_get_via_http chokepoint (verify-first) | CR-46 | counterpart to radio_set_via_http |
| B16 (#126) | Radio service efficiency (verify-first) | CR-51, CR-52, CR-53, CR-54 | ping/health unification, timeout table to drivers |
| B17 (#127) | Battery/power coherence | CR-24, CR-34, CR-36, CR-37 | decide: implement learned-param persistence or delete |
| B18 (#128) | TCP keep-alive coherence | CR-32, CR-33 | behavior change; field-test with multiple tabs |
| B19 (#129) | Mechanical sweep (no behavior change) | CR-25–CR-31, CR-35, CR-38–CR-42, CR-44, CR-55–CR-58 | one PR; comments, dead code, tags, housekeeping |

Suggested order: B1, B3, B2, B4, B5 (rank order), then B19 (cheap, clears noise),
then B7–B11, with the verify-first refactors (B13–B16) and design work (B6) last.

## Evidence details

Condensed from the verification agents' reports. Line numbers are as of commit e72f10b
(2026-08-23); update alongside fixes if they drift.

### CR-01 — DATA-REV panic (VERIFIED, worse than first reported)
`radio_mode_t` skips 8 (`MODE_CW_R=7`, `MODE_DATA_R=9`; kx_radio.h:16-25) but
`radio_mode_map[]` packs DATA_R at index 8 and the FT8 alias `{"FT8", MODE_DATA}` at
index 9. `send_mode` indexes by enum value and asserts `map[mode].mode == mode`
(handler_mode.cpp:44-49). KX driver accepts `MD9;` (radio_driver_kx.cpp:71-77) so a
KX2/KX3 in DATA-REV feeds mode 9 → assert fires. Asserts are live in release
(`CONFIG_COMPILER_OPTIMIZATION_ASSERTIONS_ENABLE=y`, no -DNDEBUG): GET /api/v1/mode
panics and reboots; the UI polls it routinely → crash loop. KH1 exonerated (maps only
L/U/C). handler_mode.cpp:137 has the same bad index in a PUT log (cosmetic).
**Fix:** name lookup by scanning `.mode` (as handler_mode_put does), delete the
index-equals-enum assumption.

### CR-02 — chunk-send fall-through (VERIFIED)
send_file_chunked (webserver.cpp:171-212): comment promises OR semantics; guard is
`ret != ESP_ERR_HTTPD_RESP_SEND && retry >= MAX_RETRIES`. IDF maps *all* send failures
(EAGAIN and dead-socket alike) to ESP_ERR_HTTPD_RESP_SEND, so the abort is unreachable
for real failures: 4 failed attempts → falls to `sent += to_send` → next chunk.
Transient failure: 8 KB hole delivered as clean HTTP 200, zero logging. Dead socket:
4 sends + 30 ms per remaining chunk in the single httpd task before the NULL-chunk
terminator finally errors. Bonus: retrying a partially-sent chunk corrupts chunked
framing. **Fix:** abort and return on any error after (or instead of) the retry budget;
never fall through.

### CR-03 — UART retry accounting (VERIFIED)
kx_radio.cpp:86-92: `if ((busy) || --tries > 0)` then recurse with `tries - 1` —
double decrement per failed attempt: attempts = ceil((tries+1)/2); the promised 3
becomes 2. Busy path short-circuits `--tries` but still passes `tries-1` (budget IS
consumed, contradicting the comment) *and* never consults tries at all → persistent
`?;` recurses unboundedly (stack growth, 30 ms + buffer flush per frame).
put_to_kx:386 pins readback retries at 2 (outer write-verify loop does honor tries).
Link-health flip claim was overstated: threshold 3 with confirm pings still applies.
**Fix:** iterative loop with single decrement; bound the busy path; consider passing
tries to the readback.

### CR-04 — qrx infinite loop (VERIFIED)
qrx.js:170-217: ladder 0.1→1→10→50→100 saturates (all ternaries false at 100 →
`range = 100`), guard `range <= maxRange` stays true, no break/counter. Steady 200
with `[]` (ocean/plains — the case the ceiling exists for) → unbounded identical
requests to api-db2.sota.org.uk. **Fix:** break after the 100 km attempt (or `<`).

### CR-05 / CR-06 — band privileges (VERIFIED; attach to #107)
bandprivileges.js:59,74,96 give N/T `["CW","DATA"]` on 80/40/15 segments that are
CW-only for N/T (§97.301(e)); the file's own 10 m rows encode the real exception.
The flat modes×classes cross-product cannot express per-class mode limits — schema
change required. Separately, BAND_PLAN["60m"] = 5.300–5.400 MHz (main.js:398)
excludes the real 5403.5–5406.5 channel (bandprivileges.js:70 has it right):
getBandFromFrequency returns null → VFO input rejected, privileges fail.

### CR-07 — keyer exclusivity gap (VERIFIED)
send_keyer_message runs in its own task (handler_cat.cpp:203) holding the radio mutex
for the whole TX (typ. 10-15 s, cap 60 s via TX_END_TIMEOUT_MS). The SET accept point
(radio_set_http.cpp:76) checks only Ft8RadioExclusive → PUT accepted, parks 1.5 s,
returns 202 "accepted, applying", worker's timed_lock(3000) fails each 1 s wake, slot
expires unlogged at SET_APPLY_DEADLINE_MS=5000. Client never learns. Short messages
(≲4-5 s TX) squeak through. `kxRadio.is_keyer_active()` is a lock-free atomic already
used by handler_status.cpp:70. **Fix:** 503 "radio busy (keyer)" symmetric with the
FT8 branch. Stale-GET arm was overstated: refreshes are delayed, not lost.

### CR-08 — tuneTargets bracket truncation (VERIFIED)
handler_tune_targets_post (handler_settings.cpp:632) finds array end with bare
`strchr(']')`; the CW-macros sibling (~:713) depth-counts. `http://[2001:db8::1]:8073/`
truncates at the IPv6 `]`, the *smaller* fragment passes the size guard, is committed
to NVS, and served back verbatim. **Fix:** reuse the depth-counting scan (extract a
helper for both).

### CR-09 — keyer length + fetchQuiet (VERIFIED)
main.js:795-802 sendKeys URL-encodes unbounded input; firmware parameter buffer is
128 B (STANDARD_DECODE_PARAMETER, webserver.h:69) → over-long PUT fails server-side.
fetchQuiet (main.js:72-74) only catches network rejections; HTTP 4xx/5xx resolve and
are discarded — operator sees nothing, CW never goes out. **Fix:** client-side length
check against the encoded length; make fetchQuiet (or a wrapper) surface !ok.

### CR-10 — unmapped modes (VERIFIED)
chase_api.js:196-208 only uppercases; unknown modes become literal "OTHER" (or flow
raw: run.js:719-723 passes dataset.modeRaw verbatim). tuneRadioHz (main.js:1131-1168)
normalizes only SSB→LSB/USB and PUTs frequency *before* mode: radio retunes, mode PUT
fails, silently (fetchQuiet again). **Fix:** normalize to the firmware's accepted set
before PUT; surface failure.

### CR-11 — legacy tab migration (VERIFIED, corrected)
loadActiveTab (main.js:1119-1122) migrates only "spot"→"run". At-risk stored values
(same localStorage key since babd524): "sota", "pota" (deleted 2025-11-14, c965f0b),
"cat" (renamed 2026-01-05, daab06d), "wrx" (renamed 2026-01-05, 32d0b46).
saveActiveTab runs before the fetch (:1249 vs :1254) so the bad name re-persists.
Unknown asset → dynamic_file_handler returns bare ESP_FAIL → connection closed →
fetch TypeError → alert + blank content. One tap on any tab self-heals (buttons are
wired before the failing openTab). **Fix:** extend the migration map or validate
against known tabs with fallback to default.

### CR-12 — run-tab appear/leave race (VERIFIED)
openTab fires `window[onAppearingFunctionName]()` without awaiting (main.js:1272);
onSpotEntering awaits four loaders (run.js:1649-1676) — loadCwMacrosAsync always hits
the network. A tab switch inside that window runs onRunLeaving mid-setup; no
generation counter or re-entrancy guard anywhere. **Fix:** generation token or await
+ disable tab buttons during transition.

### CR-13 — PoLo silent no-op (VERIFIED)
run.js:1377 enables the button before polling starts (updateSpotButtonStates at
:1670 precedes startVfoUpdates at :1675); buildPoloSpotLink returns null on
vfoFrequencyHz null; launchPoloSpot's null branch is Log.warn only (:1475-1483) where
chase.js:678-681 alerts. **Fix:** alert or disable until frequency known.

### CR-14 — dead enrichment (VERIFIED)
chase_api.js:280 reads `spot.sig_ref`; transform (:180-261) writes only
`spothole_sig_refs`/`locationID`/`details`. uniqueRefs stays empty →
fetchReferenceDetails, referenceDetailsCache, formatReferenceDetails all unreachable.
**Fix:** decide — wire it to real keys or delete the machinery.

### CR-15 — zero coordinate (VERIFIED)
qrx.js:192 `!location.latitude || !location.longitude` on parseFloat'd numbers;
`51.4779, 0` saves fine then "Nearest SOTA" claims no location.
**Fix:** `Number.isFinite` checks.

### CR-16 — version check bookkeeping (VERIFIED)
main.js manual branch (:1831-1840) returns before the :1867-1877 tail; dead
`shouldUpdateTimestamp = true` at :1833 proves intent. Harm: re-prompt/retry noise,
not API hammering. **Fix:** run bookkeeping before returning.

### CR-17 — refresh timer lie (VERIFIED)
chase.js: sole writer of lastRefreshCompleteTime is refreshChaseJson (:1018); the
cache-restore path in onChaseAppearing (:1217-1232) renders without it → perpetual
"Refreshed 0:00 ago" (:157-160 special-cases 0). **Fix:** persist/restore the fetch
time with the cache, or show "cached".

### CR-18/19/20 — VFO polling stack (VERIFIED)
run.js getCurrentVfoState/startVfoUpdates/notifyVfoSubscribers (:1016,:1092,:865)
duplicate main.js fetchVfoState/startGlobalVfoPolling/subscriber fan-out (:810,:859,
:841) minus AbortController, timeout, localhost and pause guards; both write the same
AppState fields and iterate the same callback array. Intervals are mutually exclusive
in normal flow (correction) — cost is drift. Edit-mode has no poll suppression beyond
the 2 s post-action window (:1016-1020) vs 3 s poll period → mid-edit stomp, self-
heals next tick. setFrequency debounce `finally` nulls the shared handle without
comparing (:895-919) — plausible lost-cleanup on overlap.
**Fix (one vehicle):** run.js subscribes via subscribeToVfo/startGlobalVfoPolling;
add edit-mode suppression; capture handle locally in debounce.

### CR-21 — macros offline wipe (PLAUSIBLE)
Original malformed-200 trigger refuted (firmware always wraps `{"macros":...}`), but
any fetch rejection at Settings load leaves loadedFromDevice=false; subsequent save
paths can persist the empty fallback over device state. Verify the exact save path
before fixing (part of B14's loader consolidation).

### CR-22 — visibility resume (PLAUSIBLE)
main.js:1367-1374 refresh calls no-op if a controller was in flight when the tab
froze (each poller bails on its module-scope controller; nothing aborts on
visibilitychange). Timeout abort callbacks eventually clear — window is narrow.
**Fix (if taken):** abort+null controllers on visibilitychange before refreshing.

### CR-23 — FT8 guard hygiene (VERIFIED; race REFUTED)
CommandInProgressResetGuard defined twice verbatim (handler_ft8.cpp:840-854,
954-968); success paths store(false)+dismiss (redundant); after :983 the flag is
re-set with a plain store and :986-1098 has ~10 manually-cleared exit paths, no guard
— a future early return leaks the flag stuck-true and stalls cleanup_ft8_task
(:524-528). Concurrency stomp refuted: single httpd task serializes handlers; the
pre-acquisition clears at :931/938/943 are dead no-ops. **Fix:** one file-scope guard
type, guard the whole tail, delete manual stores.

### CR-24 — fuel-gauge persistence (SPOT-CHECKED)
write_learned_params has zero callers; poll() reads learned params into m_saved_params
(max17260.cpp:316) which nothing consumes — 5 I2C reads/cycle wasted and battery
learning lost every power cycle. **Fix:** decide — implement the save-on-Cycles-bit
policy the TODO describes, or delete both halves.

### CR-32/33 — keep-alive coherence (SPOT-CHECKED; B18, behavior change)
wifi.cpp:794-820 creates a socket every 60 s, sets keepalive options on it, closes
it — options reach no live connection. Meanwhile every API reply sends
`Connection: close` (webserver.h:111,125) while start_webserver configures
keep-alive (webserver.cpp:328-331) — every poll pays a TCP handshake on a 12-socket
pool. **Fix:** delete the wifi.cpp block; drop the Connection: close header; field-
test with 3+ tabs (watch lru_purge behavior) before merging.

### CR-45/46 — handler consolidation targets
POST: the 14-line recv/parse/commit block ×6 in handler_settings.cpp with observed
drift (line 340 `new char[n+1]` uninitialized vs `()` elsewhere; 404 vs 408 replies)
→ one read_json_body helper. GET: fresh-check → FT8 skip → refresh → 503 → park
dance ×5 with observed drift (handler_mode_get returns ESP_OK unconditionally;
status got the link-recovery probe others lack) → radio_get_via_http counterpart.
Verify current drift before refactoring (R-status).

### CR-51–54 — radio service efficiency (REPORTED; verify first)
wait_for_tx_end: TQ every 100 ms up to 60 s, results discarded instead of feeding
set_xmit_state. SET_VOLUME: driver computes the clamped level but returns bool; the
service re-reads over the wire. Three ping paths (fast_confirm_link, probe_link,
do_set preflight) disagree on stamping s_last_cat_attempt_us → link-down throttle
blind to two of them. Long-command timeout list is a KX-only strstr string inside the
shared transport; get_from_kx_string (KH1 DS reads) pinned at 100 ms.

