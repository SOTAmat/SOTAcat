#!/usr/bin/env node
/**
 * Unit tests for run.js SMS spotting functions
 *
 * Tests SMS message construction for SOTAMAT:
 * - Mode mapping (mapModeForSotamat)
 * - Spot SMS URI construction (buildSpotSmsUri)
 * - QRT SMS URI construction (buildQrtSmsUri)
 *
 * Usage:
 *   node test/unit/test_run.js
 */

// ============================================================================
// Test Framework (minimal, no dependencies — same as test_qrx.js)
// ============================================================================

let testsPassed = 0;
let testsFailed = 0;
const failures = [];

function describe(name, fn) {
    console.log(`\n${name}`);
    fn();
}

function it(name, fn) {
    try {
        fn();
        testsPassed++;
        console.log(`  ✓ ${name}`);
    } catch (e) {
        testsFailed++;
        console.log(`  ✗ ${name}`);
        console.log(`    ${e.message}`);
        failures.push({ name, error: e.message });
    }
}

function assertEqual(actual, expected, msg = '') {
    if (actual !== expected) {
        throw new Error(`${msg}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
    }
}

function assertTrue(value, msg = '') {
    if (!value) {
        throw new Error(`${msg}: expected truthy value, got ${value}`);
    }
}

// ============================================================================
// Extracted functions from run.js (for unit testing)
// ============================================================================

function mapModeForSotamat(mode) {
    if (!mode) return "ssb";
    const upper = mode.toUpperCase();
    if (upper === "USB" || upper === "LSB") return "ssb";
    if (upper === "CW_R") return "cw";
    if (upper === "FT8" || upper === "FT4") return "data";
    return upper.toLowerCase();
}

// ============================================================================
// Minimal mocks for buildSpotSmsUri / buildQrtSmsUri
// ============================================================================

const SOTAMAT_SMS_NUMBER = "+16017682628";
const SOTA_REF_PATTERN = /^[A-Z0-9]{1,4}\/[A-Z]{2}-\d{3}$/;
const POTA_REF_PATTERN = /^[A-Z]{1,2}-\d{4,5}$/;

const AppState = {
    vfoFrequencyHz: null,
    vfoMode: null,
};

let mockReference = "";

function getLocationBasedReference() { return mockReference; }
function isValidSpotReference(ref) {
    if (!ref) return false;
    return SOTA_REF_PATTERN.test(ref) || POTA_REF_PATTERN.test(ref);
}
function isSotaReference(ref) { return SOTA_REF_PATTERN.test(ref); }

// Copied from run.js (with mapModeForSotamat already defined above)
function buildSpotSmsUri() {
    const ref = getLocationBasedReference() || "";
    if (!isValidSpotReference(ref)) return null;

    const cmd = isSotaReference(ref) ? "sm" : "psm";
    const freqMhz = ((AppState.vfoFrequencyHz || 14285000) / 1000000).toFixed(4);
    const mode = mapModeForSotamat(AppState.vfoMode || "SSB");

    const message = `${cmd} ${ref} ${freqMhz} ${mode}`;
    return `sms:${SOTAMAT_SMS_NUMBER}?body=${encodeURIComponent(message)}`;
}

function buildQrtSmsUri() {
    const ref = getLocationBasedReference() || "";
    if (!isValidSpotReference(ref)) return null;

    const cmd = isSotaReference(ref) ? "sm" : "psm";
    const freqMhz = ((AppState.vfoFrequencyHz || 14285000) / 1000000).toFixed(4);

    const message = `${cmd} ${ref} ${freqMhz} QRT`;
    return `sms:${SOTAMAT_SMS_NUMBER}?body=${encodeURIComponent(message)}`;
}

// Helper: decode the SMS body from a URI
function decodeSmsBody(uri) {
    const bodyParam = uri.split("?body=")[1];
    return decodeURIComponent(bodyParam);
}

// ============================================================================
// Tests
// ============================================================================

describe('mapModeForSotamat', () => {
    it('maps USB to ssb', () => {
        assertEqual(mapModeForSotamat("USB"), "ssb");
    });

    it('maps LSB to ssb', () => {
        assertEqual(mapModeForSotamat("LSB"), "ssb");
    });

    it('maps usb (lowercase) to ssb', () => {
        assertEqual(mapModeForSotamat("usb"), "ssb");
    });

    it('maps lsb (lowercase) to ssb', () => {
        assertEqual(mapModeForSotamat("lsb"), "ssb");
    });

    it('maps CW_R to cw', () => {
        assertEqual(mapModeForSotamat("CW_R"), "cw");
    });

    it('passes CW through as cw', () => {
        assertEqual(mapModeForSotamat("CW"), "cw");
    });

    it('maps FT8 to data', () => {
        assertEqual(mapModeForSotamat("FT8"), "data");
    });

    it('maps FT4 to data', () => {
        assertEqual(mapModeForSotamat("FT4"), "data");
    });

    it('passes FM through as fm', () => {
        assertEqual(mapModeForSotamat("FM"), "fm");
    });

    it('passes AM through as am', () => {
        assertEqual(mapModeForSotamat("AM"), "am");
    });

    it('passes DATA through as data', () => {
        assertEqual(mapModeForSotamat("DATA"), "data");
    });

    it('returns ssb for null input', () => {
        assertEqual(mapModeForSotamat(null), "ssb");
    });

    it('returns ssb for undefined input', () => {
        assertEqual(mapModeForSotamat(undefined), "ssb");
    });

    it('returns ssb for empty string', () => {
        assertEqual(mapModeForSotamat(""), "ssb");
    });

    it('maps SSB through as ssb', () => {
        assertEqual(mapModeForSotamat("SSB"), "ssb");
    });
});

describe('buildSpotSmsUri', () => {
    describe('SOTA references use "sm" command', () => {
        it('builds correct URI for SOTA with LSB mode', () => {
            mockReference = "W6/NC-423";
            AppState.vfoFrequencyHz = 7237000;
            AppState.vfoMode = "LSB";

            const uri = buildSpotSmsUri();
            const body = decodeSmsBody(uri);
            assertEqual(body, "sm W6/NC-423 7.2370 ssb", "LSB should map to ssb");
        });

        it('builds correct URI for SOTA with USB mode', () => {
            mockReference = "W6/NC-150";
            AppState.vfoFrequencyHz = 14285000;
            AppState.vfoMode = "USB";

            const uri = buildSpotSmsUri();
            const body = decodeSmsBody(uri);
            assertEqual(body, "sm W6/NC-150 14.2850 ssb", "USB should map to ssb");
        });

        it('builds correct URI for SOTA with CW mode', () => {
            mockReference = "W6/NC-150";
            AppState.vfoFrequencyHz = 7030000;
            AppState.vfoMode = "CW";

            const uri = buildSpotSmsUri();
            const body = decodeSmsBody(uri);
            assertEqual(body, "sm W6/NC-150 7.0300 cw");
        });

        it('builds correct URI for SOTA with FT8 mode', () => {
            mockReference = "W6/NC-150";
            AppState.vfoFrequencyHz = 7074000;
            AppState.vfoMode = "FT8";

            const uri = buildSpotSmsUri();
            const body = decodeSmsBody(uri);
            assertEqual(body, "sm W6/NC-150 7.0740 data");
        });

        it('builds correct URI for SOTA with FM mode', () => {
            mockReference = "W6/NC-150";
            AppState.vfoFrequencyHz = 146520000;
            AppState.vfoMode = "FM";

            const uri = buildSpotSmsUri();
            const body = decodeSmsBody(uri);
            assertEqual(body, "sm W6/NC-150 146.5200 fm");
        });
    });

    describe('POTA references use "psm" command', () => {
        it('builds correct URI for POTA with USB mode', () => {
            mockReference = "K-1234";
            AppState.vfoFrequencyHz = 14285000;
            AppState.vfoMode = "USB";

            const uri = buildSpotSmsUri();
            const body = decodeSmsBody(uri);
            assertEqual(body, "psm K-1234 14.2850 ssb", "POTA should use psm command");
        });

        it('builds correct URI for POTA with LSB mode', () => {
            mockReference = "US-12345";
            AppState.vfoFrequencyHz = 7237000;
            AppState.vfoMode = "LSB";

            const uri = buildSpotSmsUri();
            const body = decodeSmsBody(uri);
            assertEqual(body, "psm US-12345 7.2370 ssb");
        });
    });

    describe('defaults', () => {
        it('defaults to SSB when vfoMode is null', () => {
            mockReference = "W6/NC-150";
            AppState.vfoFrequencyHz = 14285000;
            AppState.vfoMode = null;

            const uri = buildSpotSmsUri();
            const body = decodeSmsBody(uri);
            assertEqual(body, "sm W6/NC-150 14.2850 ssb");
        });

        it('defaults frequency to 14.2850 MHz when null', () => {
            mockReference = "W6/NC-150";
            AppState.vfoFrequencyHz = null;
            AppState.vfoMode = "USB";

            const uri = buildSpotSmsUri();
            const body = decodeSmsBody(uri);
            assertEqual(body, "sm W6/NC-150 14.2850 ssb");
        });

        it('sends to correct phone number', () => {
            mockReference = "W6/NC-150";
            AppState.vfoFrequencyHz = 14285000;
            AppState.vfoMode = "USB";

            const uri = buildSpotSmsUri();
            assertTrue(uri.startsWith("sms:+16017682628?"), "Should use SOTAMAT number");
        });
    });

    it('returns null for invalid reference', () => {
        mockReference = "INVALID";
        assertEqual(buildSpotSmsUri(), null);
    });

    it('returns null for empty reference', () => {
        mockReference = "";
        assertEqual(buildSpotSmsUri(), null);
    });
});

describe('buildQrtSmsUri', () => {
    it('uses QRT as the mode field (no separate mode)', () => {
        mockReference = "W6/NC-423";
        AppState.vfoFrequencyHz = 7237000;
        AppState.vfoMode = "LSB";

        const uri = buildQrtSmsUri();
        const body = decodeSmsBody(uri);
        assertEqual(body, "sm W6/NC-423 7.2370 QRT", "QRT should replace mode field");
    });

    it('does not include radio mode before QRT', () => {
        mockReference = "W6/NC-150";
        AppState.vfoFrequencyHz = 14285000;
        AppState.vfoMode = "USB";

        const uri = buildQrtSmsUri();
        const body = decodeSmsBody(uri);
        assertTrue(!body.includes("ssb"), "Should not contain mode string");
        assertTrue(!body.includes("usb"), "Should not contain raw radio mode");
        assertEqual(body, "sm W6/NC-150 14.2850 QRT");
    });

    it('uses psm for POTA QRT', () => {
        mockReference = "K-1234";
        AppState.vfoFrequencyHz = 14285000;
        AppState.vfoMode = "CW";

        const uri = buildQrtSmsUri();
        const body = decodeSmsBody(uri);
        assertEqual(body, "psm K-1234 14.2850 QRT");
    });

    it('returns null for invalid reference', () => {
        mockReference = "INVALID";
        assertEqual(buildQrtSmsUri(), null);
    });
});

// ============================================================================
// Summary
// ============================================================================

console.log('\n' + '='.repeat(60));
console.log(`Results: ${testsPassed} passed, ${testsFailed} failed`);
if (failures.length > 0) {
    console.log('\nFailures:');
    for (const f of failures) {
        console.log(`  - ${f.name}: ${f.error}`);
    }
}
console.log('='.repeat(60));

process.exit(testsFailed > 0 ? 1 : 0);
