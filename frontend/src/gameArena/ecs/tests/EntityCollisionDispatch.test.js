import assert from "node:assert/strict";
import test from "node:test";
import { withTestAbilities } from "../../../../../shared/engine/ecs/contracts/AbilityContracts.js";
import { encodeBotLoadout } from "../../../../../shared/engine/loadout/BotLoadout.js";
import { normalizeAbilityStrategyConfiguration } from "../../../../../shared/engine/botlogic/code/BotCode.js";
import { GAMEPLAY_DATA } from "../../../../../shared/engine/gameconfig/gameplayData.js";
import { advanceShapes } from "../../testing/fightTick.js";
import { buildInitialArenaShapes } from "../../modelPayloads/arenaShapes.js";

// One collision dispatch (engine gap G1). An entity's collision event runs once per touched target, bots
// and entities alike, from the source's side: the source's geometry decides whether a target is touched, and the source's
// effects reach an HP entity as a queued impact. Each test reads a real fight tick by tick, as AttachedEntities does.
// The main bot faces +x at x 300; the opponent stands at x 360 unless a test places it elsewhere.

const ARC = 27;
const WHIRLWIND = 26;
const DRONE_CAST = 17; // the shipped hunter drone, cast by the opponent
const DRONE_HP = 50;
const CAST_COOLDOWN_MS = 60_000;
const MAIN_Y = 600;
const FIREBALL = 5;
const GRENADE = 4;
const SNARE_BOMB = 29;

const always = () => ({ type: "always" });
/** A brain that casts `abilityId` on the first tick (the opponent's brain may name a later cast, unused here). */
const castBrain = (abilityId) => ({
    roots: [{
        id: `cast-${abilityId}`, name: "Root", priority: 1,
        branches: [{
            id: `cast-${abilityId}-branch`, branchType: "if", priority: 1, conditions: [always()],
            actions: [{ action: abilityId, selectable: "opponent_1" }], children: [],
        }],
    }],
});

/** A test ability: an attached entity cast, or a plain cast that spawns entities. */
function testAbility(id, name, { onActivate, entities = {}, activeMs = 300 }) {
    return {
        id, name, label: name, type: "ability", channel: "ability",
        timing: { cooldownMs: CAST_COOLDOWN_MS, windupMs: 0, activeMs },
        activation: {},
        onActivate,
        entities,
        tier: 2,
    };
}

const spawn = (entity) => ({ do: "spawn", entity });
const rotate = { offset: { x: 0, y: 0 }, rotation: 0, rotationSpace: "owner" };
const attachedEntity = (runtimeType, phases, lifetime = { timerMode: "remaining", duration: 1000 }) => ({
    runtimeType, category: "attached", spawn: rotate, targeting: { owner: "owner" }, lifetime, phases,
});
const follow = { mode: "followOwner" };

/** A shard: a projectile that a cast's collision spawns. Its shape reads as type "shard" in the frame. */
const shard = {
    runtimeType: "shard", category: "projectile", spawn: rotate, targeting: { owner: "owner" },
    lifetime: { timerMode: "remaining", duration: 1500 },
    phases: [{ id: "flying", type: "projectile", movement: { mode: "straight", unitsPerTick: 5 }, hitbox: { shape: "circle", radius: 8 }, visual: { type: "shard", visualSize: 20 } }],
};

/** The fight: the main bot casts `mainAbility`, the opponent casts `opponentAbility` on the first tick (or stands still). */
function playFight({ abilities, mainAbility, opponentAbility = null, opponentX = 360, ticks }) {
    return withTestAbilities(abilities, () => {
        const loadoutOf = (id) => (id == null ? encodeBotLoadout({ abilities: [] }) : encodeBotLoadout({ abilities: [id] }));
        const shapes = buildInitialArenaShapes(null).map((shape) => {
            if (shape.id === "main") {
                return { ...shape, x: 300, y: MAIN_Y, rotation: 90, teamNumber: 1, abilities: [mainAbility], combatLoadout: `custom:${mainAbility}` };
            }
            return { ...shape, x: opponentX, y: MAIN_Y, rotation: 270, abilities: opponentAbility == null ? [] : [opponentAbility], combatLoadout: opponentAbility == null ? undefined : `custom:${opponentAbility}` };
        });
        const options = (brains) => ({
            selectedLoadout: loadoutOf(mainAbility),
            opponentLoadout: loadoutOf(opponentAbility),
            testingConfiguration: normalizeAbilityStrategyConfiguration(brains.main),
            opponentTestingConfiguration: brains.opponent ? normalizeAbilityStrategyConfiguration(brains.opponent) : null,
        });
        const brains = {
            main: castBrain(mainAbility),
            opponent: opponentAbility == null ? null : castBrain(opponentAbility),
        };
        const frames = [];
        let current = shapes;
        for (let tick = 0; tick < ticks; tick += 1) {
            current = advanceShapes(current, options(brains));
            frames.push(current);
        }
        return frames;
    });
}

// Frames are read after the fight's override has ended, so an entity is recognised by its shape: it names its ability and owner.
const isEntity = (shape) => shape.abilityId != null;
const entitiesOf = (frame, abilityId) => frame.filter((shape) => isEntity(shape) && shape.abilityId === abilityId);
const shardsOf = (frame) => frame.filter((shape) => isEntity(shape) && shape.type === "shard").length;
/** The drone's health, tick by tick: undefined once it is gone. */
const droneHp = (frames) => frames.map((frame) => entitiesOf(frame, DRONE_CAST)[0]?.hp);
/** Ticks at which a value fell from the tick before. */
const dropsAt = (values) => values.map((value, index) => (index > 0 && value != null && values[index - 1] != null && value < values[index - 1] ? index : -1))
    .filter((index) => index >= 0);

test("an attached arc that touches a drone damages it and runs its do list", () => {
    const arc = testAbility(ARC, "Test Arc", {
        onActivate: [spawn("arc")],
        entities: {
            arc: attachedEntity("arc", [{
                id: "swing", type: "zone", durationMs: 100, movement: follow,
                hitbox: { shape: "arc", range: 100, arc: 90, includeTargetRadius: true },
                on: {
                    collision: { targets: ["BOT", "HP_ENTITY"], schedule: { mode: "once" }, do: [
                        { do: "applyEffects", effects: [{ type: "damage", amount: 14, targetKinds: ["BOT", "HP_ENTITY"] }] },
                        spawn("shard"),
                    ] },
                    lifetimeEnd: { schedule: { mode: "once" }, do: [{ do: "remove" }] },
                },
            }], { timerMode: "remaining", duration: 300 }),
            shard,
        },
    });
    // The drone is cast at 360, in the arc's reach from the bot at 300.
    const frames = playFight({ abilities: [arc], mainAbility: ARC, opponentAbility: DRONE_CAST, ticks: 4 });
    assert.equal(droneHp(frames).at(-1), DRONE_HP - 14, "the arc's damage reaches the drone");
    assert.ok(frames.some((frame) => shardsOf(frame) >= 1), "the arc's do list runs on the drone hit");
});

test("an attached arc that misses a drone neither damages it nor runs its do list", () => {
    const arc = testAbility(ARC, "Test Arc", {
        onActivate: [spawn("arc")],
        entities: {
            arc: attachedEntity("arc", [{
                id: "swing", type: "zone", durationMs: 100, movement: follow,
                hitbox: { shape: "arc", range: 100, arc: 90, includeTargetRadius: true },
                on: {
                    collision: { targets: ["BOT", "HP_ENTITY"], schedule: { mode: "once" }, do: [
                        { do: "applyEffects", effects: [{ type: "damage", amount: 14, targetKinds: ["BOT", "HP_ENTITY"] }] },
                        spawn("shard"),
                    ] },
                    lifetimeEnd: { schedule: { mode: "once" }, do: [{ do: "remove" }] },
                },
            }], { timerMode: "remaining", duration: 300 }),
            shard,
        },
    });
    // The drone is cast at 700, out of the arc's reach.
    const frames = playFight({ abilities: [arc], mainAbility: ARC, opponentAbility: DRONE_CAST, opponentX: 700, ticks: 4 });
    assert.equal(droneHp(frames).at(-1), DRONE_HP, "the drone is untouched");
    assert.equal(frames.some((frame) => shardsOf(frame) >= 1), false, "the do list does not run");
});

test("a Whirlwind with interval 200 damages a drone every 200 ms, not every tick", () => {
    const whirlwind = testAbility(WHIRLWIND, "Test Whirlwind", {
        onActivate: [spawn("whirlwind")],
        entities: {
            whirlwind: attachedEntity("whirlwind", [{
                id: "spinning", type: "zone", skipOwner: true, movement: follow,
                hitbox: { shape: "circle", radius: 100, includeTargetRadius: true },
                visual: { type: "whirlwind", visualSize: 200 },
                on: { collision: {
                    targets: ["BOT", "HP_ENTITY"], schedule: { mode: "continuous" },
                    targetPolicy: { mode: "interval", intervalMs: 200 },
                    do: [{ do: "applyEffects", effects: [{ type: "damage", amount: 3, targetKinds: ["BOT", "HP_ENTITY"] }] }],
                } },
            }], { timerMode: "remaining", duration: 1500 }),
        },
    });
    const frames = playFight({ abilities: [whirlwind], mainAbility: WHIRLWIND, opponentAbility: DRONE_CAST, ticks: 18 });
    const hp = droneHp(frames);
    const hits = dropsAt(hp);
    assert.ok(hits.length >= 3, `the drone is hit several times, got ${hits.length}`);
    assert.ok(hits.every((tick) => hp[tick - 1] - hp[tick] === 3), "each hit is the whirlwind's 3");
    assert.ok(hits.slice(1).every((tick, index) => tick - hits[index] >= 2), "no two hits within 200 ms");
});

test("a fireball into a Snare Bomb damages it and is removed", () => {
    const abilities = [FIREBALL, SNARE_BOMB].map((id) => structuredClone(GAMEPLAY_DATA.abilities.abilities.find((entry) => entry.id === id)));
    const frames = playFight({ abilities, mainAbility: FIREBALL, opponentAbility: SNARE_BOMB, ticks: 6 });
    const fireballsAt = (frame) => entitiesOf(frame, FIREBALL).length;
    assert.equal(fireballsAt(frames.at(-1)), 0, "the fireball is removed once it hits");
    // The snare bomb has 20 HP and the fireball deals 20: by the time the fireball is gone, the bomb is hurt or destroyed.
    const snareHp = frames.map((frame) => entitiesOf(frame, SNARE_BOMB)[0]?.hp);
    assert.ok(snareHp.some((hp) => hp === undefined || hp < 20), "the fireball damages the snare bomb");
});

test("a grenade that reaches a Snare Bomb still explodes and damages it", () => {
    const abilities = [GRENADE, SNARE_BOMB].map((id) => structuredClone(GAMEPLAY_DATA.abilities.abilities.find((entry) => entry.id === id)));
    const frames = playFight({ abilities, mainAbility: GRENADE, opponentAbility: SNARE_BOMB, ticks: 14 });
    const snareHp = frames.map((frame) => entitiesOf(frame, SNARE_BOMB)[0]?.hp);
    assert.ok(snareHp.some((hp) => hp === undefined || hp < 20), "the explosion damages the snare bomb");
    assert.ok(frames.at(-1).filter((shape) => isEntity(shape) && shape.abilityId === GRENADE).length === 0,
        "the grenade is spent once it has exploded");
});
