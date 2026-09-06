import { abilityId as resolveAbilityId } from "./AbilityRegistry.js";

/** Effect vocabulary. Concrete effect payloads live on the active phase. */
export const EFFECT_TYPES = Object.freeze({
    DAMAGE: "damage",
    HEALING: "healing",
    KNOCKBACK: "knockback",
    PULL: "pull",
    STATUS: "status",
    BUFF: "buff",
    INTERRUPT: "interrupt",
    TELEPORT: "teleport",
    RESTORE_STATE: "restore_state",
    DAMAGE_REDUCTION: "damage_reduction",
    DAMAGE_IMMUNITY: "damage_immunity",
    DAMAGE_REFLECTION: "damage_reflection",
});

/** Phase host vocabulary shared by attached and entity contracts. */
export const PHASE_TYPES = Object.freeze({
    SELF: "self",
    MELEE: "melee",
    RAY: "ray",
    ARC: "arc",
    PROJECTILE: "projectile",
    ZONE: "zone",
    SUMMON: "summon",
    BOT_ATTACHED: "botAttached",
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

export const TARGET_POLICY_MODES = Object.freeze({
    ONCE: "once",
    EVERY_TICK: "everyTick",
    INTERVAL: "interval",
});

export const TELEPORT_DISTANCE_MODES = Object.freeze({
    CENTER_DISTANCE: "center_distance",
});

export const effect = (type, values = {}) => Object.freeze({ type, ...values });
export const statusEffect = (subtype, values = {}) => effect(EFFECT_TYPES.STATUS, { subtype, ...values });

/**
 * Normalized phase envelope used by both runtime adapters. Geometry, movement,
 * visuals, events, and concrete effects are all owned by this phase.
 */
export function abilityPhase(id, type, values = {}) {
    return Object.freeze({
        id,
        type,
        ...values,
        ...(values.movement ? { movement: Object.freeze({ ...values.movement }) } : {}),
        ...(values.hitbox ? { hitbox: Object.freeze({ ...values.hitbox }) } : {}),
        ...(values.events ? { events: Object.freeze({ ...values.events }) } : {}),
        ...(values.visual ? { visual: Object.freeze({ ...values.visual }) } : {}),
        effects: Object.freeze([...(values.effects ?? [])]),
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

const applyEffectsEvent = (effects) => Object.freeze({
    actions: Object.freeze([PHASE_ACTIONS.APPLY_EFFECTS]),
    effectTypes: Object.freeze([...new Set(effects.map(({ type }) => type).filter(Boolean))]),
});

/** Builds one phase hosted by the casting bot. */
function attachedPhase({
    id = "active",
    hitbox = null,
    movement = null,
    effects = [],
    eventType = null,
    visual = null,
    durationMs = null,
    effectOverrides = null,
}) {
    return abilityPhase(id, PHASE_TYPES.BOT_ATTACHED, {
        hitbox,
        movement,
        effects,
        visual,
        durationMs,
        effectOverrides,
        events: eventType ? { [eventType]: applyEffectsEvent(effects) } : {},
    });
}

function attachedAbility({ activation = {}, phase }) {
    return Object.freeze({
        activation: Object.freeze({ ...activation }),
        phases: Object.freeze([phase]),
    });
}

const collisionPhase = (values) => attachedPhase({
    ...values,
    eventType: PHASE_EVENT_TYPES.COLLISION,
});

const activationPhase = (values) => attachedPhase({
    ...values,
    eventType: PHASE_EVENT_TYPES.ACTIVATION,
});

/**
 * Authoritative behavior contracts for abilities that stay attached to their
 * owner. Entity-producing abilities are intentionally absent; their complete
 * behavior is defined in EntityContracts by ability ID.
 */
const BASE_ATTACHED_ABILITY_CONTRACTS_BY_ID = Object.freeze({
    1: attachedAbility({
        phase: collisionPhase({
            hitbox: { shape: "arc", range: 92, arc: 120, includeTargetRadius: true },
            effects: [effect(EFFECT_TYPES.DAMAGE, { amount: 20 })],
            visual: { type: "meleeSlash", visualSize: 207, visibleMs: 400 },
        }),
    }),
    3: attachedAbility({
        activation: {
            capture: Object.freeze({ gunRayOriginX: "x", gunRayOriginY: "y", gunRayRotation: "rotation" }),
        },
        phase: collisionPhase({
            hitbox: { shape: "ray", range: 700, width: 5 },
            effects: [effect(EFFECT_TYPES.DAMAGE, {
                falloff: { maxAmount: 15, minAmount: 5, falloffStart: 100, falloffEnd: 700 },
            })],
            visual: { type: "gun", visualSize: 16, visibleMs: 500 },
        }),
    }),
    6: attachedAbility({
        phase: collisionPhase({
            hitbox: { shape: "rectangle", length: 184, width: 80, includeTargetRadius: true },
            effects: [effect(EFFECT_TYPES.DAMAGE, { amount: 10 }), statusEffect("stun", { durationMs: 1200 })],
            visual: { type: "stun", visualSize: 60, visibleMs: 100 },
        }),
    }),
    7: attachedAbility({
        phase: collisionPhase({
            hitbox: { shape: "arc", range: 115, arc: 150, includeTargetRadius: true },
            effects: [effect(EFFECT_TYPES.DAMAGE, { amount: 30 }), statusEffect("bleed", {
                amount: 2, durationMs: 5000, intervalMs: 1000,
            })],
            visual: { type: "heavySlash", visualSize: 220.8, visibleMs: 400 },
        }),
    }),
    8: attachedAbility({
        phase: collisionPhase({
            hitbox: { shape: "circle", radius: 110, includeTargetRadius: true },
            effects: [effect(EFFECT_TYPES.DAMAGE, { amount: 20 }), effect(EFFECT_TYPES.KNOCKBACK, { amount: 250 })],
            visual: { type: "repulsorBurst", visualSize: 220, visibleMs: 500 },
        }),
    }),
    9: attachedAbility({
        phase: collisionPhase({
            hitbox: { shape: "ray", range: 500, width: 5 },
            effects: [effect(EFFECT_TYPES.DAMAGE, { amount: 20 }), statusEffect("slow", { durationMs: 1000 })],
            visual: { type: "concussiveShot", visualSize: 76, visibleMs: 300 },
        }),
    }),
    10: attachedAbility({
        phase: activationPhase({
            effects: [effect(EFFECT_TYPES.HEALING, { amount: 25 })],
            visual: { type: "basicHeal", visualSize: 12, visibleMs: 300 },
        }),
    }),
    12: attachedAbility({
        phase: collisionPhase({
            hitbox: { shape: "ray", range: 500, width: 5 },
            effects: [effect(EFFECT_TYPES.DAMAGE, {
                falloff: { maxAmount: 8, minAmount: 4, falloffStart: 0, falloffEnd: 333.33 },
            })],
            visual: { type: "pistol", visualSize: 14, visibleMs: 300 },
        }),
    }),
    13: attachedAbility({
        phase: collisionPhase({
            hitbox: { shape: "ray", range: 900, width: 5 },
            effects: [effect(EFFECT_TYPES.DAMAGE, { amount: 40 }), statusEffect("shock", {
                amount: 3, durationMs: 3000, intervalMs: 1000, movementLockMs: 300,
            })],
            visual: { type: "railShot", visualSize: 100, visibleMs: 300 },
        }),
    }),
    16: attachedAbility({
        phase: activationPhase({
            effects: [
                effect(EFFECT_TYPES.DAMAGE_REDUCTION, { amount: 0.5, multiplier: 0.5, durationMs: 4000 }),
                effect(EFFECT_TYPES.DAMAGE_REFLECTION, { amount: 0.5, multiplier: 0.5, durationMs: 4000 }),
            ],
            visual: { type: "reactiveArmor", visualSize: 80, visibleMs: 300 },
        }),
    }),
    19: attachedAbility({
        phase: activationPhase({
            movement: { distance: 150, speed: 75, trailMs: 300, blockedByStatus: "slow" },
            visual: { type: "dash", visualSize: 114, visibleMs: 300 },
        }),
    }),
    20: attachedAbility({
        activation: { targetMode: "target", faceTargetFromPayload: true },
        phase: attachedPhase({ visual: { type: "lockOn", visualSize: 48, visibleMs: 200 } }),
    }),
    23: attachedAbility({
        phase: activationPhase({
            effects: [effect(EFFECT_TYPES.DAMAGE_IMMUNITY, { amount: 1, durationMs: 1500 })],
            visual: { type: "absoluteGuard", visualSize: 80, visibleMs: 300 },
        }),
    }),
    25: attachedAbility({
        activation: {
            capture: Object.freeze({ hitboxOriginX: "x", hitboxOriginY: "y", hitboxRotation: "rotation" }),
            phaseFacingDefault: "0",
            teleportOncePerActivation: true,
        },
        phase: collisionPhase({
            hitbox: { shape: "rectangle", length: 100, width: 60, includeTargetRadius: true },
            effects: [
                effect(EFFECT_TYPES.TELEPORT, { distanceMode: TELEPORT_DISTANCE_MODES.CENTER_DISTANCE }),
                effect(EFFECT_TYPES.DAMAGE, { amount: 15 }),
            ],
            visual: { type: "phaseStrike", visualSize: 100, visibleMs: 300 },
        }),
    }),
    26: attachedAbility({
        phase: collisionPhase({
            hitbox: { shape: "circle", radius: 120, includeTargetRadius: true },
            effects: [
                effect(EFFECT_TYPES.DAMAGE, { amount: 15 }),
                statusEffect("slow", { durationMs: 1500 }),
                effect(EFFECT_TYPES.KNOCKBACK, { amount: 60 }),
            ],
            visual: { type: "frostRing", visualSize: 240, visibleMs: 300 },
        }),
    }),
    30: attachedAbility({
        phase: collisionPhase({
            hitbox: { shape: "ray", range: 600, width: 8 },
            effects: [
                effect(EFFECT_TYPES.DAMAGE, { amount: 15 }),
                effect(EFFECT_TYPES.INTERRUPT, { durationMs: 250 }),
                statusEffect("slow", { durationMs: 2000 }),
            ],
            visual: { type: "disruptorDart", visualSize: 8, visibleMs: 300 },
        }),
    }),
    32: attachedAbility({
        phase: collisionPhase({
            hitbox: { shape: "ray", range: 500, width: 10 },
            effects: [
                effect(EFFECT_TYPES.DAMAGE, {
                    falloff: { maxAmount: 25, minAmount: 15, falloffStart: 0, falloffEnd: 500 },
                }),
                effect(EFFECT_TYPES.HEALING, {
                    recipient: "source", requiresConfirmedDamage: true, mirrorsDamage: true,
                }),
            ],
            visual: { type: "vampiricBeam", visualSize: 10, visibleMs: 300 },
        }),
    }),
    33: attachedAbility({
        phase: activationPhase({
            effects: [effect(EFFECT_TYPES.BUFF, {
                buff: "overclock", amount: 0.5, multiplier: 0.5, durationMs: 4000,
            })],
            visual: { type: "overclock", visualSize: 80, visibleMs: 300 },
        }),
    }),
    34: attachedAbility({
        phase: collisionPhase({
            hitbox: { shape: "arc", range: 80, arc: 30, includeTargetRadius: true },
            effects: [effect(EFFECT_TYPES.DAMAGE, { amount: 8 })],
            visual: { type: "basicStrike", visualSize: 80, visibleMs: 200 },
        }),
    }),
});

export const ATTACHED_ABILITY_CONTRACTS = BASE_ATTACHED_ABILITY_CONTRACTS_BY_ID;

export function attachedAbilityContract(abilityId) {
    const numericId = resolveAbilityId(abilityId);
    return numericId == null ? null : ATTACHED_ABILITY_CONTRACTS[numericId] ?? null;
}

export function phaseForAttachedAbility(abilityId) {
    return attachedAbilityContract(abilityId)?.phases?.[0] ?? null;
}

/** True when the phase applies its effects to the owner at activation. */
export function attachedAbilityTargetsOwner(abilityId) {
    return Boolean(phaseForAttachedAbility(abilityId)?.events?.[PHASE_EVENT_TYPES.ACTIVATION]);
}

export function hasEffect(abilityId, effectType) {
    return effectsForAttachedAbility(abilityId).some(({ type }) => type === effectType);
}

/** Returns the concrete effect instances owned by the attached phases. */
export function effectsForAttachedAbility(abilityId) {
    return phaseForAttachedAbility(abilityId)?.effects ?? [];
}

export function isAttachedAbility(abilityId) {
    return attachedAbilityContract(abilityId) != null;
}
