# Code Review Backlog — August 2026 (ultra review)

Second full-codebase review of the client (`src/web` HTML/JS/CSS) and backend
(`include/*.h`, `src/*.cpp`), run 2026-08-25 at ultra depth: 8 finder angles,
39 deduplicated candidates, every candidate adversarially verified by an
independent agent (one verdict per candidate). Follows the completed
[2026-08 review](code-review-2026-08.md); IDs here are `UR-nn` to avoid
collision with that review's `CR-nn`.

**Status: OPEN.** Tally: 17 correctness/contract findings CONFIRMED,
2 PLAUSIBLE (narrowed under verification), 17 cleanup findings confirmed
factually, 3 candidates REFUTED with constructive proofs.

This document is the **plan and evidence archive**. The **burndown lives in
GitHub issues** (milestone: `2026-08 ultra review`): one issue per batch below.
There are no PRs. We commit as a direct contributor, so each fix branch merges
to main locally and its commit body carries `Fixes #N` plus the finding IDs
(e.g. `fix: UR-06 ...`), which closes the issue when the commit reaches main.
With no review gate, the verification bar is doubled. Every batch fully retests
on every tier that exists: host unit suite, firmware build, integration/UI
(Playwright), and real hardware via OTA. The diff is reviewed before anything
merges. This doc is updated only to record fixing commit hashes in the Status
column.

**KH1 caveat:** UR-01 (caller half), UR-03, and UR-04's KH1 sibling paths cannot
be hardware-verified until a KH1 is on the bench (same constraint that deferred
the prior review's B13). Fixes are small, code-provable, and host-testable;
land them with unit coverage and flag the batch issue `Please Test` for the
next KH1 session.

## Scoring

Each finding scored 1–3 on four dimensions (same scheme as the 2026-08 review):

- **Sev** (severity): 3 = crash/data corruption/memory unsafety, 2 = wrong behavior, 1 = hygiene/waste
- **Ease**: 3 = small localized fix, 2 = moderate, 1 = refactor/design work
- **Iso** (isolation): 3 = independent, 2 = shares files with other findings, 1 = needs a refactor vehicle
- **Imp** (real-world user impact): 3 = routine use, 2 = common situations, 1 = rare/invisible
  (*Imp values are the reviewer's estimate; Q adjusts before ranking.*)

**Rank** = Sev × Imp, tiebreak by Ease. **Iso** drives batching only.

Verification status: **V** = adversarially verified, **V(narrowed)** = verified
with the claim corrected/narrowed, **P** = plausible (mechanism verified,
trigger not fully constructible).

## Master table — correctness

| ID    | Finding                                                                               | Where                                             | Ver | Sev | Ease | Iso | Imp | Batch | Status |
|-------|---------------------------------------------------------------------------------------|---------------------------------------------------|-----|-----|------|-----|-----|-------|--------|
| UR-01 | KH1 DS1 reads write `response[20]` — one past the stack buffer, every successful poll | kx_radio.cpp:69; radio_driver_kh1.cpp:25,37,55,75,229 | V | 3 | 3 | 3 | 2 | U1 | fixed c5d98af |
| UR-02 | connect() writes `buffer[256]` — one past the array on a full RX read (×2 sites)      | kx_radio.cpp:221,242                              | V   | 3   | 3    | 3   | 1   | U1    | fixed c5d98af |
| UR-03 | Keyer `1200 / kh_wpm` with no zero guard; div-by-0 → −1 → task hangs with TX keyed    | radio_driver_kh1.cpp:260-279                      | V   | 3   | 3    | 3   | 2   | U2    | fixed b8968c0 |
| UR-04 | set_power treats readback −1 (comms failure) as success; snapshot records wish        | radio_driver_kx.cpp:104                           | V   | 2   | 3    | 3   | 1   | U2    | fixed b8968c0 |
| UR-05 | radio_connection_task starves task-WDT forever with no radio (log spam every 20 s)    | setup.cpp:50; kx_radio.cpp:209-267                | V   | 1   | 3    | 3   | 2   | U1    | fixed c5d98af |
| UR-06 | API dispatch matches any strict prefix (`/api/v1/reb` reboots; empty name matches)    | webserver.cpp:149-153,261                         | V   | 3   | 3    | 3   | 2   | U3    | fixed 0241a7c |
| UR-07 | read_post_body: single recv accepts truncated body; unbounded `new char[len+1]`       | handler_settings.cpp:337-347                      | V   | 3   | 2    | 2   | 2   | U4    | open |
| UR-08 | Settings GET emits raw NVS strings unescaped; POST parser strips escapes — a stored quote breaks every subsequent GET | handler_settings.cpp:202,395,445,242-249 | V | 2 | 2 | 2 | 2 | U4 | open |
| UR-09 | gps/callsign/license POSTs commit *any* key to settings NVS (no whitelist)            | handler_settings.cpp:234,417-434,467-484,521-538  | V   | 2   | 2    | 2   | 1   | U4    | open |
| UR-10 | settings POST sends 2 (failure: 3) responses on one request                           | handler_settings.cpp:369-379                      | V   | 2   | 3    | 2   | 1   | U4    | open |
| UR-11 | Battery mutex timeout falls through to sending uninitialized stack buffer as 200 JSON | handler_battery.cpp:38,58-73                      | V   | 3   | 3    | 3   | 2   | U5    | fixed 3e1419c |
| UR-12 | toggleXmit flips UI optimistically; 503 never reverts; state inverted until reload    | main.js:753-770; radio_http.cpp:80-93             | V   | 2   | 2    | 3   | 3   | U6    | fixed 3d789c2 |
| UR-13 | chase.js `normalizeRadioMode` clobbers main.js's; synonym/data modes 404 after Chase visit | chase.js:258 vs main.js:1168                 | V   | 2   | 3    | 2   | 2   | U7    | open |
| UR-14 | Chase distance computed in km, rendered under "Miles" header                          | chase.html:58; chase_api.js:128; main.js:1592     | V   | 2   | 3    | 3   | 3   | U8    | fixed 881e8a2 |
| UR-15 | Table refresh detaches tuned row; stale detached row drives PoLo deep links           | chase.js:864,280-308,589-591                      | V   | 2   | 2    | 2   | 2   | U8    | fixed 881e8a2 |
| UR-16 | tuneRadioHz never calls suppressVfoPolling; in-flight poll reverts optimistic state   | main.js:1182-1226,871,823                         | V   | 1   | 3    | 2   | 2   | U8    | fixed 881e8a2 |
| UR-17 | Rejected tune-target/CW-macro saves (400/500) alert "saved"; caches clobbered on next load | settings.js:427-453,700-720; handler_settings.cpp:600,675,611 | V | 2 | 2 | 2 | 1 | U9 | open |
| UR-18 | Genuine 0° coordinate treated as missing (post-parseFloat falsy checks)               | qrx.js:307; chase_api.js:127                      | V(narrowed) | 2 | 3 | 3 | 1 | U10 | open |
| UR-19 | VFO poll `parseInt` unguarded vs NaN (trigger needs non-firmware responder)           | main.js:837                                       | P   | 1   | 3    | 3   | 1   | U10   | open |

## Master table — cleanup (all verified factually)

| ID    | Finding                                                                               | Where                                             | Ver | Sev | Ease | Iso | Imp | Batch | Status |
|-------|---------------------------------------------------------------------------------------|---------------------------------------------------|-----|-----|------|-----|-----|-------|--------|
| UR-20 | LED/idle task wakes every 25 ms forever, re-setting LED_OFF with no activity          | idle_status_task.cpp:118-124; settings.h:11       | V   | 1   | 2    | 3   | 1   | U12   | open |
| UR-21 | Mouse drag rebuilds full band chart (incl. per-spot ticks) every pointermove          | run.js:631-639,563,267,372,423-434                | V   | 1   | 2    | 3   | 2   | U11   | open |
| UR-22 | loadCwMacrosAsync refetches unconditionally; Run-appear awaits serialized             | run.js:1510-1527; main.js:232                     | V   | 1   | 3    | 2   | 1   | U11   | open |
| UR-23 | Spots auto-refresh (500-spot fetch + full localStorage serialize) runs with tab hidden | spots.js:191-201,11-12,30-33                     | V   | 1   | 3    | 3   | 2   | U11   | open |
| UR-24 | VFO poll issues 2 GETs (frequency + mode) per 3 s tick                                | main.js:828-831                                   | V   | 1   | 1    | 2   | 1   | U11   | open |
| UR-25 | QRX appear fetches /api/v1/gps twice (loadGpsLocation + getLocation)                  | qrx.js:587-591,73; main.js:1640-1656              | V   | 1   | 3    | 2   | 1   | U11   | open |
| UR-26 | settings.js twin editor stacks: Tune Targets (15 fns) mirrors CW Macros (14 fns)      | settings.js:133-460 vs 468-727                    | V   | 1   | 1    | 1   | 1   | U9    | open |
| UR-27 | handler_settings triplicated gps/callsign/license stacks (POST bodies token-identical) | handler_settings.cpp:385-538                     | V   | 1   | 2    | 1   | 1   | U4    | open |
| UR-28 | Reboot timer unique_ptr never release()d; deleter runs esp_timer_delete on armed timer | webserver.cpp:378-412                            | V   | 1   | 3    | 3   | 1   | U12   | open |
| UR-29 | main.js loader triads duplicated (tuneTargets vs cwMacros fetch/save/load)            | main.js:174-224 vs 232-273                        | V   | 1   | 2    | 1   | 1   | U9    | open |
| UR-30 | loadTabScriptIfNeeded fetches script then re-requests via script tag (no-cache)       | main.js:1244-1267; webserver.cpp:230              | V   | 1   | 2    | 3   | 1   | U11   | open |
| UR-31 | handler_ft8 bypasses parse_long_param (atol/atoi + private strtoul block)             | handler_ft8.cpp:~637-643,~701-704,~919-922        | V   | 1   | 3    | 3   | 1   | U12   | open |
| UR-32 | WWFF regex duplicated with drift: run.js inlines case-insensitive, qrx uses case-sensitive shared pattern | run.js:1299-1310 vs qrx.js:473-479, main.js:46 | V | 2 | 3 | 2 | 1 | U7 | open |
| UR-33 | dataModes lists diverge: chase_api omits DIG/DIGI that main.js normalizes             | chase_api.js:112-117 vs main.js:1175              | V   | 1   | 2    | 2   | 1   | U7    | open |
| UR-34 | about.js refreshVersion re-implements fetchAndUpdateElement scaffolding               | about.js:~51 vs main.js:950-973                   | V   | 1   | 3    | 3   | 1   | U11   | open |
| UR-35 | Frequency clamps hardcode KX2 limits despite per-radio RADIO_CAPABILITIES tables      | main.js:36-38; run.js:930-938 vs main.js:444-479  | V   | 1   | 2    | 2   | 1   | U13   | open |
| UR-36 | Client resolves SSB→LSB/USB itself (null VFO → wrong sideband); firmware SSB_AUTO exists | run.js:942-950; main.js:34-35; handler_mode.cpp:75-77 | V | 2 | 3 | 2 | 1 | U13 | open |

## Refuted during verification (do not fix)

- **KH1 `ft8_set_tone` negative-modulo / overflow** — inputs not constructible:
  FT8 tones are symbols 0–7, so frequency = baseFreq + 0..44 Hz, never negative,
  never ≥ 100; baseFreq changes only between transmissions. snprintf bounded by
  sizeof(command)==8; uart write fixed 5 bytes. Latent hazard only if a caller
  ever passes frequency < base_freq (radio_driver_kh1.cpp:351).
- **Battery `snprintf` accumulation overflow** — every field is a 16-bit
  register with fixed scale constants; worst-case JSON is exactly 192 chars +
  NUL = 193 ≤ 200. Headroom is 7 bytes: adding one field makes the negative-size
  conversion reachable. Clamp between calls if that JSON ever grows.
- **FT8 `CommandInProgress` race** — both FT8 handlers run inline in the single
  httpd task and never use radio_park, so no interleaving exists; the unguarded
  store(true) at handler_ft8.cpp:978 becomes the described race only if FT8
  handlers ever adopt the async park pattern (worth a comment then).

## Batches → GitHub issues

One issue per batch, milestone `2026-08 ultra review`. Verified fixes never
share a batch commit with speculative refactors; refactor-vehicle batches fix
the correctness items first, consolidate second.

| Batch | Issue title | Findings | Notes |
|-------|-------------|----------|-------|
| U1 (#131) | kx_radio buffer terminators and connect-loop WDT | UR-01, UR-02, UR-05 | one file + KH1 caller sizes; host-testable |
| U2 (#132) | Radio driver guards: KH1 WPM divisor, KX power readback | UR-03, UR-04 | UR-03 is TX-safety-critical; KH1 hardware retest deferred |
| U3 (#133) | API dispatch: exact-match handler names | UR-06 | tiny, critical; add length equality to the compare |
| U4 (#134) | handler_settings hardening then consolidation | UR-07, UR-08, UR-09, UR-10, UR-27 | fix recv/escaping/whitelist/double-reply first; UR-27 consolidation second |
| U5 (#135) | Battery handler: fail loudly on mutex timeout | UR-11 | 503, not `= {0}` (empty-body 200 is still a lie) |
| U6 (#136) | XMIT button state reconciles with the radio | UR-12 | revert on !ok; consider TX state in poll |
| U7 (#137) | Client normalization coherence (modes, WWFF refs) | UR-13, UR-32, UR-33 | rename chase classifier; single shared tables |
| U8 (#138) | Chase integrity: units, stale tuned row, poll stomp | UR-14, UR-15, UR-16 | one page's data path |
| U9 (#139) | settings.js truthful saves, then editor/loader dedup | UR-17, UR-26, UR-29 | fix the lie first; dedup is the follow-on vehicle |
| U10 (#140) | Numeric hardening: zero coordinates, NaN guard | UR-18, UR-19 | Number.isFinite; UR-19 is one-line insurance |
| U11 (#141) | Client efficiency sweep | UR-21, UR-22, UR-23, UR-25, UR-30, UR-34; UR-24 decide | throttle drag rebuild, hidden-tab pause, dedup fetches; UR-24 likely decline (needs combined endpoint) |
| U12 (#142) | Firmware hygiene sweep | UR-20, UR-28, UR-31 | event-driven LED wait, release() the timer, parse_long_param |
| U13 (#143) | Radio-capability altitude: limits and SSB from one source | UR-35, UR-36 | derive clamps from RADIO_CAPABILITIES; send SSB, let firmware resolve |

Suggested order: U3, U1, U2, U5 (memory/TX safety first), U6 (on-air state),
U8, U7 (user-visible client), U4 (largest server batch), U9, U10, then the
sweeps U12, U11, and the altitude work U13 last.

## Evidence details

Condensed from the verification agents' reports. Line numbers are as of commit
0852774 (2026-08-25); update alongside fixes if they drift.

### UR-01 — KH1 DS1 one-past-end write (VERIFIED)
kx_radio.cpp:69 executes `response[expected_chars] = '\0'` whenever
returned_chars ≥ expected_chars; get_from_kx_string (kx_radio.cpp:489) passes
response_size straight through. The five KH1 DS1 callers
(radio_driver_kh1.cpp:25, 37, 55, 75, 229) all declare `char response[20]` and
pass `sizeof(response)`. A full 20-char read writes response[20]. KX paths are
safe (16-byte buffer, response_size ≤ 15; other callers pass sizeof−1).
**Fix:** change the contract so the terminator must fit inside the buffer
(callers pass sizeof−1, or the transport takes buffer size and caps reads at
size−1).

### UR-02 — connect() one-past-end write (VERIFIED)
kx_radio.cpp:208 declares `uint8_t buffer[256]`; both reads (219, 240) request
the full 256 and lines 221/242 write `buffer[length] = '\0'`. Reachable during
the wrong-baud hunt where noise fills the RX FIFO within the 250 ms window.
**Fix:** read at most sizeof−1.

### UR-03 — keyer division by zero, TX left keyed (VERIFIED)
radio_driver_kh1.cpp:260 unconditionally overwrites the 20-WPM default with
`atoi(speed_char)` on any successful DS1 read; non-digit display chars 4–5
yield 0; no guard before `1200 / kh_wpm` at :263. RISC-V div-by-zero returns
all-ones: ditPeriod = −1, `HK1;` has already keyed TX (:279), and
`pdMS_TO_TICKS(-1)` widens to an enormous tick count. The result is a hung
keyer task with the transmitter keyed. **Fix:** validate digits / clamp WPM to a sane range
before dividing; keep the default on garbage.

### UR-04 — set_power accepts failed readback (VERIFIED)
get_from_kx returns −1 on comms failure (kx_radio.cpp:321); set_power's only
guard is `readback == 0` (radio_driver_kx.cpp:104), so −1 logs "acquired −1"
and returns true; radio_service.cpp:293-295 then records the *requested* power
in the snapshot. The write itself (:101) is fire-and-forget (tries=0).
**Fix:** treat readback < 0 as failure; consider verifying the write.

### UR-05 — WDT starvation with no radio (VERIFIED)
setup.cpp:50 subscribes radio_connection_task to the task WDT before
kxRadio.connect() at :58; connect()'s `while (true)` baud hunt
(kx_radio.cpp:209-267) contains no esp_task_wdt_reset and returns only on a
detected radio. CONFIG_ESP_TASK_WDT_TIMEOUT_S=20, panic off → starvation error
naming radio_task every 20 s, forever, whenever powered without a radio.
**Fix:** feed the WDT in the hunt loop (or subscribe after connect).

### UR-06 — prefix-match API dispatch (VERIFIED)
webserver.cpp:149 computes `compare_length = strcspn(api_name, "?")` (the
*requested* name's length), and :153 strncmp's only that many chars, so any
strict prefix of a registered name matches: `/api/v1/reb` dispatches
handler_reboot_get; empty name (compare_length 0) matches the first same-method
entry; `PUT /api/v1/a` fires ATU tune. api_name arrives unvalidated from
`requested_uri + sizeof("/api/v1/") - 1` (:261). Over-long names do not match
(strict prefixes only). **Fix:** require `strlen(handler->api_name) ==
compare_length` alongside the strncmp.

### UR-07 — read_post_body short-read + unbounded alloc (VERIFIED)
handler_settings.cpp:337-347: exactly one `httpd_req_recv(req, buf,
content_len)`; only `ret <= 0` is checked, so a partial recv passes and the
value-initialized tail parses as truncated-but-valid pairs, committed to NVS by
all five POST handlers. No cap on content_len; ESP-IDF aborts on failed `new`.
A huge Content-Length is a remote panic-reboot. **Fix:** recv loop to
completion (408 on timeout), sane content_len ceiling.

### UR-08 — settings JSON round-trip corruption (VERIFIED)
POST parser (handler_settings.cpp:242-249) shifts out every backslash,
consuming the exposed char in the same iteration: incoming `\"` stores a
literal quote in NVS. GET builders (get_settings_json :202,
get_gps_settings_json :395, get_callsign_settings_json :445) snprintf raw NVS
strings into `"%s"` unescaped. One stored quote/backslash and every subsequent
GET returns invalid JSON; settings.js `response.json()` throws; all fields
blank until overwritten blind. WiFi passwords legitimately contain quotes.
**Fix:** escape on output (and store escaped-correctly on input); add a
round-trip unit test with quote/backslash values.

### UR-09 — no per-endpoint key whitelist (VERIFIED)
parse_and_process_json (:234-303) nvs_set_str's every quoted pair;
handler_gps_settings_post (:417-434) and its callsign (:467-484) and license
(:521-538) siblings feed the raw body in, so `POST /api/v1/gps` with
`{"sta1_ssid":"x","sta1_pass":"y"}` silently overwrites WiFi credentials.
Arbitrary unknown keys persist too (≤15-char NVS limit; process() return
ignored). tuneTargets/cwMacros use targeted parsers, unaffected.
**Fix:** per-endpoint allowed-key lists passed into the parser.

### UR-10 — double response on settings POST (VERIFIED)
handler_settings.cpp:369 sends the full settings JSON
(retrieve_and_send_settings → REPLY_WITH_STRING), then :371-379 runs
schedule_deferred_reboot and REPLY_WITH_SUCCESS (204), a second complete
response on the same request; the failure branch (:377) can send a third.
Bounded in practice by the 2 s reboot killing the connection.
**Fix:** one response per request; pick the JSON, drop the 204.

### UR-11 — uninitialized battery buffer served as 200 (VERIFIED)
handler_battery.cpp:38 declares `char out_buf[200]` uninitialized; the
smart-battery failure branch (:58-60, triggered by get_battery_info's 100 ms
mutex timeout, battery_monitor.cpp:144) only logs and falls through to :72-73:
REPLY_WITH_STRING strlen's uninitialized stack (overread if no NUL) and ships
it as HTTP 200 application/json: stack disclosure plus a body that fails
response.json(). **Fix:** REPLY_WITH_FAILURE/503 in the branch, not `= {0}`
(an empty-body 200 mislabeled as JSON is still wrong).

### UR-12 — XMIT UI inversion (VERIFIED)
main.js:761 flips AppState.isXmitActive and the button class before
sendXmitRequest (:753-756) fire-and-forgets the PUT (fetchQuiet logs !ok,
returns the response; sendXmitRequest discards it). radio_set_via_http
(radio_http.cpp:80-93) returns 503 when FT8/keyer own the radio or the link is
down. Nothing else writes isXmitActive. The inversion persists across every
subsequent toggle until reload. **Fix:** revert state+UI on !ok/rejection;
longer term, reflect real TX state from the status poll.

### UR-13 — normalizeRadioMode collision (VERIFIED)
Both files declare global `function normalizeRadioMode(mode)` (main.js:1168,
the spot-mode → firmware-mode mapper; chase.js:258, the USB/LSB→SSB family
classifier). Tab scripts are persistent classic scripts: once Chase loads, the
classifier wins everywhere. tuneRadioHz (main.js:1183) then passes synonym/data
modes verbatim; handler_mode.cpp:80-84 replies 404; the mode failure
early-returns *after* the frequency PUT succeeded but *before* the AppState
update and onTuneRadioComplete. The radio retunes; shared VFO state/highlight/
hooks lag until the next poll. Common modes (CW/FM/AM/FT8) pass through
either way; breakage is synonym modes (PSK31, CW-R, PHONE), DATA-alias modes
(SSTV, JT65…), and strings main.js would have treated as frequency-only tunes.
**Fix:** rename the chase.js classifier (it is a different concept); longer
term, module-scope tab scripts.

### UR-14 — km under a "Miles" header (VERIFIED)
chase.html:58 header says Miles; calculateDistance (main.js:1592) returns km
(R = 6371); chase_api.js:128-130 rounds with no conversion; chase.js:852
renders raw. qrx.js:245 converts (× 0.621371), establishing the miles
convention. **Fix:** convert in chase_api.js (or relabel the header).

### UR-15 — stale detached tuned row (VERIFIED)
updateChaseTable (chase.js:864) replaceChild's the tbody, detaching the row
referenced by clickedTunedRow (:389/440/784) without remapping. The detached
row keeps its `tuned-row` class (updateTunedRowHighlight's querySelectorAll at
:280/288 reaches only attached rows, so the cleanup guard at :308 never fires);
getTunedSpotData (:589-591) prefers it, so after the radio moves off frequency
the PoLo button stays enabled with the old spot's data. Routine: chase
auto-refresh opens the window. **Fix:** remap or clear clickedTunedRow on
table rebuild.

### UR-16 — tuneRadioHz missing poll suppression (VERIFIED)
suppressVfoPolling exists (main.js:871, honored at :823) and run.js calls it
around its actions (55, 561, 901, 943, 979); tuneRadioHz (:1182-1226) never
does. A poll landing between the PUTs and the optimistic AppState write
(:1216-1219) returns pre-tune snapshot values and overwrites/notifies,
reverting highlight/PoLo until the next 3 s tick. **Fix:** call
suppressVfoPolling in tuneRadioHz; note suppression is checked only at poll
start. The in-flight window needs a request-epoch/abort guard if it matters.

### UR-17 — rejected saves alert "saved" then clobber (VERIFIED)
saveTuneTargets/saveCwMacros (settings.js:427-429, 700-702) set savedToDevice
only on response.ok; a 400 ("too large", handler_settings.cpp:600/675, caps
in settings.h) or the 500 nvs-commit path (:611-612) falls through like a
network error: caches written anyway (:435-441, 707-709), alert claims "saved
for this session (device unavailable)" (:453, :720), and the next load
(:140-149, 474-481) overwrites AppState and localStorage with the device's old
list. Client per-field limits keep ASCII under the byte caps. The 400 is
realistically reachable via multi-byte UTF-8. **Fix:** distinguish 4xx/5xx from
network failure; on rejection, report the server's reason and do not cache.

### UR-18 — zero-coordinate falsy checks (VERIFIED, narrowed)
The string-side claims were wrong (the /api/v1/gps JSON carries quoted strings;
"0" is truthy, so main.js:1658 and qrx.js:76 are safe). The numeric-side bugs are
real: qrx.js:307 (`location.latitude && location.longitude`) and
chase_api.js:127 (`spot.dx_latitude && spot.dx_longitude` → distance 99999)
treat genuine 0° as missing. **Fix:** Number.isFinite / `!= null`, as
main.js:1643 already does for the localStorage path.

### UR-19 — VFO parseInt NaN guard (PLAUSIBLE — hardening only)
main.js:837 `parseInt(await freqResponse.text(), 10)` unguarded; NaN !== NaN
would fire all subscribers every tick. Not constructible from the firmware
(handler_frequency.cpp:20 always formats numerically; the 500 path is caught by
the !ok guard). It requires a captive portal/proxy answering 200. Damage partly
contained (NaN is falsy → chase highlight clears rather than corrupts).
**Fix (one line):** Number.isFinite after the parse.

### UR-20/28/31 — firmware hygiene (U12)
Idle/LED task wakes every 25 ms re-setting LED_OFF (idle_status_task.cpp:118-124;
LED_FLASH_MSEC settings.h:11). An event-driven wait (portMAX_DELAY when idle)
removes 40 wakeups/s. Reboot timer unique_ptr (webserver.cpp:378-412) is never
release()d, so the success path deletes the just-armed timer (works only per
ESP-IDF's documented delete-while-armed grace; reboot still fires). handler_ft8
hand-rolls atol/atoi and a private strtoul block instead of parse_long_param
(webserver.h:95) used by every other handler.

### UR-21–25/30/34 — client efficiency (U11)
Mouse drags rebuild the full band chart per pointermove (only the frequency
write is throttled at 66 ms; touch returns early). loadCwMacrosAsync
(main.js:232) has no already-loaded guard and Run-appear serializes four awaits
(run.js:1510-1527). Spots auto-refresh (spots.js:191-201) fetches 500 spots and
full-serializes localStorage every 60 s with no document.hidden check. VFO poll
issues 2 GETs/tick (parallel; a fix needs a combined endpoint, so likely a
decline). QRX-appear double-fetches /api/v1/gps (concurrent; second visit
cached). loadTabScriptIfNeeded fetch + script-tag re-request (ETag 304, so the
waste is one request, not a re-download). about.js refreshVersion duplicates
fetchAndUpdateElement's scaffolding (its extra version-parsing stays).

### UR-26/29 — settings.js / main.js dedup (U9 vehicle)
Tune Targets stack (15 fns, settings.js:133-460) mirrors CW Macros (14 fns,
:468-727). They are structurally identical minus selectors/field shape/endpoint/
mobile flag (+2 tune-target-only handlers). main.js loader triads (:174-224 vs
:232-273) same shape. Consolidate after UR-17 lands.

### UR-27 — handler_settings triplication (U4 vehicle)
Lines 385-538: three parallel gps/callsign/license stacks; POST bodies
token-for-token identical. Consolidating is the natural vehicle for UR-08/09
(escape helper + whitelist parameter in one place).

### UR-32/33 — normalization drift (U7)
run.js:1306 inlines the WWFF regex case-insensitively; qrx.js:473-479 uses the
shared case-sensitive WWFF_REF_PATTERN (main.js:46): 'vkff-0001' → wwff on Run,
null on QRX. chase_api.js:112-117 dataModes omits DIG/DIGI (present in
main.js:1175); lists diverge in both directions (RTTY/PSK31/FT8/FT4/JS8 handled
via main.js's separate tables). One shared table/pattern each.

### UR-35/36 — capability altitude (U13)
adjustFrequency clamps to hardcoded KX2 limits (main.js:36-38; the comment
admits it and includes a commented-out KX3 variant) while RADIO_CAPABILITIES
(main.js:444-479) already carries per-radio band tables. setMode (run.js:942-950)
resolves SSB client-side using `AppState.vfoFrequencyHz || DEFAULT_FREQUENCY_HZ`
(14.225 MHz → USB, wrong on 40 m when VFO unknown) while the firmware accepts
mode=SSB and resolves at apply time via RADIO_MODE_SSB_AUTO; the 10 MHz boundary
is duplicated client and server (radio_service.h documents why handler-time
resolution is wrong). Send SSB; derive clamps from capabilities.
