import { asBots } from "../../testing/botFixtures.js";
import { presetEffects } from "../../../../../shared/engine/gameconfig/StatusPresets.js";
import assert from "node:assert/strict";
import test from "node:test";
import { MOVEMENT_TICK_MS } from "../../../../../shared/engine/gameconfig/MovementConfig.js";
import { initialMovementState } from "../../../../../shared/engine/gameconfig/StaminaSystem.js";
import { abilityReady } from "../../../../../shared/engine/botlogic/code/runtime/actionRuntime.js";
import { ACTION_BY_ID } from "../../../../../shared/engine/botlogic/code/contracts/BotLogicContracts.js";
import { actionExecutionHead } from "../../../../../shared/engine/botlogic/code/BotCode.js";
import { buildDeterministicLogicAction as buildDeterministicLogicActionNormalized } from "../../../../../shared/engine/botlogic/planner/ArenaActionPlanner.js";
import { buildStatePayload } from "../../../../../shared/engine/modelPayloads/strategyStatePayload.js";
import { normalizeAbilityStrategyConfiguration as normalizeBrainForTick } from "../../../../../shared/engine/botlogic/code/BotCode.js";
import { applyBotAction } from "../../testing/pureTicks.js";
import { activeRemainingMs, pendingCooldownMs, preparingAbilityId, preparingRemainingMs, cooldownRemainingMs } from "../../../../../shared/engine/gameconfig/AbilityState.js";

// The engine takes normalized brains; tests pass raw ones, so normalize here like the edge does.
const buildDeterministicLogicAction = (configuration, ...rest) => buildDeterministicLogicActionNormalized(normalizeBrainForTick(configuration), ...rest);

const DASH_ABILITY_ID = 19;

// Mirrors the server's DashChannelTest; keep the scenarios and numbers in step.
const SLASH = 1;
const SNIPER = 3;
const FIREBALL = 5;
const WALK = 15;
const idle = { dx: 0, dy: 0, dRot: 0 };
const dash = { action: DASH_ABILITY_ID, targetX: 900, targetY: 400, movementMode: "absolute", movementDirection: 90 };
const swing = { action: SLASH };
const snipe = { action: SNIPER, targetX: 900, targetY: 400 };

function bot(extra = {}) {
    return {
        id: "main", slot: 1, x: 200, y: 400, size: 60, rotation: 90, hp: 100, maxHp: 100,
        moveSpeed: WALK, attackSpeedMultiplier: 1, movementVelocityX: 0, movementVelocityY: 0,
        abilities: [SLASH, SNIPER, FIREBALL, DASH_ABILITY_ID], abilityState: {}, ...initialMovementState(),
        ...extra,
    };
}

/** The dash's stage and time left, e.g. "active:200" or "cooldown:100"; the server test prints the same. */
const abilityStageMs = (shape, id) => `${shape.abilityState?.[id]?.stage ?? "ready"}:${shape.abilityState?.[id]?.remainingMs ?? 0}`;

const step = (shape, action = idle) => applyBotAction(shape, action, MOVEMENT_TICK_MS);
const status = (type) => ({ statusEffects: [{ type, remainingMs: 1000, mode: "duration", effects: presetEffects(type) }] });

test("Dash has its own action category and ignores the ability lock", () => {
    assert.equal(ACTION_BY_ID.get(DASH_ABILITY_ID).head, "dash");
    assert.equal(actionExecutionHead(ACTION_BY_ID.get(DASH_ABILITY_ID)), "dash");
    assert.equal(ACTION_BY_ID.get(SLASH).head, "ability");
    // Other abilities winding up or active never make a dash unready, and a dash never blocks them.
    assert.equal(abilityReady(bot({ abilityState: { [SNIPER]: { stage: "windup", remainingMs: 500 } } }), DASH_ABILITY_ID), true);
    assert.equal(abilityReady(bot({ abilityState: { [FIREBALL]: { stage: "active", remainingMs: 300 } } }), DASH_ABILITY_ID), true);
    assert.equal(abilityReady(bot({ abilityState: { [DASH_ABILITY_ID]: { stage: "active", remainingMs: 300 } } }), SLASH), true);
});

test("a dash and a swing chosen on the same tick both start", () => {
    const both = step(bot(), { ...idle, abilityAction: swing, dashAction: dash });
    assert.equal(both.triggeredAbility, SLASH, "the swing owns the trigger so its hit still resolves");
    assert.ok(activeRemainingMs(both, SLASH) > 0);
    assert.ok(activeRemainingMs(both, DASH_ABILITY_ID) > 0);
    assert.equal(both.stamina, 70);
    // The dash pays its stamina and reserves its 100 ms cooldown; the swing does not touch either.
    assert.equal(pendingCooldownMs(both, DASH_ABILITY_ID), 100);
    assert.equal(abilityStageMs(both, DASH_ABILITY_ID), "active:200", "a dash started beside an ability keeps its full active stage");
    assert.ok(both.x > 200, "the dash moved the bot");
    // The dash alone still reports itself as triggered.
    assert.equal(step(bot(), { ...idle, dashAction: dash }).triggeredAbility, DASH_ABILITY_ID);
});

const state = (shape) => buildStatePayload(asBots([shape, { id: "opponent-model", slot: 2, x: 700, y: 400, size: 60, hp: 100, abilities: [] }]), "custom");
const plan = (configuration, shape) => buildDeterministicLogicAction(configuration, state(shape));
const rootOf = (priority, actions, conditions = [{ type: "always" }]) => ({ priority, branches: [{ priority: 1, branchType: "if", conditions, actions, children: [] }] });

test("a dash and an attack are planned together from two roots and from one conditional", () => {
    const attack = { action: SLASH, selectable: "opponent_1" };
    const dashRoot = { action: DASH_ABILITY_ID, selectable: "opponent_1" };
    const fromRoots = plan({ version: "bot-logic-tree-v1", roots: [rootOf(1, [attack]), rootOf(2, [dashRoot])] }, bot());
    const fromRootsReversed = plan({ version: "bot-logic-tree-v1", roots: [rootOf(1, [dashRoot]), rootOf(2, [attack])] }, bot());
    const fromOneConditional = plan({ version: "bot-logic-tree-v1", roots: [rootOf(1, [attack, dashRoot])] }, bot());
    for (const [name, action] of [["two roots", fromRoots], ["two roots reversed", fromRootsReversed], ["one conditional", fromOneConditional]]) {
        assert.equal(action.abilityAction?.action, SLASH, name);
        assert.equal(action.dashAction?.action, DASH_ABILITY_ID, name);
        const started = step(bot(), action);
        assert.ok(activeRemainingMs(started, SLASH) > 0 && activeRemainingMs(started, DASH_ABILITY_ID) > 0, `${name} starts both`);
    }

});

test("a dash starts during another ability's wind-up and active phase, and the wind-up carries on", () => {
    const winding = step(bot(), { ...idle, abilityAction: snipe });
    assert.equal(preparingAbilityId(winding), SNIPER);
    const dashedWhileWinding = step(winding, { ...idle, abilityAction: snipe, dashAction: dash });
    assert.equal(dashedWhileWinding.triggeredAbility, DASH_ABILITY_ID);
    assert.equal(preparingAbilityId(dashedWhileWinding), SNIPER, "the wind-up continues while dashing");
    assert.equal(preparingRemainingMs(dashedWhileWinding), preparingRemainingMs(winding) - MOVEMENT_TICK_MS);

    const active = step(bot(), { ...idle, abilityAction: swing });
    assert.ok(activeRemainingMs(active, SLASH) > 0);
    const dashedWhileActive = step(active, { ...idle, dashAction: dash });
    assert.equal(dashedWhileActive.triggeredAbility, DASH_ABILITY_ID);
    assert.ok(activeRemainingMs(dashedWhileActive, SLASH) > 0 || cooldownRemainingMs(dashedWhileActive, SLASH) > 0);
});

test("an attack starts during a dash", () => {
    const dashing = step(bot(), { ...idle, dashAction: dash });
    assert.ok(activeRemainingMs(dashing, DASH_ABILITY_ID) > 0);
    const attacked = step(dashing, { ...idle, abilityAction: swing });
    assert.equal(attacked.triggeredAbility, SLASH);
    assert.ok(activeRemainingMs(attacked, SLASH) > 0);
    const winding = step(dashing, { ...idle, abilityAction: snipe });
    assert.equal(preparingAbilityId(winding), SNIPER);
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

test("the stamina and cooldown gates", () => {
    assert.equal(step(bot({ stamina: 29, staminaRegenDelayMs: 500 }), { ...idle, dashAction: dash }).triggeredAbility, null);
    assert.equal(step(bot({ stamina: 30, staminaRegenDelayMs: 500 }), { ...idle, dashAction: dash }).triggeredAbility, DASH_ABILITY_ID);
    assert.equal(step(bot({ abilityState: { [DASH_ABILITY_ID]: { stage: "cooldown", remainingMs: 200 } } }), { ...idle, dashAction: dash }).triggeredAbility, null);
    const dashed = step(bot(), { ...idle, dashAction: dash });
    assert.equal(dashed.stamina, 70);
    assert.equal(cooldownRemainingMs(dashed, DASH_ABILITY_ID) ?? 0, 0, "the cooldown is reserved while the dash is active");
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
    assert.equal(preparingAbilityId(winding), SNIPER);
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
        rows.push([current.triggeredAbility ?? null, current.x, current.stamina, current.staminaRegenDelayMs, abilityStageMs(current, DASH_ABILITY_ID), current.sprinting === true]);
    }
    return rows;
}

test("parity trace: dash + swing", () => {
    assert.deepEqual(trace(bot(), [{ ...idle, abilityAction: swing, dashAction: dash }, idle, idle, idle, idle]), [
        [SLASH, 275, 70, 500, "active:200", false],
        [null, 350, 70, 400, "active:100", false],
        [null, 350, 70, 300, "cooldown:100", false],
        [null, 350, 70, 200, "ready:0", false],
        [null, 350, 70, 100, "ready:0", false],
    ]);
});

test("parity trace: sprint in, swing, run dry", () => {
    const run = { dx: 1, dy: 0, dRot: 0, sprint: true };
    assert.deepEqual(trace(bot({ stamina: 12, staminaRegenDelayMs: 500 }), [run, { ...run, abilityAction: swing }, run, run, run]), [
        [null, 222.5, 9, 500, "ready:0", true],
        [SLASH, 245, 6, 500, "ready:0", true],
        [null, 267.5, 3, 500, "ready:0", true],
        [null, 290, 0, 500, "ready:0", true],
        [null, 305, 0, 400, "ready:0", false],
    ]);
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

test("the picker and node label read DASH", async () => {
    const { ACTION_HEAD_TONES, groupedActionPickerOptions } = await import("../../coding/nodes/pickerSupport.js");
    const { ACTION_TYPES } = await import("../../../../../shared/engine/botlogic/code/contracts/BotLogicContracts.js");
    const groups = groupedActionPickerOptions(ACTION_TYPES);
    const dashGroup = groups.find((group) => group.head === "dash");
    assert.equal(dashGroup.title, "Dash");
    assert.deepEqual(dashGroup.options.map((option) => option.id), [DASH_ABILITY_ID]);
    assert.equal(groups.find((group) => group.head === "ability").options.some((option) => option.id === DASH_ABILITY_ID), false);
    assert.equal(ACTION_HEAD_TONES.dash, "green");
    const { readFileSync } = await import("node:fs");
    const nodes = readFileSync(new URL("../../coding/nodes/GraphNodes.jsx", import.meta.url), "utf8");
    assert.match(nodes, /dash: "DASH"/);
});

test("sprint help no longer says attacking ends it", async () => {
    const { readFileSync } = await import("node:fs");
    const nodes = readFileSync(new URL("../../coding/nodes/GraphNodes.jsx", import.meta.url), "utf8");
    assert.match(nodes, /Drains 30 stamina\/s\. Stops at 0 stamina\./);
    assert.doesNotMatch(nodes, /Ends when you attack/);
});
