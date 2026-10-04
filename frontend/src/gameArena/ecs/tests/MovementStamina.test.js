import assert from "node:assert/strict";
import test from "node:test";
import { applyBotAction } from "../bots/ActionExecutionSystem.js";
import { applyDamageToShape } from "../../gameconfig/BotCombatSystem.js";
import { DASH_ABILITY_ID, MOVEMENT_CONFIG, MOVEMENT_TICK_MS } from "../../gameconfig/MovementConfig.js";
import { initialMovementState } from "../../gameconfig/StaminaSystem.js";
import { abilityCooldownMs, abilityReady } from "../../botlogic/code/runtime/actionRuntime.js";
import { evaluateCondition, normalizeAbilityStrategyConfiguration } from "../../botlogic/code/BotCode.js";
import { ACTION_BY_ID, STATE_VARIABLE_BY_ID } from "../../botlogic/code/contracts/BotLogicContracts.js";
import { stateFromPayload } from "../../botlogic/code/runtime/runtimeState.js";
import { buildStatePayload } from "../../modelPayloads/strategyStatePayload.js";
import { buildDeterministicLogicAction } from "../../botlogic/planner/ArenaActionPlanner.js";
import { actionIdsForLoadoutConfiguration } from "../../gameconfig/CombatLoadouts.js";
import { resetBotShape, toSimulationBotShape } from "../../modelPayloads/arenaShapes.js";
import { actionPickerDescription } from "../../coding/nodes/pickerSupport.js";
import { STATUS_EFFECT_APPLICATIONS } from "../contracts/StatusContracts.js";

const WALK_SPEED = 15;
const idle = { dx: 0, dy: 0, dRot: 0 };
const walk = (extra = {}) => ({ dx: 1, dy: 0, dRot: 0, ...extra });
const slash = { dx: 0, dy: 0, dRot: 0, abilityAction: { action: 1 } };
const snipe = { dx: 0, dy: 0, dRot: 0, abilityAction: { action: 3, targetX: 900, targetY: 400 } };
const cancel = { dx: 0, dy: 0, dRot: 0, cancelWindup: true };
const dashAction = { dx: 0, dy: 0, dRot: 0, abilityAction: { action: DASH_ABILITY_ID, targetX: 900, targetY: 400 } };

function bot(extra = {}) {
    return {
        id: "main", slot: 1, x: 200, y: 400, size: 60, rotation: 90, hp: 100, maxHp: 100,
        moveSpeed: WALK_SPEED, attackSpeedMultiplier: 1, movementVelocityX: 0, movementVelocityY: 0,
        abilities: [1, 3, 19, 34], abilityCooldowns: {}, abilityActiveMs: {}, abilityCharges: {},
        ...initialMovementState(),
        ...extra,
    };
}

const opponentShape = () => ({
    ...resetBotShape(bot({ id: "opponent-model", type: "opponentModel", slot: 2, x: 800 })),
    id: "opponent-model",
});

const step = (shape, action = idle) => applyBotAction(shape, action, MOVEMENT_TICK_MS, applyDamageToShape);
function run(shape, action, ticks) {
    let current = shape;
    for (let tick = 0; tick < ticks; tick += 1) current = step(current, action);
    return current;
}

test("every ms value in MovementConfig is a whole multiple of 100 and every amount an integer", () => {
    assert.equal(MOVEMENT_TICK_MS, 100);
    for (const [key, value] of Object.entries(MOVEMENT_CONFIG)) {
        if (key.endsWith("Ms")) assert.equal(value % MOVEMENT_TICK_MS, 0, `${key} must be a multiple of 100 ms`);
        else if (key !== "sprintMultiplier") assert.equal(Number.isInteger(value), true, `${key} must be a whole amount`);
    }
    assert.deepEqual({ ...MOVEMENT_CONFIG }, {
        staminaMax: 100, regenPerTick: 2, regenDelayMs: 800, exhaustionMs: 1500, sprintMultiplier: 1.5,
        fastTurnMultiplier: 2, fastTurnDrainPerTick: 2, sprintDrainPerTick: 3, dashCost: 30, dashGapMs: 300, windupCancelCost: 25,
    });
});

test("stamina regenerates only after the 800 ms delay, 2 per tick, capped at the maximum", () => {
    let current = step(bot(), dashAction); // spend 30 on tick 0
    assert.equal(current.stamina, 70);
    assert.equal(current.staminaRegenDelayMs, 800);
    // Eight idle ticks pass with no regeneration...
    for (let tick = 1; tick <= 8; tick += 1) {
        current = step(current);
        assert.equal(current.stamina, 70, `tick ${tick}`);
    }
    assert.equal(current.staminaRegenDelayMs, 0);
    // ...then 20 per second, as 2 per tick.
    current = step(current);
    assert.equal(current.stamina, 72);
    current = step(current);
    assert.equal(current.stamina, 74);
    assert.equal(run(current, idle, 40).stamina, 100);
    // Any spend restarts the delay.
    const respent = step({ ...current, dashGapMs: 0, abilityActiveMs: {} }, dashAction);
    assert.equal(respent.staminaRegenDelayMs, 800);
});

test("exhaustion at 0 stamina blocks regeneration for 1500 ms and never slows the bot", () => {
    // A spend last tick keeps regeneration locked, so 3 stamina is drained straight to 0.
    let current = step(bot({ stamina: 3, staminaRegenDelayMs: 800 }), walk({ sprint: true }));
    assert.equal(current.stamina, 0, "drain is clamped at 0");
    assert.equal(current.exhaustedMs, 1500);
    assert.equal(current.staminaRegenDelayMs, 800);
    for (let tick = 1; tick <= 15; tick += 1) {
        const x = current.x;
        current = step(current, walk());
        assert.equal(current.stamina, 0, `tick ${tick}`);
        assert.equal(current.x - x, WALK_SPEED, "no slowdown while exhausted");
    }
    assert.equal(current.exhaustedMs, 0);
    const before = current.x;
    current = step(current, walk());
    assert.equal(current.stamina, 2, "regeneration resumes once the exhaustion is over");
    assert.equal(current.x - before, WALK_SPEED);
});

test("a dash chain runs until stamina runs out, one dash per 300 ms gap", () => {
    let current = bot();
    const dashTicks = [];
    for (let tick = 0; tick < 20; tick += 1) {
        const next = step({ ...current, dashRemaining: 0 }, dashAction);
        if (next.triggeredAbility === DASH_ABILITY_ID) dashTicks.push(tick);
        current = next;
    }
    assert.deepEqual(dashTicks, [0, 4, 8], "100 -> 70 -> 40 -> 10, then not enough for another");
    assert.equal(abilityReady(current, DASH_ABILITY_ID), false);
});

test("the dash gap and the stamina check are reflected in Ready and Cooldown Left", () => {
    const fresh = bot();
    assert.equal(abilityReady(fresh, DASH_ABILITY_ID), true);
    assert.equal(abilityCooldownMs(fresh, DASH_ABILITY_ID), 0);

    const gapped = { ...fresh, dashGapMs: 200 };
    assert.equal(abilityReady(gapped, DASH_ABILITY_ID), false);
    assert.equal(abilityCooldownMs(gapped, DASH_ABILITY_ID), 200);

    // 20 stamina short with no lockout: 10 regeneration ticks.
    const short = { ...fresh, stamina: 10 };
    assert.equal(abilityReady(short, DASH_ABILITY_ID), false);
    assert.equal(abilityCooldownMs(short, DASH_ABILITY_ID), 1000);
    // A lockout is added on top.
    assert.equal(abilityCooldownMs({ ...short, staminaRegenDelayMs: 500 }, DASH_ABILITY_ID), 1500);
    assert.equal(abilityCooldownMs({ ...short, exhaustedMs: 1500, staminaRegenDelayMs: 800 }, DASH_ABILITY_ID), 2500);
    assert.equal(abilityReady({ ...fresh, stamina: 30 }, DASH_ABILITY_ID), true);
});

test("sprint is x1.5 in every direction and drains 3 stamina per tick", () => {
    let current = step(bot(), walk({ sprint: true }));
    assert.equal(current.x, 200 + WALK_SPEED * 1.5);
    assert.equal(current.stamina, 97);
    assert.equal(current.sprinting, true);
    assert.equal(current.staminaRegenDelayMs, 800);
    current = run(current, walk({ sprint: true }), 9);
    assert.equal(current.stamina, 70);

    // Same speed in any direction, including diagonals and backwards.
    for (const [dx, dy] of [[0, 1], [-1, 0], [1, 1], [-1, -1]]) {
        const moved = step(bot({ x: 600, y: 600 }), { dx, dy, dRot: 0, sprint: true });
        assert.ok(Math.abs(Math.hypot(moved.x - 600, moved.y - 600) - WALK_SPEED * 1.5) < 1e-9, `${dx},${dy}`);
    }
    // Sprint multiplies the speed after status multipliers.
    const slowEffect = {
        statusEffects: [{
            type: "slow", remainingMs: 1000, mode: "duration",
            effects: [{ type: STATUS_EFFECT_APPLICATIONS.MOVEMENT_MODIFIER, movementMultiplier: 0.5, rotationMultiplier: 0.5 }],
        }],
    };
    const slowed = step(bot(slowEffect), walk({ sprint: true }));
    const slowedWalk = step(bot(slowEffect), walk());
    assert.ok(slowedWalk.x - 200 < WALK_SPEED, "the slow applies");
    assert.ok(Math.abs((slowed.x - 200) - (slowedWalk.x - 200) * 1.5) < 1e-9);

    // Without the setting, or when standing still, nothing sprints or drains.
    const plain = step(bot(), walk());
    assert.equal(plain.x, 200 + WALK_SPEED);
    assert.equal(plain.stamina ?? 100, 100);
    assert.equal(step(bot(), { ...idle, sprint: true }).stamina ?? 100, 100);
});

test("sprint stops at 0 stamina and resumes only after the exhaustion", () => {
    let current = bot({ stamina: 5, staminaRegenDelayMs: 800 });
    current = step(current, walk({ sprint: true }));
    assert.equal(current.stamina, 2);
    current = step(current, walk({ sprint: true }));
    assert.equal(current.stamina, 0);
    assert.equal(current.sprinting, true, "this tick still sprinted");
    const x = current.x;
    current = step(current, walk({ sprint: true }));
    assert.equal(current.sprinting, false);
    assert.equal(current.x - x, WALK_SPEED);
});

test("starting, winding up or being active with any ability cancels sprint", () => {
    // Attacking cancels sprint on the same tick: no speed bonus and no drain.
    const attack = step(bot(), { ...slash, dx: 1, sprint: true });
    assert.equal(attack.triggeredAbility, 1);
    assert.equal(attack.x, 200 + WALK_SPEED);
    assert.equal(attack.stamina ?? 100, 100);
    assert.equal(attack.sprinting ?? false, false);
    // It stays off while the ability is active (300 ms for Slash) and resumes afterwards.
    let current = attack;
    for (let tick = 1; tick <= 3; tick += 1) {
        const x = current.x;
        current = step(current, walk({ sprint: true }));
        assert.equal(current.x - x, WALK_SPEED, `active tick ${tick}`);
        assert.equal(current.stamina ?? 100, 100);
    }
    const resumed = step(current, walk({ sprint: true }));
    assert.equal(resumed.x - current.x, WALK_SPEED * 1.5);
    assert.equal(resumed.stamina, 97);

    // A wind-up also cancels it: Sniper winds up for 900 ms.
    const winding = step(bot(), { ...snipe, dx: 1, sprint: true });
    assert.equal(winding.preparingAbility, 3);
    assert.equal(winding.x, 200 + WALK_SPEED);
    const stillWinding = step(winding, walk({ sprint: true }));
    assert.equal(stillWinding.x - winding.x, WALK_SPEED);
    assert.equal(stillWinding.stamina ?? 100, 100);

    // An ability that cannot start (still on cooldown) does not cancel sprint.
    const onCooldown = step(bot({ abilityCooldowns: { 1: 500 } }), { ...slash, dx: 1, sprint: true });
    assert.equal(onCooldown.triggeredAbility, null);
    assert.equal(onCooldown.x, 200 + WALK_SPEED * 1.5);
});

test("Cancel Wind-up clears the wind-up for 25 stamina, with no cooldown or charge, and the ability can restart next tick", () => {
    const winding = step(bot(), snipe);
    assert.equal(winding.preparingAbility, 3);
    assert.equal(winding.preparingMs, 800);

    const cancelled = step(winding, cancel);
    assert.equal(cancelled.preparingAbility, null);
    assert.equal(cancelled.preparingMs, 0);
    assert.equal(cancelled.triggeredAbility, null);
    assert.equal(cancelled.stamina, 75);
    assert.equal(cancelled.staminaRegenDelayMs, 800);
    assert.equal(cancelled.abilityCooldowns?.[3] ?? 0, 0, "no cooldown");
    assert.equal(Object.hasOwn(cancelled, "abilityRelockMs"), false, "no restart lock");
    assert.equal(abilityReady(cancelled, 3), true);

    // One ability action per tick: it did not restart on the cancel tick, but does on the next.
    const restarted = step(cancelled, snipe);
    assert.equal(restarted.preparingAbility, 3);
    assert.equal(restarted.preparingMs, 800);
    assert.equal(restarted.stamina, 75, "starting the wind-up again costs nothing");
});

test("Cancel Wind-up that reaches 0 stamina starts exhaustion", () => {
    const winding = step(bot({ stamina: 25, staminaRegenDelayMs: 800 }), snipe);
    const cancelled = step(winding, cancel);
    assert.equal(cancelled.stamina, 0);
    assert.equal(cancelled.exhaustedMs, 1500);
});

test("Cancel Wind-up does nothing without a wind-up or enough stamina", () => {
    const idleCancel = step(bot(), cancel);
    assert.equal(idleCancel.stamina ?? 100, 100);

    const winding = step(bot({ stamina: 24, staminaRegenDelayMs: 800 }), snipe);
    const refused = step(winding, cancel);
    assert.equal(refused.preparingAbility, 3, "the wind-up continues");
    assert.equal(refused.preparingMs, 700);
    assert.equal(refused.stamina, 24);
});

test("a wind-up already locked in continues even when another action is selected", () => {
    const winding = step(bot(), snipe);
    const continued = step(winding, slash);
    assert.equal(continued.preparingAbility, 3);
    assert.equal(continued.preparingMs, 700);
});

test("Cancel Wind-up is a stable ability-channel action, executable only while it can cancel", () => {
    const action = ACTION_BY_ID.get("cancel_windup");
    assert.equal(action.label, "Cancel: Wind-up");
    assert.equal(action.head, "cancel", "its own channel, not the ability lock");
    assert.equal(actionIdsForLoadoutConfiguration("custom:").includes("cancel_windup"), true);
    assert.match(actionPickerDescription(action), /any root while you're winding up/);

    const configuration = {
        roots: [{ branches: [{ conditions: [{ type: "always" }], actions: [{ action: "cancel_windup" }] }] }],
    };
    const normalized = normalizeAbilityStrategyConfiguration(configuration);
    assert.equal(normalized.roots[0].branches[0].actions[0].action, "cancel_windup");
    // Nothing to cancel: it is not selected at all.
    assert.equal(brainTick(configuration, brainBot()).plan.cancelWindup, undefined);
    // Winding up with stamina: it is.
    const winding = step(brainBot(), snipe);
    const result = brainTick(configuration, winding);
    assert.equal(result.plan.cancelWindup, true);
    assert.equal(result.plan.abilityAction, null, "the ability channel is untouched");
    assert.equal(result.bot.preparingAbility, null);
});

const sniperRoot = { name: "Use Sniper", branches: [{ conditions: [{ type: "always" }], actions: [{ action: 3 }] }] };
const cancelRoot = (extraConditions = []) => ({
    name: "Cancel", branches: [{ conditions: [
        { type: "expression", left: "bot.selectedAbilityPreparing", leftSelectable: "my_bot", selectable: "my_bot", ability: 3, comparator: "eq", right: { type: "boolean", value: true } },
        { type: "expression", left: "bot.selectedAbilityPreparationMs", leftSelectable: "my_bot", selectable: "my_bot", ability: 3, comparator: "lt", right: { type: "number", value: 0.4 } },
        ...extraConditions,
    ], actions: [{ action: "cancel_windup" }] }],
});

function brainBot(extra = {}) {
    // Flat simulation shape, like the one the arena ticks.
    return { ...toSimulationBotShape(resetBotShape(bot({ type: "circle", combatLoadout: "custom:", loadout: { abilities: [3] } }))), id: "main", ...extra };
}

/** One tick through the real path: brain -> planner -> action execution. */
function brainTick(configuration, shape) {
    const plan = buildDeterministicLogicAction({ version: "bot-logic-tree-v2", ...configuration },
        buildStatePayload([shape, opponentShape()], "custom:", "main"));
    return { plan, bot: step(shape, plan) };
}

for (const [title, roots] of [["cancel root second", [sniperRoot, cancelRoot()]], ["cancel root first", [cancelRoot(), sniperRoot]]]) {
    test(`a higher-priority root using the winding-up ability does not block Cancel Wind-up (${title})`, () => {
        const configuration = { roots };
        let current = brainBot();
        let cancelled = null;
        for (let tick = 0; tick < 12 && !cancelled; tick += 1) {
            const result = brainTick(configuration, current);
            if (current.preparingAbility != null && result.bot.preparingAbility == null && result.bot.triggeredAbility == null) cancelled = { before: current, after: result.bot };
            current = result.bot;
        }
        assert.ok(cancelled, "the wind-up was cancelled");
        assert.equal(cancelled.before.preparingMs, 300, "cancels once Prep Time is under 0.4 s");
        assert.equal(cancelled.after.stamina, 75, "spends 25 stamina");
        assert.equal(cancelled.after.abilityCooldowns?.[3] ?? 0, 0, "no cooldown");
    });
}

test("a cancel root that is true while NOT winding up does not block a lower-priority ability", () => {
    const alwaysCancel = { name: "Cancel", branches: [{ conditions: [{ type: "always" }], actions: [{ action: "cancel_windup" }] }] };
    const result = brainTick({ roots: [alwaysCancel, sniperRoot] }, brainBot());
    assert.equal(result.plan.abilityAction.action, 3);
    assert.equal(result.bot.preparingAbility, 3);
    assert.equal(result.bot.stamina ?? 100, 100);
});

test("Cancel Wind-up with less than 25 stamina lets the wind-up continue", () => {
    const configuration = { roots: [sniperRoot, cancelRoot()] };
    let current = brainBot({ stamina: 24, staminaRegenDelayMs: 800 });
    for (let tick = 0; tick < 5; tick += 1) current = brainTick(configuration, current).bot;
    assert.equal(current.preparingAbility, 3, "still winding up");
    assert.equal(current.preparingMs, 400);
    assert.ok(current.stamina <= 24 + 4, "nothing was spent on a cancel");
    assert.equal(abilityReady({ ...current, preparingAbility: null, preparingMs: 0 }, 3), true);
    const done = run(current, { ...idle, abilityAction: { action: 3, targetX: 800, targetY: 400 } }, 4);
    assert.equal(done.triggeredAbility === 3 || done.abilityActiveMs?.[3] > 0, true, "the shot fires");
});

test("Walk carries an optional boolean sprint; brains without it are unchanged", () => {
    const walkBranch = (entry) => ({ roots: [{ branches: [{ conditions: [{ type: "always" }], actions: [{ action: "move_walk", ...entry }] }] }] });
    const entryOf = (entry) => normalizeAbilityStrategyConfiguration(walkBranch(entry)).roots[0].branches[0].actions[0];
    assert.equal(Object.hasOwn(entryOf({}), "sprint"), false);
    assert.equal(Object.hasOwn(entryOf({ sprint: false }), "sprint"), false);
    assert.equal(entryOf({ sprint: true }).sprint, true);
    assert.equal(Object.hasOwn(entryOf({ sprint: "yes" }), "sprint"), false, "boolean only");
    assert.equal(Object.hasOwn(entryOf({ sprint: 1 }), "sprint"), false, "boolean only");

    const snapshot = buildStatePayload([{ ...resetBotShape(bot({ type: "circle" })), id: "main" }, opponentShape()], "custom:", "main");
    const planOf = (entry) => buildDeterministicLogicAction(
        walkBranch({ movementMode: "absolute", movementDirection: 90, ...entry }), snapshot);
    assert.equal(Object.hasOwn(planOf({}), "sprint"), false);
    assert.equal(planOf({ sprint: true }).sprint, true);

    // An old shape with no stamina fields behaves exactly as before and stays untouched.
    const legacy = { ...bot() };
    for (const key of Object.keys(initialMovementState())) delete legacy[key];
    const moved = step(legacy, walk());
    assert.equal(moved.x, 200 + WALK_SPEED);
    for (const key of Object.keys(initialMovementState())) assert.equal(Object.hasOwn(moved, key), false, key);
});

test("resetting a bot restores full stamina and clears timers", () => {
    const spent = step(bot({ stamina: 3, staminaRegenDelayMs: 800 }), walk({ sprint: true }));
    const reset = resetBotShape({ ...spent, type: "circle", combatLoadout: "custom:", loadout: { abilities: [] } });
    assert.equal(reset.stamina, MOVEMENT_CONFIG.staminaMax);
    assert.equal(reset.exhaustedMs, 0);
    assert.equal(reset.staminaRegenDelayMs, 0);
    assert.equal(reset.sprinting, false);
    assert.equal(reset.dashGapMs, 0);
    assert.equal(Object.hasOwn(reset, "abilityRelockMs"), false);
});

test("Stamina, Exhausted and Sprinting read for My Bot and for an opponent", () => {
    for (const id of ["bot.stamina", "bot.exhausted", "bot.sprinting", "bot.fastTurning"]) {
        const variable = STATE_VARIABLE_BY_ID.get(id);
        assert.equal(variable.supportsSelectable, true);
        assert.deepEqual(variable.selectableIdentities, ["bot"]);
        assert.match(variable.description, /\S/);
    }
    assert.equal(STATE_VARIABLE_BY_ID.get("bot.stamina").label, "Stamina");
    assert.equal(STATE_VARIABLE_BY_ID.get("bot.stamina").min, 0);
    assert.equal(STATE_VARIABLE_BY_ID.get("bot.stamina").max, 100);
    assert.equal(STATE_VARIABLE_BY_ID.get("bot.exhausted").label, "Exhausted");
    assert.equal(STATE_VARIABLE_BY_ID.get("bot.sprinting").label, "Sprinting");
    assert.equal(STATE_VARIABLE_BY_ID.get("bot.fastTurning").label, "Turning fast");
    assert.equal(STATE_VARIABLE_BY_ID.get("bot.fastTurning").group, "Rotation");

    const mine = { ...resetBotShape(bot({ type: "circle" })), id: "main", stamina: 64 };
    const theirs = {
        ...resetBotShape(bot({ id: "opponent-model", type: "opponentModel", slot: 2, x: 600 })),
        id: "opponent-model", stamina: 12, exhaustedMs: 700, sprinting: true,
    };
    const state = stateFromPayload(buildStatePayload([mine, theirs], "custom:", "main"));
    const holds = (left, selectable, comparator, right) => evaluateCondition({
        type: "expression", left, leftSelectable: selectable, selectable, comparator, right,
    }, state);
    assert.equal(holds("bot.stamina", "my_bot", "eq", { type: "number", value: 64 }), true);
    assert.equal(holds("bot.stamina", "opponent_1", "eq", { type: "number", value: 12 }), true);
    assert.equal(holds("bot.stamina", "opponent_1", "gt", { type: "number", value: 12 }), false);
    assert.equal(holds("bot.exhausted", "opponent_1", "eq", { type: "boolean", value: true }), true);
    assert.equal(holds("bot.exhausted", "my_bot", "eq", { type: "boolean", value: false }), true);
    assert.equal(holds("bot.sprinting", "opponent_1", "eq", { type: "boolean", value: true }), true);
    assert.equal(holds("bot.sprinting", "my_bot", "eq", { type: "boolean", value: true }), false);
});

test("Cancel and an ability can share one node: Cancel does not use the ability channel", () => {
    const both = { roots: [{ name: "Both", branches: [{ conditions: [{ type: "always" }], actions: [{ action: 3 }, { action: "cancel_windup" }] }] }] };
    const normalized = normalizeAbilityStrategyConfiguration(both).roots[0].branches[0].actions.map((entry) => entry.action);
    assert.deepEqual(normalized, [3, "cancel_windup"]);
    const first = brainTick(both, brainBot());
    assert.equal(first.plan.abilityAction.action, 3, "not winding up: only the ability is planned");
    assert.equal(first.plan.cancelWindup, undefined);
    const second = brainTick(both, first.bot);
    assert.equal(second.plan.cancelWindup, true, "winding up: Cancel runs alongside the still-selected ability");
    assert.equal(second.bot.preparingAbility, null);
    assert.equal(second.bot.stamina, 75);
});

// ---- Fast turn (a Rotate setting; mirrored by MovementStaminaParityTest.java) ----

const turn = (dRot, extra = {}) => ({ dx: 0, dy: 0, dRot, fastTurn: true, ...extra });
const staggered = { statusEffects: [{ type: "hit-stagger", remainingMs: 1000, mode: "duration" }] };

test("fast turn rotates 24 degrees per tick and drains 2 stamina", () => {
    const fast = step(bot(), turn(1));
    assert.equal(fast.rotation, 114);
    assert.equal(fast.stamina, 98);
    assert.equal(fast.fastTurning, true);
    assert.equal(fast.staminaRegenDelayMs, MOVEMENT_CONFIG.regenDelayMs);
    // Without the setting the step is the normal 12 degrees and nothing drains.
    const plain = step(bot(), { ...turn(1), fastTurn: false });
    assert.equal(plain.rotation, 102);
    assert.equal(plain.stamina ?? 100, 100);
    assert.equal(plain.fastTurning ?? false, false);
    // A partial turn scales with the doubled step and negative turns work too.
    assert.equal(step(bot(), turn(-0.5)).rotation, 78);
});

test("fast turn pays nothing on a tick that does not rotate", () => {
    const facing = step(bot(), turn(0));
    assert.equal(facing.rotation, 90);
    assert.equal(facing.stamina ?? 100, 100);
    assert.equal(facing.fastTurning ?? false, false);
    assert.equal(facing.staminaRegenDelayMs ?? 0, 0);
});

test("below 2 stamina or while exhausted the bot turns at normal speed for free", () => {
    for (const low of [bot({ stamina: 1, staminaRegenDelayMs: 800 }), bot({ stamina: 0, exhaustedMs: 1000 })]) {
        const slow = step(low, turn(1));
        assert.equal(slow.rotation, 102);
        assert.equal(slow.stamina, low.stamina);
        assert.equal(slow.fastTurning, false);
    }
    // Exactly 2 stamina still turns fast, and spending it empties the bar into exhaustion.
    const last = step(bot({ stamina: 2, staminaRegenDelayMs: 800 }), turn(1));
    assert.equal(last.rotation, 114);
    assert.equal(last.stamina, 0);
    assert.equal(last.exhaustedMs, MOVEMENT_CONFIG.exhaustionMs);
});

test("fast turn and sprint drain in the same tick", () => {
    const both = step(bot(), walk({ fastTurn: true, sprint: true, dRot: 1 }));
    assert.equal(both.stamina, 100 - MOVEMENT_CONFIG.sprintDrainPerTick - MOVEMENT_CONFIG.fastTurnDrainPerTick);
    assert.equal(both.sprinting, true);
    assert.equal(both.fastTurning, true);
    assert.equal(both.rotation, 114);
    // Attacking ends sprint, not fast turn.
    const attacking = step(bot(), { ...slash, dRot: 1, fastTurn: true });
    assert.equal(attacking.fastTurning, true);
    assert.equal(attacking.rotation, 114);
});

test("the stagger rotation multiplier applies to the fast step", () => {
    const stagger = step(bot(staggered), turn(1));
    assert.ok(Math.abs(stagger.rotation - (90 + 24 * 0.85)) < 1e-9);
    assert.equal(stagger.stamina, 98);
});

test("a stunned bot turns at the normal speed and pays nothing", () => {
    const stunned = step(bot({ statusEffects: [{ type: "stun", remainingMs: 1000, mode: "duration" }] }), turn(1));
    assert.equal(stunned.rotation, 102);
    assert.equal(stunned.stamina ?? 100, 100);
    assert.equal(stunned.fastTurning ?? false, false);
});

test("fast turn is a Rotate setting stored only when on", () => {
    const branch = (action, entry) => ({ roots: [{ branches: [{ conditions: [{ type: "always" }], actions: [{ action, ...entry }] }] }] });
    const entryOf = (action, entry) => normalizeAbilityStrategyConfiguration(branch(action, entry)).roots[0].branches[0].actions[0];
    assert.equal(Object.hasOwn(entryOf("rotate_toward_enemy", {}), "fastTurn"), false);
    assert.equal(Object.hasOwn(entryOf("rotate_toward_enemy", { fastTurn: false }), "fastTurn"), false);
    assert.equal(entryOf("rotate_toward_enemy", { fastTurn: true }).fastTurn, true);
    assert.equal(Object.hasOwn(entryOf("rotate_toward_enemy", { fastTurn: "yes" }), "fastTurn"), false, "boolean only");
    for (const other of ["move_walk", 1, 19]) assert.equal(Object.hasOwn(entryOf(other, { fastTurn: true }), "fastTurn"), false, String(other));
});

test("the planner uses the step the executor will use, so a fast turn never overshoots", () => {
    const rotateToAngle = (angle, fastTurn) => ({
        roots: [{ branches: [{ conditions: [{ type: "always" }], actions: [{ action: "rotate_toward_enemy", targetMode: "angle", targetAngle: angle, ...(fastTurn ? { fastTurn: true } : {}) }] }] }],
    });
    const snapshotOf = (shape) => buildStatePayload([{ ...resetBotShape(bot({ type: "circle" })), id: "main", rotation: shape.rotation, stamina: shape.stamina ?? 100, exhaustedMs: shape.exhaustedMs ?? 0 }, opponentShape()], "custom:", "main");
    const plan = (configuration, shape) => buildDeterministicLogicAction(configuration, snapshotOf(shape));

    // 10 degrees to go: the doubled step covers it in one turn and lands exactly on it.
    const fastPlan = plan(rotateToAngle(100, true), { rotation: 90 });
    assert.equal(fastPlan.fastTurn, true);
    assert.ok(Math.abs(fastPlan.dRot - 10 / 24) < 1e-12);
    const landed = step(bot(), { ...idle, ...fastPlan });
    assert.ok(Math.abs(landed.rotation - 100) < 1e-9, `landed on ${landed.rotation}`);
    assert.ok(Math.abs(plan(rotateToAngle(100, true), { rotation: landed.rotation }).dRot) < 1e-9);

    // Far away the turn clamps to one full (doubled) step.
    assert.equal(plan(rotateToAngle(170, true), { rotation: 90 }).dRot, 1);
    // Low stamina falls back to the normal step in the plan too, so it cannot overshoot either.
    const tired = plan(rotateToAngle(100, true), { rotation: 90, stamina: 1 });
    assert.ok(Math.abs(tired.dRot - 10 / 12) < 1e-12);
    const tiredLanded = step(bot({ stamina: 1, staminaRegenDelayMs: 800 }), { ...idle, ...tired });
    assert.ok(Math.abs(tiredLanded.rotation - 100) < 1e-9);
    // Without the setting nothing changes.
    const normal = plan(rotateToAngle(100, false), { rotation: 90 });
    assert.equal(Object.hasOwn(normal, "fastTurn"), false);
    assert.ok(Math.abs(normal.dRot - 10 / 12) < 1e-12);
});

test("scripted fast turn scenario (the server test replays the same script)", () => {
    let current = bot({ stamina: 7, staminaRegenDelayMs: 800 });
    const trace = [];
    for (const action of [turn(1), walk({ fastTurn: true, sprint: true, dRot: 1 }), turn(1), turn(-0.25)]) {
        current = step(current, action);
        trace.push([current.rotation, current.stamina, current.fastTurning === true]);
    }
    assert.deepEqual(trace, [[114, 5, true], [138, 0, true], [150, 0, false], [147, 0, false]]);
});
