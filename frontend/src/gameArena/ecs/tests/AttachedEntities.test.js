import assert from "node:assert/strict";
import test from "node:test";
import { withTestAbilities } from "../../../../../shared/engine/ecs/contracts/AbilityContracts.js";
import { selectableIdentitiesForAbilityEntity } from "../../../../../shared/engine/modelPayloads/selectableIdentities.js";
import { buildStatePayload } from "../../../../../shared/engine/modelPayloads/strategyStatePayload.js";
import { encodeBotLoadout } from "../../../../../shared/engine/loadout/BotLoadout.js";
import { normalizeAbilityStrategyConfiguration } from "../../../../../shared/engine/botlogic/code/BotCode.js";
import { advanceShapes } from "../../testing/fightTick.js";
import { buildInitialArenaShapes } from "../../modelPayloads/arenaShapes.js";
import { BASE_BOT_HP } from "../../../../../shared/engine/modelPayloads/arenaConstants.js";

// Attached entities (docs/ABILITIES.md, "Attached entities"). Each test defines the primer's example as a test ability,
// casts it with a brain, and reads the arena frame tick by tick. The brain's actions resolve through the shipped
// ability ids, so a test ability replaces a shipped one (withTestAbilities) for the length of its fight.
// The main bot faces +x at x 300; the opponent stands in front of it unless a test places it elsewhere.

// The shipped timing table (windup, cooldown, active time) applies to a replaced id, so each test ability takes a shipped
// id with no windup, no charges and a long cooldown: a cast starts on the first tick and does not come round again.
const WHIRLWIND = 17;
const COMBO = 26;
const SHATTER = 27;
const LUNGE = 29;
const BEAM = 32;
const VOLLEY = 30;
const HAMMER = 8;
const STUN = 5;
const PROBE = 21;

const MAIN_Y = 600;
const CAST_COOLDOWN_MS = 60_000;

const always = () => ({ type: "always" });
const afterSeconds = (seconds) => ({
    type: "expression", left: "match.elapsedSeconds", comparator: "gte", right: { type: "number", value: seconds },
});
/** A brain that casts `abilityId` on the first tick from `seconds` into the fight (at once when 0). */
const castBrain = (abilityId, seconds = 0) => ({
    roots: [{
        id: `cast-${abilityId}`, name: "Root", priority: 1,
        branches: [{
            id: `cast-${abilityId}-branch`, branchType: "if", priority: 1, conditions: [seconds > 0 ? afterSeconds(seconds) : always()],
            actions: [{ action: abilityId, selectable: "opponent_1" }], children: [],
        }],
    }],
});

/** A test ability: an attached entity cast, or an opponent's hit, with the given entities. */
function testAbility(id, name, { onActivate, entities = {}, windupMs = 0, activeMs = 300 }) {
    return {
        id, name, label: name, type: "ability", channel: "ability",
        timing: { cooldownMs: CAST_COOLDOWN_MS, windupMs, activeMs },
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

/** The fight: the main bot casts `mainAbility`, the opponent casts `opponentAbility` (or stands still). */
function playFight({ abilities, mainAbility, opponentAbility = null, opponentX = 360, opponentAfter = 0, ticks }) {
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
            opponent: opponentAbility == null ? null : castBrain(opponentAbility, opponentAfter),
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
const botIn = (frame, id) => frame.find((shape) => shape.id === id);
const opponentOf = (frame) => botIn(frame, "opponent-model");
const mainOf = (frame) => botIn(frame, "main");
const entitiesOf = (frame, abilityId) => frame.filter((shape) => isEntity(shape) && shape.abilityId === abilityId);
/** The first tick (index) on which the main bot is stunned, or -1. */
const stunnedTick = (frames) => frames.findIndex((frame) => (mainOf(frame).statusEffects ?? []).some((status) => status.type === "stun"));
/** The opponent's health, tick by tick. */
const opponentHp = (frames) => frames.map((frame) => opponentOf(frame).hp);
/** The health the fight starts from: the opponent's HP before any tick, and the health drops from there, tick by tick. */
const startHp = BASE_BOT_HP;

/** The opponent's stun: a hit that stuns the main bot for a second. The opponent's brain decides when it casts. */
const stunAbility = () => testAbility(STUN, "Test Stun", {
    onActivate: [{
        do: "hit",
        hitbox: { shape: "circle", radius: 300, includeTargetRadius: true },
        targets: ["BOT"],
        effects: [{ type: "status", subtype: "stun", durationMs: 1000, targetKinds: ["BOT"] }],
    }],
});

test("Whirlwind hits everything near the bot at most every 200 ms, and ends when the bot is stunned", () => {
    const whirlwind = testAbility(WHIRLWIND, "Test Whirlwind", {
        activeMs: 300,
        onActivate: [spawn("whirlwind")],
        entities: {
            whirlwind: attachedEntity("whirlwind", [{
                id: "spinning", type: "zone", skipOwner: true, movement: follow,
                hitbox: { shape: "circle", radius: 100, includeTargetRadius: true },
                visual: { type: "whirlwind", visualSize: 200 },
                on: { collision: {
                    targets: ["BOT"], schedule: { mode: "continuous" },
                    targetPolicy: { mode: "interval", intervalMs: 200 },
                    do: [{ do: "applyEffects", effects: [{ type: "damage", amount: 3, targetKinds: ["BOT"] }] }],
                } },
            }], { timerMode: "remaining", duration: 1500 }),
        },
    });
    const frames = playFight({ abilities: [whirlwind, stunAbility()], mainAbility: WHIRLWIND, opponentAbility: STUN, opponentAfter: 1, ticks: 25 });
    const stun = stunnedTick(frames);
    assert.ok(stun > 0, "the stun lands");
    assert.equal(entitiesOf(frames[stun - 1], WHIRLWIND).length, 1, "the whirlwind spins before the stun");
    assert.equal(entitiesOf(frames[stun], WHIRLWIND).length, 0, "the stun removes the whirlwind on its tick");

    const hp = [startHp, ...opponentHp(frames)];
    const drops = hp.slice(1).map((value, index) => hp[index] - value);
    const hitTicks = drops.map((drop, index) => (drop > 0 ? index : -1)).filter((tick) => tick >= 0);
    assert.ok(hitTicks.filter((tick) => tick < stun).length >= 3, "several hits before the stun");
    assert.ok(drops.filter((drop) => drop > 0).every((drop) => drop === 3), "each hit is the whirlwind's 3");
    assert.ok(hitTicks.slice(1).every((tick, index) => tick - hitTicks[index] >= 2), "no two hits within 200 ms");
    assert.equal(opponentOf(frames.at(-1)).hp, hp.at(-1), "no hits after the stun");
});

test("a three-cut combo lands each cut, and a stun cancels the cuts still to come", () => {
    const cut = (id, next, extra = []) => ({
        id, type: "zone", durationMs: 200, movement: follow,
        hitbox: { shape: "arc", range: 90, arc: 100, includeTargetRadius: true },
        visual: { type: "meleeSlash", visualSize: 180 },
        on: {
            collision: { targets: ["BOT"], schedule: { mode: "once" },
                do: [{ do: "applyEffects", effects: [{ type: "damage", amount: 5, targetKinds: ["BOT"] }, ...extra] }] },
            ...(next ? { lifetimeEnd: { schedule: { mode: "once" }, do: [{ do: "transition", to: next }] } } : {}),
        },
    });
    const combo = testAbility(COMBO, "Test Combo", {
        onActivate: [spawn("combo")],
        entities: {
            combo: attachedEntity("combo", [
                cut("cut1", "cut2"),
                cut("cut2", "cut3"),
                cut("cut3", null, [{ type: "displace", who: "target", from: "source", direction: "away", distance: 80, targetKinds: ["BOT"] }]),
            ], { timerMode: "remaining", duration: 600 }),
        },
    });
    const free = playFight({ abilities: [combo], mainAbility: COMBO, ticks: 12 });
    const total = startHp - opponentOf(free.at(-1)).hp;
    assert.equal(total, 15, "three cuts of 5 each land on the same bot");
    assert.equal(entitiesOf(free.at(-1), COMBO).length, 0, "the combo ends after its last cut");

    const stunned = playFight({ abilities: [combo, stunAbility()], mainAbility: COMBO, opponentAbility: STUN, opponentAfter: 0.3, ticks: 12 });
    const stun = stunnedTick(stunned);
    assert.ok(stun > 0, "the stun lands");
    assert.equal(entitiesOf(stunned[stun], COMBO).length, 0, "the stun ends the combo");
    const stoppedAt = opponentHp(stunned)[stun];
    assert.equal(opponentOf(stunned.at(-1)).hp, stoppedAt, "the cuts after the stun never land");
    assert.ok(opponentOf(stunned.at(-1)).hp > opponentOf(free.at(-1)).hp, "the cuts before the stun stay dealt");
});

test("a shatter bursts into shards only when the swing hits, and the shards survive a stun", () => {
    const shard = {
        runtimeType: "shard", category: "projectile", spawn: rotate, targeting: { owner: "owner" },
        lifetime: { timerMode: "remaining", duration: 1500 },
        phases: [{ id: "flying", type: "projectile", movement: { mode: "straight", unitsPerTick: 5 }, hitbox: { shape: "circle", radius: 8 }, visual: { type: "shard", visualSize: 20 } }],
    };
    const shatter = testAbility(SHATTER, "Test Shatter", {
        onActivate: [spawn("swing")],
        entities: {
            swing: attachedEntity("swing", [{
                id: "swing", type: "zone", durationMs: 100, movement: follow,
                hitbox: { shape: "arc", range: 100, arc: 90, includeTargetRadius: true },
                on: {
                    collision: { targets: ["BOT"], schedule: { mode: "once" }, nearestOnly: true, do: [
                        { do: "applyEffects", effects: [{ type: "damage", amount: 14, targetKinds: ["BOT"] }] },
                        { do: "spawn", entity: "shard", pattern: { type: "fan", count: 3, spreadDeg: 40 } },
                        { do: "remove" },
                    ] },
                    lifetimeEnd: { schedule: { mode: "once" }, do: [{ do: "remove" }] },
                },
            }], { timerMode: "remaining", duration: 300 }),
            shard,
        },
    });
    const miss = playFight({ abilities: [shatter], mainAbility: SHATTER, opponentX: 700, ticks: 4 });
    assert.equal(entitiesOf(miss.at(-1), SHATTER).length, 0, "the swing ends");
    assert.equal(miss.at(-1).filter((shape) => isEntity(shape) && shape.type === "shard").length, 0, "a miss makes no shards");

    const hit = playFight({ abilities: [shatter, stunAbility()], mainAbility: SHATTER, opponentAbility: STUN, opponentAfter: 0.3, ticks: 8 });
    const shardsAt = (frame) => frame.filter((shape) => isEntity(shape) && shape.type === "shard").length;
    const burst = hit.findIndex((frame) => shardsAt(frame) === 3);
    assert.ok(burst >= 0, "a hit bursts into three shards");
    const stun = stunnedTick(hit);
    assert.ok(stun > burst, "the stun comes after the burst");
    assert.equal(shardsAt(hit[stun]), 3, "the stun leaves the shards in the air");
});

test("a lunge moves the bot, and its stab hits from where the bot landed", () => {
    const lunge = testAbility(LUNGE, "Test Lunge", {
        onActivate: [spawn("lunge")],
        entities: {
            lunge: attachedEntity("lunge", [
                { id: "crouch", type: "zone", durationMs: 200, movement: follow,
                    on: { lifetimeEnd: { schedule: { mode: "once" }, do: [
                        { do: "move", distance: 150, unitsPerTick: 150 },
                        { do: "transition", to: "stab" },
                    ] } } },
                { id: "stab", type: "zone", durationMs: 100, movement: follow,
                    hitbox: { shape: "rectangle", length: 120, width: 40, includeTargetRadius: true },
                    on: { collision: { targets: ["BOT"], schedule: { mode: "once" },
                        do: [{ do: "applyEffects", effects: [{ type: "damage", amount: 18, targetKinds: ["BOT"] }] }] } } },
            ], { timerMode: "remaining", duration: 400 }),
        },
    });
    // The opponent stands 210 ahead: out of reach of a stab from the bot's start (its box reaches 150), in reach from where it lands.
    const frames = playFight({ abilities: [lunge], mainAbility: LUNGE, opponentX: 510, ticks: 8 });
    const landed = mainOf(frames.at(-1)).x;
    assert.ok(Math.abs(landed - 450) < 1, `the bot leaps 150 units toward its target, got ${landed}`);
    assert.equal(opponentOf(frames.at(-1)).hp, startHp - 18, "the stab lands once, from the new position");
});

test("a beam fires five pulses, one every 100 ms, and a bot in it takes all five", () => {
    const beam = testAbility(BEAM, "Test Beam", {
        onActivate: [spawn("beam")],
        entities: {
            beam: attachedEntity("beam", [{
                id: "firing", type: "zone", movement: follow,
                visual: { type: "beam", visualSize: 10 },
                on: { schedule: {
                    schedule: { mode: "repeat", intervalMs: 100, count: 5, startImmediately: true },
                    do: [{ do: "hit", hitbox: { shape: "ray", range: 400, width: 10 }, targets: ["BOT"],
                        effects: [{ type: "damage", amount: 3, targetKinds: ["BOT"] }] }],
                } },
            }], { timerMode: "remaining", duration: 800 }),
        },
    });
    const frames = playFight({ abilities: [beam], mainAbility: BEAM, ticks: 10 });
    const hp = [startHp, ...opponentHp(frames)];
    assert.equal(startHp - hp[6], 15, "five pulses of 3");
    const pulses = hp.slice(1).filter((value, index) => value < hp[index]).length;
    assert.equal(pulses, 5, "the damage comes in five separate pulses");
});

test("a volley spawns three shots, one every 200 ms", () => {
    const bolt = {
        runtimeType: "bolt", category: "projectile", spawn: rotate, targeting: { owner: "owner" },
        lifetime: { timerMode: "remaining", duration: 1000 },
        phases: [{ id: "flying", type: "projectile", movement: { mode: "straight", unitsPerTick: 20 }, hitbox: { shape: "circle", radius: 8 } }],
    };
    const volley = testAbility(VOLLEY, "Test Volley", {
        onActivate: [spawn("volley")],
        entities: {
            volley: attachedEntity("volley", [{
                id: "shooting", type: "zone", movement: follow,
                on: { schedule: {
                    schedule: { mode: "repeat", intervalMs: 200, count: 3, startImmediately: true },
                    do: [spawn("bolt")],
                } },
            }], { timerMode: "remaining", duration: 800 }),
            bolt,
        },
    });
    const frames = playFight({ abilities: [volley], mainAbility: VOLLEY, ticks: 8 });
    const bolts = (frame) => frame.filter((shape) => isEntity(shape) && shape.type === "bolt").length;
    assert.equal(bolts(frames.at(-1)), 3, "three shots fly");
    const shots = frames.map(bolts);
    assert.ok(shots.includes(1) && shots.includes(2), "the shots come one after another, not all at once");
});

test("a lingering hammer's head and wave share the cast's memory, so the bot is hit once", () => {
    const hammerPart = (runtimeType, shape, radius, amount) => attachedEntity(runtimeType, [{
        id: runtimeType, type: "zone", movement: follow,
        hitbox: shape === "circle" ? { shape, radius, includeTargetRadius: true } : { shape, length: 100, width: 60, includeTargetRadius: true },
        on: { collision: {
            targets: ["BOT"], schedule: { mode: "continuous" },
            targetPolicy: { mode: "once", scope: "activation" },
            do: [{ do: "applyEffects", effects: [{ type: "damage", amount, targetKinds: ["BOT"] }] }],
        } },
    }], { timerMode: "remaining", duration: 300 });
    const hammer = testAbility(HAMMER, "Test Hammer", {
        onActivate: [spawn("head"), spawn("wave")],
        entities: {
            head: hammerPart("head", "rectangle", 0, 12),
            wave: hammerPart("wave", "circle", 100, 6),
        },
    });
    const frames = playFight({ abilities: [hammer], mainAbility: HAMMER, ticks: 6 });
    assert.equal(startHp - opponentOf(frames.at(-1)).hp, 12, "the head's blow is the only one: the wave skips the bot the head hit");
});

test("a brain cannot select an attached entity", () => {
    const whirlwind = testAbility(WHIRLWIND, "Test Whirlwind", {
        onActivate: [spawn("whirlwind")],
        entities: { whirlwind: attachedEntity("whirlwind", [{ id: "spinning", type: "zone", movement: follow }]) },
    });
    const frames = playFight({ abilities: [whirlwind], mainAbility: WHIRLWIND, ticks: 2 });
    const spun = frames.at(-1).find((shape) => isEntity(shape) && shape.abilityId === WHIRLWIND);
    assert.ok(spun, "the whirlwind exists");
    assert.deepEqual([...selectableIdentitiesForAbilityEntity(spun)], [], "it has no selectable identities");
    const payload = withTestAbilities([whirlwind], () => buildStatePayload(frames.at(-1), encodeBotLoadout({ abilities: [WHIRLWIND] }), "main"));
    assert.equal(payload.objects.some((object) => object.abilityId === WHIRLWIND), false, "the brain's list leaves it out");
});

test("an enemy hit cannot touch an attached entity", () => {
    const whirlwind = testAbility(WHIRLWIND, "Test Whirlwind", {
        onActivate: [spawn("whirlwind")],
        entities: { whirlwind: attachedEntity("whirlwind", [{
            id: "spinning", type: "zone", movement: follow,
            hitbox: { shape: "circle", radius: 100, includeTargetRadius: true },
        }], { timerMode: "remaining", duration: 1500 }) },
    });
    const probe = testAbility(PROBE, "Test Probe", {
        onActivate: [{
            do: "hit",
            hitbox: { shape: "circle", radius: 300, includeTargetRadius: true },
            targets: ["BOT", "HP_ENTITY", "ENTITY"],
            effects: [{ type: "damage", amount: 40, targetKinds: ["BOT", "HP_ENTITY", "ENTITY"] }],
        }],
    });
    const frames = playFight({ abilities: [whirlwind, probe], mainAbility: WHIRLWIND, opponentAbility: PROBE, ticks: 6 });
    const spun = frames.at(-1).find((shape) => isEntity(shape) && shape.abilityId === WHIRLWIND);
    assert.ok(spun, "the enemy's hit does not remove the whirlwind");
    assert.equal(spun.hp ?? null, null, "it has no health to take damage");
    assert.equal(mainOf(frames.at(-1)).hp, startHp - 40, "the probe hits the bot in its circle, and only that");
});
