#!/usr/bin/env node
/**
 * Unit tests for band-range drag-to-tune pure functions.
 *
 * Covers the math used by the drag handler in run.js:
 *   - pixelToFrequencyHz (pixel → frequency mapping)
 *   - snapFrequencyHz    (snap to mode-specific step)
 *   - clampFrequencyHz   (clamp to band edges)
 *   - computeDragFrequency (composition: snap then clamp)
 *
 * Plus the snap-step lookup in bandprivileges.js:
 *   - getSnapStepHz
 *
 * Usage:
 *   node test/unit/test_band_range_drag.js
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

function assertClose(actual, expected, tolerance, msg = '') {
    if (Math.abs(actual - expected) > tolerance) {
        throw new Error(`${msg}: expected ~${expected} (±${tolerance}), got ${actual}`);
    }
}

// ============================================================================
// Load the functions under test
// ============================================================================
// Strategy: same as test_bandprivileges.js — pull the source files into a
// sandboxed VM context, then extract the functions we want.

const sandbox = {
    AppState: { licenseClass: null },
    console: console,
};
vm.createContext(sandbox);

// bandprivileges.js needs no other globals for getSnapStepHz / MODE_SNAP_HZ.
const bpPath = path.join(__dirname, '../../src/web/bandprivileges.js');
vm.runInContext(fs.readFileSync(bpPath, 'utf8'), sandbox);

// run.js is too large and has DOM/network dependencies — extract only the
// drag pure helpers by regex. These are intentionally written as standalone
// top-level functions for exactly this reason.
const runJsPath = path.join(__dirname, '../../src/web/run.js');
const runJsCode = fs.readFileSync(runJsPath, 'utf8');

const fnNames = [
    'pixelToFrequencyHz',
    'snapFrequencyHz',
    'clampFrequencyHz',
    'computeDragFrequency',
];

for (const name of fnNames) {
    const re = new RegExp(`function ${name}\\([^)]*\\) \\{[\\s\\S]*?\\n\\}`);
    const match = runJsCode.match(re);
    if (!match) {
        console.error(`Could not extract ${name} from run.js`);
        process.exit(1);
    }
    vm.runInContext(match[0], sandbox);
}

// Note: const declarations in vm.runInContext live in the script's scope,
// not on the context object — so we destructure functions (which are
// hoisted onto the context) but NOT const tables like MODE_SNAP_HZ. Reach
// MODE_SNAP_HZ values through getSnapStepHz instead.
const {
    getSnapStepHz,
    pixelToFrequencyHz,
    snapFrequencyHz,
    clampFrequencyHz,
    computeDragFrequency,
} = sandbox;

// ============================================================================
// Tests
// ============================================================================

describe('getSnapStepHz', () => {
    it('CW snaps to 100 Hz', () => {
        assertEqual(getSnapStepHz('CW'), 100);
        assertEqual(getSnapStepHz('CW_R'), 100);
    });

    it('DATA snaps to 500 Hz', () => {
        assertEqual(getSnapStepHz('DATA'), 500);
        assertEqual(getSnapStepHz('DATA_R'), 500);
    });

    it('SSB / AM phone modes snap to 1 kHz', () => {
        assertEqual(getSnapStepHz('USB'), 1000);
        assertEqual(getSnapStepHz('LSB'), 1000);
        assertEqual(getSnapStepHz('SSB'), 1000);
        assertEqual(getSnapStepHz('AM'), 1000);
    });

    it('FM snaps to 5 kHz (channel grid)', () => {
        assertEqual(getSnapStepHz('FM'), 5000);
    });

    it('mode lookup is case-insensitive', () => {
        assertEqual(getSnapStepHz('cw'), 100);
        assertEqual(getSnapStepHz('usb'), 1000);
        assertEqual(getSnapStepHz('fm'), 5000);
    });

    it('unknown / empty / null modes default to 1 kHz', () => {
        assertEqual(getSnapStepHz('PSK31'), 1000);
        assertEqual(getSnapStepHz(''), 1000);
        assertEqual(getSnapStepHz(null), 1000);
        assertEqual(getSnapStepHz(undefined), 1000);
    });
});

describe('pixelToFrequencyHz', () => {
    // 40m: 7.000–7.300 MHz, 300 kHz wide.
    const rect = { left: 100, width: 300 }; // 1 kHz per pixel
    const bandMin = 7000000;
    const bandMax = 7300000;

    it('left edge → bandMin', () => {
        assertEqual(pixelToFrequencyHz(100, rect, bandMin, bandMax), bandMin);
    });

    it('right edge → bandMax', () => {
        assertEqual(pixelToFrequencyHz(400, rect, bandMin, bandMax), bandMax);
    });

    it('midpoint → middle frequency', () => {
        assertEqual(pixelToFrequencyHz(250, rect, bandMin, bandMax), 7150000);
    });

    it('linear interpolation at arbitrary x', () => {
        // 25% across → 7.075 MHz
        assertEqual(pixelToFrequencyHz(175, rect, bandMin, bandMax), 7075000);
    });

    it('extrapolates beyond rect bounds (caller must clamp)', () => {
        assertEqual(pixelToFrequencyHz(50, rect, bandMin, bandMax), 6950000);
        assertEqual(pixelToFrequencyHz(450, rect, bandMin, bandMax), 7350000);
    });
});

describe('snapFrequencyHz', () => {
    it('100 Hz step (CW): rounds to nearest 100', () => {
        assertEqual(snapFrequencyHz(7025049, 100), 7025000);
        assertEqual(snapFrequencyHz(7025050, 100), 7025100);
        assertEqual(snapFrequencyHz(7025099, 100), 7025100);
    });

    it('500 Hz step (DATA): aligns to digital sub-band centers', () => {
        assertEqual(snapFrequencyHz(7074000, 500), 7074000);
        assertEqual(snapFrequencyHz(7074123, 500), 7074000);
        assertEqual(snapFrequencyHz(7074250, 500), 7074500);
    });

    it('1 kHz step (PHONE): rounds to nearest kHz', () => {
        assertEqual(snapFrequencyHz(14250450, 1000), 14250000);
        assertEqual(snapFrequencyHz(14250500, 1000), 14251000);
        assertEqual(snapFrequencyHz(14250750, 1000), 14251000);
    });

    it('5 kHz step (FM): aligns to channel grid', () => {
        assertEqual(snapFrequencyHz(146521000, 5000), 146520000);
        assertEqual(snapFrequencyHz(146522500, 5000), 146525000);
        assertEqual(snapFrequencyHz(146525000, 5000), 146525000);
    });

    it('exact multiples are unchanged', () => {
        assertEqual(snapFrequencyHz(7100000, 100), 7100000);
        assertEqual(snapFrequencyHz(14250000, 1000), 14250000);
    });
});

describe('clampFrequencyHz', () => {
    const bandMin = 7000000;
    const bandMax = 7300000;

    it('below bandMin → bandMin', () => {
        assertEqual(clampFrequencyHz(6900000, bandMin, bandMax), bandMin);
        assertEqual(clampFrequencyHz(0, bandMin, bandMax), bandMin);
    });

    it('above bandMax → bandMax', () => {
        assertEqual(clampFrequencyHz(7500000, bandMin, bandMax), bandMax);
    });

    it('in-range frequencies pass through unchanged', () => {
        assertEqual(clampFrequencyHz(7150000, bandMin, bandMax), 7150000);
        assertEqual(clampFrequencyHz(bandMin, bandMin, bandMax), bandMin);
        assertEqual(clampFrequencyHz(bandMax, bandMin, bandMax), bandMax);
    });
});

describe('computeDragFrequency', () => {
    // 40m at 1 kHz/pixel
    const state40m = {
        overlayRect: { left: 0, width: 300 },
        bandMin: 7000000,
        bandMax: 7300000,
        snapHz: 100,           // CW
    };

    it('CW @ 40m: snaps to 100 Hz multiples within band', () => {
        // x=25.123 → 25.123 kHz across band → 7025123 → snap to 7025100
        assertEqual(computeDragFrequency(25.123, state40m), 7025100);
    });

    it('CW @ 40m: clamps left of band start', () => {
        assertEqual(computeDragFrequency(-50, state40m), 7000000);
    });

    it('CW @ 40m: clamps right of band end', () => {
        assertEqual(computeDragFrequency(500, state40m), 7300000);
    });

    it('FM @ 2m: 5 kHz snap on channel grid', () => {
        // 2m: 144.0–148.0 MHz (4 MHz wide). At 1 kHz/pixel that's 4000 px.
        const state2m = {
            overlayRect: { left: 0, width: 4000 },
            bandMin: 144000000,
            bandMax: 148000000,
            snapHz: 5000,
        };
        // x=2520 → 2520 kHz above bandMin = 146.520 MHz (already on grid)
        assertEqual(computeDragFrequency(2520, state2m), 146520000);
        // x=2521 → 146.521 → snap to 146.520
        assertEqual(computeDragFrequency(2521, state2m), 146520000);
        // x=2523 → 146.523 → snap to 146.525
        assertEqual(computeDragFrequency(2523, state2m), 146525000);
    });

    it('PHONE @ 20m: 1 kHz snap', () => {
        // 20m: 14.000–14.350 MHz. width=350 → 1 kHz/px.
        const state20m = {
            overlayRect: { left: 0, width: 350 },
            bandMin: 14000000,
            bandMax: 14350000,
            snapHz: 1000,
        };
        assertEqual(computeDragFrequency(250.4, state20m), 14250000);
        assertEqual(computeDragFrequency(250.5, state20m), 14251000);
    });

    it('respects rect.left offset', () => {
        const state = {
            overlayRect: { left: 100, width: 300 },
            bandMin: 7000000,
            bandMax: 7300000,
            snapHz: 100,
        };
        // clientX=100 → bandMin
        assertEqual(computeDragFrequency(100, state), 7000000);
        // clientX=400 → bandMax
        assertEqual(computeDragFrequency(400, state), 7300000);
        // clientX=250 → midpoint
        assertEqual(computeDragFrequency(250, state), 7150000);
    });
});

describe('MODE_SNAP_HZ table consistency', () => {
    // Iterate via getSnapStepHz since the const table itself doesn't escape
    // the vm sandbox.
    const knownModes = ['CW', 'CW_R', 'DATA', 'DATA_R', 'USB', 'LSB', 'SSB', 'AM', 'FM'];

    it('every known mode returns a positive integer step', () => {
        for (const mode of knownModes) {
            const step = getSnapStepHz(mode);
            if (!Number.isInteger(step) || step <= 0) {
                throw new Error(`getSnapStepHz('${mode}') should be positive integer, got ${step}`);
            }
        }
    });

    it('CW step finer than DATA finer than PHONE finer than FM', () => {
        const cw = getSnapStepHz('CW');
        const data = getSnapStepHz('DATA');
        const phone = getSnapStepHz('USB');
        const fm = getSnapStepHz('FM');
        if (!(cw < data && data < phone && phone < fm)) {
            throw new Error(`Snap ordering violated: CW=${cw}, DATA=${data}, PHONE=${phone}, FM=${fm}`);
        }
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
