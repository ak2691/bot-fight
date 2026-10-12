import assert from "node:assert/strict";
import test from "node:test";
import { GAMEPLAY_DATA } from "../../../../../shared/engine/gameconfig/gameplayData.js";
import { withTestAbilities } from "../../../../../shared/engine/ecs/contracts/AbilityContracts.js";
import { applyBotAction } from "../../testing/pureTicks.js";

// The runtime reads an ability's cooldown and active time from its own timing (the data), not from the catalogue's
// projection (ABILITY_STATS). A test ability with other numbers therefore behaves with those numbers.

const HAMMER = 6;
const baseAbility = (id) => structuredClone(GAMEPLAY_DATA.abilities.abilities.find((entry) => entry.id === id));
const NO_ORIGIN = { offset: { x: 0, y: 0 }, rotation: 0, rotationSpace: "owner" };
const CIRCLE = { shape: "circle", radius: 130, range: null, arc: null, width: null, length: null, radiusMultiplier: 1, includeTargetRadius: true };

const caster = (abilityId) => ({
    id: "owner", slot: 1, teamNumber: 1, x: 300, y: 300, size: 60, rotation: 90, hp: 150, maxHp: 150,
    moveSpeed: 8, attackSpeedMultiplier: 1, attackDamageMultiplier: 1, abilities: [abilityId], abilityState: {},
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

/** The hammer with its timing replaced, and one activation hit so it does something. */
const withTiming = (timing) => ({
    ...baseAbility(HAMMER),
    timing,
    onActivate: [{
        do: "hit", origin: NO_ORIGIN, targets: ["BOT"], hitbox: CIRCLE,
        effects: [{ type: "damage", amount: 1, targetKinds: ["BOT"] }], visual: null,
    }],
    entities: {},
});

test("a cast sets the cooldown from the ability's timing, not from the catalogue", () => {
    const shipped = baseAbility(HAMMER).timing;
    withTestAbilities([withTiming({ ...shipped, cooldownMs: 1200 })], () => {
        const owner = cast(caster(HAMMER), HAMMER);
        const record = owner.abilityState[HAMMER];
        assert.equal(record.cooldownMs, 1200, "the test ability's own cooldown, held until its active stage ends");
    });
});

test("the active time after a cast is the ability's timing.activeMs", () => {
    const shipped = baseAbility(HAMMER).timing;
    withTestAbilities([withTiming({ ...shipped, activeMs: 700 })], () => {
        const owner = cast(caster(HAMMER), HAMMER);
        const record = owner.abilityState[HAMMER];
        assert.equal(record.stage, "active");
        assert.equal(record.remainingMs, 700, "the test ability's own active time");
    });
});
