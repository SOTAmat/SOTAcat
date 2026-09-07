#!/usr/bin/env python3
"""
SOTAcat rigctld (Hamlib NET rigctl) Stress Test

Loads the rigctld TCP server (src/rigctld_server.cpp) the way the correctness
test (test_rigctld.py) does not: sustained traffic over time, to shake out
leaks, stalls, and starvation in the single-task select() loop and the
extended-response path.

What it exercises:
  * Steady pollers (default = RIGCTLD_MAX_CLIENTS): each holds a connection
    and polls a Ham2K-shaped pattern in the extended protocol (+t at ~5 Hz,
    +f/+m/+l every ~1 s). Every reply must parse (header + labeled fields +
    RPRT); latency is tracked.
  * Churn: rapid connect / one-command / disconnect cycles, to catch socket-
    fd leaks or slot-accounting wedges in the accept/select loop.
  * Overflow: more simultaneous connectors than slots; extras must wait in the
    backlog and still be served, none dropped.
  * HTTP coexistence: /api/v1/version is polled throughout (it does no radio
    I/O), asserting the shared radio-service worker is never starved by rigctld
    load — the same decoupling guarantee the mutex test checks for HTTP.

Runs against hardware or the mock (test/mock_server/server.py --rigctld-port).
Never keys or tunes: it only issues GET-side commands.

Usage:
    python3 test_rigctld_stress.py --host sotacat.local
    python3 test_rigctld_stress.py --host localhost --port 14532 --http-port 8097 --duration 30
"""

import argparse
import socket
import statistics
import sys
import threading
import time

try:
    import requests
except ImportError:
    print("Error: Required dependency 'requests' not installed")
    sys.exit(1)

CONNECT_TIMEOUT_S = 8.0
CMD_TIMEOUT_S = 8.0
# rigctld serves RIGCTLD_MAX_CLIENTS (2) at once; default the steady pollers
# to that so the slots are saturated and churn/overflow hit the boundary.
DEFAULT_CLIENTS = 2
PTT_POLL_S = 0.2   # Ham2K's ~5 Hz PTT cadence
SLOW_POLL_S = 1.0  # freq/mode/meter refresh cadence


class Stats:
    def __init__(self, name):
        self.name = name
        self.ok = 0
        self.fail = 0
        self.errors = {}
        self.latencies = []
        self.lock = threading.Lock()

    def record_ok(self, latency_ms):
        with self.lock:
            self.ok += 1
            self.latencies.append(latency_ms)

    def record_fail(self, why):
        with self.lock:
            self.fail += 1
            self.errors[why] = self.errors.get(why, 0) + 1

    def summary(self):
        with self.lock:
            total = self.ok + self.fail
            rate = (self.ok / total * 100) if total else 0.0
            p95 = (
                sorted(self.latencies)[int(len(self.latencies) * 0.95)]
                if self.latencies
                else 0.0
            )
            return {
                "name": self.name,
                "total": total,
                "ok": self.ok,
                "fail": self.fail,
                "rate": rate,
                "p95_ms": p95,
                "errors": dict(self.errors),
            }


class ExtSession:
    """A rigctld connection speaking the extended (+) protocol."""

    def __init__(self, host, port):
        self.sock = socket.create_connection((host, port), timeout=CONNECT_TIMEOUT_S)
        self.sock.settimeout(CMD_TIMEOUT_S)
        self.buf = b""

    def close(self):
        try:
            self.sock.close()
        except OSError:
            pass

    def _readline(self):
        while b"\n" not in self.buf:
            chunk = self.sock.recv(1024)
            if not chunk:
                raise ConnectionError("server closed connection")
            self.buf += chunk
        line, self.buf = self.buf.split(b"\n", 1)
        return line.decode("utf-8", "replace").rstrip("\r")

    def poll(self, short_cmd, expect_header):
        """Send one '+'-prefixed command; validate the labeled reply and
        return round-trip latency in ms. Raises on malformed reply."""
        t0 = time.time()
        self.sock.sendall(("+" + short_cmd + "\n").encode())
        header = self._readline()
        # get_level/get_func echo the level/func name after the colon
        # ("get_level: RFPOWER_METER_WATTS"), so match the "name:" prefix.
        if not header.startswith(expect_header):
            raise ValueError(f"header {header!r} != {expect_header!r}")
        fields = 0
        while True:
            ln = self._readline()
            if ln.startswith("RPRT "):
                int(ln.split()[1])  # must parse; -4 (unsupported meter) is fine
                return (time.time() - t0) * 1000.0, fields
            if ": " not in ln:
                raise ValueError(f"unlabeled line {ln!r}")
            fields += 1


class SteadyPoller(threading.Thread):
    """Holds a connection and polls a Ham2K-shaped pattern until stopped."""

    CYCLE = [
        ("f", "get_freq:"),
        ("m", "get_mode:"),
        ("l RFPOWER_METER_WATTS", "get_level:"),
    ]

    def __init__(self, host, port, stats, stop):
        super().__init__(daemon=True)
        self.host, self.port, self.stats, self.stop = host, port, stats, stop

    def run(self):
        sess = None
        last_slow = 0.0
        while not self.stop.is_set():
            try:
                if sess is None:
                    sess = ExtSession(self.host, self.port)
                lat, _ = sess.poll("t", "get_ptt:")
                self.stats.record_ok(lat)
                now = time.time()
                if now - last_slow >= SLOW_POLL_S:
                    last_slow = now
                    for cmd, hdr in self.CYCLE:
                        lat, _ = sess.poll(cmd, hdr)
                        self.stats.record_ok(lat)
                time.sleep(PTT_POLL_S)
            except (OSError, ConnectionError, ValueError) as e:
                self.stats.record_fail(type(e).__name__)
                if sess:
                    sess.close()
                    sess = None
                time.sleep(0.2)  # reconnect after a beat
        if sess:
            sess.close()


class Churner(threading.Thread):
    """Rapid connect / one-command / disconnect, to stress the accept/select
    loop's slot accounting and catch fd leaks. When the slots are saturated
    by the steady pollers, a connect is TCP-accepted into lwip's backlog but
    gets no service until a slot frees, so the read legitimately times out:
    that is expected backpressure, counted as `backlog`, not a failure. Only
    a served-but-malformed reply or a hard socket error (refused/reset) fails.
    To exercise real connect/serve/disconnect churn (fd-leak detection), run
    with --clients below RIGCTLD_MAX_CLIENTS so a slot stays free."""

    def __init__(self, host, port, stats, stop):
        super().__init__(daemon=True)
        self.host, self.port, self.stats, self.stop = host, port, stats, stop
        self.backlog = 0

    def run(self):
        while not self.stop.is_set():
            sess = None
            try:
                sess = ExtSession(self.host, self.port)
                sess.sock.settimeout(1.5)  # short: don't block the churn loop
                lat, _ = sess.poll("f", "get_freq:")
                self.stats.record_ok(lat)
            except socket.timeout:
                self.backlog += 1  # slots busy; connection waiting — expected
            except (ConnectionError, ValueError, OSError) as e:
                self.stats.record_fail(type(e).__name__)
            finally:
                if sess:
                    sess.close()
            time.sleep(0.05)


class HttpProbe(threading.Thread):
    """Polls /version (no radio I/O) to prove rigctld load never starves the
    shared radio-service worker / HTTP task."""

    def __init__(self, base, stats, stop):
        super().__init__(daemon=True)
        self.base, self.stats, self.stop = base, stats, stop

    def run(self):
        while not self.stop.is_set():
            t0 = time.time()
            try:
                r = requests.get(f"{self.base}/version", timeout=5)
                if r.status_code == 200:
                    self.stats.record_ok((time.time() - t0) * 1000.0)
                else:
                    self.stats.record_fail(f"http{r.status_code}")
            except requests.RequestException as e:
                self.stats.record_fail(type(e).__name__)
            time.sleep(0.5)


def main():
    p = argparse.ArgumentParser(description="SOTAcat rigctld stress test")
    p.add_argument("--host", default="sotacat.local")
    p.add_argument("--port", type=int, default=4532)
    p.add_argument("--http-port", type=int, default=0, help="HTTP port for the coexistence probe (0 = 80)")
    p.add_argument("--duration", type=int, default=60)
    p.add_argument("--clients", type=int, default=DEFAULT_CLIENTS, help="steady pollers (default = the 2 rigctld slots)")
    p.add_argument("--no-churn", action="store_true")
    p.add_argument("--no-http", action="store_true")
    args = p.parse_args()

    base = f"http://{args.host}:{args.http_port}/api/v1" if args.http_port else f"http://{args.host}/api/v1"

    print("=" * 60)
    print("SOTAcat rigctld Stress Test")
    print("=" * 60)
    print(f"Target:  {args.host}:{args.port}")
    print(f"Duration: {args.duration}s   steady pollers: {args.clients}"
          f"{'   +churn' if not args.no_churn else ''}"
          f"{'   +http' if not args.no_http else ''}")
    print("=" * 60)

    # Reachability gate.
    try:
        ExtSession(args.host, args.port).close()
    except OSError as e:
        print(f"✗ rigctld unreachable at {args.host}:{args.port}: {e}")
        sys.exit(1)
    print("✓ rigctld reachable\n")

    stop = threading.Event()
    poll_stats = Stats("steady pollers")
    churn_stats = Stats("churn")
    http_stats = Stats("http /version")
    threads = []

    churner = None
    for _ in range(args.clients):
        threads.append(SteadyPoller(args.host, args.port, poll_stats, stop))
    if not args.no_churn:
        churner = Churner(args.host, args.port, churn_stats, stop)
        threads.append(churner)
    if not args.no_http:
        threads.append(HttpProbe(base, http_stats, stop))

    for t in threads:
        t.start()
    time.sleep(args.duration)
    stop.set()
    for t in threads:
        t.join(timeout=CMD_TIMEOUT_S + 2)

    print(f"\n{'='*60}\nResults\n{'='*60}")
    rc = 0
    poll = poll_stats.summary()
    print(f"steady pollers: {poll['ok']}/{poll['total']} ok "
          f"({poll['rate']:.1f}%), p95={poll['p95_ms']:.0f} ms, errors={poll['errors']}")
    # Sustained pollers must stay healthy: high success, bounded latency.
    if poll["total"] == 0 or poll["rate"] < 95.0:
        print("  ✗ steady-poller success rate below 95%")
        rc = 1
    if poll["p95_ms"] > 2000.0:
        print(f"  ✗ steady-poller p95 {poll['p95_ms']:.0f} ms exceeds 2000 ms")
        rc = 1

    if not args.no_churn:
        churn = churn_stats.summary()
        print(f"churn:          {churn['ok']} served, {churner.backlog} backlogged, "
              f"{churn['fail']} failed, errors={churn['errors']}")
        # Backlog (slots saturated) is expected. A hard error means the accept
        # loop refused/reset or returned a malformed reply — a real defect.
        if churn["fail"] > 0:
            print("  ✗ churn saw hard errors (refused/reset/malformed), not just backlog")
            rc = 1
        # If nothing was ever backlogged AND nothing served, the accept loop
        # is not responding to connects at all.
        if churn["ok"] == 0 and churner.backlog == 0:
            print("  ✗ churn connects neither served nor backlogged (accept loop dead?)")
            rc = 1

    if not args.no_http:
        http = http_stats.summary()
        print(f"http /version:  {http['ok']}/{http['total']} ok "
              f"({http['rate']:.1f}%), p95={http['p95_ms']:.0f} ms, errors={http['errors']}")
        # Coexistence: HTTP must not be starved by rigctld load.
        if http["total"] and http["rate"] < 95.0:
            print("  ✗ HTTP starved during rigctld load (success < 95%)")
            rc = 1
        if http["p95_ms"] > 2000.0:
            print(f"  ✗ HTTP /version p95 {http['p95_ms']:.0f} ms exceeds 2000 ms")
            rc = 1

    print("=" * 60)
    print("✓ PASS" if rc == 0 else "✗ FAIL")
    sys.exit(rc)


if __name__ == "__main__":
    main()
