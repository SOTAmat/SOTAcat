#!/usr/bin/env node
// Unit tests for the Spothole source filter in chase_api.js.
//
// Usage:
//   node test/unit/test_spothole_sources.js

const fs = require("fs");
const path = require("path");
const vm = require("vm");

const tests = [];
function it(name, fn) {
    tests.push({ name, fn });
}

function assertEqual(a, b, m = "") {
    if (a !== b) throw new Error(`${m}: expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`);
}

const DEFAULT_SOURCES = ["Cluster", "POTA", "SOTA"];
const OPTIONS_BODY = {
    spot_providers: [...DEFAULT_SOURCES, "RBN CW/RTTY", "RBN FT8"],
    spot_providers_enabled_by_default: DEFAULT_SOURCES,
};

// Loads the real chase_api.js against a fake Spothole. `optionsReply` builds
// the /options response; every requested URL lands in `requests`.
function makeSandbox({ optionsReply = () => jsonReply(OPTIONS_BODY) } = {}) {
    const storage = {};
    const requests = [];
    const sandbox = {
        console,
        Date,
        JSON,
        Promise,
        URL,
        URLSearchParams,
        AbortController,
        setTimeout,
        clearTimeout,
        localStorage: {
            getItem: (k) => (k in storage ? storage[k] : null),
            setItem: (k, v) => { storage[k] = String(v); },
            removeItem: (k) => { delete storage[k]; },
        },
        Log: { info: () => () => {}, warn: () => () => {}, error: () => () => {}, debug: () => () => {} },
        fetch: async (url) => {
            requests.push(new URL(url));
            return new URL(url).pathname.endsWith("/options") ? optionsReply() : jsonReply([]);
        },
    };
    vm.createContext(sandbox);
    vm.runInContext(fs.readFileSync(path.join(__dirname, "../../src/web/chase_api.js"), "utf8"), sandbox);
    return { sandbox, requests, storage };
}

function jsonReply(body) {
    return { ok: true, status: 200, statusText: "OK", json: async () => body };
}

const spotsRequests = (requests) => requests.filter((u) => u.pathname.endsWith("/spots"));
const optionsRequests = (requests) => requests.filter((u) => u.pathname.endsWith("/options"));

console.log("\nSpothole source filter");

it("asks for spots from Spothole's default sources only", async () => {
    const { sandbox, requests } = makeSandbox();
    await sandbox.fetchAndProcessSpots({ limit: 500 }, null);
    const [spots] = spotsRequests(requests);
    assertEqual(spots.searchParams.get("source"), "Cluster,POTA,SOTA", "source parameter");
});

it("asks Spothole for its sources once across refreshes", async () => {
    const { sandbox, requests } = makeSandbox();
    await sandbox.fetchAndProcessSpots({ limit: 500 }, null);
    await sandbox.fetchAndProcessSpots({ limit: 500 }, null);
    assertEqual(optionsRequests(requests).length, 1, "options requests");
    assertEqual(spotsRequests(requests)[1].searchParams.get("source"), "Cluster,POTA,SOTA", "second source parameter");
});

const HOUR_MS = 3600 * 1000;
function storeSources(storage, sources, ageMs) {
    storage.spotholeDefaultSources = JSON.stringify({ sources, timestamp: Date.now() - ageMs });
}

it("replaces a stored list older than a day", async () => {
    const { sandbox, requests, storage } = makeSandbox();
    storeSources(storage, ["Cluster"], 25 * HOUR_MS);
    await sandbox.fetchAndProcessSpots({ limit: 500 }, null);
    assertEqual(spotsRequests(requests)[0].searchParams.get("source"), "Cluster,POTA,SOTA", "source parameter");
    assertEqual(JSON.parse(storage.spotholeDefaultSources).sources.join(","), "Cluster,POTA,SOTA", "stored list");
});

const failingOptions = () => ({ ok: false, status: 503, statusText: "Service Unavailable", json: async () => ({}) });

it("keeps a stale stored list when Spothole's options are unreachable", async () => {
    const { sandbox, requests, storage } = makeSandbox({ optionsReply: failingOptions });
    storeSources(storage, ["Cluster", "POTA"], 25 * HOUR_MS);
    await sandbox.fetchAndProcessSpots({ limit: 500 }, null);
    assertEqual(spotsRequests(requests)[0].searchParams.get("source"), "Cluster,POTA", "source parameter");
});

async function rejection(promise) {
    try {
        await promise;
    } catch (e) {
        return e;
    }
    throw new Error("expected a rejection, but the call succeeded");
}

it("fails the refresh when Spothole's options name no default sources", async () => {
    const { sandbox, requests, storage } = makeSandbox({ optionsReply: () => jsonReply({ spot_providers: ["Cluster"] }) });
    await rejection(sandbox.fetchAndProcessSpots({ limit: 500 }, null));
    assertEqual(spotsRequests(requests).length, 0, "spots requests");
    assertEqual("spotholeDefaultSources" in storage, false, "nothing stored");
});

(async () => {
    let failed = 0;
    for (const { name, fn } of tests) {
        try {
            await fn();
            console.log(`  ✓ ${name}`);
        } catch (e) {
            failed++;
            console.log(`  ✗ ${name}\n    ${e.message}`);
        }
    }
    console.log(`\n${tests.length - failed} passed, ${failed} failed`);
    if (failed > 0) process.exit(1);
})();
