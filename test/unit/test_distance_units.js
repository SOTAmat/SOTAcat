#!/usr/bin/env node
/**
 * Unit tests for the shared Miles/Kilometres display helpers in main.js.
 *
 * Usage:
 *   node test/unit/test_distance_units.js
 */

const fs = require("fs");
const path = require("path");
const vm = require("vm");

let passed = 0;
let failed = 0;

function it(name, fn) {
    try {
        fn();
        passed++;
        console.log(`  ✓ ${name}`);
    } catch (error) {
        failed++;
        console.log(`  ✗ ${name}\n    ${error.message}`);
    }
}

function assertEqual(actual, expected, message = "") {
    if (actual !== expected) {
        throw new Error(`${message}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
    }
}

const code = fs.readFileSync(path.join(__dirname, "../../src/web/main.js"), "utf8");
const sandbox = {
    AppState: { distanceUnits: "miles" },
    localStorage: { getItem() { return null; } },
};
vm.createContext(sandbox);

for (const pattern of [
    /function loadDistanceUnits\(\)[\s\S]*?\n\}/,
    /function getDistanceUnitsLabel\(\)[\s\S]*?\n\}/,
    /function formatDistanceKm\(distanceKm\)[\s\S]*?\n\}/,
    /function formatDistanceKmForTable\(distanceKm\)[\s\S]*?\n\}/,
]) {
    const match = code.match(pattern);
    if (!match) {
        throw new Error(`Could not extract helper matching ${pattern}`);
    }
    vm.runInContext(match[0], sandbox);
}

console.log("\nDistance-unit helpers");

it("defaults to miles when no preference is stored", () => {
    sandbox.AppState.distanceUnits = "kilometres";
    assertEqual(sandbox.loadDistanceUnits(), "miles");
    assertEqual(sandbox.getDistanceUnitsLabel(), "Miles");
});

it("loads a stored kilometres preference", () => {
    sandbox.localStorage.getItem = () => "kilometres";
    assertEqual(sandbox.loadDistanceUnits(), "kilometres");
    assertEqual(sandbox.getDistanceUnitsLabel(), "Kilometres");
});

it("formats imperial prose distances in feet and miles", () => {
    sandbox.AppState.distanceUnits = "miles";
    assertEqual(sandbox.formatDistanceKm(0.05), "164ft away");
    assertEqual(sandbox.formatDistanceKm(25), "15.5mi away");
});

it("formats metric prose distances in metres and kilometres", () => {
    sandbox.AppState.distanceUnits = "kilometres";
    assertEqual(sandbox.formatDistanceKm(0.05), "50m away");
    assertEqual(sandbox.formatDistanceKm(25), "25.0km away");
});

it("converts and rounds CHASE table values from canonical kilometres", () => {
    sandbox.AppState.distanceUnits = "miles";
    assertEqual(sandbox.formatDistanceKmForTable(25), "16");
    sandbox.AppState.distanceUnits = "kilometres";
    assertEqual(sandbox.formatDistanceKmForTable(1010.2), "1,010");
});

it("uses a placeholder for an unavailable CHASE distance", () => {
    assertEqual(sandbox.formatDistanceKmForTable(undefined), "-");
});

console.log(`\nResults: ${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
