import assert from "node:assert/strict";
import test from "node:test";
import { runBenchmark } from "./engineBenchmark.js";

/**
 * Per-scenario budget (ms) for a 1,200-tick match run mixed with the others in one process: about 3x the
 * slowest scenario measured on the first (coldest) pass, ~140 ms.
 */
const SCENARIO_BUDGET_MS = 450;

test("a mixed pass of every golden scenario stays under the time budget", () => {
    const [pass] = runBenchmark({ passes: 1 });
    for (const { id, ms } of pass.results) {
        assert.ok(ms < SCENARIO_BUDGET_MS, `${id} took ${ms.toFixed(0)} ms (budget ${SCENARIO_BUDGET_MS} ms)`);
    }
});
