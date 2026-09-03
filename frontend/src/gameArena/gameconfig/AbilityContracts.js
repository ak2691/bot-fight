import { ABILITY_STATS, statusDurationMs } from "./Abilities.js";
import { abilityId as resolveAbilityId } from "./AbilityRegistry.js";

export const EFFECT_TYPES = Object.freeze({
    DAMAGE: "damage",
    HEALING: "healing",
    KNOCKBACK: "knockback",
    PULL: "pull",
    DEBUFF: "debuff",
    BUFF: "buff",
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
    ZONE: "zone",
    TRAP: "trap",
    SUMMON: "summon",
});

export const HITBOX_GEOMETRIES = Object.freeze({
    ARC: "arc",
    RECTANGLE: "rectangle",
});

export const TELEPORT_DISTANCE_MODES = Object.freeze({
    CENTER_DISTANCE: "center_distance",
});

const effect = (type, values = {}) => Object.freeze({ type, ...values });
const execution = (values = {}) => Object.freeze(values);

const A = ABILITY_STATS;

/**
 * Canonical browser combat metadata. Delivery controls how an effect reaches a
 * target; effects control game-state changes. Visuals intentionally live
 * outside this catalog.
 */
const ABILITY_CONTRACTS_BY_ID = Object.freeze({
    1: contract({ type: DELIVERY_TYPES.MELEE, includeTargetRadius: true }, [effect(EFFECT_TYPES.DAMAGE, { amount: A[1].damage })]),
    3: contract(DELIVERY_TYPES.RAY, [effect(EFFECT_TYPES.DAMAGE, { falloff: true })], execution({
        capture: Object.freeze({ gunRayOriginX: "x", gunRayOriginY: "y", gunRayRotation: "rotation" }),
    })),
    4: contract(DELIVERY_TYPES.PROJECTILE, [effect(EFFECT_TYPES.DAMAGE, { falloff: true }), effect(EFFECT_TYPES.SPAWN_ENTITY, { entityType: "grenade" })], execution({ activeMs: 1 })),
    5: contract(DELIVERY_TYPES.PROJECTILE, [effect(EFFECT_TYPES.DAMAGE, { amount: A[5].damage }), effect(EFFECT_TYPES.DEBUFF, { debuff: "burn", durationMs: statusDurationMs(5, "burn") }), effect(EFFECT_TYPES.SPAWN_ENTITY, { entityType: "fireball" })]),
    6: contract({ type: DELIVERY_TYPES.MELEE, geometry: HITBOX_GEOMETRIES.RECTANGLE, includeTargetRadius: true }, [effect(EFFECT_TYPES.DAMAGE, { amount: A[6].damage }), effect(EFFECT_TYPES.DEBUFF, { debuff: "stun", durationMs: statusDurationMs(6, "stun") })]),
    7: contract({ type: DELIVERY_TYPES.MELEE, includeTargetRadius: true }, [effect(EFFECT_TYPES.DAMAGE, { amount: A[7].damage }), effect(EFFECT_TYPES.DEBUFF, { debuff: "bleed", durationMs: statusDurationMs(7, "bleed") })]),
    8: contract({ type: DELIVERY_TYPES.RADIAL, includeTargetRadius: true }, [effect(EFFECT_TYPES.DAMAGE, { amount: A[8].damage }), effect(EFFECT_TYPES.KNOCKBACK, { distance: A[8].knockback })]),
    9: contract(DELIVERY_TYPES.RAY, [effect(EFFECT_TYPES.DAMAGE, { amount: A[9].damage }), effect(EFFECT_TYPES.DEBUFF, { debuff: "slow", durationMs: statusDurationMs(9, "slow") })]),
    10: contract(DELIVERY_TYPES.SELF, [effect(EFFECT_TYPES.HEALING, { amount: A[10].healing })]),
    11: contract(DELIVERY_TYPES.TRAP, [effect(EFFECT_TYPES.DAMAGE, { amount: A[11].damage }), effect(EFFECT_TYPES.SPAWN_ENTITY, { entityType: "proximity_mine" })]),
    12: contract(DELIVERY_TYPES.RAY, [effect(EFFECT_TYPES.DAMAGE, { falloff: true })]),
    13: contract(DELIVERY_TYPES.RAY, [effect(EFFECT_TYPES.DAMAGE, { amount: A[13].damage }), effect(EFFECT_TYPES.DEBUFF, { debuff: "shock", durationMs: statusDurationMs(13, "shock") })]),
    14: contract(DELIVERY_TYPES.PROJECTILE, [effect(EFFECT_TYPES.PULL, { perTick: A[14].pullPerTick }), effect(EFFECT_TYPES.DAMAGE, { falloff: true }), effect(EFFECT_TYPES.SPAWN_ENTITY, { entityType: "gravity_zone" })]),
    15: contract(DELIVERY_TYPES.PROJECTILE, [effect(EFFECT_TYPES.DEBUFF, { debuff: "silence", durationMs: statusDurationMs(15, "silence") }), effect(EFFECT_TYPES.INTERRUPT, { durationMs: A[15].interruptMs }), effect(EFFECT_TYPES.SPAWN_ENTITY, { entityType: "silence_wave" })]),
    16: contract(DELIVERY_TYPES.SELF, [
        effect(EFFECT_TYPES.DAMAGE_REDUCTION, { amount: 0.5, multiplier: 0.5, durationMs: statusDurationMs(16, "damage_reduction") }),
        effect(EFFECT_TYPES.DAMAGE_REFLECTION, { amount: 0.5, multiplier: 0.5, durationMs: statusDurationMs(16, "damage_reflection") }),
    ]),
    17: contract(DELIVERY_TYPES.SUMMON, [effect(EFFECT_TYPES.DAMAGE, { amount: A[17].damage }), effect(EFFECT_TYPES.SPAWN_ENTITY, { entityType: "hunter_drone" })]),
    18: contract(DELIVERY_TYPES.PROJECTILE, [effect(EFFECT_TYPES.DAMAGE, { amount: A[18].damage }), effect(EFFECT_TYPES.KNOCKBACK, { distance: A[18].knockback }), effect(EFFECT_TYPES.SPAWN_ENTITY, { entityType: "windburst_projectile" })]),
    19: contract(DELIVERY_TYPES.SELF, [effect(EFFECT_TYPES.MOVEMENT, { distance: A[19].distance })], execution({
        blockedByStatus: "slow",
        movement: Object.freeze({
            distanceStat: "distance",
            durationStat: "durationMs",
            stepDistanceStat: "speedPerTick",
            trailDurationStat: "trailMs",
        }),
    })),
    20: contract(DELIVERY_TYPES.SELF, [], execution({
        targetMode: "target",
        faceTargetFromPayload: true,
    })),
    21: contract(DELIVERY_TYPES.SELF, [effect(EFFECT_TYPES.RESTORE_STATE, { delayMs: A[21].delayMs }), effect(EFFECT_TYPES.SPAWN_ENTITY, { entityType: "temporal_rewind_zone" })]),
    22: contract(DELIVERY_TYPES.ZONE, [effect(EFFECT_TYPES.DAMAGE, { amount: A[22].damage }), effect(EFFECT_TYPES.SPAWN_ENTITY, { entityType: "orbital_zone" })]),
    23: contract(DELIVERY_TYPES.SELF, [effect(EFFECT_TYPES.DAMAGE_IMMUNITY, { amount: 1, durationMs: statusDurationMs(23, "damage_immunity") })]),
    24: contract(DELIVERY_TYPES.ZONE, [effect(EFFECT_TYPES.DEBUFF, { debuff: "silence", whileInside: true }), effect(EFFECT_TYPES.SPAWN_ENTITY, { entityType: "null_zone" })]),
    25: contract({ type: DELIVERY_TYPES.MELEE, geometry: HITBOX_GEOMETRIES.RECTANGLE, includeTargetRadius: true }, [effect(EFFECT_TYPES.TELEPORT, { distanceMode: TELEPORT_DISTANCE_MODES.CENTER_DISTANCE }), effect(EFFECT_TYPES.DAMAGE, { amount: A[25].damage })], execution({
        capture: Object.freeze({ hitboxOriginX: "x", hitboxOriginY: "y", hitboxRotation: "rotation" }),
        phaseFacingDefault: "0",
        teleportOncePerActivation: true,
    })),
    26: contract({ type: DELIVERY_TYPES.RADIAL, includeTargetRadius: true }, [effect(EFFECT_TYPES.DAMAGE, { amount: A[26].damage }), effect(EFFECT_TYPES.DEBUFF, { debuff: "slow", durationMs: statusDurationMs(26, "slow") }), effect(EFFECT_TYPES.KNOCKBACK, { distance: A[26].knockback })]),
    27: contract(DELIVERY_TYPES.ZONE, [effect(EFFECT_TYPES.PULL, { perTick: A[27].pullPerTick }), effect(EFFECT_TYPES.DAMAGE, { falloff: true }), effect(EFFECT_TYPES.SPAWN_ENTITY, { entityType: "singularity_zone" })]),
    28: contract(DELIVERY_TYPES.PROJECTILE, [
        effect(EFFECT_TYPES.DAMAGE, { amount: A[28].damage }),
        effect(EFFECT_TYPES.PULL, { amount: A[28].pullPerTick, perTick: A[28].pullPerTick }),
        effect(EFFECT_TYPES.DEBUFF, { debuff: "slow", durationMs: statusDurationMs(28, "slow") }),
        effect(EFFECT_TYPES.SPAWN_ENTITY, { entityType: "tether_bolt" }),
    ]),
    29: contract(DELIVERY_TYPES.TRAP, [
        effect(EFFECT_TYPES.DAMAGE, { amount: A[29].damage }),
        effect(EFFECT_TYPES.DEBUFF, { debuff: "slow", durationMs: statusDurationMs(29, "slow") }),
        effect(EFFECT_TYPES.INTERRUPT, { durationMs: A[29].interruptMs }),
        effect(EFFECT_TYPES.SPAWN_ENTITY, { entityType: "static_snare" }),
    ]),
    30: contract(DELIVERY_TYPES.RAY, [
        effect(EFFECT_TYPES.DAMAGE, { amount: A[30].damage }),
        effect(EFFECT_TYPES.INTERRUPT, { durationMs: A[30].interruptMs }),
        effect(EFFECT_TYPES.DEBUFF, { debuff: "slow", durationMs: statusDurationMs(30, "slow") }),
    ]),
    31: contract(DELIVERY_TYPES.SUMMON, [
        effect(EFFECT_TYPES.DAMAGE, { amount: A[31].damage }),
        effect(EFFECT_TYPES.KNOCKBACK, { distance: A[31].knockback }),
        effect(EFFECT_TYPES.SPAWN_ENTITY, { entityType: "repeller_drone" }),
    ]),
    32: contract(DELIVERY_TYPES.RAY, [
        effect(EFFECT_TYPES.DAMAGE, { falloff: true }),
        effect(EFFECT_TYPES.HEALING, {
            recipient: "source",
            requiresConfirmedDamage: true,
            mirrorsDamage: true,
        }),
    ]),
    33: contract(DELIVERY_TYPES.SELF, [
        effect(EFFECT_TYPES.BUFF, {
            buff: "overclock",
            amount: A[33].cooldownRecoveryPercent / 100,
            multiplier: A[33].cooldownRecoveryMultiplier,
            durationMs: statusDurationMs(33, "overclock"),
        }),
    ]),
    34: contract({ type: DELIVERY_TYPES.MELEE, includeTargetRadius: true }, [
        effect(EFFECT_TYPES.DAMAGE, { amount: A[34].damage }),
    ]),
});

export const ABILITY_CONTRACTS = ABILITY_CONTRACTS_BY_ID;

function contract(delivery, effects, executionMetadata = {}) {
    return Object.freeze({
        delivery: Object.freeze(typeof delivery === "string" ? { type: delivery } : delivery),
        effects: Object.freeze(effects),
        execution: executionMetadata,
    });
}

export function abilityContract(abilityId) {
    const numericId = resolveAbilityId(abilityId);
    return numericId == null ? null : ABILITY_CONTRACTS[numericId] ?? null;
}

export function hasEffect(abilityId, effectType) {
    return Boolean(abilityContract(abilityId)?.effects.some(({ type }) => type === effectType));
}
