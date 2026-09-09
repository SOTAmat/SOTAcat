#!/usr/bin/env node
const fs = require("fs");
const path = require("path");
const vm = require("vm");

let passed = 0;
let failed = 0;
function assert(value, message) { if (!value) throw new Error(message); }
async function test(name, fn) {
    try { await fn(); passed++; console.log(`  ✓ ${name}`); }
    catch (e) { failed++; console.log(`  ✗ ${name}\n    ${e.message}`); }
}

function button() {
    const classes = new Set();
    return { disabled: false, textContent: "Manual Tune", attrs: {},
        classList: { toggle: (n, on) => on ? classes.add(n) : classes.delete(n), contains: n => classes.has(n) },
        setAttribute(n, v) { this.attrs[n] = v; }
    };
}

function sandbox(responseOk = true) {
    const btn = button();
    const calls = [];
    const timers = [];
    const sb = {
        console, Promise,
        document: { getElementById: id => id === "manual-tune-button" ? btn : null },
        fetch: async (url, opts) => { calls.push([url, opts.method]); return { ok: responseOk }; },
        setTimeout: fn => { timers.push(fn); return timers.length; },
        clearTimeout: () => {},
        Log: { error: () => () => {} },
    };
    vm.createContext(sb);
    const source = fs.readFileSync(path.join(__dirname, "../../src/web/run.js"), "utf8");
    const start = source.indexOf("const MANUAL_TUNE_TIMEOUT_MS");
    const end = source.indexOf("// ============================================================================\n// CW Macro Button Functions", start);
    vm.runInContext(source.slice(start, end), sb);
    return { sb, btn, calls, timers };
}

(async () => {
    console.log("\nmanual tune");
    await test("starts, renders Stop Tune, and auto-resets", async () => {
        const x = sandbox();
        await x.sb.toggleManualTune();
        assert(x.calls[0][0] === "/api/v1/manualTune?state=1", "wrong start request");
        assert(x.btn.textContent === "Stop Tune" && x.btn.classList.contains("active"), "active state not rendered");
        x.timers[0]();
        assert(x.btn.textContent === "Manual Tune" && !x.btn.classList.contains("active"), "timeout did not reset UI");
    });
    await test("second click sends stop", async () => {
        const x = sandbox();
        await x.sb.toggleManualTune();
        await x.sb.toggleManualTune();
        assert(x.calls[1][0] === "/api/v1/manualTune?state=0", "wrong stop request");
        assert(x.btn.textContent === "Manual Tune", "inactive state not rendered");
    });
    await test("failed request leaves state unchanged", async () => {
        const x = sandbox(false);
        await x.sb.toggleManualTune();
        assert(x.btn.textContent === "Manual Tune" && !x.btn.classList.contains("active"), "failure changed state");
    });
    console.log(`\n${passed} passed, ${failed} failed`);
    if (failed) process.exit(1);
})();
