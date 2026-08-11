import { ABILITY_STATS } from "./Abilities.js";
import { abilityId as resolveAbilityId } from "./AbilityRegistry.js";

export const EFFECT_TYPES = Object.freeze({
    DAMAGE: "damage",
    HEALING: "healing",
    KNOCKBACK: "knockback",
    PULL: "pull",
    DEBUFF: "debuff",
    INTERRUPT: "interrupt",
    MOVEMENT: "movement",
    TELEPORT: "teleport",
    RESTORE_STATE: "restore_state",
    DAMAGE_REDUCTION: "damage_reduction",
    DAMAGE_IMMUNITY: "damage_immunity",
    DAMAGE_REFLECTION: "damage_reflection",
    SPAWN_ENTITY: "spawn_entity",
});

export const DELIVERY_TYPES = Object.freeze({
    SELF: "self",
    MELEE: "melee",
    RAY: "ray",
    PROJECTILE: "projectile",
    RADIAL: "radial",
    FIELD: "field",
    TRAP: "trap",
    SUMMON: "summon",
});

export const SHIELD_MODES = Object.freeze({
    BLOCK: "block",
    IGNORE: "ignore",
    DRAIN_WHILE_ACTIVE: "drain_while_active",
});

export const SHIELD_CHARGE_COSTS = Object.freeze({ ONE: 1, ALL: "all", DISTANCE_SCALED: "distance_scaled" });

const effect = (type, values = {}) => Object.freeze({ type, ...values });
const block = (prevents, values = {}) => Object.freeze({
    mode: SHIELD_MODES.BLOCK,
    halfArcDegrees: 95,
    chargeCost: SHIELD_CHARGE_COSTS.ONE,
    prevents: Object.freeze([...prevents]),
    ...values,
});
const ignore = Object.freeze({ mode: SHIELD_MODES.IGNORE, prevents: Object.freeze([]) });
const drainWhileActive = Object.freeze({ mode: SHIELD_MODES.DRAIN_WHILE_ACTIVE, chargeCost: SHIELD_CHARGE_COSTS.ALL, prevents: Object.freeze([]) });

const A = ABILITY_STATS;

/**
 * Canonical browser combat metadata. Delivery controls how an effect reaches a
 * target; effects control game-state changes; shieldInteraction filters those
 * effects. Visuals intentionally live outside this catalog.
 */
const ABILITY_CONTRACTS_BY_ID = Object.freeze({
    1: contract({ type: DELIVERY_TYPES.MELEE, includeTargetRadius: true }, [effect(EFFECT_TYPES.DAMAGE, { amount: A[1].damage })], block([EFFECT_TYPES.DAMAGE])),
    2: contract(DELIVERY_TYPES.SELF, [], ignore),
    3: contract(DELIVERY_TYPES.RAY, [effect(EFFECT_TYPES.DAMAGE, { falloff: true })], block([EFFECT_TYPES.DAMAGE])),
    4: contract(DELIVERY_TYPES.PROJECTILE, [effect(EFFECT_TYPES.DAMAGE, { falloff: true }), effect(EFFECT_TYPES.SPAWN_ENTITY, { entityType: "grenade" })], block([EFFECT_TYPES.DAMAGE], { halfArcDegrees: 180, chargeCost: SHIELD_CHARGE_COSTS.DISTANCE_SCALED })),
    5: contract(DELIVERY_TYPES.PROJECTILE, [effect(EFFECT_TYPES.DAMAGE, { amount: A[5].damage }), effect(EFFECT_TYPES.DEBUFF, { debuff: "burn", durationMs: A[5].burnDurationMs }), effect(EFFECT_TYPES.SPAWN_ENTITY, { entityType: "fireball" })], block([EFFECT_TYPES.DAMAGE, EFFECT_TYPES.DEBUFF])),
    6: contract({ type: DELIVERY_TYPES.MELEE, includeTargetRadius: true }, [effect(EFFECT_TYPES.DAMAGE, { amount: A[6].damage }), effect(EFFECT_TYPES.DEBUFF, { debuff: "stun", durationMs: A[6].durationMs })], block([EFFECT_TYPES.DAMAGE, EFFECT_TYPES.DEBUFF])),
    7: contract({ type: DELIVERY_TYPES.MELEE, includeTargetRadius: true }, [effect(EFFECT_TYPES.DAMAGE, { amount: A[7].damage }), effect(EFFECT_TYPES.DEBUFF, { debuff: "bleed", durationMs: A[7].bleedDurationMs })], block([EFFECT_TYPES.DAMAGE, EFFECT_TYPES.DEBUFF], { chargeCost: SHIELD_CHARGE_COSTS.ALL })),
    8: contract(DELIVERY_TYPES.RADIAL, [effect(EFFECT_TYPES.DAMAGE, { amount: A[8].damage }), effect(EFFECT_TYPES.KNOCKBACK, { distance: A[8].knockback })], block([EFFECT_TYPES.DAMAGE])),
    9: contract(DELIVERY_TYPES.RAY, [effect(EFFECT_TYPES.DAMAGE, { amount: A[9].damage }), effect(EFFECT_TYPES.DEBUFF, { debuff: "slow", durationMs: A[9].slowDurationMs })], block([EFFECT_TYPES.DAMAGE, EFFECT_TYPES.DEBUFF])),
    10: contract(DELIVERY_TYPES.SELF, [effect(EFFECT_TYPES.HEALING, { amount: A[10].healing })], ignore),
    11: contract(DELIVERY_TYPES.TRAP, [effect(EFFECT_TYPES.DAMAGE, { amount: A[11].damage }), effect(EFFECT_TYPES.SPAWN_ENTITY, { entityType: "proximity_mine" })], block([EFFECT_TYPES.DAMAGE], { halfArcDegrees: 45, chargeCost: SHIELD_CHARGE_COSTS.ALL })),
    12: contract(DELIVERY_TYPES.RAY, [effect(EFFECT_TYPES.DAMAGE, { falloff: true })], block([EFFECT_TYPES.DAMAGE])),
    13: contract(DELIVERY_TYPES.RAY, [effect(EFFECT_TYPES.DAMAGE, { amount: A[13].damage }), effect(EFFECT_TYPES.DEBUFF, { debuff: "shock", durationMs: A[13].shockDurationMs })], block([EFFECT_TYPES.DAMAGE, EFFECT_TYPES.DEBUFF])),
    14: contract(DELIVERY_TYPES.FIELD, [effect(EFFECT_TYPES.PULL, { perTick: 6 }), effect(EFFECT_TYPES.DAMAGE, { falloff: true }), effect(EFFECT_TYPES.SPAWN_ENTITY, { entityType: "gravity_field" })], block([EFFECT_TYPES.DAMAGE], { halfArcDegrees: 45, chargeCost: SHIELD_CHARGE_COSTS.ALL })),
    15: contract(DELIVERY_TYPES.PROJECTILE, [effect(EFFECT_TYPES.DEBUFF, { debuff: "silence", durationMs: A[15].durationMs }), effect(EFFECT_TYPES.INTERRUPT, { durationMs: A[15].interruptMs }), effect(EFFECT_TYPES.SPAWN_ENTITY, { entityType: "silence_wave" })], block([EFFECT_TYPES.DEBUFF, EFFECT_TYPES.INTERRUPT])),
    16: contract(DELIVERY_TYPES.SELF, [effect(EFFECT_TYPES.DAMAGE_REDUCTION, { multiplier: 0.5 }), effect(EFFECT_TYPES.DAMAGE_REFLECTION, { multiplier: 0.5 })], ignore),
    17: contract(DELIVERY_TYPES.SUMMON, [effect(EFFECT_TYPES.DAMAGE, { amount: A[17].damage }), effect(EFFECT_TYPES.SPAWN_ENTITY, { entityType: "hunter_drone" })], block([EFFECT_TYPES.DAMAGE])),
    18: contract(DELIVERY_TYPES.PROJECTILE, [effect(EFFECT_TYPES.DAMAGE, { amount: A[18].damage }), effect(EFFECT_TYPES.KNOCKBACK, { distance: A[18].knockback })], ignore),
    19: contract(DELIVERY_TYPES.SELF, [effect(EFFECT_TYPES.MOVEMENT, { distance: A[19].distance })], ignore),
    20: contract(DELIVERY_TYPES.SELF, [], ignore),
    21: contract(DELIVERY_TYPES.SELF, [effect(EFFECT_TYPES.RESTORE_STATE, { delayMs: A[21].delayMs }), effect(EFFECT_TYPES.SPAWN_ENTITY, { entityType: "temporal_rewind_zone" })], ignore),
    22: contract(DELIVERY_TYPES.FIELD, [effect(EFFECT_TYPES.DAMAGE, { amount: A[22].damage, falloff: true }), effect(EFFECT_TYPES.SPAWN_ENTITY, { entityType: "orbital_zone" })], drainWhileActive),
    23: contract(DELIVERY_TYPES.SELF, [effect(EFFECT_TYPES.DAMAGE_IMMUNITY, { durationMs: A[23].durationMs })], ignore),
    24: contract(DELIVERY_TYPES.FIELD, [effect(EFFECT_TYPES.DEBUFF, { debuff: "silence", whileInside: true }), effect(EFFECT_TYPES.SPAWN_ENTITY, { entityType: "null_zone" })], ignore),
    25: contract(DELIVERY_TYPES.MELEE, [effect(EFFECT_TYPES.TELEPORT, { passThroughDistance: A[25].passThroughDistance }), effect(EFFECT_TYPES.DAMAGE, { amount: A[25].damage })], block([EFFECT_TYPES.TELEPORT, EFFECT_TYPES.DAMAGE])),
});

export const ABILITY_CONTRACTS = ABILITY_CONTRACTS_BY_ID;

function contract(delivery, effects, shieldInteraction) {
    return Object.freeze({
        delivery: Object.freeze(typeof delivery === "string" ? { type: delivery } : delivery),
        effects: Object.freeze(effects),
        shieldInteraction,
    });
}

export function abilityContract(abilityId) {
    const numericId = resolveAbilityId(abilityId);
    return numericId == null ? null : ABILITY_CONTRACTS[numericId] ?? null;
}

export function hasEffect(abilityId, effectType) {
    return Boolean(abilityContract(abilityId)?.effects.some(({ type }) => type === effectType));
}
