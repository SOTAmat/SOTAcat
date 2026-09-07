#!/usr/bin/env node
// Unit tests for the shared Imperial/Metric display helpers in main.js.
//
// Usage:
//   node test/unit/test_units.js

const fs = require("fs");
const path = require("path");
const vm = require("vm");

let testsPassed = 0;
let testsFailed = 0;

function it(name, fn) {
    try {
        fn();
        testsPassed++;
        console.log(`  ✓ ${name}`);
    } catch (e) {
        testsFailed++;
        console.log(`  ✗ ${name}\n    ${e.message}`);
    }
}

function assertEqual(a, b, m = "") {
    if (a !== b) throw new Error(`${m}: expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`);
}

function makeSandbox() {
    const sandbox = {
        AppState: { units: "imperial" },
        localStorage: {
            _store: {},
            getItem(k) { return Object.prototype.hasOwnProperty.call(this._store, k) ? this._store[k] : null; },
            setItem(k, v) { this._store[k] = String(v); },
        },
    };
    vm.createContext(sandbox);

    const mainJsCode = fs.readFileSync(path.join(__dirname, "../../src/web/main.js"), "utf8");
    for (const name of [
        "loadUnitsSetting",
        "getDistanceUnitsLabel",
        "formatDistanceAway",
        "formatChaseDistance",
        "formatSummitAltitude",
    ]) {
        const match = mainJsCode.match(new RegExp(`(?:const ${name} =|function ${name}\\()[\\s\\S]*?\\n\\}`));
        if (!match) throw new Error(`Could not extract ${name} from main.js`);
        vm.runInContext(match[0], sandbox);
    }
    for (const name of ["MILES_PER_KM", "FEET_PER_MILE"]) {
        const constMatch = mainJsCode.match(new RegExp(`const ${name} = [^;]+;`));
        if (!constMatch) throw new Error(`Could not extract ${name} from main.js`);
        vm.runInContext(constMatch[0], sandbox);
    }

    return sandbox;
}

console.log("\nshared unit-preference helpers");

it("defaults to imperial when nothing is stored", () => {
    const s = makeSandbox();
    s.AppState.units = "metric"; // loader must not trust a stale AppState
    assertEqual(s.loadUnitsSetting(), "imperial");
    assertEqual(s.AppState.units, "imperial");
});

it("loads a stored metric preference", () => {
    const s = makeSandbox();
    s.localStorage.setItem("sotacat_units", "metric");
    assertEqual(s.loadUnitsSetting(), "metric");
});

it("falls back to imperial on an unrecognized stored value", () => {
    const s = makeSandbox();
    s.localStorage.setItem("sotacat_units", "furlongs");
    assertEqual(s.loadUnitsSetting(), "imperial");
});

it("labels the chase distance column per preference", () => {
    const s = makeSandbox();
    s.AppState.units = "imperial";
    assertEqual(s.getDistanceUnitsLabel(), "Miles");
    s.AppState.units = "metric";
    assertEqual(s.getDistanceUnitsLabel(), "km");
});

it("formats imperial prose distances in feet and miles", () => {
    const s = makeSandbox();
    s.AppState.units = "imperial";
    assertEqual(s.formatDistanceAway(0.05), "164ft away");
    assertEqual(s.formatDistanceAway(25), "15.5mi away");
});

it("formats metric prose distances in meters and kilometers", () => {
    const s = makeSandbox();
    s.AppState.units = "metric";
    assertEqual(s.formatDistanceAway(0.05), "50m away");
    assertEqual(s.formatDistanceAway(25), "25.0km away");
});

it("converts and rounds chase table values from canonical kilometers", () => {
    const s = makeSandbox();
    s.AppState.units = "imperial";
    assertEqual(s.formatChaseDistance(25), "16");
    s.AppState.units = "metric";
    assertEqual(s.formatChaseDistance(1010.2), "1,010");
});

it("renders a placeholder for an unavailable chase distance", () => {
    const s = makeSandbox();
    assertEqual(s.formatChaseDistance(undefined), "-");
    assertEqual(s.formatChaseDistance(NaN), "-");
});

it("selects the API-supplied summit altitude per preference", () => {
    const s = makeSandbox();
    const summit = { altM: 860, altFt: 2820 };
    s.AppState.units = "imperial";
    assertEqual(s.formatSummitAltitude(summit), "2820ft");
    s.AppState.units = "metric";
    assertEqual(s.formatSummitAltitude(summit), "860m");
});

console.log("\ncanonical-kilometer chase pipeline");

function makeTransformSandbox() {
    const sandbox = {
        spotModeFamily: () => "CW",
        calculateDistance: () => 10.7, // stub: transform must store this unrounded
        Date: Date,
    };
    vm.createContext(sandbox);

    const apiCode = fs.readFileSync(path.join(__dirname, "../../src/web/chase_api.js"), "utf8");
    for (const name of ["spotCoordinate", "spothole_transformSpots"]) {
        const match = apiCode.match(new RegExp(`function ${name}\\([\\s\\S]*?\\n\\}`));
        if (!match) throw new Error(`Could not extract ${name} from chase_api.js`);
        vm.runInContext(match[0], sandbox);
    }
    return sandbox;
}

const RAW_SPOT = { dx_call: "VK1ABC/P", mode: "cw", freq: 14062000, time: 1756400000, dx_latitude: -35.3, dx_longitude: 149.1 };

it("stores unrounded canonical kilometers on the spot", () => {
    const s = makeTransformSandbox();
    const [spot] = s.spothole_transformSpots([RAW_SPOT], { latitude: 37.9, longitude: -122.7 });
    assertEqual(spot.distanceKm, 10.7);
    assertEqual("distance" in spot, false, "legacy miles field must not exist");
});

it("uses the no-location sentinel in kilometers", () => {
    const s = makeTransformSandbox();
    const [spot] = s.spothole_transformSpots([RAW_SPOT], null);
    assertEqual(spot.distanceKm, 99999);
});

it("migrates a persisted 'distance' sort field to 'distanceKm'", () => {
    const sandbox = {
        ChaseState: { sortField: "timestamp", lastSortField: "timestamp", descending: true },
        localStorage: {
            _store: { chaseSortField: "distance" },
            getItem(k) { return Object.prototype.hasOwnProperty.call(this._store, k) ? this._store[k] : null; },
        },
    };
    vm.createContext(sandbox);
    const chaseCode = fs.readFileSync(path.join(__dirname, "../../src/web/chase.js"), "utf8");
    const match = chaseCode.match(/function loadSortState\(\)[\s\S]*?\n\}/);
    if (!match) throw new Error("Could not extract loadSortState from chase.js");
    vm.runInContext(match[0], sandbox);

    sandbox.loadSortState();
    assertEqual(sandbox.ChaseState.sortField, "distanceKm");
    assertEqual(sandbox.ChaseState.lastSortField, "distanceKm");
});

console.log(`\nResults: ${testsPassed} passed, ${testsFailed} failed`);
process.exit(testsFailed ? 1 : 0);
