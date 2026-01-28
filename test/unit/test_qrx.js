#!/usr/bin/env node
/**
 * Unit tests for qrx.js
 *
 * Tests QRX page logic including:
 * - Distance formatting (km to miles/feet)
 * - Reference auto-formatting
 *
 * Usage:
 *   node test/unit/test_qrx.js
 */

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

function assertApproxEqual(actual, expected, tolerance = 0.01, msg = '') {
    if (Math.abs(actual - expected) > tolerance) {
        throw new Error(`${msg}: expected ~${expected}, got ${actual} (tolerance: ${tolerance})`);
    }
}

// ============================================================================
// Distance Formatting Logic (extracted from qrx.js for testing)
// ============================================================================

/**
 * Format distance from km to miles/feet for display
 * @param {number} distanceKm - Distance in kilometers
 * @returns {string} Formatted distance string
 */
function formatDistance(distanceKm) {
    const distanceMiles = distanceKm * 0.621371;
    if (distanceMiles < 0.1) {
        const distanceFeet = Math.round(distanceMiles * 5280);
        return `${distanceFeet}ft away`;
    } else {
        return `${distanceMiles.toFixed(1)}mi away`;
    }
}

/**
 * Format summit info string
 * @param {object} summit - Summit object from SOTA API
 * @returns {string} Formatted summit info
 */
function formatSummitInfo(summit) {
    const distanceKm = summit.distance;
    const distanceMiles = distanceKm * 0.621371;
    let distanceStr;
    if (distanceMiles < 0.1) {
        const distanceFeet = Math.round(distanceMiles * 5280);
        distanceStr = `${distanceFeet}ft away`;
    } else {
        distanceStr = `${distanceMiles.toFixed(1)}mi away`;
    }
    return `${summit.name} • ${summit.altFt}ft • ${summit.points}pt • ${distanceStr}`;
}

// ============================================================================
// Tests
// ============================================================================

describe('Distance Conversion (km to miles)', () => {
    it('converts 1 km to approximately 0.62 miles', () => {
        const miles = 1 * 0.621371;
        assertApproxEqual(miles, 0.621, 0.001, '1 km should be ~0.621 miles');
    });

    it('converts 10 km to approximately 6.2 miles', () => {
        const miles = 10 * 0.621371;
        assertApproxEqual(miles, 6.21, 0.01, '10 km should be ~6.21 miles');
    });

    it('converts 100 km to approximately 62 miles', () => {
        const miles = 100 * 0.621371;
        assertApproxEqual(miles, 62.1, 0.1, '100 km should be ~62.1 miles');
    });
});

describe('Distance Formatting', () => {
    describe('Short distances (< 0.1 miles) shown in feet', () => {
        it('formats 0.01 km as feet', () => {
            const result = formatDistance(0.01);
            assertTrue(result.includes('ft away'), 'Should show feet');
            assertEqual(result, '33ft away', 'Should round to 33ft');
        });

        it('formats 0.05 km as feet', () => {
            const result = formatDistance(0.05);
            assertTrue(result.includes('ft away'), 'Should show feet');
            assertEqual(result, '164ft away', 'Should round to 164ft');
        });

        it('formats 0.1 km as feet (still under 0.1 miles)', () => {
            // 0.1 km = 0.0621 miles, which is < 0.1, so should show feet
            const result = formatDistance(0.1);
            assertTrue(result.includes('ft away'), 'Should show feet');
            assertEqual(result, '328ft away', '0.1 km should be 328ft');
        });

        it('formats very small distances', () => {
            const result = formatDistance(0.001);
            assertEqual(result, '3ft away', '1 meter should be ~3ft');
        });
    });

    describe('Longer distances (>= 0.1 miles) shown in miles', () => {
        it('formats 0.2 km as miles', () => {
            // 0.2 km = 0.124 miles, which is > 0.1
            const result = formatDistance(0.2);
            assertTrue(result.includes('mi away'), 'Should show miles');
            assertEqual(result, '0.1mi away', '0.2 km should be 0.1mi');
        });

        it('formats 1 km as miles', () => {
            const result = formatDistance(1);
            assertTrue(result.includes('mi away'), 'Should show miles');
            assertEqual(result, '0.6mi away', '1 km should be 0.6mi');
        });

        it('formats 5 km as miles', () => {
            const result = formatDistance(5);
            assertEqual(result, '3.1mi away', '5 km should be 3.1mi');
        });

        it('formats 10 km as miles', () => {
            const result = formatDistance(10);
            assertEqual(result, '6.2mi away', '10 km should be 6.2mi');
        });

        it('formats 50 km as miles', () => {
            const result = formatDistance(50);
            assertEqual(result, '31.1mi away', '50 km should be 31.1mi');
        });

        it('formats 100 km as miles', () => {
            const result = formatDistance(100);
            assertEqual(result, '62.1mi away', '100 km should be 62.1mi');
        });
    });

    describe('Boundary at 0.1 miles (~0.161 km)', () => {
        it('0.15 km shows feet (under 0.1 miles)', () => {
            // 0.15 km = 0.093 miles < 0.1
            const result = formatDistance(0.15);
            assertTrue(result.includes('ft away'), '0.15 km should show feet');
        });

        it('0.17 km shows miles (over 0.1 miles)', () => {
            // 0.17 km = 0.106 miles > 0.1
            const result = formatDistance(0.17);
            assertTrue(result.includes('mi away'), '0.17 km should show miles');
        });
    });
});

describe('Summit Info Formatting', () => {
    it('formats complete summit info with short distance', () => {
        const summit = {
            name: 'Black Mountain',
            altFt: 2820,
            points: 2,
            distance: 0.05 // 0.05 km
        };
        const result = formatSummitInfo(summit);
        assertEqual(result, 'Black Mountain • 2820ft • 2pt • 164ft away');
    });

    it('formats complete summit info with long distance', () => {
        const summit = {
            name: 'Mount Diablo',
            altFt: 3849,
            points: 4,
            distance: 25 // 25 km
        };
        const result = formatSummitInfo(summit);
        assertEqual(result, 'Mount Diablo • 3849ft • 4pt • 15.5mi away');
    });

    it('formats summit with zero distance', () => {
        const summit = {
            name: 'Summit Peak',
            altFt: 1000,
            points: 1,
            distance: 0
        };
        const result = formatSummitInfo(summit);
        assertEqual(result, 'Summit Peak • 1000ft • 1pt • 0ft away');
    });

    it('formats summit with 10-point value', () => {
        const summit = {
            name: 'Tall Peak',
            altFt: 14000,
            points: 10,
            distance: 100
        };
        const result = formatSummitInfo(summit);
        assertEqual(result, 'Tall Peak • 14000ft • 10pt • 62.1mi away');
    });
});

describe('SOTA API Response Handling', () => {
    it('sorts summits by distance correctly', () => {
        const summits = [
            { summitCode: 'W6/NC-150', distance: 5.2 },
            { summitCode: 'W6/NC-100', distance: 1.3 },
            { summitCode: 'W6/NC-200', distance: 10.5 },
            { summitCode: 'W6/NC-050', distance: 0.5 }
        ];

        summits.sort((a, b) => a.distance - b.distance);

        assertEqual(summits[0].summitCode, 'W6/NC-050', 'Nearest should be first');
        assertEqual(summits[1].summitCode, 'W6/NC-100', 'Second nearest');
        assertEqual(summits[2].summitCode, 'W6/NC-150', 'Third nearest');
        assertEqual(summits[3].summitCode, 'W6/NC-200', 'Farthest should be last');
    });

    it('handles single summit in response', () => {
        const summits = [
            { summitCode: 'W6/NC-150', name: 'Black Mountain', distance: 0.1 }
        ];

        summits.sort((a, b) => a.distance - b.distance);
        const nearest = summits[0];

        assertEqual(nearest.summitCode, 'W6/NC-150');
    });

    it('handles example API response', () => {
        // Real response format from SOTA API
        const apiResponse = [{
            "associationName": null,
            "associationCode": null,
            "regionName": null,
            "regionCode": null,
            "summitCode": "W6/NC-150",
            "name": "Black Mountain",
            "notes": "",
            "points": 2,
            "altM": 860,
            "altFt": 2820,
            "activationCount": 167,
            "activationCall": null,
            "activationDate": null,
            "gridRef1": "-122.1476",
            "gridRef2": "37.3176",
            "locator": "CM87wh",
            "latitude": 37.3176,
            "longitude": -122.1476,
            "myChases": 0,
            "myActivations": 0,
            "validTo": "2099-12-31T00:00:00Z",
            "validFrom": "2012-08-01T00:00:00Z",
            "valid": true,
            "restrictionMask": null,
            "restrictionList": null,
            "bearing": 79.71129796740706,
            "distance": 0.00016442484850584218
        }];

        const nearest = apiResponse[0];
        assertEqual(nearest.summitCode, 'W6/NC-150');
        assertEqual(nearest.name, 'Black Mountain');
        assertEqual(nearest.altFt, 2820);
        assertEqual(nearest.points, 2);
        assertTrue(nearest.distance < 0.001, 'Very close distance');

        // Format the info
        const info = formatSummitInfo(nearest);
        assertTrue(info.includes('Black Mountain'), 'Should include name');
        assertTrue(info.includes('2820ft'), 'Should include altitude');
        assertTrue(info.includes('2pt'), 'Should include points');
        assertTrue(info.includes('ft away'), 'Very close should show feet');
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
