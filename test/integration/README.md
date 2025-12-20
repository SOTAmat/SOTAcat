# Integration Tests for SOTAcat

This directory contains integration tests that run against a live SOTAcat device.

## Test Types

### Performance Tests
Tests that measure web server performance, response times, and reliability.

- **`test_webserver_performance.py`** - Performance test suite
  - Requires: Python 3, requests, zeroconf (installed via `make setup`)
  - Measures: mDNS resolution, TTFB, full page load, error rates
  - Usage: `make test` or `./test_webserver_performance.py --host sotacat.local`
  - **Tests ALL 20 endpoints:**
    - 6 HTML pages (/, /index.html, /about.html, /cat.html, /chase.html, /settings.html)
    - 6 JavaScript files (about.js, cat.js, chase.js, chase_api.js, main.js, settings.js)
    - 1 CSS file (style.css)
    - 2 Images (favicon.ico, sclogo.jpg)
    - 5 API endpoints (version, connectionStatus, batteryPercent, rssi, settings)

## Setup

```bash
# From test/integration directory
make setup

# Or manually:
cd ../..  # to project root
python3 -m venv .venv
.venv/bin/pip install requests zeroconf
```

## Running Tests

### Quick smoke test
```bash
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
