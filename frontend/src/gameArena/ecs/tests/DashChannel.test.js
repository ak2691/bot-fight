import assert from "node:assert/strict";
import test from "node:test";
import { applyBotAction } from "../bots/ActionExecutionSystem.js";
import { applyDamageToShape } from "../../gameconfig/BotCombatSystem.js";
import { DASH_ABILITY_ID, MOVEMENT_TICK_MS } from "../../gameconfig/MovementConfig.js";
import { initialMovementState } from "../../gameconfig/StaminaSystem.js";
import { abilityReady } from "../../botlogic/code/runtime/actionRuntime.js";
import { ACTION_BY_ID } from "../../botlogic/code/contracts/BotLogicContracts.js";
import { actionExecutionHead } from "../../botlogic/code/BotCode.js";
import { buildDeterministicLogicAction } from "../../botlogic/planner/ArenaActionPlanner.js";
import { buildStatePayload } from "../../modelPayloads/strategyStatePayload.js";
import { traceScenario } from "../../botlogic/code/tests/chainScenarioRunner.js";

// Mirrors the server's DashChannelTest; keep the scenarios and numbers in step.
const SLASH = 1;
const SNIPER = 3;
const FIREBALL = 5;
const WALK = 15;
const idle = { dx: 0, dy: 0, dRot: 0 };
const dash = { action: DASH_ABILITY_ID, targetX: 900, targetY: 400, movementMode: "absolute", movementDirection: "east" };
const swing = { action: SLASH };
const snipe = { action: SNIPER, targetX: 900, targetY: 400 };

function bot(extra = {}) {
    return {
        id: "main", slot: 1, x: 200, y: 400, size: 60, rotation: 90, hp: 100, maxHp: 100,
        moveSpeed: WALK, attackSpeedMultiplier: 1, movementVelocityX: 0, movementVelocityY: 0,
        abilities: [SLASH, SNIPER, FIREBALL, DASH_ABILITY_ID], abilityCooldowns: {}, abilityActiveMs: {}, abilityCharges: {},
        ...initialMovementState(),
        ...extra,
    };
}

const step = (shape, action = idle) => applyBotAction(shape, action, MOVEMENT_TICK_MS, applyDamageToShape);
const status = (type) => ({ statusEffects: [{ type, remainingMs: 1000, mode: "duration" }] });

test("Dash has its own action category and ignores the ability lock", () => {
    assert.equal(ACTION_BY_ID.get(DASH_ABILITY_ID).head, "dash");
    assert.equal(actionExecutionHead(ACTION_BY_ID.get(DASH_ABILITY_ID)), "dash");
    assert.equal(ACTION_BY_ID.get(SLASH).head, "ability");
    // Other abilities winding up or active never make a dash unready, and a dash never blocks them.
    assert.equal(abilityReady(bot({ preparingAbility: SNIPER, preparingMs: 500 }), DASH_ABILITY_ID), true);
    assert.equal(abilityReady(bot({ abilityActiveMs: { [FIREBALL]: 300 } }), DASH_ABILITY_ID), true);
    assert.equal(abilityReady(bot({ abilityActiveMs: { [DASH_ABILITY_ID]: 300 } }), SLASH), true);
});

test("a dash and a swing chosen on the same tick both start", () => {
    const both = step(bot(), { ...idle, abilityAction: swing, dashAction: dash });
    assert.equal(both.triggeredAbility, SLASH, "the swing owns the trigger so its hit still resolves");
    assert.ok(both.abilityActiveMs[SLASH] > 0);
    assert.ok(both.abilityActiveMs[DASH_ABILITY_ID] > 0);
    assert.equal(both.stamina, 70);
    assert.equal(both.dashGapMs, 300);
    assert.ok(both.x > 200, "the dash moved the bot");
    // The dash alone still reports itself as triggered.
    assert.equal(step(bot(), { ...idle, dashAction: dash }).triggeredAbility, DASH_ABILITY_ID);
});

const state = (shape) => buildStatePayload([shape, { id: "opponent-model", slot: 2, x: 700, y: 400, size: 60, hp: 100, abilities: [] }], "custom");
const plan = (configuration, shape) => buildDeterministicLogicAction(configuration, state(shape));
const rootOf = (priority, actions, conditions = [{ type: "always" }]) => ({ priority, branches: [{ priority: 1, branchType: "if", conditions, actions, children: [] }] });

test("a dash and an attack are planned together from two roots, from one conditional, and from a chain", () => {
    const attack = { action: SLASH, selectable: "opponent_1" };
    const dashRoot = { action: DASH_ABILITY_ID, selectable: "opponent_1" };
    const fromRoots = plan({ version: "bot-logic-tree-v1", roots: [rootOf(1, [attack]), rootOf(2, [dashRoot])] }, bot());
    const fromRootsReversed = plan({ version: "bot-logic-tree-v1", roots: [rootOf(1, [dashRoot]), rootOf(2, [attack])] }, bot());
    const fromOneConditional = plan({ version: "bot-logic-tree-v1", roots: [rootOf(1, [attack, dashRoot])] }, bot());
    for (const [name, action] of [["two roots", fromRoots], ["two roots reversed", fromRootsReversed], ["one conditional", fromOneConditional]]) {
        assert.equal(action.abilityAction?.action, SLASH, name);
        assert.equal(action.dashAction?.action, DASH_ABILITY_ID, name);
        const started = step(bot(), action);
        assert.ok(started.abilityActiveMs[SLASH] > 0 && started.abilityActiveMs[DASH_ABILITY_ID] > 0, `${name} starts both`);
    }

    const chain = { id: "chain.both", name: "both", steps: [
        { type: "action", action: SLASH, selectable: "opponent_1", continue: "now" },
        { type: "action", action: DASH_ABILITY_ID, selectable: "opponent_1", continue: "now" },
    ] };
    const fromChain = plan({ version: "bot-logic-tree-v1", chains: [chain], roots: [rootOf(1, [{ action: "run_chain", chainId: chain.id }])] }, bot());
    assert.equal(fromChain.abilityAction?.action, SLASH);
    assert.equal(fromChain.dashAction?.action, DASH_ABILITY_ID);
    assert.equal(fromChain.runningChain, null, "both steps ran in the one tick");
});

test("a dash starts during another ability's wind-up and active phase, and the wind-up carries on", () => {
    const winding = step(bot(), { ...idle, abilityAction: snipe });
    assert.equal(winding.preparingAbility, SNIPER);
    const dashedWhileWinding = step(winding, { ...idle, abilityAction: snipe, dashAction: dash });
    assert.equal(dashedWhileWinding.triggeredAbility, DASH_ABILITY_ID);
    assert.equal(dashedWhileWinding.preparingAbility, SNIPER, "the wind-up continues while dashing");
    assert.equal(dashedWhileWinding.preparingMs, winding.preparingMs - MOVEMENT_TICK_MS);

    const active = step(bot(), { ...idle, abilityAction: swing });
    assert.ok(active.abilityActiveMs[SLASH] > 0);
    const dashedWhileActive = step(active, { ...idle, dashAction: dash });
    assert.equal(dashedWhileActive.triggeredAbility, DASH_ABILITY_ID);
    assert.ok(dashedWhileActive.abilityActiveMs[SLASH] > 0 || dashedWhileActive.abilityCooldowns[SLASH] > 0);
});

test("an attack starts during a dash", () => {
    const dashing = step(bot(), { ...idle, dashAction: dash });
    assert.ok(dashing.abilityActiveMs[DASH_ABILITY_ID] > 0);
    const attacked = step(dashing, { ...idle, abilityAction: swing });
    assert.equal(attacked.triggeredAbility, SLASH);
    assert.ok(attacked.abilityActiveMs[SLASH] > 0);
    const winding = step(dashing, { ...idle, abilityAction: snipe });
    assert.equal(winding.preparingAbility, SNIPER);
});

test("silence does not stop Dash, while stun, slow and movement-lock do", () => {
    assert.equal(step(bot(status("silence")), { ...idle, dashAction: dash }).triggeredAbility, DASH_ABILITY_ID);
    assert.equal(step(bot(status("silence")), { ...idle, abilityAction: swing }).triggeredAbility, null, "silence still stops abilities");

    for (const type of ["stun", "slow"]) {
        const result = step(bot(status(type)), { ...idle, dashAction: dash });
        assert.equal(result.triggeredAbility, null, `${type} stops the dash`);
        assert.equal(result.stamina ?? 100, 100, `${type} spends nothing`);
    }
    // Movement-lock cuts a dash short: the first 75-unit step happens as it starts, the rest never does.
    let locked = step(bot(status("movement-lock")), { ...idle, dashAction: dash });
    assert.equal(locked.triggeredAbility, DASH_ABILITY_ID);
    for (let tick = 0; tick < 3; tick += 1) locked = step(locked);
    assert.equal(locked.x, 275);
    assert.equal(locked.dashRemaining, 0);
    const free = [0, 1, 2].reduce((current) => step(current), step(bot(), { ...idle, dashAction: dash }));
    assert.equal(free.x, 350, "an unlocked dash covers its full 150 units");
});

test("the stamina and gap gates are unchanged", () => {
    assert.equal(step(bot({ stamina: 29, staminaRegenDelayMs: 500 }), { ...idle, dashAction: dash }).triggeredAbility, null);
    assert.equal(step(bot({ stamina: 30, staminaRegenDelayMs: 500 }), { ...idle, dashAction: dash }).triggeredAbility, DASH_ABILITY_ID);
    assert.equal(step(bot({ dashGapMs: 200 }), { ...idle, dashAction: dash }).triggeredAbility, null);
    const dashed = step(bot(), { ...idle, dashAction: dash });
    assert.equal(dashed.stamina, 70);
    assert.equal(dashed.abilityCooldowns?.[DASH_ABILITY_ID] ?? 0, 0, "no cooldown");
});

test("sprint holds through an ability's start, wind-up and active phase", () => {
    const run = { dx: 1, dy: 0, dRot: 0, sprint: true };
    const fast = WALK * 1.5;
    let current = step(bot(), { ...run, abilityAction: swing });
    assert.equal(current.triggeredAbility, SLASH);
    assert.equal(current.x, 200 + fast, "sprinting on the tick the swing starts");
    assert.equal(current.stamina, 97);
    for (let tick = 1; tick <= 3; tick += 1) {
        const x = current.x;
        current = step(current, run);
        assert.equal(current.x - x, fast, `active tick ${tick}`);
    }
    assert.equal(current.stamina, 88);

    let winding = step(bot(), { ...run, abilityAction: snipe });
    assert.equal(winding.preparingAbility, SNIPER);
    assert.equal(winding.x, 200 + fast);
    const x = winding.x;
    winding = step(winding, run);
    assert.equal(winding.x - x, fast, "sprinting while the wind-up continues");
    assert.equal(winding.stamina, 94);
});

function trace(start, script) {
    let current = start;
    const rows = [];
    for (const action of script) {
        current = step(current, action);
        rows.push([current.triggeredAbility ?? null, current.x, current.stamina, current.staminaRegenDelayMs, current.dashGapMs, current.sprinting === true]);
    }
    return rows;
}

test("parity trace: dash + swing", () => {
    assert.deepEqual(trace(bot(), [{ ...idle, abilityAction: swing, dashAction: dash }, idle, idle, idle, idle]), [
        [SLASH, 275, 70, 500, 300, false],
        [null, 350, 70, 400, 200, false],
        [null, 350, 70, 300, 100, false],
        [null, 350, 70, 200, 0, false],
        [null, 350, 70, 100, 0, false],
    ]);
});

test("parity trace: sprint in, swing, run dry", () => {
    const run = { dx: 1, dy: 0, dRot: 0, sprint: true };
    assert.deepEqual(trace(bot({ stamina: 12, staminaRegenDelayMs: 500 }), [run, { ...run, abilityAction: swing }, run, run, run]), [
        [null, 222.5, 9, 500, 0, true],
        [SLASH, 245, 6, 500, 0, true],
        [null, 267.5, 3, 500, 0, true],
        [null, 290, 0, 500, 0, true],
        [null, 305, 0, 400, 0, false],
    ]);
});

test("chain scenarios print a dash beside the ability that starts with it", () => {
    const lines = traceScenario({
        name: "dash and swing", abilities: [SLASH, DASH_ABILITY_ID], defenderX: 380, ticks: 2,
        roots: [rootOf(1, [{ action: SLASH, selectable: "opponent_1" }, { action: DASH_ABILITY_ID, selectable: "opponent_1" }])], chains: [],
    });
    assert.match(lines[0], /\| 1\+19 /);
});

test("a conditional may hold one Dash and one ability, but not two of the same", async () => {
    const { editorRootsFor, wireBlockReason } = await import("../../coding/treeWiring.js");
    const brain = { roots: [{ id: "r", branches: [
        { id: "b1", conditions: [{ type: "always" }], actions: [{ id: "a1", action: SLASH }, { id: "d1", action: DASH_ABILITY_ID }], children: [] },
        { id: "b2", conditions: [{ type: "always" }], actions: [{ id: "a2", action: SLASH }], children: [] },
        { id: "b3", conditions: [{ type: "always" }], actions: [{ id: "d2", action: DASH_ABILITY_ID }], children: [] },
    ] }], orphans: [] };
    const roots = editorRootsFor(brain);
    const node = (id, path, actionIndex) => ({ id, rootIndex: 0, rootId: "r", path, actionIndex });
    const onB2 = { id: "condition:b2:root:r", rootIndex: 0, path: [1] };
    // b2 already has a Slash: a Dash joins it, a second ability does not.
    assert.equal(wireBlockReason(roots, onB2, node("d1", [0], 1)), null);
    assert.equal(wireBlockReason(roots, onB2, node("a1", [0], 0)), "This conditional already has a Ability action");
    // b3 already has a Dash: a second Dash is refused, an ability is fine.
    const onB3 = { id: "condition:b3:root:r", rootIndex: 0, path: [2] };
    assert.equal(wireBlockReason(roots, onB3, node("d1", [0], 1)), "This conditional already has a Dash action");
    assert.equal(wireBlockReason(roots, onB3, node("a1", [0], 0)), null);
});

test("the picker, node label and chain label read DASH", async () => {
    const { ACTION_HEAD_TONES, groupedActionPickerOptions } = await import("../../coding/nodes/pickerSupport.js");
    const { ACTION_TYPES } = await import("../../botlogic/code/contracts/BotLogicContracts.js");
    const groups = groupedActionPickerOptions(ACTION_TYPES);
    const dashGroup = groups.find((group) => group.head === "dash");
    assert.equal(dashGroup.title, "Dash");
    assert.deepEqual(dashGroup.options.map((option) => option.id), [DASH_ABILITY_ID]);
    assert.equal(groups.find((group) => group.head === "ability").options.some((option) => option.id === DASH_ABILITY_ID), false);
    assert.equal(ACTION_HEAD_TONES.dash, "green");
    const { readFileSync } = await import("node:fs");
    const nodes = readFileSync(new URL("../../coding/nodes/GraphNodes.jsx", import.meta.url), "utf8");
    assert.match(nodes, /dash: "DASH"/);
    assert.match(readFileSync(new URL("../../coding/chains/chainStepPresentation.js", import.meta.url), "utf8"), /\[ACTION_HEADS\.DASH\]: "DASH"/);
});

test("sprint help no longer says attacking ends it", async () => {
    const { readFileSync } = await import("node:fs");
    const nodes = readFileSync(new URL("../../coding/nodes/GraphNodes.jsx", import.meta.url), "utf8");
    assert.match(nodes, /Drains 30 stamina\/s\. Stops at 0 stamina\./);
    assert.doesNotMatch(nodes, /Ends when you attack/);
});
