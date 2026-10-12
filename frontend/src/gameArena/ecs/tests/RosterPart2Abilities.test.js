import assert from "node:assert/strict";
import test from "node:test";
import { loadScenarios, runScenario } from "../../testing/goldenScenarioRunner.js";

// Roster batch R3 (docs/ROSTER_DESIGN.md): Boomerang (40) and Fan of Blades (46). Both are out-and-back projectiles that
// hit each enemy once on the way out and once on the way back, and are removed when they touch their owner. Each
// scenario's brain is ALWAYS, so the cast runs the real executor from its first tick. The golden file pins the full result.

const scenarios = new Map(loadScenarios().scenarios.map((scenario) => [scenario.id, scenario]));
const logOf = (id) => runScenario(scenarios.get(id)).log;
const ofKind = (log, kind) => log.filter((entry) => entry.kind === kind);
const damageTo = (log, target, abilityId) => log.filter((entry) => entry.effect === "damage" && entry.target === target && entry.abilityId === abilityId);

test("Boomerang: an ALWAYS cast hits the bot in its line on the way out, and again on the way back, then the owner catches it", () => {
    const log = logOf("boomerang-out-and-back");
    assert.deepEqual(ofKind(log, "activate").map((entry) => [entry.tick, entry.abilityId]), [[1, 40]]);
    // The out phase lasts 1000 ms, so the boomerang turns on tick 10. It hits on the way out (tick 2) and on the way back (tick 18).
    assert.deepEqual(damageTo(log, "bot2", 40).map((entry) => [entry.tick, entry.amount]), [[2, 12], [18, 12]]);
    assert.deepEqual(ofKind(log, "phase").map((entry) => [entry.tick, entry.effect]), [[10, "out>back"]]);
    // Touching the owner removes it. The owner is never hurt by its own boomerang.
    assert.deepEqual(ofKind(log, "removal").map((entry) => [entry.tick, entry.target]), [[20, "boomerang:1:1"]]);
    assert.equal(log.filter((entry) => entry.effect === "damage" && entry.target === "bot1").length, 0);
});

test("Fan of Blades: an ALWAYS cast fires eight blades in a ring, and each blade can hit an enemy once per leg", () => {
    const log = logOf("fan-of-blades-ring");
    assert.deepEqual(ofKind(log, "activate").map((entry) => [entry.tick, entry.abilityId]), [[3, 46]]);
    const spawned = ofKind(log, "spawn").filter((entry) => entry.abilityId === 46).map((entry) => entry.target);
    assert.equal(new Set(spawned).size, 8);
    // Every blade turns back on the same tick (its out phase is 800 ms).
    assert.deepEqual(ofKind(log, "phase").map((entry) => [entry.tick, entry.effect]), spawned.map(() => [10, "out>back"]));
    const hits = damageTo(log, "bot2", 46);
    assert.ok(hits.every((entry) => entry.amount === 12), "12 per blade per pass");
    // Each blade hits the same enemy at most once in each leg, so with two legs no blade hits it more than twice.
    const perBlade = new Map();
    for (const entry of hits) perBlade.set(entry.source, (perBlade.get(entry.source) ?? 0) + 1);
    assert.ok([...perBlade.values()].every((count) => count <= 2), "no blade hits twice in one leg");
    assert.ok(hits.some((entry) => entry.tick < 10) && hits.some((entry) => entry.tick >= 10), "hits on both legs");
    // The blades are removed when they touch the owner, or at the 3 s age cap.
    assert.equal(ofKind(log, "removal").filter((entry) => entry.abilityId === 46).length, 8);
});

test("the Boomerang counter: a bot that steps out of the line before the return takes only the outbound hit", () => {
    const log = logOf("boomerang-step-out");
    assert.deepEqual(damageTo(log, "bot2", 40).map((entry) => [entry.tick, entry.amount]), [[2, 12]]);
    // The bot dashes out of the line on tick 6, before the boomerang turns on tick 10.
    assert.deepEqual(ofKind(log, "activate").filter((entry) => entry.source === "bot2").map((entry) => entry.tick), [6]);
    assert.equal(damageTo(log, "bot2", 40).length, 1);
});
