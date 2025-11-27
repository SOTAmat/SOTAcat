# SOTAcat Testing Guide

## Overview

SOTAcat uses a multi-level testing strategy:

1. **Unit Tests** - Embedded tests that run on the device (PlatformIO)
2. **Integration Tests** - Tests that run against a live device over the network
3. **Performance Tests** - Specialized tests for web server performance

## Quick Start

### Run Performance Tests

```bash
# From project root
cd test/integration

# One-time setup
make setup

# Run quick test
make test

# Or using IP address
make test HOST=192.168.1.100
```

## Test Structure

```
test/
├── README                          # PlatformIO unit test info
└── integration/                    # Integration tests
    ├── README.md                   # Detailed integration test docs
    ├── Makefile                    # Convenient test commands
    ├── run_performance_test.sh     # Wrapper script
    ├── test_webserver_performance.py  # Full-featured test
    └── test_webserver_simple.py    # No-dependency test
```

## Integration Tests

### Performance Testing

Located in `test/integration/`, these tests measure:
- mDNS resolution time
- TCP connection establishment
- HTTP Time-to-First-Byte (TTFB)
- Full page load times
- Error rates and timeouts

**Quick reference:**

```bash
cd test/integration

# Show available targets
make help

# Run tests
make test              # Quick 5-iteration test
make test-full         # Full 10-iteration test
make baseline          # Capture baseline (20 iterations, saved to JSON)
make stress            # Stress test (100 iterations)

# Custom iterations
make test-full ITERATIONS=50

# Test with IP address
make test HOST=192.168.1.100
```

### Manual Test Execution

```bash
# Using venv Python directly
../../.venv/bin/python3 test_webserver_performance.py --host sotacat.local

# Or use wrapper script
./run_performance_test.sh --host sotacat.local --iterations 20
```

## Performance Benchmarking

### Establish Baseline

Before making changes:

```bash
cd test/integration
make baseline
# Saves to baseline_YYYYMMDD_HHMMSS.json
```

### Test After Changes

After firmware modifications:

```bash
# Flash new firmware
cd ../..
pio run -e seeed_xiao_esp32c3_release -t upload

# Wait for device to boot
sleep 5

# Run test
cd test/integration
make test-full ITERATIONS=20 > after_changes.txt
```

### Compare Results

```bash
# Compare two JSON results
diff <(jq -S . baseline_20251126_120000.json) \
     <(jq -S . baseline_20251126_130000.json)

# Or use Python to analyze
python3 -c "
import json
before = json.load(open('before.json'))
after = json.load(open('after.json'))
print(f\"TTFB: {before['ttfb']['avg']*1000:.1f}ms -> {after['ttfb']['avg']*1000:.1f}ms\")
"
```

## Continuous Integration

### GitHub Actions Example

```yaml
name: Integration Tests

on: [push, pull_request]

jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3

      - name: Set up Python
        uses: actions/setup-python@v4
        with:
          python-version: '3.12'

      - name: Install dependencies
        run: |
          cd test/integration
          make setup

      - name: Run integration tests
        run: |
          cd test/integration
          make test-full HOST=${{ secrets.TEST_DEVICE_IP }}

      - name: Upload results
        uses: actions/upload-artifact@v3
        with:
          name: test-results
          path: test/integration/*.json
```

## Unit Tests (PlatformIO)

See `test/README` for information about embedded unit tests.

```bash
# Run embedded tests
pio test -e seeed_xiao_esp32c3_debug
```

## Troubleshooting

### Cannot resolve sotacat.local

**Problem**: DNS resolution fails for .local hostname

**Solutions**:
1. Use IP address: `make test HOST=192.168.1.100`
2. Check mDNS service: `avahi-browse -a` (Linux) or `dns-sd -B _http._tcp` (macOS)
3. Verify device is on same network

### ImportError: No module named 'requests'

**Problem**: Dependencies not installed

**Solution**:
```bash
cd test/integration
make setup
```

### Connection timeout

**Problem**: Cannot connect to device

**Solutions**:
1. Verify device is powered and connected to WiFi
2. Check firewall rules
3. Ping device: `ping sotacat.local` or `ping 192.168.1.100`
4. Check device logs via serial console

### Inconsistent results

**Problem**: High variance between test runs

**Solutions**:
1. Run more iterations: `make test-full ITERATIONS=50`
2. Check WiFi signal strength
3. Verify no other network activity
4. Test at different times to rule out interference

## See Also

- [Integration Test README](test/integration/README.md) - Detailed integration test docs
- [Test Coverage](test/integration/COVERAGE.md) - Complete asset coverage
- [PlatformIO Unit Testing](https://docs.platformio.org/en/latest/advanced/unit-testing/index.html)
