import { loadScenarios, runScenario } from "./goldenScenarioRunner.js";

/** Full match length: six 20-second segments at 100 ms per tick. */
export const BENCHMARK_TICKS = 1200;

/**
 * Fixed scenario orders per pass. Different scenarios sharing one process is what exposes the
 * slowdown, so the passes interleave them differently (forward, reversed, rotated by half).
 */
export function benchmarkOrders(count) {
    const forward = Array.from({ length: count }, (_, index) => index);
    const half = Math.floor(count / 2);
    return [forward, [...forward].reverse(), [...forward.slice(half), ...forward.slice(0, half)]];
}

/** One pass: every scenario at BENCHMARK_TICKS in the given order, log off. Returns [{ id, ms }]. */
export function runBenchmarkPass(scenarios, order, ticks = BENCHMARK_TICKS) {
    return order.map((index) => {
        const scenario = { ...scenarios[index], ticks };
        const start = performance.now();
        runScenario(scenario, { log: false });
        return { id: scenario.id, ms: performance.now() - start };
    });
}

/** `passes` defaults to all three fixed orders. Returns [{ pass, results: [{ id, ms }] }]. */
export function runBenchmark({ passes = 3, ticks = BENCHMARK_TICKS, scenarios = loadScenarios().scenarios } = {}) {
    return benchmarkOrders(scenarios.length).slice(0, passes)
        .map((order, pass) => ({ pass: pass + 1, results: runBenchmarkPass(scenarios, order, ticks) }));
}
