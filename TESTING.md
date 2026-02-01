# SOTAcat Testing Guide

## Quick Start

```bash
# From project root
make test-setup     # One-time setup: create venv and install dependencies
make test           # Run test suite (default: 10 iterations, 60s stress)

# Quick validation
make test ITERATIONS=5 STRESS_DURATION=30
```

## Test Overview

SOTAcat has a comprehensive test suite covering:

1. **Performance Tests** - Web server response times, asset loading, mDNS resolution
2. **Stress Tests** - Multi-client concurrent access, mutex timeout validation
3. **Unit Tests** - Embedded tests that run on device (PlatformIO)

### Performance Test
Tests 20 static assets and non-radio API endpoints:
- Average TTFB: ~20-25ms
- Full page load: ~100-120ms
- 100% coverage of testable web assets

### Stress Test
Validates 3-tier mutex timeout system (500ms/2000ms/10000ms):
- Simulates 7 concurrent clients (SOTAmat + browsers)
- Tests frequency/mode/power GET/SET operations
- Typical results: >95% success rate, zero deadlocks

## Running Tests

### From Project Root

```bash
make test-setup                         # Setup test environment (once)
make test                               # Default (10 iterations, 60s stress)
make test ITERATIONS=5 STRESS_DURATION=30  # Quick validation
make test ITERATIONS=20                 # Extended performance test
```

### From test/integration Directory

```bash
cd test/integration

make setup                              # Setup environment
make test                               # Default (10 iterations, 60s stress)
make test-performance                   # Performance only
make test-mutex                         # Stress only

# With custom parameters
make test HOST=192.168.1.100           # Specific device
make test ITERATIONS=5                 # Quick test (5 iterations)
make test-performance ITERATIONS=20    # Extended performance test
make test-mutex STRESS_DURATION=120    # 2-minute stress test
```

## Test Results

Results are saved to `test_results/`:
- `webserver_test_results.json` - Performance metrics
- `mutex_stress_YYYYMMDD_HHMMSS/summary.json` - Stress test results

Example success criteria:
- **Performance**: All endpoints respond in <200ms
- **Stress**: >95% success rate, 0% mutex timeout errors

## Benchmarking

### Capture Baseline

```bash
cd test/integration
make test-performance ITERATIONS=20
cp webserver_test_results.json baseline_$(date +%Y%m%d).json
```

### After Changes

```bash
make ota-upload        # Flash new firmware
sleep 10               # Wait for reboot
make test-performance ITERATIONS=20
```

### Compare

```bash
python3 -c "
import json
before = json.load(open('baseline_20251126.json'))
after = json.load(open('webserver_test_results.json'))
print(f\"TTFB: {before['ttfb']['avg']:.1f}ms -> {after['ttfb']['avg']:.1f}ms\")
"
```

## CI/CD Integration

Tests exit with proper codes for automation:

```bash
make test && echo "PASS" || echo "FAIL"
```

Example GitHub Actions:

```yaml
name: Integration Tests
on: [push, pull_request]
jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      - uses: actions/setup-python@v4
        with:
          python-version: '3.12'
      - run: make test-setup
      - run: make test HOST=${{ secrets.TEST_DEVICE_IP }}
      - uses: actions/upload-artifact@v3
        with:
          name: test-results
          path: test_results/
```

## Troubleshooting

**Cannot resolve sotacat.local**
```bash
make test HOST=192.168.1.100  # Use IP instead
```

**Virtual environment not found**
```bash
make test-setup
```

**Low stress test success rate**
- Check "Radio busy errors" (should be 0%)
- High "Timeout errors" = network issues, not mutex problems
- Try: `make test-mutex STRESS_CLIENTS=5` (fewer clients)

## Documentation

For detailed information, see:

- **[test/integration/README.md](test/integration/README.md)** - Complete test suite documentation
  - Detailed test descriptions
  - All Makefile targets
  - Test organization
  - Adding new tests
  - Troubleshooting guide

- **[test/integration/COVERAGE.md](test/integration/COVERAGE.md)** - Test coverage details
  - Endpoint coverage summary
  - What's tested vs. not tested
  - Coverage statistics (~60% of all API endpoints)

- **[PlatformIO Unit Testing](https://docs.platformio.org/en/latest/advanced/unit-testing/index.html)** - Unit test framework

## Unit Tests

PlatformIO unit tests run embedded code directly on the device.

```bash
pio test -e seeed_xiao_esp32c3_debug
```

See `test/README` for more information about PlatformIO unit testing.
