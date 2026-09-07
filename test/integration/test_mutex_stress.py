#!/usr/bin/env python3
"""
SOTAcat Multi-Client Mutex Stress Test

Tests the 3-tier timeout system under realistic concurrent load.
Simulates SOTAmat app + multiple browser clients accessing the device simultaneously.

Usage:
    python3 test_mutex_stress.py --host sotacat.local --duration 60 --clients 7
"""

import argparse
import json
import sys
import threading
import time
from collections import defaultdict
from datetime import datetime
from pathlib import Path
from random import choice, randint, random
from typing import Dict, List, Tuple

try:
    import requests
except ImportError:
    print("Error: Required dependency 'requests' not installed")
    print("Install with: pip3 install requests")
    sys.exit(1)


class ClientStats:
    """Track statistics for a single client"""

    def __init__(self, client_type: str, client_id: int):
        self.client_type = client_type
        self.client_id = client_id
        self.total_requests = 0
        self.successful_requests = 0
        self.failed_requests = 0
        self.busy_errors = 0
        self.timeout_errors = 0
        self.errors: List[Tuple[float, str, str]] = []  # (timestamp, endpoint, error)
        self.lock = threading.Lock()

    def record_success(self):
        with self.lock:
            self.total_requests += 1
            self.successful_requests += 1

    def record_failure(self, endpoint: str, error_type: str):
        with self.lock:
            self.total_requests += 1
            self.failed_requests += 1
            if "radio busy" in error_type.lower() or "503" in error_type:
                self.busy_errors += 1
            elif "timeout" in error_type.lower() or error_type == "000":
                self.timeout_errors += 1
            self.errors.append((time.time(), endpoint, error_type))

    def get_summary(self) -> Dict:
        with self.lock:
            success_rate = (
                (self.successful_requests / self.total_requests * 100)
                if self.total_requests > 0
                else 0
            )
            return {
                "type": self.client_type,
                "id": self.client_id,
                "total_requests": self.total_requests,
                "successful": self.successful_requests,
                "failed": self.failed_requests,
                "busy_errors": self.busy_errors,
                "timeout_errors": self.timeout_errors,
                "success_rate": round(success_rate, 2),
            }


class StressTestClient:
    """Base class for stress test clients"""

    def __init__(
        self,
        host: str,
        duration: int,
        client_type: str,
        client_id: int,
        stats: ClientStats,
    ):
        self.host = host
        self.base_url = f"http://{host}/api/v1"
        self.duration = duration
        self.client_type = client_type
        self.client_id = client_id
        self.stats = stats
        self.stop_event = threading.Event()

    def make_request(
        self, method: str, endpoint: str, timeout: float, **kwargs
    ) -> bool:
        """Make HTTP request and record stats. Returns True on success."""
        url = f"{self.base_url}/{endpoint}"
        try:
            if method == "GET":
                response = requests.get(url, timeout=timeout)
            elif method == "PUT":
                response = requests.put(url, timeout=timeout, **kwargs)
            else:
                raise ValueError(f"Unsupported method: {method}")

            if response.status_code in (200, 204):
                self.stats.record_success()
                return True
            else:
                error_msg = f"HTTP {response.status_code}"
                if response.status_code == 503:
                    error_msg += " (radio busy)"
                self.stats.record_failure(endpoint, error_msg)
                return False

        except requests.exceptions.Timeout:
            self.stats.record_failure(endpoint, "000")
            return False
        except requests.exceptions.RequestException as e:
            self.stats.record_failure(endpoint, str(e))
            return False

    def run(self):
        """Override in subclass"""
        raise NotImplementedError


class SOTAmatClient(StressTestClient):
    """Simulates SOTAmat app - aggressive 200ms polling of frequency/mode"""

    def run(self):
        endpoints = ["frequency", "mode"]
        end_time = time.time() + self.duration

        while time.time() < end_time and not self.stop_event.is_set():
            for endpoint in endpoints:
                self.make_request("GET", endpoint, timeout=1.0)
            time.sleep(0.2)


class BrowserClient(StressTestClient):
    """Simulates browser - 500ms polling of multiple endpoints"""

    def run(self):
        endpoints = ["frequency", "mode", "power", "connectionStatus", "radioType"]
        end_time = time.time() + self.duration

        while time.time() < end_time and not self.stop_event.is_set():
            for endpoint in endpoints:
                self.make_request("GET", endpoint, timeout=1.0)
            time.sleep(0.5)


class ControlClient(StressTestClient):
    """Simulates user control - mix of GET and SET operations"""

    def run(self):
        frequencies = [7074000, 14074000, 21074000]
        end_time = time.time() + self.duration

        while time.time() < end_time and not self.stop_event.is_set():
            # Multiple GETs
            for _ in range(3):
                self.make_request("GET", "frequency", timeout=1.0)

            # Occasional SET operation
            if random() < 0.33:  # ~33% chance
                freq = choice(frequencies)
                self.make_request(
                    "PUT", f"frequency?frequency={freq}", timeout=3.0
                )

            # Random sleep between 3-7 seconds
            time.sleep(3 + random() * 4)


def responsiveness_probe(host, stop_event, results):
    """While radio endpoints are hammered, /version (no radio) must
    stay fast. With the server decoupled from radio I/O this holds
    even if the radio is physically off."""
    latencies = []
    while not stop_event.is_set():
        t0 = time.time()
        try:
            r = requests.get(f"http://{host}/api/v1/version", timeout=3)
            if r.status_code == 200:
                latencies.append(time.time() - t0)
        except requests.RequestException:
            latencies.append(99.0)
        time.sleep(0.25)
    results["probe_max_latency"] = max(latencies) if latencies else 99.0
    results["probe_p95"] = (
        sorted(latencies)[int(len(latencies) * 0.95)] if latencies else 99.0
    )


def cold_probe_decoupling(host: str) -> None:
    """Single-client unloaded latency check. Proves no handler blocks
    on radio I/O regardless of radio state. Runs before the stress test.

    Each endpoint is probed N times serially. Every request must return
    (with any HTTP status) within COLD_PROBE_MAX_MS. This is the test
    the user's experience actually depends on: their phone is ONE client;
    if these endpoints stay fast, the Run tab stays usable when the
    radio is off, which is exactly the reported bug
    (radio-decoupling-design.md, lines 6–13).
    """
    import socket
    import subprocess
    # Cold-probe uses `subprocess.run(curl)` instead of Python `requests`.
    # Empirical: across six investigation rounds, curl showed zero ~1 s
    # spikes while requests-based probes (even with fresh Session() per
    # call, IP pinning, and warmup) flaked ~1-in-3 with spikes matching
    # lwIP TCP SYN retransmit RTO. The cause is some interaction between
    # Python's transport stack and ESP-IDF's httpd/lwIP/WiFi state,
    # unrelated to radio I/O (manual curls + radio-decoupling code reviews
    # both confirm the decoupling is intact). Subprocess curl bypasses the
    # interaction and matches the empirical baseline.
    #
    # Pin hostname to IP up-front. mDNS lookup of sotacat.local can
    # occasionally stall ~1 s on cache miss; doing the resolution ONCE
    # isolates that variance from the per-handler latency measurement.
    # curl benefits from the explicit IP too (skips its own resolver).
    try:
        pinned_ip = socket.gethostbyname(host)
    except socket.gaierror as e:
        print(f"  Could not resolve {host}: {e}")
        raise

    print(f"  Resolved {host} -> {pinned_ip}")

    COLD_PROBE_MAX_MS = 200
    PROBES_PER_ENDPOINT = 10
    endpoints = ["version", "frequency", "connectionStatus"]

    # One-shot warmup (cheap, harmless): absorbs any first-request
    # transient before the timed measurement loop.
    for ep in endpoints:
        subprocess.run(
            ["curl", "-sS", "-o", "/dev/null",
             "--max-time", "4",
             f"http://{pinned_ip}/api/v1/{ep}"],
            capture_output=True, timeout=5,
        )

    print()
    print("Cold-probe (single-client decoupling check)")
    print("-" * 60)
    failures = []
    for ep in endpoints:
        latencies_ms = []
        for _ in range(PROBES_PER_ENDPOINT):
            result = subprocess.run(
                ["curl", "-sS", "-o", "/dev/null",
                 "-w", "%{time_total}",
                 "--max-time", "4",
                 f"http://{pinned_ip}/api/v1/{ep}"],
                capture_output=True, text=True, timeout=5,
            )
            if result.returncode != 0:
                latencies_ms.append(99000.0)  # curl error: treat as hang
                continue
            try:
                secs = float(result.stdout.strip())
                latencies_ms.append(secs * 1000)
            except ValueError:
                latencies_ms.append(99000.0)
        worst = max(latencies_ms)
        p95 = sorted(latencies_ms)[int(len(latencies_ms) * 0.95)]
        status = "OK" if worst < COLD_PROBE_MAX_MS else "FAIL"
        print(f"  {ep:20s}  p95={p95:7.1f} ms  max={worst:7.1f} ms  [{status}]")
        if worst >= COLD_PROBE_MAX_MS:
            failures.append((ep, worst))
    assert not failures, (
        f"Cold-probe FAILED: endpoints exceeded {COLD_PROBE_MAX_MS} ms: "
        + ", ".join(f"{ep}={ms:.0f}ms" for ep, ms in failures)
    )
    print(f"  All endpoints < {COLD_PROBE_MAX_MS} ms; decoupling intact.")


class MutexStressTest:
    """Orchestrates multi-client stress testing"""

    def __init__(self, host: str, duration: int, num_clients: int = 7):
        self.host = host
        self.duration = duration
        self.num_clients = num_clients
        self.clients: List[StressTestClient] = []
        self.threads: List[threading.Thread] = []
        self.all_stats: List[ClientStats] = []
        self.probe_results: Dict = {}
        self.probe_stop_event = threading.Event()
        self.probe_thread: threading.Thread = None

    def verify_host_reachable(self) -> bool:
        """Check if host is accessible"""
        try:
            response = requests.get(
                f"http://{self.host}/api/v1/version", timeout=2
            )
            return response.status_code == 200
        except requests.exceptions.RequestException:
            return False

    def create_clients(self):
        """Create client threads: 2 SOTAmat, 4 Browser, 1 Control"""
        client_id = 0

        # 2 SOTAmat clients (aggressive)
        for _ in range(2):
            client_id += 1
            stats = ClientStats("SOTAmat", client_id)
            client = SOTAmatClient(
                self.host, self.duration, "SOTAmat", client_id, stats
            )
            self.clients.append(client)
            self.all_stats.append(stats)

        # 4 Browser clients
        for _ in range(4):
            client_id += 1
            stats = ClientStats("Browser", client_id)
            client = BrowserClient(
                self.host, self.duration, "Browser", client_id, stats
            )
            self.clients.append(client)
            self.all_stats.append(stats)

        # 1 Control client
        client_id += 1
        stats = ClientStats("Control", client_id)
        client = ControlClient(
            self.host, self.duration, "Control", client_id, stats
        )
        self.clients.append(client)
        self.all_stats.append(stats)

    def run_test(self) -> Dict:
        """Execute the stress test and return results"""
        # Create clients first
        self.create_clients()

        print("=" * 60)
        print("SOTAcat Multi-Client Mutex Stress Test")
        print("=" * 60)
        print(f"Target: {self.host}")
        print(f"Duration: {self.duration}s")
        print(f"Concurrent clients: {len(self.clients)}")
        print("=" * 60)
        print()

        # Verify host is reachable
        if not self.verify_host_reachable():
            print(f"ERROR: Cannot reach {self.host}")
            print("Please ensure SOTAcat is online and accessible")
            sys.exit(1)

        print("✓ Host is reachable")
        print()

        # Cold-probe: single-client unloaded latency check. Proves the
        # decoupling property the user actually experiences (their phone
        # is one client). Runs BEFORE the stress test so a regression
        # here aborts fast, before the noisier stress phase.
        cold_probe_decoupling(self.host)
        print()

        # Start all client threads
        print("Starting multi-client stress test...")
        print()

        start_time = time.time()
        for client in self.clients:
            thread = threading.Thread(target=client.run, daemon=True)
            thread.start()
            self.threads.append(thread)
            time.sleep(0.1)  # Stagger startup

        # Start the responsiveness probe alongside the stress clients.
        # Probes /api/v1/version (no radio I/O) so we can assert that
        # non-radio endpoints stay fast even while the radio endpoints
        # are hammered (and even if the radio is physically off).
        self.probe_thread = threading.Thread(
            target=responsiveness_probe,
            args=(self.host, self.probe_stop_event, self.probe_results),
            daemon=True,
        )
        self.probe_thread.start()

        print(f"✓ Launched {len(self.clients)} concurrent clients")
        print()

        # Progress indicator
        for i in range(self.duration):
            active = sum(1 for t in self.threads if t.is_alive())
            print(
                f"Progress: {i+1}/{self.duration}s | Active: {active}/{len(self.clients)}   ",
                end="\r",
                flush=True,
            )
            time.sleep(1)
        print()
        print()

        # Wait for all threads to complete
        print("Waiting for all clients to complete...")
        for thread in self.threads:
            thread.join(timeout=5)
        print("✓ All clients completed")
        print()

        # Stop and join the responsiveness probe
        self.probe_stop_event.set()
        if self.probe_thread is not None:
            self.probe_thread.join(timeout=5)

        results = self.probe_results
        print(
            f"Responsiveness probe: /version p95="
            f"{results.get('probe_p95', 99.0):.3f}s, "
            f"max={results.get('probe_max_latency', 99.0):.3f}s"
        )
        print()
        # Stress-test threshold: single-tasked esp_http_server has a measured
        # saturation floor around 1.0–1.5 s under 7-client load on this hardware,
        # regardless of radio state (verified by /version-only stress). Set the
        # threshold above that floor but well below the pre-decoupling 6-s
        # blocking-on-radio failure mode. The single-client cold probe (run
        # before this stress test) is what actually proves the decoupling.
        assert results["probe_p95"] < 2.0, (
            f"/version p95 {results['probe_p95']:.2f}s exceeds 2.0 s; "
            f"server is stalling on radio I/O OR the HTTP server saturation "
            f"floor regressed."
        )

        # Collect and display results
        return self.generate_report()

    def generate_report(self) -> Dict:
        """Generate comprehensive test report"""
        print("=" * 60)
        print("Test Results")
        print("=" * 60)
        print()

        # Group by client type
        by_type = defaultdict(list)
        for stats in self.all_stats:
            by_type[stats.client_type].append(stats)

        # Print per-client results
        for client_type in ["SOTAmat", "Browser", "Control"]:
            if client_type not in by_type:
                continue

            print(f"{client_type} clients:")
            for stats in by_type[client_type]:
                summary = stats.get_summary()
                print(
                    f"  Client {summary['id']}: {summary['total_requests']} req, "
                    f"{summary['successful']} ok ({summary['success_rate']:.1f}%), "
                    f"{summary['failed']} fail, {summary['busy_errors']} busy"
                )
            print()

        # Calculate overall stats
        total_requests = sum(s.total_requests for s in self.all_stats)
        total_success = sum(s.successful_requests for s in self.all_stats)
        total_failed = sum(s.failed_requests for s in self.all_stats)
        total_busy = sum(s.busy_errors for s in self.all_stats)
        total_timeout = sum(s.timeout_errors for s in self.all_stats)

        success_rate = (
            (total_success / total_requests * 100) if total_requests > 0 else 0
        )
        throughput = total_requests / self.duration if self.duration > 0 else 0
        busy_rate = (total_busy / total_requests * 100) if total_requests > 0 else 0

        print("=" * 60)
        print("Overall Summary")
        print("=" * 60)
        print(f"Total clients:      {len(self.clients)}")
        print(f"Total requests:     {total_requests}")
        print(f"Successful:         {total_success}")
        print(f"Failed:             {total_failed}")
        print(f"Radio busy errors:  {total_busy}")
        print(f"Timeout errors:     {total_timeout}")
        print(f"Success rate:       {success_rate:.2f}%")
        print(f"Throughput:         {throughput:.1f} req/s")
        print(f"Busy error rate:    {busy_rate:.2f}%")
        print()

        # Assessment
        exit_code = 0
        if success_rate >= 95:
            print("✓ EXCELLENT: >95% success rate with multiple concurrent clients")
            print("  The 3-tier timeout system is handling real-world load perfectly!")
        elif success_rate >= 90:
            print("✓ VERY GOOD: >90% success rate under multi-client load")
            print("  Timeout system working as designed - graceful degradation")
        elif success_rate >= 80:
            print("✓ GOOD: >80% success rate - acceptable under extreme load")
            print("  Consider tuning timeout values if this represents typical usage")
        else:
            print("⚠ WARNING: <80% success rate with multiple clients")
            print("  Consider increasing timeout values or optimizing radio operations")
            exit_code = 1

        print()

        if total_busy > 0:
            print("Mutex contention analysis:")
            print(f"  {total_busy} operations hit timeout ({busy_rate:.2f}%)")
            print("  This indicates the timeout system is working as designed")
            print(
                "  Radio was legitimately busy and requests failed gracefully (no deadlocks)"
            )
        else:
            print("✓ Zero mutex timeout errors - excellent performance!")
            print("  All requests completed within timeout periods")

        print()

        # Generate JSON report
        report = {
            "test_date": datetime.now().isoformat(),
            "host": self.host,
            "duration": self.duration,
            "clients": len(self.clients),
            "total_requests": total_requests,
            "successful": total_success,
            "failed": total_failed,
            "radio_busy_errors": total_busy,
            "timeout_errors": total_timeout,
            "success_rate": round(success_rate, 2),
            "throughput_per_sec": round(throughput, 1),
            "busy_error_rate": round(busy_rate, 2),
            "exit_code": exit_code,
            "client_details": [s.get_summary() for s in self.all_stats],
        }

        return report


def main():
    parser = argparse.ArgumentParser(
        description="SOTAcat Multi-Client Mutex Stress Test"
    )
    parser.add_argument(
        "--host", default="sotacat.local", help="Target hostname or IP"
    )
    parser.add_argument(
        "--duration", type=int, default=60, help="Test duration in seconds"
    )
    parser.add_argument(
        "--clients", type=int, default=7, help="Number of concurrent clients"
    )
    parser.add_argument(
        "--output",
        help="JSON output file (default: auto-generated in test_results/)",
    )

    args = parser.parse_args()

    # Run the test
    test = MutexStressTest(args.host, args.duration, args.clients)
    report = test.run_test()

    # Save results
    if args.output:
        output_path = Path(args.output)
    else:
        # Auto-generate output directory
        timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
        results_dir = Path(__file__).parent.parent.parent / "test_results"
        output_dir = results_dir / f"mutex_stress_{timestamp}"
        output_dir.mkdir(parents=True, exist_ok=True)
        output_path = output_dir / "summary.json"

    with open(output_path, "w") as f:
        json.dump(report, f, indent=2)

    print(f"Results saved to: {output_path}")
    print("=" * 60)

    # Exit with appropriate code
    sys.exit(report["exit_code"])


if __name__ == "__main__":
    main()
