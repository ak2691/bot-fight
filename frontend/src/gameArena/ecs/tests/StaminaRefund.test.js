import assert from "node:assert/strict";
import test from "node:test";
import { MOVEMENT_CONFIG, MOVEMENT_TICK_MS } from "../../gameconfig/MovementConfig.js";
import { initialMovementState } from "../../gameconfig/StaminaSystem.js";
import { recordAbilityHit, settleAbilityHits } from "../../gameconfig/AbilityHitRecord.js";
import { advanceShapes as advanceArenaPreviewTickNormalized } from "../../testing/fightTick.js";
import { buildInitialArenaShapes } from "../../modelPayloads/arenaShapes.js";
import { normalizeAbilityStrategyConfiguration } from "../../botlogic/code/BotCode.js";
import { normalizeAbilityStrategyConfiguration as normalizeBrainForTick } from "../../botlogic/code/BotCode.js";
import { applyBotAction } from "../../testing/pureTicks.js";

// The tick takes normalized brains; tests pass raw ones, so normalize here like the edge does.
const normalizeOrNull = (configuration) => (configuration ? normalizeBrainForTick(configuration) : configuration);
const advanceArenaPreviewTick = (shapes, options) => advanceArenaPreviewTickNormalized(shapes, {
    ...options,
    testingConfiguration: normalizeOrNull(options.testingConfiguration),
    opponentTestingConfiguration: normalizeOrNull(options.opponentTestingConfiguration),
});

const DASH_ABILITY_ID = 19;

// Mirrors the server's StaminaRefundTest; keep the scenarios and numbers in step.
const SLASH = 1;
const FIREBALL = 5;
const MAIN_Y = 600;
const PAUSED = 100_000;

const idle = { dx: 0, dy: 0, dRot: 0 };
const dashAction = { dx: 0, dy: 0, dRot: 0, abilityAction: { action: DASH_ABILITY_ID, targetX: 900, targetY: 400 } };

function bot(extra = {}) {
    return {
        id: "main", slot: 1, x: 200, y: 400, size: 60, rotation: 90, hp: 100, maxHp: 100,
        moveSpeed: 15, attackSpeedMultiplier: 1, movementVelocityX: 0, movementVelocityY: 0,
        abilities: [1, 3, 19], abilityState: {}, ...initialMovementState(),
        ...extra,
    };
}

const step = (shape, action = idle, hit = null) => {
    let next = applyBotAction(shape, action, MOVEMENT_TICK_MS);
    if (hit) next = recordAbilityHit(next, hit.abilityId, hit.activationSerial);
    return settleAbilityHits(next, MOVEMENT_TICK_MS);
};

test("hitStaminaRefund is 10 and the regen pause is 500 ms", () => {
    assert.equal(MOVEMENT_CONFIG.hitStaminaRefund, 10);
    assert.equal(MOVEMENT_CONFIG.regenDelayMs, 500);
    assert.equal(Object.hasOwn(MOVEMENT_CONFIG, "exhaustionMs"), false);
});

test("regen resumes exactly five idle ticks after the last spend", () => {
    let current = step(bot(), dashAction);
    assert.equal(current.stamina, 70);
    const trace = [];
    for (let tick = 1; tick <= 7; tick += 1) {
        current = step(current);
        trace.push(current.stamina);
    }
    assert.deepEqual(trace, [70, 70, 70, 70, 70, 72, 74]);
});

test("at 0 stamina the bot cannot dash, sprint or fast turn, and recovers after the pause", () => {
    const empty = bot({ stamina: 0, staminaRegenDelayMs: 500 });
    const dashed = step(empty, dashAction);
    assert.notEqual(dashed.triggeredAbility, DASH_ABILITY_ID, "no dash at 0");
    const sprinted = step(empty, { dx: 1, dy: 0, dRot: 0, sprint: true });
    assert.equal(sprinted.sprinting, false);
    assert.equal(sprinted.x - empty.x, 15, "walks at the normal speed");
    const turned = step(empty, { dx: 0, dy: 0, dRot: 1, fastTurn: true });
    assert.equal(turned.fastTurning, false);
    assert.equal(turned.rotation, 102, "turns at the normal step");

    let current = empty;
    for (let tick = 0; tick < 5; tick += 1) current = step(current);
    assert.equal(current.stamina, 0, "still paused");
    current = step(current);
    assert.equal(current.stamina, 2, "recovery starts after the pause");
    // 30 stamina is 15 more regeneration ticks away; then dash works again.
    current = step(current, idle);
    for (let tick = 0; tick < 13; tick += 1) current = step(current);
    assert.equal(current.stamina, 30);
    assert.equal(step(current, dashAction).triggeredAbility, DASH_ABILITY_ID);
});

test("a hit refunds 10 stamina once per activation, capped at the maximum", () => {
    const hit = { abilityId: SLASH, activationSerial: 1 };
    const refunded = step(bot({ stamina: 50, staminaRegenDelayMs: PAUSED }), idle, hit);
    assert.equal(refunded.stamina, 60);
    // The same activation landing again (multi-hit, piercing, a second target) pays nothing more.
    const again = step(refunded, idle, hit);
    assert.equal(again.stamina, 60);
    // A new activation pays again.
    assert.equal(step(again, idle, { abilityId: SLASH, activationSerial: 2 }).stamina, 70);
    // Two activations landing in one tick both pay.
    let twice = recordAbilityHit(bot({ stamina: 20, staminaRegenDelayMs: PAUSED }), SLASH, 1);
    twice = recordAbilityHit(twice, FIREBALL, 2);
    assert.equal(settleAbilityHits(twice, MOVEMENT_TICK_MS).stamina, 40);
    // Capped at the maximum.
    assert.equal(step(bot({ stamina: 95, staminaRegenDelayMs: PAUSED }), idle, hit).stamina, 100);
    assert.equal(step(bot({ stamina: 100 }), idle, hit).stamina, 100);
});

test("a refund during the pause does not change when regeneration resumes", () => {
    const hit = { abilityId: SLASH, activationSerial: 1 };
    let plain = bot({ stamina: 40, staminaRegenDelayMs: 300 });
    let helped = plain;
    const delays = [];
    const gains = [];
    for (let tick = 1; tick <= 6; tick += 1) {
        plain = step(plain);
        helped = step(helped, idle, tick === 2 ? hit : null);
        delays.push([plain.staminaRegenDelayMs, helped.staminaRegenDelayMs]);
        gains.push(helped.stamina - plain.stamina);
    }
    for (const [without, withRefund] of delays) assert.equal(withRefund, without);
    assert.deepEqual(gains, [0, 10, 10, 10, 10, 10], "the +10 arrives at once, regeneration resumes on the same tick as without it");
    assert.equal(plain.stamina, 46);
    assert.equal(helped.stamina, 56);
});

function arena({ ability, defenderX }) {
    const loadout = `custom:${ability}`;
    const shapes = buildInitialArenaShapes(null).map((shape) => {
        const placed = shape.id === "main"
            ? { ...shape, x: 300, y: MAIN_Y, rotation: 90, teamNumber: 1 }
            : { ...shape, x: defenderX, y: MAIN_Y, rotation: 270 };
        return { ...placed, abilities: [ability], combatLoadout: loadout, ...(shape.id === "main" ? { stamina: 40, staminaRegenDelayMs: PAUSED } : {}) };
    });
    return { shapes, loadout };
}

const castAbility = (ability) => ({ priority: 1, branches: [{ priority: 1, branchType: "if", conditions: [{ type: "always" }], actions: [{ action: ability, selectable: "opponent_1" }], children: [] }] });

function mainStaminaTrace({ shapes, loadout }, ability, ticks) {
    let current = shapes;
    const trace = [];
    for (let tick = 0; tick < ticks; tick += 1) {
        current = advanceArenaPreviewTick(current, {
            selectedLoadout: loadout, opponentLoadout: loadout,
            testingConfiguration: { roots: [castAbility(ability)] }, opponentTestingConfiguration: null,
        });
        const main = current.find((shape) => shape.id === "main");
        const defender = current.find((shape) => shape.id === "opponent-model");
        trace.push({ stamina: main.stamina, delay: main.staminaRegenDelayMs, hp: defender.hp });
    }
    return trace;
}

test("a Slash hit in the arena refunds 10 once and never touches the pause", () => {
    const trace = mainStaminaTrace(arena({ ability: SLASH, defenderX: 380 }), SLASH, 4);
    const hitTick = trace.findIndex((entry) => entry.hp < 300);
    assert.ok(hitTick >= 0, "Slash lands");
    assert.equal(trace[hitTick].stamina, 50);
    assert.equal(trace.at(-1).stamina, 50, "the swing does not pay twice");
    assert.deepEqual(trace.map((entry) => PAUSED - entry.delay), [100, 200, 300, 400], "the pause just keeps counting down");
});

test("a Fireball pays once for the activation that spawned it, burn ticks pay nothing", () => {
    const trace = mainStaminaTrace(arena({ ability: FIREBALL, defenderX: 800 }), FIREBALL, 40);
    const impact = trace.findIndex((entry) => entry.hp < 300);
    assert.ok(impact > 1, "the projectile takes time to arrive");
    assert.equal(trace[impact - 1].stamina, 40);
    assert.equal(trace[impact].stamina, 50);
    const burned = trace.findLastIndex((entry) => entry.hp < trace[impact].hp);
    assert.ok(burned > impact, "the burn keeps damaging after the impact");
    for (let tick = impact; tick < trace.length; tick += 1) assert.equal(trace[tick].stamina, 50, `tick ${tick}`);
});

test("an old Exhausted condition migrates to a Stamina threshold", () => {
    const condition = (comparator, value) => ({ type: "expression", left: "bot.exhausted", leftSelectable: "my_bot", comparator, right: { type: "boolean", value } });
    const brain = (conditions) => ({ roots: [{ name: "Old", branches: [{ conditions, actions: [{ action: "move_walk" }] }] }] });
    const migrated = (conditions) => normalizeAbilityStrategyConfiguration(brain(conditions)).roots[0].branches[0].conditions;

    const [isTrue, isFalse, notTrue] = migrated([condition("eq", true), condition("eq", false), condition("neq", true)]);
    assert.deepEqual([isTrue.left, isTrue.comparator, isTrue.right], ["bot.stamina", "lt", { type: "number", value: 1 }]);
    assert.deepEqual([isFalse.left, isFalse.comparator, isFalse.right], ["bot.stamina", "gte", { type: "number", value: 1 }]);
    assert.deepEqual([notTrue.left, notTrue.comparator], ["bot.stamina", "gte"]);
    assert.equal(isTrue.leftSelectable, "my_bot");
});

test("parity trace: dash, idle, hit, idle, dash", () => {
    let current = bot();
    const trace = [];
    const script = [
        [dashAction, null],
        [idle, null],
        [idle, { abilityId: SLASH, activationSerial: 7 }],
        [idle, null],
        [dashAction, null],
    ];
    for (const [action, hit] of script) {
        current = step(current, action, hit);
        trace.push([current.stamina, current.staminaRegenDelayMs, `${current.abilityState[DASH_ABILITY_ID].stage}:${current.abilityState[DASH_ABILITY_ID].remainingMs}`]);
    }
    assert.deepEqual(trace, [[70, 500, "active:200"], [70, 400, "active:100"], [80, 300, "cooldown:100"], [80, 200, "ready:0"], [50, 500, "active:200"]]);
});
