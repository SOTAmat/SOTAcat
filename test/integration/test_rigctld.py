#!/usr/bin/env python3
"""
SOTAcat rigctld (Hamlib NET rigctl) Contract Test

Asserts the rigctld TCP contract of src/rigctld_server.cpp against real
hardware or the mock (test/mock_server/server.py --rigctld-port):

  * Handshake: chk_vfo, dump_state (protocol version 1, "done"-terminated).
  * GETs: freq numeric, mode Hamlib-named + passband line, ptt 0/1,
    vfo/split fixed, info "SOTAcat <radio>", RFPOWER/AF in 0.0..1.0.
  * SETs: set_freq applies and reads back (via rigctld AND the HTTP API —
    the two faces must agree), then restores; same-value set_mode; AF set
    to the current value is a no-op RPRT 0.
  * S-meter: RAWSTR in bar units 0..15, STRENGTH consistent dB-rel-S9
    (RPRT -4 on radios without an S-meter).
  * Protocol polish: get_powerstat 1/0, set_vfo VFOA no-op, TUNER
    get/set_func, set_powerstat permanently unimplemented (-4).
  * Errors: unknown command/level RPRT -4, bad args RPRT -1.
  * Sessions: sequential connections; two clients are served CONCURRENTLY
    (commands serialized server-side) and a third waits in the backlog
    until a slot frees.
  * Client gating: the real installed Hamlib `rigctl` binary accepts our
    levels — proving the dump_state bitmasks, not just the raw wire.
  * (mock only, via HTTP _debug/state) radio-dead -> GET/SET RPRT -6;
    FT8 -> GET serves the stale snapshot, SET RPRT -9, morse RPRT -9;
    PTT set/readback; ATU tune via set_func TUNER; morse RPRT 0. Never
    keys or tunes real hardware.

Usage:
    python3 test_rigctld.py --host sotacat.local
    python3 test_rigctld.py --host localhost --port 4532 --http-port 8099
"""

import argparse
import shutil
import socket
import subprocess
import sys
import time

try:
    import requests
except ImportError:
    print("Error: Required dependency 'requests' not installed")
    sys.exit(1)

RESPONSE_TIMEOUT_S = 8.0  # worst case: SET waits SET_APPLY_DEADLINE_MS (5 s) + margin
MODES = {"USB", "LSB", "CW", "CWR", "AM", "FM", "PKTUSB", "PKTLSB"}


class Failure(Exception):
    pass


class Rigctl:
    """Minimal line-oriented NET rigctl client (no Hamlib dependency, so no
    client-side capability gating — every wire command is reachable)."""

    def __init__(self, host, port):
        self.sock = socket.create_connection((host, port), timeout=RESPONSE_TIMEOUT_S)
        self.sock.settimeout(RESPONSE_TIMEOUT_S)
        self.buf = b""

    def close(self):
        self.sock.close()

    def _readline(self):
        while b"\n" not in self.buf:
            chunk = self.sock.recv(1024)
            if not chunk:
                raise Failure("connection closed by server")
            self.buf += chunk
        line, self.buf = self.buf.split(b"\n", 1)
        return line.decode()

    def cmd(self, line, reply_lines=1):
        """Send one command, return the reply lines. RPRT replies are always
        a single line regardless of reply_lines."""
        self.sock.sendall((line + "\n").encode())
        first = self._readline()
        if first.startswith("RPRT"):
            return [first]
        lines = [first]
        for _ in range(reply_lines - 1):
            lines.append(self._readline())
        return lines

    def rprt(self, line):
        """Send a command that must reply RPRT; return the numeric code."""
        reply = self.cmd(line)
        if len(reply) != 1 or not reply[0].startswith("RPRT "):
            raise Failure(f"{line!r}: expected RPRT, got {reply!r}")
        return int(reply[0].split()[1])


class RigctldTest:
    def __init__(self, host, port, http_port, expect_radio):
        self.host = host
        self.port = port
        self.base = f"http://{host}:{http_port}/api/v1" if http_port else f"http://{host}/api/v1"
        self.expect_radio = expect_radio
        self.passed = self.failed = self.skipped = 0
        self.mock = self._detect_mock()

    def _detect_mock(self):
        try:
            return requests.get(f"{self.base}/_debug/state", timeout=2).status_code == 200
        except requests.RequestException:
            return False

    def mock_state(self, **kv):
        assert self.mock
        requests.post(f"{self.base}/_debug/state", json=kv, timeout=2)
        time.sleep(0.1)

    def http_get(self, ep):
        r = requests.get(f"{self.base}/{ep}", timeout=RESPONSE_TIMEOUT_S)
        r.encoding = "utf-8"
        return r

    def check(self, name, fn):
        try:
            fn()
        except Failure as e:
            self.failed += 1
            print(f"  ✗ {name}: {e}")
        except Exception as e:  # noqa: BLE001 — report, keep testing
            self.failed += 1
            print(f"  ✗ {name}: unexpected {type(e).__name__}: {e}")
        else:
            self.passed += 1
            print(f"  ✓ {name}")

    def skip(self, name, why):
        self.skipped += 1
        print(f"  - {name} (skipped: {why})")

    def expect(self, cond, msg):
        if not cond:
            raise Failure(msg)

    # -- healthy-radio checks --------------------------------------------
    def t_handshake(self):
        c = Rigctl(self.host, self.port)
        try:
            self.expect(c.cmd("\\chk_vfo") == ["0"], "chk_vfo != 0")
            dump = []
            c.sock.sendall(b"\\dump_state\n")
            while True:
                line = c._readline()
                dump.append(line)
                if line == "done":
                    break
                self.expect(len(dump) < 60, "dump_state unterminated")
            self.expect(dump[0] == "1", f"protocol version {dump[0]!r} != 1")
            self.expect(dump[1] == "2", f"rig model {dump[1]!r} != 2 (netrigctl)")
            self.expect("0x44001008" in dump, "has_get_level mask not advertised")
            self.expect(c.cmd("\\get_powerstat") == ["1"], "get_powerstat != 1 with live radio")
        finally:
            c.close()

    def t_gets(self):
        c = Rigctl(self.host, self.port)
        try:
            freq = c.cmd("f")[0]
            self.expect(freq.isdigit() and int(freq) > 0, f"freq {freq!r} not a positive integer")
            mode, passband = c.cmd("m", reply_lines=2)
            self.expect(mode in MODES, f"mode {mode!r} not a Hamlib mode name")
            self.expect(passband.lstrip("-").isdigit(), f"passband {passband!r} not numeric")
            ptt = c.cmd("t")[0]
            self.expect(ptt in ("0", "1"), f"ptt {ptt!r} not 0/1")
            self.expect(c.cmd("v") == ["VFOA"], "get_vfo != VFOA")
            self.expect(c.cmd("s", reply_lines=2) == ["0", "VFOA"], "get_split_vfo != 0/VFOA")
            info = c.cmd("_")[0]
            self.expect(info.startswith("SOTAcat "), f"info {info!r} lacks SOTAcat prefix")
            v = c.cmd("l RFPOWER")[0]
            self.expect(0.0 <= float(v) <= 1.0, f"RFPOWER {v!r} outside 0..1")
            v = c.cmd("l AF")[0]
            if v != "RPRT -4":  # -4 is legitimate on radios without AF control (KH1)
                self.expect(0.0 <= float(v) <= 1.0, f"AF {v!r} outside 0..1")
            raw = c.cmd("l RAWSTR")[0]
            if raw != "RPRT -4":  # -4 is legitimate on radios without an S-meter (KH1)
                self.expect(0 <= int(raw) <= 15, f"RAWSTR {raw!r} outside 0..15")
                db = int(c.cmd("l STRENGTH")[0])
                self.expect(db == (int(raw) - 9) * 6 or -60 <= db <= 60,
                            f"STRENGTH {db} inconsistent with RAWSTR {raw}")
        finally:
            c.close()

    def t_set_freq_roundtrip(self):
        c = Rigctl(self.host, self.port)
        try:
            orig = int(c.cmd("f")[0])
            target = orig + 1000
            self.expect(c.rprt(f"F {target}") == 0, "set_freq RPRT != 0")
            self.expect(int(c.cmd("f")[0]) == target, "rigctld readback mismatch")
            http = self.http_get("frequency")
            self.expect(http.status_code == 200 and int(http.text) == target,
                        f"HTTP face disagrees: {http.text!r} != {target}")
            self.expect(c.rprt(f"F {orig}") == 0, "restore RPRT != 0")
            self.expect(int(c.cmd("f")[0]) == orig, "restore readback mismatch")
        finally:
            c.close()

    def t_set_mode_same(self):
        c = Rigctl(self.host, self.port)
        try:
            mode = c.cmd("m", reply_lines=2)[0]
            self.expect(c.rprt(f"M {mode} 0") == 0, f"set_mode {mode} RPRT != 0")
            self.expect(c.cmd("m", reply_lines=2)[0] == mode, "mode changed unexpectedly")
        finally:
            c.close()

    def t_set_af_noop(self):
        c = Rigctl(self.host, self.port)
        try:
            af = float(c.cmd("l AF")[0])
            self.expect(c.rprt(f"L AF {af:.4f}") == 0, "AF no-op set RPRT != 0")
            self.expect(abs(float(c.cmd("l AF")[0]) - af) < 1e-3, "AF moved on a no-op set")
        finally:
            c.close()

    def t_protocol_polish(self):
        c = Rigctl(self.host, self.port)
        try:
            self.expect(c.rprt("V VFOA") == 0, "set_vfo VFOA != 0")
            self.expect(c.rprt("V VFOB") == -4, "set_vfo VFOB != -4 (no split yet)")
            self.expect(c.cmd("u TUNER") == ["0"], "get_func TUNER != 0")
            self.expect(c.rprt("u BOGUSFUNC") == -4, "unknown get_func != -4")
            self.expect(c.rprt("U BOGUSFUNC 1") == -4, "unknown set_func != -4")
            self.expect(c.rprt("U TUNER 0") == 0, "set_func TUNER 0 != 0 (no-op)")
            self.expect(c.rprt("\\set_powerstat 0") == -4, "set_powerstat must stay unimplemented")
        finally:
            c.close()

    def t_errors(self):
        c = Rigctl(self.host, self.port)
        try:
            self.expect(c.rprt("x") == -4, "unknown short command != -4")
            self.expect(c.rprt("\\bogus_command") == -4, "unknown long command != -4")
            self.expect(c.rprt("l SQUELCH") == -4, "unknown level != -4")
            self.expect(c.rprt("F 0") == -1, "set_freq 0 != -1")
            self.expect(c.rprt("F abc") == -1, "set_freq junk != -1")
            self.expect(c.rprt("M NOSUCHMODE 0") == -1, "bad mode != -1")
            self.expect(c.rprt("L AF") == -1, "set_level w/o value != -1")
            # After all that abuse the session still answers.
            self.expect(int(c.cmd("f")[0]) > 0, "session wedged after errors")
        finally:
            c.close()

    def t_sessions(self):
        # Sequential connections, then quit semantics.
        for _ in range(3):
            c = Rigctl(self.host, self.port)
            try:
                self.expect(int(c.cmd("f")[0]) > 0, "reconnect GET failed")
            finally:
                c.close()
        c = Rigctl(self.host, self.port)
        self.expect(c.rprt("q") == 0, "quit RPRT != 0")
        c.close()

    def t_concurrent_clients(self):
        # Two clients are served concurrently (commands serialized server-side).
        a = Rigctl(self.host, self.port)
        b = Rigctl(self.host, self.port)
        try:
            for _ in range(3):
                self.expect(int(a.cmd("f")[0]) > 0, "client A GET failed")
                self.expect(int(b.cmd("f")[0]) > 0, "client B GET failed")
            # A third connect completes (TCP backlog) but is not served until
            # a slot frees.
            third = socket.create_connection((self.host, self.port), timeout=RESPONSE_TIMEOUT_S)
            third.settimeout(1.5)
            third.sendall(b"f\n")
            try:
                got = third.recv(64)
                raise Failure(f"third client served while both slots held: {got!r}")
            except socket.timeout:
                pass  # expected: waiting for a slot
            a.close()
            third.settimeout(RESPONSE_TIMEOUT_S)
            reply = b""
            while b"\n" not in reply:
                chunk = third.recv(64)
                if not chunk:
                    raise Failure("third client dropped instead of served")
                reply += chunk
            self.expect(int(reply.split(b"\n")[0]) > 0, f"queued third client got {reply!r}")
            third.close()
        finally:
            a.close()
            b.close()

    def t_hamlib_client_gating(self):
        # The decisive dump_state-mask check: a REAL Hamlib client must now
        # accept our levels instead of refusing them client-side.
        rigctl = shutil.which("rigctl")
        if rigctl is None:
            raise Failure("rigctl binary not installed")
        r = subprocess.run(
            [rigctl, "-m", "2", "-r", f"{self.host}:{self.port}", "l", "RFPOWER"],
            capture_output=True, text=True, timeout=30)
        self.expect(r.returncode == 0, f"rigctl l RFPOWER failed: {r.stderr.strip()[:200]}")
        self.expect(0.0 <= float(r.stdout.strip().splitlines()[-1]) <= 1.0,
                    f"rigctl RFPOWER output {r.stdout!r}")

    # -- mock-only scenario checks ---------------------------------------
    def t_ptt_roundtrip(self):
        c = Rigctl(self.host, self.port)
        try:
            self.expect(c.rprt("T 1") == 0, "set_ptt 1 RPRT != 0")
            self.expect(c.cmd("t") == ["1"], "ptt readback != 1")
            self.expect("🔴" in self.http_get("connectionStatus").text, "HTTP status not 🔴 during TX")
            self.expect(c.rprt("T 0") == 0, "set_ptt 0 RPRT != 0")
            self.expect(c.cmd("t") == ["0"], "ptt readback != 0")
        finally:
            c.close()

    def t_atu_tune(self):
        c = Rigctl(self.host, self.port)
        try:
            self.expect(c.rprt("U TUNER 1") == 0, "set_func TUNER 1 RPRT != 0")
        finally:
            c.close()

    def t_morse(self):
        c = Rigctl(self.host, self.port)
        try:
            self.expect(c.rprt("b TEST DE MOCK") == 0, "send_morse RPRT != 0")
            self.expect(c.rprt("b") == -1, "send_morse w/o text != -1")
        finally:
            c.close()

    def t_ft8_exclusive(self):
        self.mock_state(ft8=True)
        try:
            c = Rigctl(self.host, self.port)
            try:
                # GETs serve the (stale) snapshot instantly; SETs are refused.
                t0 = time.time()
                self.expect(int(c.cmd("f")[0]) > 0, "stale GET failed during FT8")
                self.expect(time.time() - t0 < 1.0, "FT8 GET blocked instead of serving stale")
                self.expect(c.rprt("F 14074000") == -9, "SET during FT8 != -9")
                self.expect(c.rprt("T 1") == -9, "PTT during FT8 != -9")
                self.expect(c.rprt("b CQ") == -9, "morse during FT8 != -9")
            finally:
                c.close()
        finally:
            self.mock_state(ft8=False)

    def t_link_down(self):
        self.mock_state(radio_dead=True)
        try:
            c = Rigctl(self.host, self.port)
            try:
                c.cmd("f")  # may still ride the last-known snapshot; drives the link down
                deadline = time.time() + 10
                while time.time() < deadline:
                    if c.rprt("F 14074000") == -6:
                        break
                    time.sleep(0.5)
                else:
                    raise Failure("SET never reported -6 with a dead radio")
                reply = c.cmd("f")[0]
                self.expect(reply == "RPRT -6", f"GET while down: {reply!r} != RPRT -6")
            finally:
                c.close()
        finally:
            self.mock_state(radio_dead=False)
            deadline = time.time() + 15
            while time.time() < deadline:  # let the recovery probe bring the link back
                c = Rigctl(self.host, self.port)
                try:
                    if c.cmd("f")[0].isdigit():
                        return
                except Failure:
                    pass
                finally:
                    c.close()
                time.sleep(1)
            raise Failure("link never recovered after radio_dead cleared")

    def t_down_now(self):
        c = Rigctl(self.host, self.port)
        try:
            deadline = time.time() + 10  # allow the link machine to notice
            while time.time() < deadline and c.cmd("f")[0] != "RPRT -6":
                time.sleep(0.5)
            self.expect(c.cmd("f")[0] == "RPRT -6", "GET while down != -6")
            self.expect(c.rprt("F 14074000") == -6, "SET while down != -6")
        finally:
            c.close()

    # -- runner -----------------------------------------------------------
    def run(self):
        where = "mock" if self.mock else "hardware"
        print(f"rigctld contract test against {self.host}:{self.port} ({where}, expecting {self.expect_radio} radio)")

        if self.expect_radio == "healthy":
            self.check("handshake (chk_vfo, dump_state)", self.t_handshake)
            self.check("GETs (freq/mode/ptt/vfo/info/levels)", self.t_gets)
            self.check("set_freq round-trip, HTTP face agrees", self.t_set_freq_roundtrip)
            self.check("set_mode to current mode", self.t_set_mode_same)
            self.check("set AF to current value is a no-op", self.t_set_af_noop)
            self.check("protocol polish (powerstat/vfo/func)", self.t_protocol_polish)
            self.check("error codes (-1 bad args, -4 unknown)", self.t_errors)
            self.check("sequential sessions and quit", self.t_sessions)
            self.check("two concurrent clients, third waits", self.t_concurrent_clients)
            self.check("real Hamlib client accepts our levels", self.t_hamlib_client_gating)
            if self.mock:
                self.check("PTT set/readback, HTTP shows 🔴", self.t_ptt_roundtrip)
                self.check("ATU tune via set_func TUNER", self.t_atu_tune)
                self.check("morse accepted (mock only)", self.t_morse)
                self.check("FT8: stale GETs, SETs -9", self.t_ft8_exclusive)
                self.check("dead radio: -6, then recovery", self.t_link_down)
            else:
                for name in ("PTT set/readback", "ATU tune", "morse", "FT8 scenario", "dead-radio scenario"):
                    self.skip(name, "never keys/tunes real hardware; run against the mock")
        else:  # dead: the radio is expected to be off/unreachable right now
            self.check("link down: GET and SET report -6", self.t_down_now)

        print(f"\nResult: {self.passed} passed, {self.failed} failed, {self.skipped} skipped")
        return self.failed == 0


def main():
    p = argparse.ArgumentParser(description="SOTAcat rigctld contract test")
    p.add_argument("--host", default="sotacat.local")
    p.add_argument("--port", type=int, default=4532)
    p.add_argument("--http-port", type=int, default=0,
                   help="HTTP API port for coherence checks and mock _debug hooks (0 = default port 80)")
    p.add_argument("--expect-radio", choices=("healthy", "dead"), default="healthy")
    args = p.parse_args()
    ok = RigctldTest(args.host, args.port, args.http_port, args.expect_radio).run()
    sys.exit(0 if ok else 1)


if __name__ == "__main__":
    main()
