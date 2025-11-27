#!/usr/bin/env python3
# Run with: ../../.venv/bin/python3 test_webserver_performance.py
# Or use: ./run_performance_test.sh --host sotacat.local
"""
SOTAcat Web Server Performance Test Suite

Automated testing tool to measure and diagnose web server performance issues,
with specific focus on mDNS resolution, initial page load, and HTTP responsiveness.

Usage:
    python3 test_webserver_performance.py [--host sotacat.local] [--iterations 10]
"""

import argparse
import json
import socket
import sys
import time
from datetime import datetime
from typing import Dict, List, Optional, Tuple
from urllib.parse import urljoin

try:
    import requests
    from zeroconf import ServiceBrowser, ServiceListener, Zeroconf
except ImportError:
    print("Error: Required dependencies not installed")
    print("Install with: pip3 install requests zeroconf")
    sys.exit(1)


class PerformanceMetrics:
    """Container for performance measurement results"""

    def __init__(self):
        self.mdns_resolution_times: List[float] = []
        self.tcp_connection_times: List[float] = []
        self.http_response_times: Dict[str, List[float]] = {}
        self.ttfb_times: List[float] = []  # Time to first byte
        self.full_page_load_times: List[float] = []
        self.errors: List[str] = []
        self.timeouts: int = 0

    def add_http_response(self, endpoint: str, response_time: float, ttfb: float):
        if endpoint not in self.http_response_times:
            self.http_response_times[endpoint] = []
        self.http_response_times[endpoint].append(response_time)
        self.ttfb_times.append(ttfb)

    def calculate_stats(self, values: List[float]) -> Dict[str, float]:
        if not values:
            return {"min": 0, "max": 0, "avg": 0, "p50": 0, "p95": 0, "p99": 0}

        sorted_vals = sorted(values)
        n = len(sorted_vals)

        return {
            "min": sorted_vals[0],
            "max": sorted_vals[-1],
            "avg": sum(sorted_vals) / n,
            "p50": sorted_vals[int(n * 0.50)],
            "p95": sorted_vals[int(n * 0.95)] if n > 20 else sorted_vals[-1],
            "p99": sorted_vals[int(n * 0.99)] if n > 100 else sorted_vals[-1],
        }

    def get_summary(self) -> Dict:
        summary = {
            "timestamp": datetime.now().isoformat(),
            "mdns_resolution": self.calculate_stats(self.mdns_resolution_times),
            "tcp_connection": self.calculate_stats(self.tcp_connection_times),
            "ttfb": self.calculate_stats(self.ttfb_times),
            "full_page_load": self.calculate_stats(self.full_page_load_times),
            "endpoints": {},
            "errors": self.errors,
            "timeout_count": self.timeouts,
        }

        for endpoint, times in self.http_response_times.items():
            summary["endpoints"][endpoint] = self.calculate_stats(times)

        return summary


class MDNSResolver:
    """Resolve mDNS hostnames and measure resolution time"""

    def __init__(self):
        self.resolved_addresses = []
        self.zeroconf = None

    def resolve_mdns(self, hostname: str, timeout: float = 5.0) -> Optional[Tuple[str, float]]:
        """
        Resolve mDNS hostname and return (ip_address, resolution_time) or None

        Args:
            hostname: hostname to resolve (e.g., 'sotacat.local')
            timeout: maximum time to wait for resolution in seconds

        Returns:
            Tuple of (ip_address, time_taken) or None if resolution failed
        """
        start = time.time()

        class SOTAcatListener(ServiceListener):
            def __init__(self):
                self.found = False
                self.address = None

            def add_service(self, zc, type_, name):
                pass

            def remove_service(self, zc, type_, name):
                pass

            def update_service(self, zc, type_, name):
                pass

        # Try direct socket resolution first (faster if cached)
        try:
            ip = socket.gethostbyname(hostname)
            elapsed = time.time() - start
            print(f"  ✓ Resolved {hostname} to {ip} in {elapsed*1000:.1f}ms (cached)")
            return ip, elapsed
        except socket.gaierror:
            pass

        # Fall back to zeroconf for fresh mDNS lookup
        print(f"  Performing fresh mDNS lookup for {hostname}...")
        try:
            self.zeroconf = Zeroconf()

            # Query for HTTP service
            browser = ServiceBrowser(self.zeroconf, "_http._tcp.local.", handlers=[])

            # Wait for resolution
            deadline = time.time() + timeout
            while time.time() < deadline:
                try:
                    ip = socket.gethostbyname(hostname)
                    elapsed = time.time() - start
                    print(f"  ✓ Resolved {hostname} to {ip} in {elapsed*1000:.1f}ms")
                    return ip, elapsed
                except socket.gaierror:
                    time.sleep(0.1)

            elapsed = time.time() - start
            print(f"  ✗ Failed to resolve {hostname} after {elapsed:.1f}s")
            return None, elapsed

        finally:
            if self.zeroconf:
                self.zeroconf.close()

    def flush_dns_cache(self):
        """Attempt to flush DNS cache (platform-dependent)"""
        import platform
        import subprocess

        system = platform.system()
        print(f"  Attempting to flush DNS cache on {system}...")

        try:
            if system == "Darwin":  # macOS
                subprocess.run(
                    ["sudo", "dscacheutil", "-flushcache"],
                    check=False,
                    capture_output=True,
                )
                subprocess.run(
                    ["sudo", "killall", "-HUP", "mDNSResponder"],
                    check=False,
                    capture_output=True,
                )
            elif system == "Linux":
                subprocess.run(
                    ["sudo", "systemd-resolve", "--flush-caches"],
                    check=False,
                    capture_output=True,
                )
            elif system == "Windows":
                subprocess.run(
                    ["ipconfig", "/flushdns"], check=False, capture_output=True
                )
        except Exception as e:
            print(f"  Warning: Could not flush DNS cache: {e}")


class WebServerTester:
    """Test SOTAcat web server performance"""

    def __init__(self, host: str, use_mdns: bool = True):
        self.host = host
        self.use_mdns = use_mdns
        self.base_url = f"http://{host}"
        self.metrics = PerformanceMetrics()
        self.session = requests.Session()

        # All SOTAcat assets from DECLARE_ASSET in webserver.cpp
        self.test_endpoints = [
            # HTML pages
            "/",
            "/index.html",
            "/about.html",
            "/cat.html",
            "/chase.html",
            "/settings.html",

            # JavaScript files
            "/about.js",
            "/cat.js",
            "/chase.js",
            "/chase_api.js",
            "/main.js",
            "/settings.js",

            # CSS
            "/style.css",

            # Images
            "/favicon.ico",
            "/sclogo.jpg",

            # API endpoints (subset - no radio required)
            "/api/v1/version",
            "/api/v1/connectionStatus",
            "/api/v1/batteryPercent",
            "/api/v1/batteryVoltage",
            "/api/v1/settings",
        ]

    def measure_tcp_connection(self, ip: str, port: int = 80) -> Optional[float]:
        """Measure TCP connection establishment time"""
        start = time.time()
        sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        sock.settimeout(5.0)

        try:
            sock.connect((ip, port))
            elapsed = time.time() - start
            return elapsed
        except Exception as e:
            print(f"  ✗ TCP connection failed: {e}")
            return None
        finally:
            sock.close()

    def test_endpoint(
        self, endpoint: str, timeout: float = 10.0
    ) -> Optional[Tuple[float, float]]:
        """
        Test a single endpoint and return (total_time, ttfb)

        Args:
            endpoint: URL path to test
            timeout: request timeout in seconds

        Returns:
            Tuple of (total_response_time, time_to_first_byte) or None on error
        """
        url = urljoin(self.base_url, endpoint)

        try:
            start = time.time()

            # Use stream=True to measure TTFB separately
            response = self.session.get(url, timeout=timeout, stream=True)

            # Time to first byte
            first_byte_time = time.time()
            ttfb = first_byte_time - start

            # Read the rest of the response
            _ = response.content
            total_time = time.time() - start

            if response.status_code == 200:
                return total_time, ttfb
            else:
                error = f"HTTP {response.status_code} for {endpoint}"
                self.metrics.errors.append(error)
                print(f"  ✗ {error}")
                return None

        except requests.exceptions.Timeout:
            self.metrics.timeouts += 1
            error = f"Timeout requesting {endpoint}"
            self.metrics.errors.append(error)
            print(f"  ✗ {error}")
            return None

        except Exception as e:
            error = f"Error requesting {endpoint}: {e}"
            self.metrics.errors.append(error)
            print(f"  ✗ {error}")
            return None

    def test_full_page_load(self) -> Optional[float]:
        """
        Simulate a full page load by requesting index + all referenced assets
        """
        start = time.time()

        # Load main page
        result = self.test_endpoint("/")
        if not result:
            return None

        # Load common assets that browsers request immediately
        assets = ["/main.js", "/style.css", "/favicon.ico"]

        for asset in assets:
            self.test_endpoint(asset)

        return time.time() - start

    def run_iteration(self, iteration: int, resolve_mdns: bool = False):
        """Run a single test iteration"""
        print(f"\n{'='*60}")
        print(f"Iteration {iteration}")
        print(f"{'='*60}")

        # Optional mDNS resolution test
        if resolve_mdns and self.use_mdns:
            print("Testing mDNS resolution...")
            resolver = MDNSResolver()
            result = resolver.resolve_mdns(self.host)
            if result:
                ip, resolve_time = result
                self.metrics.mdns_resolution_times.append(resolve_time)

                # Test TCP connection time
                print("Testing TCP connection...")
                tcp_time = self.measure_tcp_connection(ip)
                if tcp_time:
                    self.metrics.tcp_connection_times.append(tcp_time)
                    print(f"  ✓ TCP connection: {tcp_time*1000:.1f}ms")
            else:
                print("  ✗ mDNS resolution failed")
                self.metrics.errors.append("mDNS resolution failed")

        # Test individual endpoints
        print("\nTesting endpoints...")
        for endpoint in self.test_endpoints:
            result = self.test_endpoint(endpoint)
            if result:
                total_time, ttfb = result
                self.metrics.add_http_response(endpoint, total_time, ttfb)
                print(
                    f"  ✓ {endpoint:30s} TTFB: {ttfb*1000:6.1f}ms  Total: {total_time*1000:6.1f}ms"
                )

        # Test full page load
        print("\nTesting full page load...")
        page_load_time = self.test_full_page_load()
        if page_load_time:
            self.metrics.full_page_load_times.append(page_load_time)
            print(f"  ✓ Full page load: {page_load_time*1000:.1f}ms")

    def run_tests(self, iterations: int = 10, mdns_test_frequency: int = 5):
        """
        Run multiple test iterations

        Args:
            iterations: number of test iterations to run
            mdns_test_frequency: test mDNS resolution every N iterations
        """
        print(f"\nStarting performance tests against {self.base_url}")
        print(f"Testing {len(self.test_endpoints)} endpoints:")

        # Group and display endpoints
        html_pages = [e for e in self.test_endpoints if e.endswith('.html') or e == '/']
        js_files = [e for e in self.test_endpoints if e.endswith('.js')]
        css_files = [e for e in self.test_endpoints if e.endswith('.css')]
        images = [e for e in self.test_endpoints if e.endswith('.ico') or e.endswith('.jpg')]
        apis = [e for e in self.test_endpoints if e.startswith('/api/')]

        print(f"  - HTML pages: {len(html_pages)}")
        print(f"  - JavaScript: {len(js_files)}")
        print(f"  - CSS: {len(css_files)}")
        print(f"  - Images: {len(images)}")
        print(f"  - API endpoints: {len(apis)}")
        print(f"\nRunning {iterations} iterations...\n")

        for i in range(1, iterations + 1):
            # Test mDNS resolution periodically (it's slow)
            resolve_mdns = self.use_mdns and (i % mdns_test_frequency == 1)

            self.run_iteration(i, resolve_mdns=resolve_mdns)

            # Brief pause between iterations
            if i < iterations:
                time.sleep(0.5)

    def print_summary(self):
        """Print test results summary"""
        summary = self.metrics.get_summary()

        print("\n")
        print("=" * 70)
        print("PERFORMANCE TEST RESULTS")
        print("=" * 70)

        if self.metrics.mdns_resolution_times:
            stats = summary["mdns_resolution"]
            print(f"\nmDNS Resolution Time:")
            print(
                f"  Min: {stats['min']*1000:6.1f}ms  Max: {stats['max']*1000:6.1f}ms  Avg: {stats['avg']*1000:6.1f}ms"
            )

        if self.metrics.tcp_connection_times:
            stats = summary["tcp_connection"]
            print(f"\nTCP Connection Time:")
            print(
                f"  Min: {stats['min']*1000:6.1f}ms  Max: {stats['max']*1000:6.1f}ms  Avg: {stats['avg']*1000:6.1f}ms"
            )

        if self.metrics.ttfb_times:
            stats = summary["ttfb"]
            print(f"\nTime to First Byte (TTFB):")
            print(
                f"  Min: {stats['min']*1000:6.1f}ms  Max: {stats['max']*1000:6.1f}ms  Avg: {stats['avg']*1000:6.1f}ms"
            )
            print(f"  P50: {stats['p50']*1000:6.1f}ms  P95: {stats['p95']*1000:6.1f}ms")

        if self.metrics.full_page_load_times:
            stats = summary["full_page_load"]
            print(f"\nFull Page Load Time:")
            print(
                f"  Min: {stats['min']*1000:6.1f}ms  Max: {stats['max']*1000:6.1f}ms  Avg: {stats['avg']*1000:6.1f}ms"
            )
            print(f"  P50: {stats['p50']*1000:6.1f}ms  P95: {stats['p95']*1000:6.1f}ms")

        print(f"\nEndpoint Response Times:")
        for endpoint, stats in summary["endpoints"].items():
            print(f"  {endpoint:30s} avg: {stats['avg']*1000:6.1f}ms")

        if self.metrics.errors:
            print(f"\nErrors: {len(self.metrics.errors)}")
            for error in self.metrics.errors[:10]:  # Show first 10
                print(f"  - {error}")

        if self.metrics.timeouts:
            print(f"\nTimeouts: {self.metrics.timeouts}")

        print("\n" + "=" * 70)

        # Diagnose issues
        self.diagnose_issues(summary)

        return summary

    def diagnose_issues(self, summary: Dict):
        """Analyze results and provide diagnostic recommendations"""
        print("\nDIAGNOSTIC ANALYSIS:")
        print("-" * 70)

        issues = []

        # Check mDNS resolution
        if self.metrics.mdns_resolution_times:
            avg_mdns = summary["mdns_resolution"]["avg"]
            if avg_mdns > 2.0:
                issues.append(
                    f"⚠ Slow mDNS resolution ({avg_mdns*1000:.0f}ms avg)"
                )
                print(
                    "  Issue: mDNS resolution is slow"
                )
                print(
                    "  Recommendations:"
                )
                print(
                    "    - Check if multiple mDNS responders are active on network"
                )
                print(
                    "    - Verify ESP32 mDNS service is properly configured"
                )
                print(
                    "    - Consider using static IP address instead of .local hostname"
                )

        # Check TTFB
        if self.metrics.ttfb_times:
            avg_ttfb = summary["ttfb"]["avg"]
            max_ttfb = summary["ttfb"]["max"]

            if avg_ttfb > 0.5:
                issues.append(
                    f"⚠ High Time to First Byte ({avg_ttfb*1000:.0f}ms avg)"
                )
                print("  Issue: High server response latency (TTFB)")
                print("  Recommendations:")
                print(
                    "    - Check ESP32 CPU usage during web requests"
                )
                print(
                    "    - Verify HTTP server task priority is appropriate"
                )
                print(
                    "    - Consider increasing httpd stack_size"
                )
                print(
                    "    - Review handler functions for blocking operations"
                )

            if max_ttfb > avg_ttfb * 3:
                issues.append(
                    f"⚠ Inconsistent response times (max {max_ttfb*1000:.0f}ms)"
                )
                print(
                    "  Issue: High variance in response times"
                )
                print(
                    "  Recommendations:"
                )
                print(
                    "    - Check for task scheduling issues"
                )
                print(
                    "    - Review FreeRTOS task priorities"
                )
                print(
                    "    - Look for blocking operations in request handlers"
                )

        # Check page load time
        if self.metrics.full_page_load_times:
            avg_page = summary["full_page_load"]["avg"]
            if avg_page > 2.0:
                issues.append(
                    f"⚠ Slow page load times ({avg_page*1000:.0f}ms avg)"
                )
                print(
                    "  Issue: Full page loads taking too long"
                )
                print(
                    "  Recommendations:"
                )
                print(
                    "    - Increase max_open_sockets in httpd_config"
                )
                print(
                    "    - Review chunked transfer implementation"
                )
                print(
                    "    - Consider enabling HTTP compression for text assets"
                )
                print(
                    "    - Add proper cache headers to static assets"
                )

        # Check timeouts
        if self.metrics.timeouts > 0:
            issues.append(
                f"⚠ {self.metrics.timeouts} request timeouts occurred"
            )
            print(
                "  Issue: Requests timing out"
            )
            print(
                "  Recommendations:"
            )
            print(
                "    - Check ESP32 is not running out of memory"
            )
            print(
                "    - Verify max_open_sockets is sufficient"
            )
            print(
                "    - Review send_wait_timeout and recv_wait_timeout settings"
            )
            print(
                "    - Check for WiFi connectivity issues"
            )

        if not issues:
            print("  ✓ No significant performance issues detected")
            print("    All metrics within acceptable ranges")

        print("-" * 70)

    def save_results(self, filename: str = "webserver_test_results.json"):
        """Save test results to JSON file"""
        summary = self.metrics.get_summary()

        with open(filename, "w") as f:
            json.dump(summary, f, indent=2)

        print(f"\nResults saved to {filename}")


def main():
    parser = argparse.ArgumentParser(
        description="Test SOTAcat web server performance"
    )
    parser.add_argument(
        "--host",
        default="sotacat.local",
        help="Hostname or IP address to test (default: sotacat.local)",
    )
    parser.add_argument(
        "--iterations",
        type=int,
        default=10,
        help="Number of test iterations (default: 10)",
    )
    parser.add_argument(
        "--output",
        default="webserver_test_results.json",
        help="Output file for results (default: webserver_test_results.json)",
    )
    parser.add_argument(
        "--no-mdns",
        action="store_true",
        help="Skip mDNS resolution tests (use if testing by IP)",
    )

    args = parser.parse_args()

    use_mdns = ".local" in args.host and not args.no_mdns

    print("SOTAcat Web Server Performance Test")
    print("=" * 70)

    tester = WebServerTester(args.host, use_mdns=use_mdns)

    try:
        tester.run_tests(iterations=args.iterations)
        summary = tester.print_summary()
        tester.save_results(args.output)

    except KeyboardInterrupt:
        print("\n\nTest interrupted by user")
        summary = tester.print_summary()
        tester.save_results(args.output)

    except Exception as e:
        print(f"\nError during testing: {e}")
        import traceback

        traceback.print_exc()
        sys.exit(1)


if __name__ == "__main__":
    main()
