import { ABILITY_STATS, statusDurationMs } from "./Abilities.js";
import { abilityId as resolveAbilityId } from "./AbilityRegistry.js";

export const EFFECT_TYPES = Object.freeze({
    DAMAGE: "damage",
    HEALING: "healing",
    KNOCKBACK: "knockback",
    PULL: "pull",
    STATUS: "status",
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

/**
 * User-facing phase delivery vocabulary. Persistent phases and immediate
 * phases share the same contract; the executor decides whether a phase needs
 * an arena entity from this value rather than from an implementation-specific
 * dispatch kind.
 */
export const PHASE_TYPES = Object.freeze({
    SELF: "self",
    MELEE: "melee",
    RAY: "ray",
    ARC: "arc",
    PROJECTILE: "projectile",
    ZONE: "zone",
    SUMMON: "summon",
});

export const PHASE_EVENT_TYPES = Object.freeze({
    ACTIVATION: "activation",
    COLLISION: "collision",
    INTERVAL: "interval",
    LIFETIME_END: "lifetimeEnd",
    DESTROYED: "destroyed",
    ENTER: "enter",
    EXIT: "exit",
});

export const PHASE_ACTIONS = Object.freeze({
    APPLY_EFFECTS: "applyEffects",
    TRANSITION: "transition",
    REMOVE: "remove",
    EMIT_VISUAL: "emitVisual",
});

export const PERSISTENCE_MODES = Object.freeze({
    ONCE: "once",
    EVERY_TICK: "everyTick",
    INTERVAL: "interval",
});

export const HITBOX_GEOMETRIES = Object.freeze({
    ARC: "arc",
    RECTANGLE: "rectangle",
});

export const TELEPORT_DISTANCE_MODES = Object.freeze({
    CENTER_DISTANCE: "center_distance",
});

const effect = (type, values = {}) => Object.freeze({ type, ...values });
const statusEffect = (subtype, values = {}) => effect(EFFECT_TYPES.STATUS, { subtype, ...values });
const execution = (values = {}) => Object.freeze(values);

/**
 * Builds the normalized phase envelope used by authoring tools and runtime
 * adapters. Values such as `range` and `width` may be numbers or stat names;
 * keeping the vocabulary stable lets the editor resolve them without knowing
 * which executor will consume the phase.
 */
export function abilityPhase(id, type, values = {}) {
    return Object.freeze({
        id,
        type,
        ...values,
        ...(values.hitbox ? { hitbox: Object.freeze({ ...values.hitbox }) } : {}),
        ...(values.events ? { events: Object.freeze({ ...values.events }) } : {}),
        ...(values.persistence ? { persistence: Object.freeze({ ...values.persistence }) } : {}),
        ...(values.visual ? { visual: Object.freeze({ ...values.visual }) } : {}),
        ...(values.effects ? { effects: Object.freeze([...values.effects]) } : {}),
        ...(values.effectOverrides ? { effectOverrides: Object.freeze({ ...values.effectOverrides }) } : {}),
    });
}

/** Returns the stable override key for one declared effect instance. */
export function effectOverrideKey(effectValue) {
    if (!effectValue?.type) return null;
    return effectValue.type === EFFECT_TYPES.STATUS && effectValue.subtype
        ? `${effectValue.type}:${effectValue.subtype}`
        : effectValue.type;
}

/** Looks up an effect-instance override, falling back to the broad effect type. */
export function effectOverrideFor(effectValue, overrides) {
    if (!effectValue || !overrides) return null;
    const key = effectOverrideKey(effectValue);
    return overrides[key] ?? overrides[effectValue.type] ?? null;
}

/** Merges an override without losing the effect's existing falloff fields. */
export function resolveEffectOverride(effectValue, overrides) {
    const override = effectOverrideFor(effectValue, overrides);
    if (!override) return effectValue;
    const hasFixedAmount = Object.prototype.hasOwnProperty.call(override, "amount")
        && override.amount != null;
    const baseFalloff = effectValue.falloff && typeof effectValue.falloff === "object"
        ? effectValue.falloff : null;
    const overrideFalloff = override.falloff && typeof override.falloff === "object"
        ? override.falloff : null;
    return {
        ...effectValue,
        ...override,
        ...(hasFixedAmount && !overrideFalloff
            ? { falloff: null }
            : baseFalloff || overrideFalloff
            ? { falloff: { ...(baseFalloff ?? {}), ...(overrideFalloff ?? {}) } }
            : {}),
    };
}

const A = ABILITY_STATS;

/**
 * Canonical browser combat metadata. Delivery controls how an effect reaches a
 * target; effects control game-state changes. Visuals intentionally live
 * outside this catalog.
 */
const ABILITY_CONTRACTS_BY_ID = Object.freeze({
    1: contract({ type: DELIVERY_TYPES.MELEE, includeTargetRadius: true }, [effect(EFFECT_TYPES.DAMAGE, { amount: A[1].damage })]),
    3: contract(DELIVERY_TYPES.RAY, [effect(EFFECT_TYPES.DAMAGE, { falloff: A[3].falloff })], execution({
        capture: Object.freeze({ gunRayOriginX: "x", gunRayOriginY: "y", gunRayRotation: "rotation" }),
    })),
    4: contract(DELIVERY_TYPES.PROJECTILE, [effect(EFFECT_TYPES.DAMAGE, { falloff: A[4].falloff }), effect(EFFECT_TYPES.SPAWN_ENTITY, { entityType: "grenade" })], execution({ activeMs: 1 })),
    5: contract(DELIVERY_TYPES.PROJECTILE, [effect(EFFECT_TYPES.DAMAGE, { amount: A[5].damage }), statusEffect("burn", { durationMs: statusDurationMs(5, "burn") }), effect(EFFECT_TYPES.SPAWN_ENTITY, { entityType: "fireball" })]),
    6: contract({ type: DELIVERY_TYPES.MELEE, geometry: HITBOX_GEOMETRIES.RECTANGLE, includeTargetRadius: true }, [effect(EFFECT_TYPES.DAMAGE, { amount: A[6].damage }), statusEffect("stun", { durationMs: statusDurationMs(6, "stun") })]),
    7: contract({ type: DELIVERY_TYPES.MELEE, includeTargetRadius: true }, [effect(EFFECT_TYPES.DAMAGE, { amount: A[7].damage }), statusEffect("bleed", { durationMs: statusDurationMs(7, "bleed") })]),
    8: contract({ type: DELIVERY_TYPES.RADIAL, includeTargetRadius: true }, [effect(EFFECT_TYPES.DAMAGE, { amount: A[8].damage }), effect(EFFECT_TYPES.KNOCKBACK, { amount: A[8].knockback })]),
    9: contract(DELIVERY_TYPES.RAY, [effect(EFFECT_TYPES.DAMAGE, { amount: A[9].damage }), statusEffect("slow", { durationMs: statusDurationMs(9, "slow") })]),
    10: contract(DELIVERY_TYPES.SELF, [effect(EFFECT_TYPES.HEALING, { amount: A[10].healing })]),
    11: contract(DELIVERY_TYPES.TRAP, [effect(EFFECT_TYPES.DAMAGE, { amount: A[11].damage }), effect(EFFECT_TYPES.SPAWN_ENTITY, { entityType: "proximity_mine" })]),
    12: contract(DELIVERY_TYPES.RAY, [effect(EFFECT_TYPES.DAMAGE, { falloff: A[12].falloff })]),
    13: contract(DELIVERY_TYPES.RAY, [effect(EFFECT_TYPES.DAMAGE, { amount: A[13].damage }), statusEffect("shock", { durationMs: statusDurationMs(13, "shock") })]),
    14: contract(DELIVERY_TYPES.PROJECTILE, [effect(EFFECT_TYPES.PULL, { amount: A[14].pullPerTick }), effect(EFFECT_TYPES.DAMAGE, { falloff: A[14].falloff }), effect(EFFECT_TYPES.SPAWN_ENTITY, { entityType: "gravity_zone" })]),
    15: contract(DELIVERY_TYPES.PROJECTILE, [statusEffect("silence", { durationMs: statusDurationMs(15, "silence") }), effect(EFFECT_TYPES.INTERRUPT, { durationMs: A[15].interruptMs }), effect(EFFECT_TYPES.SPAWN_ENTITY, { entityType: "silence_wave" })]),
    16: contract(DELIVERY_TYPES.SELF, [
        effect(EFFECT_TYPES.DAMAGE_REDUCTION, { amount: 0.5, multiplier: 0.5, durationMs: statusDurationMs(16, "damage_reduction") }),
        effect(EFFECT_TYPES.DAMAGE_REFLECTION, { amount: 0.5, multiplier: 0.5, durationMs: statusDurationMs(16, "damage_reflection") }),
    ]),
    17: contract(DELIVERY_TYPES.SUMMON, [effect(EFFECT_TYPES.DAMAGE, { amount: A[17].damage }), effect(EFFECT_TYPES.SPAWN_ENTITY, { entityType: "hunter_drone" })]),
    18: contract(DELIVERY_TYPES.PROJECTILE, [effect(EFFECT_TYPES.DAMAGE, { amount: A[18].damage }), effect(EFFECT_TYPES.KNOCKBACK, { amount: A[18].knockback }), effect(EFFECT_TYPES.SPAWN_ENTITY, { entityType: "windburst_projectile" })]),
    19: contract(DELIVERY_TYPES.SELF, [effect(EFFECT_TYPES.MOVEMENT, { distance: A[19].distance })], execution({
        blockedByStatus: "slow",
        movement: Object.freeze({
            distanceStat: "distance",
            durationStat: "durationMs",
            speedStat: "speed",
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
    24: contract(DELIVERY_TYPES.ZONE, [statusEffect("silence", { whileInside: true }), effect(EFFECT_TYPES.SPAWN_ENTITY, { entityType: "null_zone" })]),
    25: contract({ type: DELIVERY_TYPES.MELEE, geometry: HITBOX_GEOMETRIES.RECTANGLE, includeTargetRadius: true }, [effect(EFFECT_TYPES.TELEPORT, { distanceMode: TELEPORT_DISTANCE_MODES.CENTER_DISTANCE }), effect(EFFECT_TYPES.DAMAGE, { amount: A[25].damage })], execution({
        capture: Object.freeze({ hitboxOriginX: "x", hitboxOriginY: "y", hitboxRotation: "rotation" }),
        phaseFacingDefault: "0",
        teleportOncePerActivation: true,
    })),
    26: contract({ type: DELIVERY_TYPES.RADIAL, includeTargetRadius: true }, [effect(EFFECT_TYPES.DAMAGE, { amount: A[26].damage }), statusEffect("slow", { durationMs: statusDurationMs(26, "slow") }), effect(EFFECT_TYPES.KNOCKBACK, { amount: A[26].knockback })]),
    27: contract(DELIVERY_TYPES.ZONE, [effect(EFFECT_TYPES.PULL, { amount: A[27].pullPerTick }), effect(EFFECT_TYPES.DAMAGE, { falloff: A[27].falloff }), effect(EFFECT_TYPES.SPAWN_ENTITY, { entityType: "singularity_zone" })]),
    28: contract(DELIVERY_TYPES.PROJECTILE, [
        effect(EFFECT_TYPES.DAMAGE, { amount: A[28].damage }),
        effect(EFFECT_TYPES.PULL, { amount: A[28].pullPerTick }),
        statusEffect("slow", { durationMs: statusDurationMs(28, "slow") }),
        effect(EFFECT_TYPES.SPAWN_ENTITY, { entityType: "tether_bolt" }),
    ]),
    29: contract(DELIVERY_TYPES.TRAP, [
        effect(EFFECT_TYPES.DAMAGE, { amount: A[29].damage }),
        statusEffect("slow", { durationMs: statusDurationMs(29, "slow") }),
        effect(EFFECT_TYPES.INTERRUPT, { durationMs: A[29].interruptMs }),
        effect(EFFECT_TYPES.SPAWN_ENTITY, { entityType: "static_snare" }),
    ]),
    30: contract(DELIVERY_TYPES.RAY, [
        effect(EFFECT_TYPES.DAMAGE, { amount: A[30].damage }),
        effect(EFFECT_TYPES.INTERRUPT, { durationMs: A[30].interruptMs }),
        statusEffect("slow", { durationMs: statusDurationMs(30, "slow") }),
    ]),
    31: contract(DELIVERY_TYPES.SUMMON, [
        effect(EFFECT_TYPES.DAMAGE, { amount: A[31].damage }),
        effect(EFFECT_TYPES.KNOCKBACK, { amount: A[31].knockback }),
        effect(EFFECT_TYPES.SPAWN_ENTITY, { entityType: "repeller_drone" }),
    ]),
    32: contract(DELIVERY_TYPES.RAY, [
        effect(EFFECT_TYPES.DAMAGE, { falloff: A[32].falloff }),
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
    const normalizedDelivery = typeof delivery === "string" ? { type: delivery } : delivery;
    return Object.freeze({
        delivery: Object.freeze(normalizedDelivery),
        effects: Object.freeze(effects),
        execution: executionMetadata,
        // Direct abilities get one canonical phase automatically. Spawned
        // entity contracts may provide richer phase definitions through their
        // entity contract until the migration is complete.
        phases: Object.freeze(executionMetadata.phases ?? [defaultPhase(normalizedDelivery, effects)]),
    });
}

function defaultPhase(delivery, effects) {
    const type = phaseTypeForDelivery(delivery?.type);
    const hitbox = hitboxForDelivery(delivery);
    const phaseEffects = effects.filter(({ type: effectType }) => effectType !== EFFECT_TYPES.SPAWN_ENTITY);
    return abilityPhase("active", type, {
        hitbox,
        effects: phaseEffects,
        events: {
            [type === PHASE_TYPES.SELF ? PHASE_EVENT_TYPES.ACTIVATION : PHASE_EVENT_TYPES.COLLISION]: {
                actions: Object.freeze([PHASE_ACTIONS.APPLY_EFFECTS]),
            },
        },
        persistence: { mode: PERSISTENCE_MODES.ONCE },
    });
}

function phaseTypeForDelivery(delivery) {
    if (delivery === DELIVERY_TYPES.TRAP) return PHASE_TYPES.ZONE;
    if (delivery === DELIVERY_TYPES.RADIAL || delivery === DELIVERY_TYPES.ZONE) return PHASE_TYPES.ZONE;
    if (delivery === DELIVERY_TYPES.PROJECTILE) return PHASE_TYPES.PROJECTILE;
    if (delivery === DELIVERY_TYPES.SUMMON) return PHASE_TYPES.SUMMON;
    if (delivery === DELIVERY_TYPES.MELEE) {
        return PHASE_TYPES.MELEE;
    }
    if (delivery === DELIVERY_TYPES.RAY) return PHASE_TYPES.RAY;
    return PHASE_TYPES.SELF;
}

function hitboxForDelivery(delivery = {}) {
    const type = delivery.type;
    if (type === DELIVERY_TYPES.SELF || type === DELIVERY_TYPES.SUMMON) return null;
    if (type === DELIVERY_TYPES.RAY) {
        return { shape: "ray", range: "range", width: "hitboxWidth" };
    }
    if (type === DELIVERY_TYPES.RADIAL || type === DELIVERY_TYPES.ZONE || type === DELIVERY_TYPES.TRAP) {
        return { shape: "circle", radius: "radius" };
    }
    if (type === DELIVERY_TYPES.PROJECTILE) {
        return { shape: "rectangle", width: "hitboxWidth", length: "hitboxLength" };
    }
    if (delivery.geometry === HITBOX_GEOMETRIES.RECTANGLE) {
        return { shape: "rectangle", width: "hitboxWidth", length: "range" };
    }
    return { shape: "arc", range: "range", arc: "arc" };
}

export function abilityContract(abilityId) {
    const numericId = resolveAbilityId(abilityId);
    return numericId == null ? null : ABILITY_CONTRACTS[numericId] ?? null;
}

export function hasEffect(abilityId, effectType) {
    return Boolean(abilityContract(abilityId)?.effects.some(({ type }) => type === effectType));
}
