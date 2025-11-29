#!/usr/bin/env python3
"""
SOTAcat Unified Test Runner

Orchestrates all integration tests for the SOTAcat firmware.

Usage:
    python3 run_tests.py --all                  # Run all tests
    python3 run_tests.py --performance          # Performance test only
    python3 run_tests.py --mutex                # Mutex stress test only
    python3 run_tests.py --quick                # Quick test suite
"""

import argparse
import subprocess
import sys
from pathlib import Path


class TestRunner:
    """Unified test runner for SOTAcat integration tests"""

    def __init__(self, host: str, venv_python: Path):
        self.host = host
        self.venv_python = venv_python
        self.test_dir = Path(__file__).parent
        self.results = []

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
        "--all", action="store_true", help="Run all tests (default)"
    )
    parser.add_argument(
        "--performance", action="store_true", help="Run performance test only"
    )
    parser.add_argument(
        "--mutex", action="store_true", help="Run mutex stress test only"
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

    args = parser.parse_args()

    # Determine Python interpreter
    venv_python = Path(__file__).parent.parent.parent / ".venv" / "bin" / "python3"
    if not venv_python.exists():
        print("Error: Virtual environment not found")
        print(f"Expected: {venv_python}")
        print("\nRun: make setup")
        sys.exit(1)

    runner = TestRunner(args.host, venv_python)

    # Determine what to run
    run_all = args.all or not (args.performance or args.mutex)

    if run_all:
        # Full test suite
        runner.run_performance_test(iterations=args.iterations)
        runner.run_mutex_stress_test(duration=args.duration, clients=args.clients)
    else:
        # Individual tests
        if args.performance:
            runner.run_performance_test(iterations=args.iterations)
        if args.mutex:
            runner.run_mutex_stress_test(duration=args.duration, clients=args.clients)

    # Print summary and exit
    exit_code = runner.print_summary()
    sys.exit(exit_code)


if __name__ == "__main__":
    main()
