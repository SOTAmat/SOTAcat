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
    callSign: null,
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
// expandCwMacroTemplate Tests
// ============================================================================

// Copied from main.js for unit testing
function getLocationBasedReference_forMacro() { return mockReference; }

function expandCwMacroTemplate(template) {
    if (!template) return "";
    const freqHz = AppState.vfoFrequencyHz || 0;
    const replacements = {
        MYCALL: AppState.callSign || "",
        MYREF: getLocationBasedReference_forMacro() || "",
        "FREQ-KHZ": freqHz ? Math.round(freqHz / 1000).toString() : "",
        "FREQ-MHZ": freqHz ? (freqHz / 1e6).toFixed(3) : "",
        MODE: (AppState.vfoMode || "").toLowerCase(),
    };
    let result = template;
    for (const [key, value] of Object.entries(replacements)) {
        result = result.replace(new RegExp("\\{" + key + "\\}", "gi"), value);
    }
    return result.replace(/  +/g, " ").trim();
}

describe('expandCwMacroTemplate', () => {
    it('substitutes {MYCALL} with callSign', () => {
        AppState.callSign = "AB6D";
        AppState.vfoFrequencyHz = 14062000;
        AppState.vfoMode = "CW";
        mockReference = "W6/NC-298";

        const result = expandCwMacroTemplate("CQ SOTA DE {MYCALL} K");
        assertEqual(result, "CQ SOTA DE AB6D K", "MYCALL substitution");
    });

    it('substitutes {MYREF} with reference', () => {
        AppState.callSign = "AB6D";
        mockReference = "W6/NC-298";

        const result = expandCwMacroTemplate("UR 5NN {MYREF} BK");
        assertEqual(result, "UR 5NN W6/NC-298 BK", "MYREF substitution");
    });

    it('substitutes {FREQ-KHZ} from vfoFrequencyHz', () => {
        AppState.vfoFrequencyHz = 14062000;

        const result = expandCwMacroTemplate("QSY {FREQ-KHZ}");
        assertEqual(result, "QSY 14062", "FREQ-KHZ substitution");
    });

    it('substitutes {FREQ-MHZ} from vfoFrequencyHz', () => {
        AppState.vfoFrequencyHz = 14062000;

        const result = expandCwMacroTemplate("ON {FREQ-MHZ}");
        assertEqual(result, "ON 14.062", "FREQ-MHZ substitution");
    });

    it('substitutes {MODE} as lowercase', () => {
        AppState.vfoMode = "CW";

        const result = expandCwMacroTemplate("MODE {MODE}");
        assertEqual(result, "MODE cw", "MODE substitution lowercase");
    });

    it('is case-insensitive for placeholders', () => {
        AppState.callSign = "AB6D";
        const result = expandCwMacroTemplate("DE {mycall} K");
        assertEqual(result, "DE AB6D K", "case-insensitive matching");
    });

    it('collapses double spaces from empty substitutions', () => {
        AppState.callSign = "";
        mockReference = "";
        const result = expandCwMacroTemplate("CQ {MYCALL} {MYREF} K");
        assertEqual(result, "CQ K", "double spaces collapsed");
    });

    it('returns template unchanged when no placeholders', () => {
        const result = expandCwMacroTemplate("PSE AGN");
        assertEqual(result, "PSE AGN", "no placeholders");
    });

    it('handles multiple placeholders in one template', () => {
        AppState.callSign = "AB6D";
        mockReference = "W6/NC-298";
        AppState.vfoFrequencyHz = 7030000;
        AppState.vfoMode = "CW";

        const result = expandCwMacroTemplate("{MYCALL} {MYREF} {FREQ-KHZ} {MODE}");
        assertEqual(result, "AB6D W6/NC-298 7030 cw", "multiple placeholders");
    });

    it('returns empty string for null template', () => {
        assertEqual(expandCwMacroTemplate(null), "", "null template");
    });

    it('returns empty string for empty template', () => {
        assertEqual(expandCwMacroTemplate(""), "", "empty template");
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
