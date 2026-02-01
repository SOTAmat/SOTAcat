# Integration Tests for SOTAcat

This directory contains integration tests for the SOTAcat firmware and UI.

## Test Types

### Device Tests (require live SOTAcat device)

- **`test_webserver_performance.py`** - Performance test suite
  - Measures: mDNS resolution, TTFB, full page load, error rates
  - Tests all 20 endpoints (HTML, JS, CSS, images, API)

- **`test_mutex_stress.py`** - Multi-client stress test
  - Tests concurrent access handling

### UI Tests (can run offline with mock server)

- **`test_ui.py`** - Browser-based UI tests using Playwright
  - Tests page loads, element presence, tab navigation
  - Tests form inputs and interactions
  - Checks for JavaScript errors
  - Can run against mock server OR real device

## Setup

### For Device Tests
```bash
# From test/integration directory
make setup

# Or manually:
cd ../..  # to project root
python3 -m venv .venv
.venv/bin/pip install requests zeroconf
```

### For UI Tests
```bash
# Install Playwright (one-time)
pipx run --spec playwright playwright install chromium
```

## Running Tests

### UI Tests (with mock server - no device needed)
```bash
# Auto-start mock server and run UI tests
./run_tests.py --ui --mock

# With visible browser
./run_tests.py --ui --mock --headed

# Or run directly with pipx
cd ../mock_server && pipx run server.py &
pipx run ../integration/test_ui.py --base-url http://localhost:8080
```

### UI Tests (against real device)
```bash
./run_tests.py --ui --host sotacat.local
# Or:
pipx run test_ui.py --base-url http://sotacat.local
```

### Device Tests
```bash
# Quick smoke test
make test
# Or with IP address:
make test HOST=192.168.1.100
```

### Baseline performance capture
```bash
./test/integration/test_webserver_performance.py \
  --host sotacat.local \
  --iterations 20 \
  --output baseline_$(date +%Y%m%d).json
```

### Stress test
```bash
make stress
```

### Compare before/after changes
```bash
# Before changes
./test/integration/test_webserver_performance.py \
  --iterations 20 --output before.json

# After changes (flash new firmware)
./test/integration/test_webserver_performance.py \
  --iterations 20 --output after.json

# Compare results
diff <(jq -S . before.json) <(jq -S . after.json)
```

## CI/CD Integration

These tests can be integrated into a CI/CD pipeline:

```yaml
# Example GitHub Actions
- name: Run integration tests
  run: |
    python3 -m venv .venv
    .venv/bin/pip install requests zeroconf
    .venv/bin/python test/integration/test_webserver_performance.py \
      --host ${{ secrets.TEST_DEVICE_IP }} \
      --iterations 10 \
      --output test_results.json
```

## Test Results

Test results are saved as JSON with this structure:

```json
{
  "timestamp": "2025-11-26T16:45:00",
  "mdns_resolution": {
    "min": 0.5,
    "max": 2.3,
    "avg": 1.2,
    "p50": 1.1,
    "p95": 2.0
  },
  "ttfb": { ... },
  "full_page_load": { ... },
  "endpoints": { ... },
  "errors": [],
  "timeout_count": 0
}
```

## Expected Performance Targets

### Good Performance
- mDNS resolution: < 1s
- TTFB: < 200ms
- Full page load: < 1.5s
- Error rate: < 1%

### Needs Investigation
- mDNS resolution: > 2s
- TTFB: > 500ms
- Full page load: > 3s
- Error rate: > 5%

## Troubleshooting

### "Cannot resolve sotacat.local"
- Check device is powered on and connected to WiFi
- Try using IP address instead: `--host 192.168.1.XXX`
- Check mDNS is working: `avahi-browse -a` (Linux) or `dns-sd -B _http._tcp` (macOS)

### "Connection timeout"
- Verify device is on same network
- Check firewall settings
- Try increasing timeout: modify `timeout=10.0` in script

### High variance in results
- Run more iterations: `--iterations 50`
- Check for network congestion
- Verify stable WiFi signal strength

## See Also

- [Test Coverage](COVERAGE.md) - Complete asset coverage documentation
- [Testing Guide](../../TESTING.md) - Top-level testing documentation
- [PlatformIO Unit Tests](../README) - Embedded unit tests
