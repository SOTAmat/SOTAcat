#!/usr/bin/env node
/**
 * Unit tests for bandprivileges.js
 *
 * Tests FCC license privilege checking logic including:
 * - Mode category mapping
 * - Band/segment lookup
 * - Privilege checking for each license class
 * - Bandwidth edge detection
 * - Warning message generation
 *
 * Usage:
 *   node test/unit/test_bandprivileges.js
 */

const fs = require('fs');
const path = require('path');
const vm = require('vm');

// ============================================================================
// Test Framework (minimal, no dependencies)
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

function assertIncludes(arr, value, msg = '') {
    if (!arr.includes(value)) {
        throw new Error(`${msg}: expected ${JSON.stringify(arr)} to include ${JSON.stringify(value)}`);
    }
}

function assertNull(value, msg = '') {
    if (value !== null) {
        throw new Error(`${msg}: expected null, got ${JSON.stringify(value)}`);
    }
}

function assertNotNull(value, msg = '') {
    if (value === null) {
        throw new Error(`${msg}: expected non-null value`);
    }
}

// ============================================================================
// Load bandprivileges.js and main.js (for getBandFromFrequency)
// ============================================================================

// Create a mock AppState (used by bandprivileges.js for license class)
const mockAppState = {
    licenseClass: null,
};

// Create sandbox context with browser globals
const sandbox = {
    AppState: mockAppState,
    console: console,
    // Will be populated with functions from the scripts
};
vm.createContext(sandbox);

// Load main.js first (for BAND_PLAN and getBandFromFrequency)
const mainJsPath = path.join(__dirname, '../../src/web/main.js');
const mainJsCode = fs.readFileSync(mainJsPath, 'utf8');

// Extract just the BAND_PLAN and getBandFromFrequency from main.js
// (main.js has DOM dependencies, so we extract what we need)
const bandPlanMatch = mainJsCode.match(/const BAND_PLAN = \{[\s\S]*?\n\};/);
const getBandFnMatch = mainJsCode.match(/function getBandFromFrequency\(frequencyHz\) \{[\s\S]*?\n\}/);

if (!bandPlanMatch || !getBandFnMatch) {
    console.error("Could not extract BAND_PLAN or getBandFromFrequency from main.js");
    process.exit(1);
}

vm.runInContext(bandPlanMatch[0], sandbox);
vm.runInContext(getBandFnMatch[0], sandbox);

// Load bandprivileges.js
const bandPrivilegesPath = path.join(__dirname, '../../src/web/bandprivileges.js');
const bandPrivilegesCode = fs.readFileSync(bandPrivilegesPath, 'utf8');
vm.runInContext(bandPrivilegesCode, sandbox);

// Extract functions from sandbox
const {
    getModeCategory,
    getModeBandwidth,
    getSignalLowerEdge,
    getSignalUpperEdge,
    checkPrivileges,
    getLicenseClassStatus,
    getUserLicenseClass,
    getBandFromFrequency,
    BAND_PLAN,
} = sandbox;

// ============================================================================
// Tests
// ============================================================================

describe('Mode Category Mapping', () => {
    it('CW modes map to CW category', () => {
        assertEqual(getModeCategory('CW'), 'CW');
        assertEqual(getModeCategory('CW_R'), 'CW');
        assertEqual(getModeCategory('cw'), 'CW');  // case insensitive
    });

    it('Phone modes map to PHONE category', () => {
        assertEqual(getModeCategory('USB'), 'PHONE');
        assertEqual(getModeCategory('LSB'), 'PHONE');
        assertEqual(getModeCategory('AM'), 'PHONE');
        assertEqual(getModeCategory('FM'), 'PHONE');
        assertEqual(getModeCategory('SSB'), 'PHONE');
    });

    it('Data modes map to DATA category', () => {
        assertEqual(getModeCategory('DATA'), 'DATA');
        assertEqual(getModeCategory('DATA_R'), 'DATA');
    });

    it('Unknown modes default to PHONE (conservative)', () => {
        assertEqual(getModeCategory('UNKNOWN'), 'PHONE');
        assertEqual(getModeCategory(''), 'PHONE');
        assertEqual(getModeCategory(null), 'PHONE');
    });
});

describe('Mode Bandwidth', () => {
    it('CW has 500 Hz bandwidth', () => {
        assertEqual(getModeBandwidth('CW'), 500);
        assertEqual(getModeBandwidth('CW_R'), 500);
    });

    it('SSB has 3000 Hz bandwidth', () => {
        assertEqual(getModeBandwidth('USB'), 3000);
        assertEqual(getModeBandwidth('LSB'), 3000);
    });

    it('Unknown modes default to 3000 Hz', () => {
        assertEqual(getModeBandwidth('UNKNOWN'), 3000);
    });
});

describe('Signal Edge Calculations', () => {
    const freq = 14200000; // 14.200 MHz
    const bw = 3000;

    it('USB signal extends above dial frequency', () => {
        assertEqual(getSignalLowerEdge(freq, 'USB', bw), freq);
        assertEqual(getSignalUpperEdge(freq, 'USB', bw), freq + bw);
    });

    it('LSB signal extends below dial frequency', () => {
        assertEqual(getSignalLowerEdge(freq, 'LSB', bw), freq - bw);
        assertEqual(getSignalUpperEdge(freq, 'LSB', bw), freq);
    });

    it('CW signal is centered on dial frequency', () => {
        const cwBw = 500;
        assertEqual(getSignalLowerEdge(freq, 'CW', cwBw), freq - cwBw/2);
        assertEqual(getSignalUpperEdge(freq, 'CW', cwBw), freq + cwBw/2);
    });
});

describe('Band Lookup', () => {
    it('finds correct band for HF frequencies', () => {
        assertEqual(getBandFromFrequency(7100000), '40m');
        assertEqual(getBandFromFrequency(14200000), '20m');
        assertEqual(getBandFromFrequency(21300000), '15m');
        assertEqual(getBandFromFrequency(28400000), '10m');
    });

    it('returns null for out-of-band frequencies', () => {
        assertNull(getBandFromFrequency(5000000));  // Between 60m and 40m
        assertNull(getBandFromFrequency(13000000)); // Between 20m and 30m
    });
});

describe('40m Band Privileges', () => {
    // 40m structure:
    // 7.000-7.025: CW only, Extra only
    // 7.025-7.125: CW/DATA, E/G/T
    // 7.125-7.175: CW/DATA/PHONE, E/G
    // 7.175-7.300: CW/DATA/PHONE, E/G/T

    describe('7.000-7.025 MHz (CW only, Extra only)', () => {
        const freq = 7010000;

        it('Extra can TX CW', () => {
            const result = checkPrivileges(freq, 'CW', 'E');
            assertTrue(result.userCanTransmit, 'Extra should TX CW at 7.010');
            assertTrue(result.modeAllowed, 'CW should be allowed');
        });

        it('General cannot TX CW', () => {
            const result = checkPrivileges(freq, 'CW', 'G');
            assertFalse(result.userCanTransmit, 'General should not TX at 7.010');
            assertEqual(result.warning, 'Outside your privileges');
        });

        it('Phone not allowed for anyone', () => {
            const result = checkPrivileges(freq, 'USB', 'E');
            assertFalse(result.modeAllowed, 'Phone should not be allowed at 7.010');
            assertEqual(result.warning, 'Phone not allowed here');
        });
    });

    describe('7.025-7.125 MHz (CW/DATA, E/G/T)', () => {
        const freq = 7074000; // FT8 frequency

        it('All classes can TX DATA', () => {
            for (const cls of ['E', 'G', 'T']) {
                const result = checkPrivileges(freq, 'DATA', cls);
                assertTrue(result.userCanTransmit, `${cls} should TX DATA at 7.074`);
            }
        });

        it('Phone not allowed', () => {
            const result = checkPrivileges(freq, 'USB', 'E');
            assertFalse(result.modeAllowed, 'Phone should not be allowed at 7.074');
            assertEqual(result.warning, 'Phone not allowed here');
        });
    });

    describe('7.125-7.175 MHz (CW/DATA/PHONE, E/G)', () => {
        const freq = 7150000;

        it('Extra and General can TX Phone', () => {
            for (const cls of ['E', 'G']) {
                const result = checkPrivileges(freq, 'USB', cls);
                assertTrue(result.userCanTransmit, `${cls} should TX USB at 7.150`);
            }
        });

        it('Technician cannot TX Phone', () => {
            const result = checkPrivileges(freq, 'USB', 'T');
            assertFalse(result.userCanTransmit, 'Tech should not TX at 7.150');
            assertEqual(result.warning, 'Outside your privileges');
        });
    });

    describe('7.125 MHz LSB Edge Case', () => {
        // At 7.125 MHz LSB, signal extends from 7.122 to 7.125
        // 7.122 is in 7.025-7.125 segment (CW/DATA only - no PHONE!)
        const freq = 7125000;

        it('should warn that signal extends into non-phone segment', () => {
            const result = checkPrivileges(freq, 'LSB', 'E');
            // The dial frequency is at the edge of phone segment
            // But LSB extends below into CW/DATA-only segment
            assertNotNull(result.edgeWarning, 'Should have edge warning at 7.125 LSB');
            assertEqual(result.edgeWarning, 'Signal extends into non-phone segment');
        });

        it('dial frequency should be in phone segment', () => {
            const result = checkPrivileges(freq, 'LSB', 'E');
            assertTrue(result.modeAllowed, 'Phone should be allowed at dial freq 7.125');
        });

        it('user should not be able to transmit due to edge violation', () => {
            const result = checkPrivileges(freq, 'LSB', 'E');
            assertFalse(result.userCanTransmit, 'Should not TX due to edge warning');
        });
    });

    describe('7.126 MHz LSB Edge Case', () => {
        // At 7.126 MHz LSB, signal extends from 7.123 to 7.126
        // Dial is in phone segment, but lower edge is in CW/DATA segment
        const freq = 7126000;

        it('should warn that signal extends into non-phone segment', () => {
            const result = checkPrivileges(freq, 'LSB', 'E');
            assertNotNull(result.edgeWarning, 'Should have edge warning at 7.126 LSB');
            assertEqual(result.edgeWarning, 'Signal extends into non-phone segment');
        });

        it('user should not be able to transmit due to edge violation', () => {
            const result = checkPrivileges(freq, 'LSB', 'E');
            assertFalse(result.userCanTransmit, 'Should not TX due to edge warning');
        });
    });

    describe('7.127 MHz LSB Edge Case', () => {
        // At 7.127 MHz LSB, signal extends from 7.124 to 7.127
        // Lower edge (7.124) is still in CW/DATA segment (ends at 7.125)
        const freq = 7127000;

        it('should still warn (7.124 < 7.125 boundary)', () => {
            const result = checkPrivileges(freq, 'LSB', 'E');
            assertNotNull(result.edgeWarning, 'Should have edge warning at 7.127 LSB');
        });
    });

    describe('7.128 MHz LSB (fully in phone segment)', () => {
        // At 7.128 MHz LSB, signal extends from 7.125 to 7.128
        // Both edges are in the 7.125-7.175 phone segment
        const freq = 7128000;

        it('Extra should TX without edge warning', () => {
            const result = checkPrivileges(freq, 'LSB', 'E');
            assertTrue(result.userCanTransmit, 'Extra should TX at 7.128');
            assertNull(result.edgeWarning, 'Should have no edge warning at 7.128 LSB');
        });
    });
});

describe('20m Band Privileges', () => {
    // 20m structure:
    // 14.000-14.025: CW only, Extra only
    // 14.025-14.150: CW/DATA, E/G
    // 14.150-14.225: CW/DATA/PHONE, Extra only
    // 14.225-14.350: CW/DATA/PHONE, E/G

    describe('14.150-14.225 MHz (Extra phone)', () => {
        const freq = 14200000;

        it('Extra can TX Phone', () => {
            const result = checkPrivileges(freq, 'USB', 'E');
            assertTrue(result.userCanTransmit, 'Extra should TX at 14.200');
        });

        it('General cannot TX Phone', () => {
            const result = checkPrivileges(freq, 'USB', 'G');
            assertFalse(result.userCanTransmit, 'General should not TX at 14.200');
            assertEqual(result.warning, 'Outside your privileges');
        });
    });

    describe('14.225-14.350 MHz (E/G phone)', () => {
        const freq = 14250000;

        it('General can TX Phone', () => {
            const result = checkPrivileges(freq, 'USB', 'G');
            assertTrue(result.userCanTransmit, 'General should TX at 14.250');
            assertNull(result.warning, 'Should have no warning');
        });

        it('Technician cannot TX', () => {
            const result = checkPrivileges(freq, 'USB', 'T');
            assertFalse(result.userCanTransmit, 'Tech should not TX at 14.250');
        });
    });

    describe('14.225 MHz USB Edge Case', () => {
        // At 14.225 MHz USB, signal extends from 14.225 to 14.228
        // Lower edge is exactly at segment boundary
        const freq = 14225000;

        it('General should TX without warning', () => {
            const result = checkPrivileges(freq, 'USB', 'G');
            assertTrue(result.userCanTransmit, 'General should TX at 14.225');
            assertNull(result.edgeWarning, 'Should have no edge warning');
        });
    });

    describe('14.224 MHz USB Edge Case', () => {
        // At 14.224 MHz USB, signal extends from 14.224 to 14.227
        // Dial is in Extra-only segment, but signal extends into General segment
        const freq = 14224000;

        it('Extra should TX', () => {
            const result = checkPrivileges(freq, 'USB', 'E');
            assertTrue(result.userCanTransmit, 'Extra should TX at 14.224');
        });

        it('General cannot TX (dial in Extra-only segment)', () => {
            const result = checkPrivileges(freq, 'USB', 'G');
            assertFalse(result.userCanTransmit, 'General should not TX at 14.224');
        });
    });
});

describe('80m Band Privileges', () => {
    // 80m structure:
    // 3.500-3.600: CW/DATA, E/G
    // 3.600-3.700: CW/DATA/PHONE, Extra only
    // 3.700-3.800: CW/DATA/PHONE, Extra only (General has NO privileges here!)
    // 3.800-4.000: CW/DATA/PHONE, E/G

    describe('3.700-3.800 MHz (Extra only)', () => {
        const freq = 3750000;

        it('Extra can TX Phone', () => {
            const result = checkPrivileges(freq, 'USB', 'E');
            assertTrue(result.userCanTransmit, 'Extra should TX at 3.750');
        });

        it('General cannot TX (no privileges 3.6-3.8)', () => {
            const result = checkPrivileges(freq, 'USB', 'G');
            assertFalse(result.userCanTransmit, 'General should not TX at 3.750');
            assertEqual(result.warning, 'Outside your privileges');
        });
    });

    describe('3.800 MHz LSB Edge Case', () => {
        // At 3.800 MHz LSB, signal extends from 3.797 to 3.800
        // Lower edge is in Extra-only segment
        const freq = 3800000;

        it('General at segment boundary - signal extends into Extra-only', () => {
            const result = checkPrivileges(freq, 'LSB', 'G');
            // Dial is at start of General segment, but LSB extends into Extra-only
            assertNotNull(result.edgeWarning, 'Should warn about signal in Extra-only segment');
        });
    });
});

describe('10m Band Privileges', () => {
    // 10m structure:
    // 28.000-28.300: CW/DATA, E/G/T
    // 28.300-29.700: CW/DATA/PHONE, E/G/T

    describe('28.300-29.700 MHz (all classes, all modes)', () => {
        const freq = 28400000;

        it('All classes can TX Phone', () => {
            for (const cls of ['E', 'G', 'T']) {
                const result = checkPrivileges(freq, 'USB', cls);
                assertTrue(result.userCanTransmit, `${cls} should TX USB at 28.400`);
                assertNull(result.warning, `${cls} should have no warning`);
            }
        });
    });

    describe('28.300 MHz USB Edge Case', () => {
        // Exactly at phone segment boundary
        const freq = 28300000;

        it('Technician can TX Phone at boundary', () => {
            const result = checkPrivileges(freq, 'USB', 'T');
            assertTrue(result.userCanTransmit, 'Tech should TX at 28.300');
        });
    });

    describe('28.299 MHz USB Edge Case', () => {
        // Just below phone segment
        const freq = 28299000;

        it('Phone not allowed (CW/DATA segment)', () => {
            const result = checkPrivileges(freq, 'USB', 'T');
            assertFalse(result.modeAllowed, 'Phone should not be allowed at 28.299');
            assertEqual(result.warning, 'Phone not allowed here');
        });
    });
});

describe('30m WARC Band (CW/DATA only)', () => {
    const freq = 10125000;

    it('Phone not allowed for any class', () => {
        for (const cls of ['E', 'G', 'T']) {
            const result = checkPrivileges(freq, 'USB', cls);
            assertFalse(result.modeAllowed, `Phone should not be allowed for ${cls}`);
            assertEqual(result.warning, 'Phone not allowed here');
        }
    });

    it('CW allowed for all classes', () => {
        for (const cls of ['E', 'G', 'T']) {
            const result = checkPrivileges(freq, 'CW', cls);
            assertTrue(result.userCanTransmit, `${cls} should TX CW at 10.125`);
        }
    });
});

describe('License Badge Status', () => {
    it('returns correct status for 10m phone (all classes)', () => {
        const status = getLicenseClassStatus(28400000, 'USB');
        assertTrue(status.T, 'Tech should be allowed');
        assertTrue(status.G, 'General should be allowed');
        assertTrue(status.E, 'Extra should be allowed');
    });

    it('returns correct status for 20m General phone', () => {
        const status = getLicenseClassStatus(14250000, 'USB');
        assertFalse(status.T, 'Tech should not be allowed');
        assertTrue(status.G, 'General should be allowed');
        assertTrue(status.E, 'Extra should be allowed');
    });

    it('returns correct status for 20m Extra-only phone', () => {
        const status = getLicenseClassStatus(14200000, 'USB');
        assertFalse(status.T, 'Tech should not be allowed');
        assertFalse(status.G, 'General should not be allowed');
        assertTrue(status.E, 'Extra should be allowed');
    });

    it('returns all false when mode not allowed', () => {
        const status = getLicenseClassStatus(10125000, 'USB'); // 30m phone
        assertFalse(status.T, 'Tech should not be allowed (phone on 30m)');
        assertFalse(status.G, 'General should not be allowed (phone on 30m)');
        assertFalse(status.E, 'Extra should not be allowed (phone on 30m)');
    });
});

describe('Out of Band Detection', () => {
    it('detects frequency outside any amateur band', () => {
        const result = checkPrivileges(5000000, 'USB', 'E');
        assertFalse(result.inBand, 'Should be out of band');
        assertEqual(result.warning, 'Out of band');
    });

    it('detects frequency in amateur band but outside segments', () => {
        // 60m is channelized - frequency between channels
        const result = checkPrivileges(5340000, 'USB', 'E');
        assertEqual(result.warning, 'Outside licensed segment');
    });
});

describe('User License from AppState', () => {
    it('returns null when not set', () => {
        mockAppState.licenseClass = null;
        assertNull(getUserLicenseClass());
    });

    it('returns null when empty string', () => {
        mockAppState.licenseClass = '';
        assertNull(getUserLicenseClass());
    });

    it('returns stored license class', () => {
        mockAppState.licenseClass = 'G';
        assertEqual(getUserLicenseClass(), 'G');
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
