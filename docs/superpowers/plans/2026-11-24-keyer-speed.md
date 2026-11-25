# Keyer Speed (rigctld + REST) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Read and set the KX2/KX3 CW keyer speed in wpm over rigctld (`KEYSPD`) and REST (`/api/v1/keyerSpeed`), closing #155.

**Architecture:** Keyer speed becomes one more cached radio field. It rides the existing path that power uses: a refresh and a set in the radio service, a snapshot field, and a driver get/set. rigctld and REST are thin front ends on that path, and the mock server mirrors both so the contract tests run without hardware.

**Tech Stack:** C++17 on ESP-IDF via PlatformIO (firmware), host `g++` asserts (`test/host`), Python contract tests against a Flask mock (`test/integration`, `test/mock_server`), OpenAPI YAML.

**Spec:** `docs/superpowers/specs/2026-11-24-keyer-speed-design.md`

## Global Constraints

- **Commits need Q's approval.** Every "Propose commit" step means: show Q the diff summary and the proposed title, then wait. Titles are 48 characters or fewer. No attribution lines, no line counts. `git add` each file by name.
- **A failed mutating step stops the work.** Report the raw error, a theory and a proposal to Q, then wait.
- One test at a time: write it, run it, watch it fail, make it pass, then the next.
- Range is 8 to 50 wpm. Unknown speed is an error reply, never `0`.
- No CAT traffic from this feature while FT8 or the keyer holds the radio.
- KH1: `supports_keyer_speed()` is false. Its `send_keyer_message` display scrape is not touched.
- Comments describe the present contract only, terse and beside the value. No prose em-dashes in comments or docs.
- Docs state only what was tested, on which radio. Everything else is labeled untested.
- Web UI is out of scope. So are `\stop_morse` and `stop_voice_mem`.
- Hamlib `RIG_LEVEL_KEYSPD` is bit 14 (`0x4000`), confirmed against Hamlib master `rig.h` on 2026-11-24. New masks: `has_get_level` `0x44005008`, `has_set_level` `0x5008`.

## Review Focus

1. **Read while the keyer holds the radio:** the reply is the cached integer, arrives in under 1 s, and is never `0`. Pinned in Task 4 (`t_keyer_exclusive`).
2. **Set outside 8 to 50:** `L KEYSPD 5` then read gives `8`; `L KEYSPD 60` then read gives `50`. Pinned in Task 4 (mock) and Task 8 (KX2).
3. **Malformed set:** `L KEYSPD abc` and `L KEYSPD 0` answer `-1` and change nothing; REST `wpm=abc`, `wpm=`, `wpm=0`, `wpm=12abc` answer 404. Pinned in Task 4.
4. **Dial turned on the radio:** the next read after 200 ms shows the new speed. Hardware only, Task 8.
5. **KH1 polled by a client:** no button presses. No KH1 test exists, so this is a code-review check in Task 3: the capability gate in `do_refresh` returns before the radio lock, and both front ends refuse before enqueueing.

---

### Task 1: Bench probe on the KX2 (throwaway spike)

Nothing from this task is committed. It answers the spec's three unverified CAT questions.

**Files:**
- Temporary edit: `src/radio_driver_kx.cpp` (`KXRadioDriver::get_power`, `KXRadioDriver::send_keyer_message`)

- [ ] **Step 1: Check the manual.** Find the `KS` entry in the Elecraft KX2/KX3 Programmer's Reference and record its GET/SET format and range in the task notes.
- [ ] **Step 2: Add temporary logging.** At the top of `KXRadioDriver::get_power`, log at `ESP_LOGW` the result of each of, in order: `radio.get_from_kx ("KS", SC_KX_COMMUNICATION_RETRIES, 3)`; `radio.put_to_kx ("KS", 3, 22, 0)` then the get; `put_to_kx ("KS", 3, 5, 0)` then the get; `put_to_kx ("KS", 3, 60, 0)` then the get; finally restore the first value. In `send_keyer_message`, after the `KY` chunks are fired, log one `get_from_kx ("KS", 1, 3)`.
- [ ] **Step 3: Build and flash the debug env.** Run: `pio run -e seeed_xiao_esp32c3_debug -t upload`, then `make monitor`. This needs the device on USB. If it is not, ask Q how they want the log captured.
- [ ] **Step 4: Trigger and record.** `curl http://<device>/api/v1/power`, then send a short keyer message from the web UI. Record every logged value and what the KX2 display showed.
- [ ] **Step 5: Revert the spike.** `git diff --stat` must show no changes to `src/`.
- [ ] **Step 6: Report to Q.** State: does `KS;` read match the display; does `KSnnn;` set; what happens at 5 and 60; what `KS;` returns mid-`KY`. **If the read or the set failed, stop here.** The design needs revisiting.

---

### Task 2: Snapshot field

**Files:**
- Modify: `include/radio_snapshot.h`, `src/radio_snapshot.cpp`
- Test: `test/host/test_radio_snapshot.cpp`

**Interfaces:**
- Produces: `RadioSnapshotData::keyer_speed` (`long`, `-1` unknown, wpm), `keyer_speed_stamp_us`, `bool has_keyer_speed () const` (`keyer_speed > 0`), `bool keyer_speed_fresh (int64_t now_us) const`, `void radio_snapshot::set_keyer_speed (long wpm, int64_t now_us)`.

- [ ] **Step 1: Write the failing test** in `main()` of `test_radio_snapshot.cpp`:

```cpp
    {
        RadioSnapshotData s;
        assert (!s.has_keyer_speed());
        assert (!s.keyer_speed_fresh (1'000'000));
        s.keyer_speed          = 0;  // a zero reading is not a known speed
        s.keyer_speed_stamp_us = 1'000'000;
        assert (!s.has_keyer_speed());
        s.keyer_speed = 22;
        assert (s.has_keyer_speed());
        assert (s.keyer_speed_fresh (1'000'000 + RADIO_SNAPSHOT_FRESH_US - 1));
        assert (!s.keyer_speed_fresh (1'000'000 + RADIO_SNAPSHOT_FRESH_US));
        assert (!s.keyer_speed_fresh (999'999));  // now before stamp reads stale
    }
```

- [ ] **Step 2: Run it.** `make -C test/host test_radio_snapshot`. Expected: compile error, `has_keyer_speed` not a member.
- [ ] **Step 3: Add the field, stamp, both predicates and `set_keyer_speed`,** each beside its `smeter` counterpart.
- [ ] **Step 4: Run it.** `make -C test/host test_radio_snapshot && test/host/test_radio_snapshot`. Expected: exit 0.
- [ ] **Step 5: Propose commit.** Title: `snapshot: add keyer speed field (#155)`.

---

### Task 3: Service, park kinds and drivers

No client-visible behavior changes in this task. It is reviewed as plumbing.

**Files:**
- Modify: `include/radio_service.h`, `src/radio_service.cpp`, `include/radio_park.h`, `include/radio_driver.h`, `include/radio_driver_kx.h`, `src/radio_driver_kx.cpp`, `include/radio_driver_kh1.h`, `src/radio_driver_kh1.cpp`, `include/kx_radio.h`, `src/kx_radio.cpp`
- Test: `test/host/test_radio_park.cpp`

**Interfaces:**
- Consumes: Task 2's snapshot members.
- Produces:
  - `RadioCmdType::REFRESH_KEYER_SPEED` (directly after `REFRESH_SMETER`) and `RadioCmdType::SET_KEYER_SPEED` (directly after `SET_TIME`, arg = wpm). `RADIO_REFRESH_KINDS` and `RADIO_SET_KINDS` are computed from these new last members.
  - `RadioParkKind::GET_KEYER_SPEED` (directly after `GET_SMETER`) and `RadioParkKind::SET_KEYER_SPEED` (directly after `SET_TIME`, before `COUNT`).
  - Driver virtuals, with `KXRadio` delegates of the same names minus the `radio` parameter: `bool supports_keyer_speed () const`, `bool get_keyer_speed (KXRadio & radio, long & out_wpm)`, `bool set_keyer_speed (KXRadio & radio, long wpm, long & out_achieved)`.
  - Constants in `radio_driver_kx.cpp`: `KEYER_SPEED_MIN_WPM = 8`, `KEYER_SPEED_MAX_WPM = 50`.

- [ ] **Step 1: Write the failing test** in `test_radio_park.cpp`, beside the existing `is_set_kind` assertion:

```cpp
    assert (!RadioParkTable::is_set_kind (RadioParkKind::GET_KEYER_SPEED));
    assert (RadioParkTable::is_set_kind (RadioParkKind::SET_KEYER_SPEED));
    assert ((int)RadioParkKind::SET_KEYER_SPEED < RADIO_PARK_KINDS);
```

- [ ] **Step 2: Run it.** `make -C test/host test_radio_park`. Expected: compile error, unknown enumerator.
- [ ] **Step 3: Add the two park kinds.** Run again. Expected: exit 0.
- [ ] **Step 4: Add the two `RadioCmdType` members and move the `*_KINDS` constants.** In `radio_service.cpp` add both to `radio_service_park_kind` and `REFRESH_KEYER_SPEED` to `snapshot_field_fresh`.
- [ ] **Step 5: Add the driver virtuals and delegates.**
  - KX `supports_keyer_speed`: true.
  - KX `get_keyer_speed`: `get_from_kx ("KS", SC_KX_COMMUNICATION_RETRIES, 3)`; fail when the result is below 1.
  - KX `set_keyer_speed`: clamp to the two constants, fire `put_to_kx ("KS", 3, wpm, 0)`, read back with `get_from_kx`, fail when the read-back is below 1, report the read-back as `out_achieved`. This is the tolerant read-back shape of `set_power`. If Task 1 showed different radio behavior, follow Task 1.
  - KH1: `supports_keyer_speed` false; get and set return false.
- [ ] **Step 6: Add the worker cases.** In `do_refresh`, extend the capability gate so `REFRESH_KEYER_SPEED` on a radio without `supports_keyer_speed()` returns before the lock, then add a branch that calls `get_keyer_speed` and stores via `radio_snapshot::set_keyer_speed`. In `do_set`, add a `SET_KEYER_SPEED` case shaped like `SET_POWER`.
- [ ] **Step 7: Verify.** `make -C test/host test` exits 0, and `pio run -e seeed_xiao_esp32c3_debug` builds with no warnings from the touched files.
- [ ] **Step 8: Review check for Review Focus 5.** Read `do_refresh` and confirm the keyer-speed gate precedes `kxRadio.timed_lock`.
- [ ] **Step 9: Propose commit.** Title: `radio: keyer speed in service and drivers (#155)`.

---

### Task 4: Mock server and contract tests

Tests are written first against the mock, which stands in for the firmware contract. Tasks 5 and 6 then make the firmware satisfy the same tests.

**Files:**
- Modify: `test/mock_server/server.py`, `docs/dev/openapi-v1.yaml`
- Test: `test/integration/test_rigctld.py`, `test/integration/test_radio_contract.py`, `test/integration/test_api_contract.py`

**Interfaces:**
- Produces (the wire contract Tasks 5 and 6 implement):
  - rigctld `l KEYSPD` → integer wpm. `L KEYSPD <n>` → rounds to nearest integer; below 1 or non-numeric → `RPRT -1`; otherwise clamps to 8..50 and applies. `-9` while FT8 or keyer active. Unsupported radio → `RPRT -4`.
  - `dump_state` masks `0x44005008` and `0x5008`.
  - `GET /api/v1/keyerSpeed` → 200, bare text matching `^[0-9]+$`. `PUT /api/v1/keyerSpeed?wpm=<n>` → 204 or 202; not a positive integer → 404 `invalid wpm`; 503 while FT8 or keyer active. Unsupported radio → 404 `keyer speed not supported on this radio`.
  - Mock state key `keyer_speed`, default `20`.

Do one sub-cycle at a time: write one test, run its mock target, watch it fail, add the mock code, watch it pass.

- [ ] **Step 1: rigctld read.** In the basic-reads test of `test_rigctld.py`, beside the `RAWSTR` check:

```python
            v = c.cmd("l KEYSPD")[0]
            if v != "RPRT -4":  # -4 is legitimate on radios without a keyer speed read (KH1)
                self.expect(v.isdigit() and 8 <= int(v) <= 50, f"KEYSPD {v!r} not an integer in 8..50")
```

and in the extended-protocol test, beside `+l RFPOWER`:

```python
            ls = c.lines("+l KEYSPD", 3)
            self.expect(ls[0] == "get_level: KEYSPD" and ls[1].isdigit() and ls[2] == "RPRT 0", f"+l KEYSPD {ls!r}")
```

Run: `make -C test/integration test-rigctld-mock`. Expected: FAIL on KEYSPD. Add `KEYSPD` to the mock's `_get_level`. Run again: PASS.

- [ ] **Step 2: rigctld set, clamp and malformed.** Add a mock-only test `t_keyspd_set`, registered beside `t_ptt_roundtrip`:

```python
    def t_keyspd_set(self):
        c = self.client()
        try:
            orig = c.cmd("l KEYSPD")[0]
            for asked, want in (("25", "25"), ("22.6", "23"), ("5", "8"), ("60", "50")):
                self.expect(c.rprt(f"L KEYSPD {asked}") == 0, f"L KEYSPD {asked} refused")
                got = c.cmd("l KEYSPD")[0]
                self.expect(got == want, f"KEYSPD after set {asked}: {got!r}, want {want}")
            for bad in ("abc", "0", "-3"):
                self.expect(c.rprt(f"L KEYSPD {bad}") == -1, f"L KEYSPD {bad} not -1")
                self.expect(c.cmd("l KEYSPD")[0] == "50", f"L KEYSPD {bad} changed the speed")
            c.rprt(f"L KEYSPD {orig}")
        finally:
            c.close()
```

Use the file's existing client constructor in place of `self.client()` if it is named differently. Run, watch it fail, add `KEYSPD` to the mock's `_set_level`, run again: PASS.

- [ ] **Step 3: masks and the real Hamlib client.** Update both mask strings in the mock's `dump_state`. Extend `t_hamlib_client_gating` with a second `rigctl ... l KEYSPD` run asserting return code 0 and an integer in 8..50. Run: PASS. This is the decisive check that the mask bit is right.

- [ ] **Step 4: keying exclusivity (Review Focus 1).** In `t_keyer_exclusive`, add `"L KEYSPD 20"` to the tuple of commands that must answer `-9`, and beside the `+m` read:

```python
                hdr, f, rc = c.cmd_ext("+l KEYSPD")
                self.expect(rc == 0, f"+l KEYSPD during keying rprt {rc}")
```

Follow how the file already reads a bare-valued extended reply if `cmd_ext` does not fit, and assert the value is an integer of at least 8. Run: PASS (the mock's shared fetch and apply paths already gate).

- [ ] **Step 5: REST routes.** Add to `docs/dev/openapi-v1.yaml` a `/keyerSpeed` path with `getKeyerSpeed` and `setKeyerSpeed`, modeled on `/power` (query parameter `wpm`, integer, minimum 1; the same 404, 500 and 503 responses). Add to `test_api_contract.py` beside the power probes:

```python
        dict(method="GET", path="/keyerSpeed"),
        dict(method="PUT", path="/keyerSpeed", params={"wpm": 20}),
        dict(method="PUT", path="/keyerSpeed", params={"wpm": 0}, expect={404}),
```

Run: `make -C test/integration test-api-contract-mock`. Expected: FAIL (route missing in the mock; the YAML-versus-firmware route-table check also fails until Task 6, so note that failure and move on if it is the only one left). Add both routes to the mock beside power. Run again.

- [ ] **Step 6: REST round trip and strict parsing (Review Focus 3).** In `test_radio_contract.py`, add to the `numeric()` tuple `("keyerSpeed?wpm=abc", 404), ("keyerSpeed?wpm=12abc", 404), ("keyerSpeed?wpm=", 404), ("keyerSpeed?wpm=0", 404)`, and add a `keyer_speed()` check shaped like `power()`: GET (404 means unsupported, return), assert integer in 8..50, PUT the current value back, assert 204 or 202 within `SET_BOUND_S`, GET again and assert equality. Register it as `"GET/PUT keyerSpeed -> 204 and read-your-write (or 404 unsupported)"`. Run: `make -C test/integration test-contract-mock`. Expected: PASS on the healthy mock, and the dead-radio mock behaves as power does.

- [ ] **Step 7: Run all three mock targets once more.** `test-rigctld-mock`, `test-contract-mock`, `test-api-contract-mock`. Record which pass and the exact remaining failure, if any, that waits on Task 6.
- [ ] **Step 8: Propose commit.** Title: `test: keyer speed contract and mock (#155)`.

---

### Task 5: rigctld `KEYSPD` in firmware

**Files:**
- Modify: `src/rigctld_server.cpp` (`cmd_get_level`, `cmd_set_level`, the two `dump_state` mask lines)

**Interfaces:**
- Consumes: `RadioCmdType::REFRESH_KEYER_SPEED`, `SET_KEYER_SPEED`, `kxRadio.supports_keyer_speed()`, `RadioSnapshotData::has_keyer_speed()`, and the file's own `rigctld_fetch` and `rigctld_apply`.

- [ ] **Step 1: `get_level KEYSPD`.** A branch shaped like `STRENGTH`: `RIG_ENIMPL` when unsupported; otherwise `rigctld_fetch (REFRESH_KEYER_SPEED, s)` and print `%ld` of `s.keyer_speed`; `RIG_EIO` when the fetch succeeded but `!s.has_keyer_speed()`.
- [ ] **Step 2: `set_level KEYSPD`.** `RIG_ENIMPL` when unsupported. `long wpm = lroundf (val)`; `RIG_EINVAL` when `wpm < 1`. Otherwise `resp_end (r, rigctld_apply (RadioCmdType::SET_KEYER_SPEED, wpm))`. Clamping stays in the driver.
- [ ] **Step 3: Masks.** `0x44005008` with comment `has_get_level: AF|RFPOWER|KEYSPD|RAWSTR|STRENGTH`, and `0x5008` with comment `has_set_level: AF|RFPOWER|KEYSPD`.
- [ ] **Step 4: Build.** `pio run -e seeed_xiao_esp32c3_debug`. Expected: success.
- [ ] **Step 5: Propose commit.** Title: `rigctld: KEYSPD get and set (#155)`. Hardware verification is Task 8.

---

### Task 6: REST `keyerSpeed` in firmware

**Files:**
- Modify: `src/handler_cat.cpp`, `include/webserver.h`, `src/webserver.cpp` (route table)

**Interfaces:**
- Consumes: Task 3's enums and park kinds; `radio_get_via_http`, `radio_set_via_http`, `parse_long_param`, `STANDARD_DECODE_SOLE_PARAMETER`, `REPLY_WITH_FAILURE` as `handler_power_get` / `handler_power_put` use them.
- Produces: `esp_err_t handler_keyerSpeed_get (httpd_req_t *)`, `esp_err_t handler_keyerSpeed_put (httpd_req_t *)`; route table rows `{HTTP_GET, "keyerSpeed", handler_keyerSpeed_get, true}` and `{HTTP_PUT, "keyerSpeed", handler_keyerSpeed_put, true}`.

- [ ] **Step 1: Write both handlers** beside the power pair. Both reply 404 `keyer speed not supported on this radio` when `!kxRadio.supports_keyer_speed()`. PUT decodes the sole parameter `wpm`, replies 404 `invalid wpm` when `parse_long_param` fails or the value is below 1, and otherwise calls `radio_set_via_http (req, RadioCmdType::SET_KEYER_SPEED, wpm, "keyer speed change")`.
- [ ] **Step 2: Declare and route them.**
- [ ] **Step 3: Build.** `pio run -e seeed_xiao_esp32c3_debug`. Expected: success.
- [ ] **Step 4: Route-table equality.** `make -C test/integration test-api-contract-mock`. Expected: PASS, including the YAML-versus-firmware route check left open in Task 4.
- [ ] **Step 5: Propose commit.** Title: `api: keyerSpeed GET and PUT (#155)`.

---

### Task 7: Documentation

**Files:**
- Modify: `docs/dev/REST-API.md`, `docs/user/Rig-Control-Apps.md`, `test/mock_server/README.md` (only if it lists state keys or routes), `test/integration/COVERAGE.md` (only if it lists covered routes)

- [ ] **Step 1: `REST-API.md`.** Document both routes in the style of the power entries, including the 404 and 503 cases.
- [ ] **Step 2: `Rig-Control-Apps.md`.** Remove "keyer speed" from the "Not (yet) supported" sentence. List `KEYSPD` with the other levels: integer wpm, 8 to 50, out-of-range sets clamp, `-4` on the KH1. Leave the tested-radio wording for Task 8 to fill in from real results.
- [ ] **Step 3: Check the prose.** No em-dash clause splices, no claims about untested radios.
- [ ] **Step 4: Propose commit.** Title: `docs: keyer speed over rigctld and REST (#155)`.

---

### Task 8: Full retest gate and hardware acceptance

**Files:**
- Modify: `docs/user/Rig-Control-Apps.md` (tested-radio wording only)

- [ ] **Step 1: Host and unit.** `make -C test/host test` and `make test-unit`. Record results.
- [ ] **Step 2: Mock suites.** `make -C test/integration test-rigctld-mock test-contract-mock test-api-contract-mock test-ui-mock`. Record results.
- [ ] **Step 3: Flash.** `make ota` then `make ota-upload`. Confirm the device reports the new version.
- [ ] **Step 4: Hardware suites from cube.** Confirm the Syncthing copy on cube is current, then run `test-rigctld`, `test-contract` and `test-api-contract` against the device with `EXPECT_RADIO` set as the Makefile documents. Record results.
- [ ] **Step 5: Acceptance on the KX2 (Review Focus 2 and 4).** With `rigctl -m 2 -r <device>:4532`:
  - `l KEYSPD` equals the radio's display.
  - Turn the dial; wait 1 s; `l KEYSPD` shows the new value.
  - `L KEYSPD 25` changes the display to 25.
  - `L KEYSPD 5` reads back 8; `L KEYSPD 60` reads back 50.
  - Repeat read and set through `curl` on `/api/v1/keyerSpeed`.
  - During a keyer send from the web UI: a second `rigctl` session reads the cached speed at once, and `L KEYSPD 20` answers `-9`.
- [ ] **Step 6: halo.** Ask Q to connect Ham2K to the device, confirm the speed field shows the radio's speed, that changing it in the app changes the radio, and that the session diagnostic no longer lists `refused KEYSPD -4`. This step is Q's; record what Q reports.
- [ ] **Step 7: Write the tested-radio wording** in `Rig-Control-Apps.md` from Steps 4 to 6. KX3 and KH1 are "untested" unless they were on the bench.
- [ ] **Step 8: Propose commit.** Title: `docs: keyer speed tested radios (#155)`.
- [ ] **Step 9: Propose the issue update to Q.** A comment on #155 listing exactly what was tested and on what, plus two follow-up issues to file: a web UI speed control, and the `\stop_morse` / `stop_voice_mem` gap against halo's SOTAcat entry.
