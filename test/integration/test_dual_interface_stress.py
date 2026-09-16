#!/usr/bin/env python3
"""
SOTAcat dual-interface stress: Ham2K-shaped rigctld traffic AND real
browser-shaped HTTP traffic at the same time.

Neither existing stress test covers this mix: test_rigctld_stress.py only
probes /version (no radio I/O) for HTTP coexistence, and test_mutex_stress.py
never opens rigctld. This one reproduces a field setup: a logger on port
4532 polling in the extended protocol while one or more browser tabs poll
the web UI, load pages, and tune to spots.

Traffic model (each is a knob):
  * Ham2K sessions: +t at --ptt-hz; +f/+m/+l RFPOWER_METER_WATTS at
    --slow-hz; optionally +l STRENGTH at --smeter-hz.
  * Browser tabs (main.js cadence): GET frequency + GET mode in parallel
    every 3 s, GET connectionStatus every 2 s, batteryInfo + rssi every 60 s.
  * Page loads: every --pageload-s, fetch a tab's HTML/JS/CSS bundle with 6
    parallel connections (Chrome's per-host limit), timing the bundle.
  * Tunes: every --tune-s, PUT frequency then PUT mode (a Chase spot tap),
    then poll GET frequency until it reads back. The radio's starting
    frequency/mode are restored at the end. Never keys TX.
  * Probe: GET /version every 0.5 s (no radio I/O).

Output: per-category totals, p50/p95/max latency, and a per-window table
so a sluggish stretch is visible with its timestamp. Every request slower
than --slow-ms is logged as it happens.

Usage:
    python3 test_dual_interface_stress.py --host sotacat.local --duration 120
    python3 test_dual_interface_stress.py --host localhost --port 14532 --http-port 8097 --duration 20
"""

import argparse
import socket
import sys
import threading
import time
from concurrent.futures import ThreadPoolExecutor

try:
    import requests
except ImportError:
    print("Error: Required dependency 'requests' not installed")
    sys.exit(1)

CONNECT_TIMEOUT_S = 8.0
RIGCTL_CMD_TIMEOUT_S = 8.0
HTTP_TIMEOUT_S = 8.0

T0 = time.time()


def now_s():
    return time.time() - T0


# ---------------------------------------------------------------------------
# Stats
# ---------------------------------------------------------------------------


class Stats:
    """Per-category outcome log with timestamps, so windows can be built."""

    def __init__(self, name, slow_ms):
        self.name = name
        self.slow_ms = slow_ms
        self.ok = []  # (t, latency_ms)
        self.fail = []  # (t, why)
        self.lock = threading.Lock()

    def record_ok(self, latency_ms, detail=""):
        t = now_s()
        with self.lock:
            self.ok.append((t, latency_ms))
        if latency_ms >= self.slow_ms:
            print(f"  [{t:7.1f}s] SLOW {self.name}: {latency_ms:.0f} ms {detail}", flush=True)

    def record_fail(self, why, detail=""):
        t = now_s()
        with self.lock:
            self.fail.append((t, why))
        print(f"  [{t:7.1f}s] FAIL {self.name}: {why} {detail}", flush=True)

    def summary(self):
        with self.lock:
            lat = sorted(l for _, l in self.ok)
            total = len(self.ok) + len(self.fail)
            errors = {}
            for _, why in self.fail:
                errors[why] = errors.get(why, 0) + 1
        pct = lambda p: lat[min(len(lat) - 1, int(len(lat) * p))] if lat else 0.0
        return {
            "name": self.name,
            "total": total,
            "ok": len(lat),
            "fail": len(errors) and sum(errors.values()) or 0,
            "p50": pct(0.5),
            "p95": pct(0.95),
            "max": lat[-1] if lat else 0.0,
            "errors": errors,
        }

    def window(self, w0, w1):
        with self.lock:
            lat = [l for t, l in self.ok if w0 <= t < w1]
            nf = sum(1 for t, _ in self.fail if w0 <= t < w1)
        return len(lat), (max(lat) if lat else 0.0), nf


# ---------------------------------------------------------------------------
# rigctld side
# ---------------------------------------------------------------------------


class ExtSession:
    """A rigctld connection speaking the extended (+) protocol."""

    def __init__(self, host, port):
        self.sock = socket.create_connection((host, port), timeout=CONNECT_TIMEOUT_S)
        self.sock.settimeout(RIGCTL_CMD_TIMEOUT_S)
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
        return (latency_ms, RPRT code)."""
        t0 = time.time()
        self.sock.sendall(("+" + short_cmd + "\n").encode())
        header = self._readline()
        if not header.startswith(expect_header):
            raise ValueError(f"header {header!r} != {expect_header!r}")
        while True:
            ln = self._readline()
            if ln.startswith("RPRT "):
                return (time.time() - t0) * 1000.0, int(ln.split()[1])
            if ": " not in ln:
                raise ValueError(f"unlabeled line {ln!r}")


class Ham2KSession(threading.Thread):
    """One logger connection: PTT at ptt_hz; freq/mode/meter at slow_hz;
    optional S-meter at smeter_hz. An RPRT other than 0 or -4 (unsupported
    meter) is a failure: the server answered but could not serve the value
    (timeout -5, I/O -6)."""

    def __init__(self, host, port, stats, stop, ptt_hz, slow_hz, smeter_hz):
        super().__init__(daemon=True)
        self.host, self.port, self.stats, self.stop = host, port, stats, stop
        self.ptt_period = 1.0 / ptt_hz if ptt_hz > 0 else None
        self.slow_period = 1.0 / slow_hz if slow_hz > 0 else None
        self.smeter_period = 1.0 / smeter_hz if smeter_hz > 0 else None

    def _one(self, sess, cmd, hdr):
        lat, code = sess.poll(cmd, hdr)
        if code == 0 or code == -4:
            self.stats.record_ok(lat, f"+{cmd}")
        else:
            self.stats.record_fail(f"RPRT {code}", f"+{cmd} after {lat:.0f} ms")

    def run(self):
        sess = None
        last_slow = 0.0
        last_smeter = 0.0
        while not self.stop.is_set():
            try:
                if sess is None:
                    sess = ExtSession(self.host, self.port)
                    self.stats.record_ok(0.0, "connect")
                    tick = time.time()
                if self.ptt_period:
                    self._one(sess, "t", "get_ptt:")
                now = time.time()
                if self.slow_period and now - last_slow >= self.slow_period:
                    last_slow = now
                    self._one(sess, "f", "get_freq:")
                    self._one(sess, "m", "get_mode:")
                    self._one(sess, "l RFPOWER_METER_WATTS", "get_level:")
                if self.smeter_period and now - last_smeter >= self.smeter_period:
                    last_smeter = now
                    self._one(sess, "l STRENGTH", "get_level:")
                period = self.ptt_period or self.slow_period or 0.2
                tick += period
                delay = tick - time.time()
                if delay > 0:
                    time.sleep(delay)
                else:
                    tick = time.time()  # fell behind: don't burst to catch up
            except (OSError, ConnectionError, ValueError) as e:
                self.stats.record_fail(type(e).__name__, str(e)[:60])
                if sess:
                    sess.close()
                    sess = None
                time.sleep(0.5)
        if sess:
            sess.close()


# ---------------------------------------------------------------------------
# HTTP side
# ---------------------------------------------------------------------------


def http_get(session, url, stats, detail, timeout=HTTP_TIMEOUT_S, ok_codes=(200,)):
    t0 = time.time()
    try:
        r = session.get(url, timeout=timeout)
        lat = (time.time() - t0) * 1000.0
        if r.status_code in ok_codes:
            stats.record_ok(lat, detail)
            return r
        stats.record_fail(f"http{r.status_code}", f"{detail} after {lat:.0f} ms")
    except requests.RequestException as e:
        stats.record_fail(type(e).__name__, f"{detail} after {(time.time() - t0) * 1000:.0f} ms")
    return None


class BrowserTab(threading.Thread):
    """main.js's pollers for one open tab. Each poller is its own thread
    like the browser's independent timers; frequency+mode go out together."""

    def __init__(self, base, stats, stop, tab_id):
        super().__init__(daemon=True)
        self.base, self.stats, self.stop, self.tab_id = base, stats, stop, tab_id

    def _vfo_loop(self):
        s1, s2 = requests.Session(), requests.Session()
        pool = ThreadPoolExecutor(max_workers=2)
        while not self.stop.is_set():
            t0 = time.time()
            f1 = pool.submit(http_get, s1, f"{self.base}/frequency", self.stats, f"tab{self.tab_id} frequency")
            f2 = pool.submit(http_get, s2, f"{self.base}/mode", self.stats, f"tab{self.tab_id} mode")
            f1.result()
            f2.result()
            self.stop.wait(max(0.0, 3.0 - (time.time() - t0)))
        pool.shutdown(wait=False)

    def _status_loop(self):
        s = requests.Session()
        while not self.stop.is_set():
            t0 = time.time()
            http_get(s, f"{self.base}/connectionStatus", self.stats, f"tab{self.tab_id} connectionStatus")
            self.stop.wait(max(0.0, 2.0 - (time.time() - t0)))

    def _battery_loop(self):
        s1, s2 = requests.Session(), requests.Session()
        pool = ThreadPoolExecutor(max_workers=2)
        while not self.stop.is_set():
            t0 = time.time()
            f1 = pool.submit(http_get, s1, f"{self.base}/batteryInfo", self.stats, f"tab{self.tab_id} batteryInfo")
            f2 = pool.submit(http_get, s2, f"{self.base}/rssi", self.stats, f"tab{self.tab_id} rssi")
            f1.result()
            f2.result()
            self.stop.wait(max(0.0, 60.0 - (time.time() - t0)))
        pool.shutdown(wait=False)

    def run(self):
        ts = [
            threading.Thread(target=self._vfo_loop, daemon=True),
            threading.Thread(target=self._status_loop, daemon=True),
            threading.Thread(target=self._battery_loop, daemon=True),
        ]
        # A real tab's timers do not all fire in the same millisecond, and
        # every tab/probe/loader in this process starting at once is 12+
        # simultaneous fresh connections: past the 12-socket cap the device
        # LRU-purges sessions that have not sent a request yet. Stagger.
        for t in ts:
            t.start()
            self.stop.wait(0.3 + 0.5 * self.tab_id)
        for t in ts:
            t.join()


PAGE_BUNDLES = {
    "run": ["/run.html", "/run.js", "/main.js", "/style.css", "/bandprivileges.js"],
    "chase": ["/chase.html", "/chase.js", "/chase_api.js", "/spots.js", "/main.js", "/style.css"],
    "qrx": ["/qrx.html", "/qrx.js", "/main.js", "/style.css"],
}


def fetch_asset(ip, port, path):
    """One fresh-connection GET on a raw socket, so TCP connect time is
    measured separately from the server's response. Returns
    (connect_ms, total_ms, status)."""
    t0 = time.time()
    s = socket.create_connection((ip, port), timeout=HTTP_TIMEOUT_S)
    tc = (time.time() - t0) * 1000.0
    try:
        s.sendall(f"GET {path} HTTP/1.1\r\nHost: {ip}\r\nCache-Control: no-cache\r\nConnection: close\r\n\r\n".encode())
        buf = b""
        while b"\r\n\r\n" not in buf:
            b = s.recv(65536)
            if not b:
                raise ConnectionError("closed before headers")
            buf += b
        head, _, body = buf.partition(b"\r\n\r\n")
        status = int(head.split(b" ", 2)[1])
        clen, chunked = 0, False
        for ln in head.split(b"\r\n"):
            if ln.lower().startswith(b"content-length:"):
                clen = int(ln.split(b":")[1])
            elif ln.lower().startswith(b"transfer-encoding:") and b"chunked" in ln.lower():
                chunked = True  # the device streams assets chunked and keeps the socket open
        while (chunked and not body.endswith(b"0\r\n\r\n")) or (not chunked and len(body) < clen):
            b = s.recv(65536)
            if not b:
                break
            body += b
    finally:
        s.close()
    return tc, (time.time() - t0) * 1000.0, status


class PageLoader(threading.Thread):
    """Tab switches: fetch a page's bundle with up to 6 parallel fresh
    connections (Chrome's per-host cap), no cache, timing the whole bundle.
    This is the user-visible 'page feels slow' number. A slow bundle is
    logged with each asset's connect/total split, since a whole-second
    connect is a dropped SYN (listen backlog or socket ceiling) while a slow
    total with a fast connect is the server."""

    def __init__(self, ip, port, stats, stop, period_s):
        super().__init__(daemon=True)
        self.ip, self.port, self.stats, self.stop, self.period = ip, port, stats, stop, period_s

    def run(self):
        pool = ThreadPoolExecutor(max_workers=6)
        names = list(PAGE_BUNDLES)
        i = 0
        while not self.stop.is_set():
            name = names[i % len(names)]
            i += 1
            t0 = time.time()
            futs = [pool.submit(fetch_asset, self.ip, self.port, path) for path in PAGE_BUNDLES[name]]
            bad, parts = [], []
            for path, f in zip(PAGE_BUNDLES[name], futs):
                try:
                    tc, tt, status = f.result()
                    parts.append(f"{path} c={tc:.0f}/t={tt:.0f}")
                    if status != 200:
                        bad.append(f"{path}={status}")
                except (OSError, ConnectionError, ValueError) as e:
                    bad.append(f"{path}={type(e).__name__}")
            lat = (time.time() - t0) * 1000.0
            if bad:
                self.stats.record_fail("bundle", f"{name}: {' '.join(bad)} after {lat:.0f} ms")
            else:
                self.stats.record_ok(lat, f"{name} bundle [{' '.join(parts)}]")
            self.stop.wait(self.period)
        pool.shutdown(wait=False)


class Tuner(threading.Thread):
    """A Chase spot tap: PUT frequency, PUT mode, then confirm via GET
    frequency (the UI's own confirmation path). Band-hops so every tune is
    a real ~1.5 s KX band change, the worst case for the worker."""

    TARGETS = [(7032000, "cw"), (14062000, "cw"), (10118000, "cw"), (21062000, "cw")]

    def __init__(self, base, stats, stop, period_s):
        super().__init__(daemon=True)
        self.base, self.stats, self.stop, self.period = base, stats, stop, period_s

    def run(self):
        s = requests.Session()
        i = 0
        self.stop.wait(5.0)  # let the pollers settle first
        while not self.stop.is_set():
            freq, mode = self.TARGETS[i % len(self.TARGETS)]
            i += 1
            t0 = time.time()
            try:
                r = s.put(f"{self.base}/frequency?frequency={freq}", timeout=HTTP_TIMEOUT_S)
                if r.status_code not in (200, 202, 204):
                    self.stats.record_fail(f"http{r.status_code}", f"PUT frequency {freq}")
                    self.stop.wait(self.period)
                    continue
                r = s.put(f"{self.base}/mode?mode={mode}", timeout=HTTP_TIMEOUT_S)
                if r.status_code not in (200, 202, 204):
                    self.stats.record_fail(f"http{r.status_code}", f"PUT mode {mode}")
                # Confirm: the SET is asynchronous (202); poll until readback.
                confirmed = False
                while time.time() - t0 < HTTP_TIMEOUT_S and not self.stop.is_set():
                    r = s.get(f"{self.base}/frequency", timeout=HTTP_TIMEOUT_S)
                    if r.status_code == 200 and r.text.strip() == str(freq):
                        confirmed = True
                        break
                    self.stop.wait(0.2)
                lat = (time.time() - t0) * 1000.0
                if confirmed:
                    self.stats.record_ok(lat, f"tune {freq}")
                elif not self.stop.is_set():  # a tune cut off by shutdown is not a failure
                    self.stats.record_fail("unconfirmed", f"tune {freq} after {lat:.0f} ms")
            except requests.RequestException as e:
                self.stats.record_fail(type(e).__name__, f"tune {freq}")
            self.stop.wait(self.period)


class Probe(threading.Thread):
    def __init__(self, base, stats, stop):
        super().__init__(daemon=True)
        self.base, self.stats, self.stop = base, stats, stop

    def run(self):
        s = requests.Session()
        while not self.stop.is_set():
            http_get(s, f"{self.base}/version", self.stats, "version")
            self.stop.wait(0.5)


# ---------------------------------------------------------------------------
# main
# ---------------------------------------------------------------------------


def read_radio(base):
    f = requests.get(f"{base}/frequency", timeout=5)
    m = requests.get(f"{base}/mode", timeout=5)
    if f.status_code != 200 or m.status_code != 200:
        return None
    return int(f.text.strip()), m.text.strip()


def restore_radio(base, freq, mode):
    requests.put(f"{base}/frequency?frequency={freq}", timeout=5)
    requests.put(f"{base}/mode?mode={mode.lower()}", timeout=5)
    for _ in range(25):
        time.sleep(0.2)
        r = requests.get(f"{base}/frequency", timeout=5)
        if r.status_code == 200 and r.text.strip() == str(freq):
            return True
    return False


def main():
    p = argparse.ArgumentParser(description="SOTAcat dual-interface (rigctld + browser) stress test")
    p.add_argument("--host", default="sotacat.local")
    p.add_argument("--port", type=int, default=4532, help="rigctld port")
    p.add_argument("--http-port", type=int, default=0, help="HTTP port (0 = 80)")
    p.add_argument("--duration", type=int, default=120)
    p.add_argument("--loggers", type=int, default=1, help="Ham2K-shaped rigctld sessions")
    p.add_argument("--ptt-hz", type=float, default=5.0, help="+t poll rate per logger")
    p.add_argument("--slow-hz", type=float, default=1.0, help="+f/+m/+l poll rate per logger")
    p.add_argument("--smeter-hz", type=float, default=0.0, help="+l STRENGTH poll rate per logger (0 = off)")
    p.add_argument("--tabs", type=int, default=1, help="browser tabs polling main.js-style")
    p.add_argument("--pageload-s", type=float, default=10.0, help="seconds between page bundle loads (0 = off)")
    p.add_argument("--tune-s", type=float, default=15.0, help="seconds between spot tunes (0 = off)")
    p.add_argument("--slow-ms", type=float, default=1000.0, help="log any request slower than this")
    p.add_argument("--window-s", type=float, default=10.0, help="report window size")
    args = p.parse_args()

    root = f"http://{args.host}:{args.http_port}" if args.http_port else f"http://{args.host}"
    base = f"{root}/api/v1"

    print("=" * 72)
    print("SOTAcat dual-interface stress (rigctld + browser)")
    print("=" * 72)
    print(f"Target: {args.host} rigctld:{args.port} http:{root}")
    print(f"Duration {args.duration}s | loggers={args.loggers} (+t {args.ptt_hz} Hz, +f/+m/+l {args.slow_hz} Hz, "
          f"+l STRENGTH {args.smeter_hz} Hz) | tabs={args.tabs} | pageload every {args.pageload_s}s | "
          f"tune every {args.tune_s}s")
    print("=" * 72)

    try:
        v = requests.get(f"{base}/version", timeout=5)
        print(f"✓ HTTP reachable: version {v.text.strip()}")
        ExtSession(args.host, args.port).close()
        print("✓ rigctld reachable")
    except (OSError, requests.RequestException) as e:
        print(f"✗ unreachable: {e}")
        sys.exit(1)

    start_state = read_radio(base)
    if start_state:
        print(f"✓ radio at {start_state[0]} Hz {start_state[1]}")
    elif args.tune_s > 0:
        print("✗ could not read radio frequency/mode; refusing to tune (use --tune-s 0)")
        sys.exit(1)
    print()

    stop = threading.Event()
    cats = {
        "rigctld": Stats("rigctld", args.slow_ms),
        "browser": Stats("browser", args.slow_ms),
        "pageload": Stats("pageload", args.slow_ms * 2),
        "tune": Stats("tune", args.slow_ms * 3),
        "version": Stats("version", args.slow_ms),
    }
    threads = []
    for _ in range(args.loggers):
        threads.append(Ham2KSession(args.host, args.port, cats["rigctld"], stop, args.ptt_hz, args.slow_hz, args.smeter_hz))
    for i in range(args.tabs):
        threads.append(BrowserTab(base, cats["browser"], stop, i + 1))
    if args.pageload_s > 0:
        ip = socket.gethostbyname(args.host)  # resolve once: keep mDNS lookups out of the bundle timing
        threads.append(PageLoader(ip, args.http_port or 80, cats["pageload"], stop, args.pageload_s))
    if args.tune_s > 0:
        threads.append(Tuner(base, cats["tune"], stop, args.tune_s))
    threads.append(Probe(base, cats["version"], stop))

    for t in threads:
        t.start()
    try:
        stop.wait(args.duration)
    except KeyboardInterrupt:
        print("\ninterrupted")
    stop.set()
    for t in threads:
        t.join(timeout=HTTP_TIMEOUT_S + 2)
    elapsed = now_s()

    print(f"\n{'=' * 72}\nResults ({elapsed:.0f}s)\n{'=' * 72}")
    print(f"{'category':10s} {'ok':>6s} {'fail':>5s} {'p50':>8s} {'p95':>8s} {'max':>8s}  errors")
    for c in cats.values():
        s = c.summary()
        print(f"{s['name']:10s} {s['ok']:6d} {s['fail']:5d} {s['p50']:7.0f}ms {s['p95']:7.0f}ms {s['max']:7.0f}ms  {s['errors'] or ''}")

    print(f"\nPer-{args.window_s:.0f}s windows: count / max ms / failures")
    names = list(cats)
    print(f"{'t':>6s}  " + "  ".join(f"{n:>18s}" for n in names))
    w0 = 0.0
    while w0 < elapsed:
        w1 = w0 + args.window_s
        cells = []
        for n in names:
            cnt, mx, nf = cats[n].window(w0, w1)
            cells.append(f"{cnt:4d}/{mx:6.0f}/{nf:3d}" if cnt or nf else " " * 15)
        print(f"{w0:5.0f}s  " + "  ".join(f"{c:>18s}" for c in cells))
        w0 = w1

    if start_state and args.tune_s > 0:
        ok = restore_radio(base, *start_state)
        print(f"\n{'✓' if ok else '✗'} radio restored to {start_state[0]} Hz {start_state[1]}")

    rc = 0
    for c in cats.values():
        s = c.summary()
        if s["fail"]:
            rc = 1
    print("=" * 72)
    print("✓ no failures" if rc == 0 else "✗ failures seen (see above)")
    sys.exit(rc)


if __name__ == "__main__":
    main()
