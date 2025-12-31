#!/usr/bin/env python3
"""
SOTAcat Unified Test Runner

Orchestrates all integration tests for the SOTAcat firmware.

Usage:
    python3 run_tests.py --all                  # Run all tests
    python3 run_tests.py --performance          # Performance test only
    python3 run_tests.py --mutex                # Mutex stress test only
    python3 run_tests.py --ui                   # UI test only (requires mock server or device)
    python3 run_tests.py --ui --mock            # UI test with auto-started mock server
"""

import argparse
import subprocess
import sys
import time
import signal
import os
from pathlib import Path


class TestRunner:
    """Unified test runner for SOTAcat integration tests"""

    def __init__(self, host: str, venv_python: Path):
        self.host = host
        self.venv_python = venv_python
        self.test_dir = Path(__file__).parent
        self.results = []
        self.mock_server_proc = None

    def run_performance_test(self, iterations: int = 10) -> int:
        """Run web server performance test"""
        print("\n" + "=" * 70)
        print("Running Web Server Performance Test")
        print("=" * 70 + "\n")

        cmd = [
            str(self.venv_python),
            str(self.test_dir / "test_webserver_performance.py"),
            "--host",
            self.host,
            "--iterations",
            str(iterations),
        ]

        result = subprocess.run(cmd)
        self.results.append(("Performance Test", result.returncode))
        return result.returncode

    def run_mutex_stress_test(
        self, duration: int = 60, clients: int = 7
    ) -> int:
        """Run multi-client mutex stress test"""
        print("\n" + "=" * 70)
        print("Running Multi-Client Mutex Stress Test")
        print("=" * 70 + "\n")

        cmd = [
            str(self.venv_python),
            str(self.test_dir / "test_mutex_stress.py"),
            "--host",
            self.host,
            "--duration",
            str(duration),
            "--clients",
            str(clients),
        ]

        result = subprocess.run(cmd)
        self.results.append(("Mutex Stress Test", result.returncode))
        return result.returncode

    def start_mock_server(self, port: int = 8080) -> bool:
        """Start the mock server in the background"""
        print("\n" + "=" * 70)
        print("Starting Mock Server")
        print("=" * 70 + "\n")

        mock_server_path = self.test_dir.parent / "mock_server" / "server.py"
        if not mock_server_path.exists():
            print(f"Error: Mock server not found at {mock_server_path}")
            return False

        # Start mock server with pipx
        try:
            self.mock_server_proc = subprocess.Popen(
                ["pipx", "run", str(mock_server_path), "--port", str(port)],
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
            )
            # Wait for server to start
            time.sleep(3)
            if self.mock_server_proc.poll() is not None:
                print("Error: Mock server failed to start")
                return False
            print(f"Mock server started on port {port}")
            return True
        except Exception as e:
            print(f"Error starting mock server: {e}")
            return False

    def stop_mock_server(self):
        """Stop the mock server"""
        if self.mock_server_proc:
            print("\nStopping mock server...")
            self.mock_server_proc.terminate()
            try:
                self.mock_server_proc.wait(timeout=5)
            except subprocess.TimeoutExpired:
                self.mock_server_proc.kill()
            self.mock_server_proc = None

    def run_ui_test(self, base_url: str = None, headed: bool = False) -> int:
        """Run UI tests with Playwright"""
        print("\n" + "=" * 70)
        print("Running UI Tests")
        print("=" * 70 + "\n")

        if base_url is None:
            base_url = f"http://{self.host}"

        cmd = [
            "pipx", "run",
            str(self.test_dir / "test_ui.py"),
            "--base-url", base_url,
        ]
        if headed:
            cmd.append("--headed")

        result = subprocess.run(cmd)
        self.results.append(("UI Test", result.returncode))
        return result.returncode

    def print_summary(self):
        """Print test run summary"""
        print("\n" + "=" * 70)
        print("Test Summary")
        print("=" * 70)

        all_passed = True
        for test_name, exit_code in self.results:
            status = "✓ PASS" if exit_code == 0 else "✗ FAIL"
            print(f"{status:8} {test_name}")
            if exit_code != 0:
                all_passed = False

        print("=" * 70)

        if all_passed:
            print("✓ All tests passed!")
            return 0
        else:
            print("✗ Some tests failed")
            return 1


def main():
    parser = argparse.ArgumentParser(
        description="SOTAcat Unified Test Runner"
    )
    parser.add_argument(
        "--host", default="sotacat.local", help="Target hostname or IP"
    )
    parser.add_argument(
        "--all", action="store_true", help="Run all device tests (performance + mutex)"
    )
    parser.add_argument(
        "--performance", action="store_true", help="Run performance test only"
    )
    parser.add_argument(
        "--mutex", action="store_true", help="Run mutex stress test only"
    )
    parser.add_argument(
        "--ui", action="store_true", help="Run UI tests only"
    )
    parser.add_argument(
        "--mock", action="store_true", help="Use mock server for UI tests (auto-start)"
    )
    parser.add_argument(
        "--headed", action="store_true", help="Run UI tests in headed mode (visible browser)"
    )
    parser.add_argument(
        "--iterations", type=int, default=10, help="Performance test iterations (default: 10)"
    )
    parser.add_argument(
        "--duration", type=int, default=60, help="Stress test duration in seconds (default: 60)"
    )
    parser.add_argument(
        "--clients", type=int, default=7, help="Number of concurrent clients (default: 7)"
    )
    parser.add_argument(
        "--port", type=int, default=8080, help="Mock server port (default: 8080)"
    )

    args = parser.parse_args()

    # Determine Python interpreter (for device tests)
    venv_python = Path(__file__).parent.parent.parent / ".venv" / "bin" / "python3"

    runner = TestRunner(args.host, venv_python)

    try:
        # Determine what to run
        run_device_tests = args.all or args.performance or args.mutex
        run_ui_tests = args.ui

        # If nothing specified, default to device tests if venv exists
        if not run_device_tests and not run_ui_tests:
            if venv_python.exists():
                run_device_tests = True
            else:
                print("No venv found. Use --ui --mock to run UI tests with mock server.")
                sys.exit(1)

        # Device tests require venv
        if run_device_tests and not venv_python.exists():
            print("Error: Virtual environment not found for device tests")
            print(f"Expected: {venv_python}")
            print("\nRun: make setup")
            print("Or use: --ui --mock for UI tests only")
            sys.exit(1)

        # Start mock server if requested
        if args.mock:
            if not runner.start_mock_server(port=args.port):
                sys.exit(1)

        # Run device tests
        if run_device_tests:
            if args.all or args.performance:
                runner.run_performance_test(iterations=args.iterations)
            if args.all or args.mutex:
                runner.run_mutex_stress_test(duration=args.duration, clients=args.clients)

        # Run UI tests
        if run_ui_tests:
            base_url = f"http://localhost:{args.port}" if args.mock else None
            runner.run_ui_test(base_url=base_url, headed=args.headed)

    finally:
        # Cleanup
        runner.stop_mock_server()

    # Print summary and exit
    exit_code = runner.print_summary()
    sys.exit(exit_code)


if __name__ == "__main__":
    main()
