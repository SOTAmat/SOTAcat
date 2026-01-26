# Test Coverage - Web Server Assets

## Overview

The performance test suite validates **100% of web server assets** declared in `src/webserver.cpp`.

## Complete Asset Coverage (18 endpoints)

### HTML Pages (6)
- ✅ `/` - Main index (root)
- ✅ `/index.html` - Main index (explicit)
- ✅ `/about.html` - About page
- ✅ `/run.html` - Run page (activator controls)
- ✅ `/chase.html` - Chase/SOTA page
- ✅ `/settings.html` - Settings page

### JavaScript Files (6)
- ✅ `/about.js` - About page script
- ✅ `/run.js` - Run page script
- ✅ `/chase.js` - Chase page script
- ✅ `/chase_api.js` - Chase API integration
- ✅ `/main.js` - Main application script
- ✅ `/settings.js` - Settings page script

### CSS Files (1)
- ✅ `/style.css` - Main stylesheet

### Images (2)
- ✅ `/favicon.ico` - Browser favicon
- ✅ `/sclogo.jpg` - SOTAcat logo

### API Endpoints (4)
These are GET endpoints that don't require radio connection:

- ✅ `/api/v1/version` - Firmware version
- ✅ `/api/v1/connectionStatus` - Radio connection status
- ✅ `/api/v1/batteryInfo` - Battery information (JSON with charging, state_of_charge_pct, time estimates)
- ✅ `/api/v1/rssi` - WiFi signal strength
- ✅ `/api/v1/settings` - Device settings

## Radio-Connected Endpoints

The following API endpoints require an active radio connection and are tested by the **mutex stress test** (`test_mutex_stress.py`):

### Tested by Mutex Stress Test
These endpoints are tested under concurrent load to validate the 3-tier timeout system:

- ✅ `/api/v1/frequency` (GET/PUT) - Tested with both GET polling and SET operations
- ✅ `/api/v1/mode` (GET) - Tested with aggressive polling
- ✅ `/api/v1/power` (GET) - Tested with browser client polling
- ✅ `/api/v1/connectionStatus` (GET) - Tested for radio status

### Not Tested (Require Radio + Special Conditions)
The following endpoints require specific radio states or have side effects that make automated testing difficult:

- `/api/v1/rxBandwidth` (GET/PUT) - Radio setting
- `/api/v1/keyer` (PUT) - Morse keyer operation
- `/api/v1/msg` (PUT) - Message transmission
- `/api/v1/time` (PUT) - Radio clock sync
- `/api/v1/xmit` (PUT) - Transmit control
- `/api/v1/atu` (PUT) - ATU tuning (long operation)
- `/api/v1/prepareft8` (POST) - FT8 preparation
- `/api/v1/ft8` (POST) - FT8 transmission
- `/api/v1/cancelft8` (POST) - FT8 cancellation
- `/api/v1/reboot` (GET) - System reboot (destructive)
- `/api/v1/gps` (GET/POST) - GPS data
- `/api/v1/callsign` (GET/POST) - Callsign management
- `/api/v1/ota` (POST) - OTA firmware update (destructive)

## Validation

To verify coverage matches webserver.cpp:

```bash
# Extract endpoints from webserver.cpp
grep -E '^\s*\{"/' ../../src/webserver.cpp | grep -v NULL

# Compare with test script
grep -A 30 'self.test_endpoints = \[' test_webserver_performance.py
```

## Test Execution

Every test iteration requests ALL 18 endpoints and measures:
- Response time (total)
- Time to First Byte (TTFB)
- HTTP status code
- Error/timeout tracking

Example output:
```
Testing 18 endpoints:
  - HTML pages: 6
  - JavaScript: 6
  - CSS: 1
  - Images: 2
  - API endpoints: 3

Running 10 iterations...
```

## Test Suites

### Performance Test (`test_webserver_performance.py`)
Tests static assets and non-radio API endpoints:
- Measures response times, TTFB, full page load
- Tests 18 endpoints per iteration
- Default: 10 iterations
- Run with: `make test-performance`

### Mutex Stress Test (`test_mutex_stress.py`)
Tests radio-connected endpoints under concurrent load:
- Simulates 7 concurrent clients (2 SOTAmat + 4 Browser + 1 Control)
- Tests frequency/mode/power GET operations
- Tests frequency PUT operations (SET)
- Validates 3-tier timeout system (500ms/2000ms/10000ms)
- Default: 60 seconds duration
- Run with: `make test-mutex`

### Unified Test Runner (`run_tests.py`)
Orchestrates all tests:
- Default: `make test` (10 iterations, 60s stress)
- Quick: `make test ITERATIONS=5 STRESS_DURATION=30`
- Extended: `make test ITERATIONS=20`

## Future Enhancements

To achieve 100% API coverage:

1. Add mock radio mode for destructive operations testing
2. Add GPS/callsign endpoint testing
3. Add WebSocket tests (if/when WebSocket support is added)
4. Add FT8 workflow testing (prepare → transmit → cancel)

## Maintenance

When assets are added/removed in `src/webserver.cpp`:

1. Update `test_webserver_performance.py` endpoint list
2. Update `test_mutex_stress.py` client polling patterns if needed
3. Update this coverage document
4. Re-run baseline tests: `make test`

## Coverage Summary

| Test Suite        | Endpoints Tested    | Coverage                      |
|-------------------|---------------------|-------------------------------|
| Performance Test  | 18 static/non-radio | 100% of testable assets       |
| Mutex Stress Test | 4 radio endpoints   | Core GET/SET operations       |
| **Total**         | **22 endpoints**    | **~60% of all API endpoints** |

The remaining ~40% of API endpoints (FT8, ATU, keyer, GPS, OTA, etc.) require specific radio states, have side effects (transmit, reboot), or need specialized testing conditions.

Last updated: 2025-11-29
