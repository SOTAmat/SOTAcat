#!/usr/bin/env python3
"""
SOTAcat Radio HTTP Contract Test

Asserts the radio GET/SET HTTP contract from
docs/superpowers/specs/2026-08-17-radio-async-handlers-design.md against
either real hardware or the mock server (test/mock_server/server.py):

  * GET frequency / mode / connectionStatus: bare-text payloads, each answers
    within GET_WAIT_MS (+ margin) regardless of radio state.
  * PUT frequency / mode: 204 when applied (and an immediate GET reads the
    new value back), 202 only when confirmation outran SET_WAIT_MS, 503 when
    the link is down or FT8 holds the radio, 404 on bad parameters.
  * Concurrency: a burst of parallel radio requests never exhausts sockets;
    /version stays fast; every request completes within a bound.
  * (mock only) radio-dead / FT8 scenarios via /api/v1/_debug/state.

Usage:
    python3 test_radio_contract.py --host sotacat.local
    python3 test_radio_contract.py --host localhost:8080 --expect-radio healthy
    python3 test_radio_contract.py --host localhost:8080 --expect-radio dead
"""

import argparse
import concurrent.futures
import sys
import time

try:
    import requests
except ImportError:
    print("Error: Required dependency 'requests' not installed")
    print("Install with: pip3 install requests")
    sys.exit(1)

# Mirror include/radio_park_httpd.h; test bounds add network margin.
GET_WAIT_MS = 300
SET_WAIT_MS = 1500
NET_MARGIN_MS = 300
GET_BOUND_S = (GET_WAIT_MS + NET_MARGIN_MS) / 1000.0
SET_BOUND_S = (SET_WAIT_MS + NET_MARGIN_MS) / 1000.0
STATUS_GLYPHS = {"⚫", "⚪", "🔴", "🟢"}
MODES = {"UNKNOWN", "LSB", "USB", "CW", "FM", "AM", "DATA", "CW_R", "DATA_R"}


class Failure(Exception):
    pass


class ContractTest:
    def __init__(self, host: str, expect_radio: str, concurrency: int):
        self.base = f"http://{host}/api/v1"
        self.expect_radio = expect_radio
        self.concurrency = concurrency
        self.passed = 0
        self.failed = 0
        self.skipped = 0
        self.mock = self._detect_mock()

    # -- helpers ------------------------------------------------------------
    def _detect_mock(self) -> bool:
        try:
            r = requests.get(f"{self.base}/_debug/state", timeout=2)
            return r.status_code == 200
        except requests.RequestException:
            return False

    def mock_state(self, **kv):
        assert self.mock
        requests.post(f"{self.base}/_debug/state", json=kv, timeout=2)

    def get(self, ep, timeout=5.0):
        t0 = time.time()
        r = requests.get(f"{self.base}/{ep}", timeout=timeout)
        r.encoding = "utf-8"  # firmware sends no charset; browsers' text() assumes UTF-8
        return r, time.time() - t0

    def put(self, ep, timeout=5.0):
        t0 = time.time()
        r = requests.put(f"{self.base}/{ep}", timeout=timeout)
        r.encoding = "utf-8"
        return r, time.time() - t0

    def check(self, name, fn):
        try:
            fn()
            self.passed += 1
            print(f"  PASS  {name}")
        except Failure as e:
            self.failed += 1
            print(f"  FAIL  {name}: {e}")
        except requests.RequestException as e:
            self.failed += 1
            print(f"  FAIL  {name}: request error {e}")

    def skip(self, name, why):
        self.skipped += 1
        print(f"  SKIP  {name}: {why}")

    @staticmethod
    def expect(cond, msg):
        if not cond:
            raise Failure(msg)

    def wait_get(self, ep, want, timeout_s):
        """Poll GET ep until payload == want or timeout; return final payload."""
        deadline = time.time() + timeout_s
        last = None
        while time.time() < deadline:
            r, _ = self.get(ep)
            last = r.text.strip()
            if r.status_code == 200 and last == want:
                return last
            time.sleep(0.2)
        return last

    # -- GET contract -----------------------------------------------------
    def test_get_shapes_and_bounds(self):
        for ep, valid in (("frequency", lambda t: t.isdigit() and int(t) > 0),
                          ("mode", lambda t: t in MODES),
                          ("connectionStatus", lambda t: t in STATUS_GLYPHS)):
            def one(ep=ep, valid=valid):
                worst = 0.0
                for _ in range(10):
                    r, dt = self.get(ep)
                    worst = max(worst, dt)
                    if ep in ("frequency", "mode") and r.status_code in (500, 503):
                        continue  # 500: nothing cached yet; 503: link down — both legal
                    self.expect(r.status_code == 200, f"HTTP {r.status_code}")
                    body = r.text.strip()
                    self.expect(valid(body), f"unexpected payload {body!r}")
                    self.expect("no-store" in r.headers.get("Cache-Control", ""),
                                "missing Cache-Control: no-store")
                self.expect(worst <= GET_BOUND_S,
                            f"slowest GET {worst*1000:.0f} ms > {GET_BOUND_S*1000:.0f} ms bound")
            self.check(f"GET {ep}: payload shape, headers, <= {GET_BOUND_S*1000:.0f} ms", one)

    # -- SET contract -----------------------------------------------------
    def test_bad_params(self):
        def freq():
            r, _ = self.put("frequency?frequency=abc")
            self.expect(r.status_code == 404, f"expected 404, got {r.status_code}")

        def mode():
            r, _ = self.put("mode?mode=XYZ")
            self.expect(r.status_code == 404, f"expected 404, got {r.status_code}")

        def numeric():
            # Strict numeric parsing (no atoi leniency): each of these must be
            # refused BEFORE anything reaches the radio. "0 W", "-1", "12abc"
            # and "" would previously have parsed as 0 / partial values.
            for ep, want in (("power?power=abc", 404), ("power?power=12abc", 404),
                             ("power?power=", 404), ("power?power=-1", 404),
                             ("volume?delta=abc", 404), ("frequency?frequency=14e6", 404),
                             ("frequency?frequency=-5", 404), ("time?time=abc", 400),
                             ("time?time=-1", 400)):
                r, _ = self.put(ep)
                self.expect(r.status_code == want, f"{ep}: expected {want}, got {r.status_code}")
        self.check("PUT frequency (invalid) -> 404", freq)
        self.check("PUT mode (invalid) -> 404", mode)
        self.check("PUT numeric params: junk/partial/negative rejected", numeric)

    def test_read_your_write(self):
        if self.expect_radio == "dead":
            return self._test_sets_when_dead()

        def freq():
            r, _ = self.get("frequency")
            self.expect(r.status_code == 200, "cannot read current frequency")
            orig = int(r.text.strip())
            new = orig + (5000 if orig < 14_300_000 else -5000)
            try:
                r, dt = self.put(f"frequency?frequency={new}")
                self.expect(r.status_code in (204, 202), f"expected 204/202, got {r.status_code}")
                self.expect(dt <= SET_BOUND_S, f"PUT took {dt*1000:.0f} ms > bound")
                if r.status_code == 204:
                    g, _ = self.get("frequency")
                    self.expect(g.text.strip() == str(new),
                                f"204 but immediate GET read {g.text.strip()!r}, want {new}")
                else:
                    got = self.wait_get("frequency", str(new), 3.0)
                    self.expect(got == str(new), f"202 but value never became {new} (last {got!r})")
            finally:
                self.put(f"frequency?frequency={orig}")
                self.wait_get("frequency", str(orig), 3.0)

        def mode():
            r, _ = self.get("mode")
            self.expect(r.status_code == 200, "cannot read current mode")
            orig = r.text.strip()
            new = "CW" if orig != "CW" else "USB"
            try:
                r, dt = self.put(f"mode?mode={new}")
                self.expect(r.status_code in (204, 202), f"expected 204/202, got {r.status_code}")
                self.expect(dt <= SET_BOUND_S, f"PUT took {dt*1000:.0f} ms > bound")
                if r.status_code == 204:
                    g, _ = self.get("mode")
                    self.expect(g.text.strip() == new,
                                f"204 but immediate GET read {g.text.strip()!r}, want {new}")
                else:
                    got = self.wait_get("mode", new, 3.0)
                    self.expect(got == new, f"202 but mode never became {new} (last {got!r})")
            finally:
                if orig in MODES and orig != "UNKNOWN":
                    self.put(f"mode?mode={orig}")
                    self.wait_get("mode", orig, 3.0)

        def ssb_after_tune():
            # PUT freq then PUT mode=SSB must pick the sideband for the NEW
            # frequency (resolved at apply time), not the pre-tune one.
            r, _ = self.get("frequency"); orig_f = int(r.text.strip())
            r, _ = self.get("mode"); orig_m = r.text.strip()
            try:
                self.put("frequency?frequency=7200000")     # 40 m -> LSB
                self.put("mode?mode=SSB")
                self.expect(self.wait_get("mode", "LSB", 3.0) == "LSB", "SSB at 7.2 MHz did not resolve to LSB")
                self.put("frequency?frequency=14200000")    # 20 m -> USB
                r, _ = self.put("mode?mode=SSB")
                self.expect(r.status_code in (204, 202), f"expected 204/202, got {r.status_code}")
                self.expect(self.wait_get("mode", "USB", 3.0) == "USB",
                            "SSB right after tuning to 14.2 MHz did not resolve to USB")
            finally:
                self.put(f"frequency?frequency={orig_f}")
                if orig_m in MODES and orig_m != "UNKNOWN":
                    self.put(f"mode?mode={orig_m}")
                self.wait_get("frequency", str(orig_f), 3.0)

        def power():
            r, _ = self.get("power")
            if r.status_code == 404:
                return  # radio doesn't support power read; nothing to round-trip
            self.expect(r.status_code == 200 and r.text.strip().lstrip("-").isdigit(),
                        f"GET power: HTTP {r.status_code} {r.text!r}")
            cur = int(r.text.strip())
            # Re-assert the current value: exercises the SET path with no
            # side effect on the operator's power setting.
            r, dt = self.put(f"power?power={cur}")
            self.expect(r.status_code in (204, 202), f"expected 204/202, got {r.status_code}")
            self.expect(dt <= SET_BOUND_S, f"PUT took {dt*1000:.0f} ms > bound")
            g, _ = self.get("power")
            self.expect(g.text.strip() == str(cur), f"GET power after PUT read {g.text.strip()!r}, want {cur}")
            # NOTE: no "invalid power" probe here on purpose — the firmware
            # parses with atoi(), so power=abc means power=0 and WOULD change
            # the operator's setting on a real radio.

        def volume_get():
            r, dt = self.get("volume")
            self.expect(r.status_code in (200, 404), f"GET volume: HTTP {r.status_code}")
            self.expect(dt <= GET_BOUND_S, f"GET volume took {dt*1000:.0f} ms")
            if r.status_code == 200:
                self.expect(r.text.strip().isdigit(), f"GET volume payload {r.text!r}")

        def time_sync():
            r, dt = self.put(f"time?time={int(time.time())}")
            self.expect(r.status_code in (204, 202), f"expected 204/202, got {r.status_code}")
            self.expect(dt <= SET_BOUND_S, f"PUT time took {dt*1000:.0f} ms > bound")

        self.check("PUT frequency -> 204 and read-your-write", freq)
        self.check("PUT mode -> 204 and read-your-write", mode)
        self.check("PUT mode=SSB resolves against the just-tuned frequency", ssb_after_tune)
        self.check("GET/PUT power -> 204 and read-your-write (or 404 unsupported)", power)
        self.check("GET volume -> bounded, numeric (or 404 unsupported)", volume_get)
        self.check("PUT time -> 204/202, bounded", time_sync)

    def _test_sets_when_dead(self):
        def freq():
            r, dt = self.put("frequency?frequency=14074000")
            # 503 once link-down is detected; 202 is legal in the detection window.
            self.expect(r.status_code in (503, 202), f"expected 503/202, got {r.status_code}")
            self.expect(dt <= SET_BOUND_S, f"PUT took {dt*1000:.0f} ms > bound")

        def status():
            r, _ = self.get("connectionStatus")
            self.expect(r.text.strip() in ("⚫", "⚪"), f"dead radio should show ⚫/⚪, got {r.text!r}")

        def gets():
            # Once the link is down, value GETs say so (503) instead of
            # serving a stale value as live — SOTAmat polls only these.
            r, dt = self.get("frequency")
            self.expect(r.status_code in (503, 200), f"GET frequency: {r.status_code}")
            self.expect(dt <= GET_BOUND_S, f"GET frequency took {dt*1000:.0f} ms")
        self.check("PUT frequency (radio dead) -> 503/202, bounded", freq)
        self.check("connectionStatus (radio dead) -> ⚫", status)
        self.check("GET frequency (radio dead) -> 503 once link-down, bounded", gets)

    # -- SOTAmat app emulation -------------------------------------------
    def test_sotamat_sequences(self):
        """Replays what the SOTAmat app actually does against SOTAcat
        (SotamatApp/Utilities/Max3Bradio.cs, Services/RadioSyncService.cs):
        a 1 s sequential GET frequency -> GET mode poll loop (8 s timeouts,
        5 consecutive failures = 'problematic'), and writes as PUT frequency
        then PUT mode with SOTAmat's normalized mode strings ('SSB', 'DATA',
        'CW', ...), success = any 2xx, re-polled ~100 ms later and compared."""
        if self.expect_radio == "dead":
            return

        def poll_loop():
            fails = 0
            worst = 0.0
            for _ in range(8):
                rf, df = self.get("frequency", timeout=8.0)
                rm, dm = self.get("mode", timeout=8.0)
                worst = max(worst, df, dm)
                ok = rf.status_code == 200 and rf.text.strip().isdigit() and int(rf.text) > 0 \
                    and rm.status_code == 200 and rm.text.strip() != ""
                fails = 0 if ok else fails + 1
                self.expect(fails < 5, "SOTAmat would flag the radio 'problematic'")
                time.sleep(1.0)
            self.expect(worst <= GET_BOUND_S, f"a poll GET took {worst*1000:.0f} ms")

        def write_then_poll():
            r, _ = self.get("frequency"); orig_f = int(r.text.strip())
            r, _ = self.get("mode"); orig_m = r.text.strip()
            try:
                # SOTAmat writes 'SSB' literally and expects the radio to land
                # on the right sideband for the NEW frequency.
                for hz, want in ((7_200_000, "LSB"), (14_200_000, "USB")):
                    r1, _ = self.put(f"frequency?frequency={hz}")
                    r2, _ = self.put("mode?mode=SSB")
                    self.expect(200 <= r1.status_code < 300, f"PUT frequency -> {r1.status_code} (SOTAmat treats non-2xx as failure)")
                    self.expect(200 <= r2.status_code < 300, f"PUT mode=SSB -> {r2.status_code}")
                    time.sleep(0.1)  # SOTAmat re-polls ~100 ms after the write
                    f = self.wait_get("frequency", str(hz), 3.0)
                    m = self.wait_get("mode", want, 3.0)
                    self.expect(f == str(hz), f"re-poll read frequency {f!r}, want {hz}")
                    self.expect(m == want, f"re-poll read mode {m!r} after tuning to {hz} + SSB, want {want}")
                # SOTAmat's 'Data' -> uppercased 'DATA' (and the FT8 alias)
                r, _ = self.put("mode?mode=DATA")
                self.expect(200 <= r.status_code < 300, f"PUT mode=DATA -> {r.status_code}")
                self.expect(self.wait_get("mode", "DATA", 3.0) == "DATA", "mode did not become DATA")
                r, _ = self.put("mode?mode=FT8")
                self.expect(200 <= r.status_code < 300, f"PUT mode=FT8 (alias) -> {r.status_code}")
            finally:
                self.put(f"frequency?frequency={orig_f}")
                if orig_m in MODES and orig_m != "UNKNOWN":
                    self.put(f"mode?mode={orig_m}")
                self.wait_get("frequency", str(orig_f), 3.0)

        self.check("SOTAmat: 1 s GET frequency/mode poll loop stays healthy", poll_loop)
        self.check("SOTAmat: PUT freq + PUT mode=SSB/DATA -> 2xx, re-poll reads them back", write_then_poll)

    # -- concurrency ------------------------------------------------------
    def test_concurrency(self):
        """A parallel-connect burst. On the ESP32 the TCP accept backlog is
        small, so ANY burst wider than ~6 shows +1 s / +3 s SYN-retransmit
        steps — a platform trait, not a radio-path one (test_mutex_stress.py
        documents the same). So the assertion is relative: the radio GET burst
        must be no slower than a same-size /version burst (which never touches
        the radio), and nothing may error (socket exhaustion would)."""
        def burst(eps):
            errors, lat = [], []

            def one(ep):
                try:
                    _, dt = self.get(ep, timeout=10.0)
                    lat.append(dt)
                except requests.RequestException as e:
                    errors.append((ep, str(e)[:60]))

            with concurrent.futures.ThreadPoolExecutor(max_workers=len(eps)) as ex:
                list(ex.map(one, eps))
            lat.sort()
            p95 = lat[int(len(lat) * 0.95)] if lat else 99.0
            return errors, p95, (lat[-1] if lat else 99.0)

        def run():
            n = self.concurrency
            radio = (["frequency", "mode", "connectionStatus"] * (n // 3 + 1))[:n]
            ctrl_err, ctrl_p95, ctrl_max = burst(["version"] * n)
            time.sleep(1.0)
            rad_err, rad_p95, rad_max = burst(radio)
            print(f"        control /version x{n}: p95={ctrl_p95*1000:.0f} ms max={ctrl_max*1000:.0f} ms"
                  f"   radio GETs x{n}: p95={rad_p95*1000:.0f} ms max={rad_max*1000:.0f} ms")
            self.expect(not ctrl_err, f"{len(ctrl_err)} errors in control burst: {ctrl_err[:3]}")
            self.expect(not rad_err, f"{len(rad_err)} errors in radio burst (socket exhaustion?): {rad_err[:3]}")
            self.expect(rad_max < 8.0, f"radio burst request took {rad_max:.1f} s")
            # +1.5 s: the ESP's SYN-retransmit steps quantize p95 in ~1 s jumps,
            # so a +1.0 s margin flapped between runs; a real radio-path stall
            # would still show as several seconds.
            self.expect(rad_p95 <= ctrl_p95 + 1.5,
                        f"radio burst p95 {rad_p95*1000:.0f} ms vs control {ctrl_p95*1000:.0f} ms — radio path adds latency")
        self.check(f"{self.concurrency} parallel radio GETs: no errors, no slower than /version control", run)

    # -- mock-only scenarios ---------------------------------------------
    def test_mock_scenarios(self):
        if not self.mock:
            self.skip("radio-dead / FT8 scenarios", "no _debug endpoint (real hardware)")
            return

        def dead():
            self.mock_state(radio_dead=True)
            try:
                # Drive a few GETs so the emulated link health trips.
                for _ in range(6):
                    _, dt = self.get("frequency")
                    self.expect(dt <= GET_BOUND_S, f"GET {dt*1000:.0f} ms with dead radio")
                    time.sleep(0.1)
                r, _ = self.get("connectionStatus")
                self.expect(r.text.strip() == "⚫", f"expected ⚫ after link-down, got {r.text!r}")
                r, dt = self.get("frequency")
                self.expect(r.status_code == 503, f"GET frequency with link down: expected 503, got {r.status_code}")
                self.expect(dt < 0.5, "503 should be immediate")
                r, dt = self.put("frequency?frequency=14074000")
                self.expect(r.status_code == 503, f"expected 503 with link down, got {r.status_code}")
                self.expect(dt < 0.5, "503 should be immediate")
            finally:
                self.mock_state(radio_dead=False)
            # Recovery: any stale GET (connectionStatus included) arms a cheap
            # TQ probe, throttled to one per ~5 s while down. Poll like the
            # client's header does and expect recovery within ~10 s.
            got = None
            deadline = time.time() + 10.0
            while time.time() < deadline:
                r, _ = self.get("connectionStatus")
                got = r.text.strip()
                if got in ("🟢", "🔴"):
                    break
                time.sleep(0.5)
            self.expect(got in ("🟢", "🔴"), f"link did not recover within 10 s (last {got!r})")

        def ft8():
            self.mock_state(ft8=True)
            try:
                r, dt = self.put("frequency?frequency=14074000")
                self.expect(r.status_code == 503, f"expected 503 during FT8, got {r.status_code}")
                self.expect("FT8" in r.text, "503 body should say FT8")
                r, dt = self.get("frequency")
                self.expect(dt < 0.2, f"GET during FT8 should be instant, took {dt*1000:.0f} ms")
                r, _ = self.get("connectionStatus")
                self.expect(r.text.strip() == "⚪", f"expected ⚪ during FT8, got {r.text!r}")
            finally:
                self.mock_state(ft8=False)

        def slow_radio():
            # CAT slower than the SET bound -> 202, then the value lands.
            self.mock_state(radio_latency_ms=SET_WAIT_MS + 500)
            try:
                r, dt = self.put("frequency?frequency=10136000")
                self.expect(r.status_code == 202, f"expected 202 for slow radio, got {r.status_code}")
                self.expect(dt <= SET_BOUND_S, f"PUT took {dt*1000:.0f} ms > bound")
                self.expect(self.wait_get("frequency", "10136000", 6.0) == "10136000",
                            "202'd frequency never applied")
                r, dt = self.get("mode")
                self.expect(dt <= GET_BOUND_S, f"GET with slow radio took {dt*1000:.0f} ms")
            finally:
                self.mock_state(radio_latency_ms=50)
                self.put("frequency?frequency=14285000")

        self.check("mock: radio dead -> GETs bounded, ⚫, PUT 503, recovers", dead)
        self.check("mock: FT8 active -> PUT 503, GET instant, ⚪", ft8)
        self.check("mock: CAT slower than SET bound -> 202 then applied", slow_radio)

    # -- driver -----------------------------------------------------------
    def run(self) -> int:
        print("=" * 60)
        print(f"Radio HTTP contract test  target={self.base}  "
              f"{'(mock)' if self.mock else '(hardware)'}  expect_radio={self.expect_radio}")
        print("=" * 60)
        self.test_get_shapes_and_bounds()
        self.test_bad_params()
        self.test_read_your_write()
        self.test_sotamat_sequences()
        self.test_concurrency()
        self.test_mock_scenarios()
        print("-" * 60)
        print(f"passed={self.passed} failed={self.failed} skipped={self.skipped}")
        return 1 if self.failed else 0


def main():
    p = argparse.ArgumentParser(description="SOTAcat radio HTTP contract test")
    p.add_argument("--host", default="sotacat.local", help="host[:port] (device or mock)")
    p.add_argument("--expect-radio", choices=["healthy", "dead"], default="healthy",
                   help="what the radio link is expected to be (hardware runs)")
    p.add_argument("--concurrency", type=int, default=30, help="parallel GETs in the burst test")
    args = p.parse_args()
    sys.exit(ContractTest(args.host, args.expect_radio, args.concurrency).run())


if __name__ == "__main__":
    main()
