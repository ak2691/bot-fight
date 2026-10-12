import assert from "node:assert/strict";
import test from "node:test";
import { loadScenarios, runScenario } from "../../testing/goldenScenarioRunner.js";

// Roster batch R2, part 1 (docs/ROSTER_DESIGN.md): Lunge (38), Shotgun Blast (39), Tar Pit (43) and Overdrive (42).
// Each scenario's brain is ALWAYS, so the cast runs the real executor from its first tick. The numbers asserted here are
// the ones in shared/gameplay/abilities.json and statuses.json; the golden file pins the full tick-by-tick result.

const scenarios = new Map(loadScenarios().scenarios.map((scenario) => [scenario.id, scenario]));
const logOf = (id) => runScenario(scenarios.get(id)).log;
const ofKind = (log, kind) => log.filter((entry) => entry.kind === kind);
const damageTo = (log, target, abilityId) => log.filter((entry) => entry.effect === "damage" && entry.target === target && entry.abilityId === abilityId);

test("Lunge: an ALWAYS cast crouches, leaps and stabs the bot it lands on for 18, which then bleeds", () => {
    const log = logOf("lunge-leap-stab");
    assert.deepEqual(ofKind(log, "activate").map((entry) => [entry.tick, entry.abilityId]), [[1, 38]]);
    // The crouch lasts 200 ms, then the leap moves the lunger and the stab phase starts on the same tick.
    assert.deepEqual(ofKind(log, "phase").map((entry) => [entry.tick, entry.effect]), [[2, "crouch>stab"]]);
    assert.deepEqual(damageTo(log, "bot2", 38).filter((entry) => entry.tick === 2).map((entry) => entry.amount), [18]);
    assert.ok(log.some((entry) => entry.kind === "status" && entry.effect === "bleed" && entry.target === "bot2" && entry.amount === 4000));
    // The stab runs 100 ms, then the attached entity runs out and is removed.
    assert.deepEqual(ofKind(log, "removal").map((entry) => [entry.tick, entry.target]), [[3, "lunge:1:1"]]);
});

test("Shotgun Blast: an ALWAYS cast fires seven pellets in a fan, and at point blank all seven hit for 5", () => {
    const log = logOf("shotgun-blast-fan");
    assert.deepEqual(ofKind(log, "activate").map((entry) => [entry.tick, entry.abilityId]), [[2, 39]]);
    assert.equal(ofKind(log, "spawn").filter((entry) => entry.abilityId === 39).length, 7);
    assert.deepEqual(damageTo(log, "bot2", 39).map((entry) => entry.amount), [5, 5, 5, 5, 5, 5, 5]);
    // Each pellet is removed when it hits, so none outlives its first contact.
    assert.equal(new Set(ofKind(log, "removal").filter((entry) => entry.abilityId === 39).map((entry) => entry.target)).size, 7);
});

test("Tar Pit: an ALWAYS cast lands a glob, then a pool that slows and deals 3 every 500 ms for 4 s", () => {
    const log = logOf("tar-pit-pool");
    assert.deepEqual(ofKind(log, "activate").map((entry) => [entry.tick, entry.abilityId]), [[3, 43]]);
    assert.deepEqual(ofKind(log, "phase").map((entry) => [entry.tick, entry.effect]), [[5, "landing>pool"]]);
    const hits = damageTo(log, "bot2", 43);
    assert.deepEqual(hits.map((entry) => entry.tick), [5, 10, 15, 20, 25, 30, 35, 40, 45]);
    assert.ok(hits.every((entry) => entry.amount === 3));
    // The slow is 600 ms, so it is renewed every 500 ms and never lapses while the bot stands in the pool.
    assert.equal(log.filter((entry) => entry.kind === "status" && entry.effect === "slow" && entry.target === "bot2").length, hits.length);
    assert.deepEqual(ofKind(log, "removal").filter((entry) => entry.abilityId === 43).map((entry) => entry.tick), [45]);
});

test("Overdrive: an ALWAYS cast gives 2.5 s in which dashes spend no stamina", () => {
    const log = logOf("overdrive-free-dash");
    assert.deepEqual(log.filter((entry) => entry.kind === "status" && entry.effect === "overdrive").map((entry) => [entry.tick, entry.target, entry.amount]),
        [[1, "bot1", 2500]]);
    // The dash on the cast tick is paid before the status lands at resolve hits. From tick 2 to the end of the status (tick 26) it is free.
    const dashesInWindow = ofKind(log, "activate").filter((entry) => entry.abilityId === 19 && entry.tick >= 2 && entry.tick <= 26);
    assert.ok(dashesInWindow.length >= 5, "dashes run inside the window");
    const spendsInWindow = ofKind(log, "stamina").filter((entry) => entry.effect === "spend" && entry.tick >= 2 && entry.tick <= 26);
    assert.deepEqual(spendsInWindow, []);
    assert.ok(ofKind(log, "stamina").some((entry) => entry.effect === "spend" && entry.tick > 26), "dashes cost stamina again once it ends");
});

test("the Lunge counter: Repelling Blast lands as the Lunge does and pushes the lunger away", () => {
    const log = logOf("lunge-repelling-counter");
    assert.deepEqual(damageTo(log, "bot2", 38).filter((entry) => entry.tick === 2).map((entry) => entry.amount), [18]);
    assert.deepEqual(ofKind(log, "activate").filter((entry) => entry.source === "bot2").map((entry) => [entry.tick, entry.abilityId]), [[3, 8]]);
    assert.deepEqual(log.filter((entry) => entry.effect === "displace" && entry.target === "bot1").map((entry) => [entry.tick, entry.amount]), [[3, 300]]);
    assert.deepEqual(damageTo(log, "bot1", 8).map((entry) => entry.tick), [3]);
});
