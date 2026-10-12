import assert from "node:assert/strict";
import test from "node:test";
import { GAMEPLAY_DATA } from "../../../../../shared/engine/gameconfig/gameplayData.js";
import { withTestAbilities } from "../../../../../shared/engine/ecs/contracts/AbilityContracts.js";
import { applyBotAction, resolveActivationVerbsForWorld, tickAbilityEntityWorld } from "../../testing/pureTicks.js";

// targetPolicy scopes: an activation's hits share one memory (the hammer), and an entity's `entity` scope lasts
// across its phase changes (a projectile that lodges in a new phase still hits each bot once).

const baseAbility = (id) => structuredClone(GAMEPLAY_DATA.abilities.abilities.find((entry) => entry.id === id));
const NO_ORIGIN = { offset: { x: 0, y: 0 }, rotation: 0, rotationSpace: "owner" };
const HAMMER = 6;
const BOLT_CASTER = 5;
const ONCE_ACTIVATION = { mode: "once", scope: "activation" };

const bot = (extra) => ({
    slot: 2, teamNumber: 2, size: 60, rotation: 270, hp: 100, maxHp: 100, abilities: [], abilityState: {}, ...extra,
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

/** The activation tick of a cast: the owner and its roster resolve their hits together. */
const activate = (owner, others) => resolveActivationVerbsForWorld([owner, ...others]).bots;

const RECT = { shape: "rectangle", length: 90, width: 50, radius: null, range: null, arc: null, radiusMultiplier: 1, includeTargetRadius: true };
const CIRCLE = { shape: "circle", radius: 130, range: null, arc: null, width: null, length: null, radiusMultiplier: 1, includeTargetRadius: true };
const damageHit = (hitbox, amount, targetPolicy) => ({
    do: "hit", origin: NO_ORIGIN, targets: ["BOT"], targetPolicy, nearestOnly: false,
    hitbox, effects: [{ type: "damage", amount, targetKinds: ["BOT"] }], visual: null,
});

test("a hammer blow's two activation hits share one activation memory: a bot in both takes only the first", () => {
    // The head (a narrow box, 12) then the wave (a circle, 6), both on the activation tick.
    const hammer = {
        ...baseAbility(HAMMER),
        onActivate: [damageHit(RECT, 12, ONCE_ACTIVATION), damageHit(CIRCLE, 6, ONCE_ACTIVATION)],
        entities: {},
    };
    withTestAbilities([hammer], () => {
        // The owner faces east. In front, 60 units away: inside the head's box and the wave. Behind, 100 away: only the wave.
        // Each bot keeps its own slot: a target's memory key is its slot.
        const front = bot({ id: "front", slot: 2, x: 360, y: 300 });
        const behind = bot({ id: "behind", slot: 3, x: 200, y: 300 });
        const owner = cast(caster(HAMMER), HAMMER);
        const [, struck, edge] = activate(owner, [front, behind]);
        assert.equal(struck.hp, 88, "the head's 12 only: the wave skips a bot the head already hit");
        assert.equal(edge.hp, 94, "the wave's 6 reaches the bot the head missed");
    });
});

test("a projectile with scope entity hits a bot once across a transition, where the default phase scope hits it again", () => {
    // `flying` travels and lodges in `lodged` on its first hit; both phases can hit the bot that is already in front.
    const bolt = (scope) => ({
        runtimeType: "testBolt",
        category: "projectile",
        spawn: NO_ORIGIN,
        targeting: { owner: "owner", position: null, defaultX: null, defaultY: null, clampToRadius: null },
        lifetime: { timerMode: "none", duration: null, add: null },
        initialState: { armed: true, damageMultiplierFromOwner: false },
        state: null,
        phases: [
            {
                id: "flying", type: "projectile", durationMs: null, startMs: null, transitionOnly: null, skipOwner: null,
                movement: { mode: "straight", unitsPerTick: 20, direction: null, turnDegrees: null, size: null },
                hitbox: { shape: "circle", radius: 20, range: null, arc: null, width: null, length: null, radiusMultiplier: 1, includeTargetRadius: null },
                health: null, trigger: null, visual: null,
                on: { collision: {
                    targets: ["BOT"], schedule: { mode: "continuous", intervalMs: null, count: null, startImmediately: true },
                    targetPolicy: { mode: "once", scope }, recheckCollisionOnTransition: true, nearestOnly: false, waitForHit: false,
                    do: [
                        { do: "applyEffects", targets: ["BOT"], effects: [{ type: "damage", amount: 5, targetKinds: ["BOT"] }] },
                        { do: "transition", to: "lodged" },
                    ],
                } },
            },
            {
                id: "lodged", type: "zone", durationMs: 500, startMs: null, transitionOnly: null, skipOwner: null,
                movement: { mode: "static", unitsPerTick: 0, direction: null, turnDegrees: null, size: null },
                hitbox: { shape: "circle", radius: 40, range: null, arc: null, width: null, length: null, radiusMultiplier: 1, includeTargetRadius: null },
                health: null, trigger: null, visual: null,
                on: {
                    collision: {
                        targets: ["BOT"], schedule: { mode: "continuous", intervalMs: null, count: null, startImmediately: true },
                        targetPolicy: { mode: "once", scope }, recheckCollisionOnTransition: true, nearestOnly: false, waitForHit: false,
                        do: [{ do: "applyEffects", targets: ["BOT"], effects: [{ type: "damage", amount: 5, targetKinds: ["BOT"] }] }],
                    },
                    lifetimeEnd: { targets: [], schedule: { mode: "once", intervalMs: null, count: null, startImmediately: true }, do: [{ do: "remove" }] },
                },
            },
        ],
    });
    const run = (scope) => {
        let result = null;
        withTestAbilities([{
            ...baseAbility(BOLT_CASTER),
            onActivate: [{ do: "spawn", entity: "testBolt" }],
            entities: { testBolt: bolt(scope) },
        }], () => {
            const owner = cast(caster(BOLT_CASTER), BOLT_CASTER);
            const [spawned] = owner.abilitySpawn;
            // The bolt starts 40 units ahead of the owner, in the enemy's body: its first step lands on the enemy.
            let world = { entities: [{ ...spawned, x: 340, y: 300 }], bots: [owner, bot({ id: "enemy", x: 360, y: 300 })], stepMs: 100, width: 1000, height: 800 };
            for (let tick = 0; tick < 12; tick += 1) {
                const next = tickAbilityEntityWorld(world);
                world = { ...world, entities: next.entities, bots: next.bots };
            }
            result = world.bots.find((candidate) => candidate.id === "enemy").hp;
        });
        return result;
    };
    assert.equal(run("entity"), 95, "the entity scope lasts through the transition: one hit of 5");
    assert.equal(run("phase"), 90, "the phase scope resets on the transition: the lodged phase hits again");
});
