import assert from "node:assert/strict";
import test from "node:test";
import { loadScenarios, runScenario } from "../../testing/goldenScenarioRunner.js";
import { applyEffectList, applyStatus } from "../../../../../shared/engine/ecs/abilities/effects.js";

// Roster batch R4 (docs/ROSTER_DESIGN.md section 4 and 5, and the run plan's Part 1 and Part 2): Execute (45), Phase Strike's
// Backstab (25), Disruptive Beam's counter-hit (30), Parry (41), Overcharge (44) and Tether Link (47). Each cast is an ALWAYS
// brain. The numbers asserted are the ones in shared/gameplay/abilities.json and statuses.json; the golden file pins the
// full tick-by-tick result.

const scenarios = new Map(loadScenarios().scenarios.map((scenario) => [scenario.id, scenario]));
const runOf = (id, overrides = {}) => runScenario({ ...scenarios.get(id), ...overrides });
const logOf = (id) => runOf(id).log;
const ofKind = (log, kind) => log.filter((entry) => entry.kind === kind);
const damageTo = (log, target, abilityId) => log.filter((entry) => entry.effect === "damage" && entry.target === target && entry.abilityId === abilityId);
// Bots are found by slot: the shapes' ids are not the log's names.
const botInSlot = (bots, slot) => bots.find((bot) => bot.slot === slot);

test("Execute: an ALWAYS cast on a bot below 30% HP takes the 60 finisher first, then the base 25 (capped by the HP left)", () => {
    const run = runOf("execute-finisher");
    assert.deepEqual(ofKind(run.log, "activate").map((entry) => [entry.tick, entry.abilityId]), [[6, 45]]);
    // The bonus is checked before the base hit, so the 30% test reads the pre-hit HP.
    assert.deepEqual(damageTo(run.log, "bot2", 45).map((entry) => entry.amount), [60, 6]);
});

test("Execute: the strike shows its bonus X on the tick the finisher landed", () => {
    const activation = ofKind(logOf("execute-finisher"), "activate").find((entry) => entry.abilityId === 45).tick;
    // Ending the run on the activation tick keeps the strike's visual, which the bot shape holds for its visible window.
    const bots = runOf("execute-finisher", { ticks: activation }).bots;
    assert.equal(botInSlot(bots, 1).abilityVisual?.bonus, true);
});

test("Execute counter: on a bot above 30% HP only the base 25 lands, and the strike has no bonus", () => {
    const run = runOf("execute-healthy-counter");
    assert.deepEqual(damageTo(run.log, "bot2", 45).map((entry) => entry.amount), [25]);
    const bots = runOf("execute-healthy-counter", { ticks: 6 }).bots;
    assert.notEqual(botInSlot(bots, 1).abilityVisual?.bonus, true);
});

test("Backstab: Phase Strike's follow-up hits from behind for 10, plus 15 for the from-behind bonus", () => {
    const log = logOf("phase-strike-backstab");
    assert.deepEqual(damageTo(log, "bot2", 25).map((entry) => [entry.tick, entry.amount]), [[1, 15], [2, 10], [2, 15]]);
});

test("Backstab counter: a bot that faces the blink takes only the 10 follow-up", () => {
    const log = logOf("phase-strike-facing-counter");
    assert.deepEqual(damageTo(log, "bot2", 25).filter((entry) => entry.tick === 2).map((entry) => entry.amount), [10]);
});

test("Disruptive Beam: a stun lands only on a bot winding up its own cast, and it is the 1 s counter-hit stun", () => {
    const log = logOf("disruptive-beam-counter-hit");
    assert.deepEqual(damageTo(log, "bot2", 30).map((entry) => entry.amount), [20]);
    const stuns = log.filter((entry) => entry.kind === "status" && entry.effect === "stun" && entry.target === "bot2");
    assert.deepEqual(stuns.map((entry) => [entry.abilityId, entry.amount]), [[30, 1000]]);
});

test("Parry: an ALWAYS cast blocks the Slash that lands in its stance, and the attacker is stunned for 800 ms", () => {
    const log = logOf("parry-blocks-slash");
    assert.deepEqual(ofKind(log, "activate").filter((entry) => entry.abilityId === 41).map((entry) => [entry.tick, entry.source]), [[1, "bot1"]]);
    // The first Slash (tick 3) does nothing: immunity blocks its damage, and the parry reaction stuns its owner.
    assert.equal(damageTo(log, "bot1", 1).filter((entry) => entry.tick <= 3).length, 0);
    assert.ok(log.some((entry) => entry.kind === "status" && entry.effect === "stun" && entry.target === "bot2" && entry.amount === 800 && entry.tick === 3));
    // The single charge is spent by that hit, so the parry is gone before its 300 ms ends.
    const run = runOf("parry-blocks-slash", { ticks: 3 });
    assert.equal(botInSlot(run.bots, 1).statusEffects.some((status) => status.type === "parry"), false);
});

test("Parry: a point-blank Shotgun Blast lands all seven pellets in one tick, and the parry blocks every one", () => {
    // The parry-blocks-slash setup with the attacker on an ALWAYS Shotgun Blast: without the parry all seven pellets hit on
    // tick 2. The first pellet spends the charge; the parry holds until the tick settles, so the other six are blocked too.
    const scenario = structuredClone(scenarios.get("parry-blocks-slash"));
    scenario.ticks = 12;
    const shooter = scenario.bots[1];
    shooter.abilities = [39];
    shooter.roots[0].branches[0].actions[0].action = 39;
    shooter.roots[0].branches[0].conditions = [{ type: "always" }];
    const { log } = runScenario(scenario);
    assert.deepEqual(ofKind(log, "activate").filter((entry) => entry.abilityId === 39).map((entry) => entry.tick), [2]);
    assert.deepEqual(damageTo(log, "bot1", 39), []);
    const stuns = log.filter((entry) => entry.kind === "status" && entry.effect === "stun" && entry.target === "bot2");
    assert.deepEqual(stuns.map((entry) => [entry.tick, entry.amount]), [[2, 800]], "one stun, not one per pellet");
});

test("Parry counter: a Stun into the stance is blocked, and the stunner is stunned for 800 ms instead", () => {
    const log = logOf("parry-stun-counter");
    assert.deepEqual(log.filter((entry) => entry.kind === "status" && entry.effect === "stun" && entry.target === "bot1"), []);
    assert.ok(log.some((entry) => entry.kind === "status" && entry.effect === "stun" && entry.target === "bot2" && entry.amount === 800));
    assert.equal(damageTo(log, "bot1", 6).length, 0);
});

test("Overcharge: an ALWAYS cast doubles its first four weapon hits (16 each), then the bonus is spent", () => {
    const log = logOf("overcharge-weapon-hits");
    assert.deepEqual(ofKind(log, "activate").filter((entry) => entry.abilityId === 44).map((entry) => entry.tick), [3]);
    assert.deepEqual(damageTo(log, "bot2", 1).map((entry) => [entry.tick, entry.amount]),
        [[4, 16], [13, 16], [22, 16], [31, 16], [40, 8], [49, 8], [58, 8]]);
    // The fourth charge ends the status, so it is gone for the rest of the run.
    assert.equal(botInSlot(runOf("overcharge-weapon-hits").bots, 1).statusEffects.some((status) => status.type === "overcharge"), false);
});

test("Overcharge counter: an owner that never gets into weapon range spends no charges", () => {
    const run = runOf("overcharge-out-of-range");
    assert.deepEqual(damageTo(run.log, "bot2", 1), []);
    const overcharge = botInSlot(run.bots, 1).statusEffects.find((status) => status.type === "overcharge");
    assert.equal(overcharge?.charges, 4, "all four charges are still there");
});

test("Tether Link: an ALWAYS cast tethers the bot it hits for 4 s, and the tether pulls it back to within 200 units", () => {
    const log = logOf("tether-link-pull");
    assert.deepEqual(ofKind(log, "activate").filter((entry) => entry.abilityId === 47).map((entry) => entry.tick), [3]);
    assert.ok(log.some((entry) => entry.kind === "status" && entry.effect === "tethered" && entry.target === "bot2" && entry.tick === 5 && entry.amount === 4000));
    // The bolt is removed on its hit, so it is not left flying.
    assert.deepEqual(ofKind(log, "removal").filter((entry) => entry.abilityId === 47).map((entry) => entry.tick), [5]);
    const pulls = log.filter((entry) => entry.effect === "displace" && entry.target === "bot2");
    assert.equal(pulls.length, 4, "four 30-unit pulls take the bot from 300 to 180 units away");
    const run = runOf("tether-link-pull");
    const distance = Math.abs(botInSlot(run.bots, 2).x - botInSlot(run.bots, 1).x);
    assert.ok(distance <= 200 && distance > 150, `distance ${distance}`);
});

test("Tether Link's ×1.2 and bleed's ×1.25 multiply on the same bot: a 10 hit does 15", () => {
    const caster = { id: "caster", slot: 1, teamNumber: 1, size: 60, hp: 225, maxHp: 225, x: 300, y: 300, rotation: 90, abilities: [], abilityState: {} };
    const holder = { id: "holder", slot: 2, teamNumber: 2, size: 60, hp: 100, maxHp: 100, x: 480, y: 300, rotation: 270, abilities: [], abilityState: {} };
    applyStatus(holder, { subtype: "bleed", durationMs: 4000, amount: 2 }, { source: caster });
    applyStatus(holder, { subtype: "tethered", durationMs: 4000 }, { source: caster });
    applyEffectList([{ type: "damage", amount: 10, targetKinds: ["BOT"] }], {
        abilityId: 5, stats: {}, source: caster, owner: caster, target: holder, damageMultiplier: 1,
    }, { targetKinds: ["BOT"] });
    assert.equal(holder.hp, 85, "10 × 1.25 × 1.2 = 15");
});
