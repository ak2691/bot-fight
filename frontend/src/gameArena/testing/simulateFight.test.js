import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import { createCombatLog } from "../../../../shared/engine/ecs/combatLog.js";
import { cooldownRemainingMs, preparingAbilityId, preparingRemainingMs } from "../../../../shared/engine/gameconfig/AbilityState.js";
import { batchFrames, simulateFight } from "../../../../shared/engine/simulateFight.js";
import { BROWSER_GOLDEN_FILE, fnv1a, loadGolden, loadScenarios, stateLines } from "./goldenScenarioRunner.js";

// E1: the match loop. Part one runs the shared golden scenarios through simulateFight; part two mirrors the
// server's SegmentedSimulationTest. The goldens are the ones `npm run golden:update` writes: simulateFight must
// reproduce them without being regenerated.

const uuid = (slot) => `00000000-0000-4000-8000-00000000000${slot}`;
const MATCH_ID = "11111111-1111-4111-8111-111111111111";

const scenarioFile = loadScenarios();
const golden = loadGolden(BROWSER_GOLDEN_FILE);

function brainOf(spec) {
    return { version: "bot-logic-tree-v1", loadout: { abilities: spec.abilities }, customVariables: [], roots: spec.roots, chains: [] };
}

function requestFor(scenario) {
    return {
        matchId: MATCH_ID,
        rulesetVersion: "duel-v2",
        seed: 1,
        arena: { width: scenarioFile.arena.width, height: scenarioFile.arena.height, durationMs: scenario.ticks * 100 },
        bots: scenario.bots.map((spec) => ({
            userId: uuid(spec.slot), username: `bot${spec.slot}`, slot: spec.slot, x: spec.x, y: spec.y,
            rotation: spec.rotation, size: 60, selectedLoadout: "custom", brain: brainOf(spec), teamNumber: spec.slot, initialHp: spec.hp ?? null,
        })),
    };
}

for (const scenario of scenarioFile.scenarios) {
    test(`simulateFight reproduces golden scenario ${scenario.id}`, () => {
        const expected = golden.scenarios[scenario.id];
        const combatLog = createCombatLog();
        const hashes = [];
        const { result } = simulateFight(requestFor(scenario), {
            combatLog,
            onTick: (fight) => hashes.push(fnv1a(stateLines([...fight.bots, ...fight.entities]).join("\n"))),
        });
        // A run stops at a knockout; the scenario's own run goes on to its last tick.
        assert.deepEqual(hashes, expected.hashes.slice(0, hashes.length), "per-tick state hashes");
        const lastTick = hashes.length;
        assert.deepEqual(combatLog.entries, expected.log.filter((entry) => entry.tick <= lastTick), "combat log");
        if (lastTick < scenario.ticks) {
            assert.equal(result.endReason, "KO");
        } else {
            assert.equal(lastTick, scenario.ticks);
            assert.notEqual(result.outcome, "CONTINUES");
        }
    });
}

// ---- segmented matches --------------------------------------------------------------------------------------

const WALK_EAST = { action: "move_walk", movementMode: "absolute", movementDirection: 90 };
const WALK_WEST = { action: "move_walk", movementMode: "absolute", movementDirection: 270 };
const SPRINT_EAST = { action: "move_walk", movementMode: "absolute", movementDirection: 90, sprint: true };
const SLASH = [{ action: "rotate_toward_enemy", selectable: "opponent_1" }, { action: 1, selectable: "opponent_1" }];

const always = (...actions) => [{ priority: 1, branches: [{ branchType: "if", priority: 1, conditions: [{ type: "always" }], actions, children: [] }] }];
const brain = (abilities, roots, customVariables = [], chains = []) => ({
    version: "bot-logic-tree-v1", loadout: { abilities }, customVariables, roots, chains,
});
const idle = brain([], []);

const bot = (slot, x, y, botBrain, initialHp = null) => ({
    userId: uuid(slot), username: `bot${slot}`, slot, x, y, rotation: slot === 1 ? 90 : 270, size: 60,
    selectedLoadout: "custom", brain: botBrain, initialHp, teamNumber: slot,
});
const first = (endsAtMs) => ({ endsAtMs, bots: [] });
const swap = (endsAtMs, slot, botBrain, ...variableResets) => ({ endsAtMs, bots: [{ slot, selectedLoadout: "custom", brain: botBrain, variableResets }] });
const segmented = (bots, segments, recordFromMs = null) => ({
    matchId: MATCH_ID, rulesetVersion: "duel-v2", seed: 11, arena: { width: 1200, height: 1200, durationMs: 1 },
    bots, segments, recordFromMs,
});

/** Per-tick observation of the first bot, keyed by the elapsed time of the tick that just ran. */
function observe(request) {
    const seen = [];
    simulateFight(request, {
        onTick: (fight, elapsedMs) => {
            const subject = fight.bots[0];
            seen.push({
                elapsedMs, x: subject.x, y: subject.y, hp: subject.hp, stamina: subject.stamina, sprinting: subject.sprinting,
                preparingAbility: preparingAbilityId(subject) ?? null, preparingMs: preparingRemainingMs(subject),
                triggeredAbility: subject.triggeredAbility,
                cooldowns: Object.fromEntries(subject.abilities.map((id) => [id, cooldownRemainingMs(subject, id)])),
                abilities: [...subject.abilities], variables: { ...subject.customVariables },
                chainDepth: subject.chainStack.length,
            });
        },
    });
    return seen;
}
const at = (seen, elapsedMs) => seen.find((entry) => entry.elapsedMs === elapsedMs);

test("a segment is identical whether produced alone or re-simulated after the later segments", () => {
    const approach = brain([], always(WALK_EAST));
    const armed = brain([1], always(...SLASH));
    const sprinting = brain([1], always(SPRINT_EAST));
    const bots = [bot(1, 300, 600, idle), bot(2, 800, 600, idle)];
    const all = [first(20_000), swap(40_000, 1, approach), swap(60_000, 1, armed), swap(80_000, 1, sprinting),
        swap(100_000, 1, armed), swap(120_000, 1, sprinting)];

    const atRoundSix = simulateFight(segmented(bots, all, 60_000));
    const alone = simulateFight(segmented(bots, all.slice(0, 4), 60_000));
    const whole = simulateFight(segmented(bots, all));

    const framesOf = (run) => run.replay.batches.flatMap((batch) => batch.frames);
    assert.ok(framesOf(atRoundSix).length > 0);
    assert.deepEqual(atRoundSix.replay.initialState, alone.replay.initialState);
    assert.deepEqual(framesOf(atRoundSix), framesOf(alone));
    // The recorded window is the same slice of the uninterrupted run, with frames relative to its start.
    const wholeFrames = framesOf(whole);
    const ticksBefore = 600;
    framesOf(atRoundSix).forEach((windowed, index) => {
        assert.equal(windowed.elapsedMs, (index + 1) * 100);
        assert.deepEqual(windowed.shapes, wholeFrames[ticksBefore + index].shapes);
    });
    assert.ok(framesOf(atRoundSix).length <= 200);
    assert.equal(atRoundSix.result.outcome, "CONTINUES");
    assert.equal(atRoundSix.result.segmentEndMs, 80_000);
});

test("a brain swap takes effect exactly at the boundary tick", () => {
    const east = brain([], always(WALK_EAST));
    const west = brain([], always(WALK_WEST));
    const seen = observe(segmented([bot(1, 600, 600, east), bot(2, 100, 100, idle)], [first(1_000), swap(2_000, 1, west)]));

    assert.ok(at(seen, 1_000).x > at(seen, 100).x);
    // The first tick after the boundary already runs the new brain.
    assert.ok(at(seen, 1_100).x < at(seen, 1_000).x);
    assert.ok(at(seen, 2_000).x < at(seen, 1_000).x);
});

test("custom variables keep, reset and drop at the boundary", () => {
    const bump = (id) => ({ action: "variable", variableId: id, terms: [{ operator: "add", operand: { type: "number", value: 1 } }] });
    const bumps = always(...["custom.keep", "custom.reset", "custom.named", "custom.retyped", "custom.gone"].map(bump));
    const variable = (id, name, valueType, initialValue) => ({ id, name, valueType, initialValue });
    const before = brain([], bumps, [
        variable("custom.keep", "Keep", "number", 5), variable("custom.reset", "Reset", "number", 7),
        variable("custom.named", "Named", "number", 2), variable("custom.retyped", "Retyped", "number", 3),
        variable("custom.gone", "Gone", "number", 4),
    ]);
    const after = brain([], [], [
        variable("custom.keep", "Keep", "number", 5), variable("custom.reset", "Reset", "number", 7),
        variable("custom.named", "Named", "number", 2), variable("custom.retyped", "Retyped", "boolean", true),
        variable("custom.fresh", "Fresh", "number", 9),
    ]);
    const seen = observe(segmented([bot(1, 600, 600, before), bot(2, 100, 100, idle)],
        [first(300), swap(600, 1, after, "custom.reset", "Named")]));

    assert.equal(at(seen, 300).variables["custom.keep"], 8);
    assert.equal(at(seen, 300).variables["custom.reset"], 10);
    assert.equal(at(seen, 300).variables["custom.gone"], 7);

    // The new brain has no actions: the first tick of the new segment shows what the swap left in place.
    const boundary = at(seen, 400).variables;
    assert.equal(boundary["custom.keep"], 8, "same name and type, not reset: keeps its value");
    assert.equal(boundary["custom.reset"], 7, "reset by id: its declared default");
    assert.equal(boundary["custom.named"], 2, "reset by name: its declared default");
    assert.equal(boundary["custom.retyped"], true, "type changed: the new default");
    assert.equal(boundary["custom.fresh"], 9, "new: its default");
    assert.ok(!("custom.gone" in boundary), "no longer declared: dropped");
});

test("a new ability starts ready and everything in play carries across the boundary", () => {
    const slashing = brain([1], always(...SLASH));
    const slashingWithFireball = brain([1, 5], always(...SLASH));
    const base = [bot(1, 600, 600, slashing), bot(2, 600, 690, idle)];

    // A control run keeps the same brain throughout; the swapped run only adds an ability.
    const control = observe(segmented(base, [first(2_000)]));
    const swapped = observe(segmented(base, [first(1_000), swap(2_000, 1, slashingWithFireball)]));

    for (let elapsedMs = 100; elapsedMs <= 2_000; elapsedMs += 100) {
        const expected = at(control, elapsedMs);
        const actual = at(swapped, elapsedMs);
        assert.equal(actual.hp, expected.hp, `hp at ${elapsedMs}`);
        assert.equal(actual.x, expected.x, `x at ${elapsedMs}`);
        assert.equal(actual.triggeredAbility, expected.triggeredAbility, `triggered at ${elapsedMs}`);
        assert.equal(actual.cooldowns[1], expected.cooldowns[1], `slash cooldown at ${elapsedMs}`);
    }
    // The cooldown being carried across is a real, running one.
    assert.ok(at(swapped, 1_000).cooldowns[1] + at(swapped, 900).cooldowns[1] + at(swapped, 800).cooldowns[1] > 0);
    assert.ok(!at(swapped, 1_000).abilities.includes(5));
    assert.ok(at(swapped, 1_100).abilities.includes(1) && at(swapped, 1_100).abilities.includes(5));
    assert.equal(at(swapped, 1_100).cooldowns[5], 0);
});

test("stamina carries across the boundary", () => {
    const sprint = brain([], always(SPRINT_EAST));
    const base = [bot(1, 100, 600, sprint), bot(2, 100, 100, idle)];
    const control = observe(segmented(base, [first(1_500)]));
    const swapped = observe(segmented(base, [first(700), swap(1_500, 1, brain([], always(SPRINT_EAST)))]));

    assert.ok(at(swapped, 700).stamina < 100);
    assert.ok(at(swapped, 800).stamina < at(swapped, 700).stamina + 1);
    for (let elapsedMs = 100; elapsedMs <= 1_500; elapsedMs += 100) {
        assert.equal(at(swapped, elapsedMs).stamina, at(control, elapsedMs).stamina, `stamina at ${elapsedMs}`);
        assert.equal(at(swapped, elapsedMs).sprinting, at(control, elapsedMs).sprinting);
    }
});

test("a wind-up in progress finishes after the brain that started it is gone", () => {
    const aiming = brain([3], always({ action: 3, selectable: "opponent_1" }));
    const seen = observe(segmented([bot(1, 600, 300, aiming), bot(2, 600, 900, idle)], [first(500), swap(2_000, 1, brain([3], []))]));

    assert.equal(at(seen, 500).preparingAbility, 3);
    assert.equal(at(seen, 600).preparingAbility, 3);
    assert.ok(at(seen, 600).preparingMs > 0);
    // The idle brain never fires it again, so the only release is the carried wind-up.
    assert.ok(seen.filter((entry) => entry.elapsedMs > 500).some((entry) => entry.triggeredAbility === 3));
});

test("a running chain ends at the boundary", () => {
    const chains = [{ id: "chain.hold", name: "hold", steps: [{ type: "wait", forMs: 5000 }] }];
    const running = brain([], always({ action: "run_chain", chainId: "chain.hold" }), [], chains);
    const plain = brain([], [], [], chains);
    const seen = observe(segmented([bot(1, 600, 600, running), bot(2, 100, 100, idle)], [first(500), swap(1_500, 1, plain)]));

    assert.equal(at(seen, 100).chainDepth, 1);
    assert.equal(at(seen, 500).chainDepth, 1);
    assert.equal(at(seen, 600).chainDepth, 0);
    assert.equal(at(seen, 1_500).chainDepth, 0);
});

test("a knockout mid-segment ends the run", () => {
    const slashing = brain([1], always(...SLASH));
    // The defender starts wounded so the knockout lands inside the second segment.
    const bots = [bot(1, 600, 600, idle), bot(2, 600, 680, idle, 50)];
    const segments = [first(20_000), swap(40_000, 1, slashing), swap(60_000, 1, slashing)];

    const run = simulateFight(segmented(bots, segments));
    assert.equal(run.result.outcome, "BOT_WIN");
    assert.equal(run.result.endReason, "KO");
    assert.equal(run.result.winnerTeam, 1);
    assert.deepEqual(run.result.teamHp.find((entry) => entry.teamNumber === 2), { teamNumber: 2, hp: 0 });
    const lastElapsed = run.replay.batches.at(-1).frames.at(-1).elapsedMs;
    assert.ok(lastElapsed > 20_000 && lastElapsed < 40_000);
    assert.equal(run.result.segmentEndMs, lastElapsed);
    assert.ok(run.replay.batches.at(-1).terminal);

    // Asking for a later segment after the fight is already over leaves nothing to replay.
    const afterwards = simulateFight(segmented(bots, segments, 40_000));
    assert.equal(afterwards.result.outcome, "BOT_WIN");
    assert.deepEqual(afterwards.replay.batches, []);
    assert.ok(afterwards.replay.initialState.shapes.length > 0);
});

test("a segment that ends without a knockout says the fight continues; the last one decides on HP", () => {
    const bots = [bot(1, 300, 600, idle), bot(2, 900, 600, idle)];
    const segments = [first(20_000), swap(40_000, 1, idle)];

    const firstSegment = simulateFight(segmented(bots, segments, 0));
    assert.equal(firstSegment.replay.batches.flatMap((batch) => batch.frames).length, 200);
    assert.equal(firstSegment.result.outcome, "CONTINUES");
    assert.equal(firstSegment.result.endReason, "SEGMENT_END");
    assert.equal(firstSegment.result.winnerTeam, null);

    // The last segment with every team alive and equal HP is a draw by HP decision.
    const lastSegment = simulateFight(segmented(bots, segments, 20_000));
    assert.equal(lastSegment.replay.batches.flatMap((batch) => batch.frames).length, 200);
    assert.equal(lastSegment.result.outcome, "DRAW");
    assert.equal(lastSegment.result.endReason, "HP_DECISION");
    assert.equal(simulateFight(segmented(bots, segments)).result.outcome, "DRAW");
});

test("the HP decision goes to the team with more total HP", () => {
    const bots = [bot(1, 300, 600, idle, 120), bot(2, 900, 600, idle, 90)];
    const run = simulateFight(segmented(bots, [first(20_000)]));
    assert.equal(run.result.endReason, "HP_DECISION");
    assert.equal(run.result.outcome, "BOT_WIN");
    assert.equal(run.result.winnerTeam, 1);
    assert.deepEqual(run.result.teamHp, [{ teamNumber: 1, hp: 120 }, { teamNumber: 2, hp: 90 }]);
});

test("a team of two counts both bots' HP and survives one death", () => {
    const team = (slot, teamNumber, x, y, hp) => ({ ...bot(slot, x, y, idle, hp), teamNumber });
    const bots = [team(1, 1, 300, 300, 100), team(2, 2, 900, 900, 150), team(3, 1, 300, 900, 100), team(4, 2, 900, 300, 0)];
    const run = simulateFight(segmented(bots, [first(1_000)]));
    // Team 2 has one bot down, so the fight goes on; team 1 leads 200 to 150 on HP.
    assert.equal(run.result.endReason, "HP_DECISION");
    assert.equal(run.result.winnerTeam, 1);
    assert.deepEqual(run.result.teamHp, [{ teamNumber: 1, hp: 200 }, { teamNumber: 2, hp: 150 }]);
});

test("the closing zone only appears in rounds five and six", () => {
    const segments = [first(20_000), ...[40_000, 60_000, 80_000, 100_000, 120_000].map((end) => swap(end, 1, idle))];
    const run = simulateFight(segmented([bot(1, 600, 560, idle), bot(2, 600, 640, idle)], segments));

    const frames = run.replay.batches.flatMap((batch) => batch.frames);
    assert.equal(frames.length, 1_200);
    const zoneOf = (frame) => frame.shapes.find((shape) => shape.type === "closingZone");
    const withZone = frames.filter((frame) => zoneOf(frame));
    assert.equal(withZone[0].elapsedMs, 80_000);
    const zoneSize = (elapsedMs) => zoneOf(frames.find((frame) => frame.elapsedMs === elapsedMs)).size;
    assert.equal(zoneSize(80_000), 1_200);
    assert.equal(zoneSize(85_000), 900);
    assert.equal(zoneSize(100_000), 900);
    assert.equal(zoneSize(105_000), 600);
    assert.equal(zoneSize(120_000), 600);
});

test("the single-segment path keeps its zone and ninety second cap", () => {
    const request = (durationMs) => ({
        matchId: MATCH_ID, rulesetVersion: "duel-v2", seed: 1, arena: { width: 1200, height: 1200, durationMs },
        bots: [bot(1, 600, 560, idle), bot(2, 600, 640, idle)],
    });
    assert.throws(() => simulateFight(request(95_000)), /90 second/);

    const plain = simulateFight(request(16_000));
    const frames = plain.replay.batches.flatMap((batch) => batch.frames);
    // duel-v1 starts its zone at 15 s, not the timed-rounds 80 s.
    assert.ok(frames.find((frame) => frame.elapsedMs === 15_000).shapes.some((shape) => shape.type === "closingZone"));
});

test("hostile segment schedules are rejected", () => {
    const bots = [bot(1, 300, 600, idle), bot(2, 900, 600, idle)];
    const run = (segments, recordFromMs = null) => simulateFight(segmented(bots, segments, recordFromMs));

    assert.throws(() => run([first(20_000), first(20_000)]));
    assert.throws(() => run([first(20_000), first(40_000), first(60_000), first(80_000), first(100_000), first(120_000), first(140_000)]));
    assert.throws(() => run([first(20_050)]));
    assert.throws(() => run([first(20_000), first(60_000)]));
    assert.throws(() => run([first(20_000), swap(40_000, 9, idle)]));
    assert.throws(() => run([swap(20_000, 1, idle)]));
    assert.throws(() => run([first(20_000), swap(40_000, 1, idle, ...Array(101).fill("x"))]));
    assert.throws(() => run([1, 2, 3, 4, 5, 6, 7].map((index) => first(index * 1_000))));
    assert.throws(() => run([first(20_000), first(40_000)], 5_000));
    assert.throws(() => simulateFight({ ...segmented(bots, [first(1_000)]), rulesetVersion: "duel-v1" }));
    assert.throws(() => simulateFight({ ...segmented(bots, [first(1_000)]), seed: 1.5 }));
    assert.throws(() => simulateFight(segmented([bots[0]], [first(1_000)])));
    assert.throws(() => simulateFight(segmented([bots[0], { ...bots[1], teamNumber: 1 }], [first(1_000)])));
});

test("replay batches are one second long, terminal at the end, and a run is repeatable", () => {
    const frames = Array.from({ length: 25 }, (_, index) => ({ elapsedMs: (index + 1) * 100, shapes: [] }));
    const batches = batchFrames(frames);
    assert.deepEqual(batches.map((batch) => [batch.sequence, batch.endMs, batch.terminal, batch.frames.length]),
        [[1, 1_000, false, 10], [2, 2_000, false, 10], [3, 2_500, true, 5]]);
    assert.deepEqual(batchFrames([]), []);

    const request = segmented([bot(1, 300, 600, brain([1], always(...SLASH))), bot(2, 380, 600, idle)], [first(3_000)]);
    assert.deepEqual(simulateFight(request), simulateFight(request));
    assert.equal(JSON.stringify(simulateFight(request)).includes("NaN"), false);
});

test("the goldens file still covers the scenarios simulateFight runs", () => {
    assert.ok(fs.existsSync(BROWSER_GOLDEN_FILE));
    assert.deepEqual(Object.keys(golden.scenarios).sort(), scenarioFile.scenarios.map((scenario) => scenario.id).sort());
});


test("worker puzzle rules modify variables before win/lose, survive brain ticks and stop deterministically", () => {
    const request = segmented([bot(1, 300, 600, idle), bot(2, 900, 600, idle)], [first(1000)]);
    request.puzzle = { timeLimitMs: 1000, logicConfiguration: {
        version: "bot-logic-tree-v2",
        customVariables: [{ id: "custom.puzzle.counter", name: "Counter", valueType: "number", initialValue: 4 }],
        roots: [
            { kind: "modify", branches: [{ conditions: [{ type: "always" }], actions: [
                { action: "variable", variableId: "custom.puzzle.counter", terms: [{ operator: "add", operand: { type: "number", value: 1 } }] },
            ] }] },
            { kind: "win", branches: [{ conditions: [{ type: "expression", left: "custom.puzzle.counter", comparator: "gte", right: { type: "number", value: 7 } }] }] },
            { kind: "lose", branches: [{ conditions: [{ type: "always" }] }] },
        ],
    } };
    const lose = request.puzzle.logicConfiguration.roots.pop();
    const result = simulateFight(request);
    assert.equal(result.result.puzzleStatus, "solved");
    assert.equal(result.result.segmentEndMs, 300);
    assert.deepEqual(simulateFight(request), result);
    request.puzzle.logicConfiguration.roots.push(lose);
    request.puzzle.logicConfiguration.roots[1].branches[0].conditions[0].right.value = 5;
    assert.equal(simulateFight(request).result.puzzleStatus, "solved", "win takes priority over lose");
    request.puzzle.logicConfiguration.roots = [];
    assert.equal(simulateFight(request).result.puzzleStatus, "failed");
    assert.equal(simulateFight(request).result.segmentEndMs, 1000);
});

test("puzzle rules see the initial match time", () => {
    const request = { ...segmented([bot(1, 300, 600, idle), bot(2, 900, 600, idle)], [first(1000)]), segments: null,
        arena: { width: 1200, height: 1200, durationMs: 1000, initialElapsedMs: 500 } };
    request.puzzle = { timeLimitMs: 1000, logicConfiguration: { version: "bot-logic-tree-v2", customVariables: [], roots: [
        { kind: "win", branches: [{ conditions: [{ type: "expression", left: "match.elapsedSeconds", comparator: "gte", right: { type: "number", value: 0.5 } }] }] },
    ] } };
    assert.equal(simulateFight(request).result.puzzleStatus, "solved");
    assert.equal(simulateFight(request).result.segmentEndMs, 100);
});


test("live first-round authority request keeps a six-round horizon despite an HP lead", () => {
    const request = segmented([bot(1, 300, 600, idle, 120), bot(2, 900, 600, idle, 90)],
        Array.from({ length: 6 }, (_, index) => first((index + 1) * 20000)), 0);
    const run = simulateFight(request);
    assert.equal(run.result.outcome, "CONTINUES");
    assert.equal(run.result.endReason, "SEGMENT_END");
    assert.equal(run.result.winnerTeam, null);
    assert.equal(run.result.segmentEndMs, 20000);
});
