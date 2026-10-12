import assert from "node:assert/strict";
import test from "node:test";
import { GAMEPLAY_DATA } from "../../../../../shared/engine/gameconfig/gameplayData.js";
import { withTestAbilities } from "../../../../../shared/engine/ecs/contracts/AbilityContracts.js";
import { applyBotAction, tickAbilityEntityWorld } from "../../testing/pureTicks.js";

// A seek movement can home to its owner (`target: "owner"`), and an entity's collision can name its owner (`OWNER`).
// Together a boomerang flies out in a straight line, hits the enemy it meets, turns back and is caught by its owner.

const BOLT_CASTER = 5;
const baseAbility = (id) => structuredClone(GAMEPLAY_DATA.abilities.abilities.find((entry) => entry.id === id));
const NO_ORIGIN = { offset: { x: 0, y: 0 }, rotation: 0, rotationSpace: "owner" };
const CONTINUOUS = { mode: "continuous", intervalMs: null, count: null, startImmediately: true };
const ONCE = { mode: "once", intervalMs: null, count: null, startImmediately: true };
const BODY = { shape: "circle", radius: 20, range: null, arc: null, width: null, length: null, radiusMultiplier: 1, includeTargetRadius: null };

const bot = (extra) => ({
    slot: 2, teamNumber: 2, size: 60, rotation: 270, hp: 150, maxHp: 150, abilities: [], abilityState: {}, ...extra,
});
const caster = (abilityId, extra = {}) => ({
    id: "owner", slot: 1, teamNumber: 1, x: 300, y: 300, size: 60, rotation: 90, hp: 150, maxHp: 150,
    moveSpeed: 8, attackSpeedMultiplier: 1, attackDamageMultiplier: 1, abilities: [abilityId], abilityState: {},
    ...extra,
});

/** Casts the ability, ticking through any wind-up, and returns the owner on the tick the ability triggered. */
function cast(owner, abilityId) {
    let next = owner;
    for (let tick = 0; tick < 40; tick += 1) {
        next = applyBotAction(next, { dx: 0, dy: 0, abilityAction: { action: abilityId } }, 100);
        if (next.triggeredAbility != null) return next;
    }
    throw new Error("the ability never triggered");
}

/**
 * The boomerang. `out` flies straight for 400 ms (20 units a tick) and hits each enemy it touches once; then it turns
 * into `back`, which homes to the owner. On the way back it hits each enemy it touches once more, and it is removed on
 * touching its owner (a `remove` that names OWNER runs only when the owner is touched). `back` lasts 1000 ms, so a
 * boomerang with no owner to return to expires there.
 */
const boomerang = {
    runtimeType: "testBoomerang",
    category: "projectile",
    spawn: NO_ORIGIN,
    targeting: { owner: "owner", position: null, defaultX: null, defaultY: null, clampToRadius: null },
    lifetime: { timerMode: "none", duration: null, add: null },
    initialState: { armed: true, damageMultiplierFromOwner: false },
    state: null,
    phases: [
        {
            id: "out", type: "projectile", durationMs: 400, startMs: null, transitionOnly: null, skipOwner: null,
            movement: { mode: "straight", unitsPerTick: 20, direction: null, turnDegrees: null, size: null },
            hitbox: BODY, health: null, trigger: null, visual: null,
            on: {
                collision: {
                    targets: ["BOT"], schedule: CONTINUOUS, targetPolicy: { mode: "once", scope: "phase" },
                    recheckCollisionOnTransition: true, nearestOnly: false, waitForHit: false,
                    do: [{ do: "applyEffects", targets: ["BOT"], effects: [{ type: "damage", amount: 5, targetKinds: ["BOT"] }] }],
                },
                lifetimeEnd: { targets: [], schedule: ONCE, do: [{ do: "transition", to: "back" }] },
            },
        },
        {
            id: "back", type: "projectile", durationMs: 1000, startMs: null, transitionOnly: null, skipOwner: null,
            movement: { mode: "seek", unitsPerTick: 20, direction: null, turnDegrees: 180, size: null, target: "owner" },
            hitbox: BODY, health: null, trigger: null, visual: null,
            on: {
                collision: {
                    targets: ["BOT", "HP_ENTITY", "OWNER"], schedule: CONTINUOUS, targetPolicy: { mode: "once", scope: "phase" },
                    recheckCollisionOnTransition: true, nearestOnly: false, waitForHit: false,
                    do: [
                        { do: "applyEffects", targets: ["BOT", "HP_ENTITY"], effects: [{ type: "damage", amount: 5, targetKinds: ["BOT"] }] },
                        { do: "remove", targets: ["OWNER"] },
                    ],
                },
                lifetimeEnd: { targets: [], schedule: ONCE, do: [{ do: "remove" }] },
            },
        },
    ],
};

const withBoomerang = (fn) => withTestAbilities([{
    ...baseAbility(BOLT_CASTER),
    onActivate: [{ do: "spawn", entity: "testBoomerang" }],
    entities: { testBoomerang: boomerang },
}], fn);

/** The owner throws the boomerang, which starts just in front of it. */
function throwBoomerang(owner) {
    const thrown = cast(owner, BOLT_CASTER);
    const [spawned] = thrown.abilitySpawn;
    return { owner: thrown, entity: { ...spawned, x: 340, y: 300 } };
}

/** Runs `ticks` ticks, calling `observe` with the world after each one (`tick` counts from 1). */
function runWorld(world, ticks, observe = () => {}) {
    let current = world;
    for (let tick = 1; tick <= ticks; tick += 1) {
        const next = tickAbilityEntityWorld(current);
        current = { ...current, entities: next.entities, bots: next.bots };
        observe(current, tick);
    }
    return current;
}

test("a boomerang hits the enemy on the way out, turns back and is removed when it touches its owner", () => {
    const xs = [];
    let finished = null;
    withBoomerang(() => {
        const { owner, entity } = throwBoomerang(caster(BOLT_CASTER));
        const enemy = bot({ id: "enemy", slot: 3, x: 360, y: 300 });
        finished = runWorld({ entities: [entity], bots: [owner, enemy], stepMs: 100, width: 1000, height: 800 }, 10, (current) => {
            xs.push(current.entities[0]?.x ?? null);
            finished = current;
        });
    });
    // Out: 360, 380, 400, 420 (the phase turns at 400 ms). Back: 400, 380, 360, then 340 is inside the owner's reach.
    assert.deepEqual(xs.slice(0, 8), [360, 380, 400, 420, 400, 380, 360, null], "out, then back, then removed");
    assert.equal(finished.bots.find((candidate) => candidate.id === "enemy").hp, 140, "the enemy is hit once on the way out and once on the way back");
    assert.equal(finished.bots.find((candidate) => candidate.id === "owner").hp, 150, "the owner is never hurt by its own boomerang");
});

test("a boomerang whose owner is dead does not home in, and expires when its return phase ends", () => {
    const xs = [];
    withBoomerang(() => {
        const { owner, entity } = throwBoomerang(caster(BOLT_CASTER));
        const dead = { ...owner, hp: 0 };
        const enemy = bot({ id: "enemy", slot: 3, x: 900, y: 100 });
        runWorld({ entities: [entity], bots: [dead, enemy], stepMs: 100, width: 1000, height: 800 }, 16, (current) => {
            xs.push(current.entities[0]?.x ?? null);
        });
    });
    // 4 ticks out, then 10 ticks of return (1000 ms): it stops at 420 and is gone on the tick its return phase ends.
    assert.deepEqual(xs.slice(0, 4), [360, 380, 400, 420]);
    assert.ok(xs.slice(4, 13).every((x) => x === 420), "the return phase holds it still: nothing to home in on");
    assert.equal(xs[13], null, "it expires with its return phase");
});

test("an ally on the way back does not catch the boomerang: only the owner does", () => {
    let finished = null;
    const xs = [];
    withBoomerang(() => {
        const { owner, entity } = throwBoomerang(caster(BOLT_CASTER));
        const ally = bot({ id: "ally", slot: 4, teamNumber: 1, x: 380, y: 300 });
        finished = runWorld({ entities: [entity], bots: [owner, ally], stepMs: 100, width: 1000, height: 800 }, 10, (current) => {
            xs.push(current.entities[0]?.x ?? null);
        });
    });
    assert.equal(xs[4] !== null && xs[4] < 420, true, "the boomerang is already on its way back past the ally");
    assert.equal(xs.at(-1), null, "it is removed by the owner, not by the ally");
    assert.equal(finished.bots.find((candidate) => candidate.id === "ally").hp, 150, "the ally takes no hit");
});
