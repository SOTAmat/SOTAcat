# SOTAcat Testing Guide

Works on **Linux**, **macOS**, and **Windows**.

## Quick Start

```bash
# From project root – Linux/macOS
make test-unit      # JS unit tests (no device, no setup required)
make test-setup     # One-time setup for integration tests: create venv and install deps
make test           # Run integration suite (default: 10 iterations, 60s stress)

# Quick validation
make test ITERATIONS=5 STRESS_DURATION=30
```

```powershell
# From project root – Windows (no make required)
python test/integration/setup_env.py                    # One-time setup
python test/integration/run_tests.py --all              # Run full test suite
python test/integration/run_tests.py --all --host 192.168.1.100
```

## Test Overview

SOTAcat has a comprehensive test suite covering:

1. **Unit Tests** (`test/unit/`) — Pure JavaScript tests for web-UI logic. Run with Node.js, no device required.
2. **Performance Tests** (`test/integration/`) — Web server response times, asset loading, mDNS resolution. Requires a live device.
3. **Stress Tests** (`test/integration/`) — Multi-client concurrent access, mutex timeout validation. Requires a live device.

### Unit Tests
Pure JS tests for extracted web-UI logic. Each `test/unit/test_*.js` file runs standalone under Node.js with no dependencies — `make test-unit` runs all of them. The harness is a small custom runner (no Jest/Mocha); each file builds its own VM sandbox and loads only the code under test (usually by extracting specific functions from the relevant `src/web/*.js` file). PlatformIO's old unit-test harness is no longer used.

**Test files (`test/unit/`)**:

| File | Scope |
|---|---|
| `test_band_range_drag.js` | Drag-to-tune math: pixel → Hz, snap step per mode, clamp to band edges |
| `test_bandprivileges.js` | FCC privilege tables (HF + VHF/UHF), mode categories, bandwidth/edge logic, 97.305(c) phone/data segregation |
| `test_battery_charging.js` | Battery charging icon selection from API state |
| `test_chase_resume.js` | Chase/Scan resume from last row (#102): startScan picks `clickedTunedRow` first; advanceScan increments before tune; empty-row stop |
| `test_chase_tab_reentry.js` | Chase tab re-entry: subscribe/unsubscribe paired across attach/leave cycles (no subscriber leak); `onChaseSpotsChanged` rebuilds the table |
| `test_qrx.js` | QRX-page helpers: distance formatting, reference auto-formatting |
| `test_radio_capabilities.js` | `RADIO_CAPABILITIES` per-radio table; `getRadioBands` / `getRadioModes` / `radioCanTransmit` |
| `test_run.js` | RUN helpers: SOTAmat SMS construction, CW macro expansion, `getKeyerFamily` (CW vs DATA vs forced-CW), `getVisibleLicenseClasses` |
| `test_run_spot_ticks.js` | `buildSpotTickData` — band filter, position %, mode category; tap-to-tune dispatch; defer-rebuild-during-drag; unsubscribe on tab exit |
| `test_spots.js` | `spots.js` module: cache, refresh + force, rate-limit, concurrent dedup, subscribe/unsubscribe (incl. self-unsubscribe during notify), auto-refresh state machine |
| `test_tune.js` | `tuneRadioHz`: SSB sideband by frequency boundary, CW preservation |
| `test_xota_deeplink.js` | SOTAmat / PoLo deep-link URL construction, `getSigFromReference` pattern matching |

**Not yet covered (backend C++):** `src/handler_*.cpp`, `src/radio_driver_kx.cpp`, the CAT protocol core, and the keyer chunking / TQ polling logic (#101 no-false-disconnect fix, #98 RTTY/PSK keying) have no test harness. Introducing host-side Unity or Catch2 is a separate initiative; until then, those changes are manually validated against a real device via `make test` (integration).

**Related**: in-progress feature specs and implementation plans live under [`docs/superpowers/specs/`](docs/superpowers/specs/) and [`docs/superpowers/plans/`](docs/superpowers/plans/).

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
make test-unit                          # JS unit tests (no setup, no device)
make test-setup                         # Setup integration env (once)
make test                               # Integration default (10 iterations, 60s stress)
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
python -c "
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
# Windows: python test/integration/setup_env.py
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
