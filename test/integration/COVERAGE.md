# Test Coverage - Web Server Assets

## Overview

The performance test suite validates **100% of web server assets** declared in `src/webserver.cpp`.

## Complete Asset Coverage (20 endpoints)

### HTML Pages (6)
- ✅ `/` - Main index (root)
- ✅ `/index.html` - Main index (explicit)
- ✅ `/about.html` - About page
- ✅ `/cat.html` - CAT control page
- ✅ `/chase.html` - Chase/SOTA page
- ✅ `/settings.html` - Settings page

### JavaScript Files (6)
- ✅ `/about.js` - About page script
- ✅ `/cat.js` - CAT control script
- ✅ `/chase.js` - Chase page script
- ✅ `/chase_api.js` - Chase API integration
- ✅ `/main.js` - Main application script
- ✅ `/settings.js` - Settings page script

### CSS Files (1)
- ✅ `/style.css` - Main stylesheet

### Images (2)
- ✅ `/favicon.ico` - Browser favicon
- ✅ `/sclogo.jpg` - SOTAcat logo

### API Endpoints (5)
These are GET endpoints that don't require radio connection:

- ✅ `/api/v1/version` - Firmware version
- ✅ `/api/v1/connectionStatus` - Radio connection status
- ✅ `/api/v1/batteryPercent` - Battery percentage
- ✅ `/api/v1/batteryVoltage` - Battery voltage
- ✅ `/api/v1/settings` - Device settings

## Not Tested (Radio Required)

The following API endpoints require an active radio connection and are NOT tested to avoid false failures:

- `/api/v1/frequency` (GET/PUT)
- `/api/v1/mode` (GET/PUT)
- `/api/v1/power` (GET/PUT)
- `/api/v1/rxBandwidth` (GET/PUT)
- `/api/v1/keyer` (PUT)
- `/api/v1/msg` (PUT)
- `/api/v1/time` (PUT)
- `/api/v1/xmit` (PUT)
- `/api/v1/atu` (PUT)
- `/api/v1/prepareft8` (POST)
- `/api/v1/ft8` (POST)
- `/api/v1/cancelft8` (POST)
- `/api/v1/reboot` (GET)
- `/api/v1/gps` (GET/POST)
- `/api/v1/callsign` (GET/POST)
- `/api/v1/ota` (POST)

## Validation

To verify coverage matches webserver.cpp:

```bash
# Extract endpoints from webserver.cpp
grep -E '^\s*\{"/' ../../src/webserver.cpp | grep -v NULL

# Compare with test script
grep -A 30 'self.test_endpoints = \[' test_webserver_performance.py
```

## Test Execution

Every test iteration requests ALL 20 endpoints and measures:
- Response time (total)
- Time to First Byte (TTFB)
- HTTP status code
- Error/timeout tracking

Example output:
```
Testing 20 endpoints:
  - HTML pages: 6
  - JavaScript: 6
  - CSS: 1
  - Images: 2
  - API endpoints: 5

Running 10 iterations...
```

## Future Enhancements

To achieve 100% API coverage:

1. Add mock radio mode for testing
2. Add separate test suite that runs with radio connected
3. Add WebSocket tests (if/when WebSocket support is added)
4. Add concurrent request testing (browser typically opens 6 parallel connections)

## Maintenance

When assets are added/removed in `src/webserver.cpp`:

1. Update `test_webserver_performance.py` endpoint list
2. Update this coverage document
3. Re-run baseline tests

Last updated: 2025-11-26
