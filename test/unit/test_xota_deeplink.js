#!/usr/bin/env node
/**
 * Unit tests for the shared xOTA deep-link encoder used by both Polo and
 * SOTAmat launches.
 *
 * Covers:
 *   - mapModeForPolo (main.js): mode mapping for Polo / SOTAmat (uppercase, FT8/FT4 passthrough)
 *   - getSigFromReference (run.js): SOTA/POTA/WWFF inference from ref pattern
 *   - buildXotaDeepLink (main.js): URL construction with optional baseUrl, separator detection,
 *     selective field emission
 *   - launchSOTAmat-equivalent build path: assemble inputs the way run.js does and verify
 *     the resulting URL matches the documented contract
 *
 * Usage:
 *   node test/unit/test_xota_deeplink.js
 */

// ============================================================================
// Test framework (minimal, copied from test_run.js)
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

function assertFalse(value, msg = '') {
    if (value) {
        throw new Error(`${msg}: expected falsy value, got ${value}`);
    }
}

// ============================================================================
// Globals the source functions reach for (DOM stub)
// ============================================================================

global.window = { location: { origin: "http://sotacat.local" } };

// ============================================================================
// Functions under test (copied verbatim from src/web/main.js and src/web/run.js)
// ============================================================================

// --- main.js ---

function mapModeForPolo(mode) {
    if (!mode) return null;
    const upperMode = mode.toUpperCase();
    if (upperMode === "USB" || upperMode === "LSB") return "SSB";
    if (upperMode === "CW" || upperMode === "CW_R") return "CW";
    if (["FM", "AM", "DATA", "FT8", "FT4"].includes(upperMode)) return upperMode;
    return upperMode;
}

function buildXotaDeepLink(params) {
    const baseUrl = params.baseUrl || "com.ham2k.polo://qso";
    const queryParts = [];

    if (params.mySig && params.myRef) {
        queryParts.push(`our.refs=${encodeURIComponent(params.mySig.toLowerCase() + ":" + params.myRef)}`);
    }
    if (params.theirSig && params.theirRef) {
        queryParts.push(`their.refs=${encodeURIComponent(params.theirSig.toLowerCase() + ":" + params.theirRef)}`);
    }
    if (params.myCall) queryParts.push(`our.call=${encodeURIComponent(params.myCall)}`);
    if (params.theirCall) queryParts.push(`their.call=${encodeURIComponent(params.theirCall)}`);
    if (params.freq) queryParts.push(`frequency=${encodeURIComponent(params.freq)}`);
    if (params.mode) queryParts.push(`mode=${encodeURIComponent(params.mode)}`);
    if (params.time) queryParts.push(`startAtMillis=${encodeURIComponent(params.time)}`);

    queryParts.push(`returnpath=${encodeURIComponent(window.location.origin)}`);

    if (queryParts.length === 0) return null;
    const sep = baseUrl.includes("?") ? "&" : "?";
    return `${baseUrl}${sep}${queryParts.join("&")}`;
}

// --- run.js ---

const SOTA_REF_PATTERN = /^[A-Z0-9]{1,4}\/[A-Z]{2}-\d{3}$/;
const POTA_REF_PATTERN = /^[A-Z]{1,2}-\d{4,5}$/;

function isValidSpotReference(ref) {
    if (!ref) return false;
    return SOTA_REF_PATTERN.test(ref) || POTA_REF_PATTERN.test(ref);
}

function getSigFromReference(ref) {
    if (!ref) return null;
    if (SOTA_REF_PATTERN.test(ref)) return "sota";
    if (POTA_REF_PATTERN.test(ref)) return "pota";
    if (/^[A-Z]{2,4}FF-\d{4}$/i.test(ref)) return "wwff";
    return null;
}

// Mirror of src/web/run.js launchSOTAmat — builder only, no window.location.href side effect.
function buildSotamatLink(state) {
    const myRef = state.ref || "";
    const validRef = isValidSpotReference(myRef);
    return buildXotaDeepLink({
        baseUrl: "sotamat://api/v1?app=sotacat&appversion=2.2",
        myRef:  validRef ? myRef : null,
        mySig:  validRef ? getSigFromReference(myRef) : null,
        myCall: state.callSign || null,
        freq:   state.vfoFrequencyHz || null,
        mode:   mapModeForPolo(state.vfoMode),
    });
}

// ============================================================================
// Helpers
// ============================================================================

function getQueryParams(url) {
    const qIdx = url.indexOf("?");
    if (qIdx === -1) return new Map();
    const map = new Map();
    for (const pair of url.slice(qIdx + 1).split("&")) {
        const eq = pair.indexOf("=");
        const k = eq === -1 ? pair : pair.slice(0, eq);
        const v = eq === -1 ? "" : decodeURIComponent(pair.slice(eq + 1));
        map.set(k, v);
    }
    return map;
}

// ============================================================================
// mapModeForPolo
// ============================================================================

describe('mapModeForPolo', () => {
    it('maps USB to SSB', () => assertEqual(mapModeForPolo("USB"), "SSB"));
    it('maps LSB to SSB', () => assertEqual(mapModeForPolo("LSB"), "SSB"));
    it('upcases lowercase usb to SSB', () => assertEqual(mapModeForPolo("usb"), "SSB"));
    it('maps CW to CW', () => assertEqual(mapModeForPolo("CW"), "CW"));
    it('maps CW_R to CW', () => assertEqual(mapModeForPolo("CW_R"), "CW"));
    it('passes FT8 through as FT8 (not folded to DATA)', () => assertEqual(mapModeForPolo("FT8"), "FT8"));
    it('passes FT4 through as FT4 (not folded to DATA)', () => assertEqual(mapModeForPolo("FT4"), "FT4"));
    it('passes lowercase ft8 through as FT8', () => assertEqual(mapModeForPolo("ft8"), "FT8"));
    it('passes FM through as FM', () => assertEqual(mapModeForPolo("FM"), "FM"));
    it('passes AM through as AM', () => assertEqual(mapModeForPolo("AM"), "AM"));
    it('passes DATA through as DATA', () => assertEqual(mapModeForPolo("DATA"), "DATA"));
    it('uppercases unknown mode', () => assertEqual(mapModeForPolo("rtty"), "RTTY"));
    it('returns null for null', () => assertEqual(mapModeForPolo(null), null));
    it('returns null for undefined', () => assertEqual(mapModeForPolo(undefined), null));
    it('returns null for empty string', () => assertEqual(mapModeForPolo(""), null));
});

// ============================================================================
// getSigFromReference
// ============================================================================

describe('getSigFromReference', () => {
    it('SOTA W6/NC-298 → sota', () => assertEqual(getSigFromReference("W6/NC-298"), "sota"));
    it('SOTA VK3/VE-123 → sota', () => assertEqual(getSigFromReference("VK3/VE-123"), "sota"));
    it('POTA US-1234 → pota', () => assertEqual(getSigFromReference("US-1234"), "pota"));
    it('POTA US-12345 (5-digit) → pota', () => assertEqual(getSigFromReference("US-12345"), "pota"));
    it('POTA VE-0001 → pota', () => assertEqual(getSigFromReference("VE-0001"), "pota"));
    it('WWFF VKFF-0001 → wwff', () => assertEqual(getSigFromReference("VKFF-0001"), "wwff"));
    it('WWFF ONFF-0123 → wwff', () => assertEqual(getSigFromReference("ONFF-0123"), "wwff"));
    it('null → null', () => assertEqual(getSigFromReference(null), null));
    it('empty string → null', () => assertEqual(getSigFromReference(""), null));
    it('malformed ref → null', () => assertEqual(getSigFromReference("NOT-A-REF"), null));
    it('lowercase pattern (does not match) → null', () => assertEqual(getSigFromReference("w6/nc-298"), null));
});

// ============================================================================
// buildXotaDeepLink — Polo path (default baseUrl)
// ============================================================================

describe('buildXotaDeepLink (Polo default baseUrl)', () => {
    it('uses com.ham2k.polo://qso when baseUrl absent', () => {
        const url = buildXotaDeepLink({ myRef: "W6/NC-298", mySig: "sota" });
        assertTrue(url.startsWith("com.ham2k.polo://qso?"), `expected polo prefix, got ${url}`);
    });

    it('encodes our.refs as <sig>:<ref> with slash and colon escaped', () => {
        const url = buildXotaDeepLink({ myRef: "W6/NC-298", mySig: "sota" });
        const params = getQueryParams(url);
        assertEqual(params.get("our.refs"), "sota:W6/NC-298", "our.refs decoded");
        // Spot-check the raw encoding
        assertTrue(url.includes("our.refs=sota%3AW6%2FNC-298"), `expected encoded our.refs in ${url}`);
    });

    it('lowercases mySig in our.refs', () => {
        const url = buildXotaDeepLink({ myRef: "US-1234", mySig: "POTA" });
        assertEqual(getQueryParams(url).get("our.refs"), "pota:US-1234");
    });

    it('omits our.refs when only mySig provided', () => {
        const url = buildXotaDeepLink({ mySig: "sota" });
        assertFalse(getQueryParams(url).has("our.refs"));
    });

    it('omits our.refs when only myRef provided', () => {
        const url = buildXotaDeepLink({ myRef: "W6/NC-298" });
        assertFalse(getQueryParams(url).has("our.refs"));
    });

    it('emits all simple fields when populated', () => {
        const url = buildXotaDeepLink({
            myRef: "W6/NC-298", mySig: "sota",
            theirRef: "US-1234", theirSig: "pota",
            myCall: "W6XYZ", theirCall: "K1ABC",
            freq: 14285000, mode: "SSB", time: 1700000000000,
        });
        const p = getQueryParams(url);
        assertEqual(p.get("our.refs"), "sota:W6/NC-298");
        assertEqual(p.get("their.refs"), "pota:US-1234");
        assertEqual(p.get("our.call"), "W6XYZ");
        assertEqual(p.get("their.call"), "K1ABC");
        assertEqual(p.get("frequency"), "14285000");
        assertEqual(p.get("mode"), "SSB");
        assertEqual(p.get("startAtMillis"), "1700000000000");
    });

    it('omits fields that are missing (subset)', () => {
        const url = buildXotaDeepLink({ myRef: "W6/NC-298", mySig: "sota", freq: 14285000, mode: "CW" });
        const p = getQueryParams(url);
        assertTrue(p.has("our.refs"));
        assertTrue(p.has("frequency"));
        assertTrue(p.has("mode"));
        assertFalse(p.has("their.refs"));
        assertFalse(p.has("our.call"));
        assertFalse(p.has("their.call"));
        assertFalse(p.has("startAtMillis"));
    });

    it('always emits returnpath=window.location.origin', () => {
        const url = buildXotaDeepLink({});
        assertEqual(getQueryParams(url).get("returnpath"), "http://sotacat.local");
    });

    it('joins query params with &', () => {
        const url = buildXotaDeepLink({ myCall: "W6XYZ", freq: 14285000 });
        // our.call & frequency & returnpath
        assertEqual(url.split("&").length, 3, `expected 3 params in ${url}`);
    });

    it('joins multiple their.* fields', () => {
        const url = buildXotaDeepLink({
            theirRef: "US-1234", theirSig: "pota", theirCall: "K1ABC,K2DEF",
            freq: 14285000, mode: "SSB",
        });
        const p = getQueryParams(url);
        assertEqual(p.get("their.refs"), "pota:US-1234");
        assertEqual(p.get("their.call"), "K1ABC,K2DEF");
    });
});

// ============================================================================
// buildXotaDeepLink — SOTAmat path (baseUrl with embedded query)
// ============================================================================

describe('buildXotaDeepLink (SOTAmat baseUrl with embedded query)', () => {
    const SOTAMAT_BASE = "sotamat://api/v1?app=sotacat&appversion=2.2";

    it('uses & separator when baseUrl already contains ?', () => {
        const url = buildXotaDeepLink({ baseUrl: SOTAMAT_BASE, myCall: "W6XYZ" });
        // Must NOT contain "?app=sotacat&appversion=2.2?" (i.e. a second ?)
        assertEqual(url.split("?").length, 2, `expected exactly one '?' in ${url}`);
        assertTrue(url.startsWith("sotamat://api/v1?app=sotacat&appversion=2.2&"),
                   `expected & separator after embedded query, got ${url}`);
    });

    it('preserves embedded baseUrl params alongside emitted ones', () => {
        const url = buildXotaDeepLink({
            baseUrl: SOTAMAT_BASE,
            myRef: "W6/NC-298", mySig: "sota", myCall: "W6XYZ",
            freq: 14285000, mode: "SSB",
        });
        const p = getQueryParams(url);
        assertEqual(p.get("app"), "sotacat");
        assertEqual(p.get("appversion"), "2.2");
        assertEqual(p.get("our.refs"), "sota:W6/NC-298");
        assertEqual(p.get("our.call"), "W6XYZ");
        assertEqual(p.get("frequency"), "14285000");
        assertEqual(p.get("mode"), "SSB");
        assertEqual(p.get("returnpath"), "http://sotacat.local");
    });

    it('returnpath omits the path component (bare origin)', () => {
        const url = buildXotaDeepLink({ baseUrl: SOTAMAT_BASE });
        assertEqual(getQueryParams(url).get("returnpath"), "http://sotacat.local");
    });

    it('with no caller params still includes app, appversion, returnpath', () => {
        const url = buildXotaDeepLink({ baseUrl: SOTAMAT_BASE });
        const p = getQueryParams(url);
        assertEqual(p.get("app"), "sotacat");
        assertEqual(p.get("appversion"), "2.2");
        assertTrue(p.has("returnpath"));
        assertFalse(p.has("our.refs"));
        assertFalse(p.has("our.call"));
        assertFalse(p.has("frequency"));
        assertFalse(p.has("mode"));
    });
});

// ============================================================================
// launchSOTAmat-equivalent build (assembled like run.js does)
// ============================================================================

describe('SOTAmat URL build (launchSOTAmat-equivalent)', () => {
    it('valid SOTA ref → URL contains our.refs=sota:<ref>', () => {
        const url = buildSotamatLink({
            ref: "W6/NC-298", callSign: "W6XYZ",
            vfoFrequencyHz: 14285000, vfoMode: "USB",
        });
        const p = getQueryParams(url);
        assertEqual(p.get("our.refs"), "sota:W6/NC-298");
        assertEqual(p.get("our.call"), "W6XYZ");
        assertEqual(p.get("frequency"), "14285000");
        assertEqual(p.get("mode"), "SSB");  // USB → SSB via mapModeForPolo
    });

    it('valid POTA ref → URL contains our.refs=pota:<ref>', () => {
        const url = buildSotamatLink({
            ref: "US-1234", callSign: "W6XYZ",
            vfoFrequencyHz: 7185000, vfoMode: "LSB",
        });
        assertEqual(getQueryParams(url).get("our.refs"), "pota:US-1234");
    });

    it('FT8 mode passes through (not folded to DATA)', () => {
        const url = buildSotamatLink({
            ref: "W6/NC-298", vfoFrequencyHz: 14074000, vfoMode: "FT8",
        });
        assertEqual(getQueryParams(url).get("mode"), "FT8");
    });

    it('FT4 mode passes through (not folded to DATA)', () => {
        const url = buildSotamatLink({
            ref: "W6/NC-298", vfoFrequencyHz: 14080000, vfoMode: "FT4",
        });
        assertEqual(getQueryParams(url).get("mode"), "FT4");
    });

    it('invalid ref → our.refs is omitted', () => {
        const url = buildSotamatLink({
            ref: "NOT-A-REF", callSign: "W6XYZ",
            vfoFrequencyHz: 14285000, vfoMode: "USB",
        });
        const p = getQueryParams(url);
        assertFalse(p.has("our.refs"), "our.refs should be absent");
        // Other fields still present
        assertEqual(p.get("our.call"), "W6XYZ");
        assertEqual(p.get("frequency"), "14285000");
        assertEqual(p.get("mode"), "SSB");
    });

    it('empty ref → our.refs is omitted', () => {
        const url = buildSotamatLink({ ref: "", callSign: "W6XYZ" });
        assertFalse(getQueryParams(url).has("our.refs"));
    });

    it('no callsign → our.call is omitted', () => {
        const url = buildSotamatLink({ ref: "W6/NC-298" });
        assertFalse(getQueryParams(url).has("our.call"));
    });

    it('no freq → frequency is omitted', () => {
        const url = buildSotamatLink({ ref: "W6/NC-298", vfoMode: "USB" });
        assertFalse(getQueryParams(url).has("frequency"));
    });

    it('no mode → mode is omitted', () => {
        const url = buildSotamatLink({ ref: "W6/NC-298", vfoFrequencyHz: 14285000 });
        assertFalse(getQueryParams(url).has("mode"));
    });

    it('all evidence absent → URL still includes app, appversion, returnpath', () => {
        const url = buildSotamatLink({});
        const p = getQueryParams(url);
        assertEqual(p.get("app"), "sotacat");
        assertEqual(p.get("appversion"), "2.2");
        assertEqual(p.get("returnpath"), "http://sotacat.local");
        assertFalse(p.has("our.refs"));
        assertFalse(p.has("our.call"));
        assertFalse(p.has("frequency"));
        assertFalse(p.has("mode"));
    });

    it('ref with slash + colon encoded properly in our.refs', () => {
        const url = buildSotamatLink({ ref: "W6/NC-298" });
        assertTrue(url.includes("our.refs=sota%3AW6%2FNC-298"),
                   `expected encoded ref in ${url}`);
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
