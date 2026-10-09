import assert from "node:assert/strict";
import process from "node:process";
import test from "node:test";
import {
    BROWSER_GOLDEN_FILE,
    SERVER_GOLDEN_FILE,
    loadGolden,
    loadScenarios,
} from "./goldenScenarioRunner.js";
import { buildReport, diffLogs, firstHashMismatch, formatReport } from "./parityReport.js";

// Fails when the browser and server combat logs or per-tick state hashes of any shared scenario differ. The failure message is the
// report; PARITY_VERBOSE=1 lists every mismatched entry instead of the first few per scenario.
test("browser and server combat logs and state hashes match for every shared scenario", () => {
    const report = buildReport(loadGolden(BROWSER_GOLDEN_FILE), loadGolden(SERVER_GOLDEN_FILE));
    assert.deepEqual(report.map((scenario) => scenario.id).sort(), loadScenarios().scenarios.map((scenario) => scenario.id).sort(),
        "both goldens cover every shared scenario");
    assert.deepEqual(report.filter((scenario) => scenario.missing), []);
    const mismatched = report.filter((scenario) => scenario.mismatches.length > 0 || scenario.hashMismatch);
    assert.equal(mismatched.length, 0,
        `
${formatReport(report, { perScenario: process.env.PARITY_VERBOSE ? Infinity : 8 })}`);
});

test("firstHashMismatch reports the first differing tick, 1-based, and a short list", () => {
    assert.equal(firstHashMismatch(["a", "b"], ["a", "b"]), null);
    assert.deepEqual(firstHashMismatch(["a", "b", "c"], ["a", "x", "y"]), { tick: 2, browser: "b", server: "x" });
    assert.deepEqual(firstHashMismatch(["a", "b"], ["a"]), { tick: 2, browser: "b", server: null });
});

test("a hash mismatch is reported and fails the scenario", () => {
    const side = (hashes) => ({ scenarios: { s: { log: [], hashes } } });
    const report = buildReport(side(["a", "b"]), side(["a", "c"]));
    assert.deepEqual(report[0].hashMismatch, { tick: 2, browser: "b", server: "c" });
    assert.match(formatReport(report), /s: state hashes first differ at tick 2/);
});

test("diffLogs compares per tick and stage, ignores order and rounds amounts", () => {
    const entry = (overrides) => ({
        tick: 1, stage: "act", kind: "effect", source: "bot1", target: "bot2", abilityId: 1, effect: "damage", amount: 8, ...overrides,
    });
    const other = entry({ target: "bot3" });
    assert.deepEqual(diffLogs([entry({}), other], [other, entry({ amount: 8.0004 })]), []);
    const mismatches = diffLogs([entry({})], [entry({ amount: 9 })]);
    assert.deepEqual(mismatches.map((mismatch) => mismatch.side), ["browser", "server"]);
    assert.deepEqual(diffLogs([entry({})], [entry({ stage: "settle" })]).map((mismatch) => mismatch.group),
        ["0001 act", "0001 settle"]);
});
