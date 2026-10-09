import assert from "node:assert/strict";
import test from "node:test";
import { spawnPlacements } from "../entities/EntityFactory.js";
import { ABILITY_STAGES, abilityRecord } from "../../gameconfig/AbilityState.js";
import { interruptCurrentAbility } from "../../gameconfig/AbilityResourceSystem.js";
import { GAMEPLAY_DATA } from "../../gameconfig/gameplayData.js";
import { withTestAbilities } from "../contracts/AbilityContracts.js";
import { compassDirection, vectorToCompassDegrees } from "../../botlogic/planner/arenaAngles.js";
import { applyBotAction, tickAbilityEntityWorld } from "../../testing/pureTicks.js";

// Mirrors server VerbModelTest; keep both in step. These tests swap real ability IDs for small test
// abilities written in the shared schema, so the whole path runs: trigger, spawn verbs, entity tick.

const baseAbility = (id) => structuredClone(GAMEPLAY_DATA.abilities.abilities.find((entry) => entry.id === id));
const NO_ORIGIN = { offset: { x: 0, y: 0 }, rotation: 0, rotationSpace: "owner" };
const HITBOX = { shape: "circle", radius: 20, range: null, arc: null, width: null, length: null, radiusMultiplier: 1, includeTargetRadius: null };
const MOVEMENT_STATIC = { mode: "static", unitsPerTick: 0, direction: null, turnDegrees: null, size: null };

const phase = (id, extra = {}) => ({
    id,
    type: "zone",
    durationMs: null,
    startMs: null,
    transitionOnly: null,
    skipOwner: null,
    movement: MOVEMENT_STATIC,
    hitbox: HITBOX,
    health: null,
    trigger: null,
    visual: null,
    on: {},
    ...extra,
});

const entity = (runtimeType, phases, extra = {}) => ({
    runtimeType,
    category: "zone",
    spawn: NO_ORIGIN,
    targeting: { owner: "owner", position: null, defaultX: null, defaultY: null, clampToRadius: null },
    lifetime: { timerMode: "none", duration: null, add: null },
    initialState: { armed: true, damageMultiplierFromOwner: false },
    state: null,
    bindToCast: false,
    phases,
    ...extra,
});

const spawn = (name, pattern = null) => ({ do: "spawn", entity: name, pattern });
const event = (verbs) => ({
    targets: ["BOT"],
    schedule: { mode: "once", intervalMs: null, count: null, startImmediately: true },
    targetPolicy: null,
    recheckCollisionOnTransition: true,
    nearestOnly: false,
    waitForHit: false,
    do: verbs,
});

/** Ability `id` keeps its shipped timing and gets these trigger verbs and entities. */
const testAbility = (id, onTrigger, entities) => ({ ...baseAbility(id), onTrigger, entities });

const caster = (abilityId, extra = {}) => ({
    id: "owner", slot: 1, teamNumber: 1, x: 300, y: 300, size: 60, rotation: 90, hp: 150, maxHp: 150,
    moveSpeed: 8, attackSpeedMultiplier: 1, attackDamageMultiplier: 1, abilities: [abilityId], abilityState: {},
    ...extra,
});

/** Casts the ability, ticking through any wind-up, and returns the bot on the tick the ability triggered. */
function cast(bot, abilityId) {
    let next = bot;
    for (let tick = 0; tick < 40; tick += 1) {
        next = applyBotAction(next, { dx: 0, dy: 0, abilityAction: { action: abilityId } }, 100);
        if (next.triggeredAbility != null) return next;
    }
    throw new Error("the ability never triggered");
}

const idle = (bot) => applyBotAction(bot, { dx: 0, dy: 0 }, 100);
const world = (entities, bots) => ({ entities, bots, stepMs: 100, width: 1000, height: 800 });
const headingOf = (shape) => vectorToCompassDegrees(shape.velocityX, shape.velocityY);

test("a fan spawn creates its entities in index order with serials in that order", () => {
    const grenade = baseAbility(4).entities.grenade;
    const fan = testAbility(4, [spawn("grenade", { type: "fan", count: 7, spreadDeg: 40 })], { grenade });
    withTestAbilities([fan], () => {
        const triggered = cast(caster(4), 4);
        const spawned = triggered.abilitySpawn;
        assert.equal(spawned.length, 7);
        assert.deepEqual(spawned.map((shape) => shape.id), [1, 2, 3, 4, 5, 6, 7].map((serial) => `grenade-owner-${serial}`));
        assert.equal(triggered.abilityEntitySerial, 8, "the next serial follows the seventh entity");
        // The owner faces due east (90 degrees); the fan spreads 40 degrees across it.
        const headings = spawned.map(headingOf);
        for (const [index, heading] of headings.entries()) {
            const expected = 90 - 20 + index * 40 / 6;
            assert.ok(Math.abs(heading - expected) < 0.000001, `entity ${index} heads ${heading}, expected ${expected}`);
        }
        assert.ok(spawned.every((shape) => shape.x === spawned[0].x && shape.y === spawned[0].y), "all start at the spawn point");
        assert.deepEqual(Object.keys(triggered.entityActivations).sort(), spawned.map((shape) => shape.id).sort());
    });
});

test("spawn patterns: one entity ahead, a ring, a line", () => {
    assert.deepEqual(spawnPlacements(null), [{ angle: 0, lateral: 0 }]);
    assert.deepEqual(spawnPlacements({ type: "fan", count: 1, spreadDeg: 90 }), [{ angle: 0, lateral: 0 }]);
    assert.deepEqual(spawnPlacements({ type: "ring", count: 4 }).map((placement) => placement.angle), [0, 90, 180, 270]);
    assert.deepEqual(spawnPlacements({ type: "line", count: 3, spacing: 20 }).map((placement) => placement.lateral), [-20, 0, 20]);
    assert.equal(spawnPlacements({ type: "ring", count: 12 }).length, 12);
});

test("a followOwner entity bound to the cast ends when the cast is interrupted", () => {
    const beam = entity("testBeam", [phase("active", { movement: { ...MOVEMENT_STATIC, mode: "followOwner", unitsPerTick: null } })], {
        bindToCast: true,
        spawn: { offset: { x: 0, y: 50 }, rotation: 0, rotationSpace: "owner" },
    });
    withTestAbilities([testAbility(5, [spawn("testBeam")], { testBeam: beam })], () => {
        const triggered = cast(caster(5), 5);
        const [spawned] = triggered.abilitySpawn;
        assert.equal(spawned.bindToCast, true);
        assert.equal(abilityRecord(triggered, 5).stage, ABILITY_STAGES.ACTIVE);

        // Moving and turning the owner carries the entity: it stays 50 units ahead of it.
        const moved = { ...triggered, x: 500, y: 200, rotation: 180 };
        const following = tickAbilityEntityWorld(world([spawned], [moved]));
        assert.equal(following.entities.length, 1);
        const ahead = compassDirection(180);
        assert.ok(Math.abs(following.entities[0].x - (500 + ahead.x * 50)) < 0.000001);
        assert.ok(Math.abs(following.entities[0].y - (200 + ahead.y * 50)) < 0.000001);
        assert.equal(following.entities[0].rotation, 180);

        // An interrupt ends the active stage, and the entity goes with it.
        const interrupted = interruptCurrentAbility(moved);
        assert.notEqual(abilityRecord(interrupted, 5).stage, ABILITY_STAGES.ACTIVE);
        const removed = tickAbilityEntityWorld(world(following.entities, [interrupted]));
        assert.equal(removed.entities.length, 0);
    });
});

test("a bound entity also ends when the active stage runs out", () => {
    const beam = entity("testBeam", [phase("active", { movement: { ...MOVEMENT_STATIC, mode: "followOwner", unitsPerTick: null } })], { bindToCast: true });
    withTestAbilities([testAbility(5, [spawn("testBeam")], { testBeam: beam })], () => {
        let bot = cast(caster(5), 5);
        let entities = bot.abilitySpawn;
        let ticks = 0;
        while (entities.length > 0 && ticks < 40) {
            bot = idle(bot);
            entities = tickAbilityEntityWorld(world(entities, [bot])).entities;
            ticks += 1;
        }
        assert.ok(ticks > 0 && ticks < 40, `the entity lasted ${ticks} ticks`);
        assert.notEqual(abilityRecord(bot, 5).stage, ABILITY_STAGES.ACTIVE);
    });
});

test("an entity that is not bound outlives an interrupted cast", () => {
    const orb = entity("testOrb", [phase("active")]);
    withTestAbilities([testAbility(5, [spawn("testOrb")], { testOrb: orb })], () => {
        const triggered = cast(caster(5), 5);
        const interrupted = interruptCurrentAbility(triggered);
        const next = tickAbilityEntityWorld(world(triggered.abilitySpawn, [interrupted]));
        assert.equal(next.entities.length, 1);
    });
});

test("a spawn verb inside an entity event creates its entity from the parent's pose", () => {
    const parent = entity("testParent", [phase("active", {
        durationMs: 200,
        on: { lifetimeEnd: event([spawn("child", { type: "ring", count: 3 }), { do: "remove" }]) },
    })]);
    const child = entity("testChild", [phase("active")]);
    withTestAbilities([testAbility(5, [spawn("parent")], { parent, child })], () => {
        const triggered = cast(caster(5), 5);
        const [spawned] = triggered.abilitySpawn;
        const placed = { ...spawned, x: 400, y: 250 };
        let result = tickAbilityEntityWorld(world([placed], [triggered]));
        assert.equal(result.entities.length, 1, "the parent is still alive");
        result = tickAbilityEntityWorld(world(result.entities, result.bots));
        assert.equal(result.entities.length, 3, "the parent ended and left its three children");
        assert.ok(result.entities.every((shape) => shape.type === "testChild" && shape.x === 400 && shape.y === 250));
        assert.deepEqual(result.entities.map((shape) => shape.id),
            [2, 3, 4].map((serial) => `testChild-owner-${serial}`), "serials continue after the parent's");
        assert.equal(result.bots[0].abilityEntitySerial, 5);
        assert.ok(result.entities.every((shape) => result.bots[0].entityActivations[shape.id] != null));
    });
});
