import { abilityId as resolveAbilityId } from "../../gameconfig/AbilityRegistry.js";

/**
 * One canonical allowlisted ability contract registry for both direct bot
 * abilities and ability-created entities. The runtime consumes normalized data;
 * it never executes user-provided code.
 */
export const ENTITY_CATEGORIES = Object.freeze({
    BOT_ATTACHED: "botAttached",
    PROJECTILE: "projectile",
    ZONE: "zone",
    TRAP: "trap",
    SUMMON: "summon",
});

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
    TRIGGER: "trigger",
    HIT: "hit",
    KILLED: "killed",
    LIFETIME_END: "lifetimeEnd",
    ENTER: "enter",
    EXIT: "exit",
});

/** Determines when any phase event is evaluated. */
export const EVENT_SCHEDULE_MODES = Object.freeze({
    ONCE: "once",
    REPEAT: "repeat",
    CONTINUOUS: "continuous",
});

export const SPAWN_ROTATION_SPACES = Object.freeze({
    OWNER: "owner",
    WORLD: "world",
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

/** Semantic target categories used by entity collision events. */
export const TARGET_KINDS = Object.freeze({
    BOT: "BOT",
    HP_ENTITY: "HP_ENTITY",
    ENTITY: "ENTITY",
});

export const BOT_TARGET_KINDS = Object.freeze([TARGET_KINDS.BOT]);
export const DAMAGE_TARGET_KINDS = Object.freeze([TARGET_KINDS.BOT, TARGET_KINDS.HP_ENTITY]);

export const TELEPORT_DISTANCE_MODES = Object.freeze({
    CENTER_DISTANCE: "center_distance",
});

export const effect = (type, values = {}) => Object.freeze({ type, ...values });
export const statusEffect = (subtype, values = {}) => effect(EFFECT_TYPES.STATUS, { subtype, ...values });

/**
 * An omitted targetKinds list preserves the original bot-targeting behavior.
 * Supplying a list makes the event's collision scope explicit.
 */
export function eventTargetsKind(event, targetKind) {
    const targetKinds = event?.targetKinds;
    return !Array.isArray(targetKinds) || targetKinds.length === 0
        ? targetKind === TARGET_KINDS.BOT
        : targetKinds.includes(targetKind);
}

/** Returns whether an event selected a concrete phase effect for execution. */
export function eventAllowsEffect(event, effect) {
    if (!effect?.type) return false;
    const allowedTypes = event?.effectTypes ?? event?.effects ?? null;
    if (Array.isArray(allowedTypes) && allowedTypes.length > 0) {
        const typeSet = new Set(allowedTypes.map((value) =>
            typeof value === "string" ? value : value?.type).filter(Boolean));
        if (!typeSet.has(effect.type)) return false;
    }
    const allowedStatuses = event?.statusTypes;
    if (effect.type === EFFECT_TYPES.STATUS
        && Array.isArray(allowedStatuses)
        && allowedStatuses.length > 0) {
        return allowedStatuses.some((statusType) =>
            String(statusType).toLowerCase() === String(effect.subtype ?? "").toLowerCase());
    }
    return true;
}

function defaultEventSchedule(eventType) {
    return {
        mode: eventType === PHASE_EVENT_TYPES.COLLISION
            ? EVENT_SCHEDULE_MODES.CONTINUOUS
            : EVENT_SCHEDULE_MODES.ONCE,
    };
}

function normalizeEventSchedule(schedule, eventType) {
    const source = schedule && typeof schedule === "object" ? schedule : {};
    const allowedModes = Object.values(EVENT_SCHEDULE_MODES);
    let mode = allowedModes.includes(source.mode)
        ? source.mode
        : defaultEventSchedule(eventType).mode;
    // Continuous evaluation is meaningful only for collision detection. All
    // other event kinds remain one-shot unless explicitly repeated.
    if (mode === EVENT_SCHEDULE_MODES.CONTINUOUS
        && eventType !== PHASE_EVENT_TYPES.COLLISION) {
        mode = EVENT_SCHEDULE_MODES.ONCE;
    }
    const intervalMs = Number(source.intervalMs);
    const count = Number(source.count);
    return Object.freeze({
        ...source,
        mode,
        ...(mode === EVENT_SCHEDULE_MODES.REPEAT
            ? {
                intervalMs: Number.isFinite(intervalMs) && intervalMs > 0 ? intervalMs : 1,
                ...(Number.isFinite(count) && count > 0
                    ? { count: Math.max(1, Math.trunc(count)) }
                    : {}),
                startImmediately: source.startImmediately == null
                    ? true : Boolean(source.startImmediately),
            }
            : {}),
    });
}

function normalizeEvents(events) {
    return Object.freeze(Object.fromEntries(Object.entries(events).map(([eventType, event]) => {
        if (!event || typeof event !== "object") return [eventType, event];
        return [eventType, Object.freeze({
            ...event,
            schedule: normalizeEventSchedule(event.schedule, eventType),
            ...(Array.isArray(event.actions)
                ? { actions: Object.freeze([...event.actions]) }
                : {}),
            ...(Array.isArray(event.effectTypes)
                ? { effectTypes: Object.freeze([...event.effectTypes]) }
                : {}),
            ...(Array.isArray(event.statusTypes)
                ? { statusTypes: Object.freeze([...new Set(event.statusTypes
                    .map((statusType) => String(statusType).toLowerCase()).filter(Boolean))]) }
                : {}),
            ...(Array.isArray(event.targetKinds)
                ? { targetKinds: Object.freeze([...new Set(event.targetKinds.filter(Boolean))]) }
                : {}),
        })];
    })));
}

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
        ...(values.health ? { health: Object.freeze({ ...values.health }) } : {}),
        ...(values.events ? { events: normalizeEvents(values.events) } : {}),
        ...(values.execution ? { execution: Object.freeze({ ...values.execution }) } : {}),
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

/** A small contract-defined ability owned by an entity such as a drone. */
function normalizeSpawn(spawn = null) {
    const source = spawn && typeof spawn === "object" ? spawn : {};
    const legacyRotation = source.rotation;
    const rotationSpace = legacyRotation === "zero"
        || source.rotationSpace === SPAWN_ROTATION_SPACES.WORLD
        ? SPAWN_ROTATION_SPACES.WORLD
        : SPAWN_ROTATION_SPACES.OWNER;
    const rawRotation = legacyRotation === "owner" || legacyRotation === "zero"
        || legacyRotation == null ? 0 : Number(legacyRotation);
    const rotation = Number.isFinite(rawRotation)
        ? Math.max(-360, Math.min(360, rawRotation)) : 0;
    return Object.freeze({
        offset: Object.freeze({
            x: Number(source.offset?.x ?? 0),
            y: Number(source.offset?.y ?? 0),
        }),
        rotation,
        rotationSpace,
    });
}

const entityAbility = (id, { phases = [], spawn = null } = {}) => Object.freeze({
    id,
    spawn: normalizeSpawn(spawn),
    phases: Object.freeze(phases ?? []),
});

/**
 * Builds the normalized phase envelope used by every ability contract.
 *
 * The object form is a small authoring convenience shared by attached and
 * spawned phases. Event selection is always declared in the phase's `events`
 * object; there is no separate eventType field.
 */
export function phase(idOrValues, type = PHASE_TYPES.BOT_ATTACHED, values = {}) {
    if (idOrValues && typeof idOrValues === "object" && !Array.isArray(idOrValues)) {
        const {
            id = "active",
            type: objectType = PHASE_TYPES.BOT_ATTACHED,
            ...phaseValues
        } = idOrValues;
        return abilityPhase(id, objectType, phaseValues);
    }
    return abilityPhase(idOrValues, type, values);
}

function attachedAbility({ activation = {}, phase: activePhase, spawn = null }) {
    return Object.freeze({
        activation: Object.freeze({ ...activation }),
        spawn: normalizeSpawn(spawn),
        phases: Object.freeze([activePhase]),
    });
}
/**
 * Authoritative behavior contracts for abilities that stay attached to their
 * owner. Entity-producing abilities are intentionally absent; their complete
 * behavior is defined in the unified registry by ability ID.
 */
const RAW_ATTACHED_ABILITY_CONTRACTS_BY_ID = Object.freeze({
    1: attachedAbility({
        phase: phase({
            hitbox: { shape: "arc", range: 92, arc: 120, includeTargetRadius: true },
            effects: [effect(EFFECT_TYPES.DAMAGE, { amount: 20 })],
            visual: { type: "meleeSlash", visualSize: 207, visibleMs: 400 },
            events: { [PHASE_EVENT_TYPES.COLLISION]: { actions: [PHASE_ACTIONS.APPLY_EFFECTS],
                schedule: { mode: EVENT_SCHEDULE_MODES.ONCE }, targetKinds: DAMAGE_TARGET_KINDS } },
        }),
    }),
    3: attachedAbility({
        activation: {
            capture: Object.freeze({ gunRayOriginX: "x", gunRayOriginY: "y", gunRayRotation: "rotation" }),
        },
        phase: phase({
            hitbox: { shape: "ray", range: 700, width: 5 },
            effects: [effect(EFFECT_TYPES.DAMAGE, {
                falloff: { maxAmount: 15, minAmount: 5, falloffStart: 100, falloffEnd: 700 },
            })],
            visual: { type: "gun", visualSize: 16, visibleMs: 500 },
            events: { [PHASE_EVENT_TYPES.COLLISION]: { actions: [PHASE_ACTIONS.APPLY_EFFECTS],
                schedule: { mode: EVENT_SCHEDULE_MODES.ONCE }, targetKinds: DAMAGE_TARGET_KINDS } },
        }),
    }),
    6: attachedAbility({
        phase: phase({
            hitbox: { shape: "rectangle", length: 184, width: 80, includeTargetRadius: true },
            effects: [effect(EFFECT_TYPES.DAMAGE, { amount: 10 }), statusEffect("stun", { durationMs: 1200 })],
            visual: { type: "stun", visualSize: 60, visibleMs: 100 },
            events: { [PHASE_EVENT_TYPES.COLLISION]: { actions: [PHASE_ACTIONS.APPLY_EFFECTS],
                schedule: { mode: EVENT_SCHEDULE_MODES.ONCE }, targetKinds: DAMAGE_TARGET_KINDS } },
        }),
    }),
    7: attachedAbility({
        phase: phase({
            hitbox: { shape: "arc", range: 115, arc: 150, includeTargetRadius: true },
            effects: [effect(EFFECT_TYPES.DAMAGE, { amount: 30 }), statusEffect("bleed", {
                amount: 2, durationMs: 5000, intervalMs: 1000,
            })],
            visual: { type: "heavySlash", visualSize: 220.8, visibleMs: 400 },
            events: { [PHASE_EVENT_TYPES.COLLISION]: { actions: [PHASE_ACTIONS.APPLY_EFFECTS],
                schedule: { mode: EVENT_SCHEDULE_MODES.ONCE }, targetKinds: DAMAGE_TARGET_KINDS } },
        }),
    }),
    8: attachedAbility({
        phase: phase({
            hitbox: { shape: "circle", radius: 110, includeTargetRadius: true },
            effects: [effect(EFFECT_TYPES.DAMAGE, { amount: 20 }), effect(EFFECT_TYPES.KNOCKBACK, { amount: 250 })],
            visual: { type: "repulsorBurst", visualSize: 220, visibleMs: 500 },
            events: { [PHASE_EVENT_TYPES.COLLISION]: { actions: [PHASE_ACTIONS.APPLY_EFFECTS],
                schedule: { mode: EVENT_SCHEDULE_MODES.ONCE }, targetKinds: DAMAGE_TARGET_KINDS } },
        }),
    }),
    9: attachedAbility({
        phase: phase({
            hitbox: { shape: "ray", range: 500, width: 5 },
            effects: [effect(EFFECT_TYPES.DAMAGE, { amount: 20 }), statusEffect("slow", { durationMs: 1000 })],
            visual: { type: "concussiveShot", visualSize: 76, visibleMs: 300 },
            events: { [PHASE_EVENT_TYPES.COLLISION]: { actions: [PHASE_ACTIONS.APPLY_EFFECTS],
                schedule: { mode: EVENT_SCHEDULE_MODES.ONCE }, targetKinds: DAMAGE_TARGET_KINDS } },
        }),
    }),
    10: attachedAbility({
        phase: phase({
            effects: [effect(EFFECT_TYPES.HEALING, { amount: 25 })],
            visual: { type: "basicHeal", visualSize: 12, visibleMs: 300 },
            events: { [PHASE_EVENT_TYPES.ACTIVATION]: { actions: [PHASE_ACTIONS.APPLY_EFFECTS],
                schedule: { mode: EVENT_SCHEDULE_MODES.ONCE } } },
        }),
    }),
    12: attachedAbility({
        phase: phase({
            hitbox: { shape: "ray", range: 500, width: 5 },
            effects: [effect(EFFECT_TYPES.DAMAGE, {
                falloff: { maxAmount: 8, minAmount: 4, falloffStart: 0, falloffEnd: 333.33 },
            })],
            visual: { type: "pistol", visualSize: 14, visibleMs: 300 },
            events: { [PHASE_EVENT_TYPES.COLLISION]: { actions: [PHASE_ACTIONS.APPLY_EFFECTS],
                schedule: { mode: EVENT_SCHEDULE_MODES.ONCE }, targetKinds: DAMAGE_TARGET_KINDS } },
        }),
    }),
    13: attachedAbility({
        phase: phase({
            hitbox: { shape: "ray", range: 900, width: 5 },
            effects: [effect(EFFECT_TYPES.DAMAGE, { amount: 40 }), statusEffect("shock", {
                amount: 3, durationMs: 3000, intervalMs: 1000, movementLockMs: 300,
            })],
            visual: { type: "railShot", visualSize: 100, visibleMs: 300 },
            events: { [PHASE_EVENT_TYPES.COLLISION]: { actions: [PHASE_ACTIONS.APPLY_EFFECTS],
                schedule: { mode: EVENT_SCHEDULE_MODES.ONCE }, targetKinds: DAMAGE_TARGET_KINDS } },
        }),
    }),
    16: attachedAbility({
        phase: phase({
            effects: [
                effect(EFFECT_TYPES.DAMAGE_REDUCTION, { amount: 0.5, multiplier: 0.5, durationMs: 4000 }),
                effect(EFFECT_TYPES.DAMAGE_REFLECTION, { amount: 0.5, multiplier: 0.5, durationMs: 4000 }),
            ],
            visual: { type: "reactiveArmor", visualSize: 80, visibleMs: 300 },
            events: { [PHASE_EVENT_TYPES.ACTIVATION]: { actions: [PHASE_ACTIONS.APPLY_EFFECTS],
                schedule: { mode: EVENT_SCHEDULE_MODES.ONCE } } },
        }),
    }),
    19: attachedAbility({
        phase: phase({
            movement: { distance: 150, speed: 75, trailMs: 300, blockedByStatus: "slow" },
            visual: { type: "dash", visualSize: 114, visibleMs: 300 },
            events: { [PHASE_EVENT_TYPES.ACTIVATION]: { actions: [PHASE_ACTIONS.APPLY_EFFECTS],
                schedule: { mode: EVENT_SCHEDULE_MODES.ONCE } } },
        }),
    }),
    20: attachedAbility({
        activation: { targetMode: "target", faceTargetFromPayload: true },
        phase: phase({ visual: { type: "lockOn", visualSize: 48, visibleMs: 200 } }),
    }),
    23: attachedAbility({
        phase: phase({
            effects: [effect(EFFECT_TYPES.DAMAGE_IMMUNITY, { amount: 1, durationMs: 1500 })],
            visual: { type: "absoluteGuard", visualSize: 80, visibleMs: 300 },
            events: { [PHASE_EVENT_TYPES.ACTIVATION]: { actions: [PHASE_ACTIONS.APPLY_EFFECTS],
                schedule: { mode: EVENT_SCHEDULE_MODES.ONCE } } },
        }),
    }),
    25: attachedAbility({
        activation: {
            capture: Object.freeze({ hitboxOriginX: "x", hitboxOriginY: "y", hitboxRotation: "rotation" }),
            phaseFacingDefault: "0",
            teleportOncePerActivation: true,
        },
        phase: phase({
            hitbox: { shape: "rectangle", length: 100, width: 60, includeTargetRadius: true },
            effects: [
                effect(EFFECT_TYPES.TELEPORT, { distanceMode: TELEPORT_DISTANCE_MODES.CENTER_DISTANCE }),
                effect(EFFECT_TYPES.DAMAGE, { amount: 15 }),
            ],
            visual: { type: "phaseStrike", visualSize: 100, visibleMs: 300 },
            events: { [PHASE_EVENT_TYPES.COLLISION]: { actions: [PHASE_ACTIONS.APPLY_EFFECTS],
                schedule: { mode: EVENT_SCHEDULE_MODES.ONCE }, targetKinds: DAMAGE_TARGET_KINDS } },
        }),
    }),
    26: attachedAbility({
        phase: phase({
            hitbox: { shape: "circle", radius: 120, includeTargetRadius: true },
            effects: [
                effect(EFFECT_TYPES.DAMAGE, { amount: 15 }),
                statusEffect("slow", { durationMs: 1500 }),
                effect(EFFECT_TYPES.KNOCKBACK, { amount: 60 }),
            ],
            visual: { type: "frostRing", visualSize: 240, visibleMs: 300 },
            events: { [PHASE_EVENT_TYPES.COLLISION]: { actions: [PHASE_ACTIONS.APPLY_EFFECTS],
                schedule: { mode: EVENT_SCHEDULE_MODES.ONCE }, targetKinds: DAMAGE_TARGET_KINDS } },
        }),
    }),
    30: attachedAbility({
        phase: phase({
            hitbox: { shape: "ray", range: 600, width: 8 },
            effects: [
                effect(EFFECT_TYPES.DAMAGE, { amount: 15 }),
                effect(EFFECT_TYPES.INTERRUPT, { durationMs: 250 }),
                statusEffect("slow", { durationMs: 2000 }),
            ],
            visual: { type: "disruptorDart", visualSize: 8, visibleMs: 300 },
            events: { [PHASE_EVENT_TYPES.COLLISION]: { actions: [PHASE_ACTIONS.APPLY_EFFECTS],
                schedule: { mode: EVENT_SCHEDULE_MODES.ONCE }, targetKinds: DAMAGE_TARGET_KINDS } },
        }),
    }),
    32: attachedAbility({
        phase: phase({
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
            events: { [PHASE_EVENT_TYPES.COLLISION]: { actions: [PHASE_ACTIONS.APPLY_EFFECTS],
                schedule: { mode: EVENT_SCHEDULE_MODES.ONCE }, targetKinds: DAMAGE_TARGET_KINDS } },
        }),
    }),
    33: attachedAbility({
        phase: phase({
            effects: [effect(EFFECT_TYPES.BUFF, {
                buff: "overclock", amount: 0.5, multiplier: 0.5, durationMs: 4000,
            })],
            visual: { type: "overclock", visualSize: 80, visibleMs: 300 },
            events: { [PHASE_EVENT_TYPES.ACTIVATION]: { actions: [PHASE_ACTIONS.APPLY_EFFECTS],
                schedule: { mode: EVENT_SCHEDULE_MODES.ONCE } } },
        }),
    }),
    34: attachedAbility({
        phase: phase({
            hitbox: { shape: "arc", range: 80, arc: 30, includeTargetRadius: true },
            effects: [effect(EFFECT_TYPES.DAMAGE, { amount: 8 })],
            visual: { type: "basicStrike", visualSize: 80, visibleMs: 200 },
            events: { [PHASE_EVENT_TYPES.COLLISION]: { actions: [PHASE_ACTIONS.APPLY_EFFECTS],
                schedule: { mode: EVENT_SCHEDULE_MODES.ONCE }, targetKinds: DAMAGE_TARGET_KINDS } },
        }),
    }),
});

/**
 * Direct bot abilities are normalized into the same top-level shape as
 * ability-created entities. They simply use the botAttached category and have
 * no entity lifecycle fields beyond their empty defaults.
 */
export const ATTACHED_ABILITY_CONTRACTS = Object.freeze(Object.fromEntries(
    Object.entries(RAW_ATTACHED_ABILITY_CONTRACTS_BY_ID).map(([id, definition]) => [id, Object.freeze({
        abilityId: Number(id),
        entityType: null,
        runtimeType: null,
        category: ENTITY_CATEGORIES.BOT_ATTACHED,
        spawn: normalizeSpawn(definition.spawn),
        targeting: Object.freeze({ owner: "owner" }),
        lifetime: Object.freeze({}),
        state: Object.freeze({}),
        activation: Object.freeze({ ...(definition.activation ?? {}) }),
        phases: Object.freeze(definition.phases ?? []),
        abilities: Object.freeze(definition.abilities ?? []),
    })])
));

const contextValue = (name, fallback = null) => Object.freeze({ context: name, fallback });
const ownerStat = (name, fallback = 0) => Object.freeze({ ownerStat: name, fallback });
const visual = (type, visualSize, state = null, visibleMs = null, lifecycle = null) => Object.freeze({
    type,
    ...(state == null ? {} : { state }),
    visualSize,
    ...(visibleMs == null ? {} : { visibleMs }),
    ...(lifecycle == null ? {} : { lifecycle }),
});

const entity = (abilityId, definition) => {
    const base = {
        abilityId,
        activation: Object.freeze({}),
        ...definition,
        spawn: normalizeSpawn(definition.spawn),
        targeting: Object.freeze({ owner: "owner", ...(definition.targeting ?? {}) }),
        lifetime: Object.freeze({ ...(definition.lifetime ?? {}) }),
        state: Object.freeze({ ...(definition.state ?? {}) }),
    };
    return Object.freeze({
        ...base,
        phases: Object.freeze(definition.phases ?? []),
        abilities: Object.freeze(definition.abilities ?? []),
    });
};

/**
 * The keys are the stable numeric ability IDs declared by AbilityRegistry.
 * `entityType` is the stable authored label and `runtimeType` is the
 * camelCase payload value used by the arena.
 */
export const ENTITY_CONTRACTS = Object.freeze({
    4: entity(4, {
        entityType: "grenade",
        runtimeType: "grenade",
        category: ENTITY_CATEGORIES.PROJECTILE,
        // Offset is measured from the owner's center in arena units.
        spawn: { offset: { x: 0, y: 38 }, rotation: 0, rotationSpace: "world" },
        state: { damageMultiplier: contextValue("damageMultiplier", ownerStat("attackDamageMultiplier", 1)) },
        phases: Object.freeze([
            phase("travel", PHASE_TYPES.PROJECTILE, {
                movement: { speed: 32 },
                hitbox: { shape: "rectangle", width: 12, length: 12 },
                visual: visual("grenade", 12, "moving"),
                durationMs: 1000,
                events: {
                    [PHASE_EVENT_TYPES.COLLISION]: { targetKinds: BOT_TARGET_KINDS, actions: [PHASE_ACTIONS.TRANSITION], transition: { to: "active" } },
                    [PHASE_EVENT_TYPES.LIFETIME_END]: { actions: [PHASE_ACTIONS.TRANSITION], transition: { to: "armed" } },
                },
            }),
            phase("armed", PHASE_TYPES.PROJECTILE, {
                // Armed is reached when the fixed one-second travel phase ends.
                transitionOnly: true,
                movement: { speed: 0 },
                hitbox: { shape: "rectangle", width: 12, length: 12 },
                durationMs: 1000,
                visual: visual("grenade", 12, "static"),
                events: {
                    [PHASE_EVENT_TYPES.COLLISION]: { targetKinds: BOT_TARGET_KINDS, actions: [PHASE_ACTIONS.TRANSITION], transition: { to: "active" } },
                    [PHASE_EVENT_TYPES.LIFETIME_END]: { actions: [PHASE_ACTIONS.TRANSITION], transition: { to: "active" } },
                },
            }),
            phase("active", PHASE_TYPES.ZONE, {
                // The explosion is reached by collision or armed-phase expiry;
                // it is not an elapsed-time phase from the grenade's spawn.
                transitionOnly: true,
                movement: { speed: 0 },
                hitbox: { shape: "circle", radius: 70 },
                effects: [effect(EFFECT_TYPES.DAMAGE, { falloff: { maxAmount: 40, minAmount: 25, falloffStart: 0, falloffEnd: 64 } })],
                durationMs: 100,
                visual: visual("grenadeExplosion", 140, null, 200, "event"),
                events: {
                    [PHASE_EVENT_TYPES.COLLISION]: {
                        targetKinds: DAMAGE_TARGET_KINDS,
                        actions: [PHASE_ACTIONS.APPLY_EFFECTS, PHASE_ACTIONS.EMIT_VISUAL],
                        visualType: "grenadeExplosion",
                        visibleMs: 200,
                        visualSize: 140,
                        schedule: { mode: EVENT_SCHEDULE_MODES.ONCE },
                    },
                },
            }),
        ]),
    }),
    5: entity(5, {
        entityType: "fireball",
        runtimeType: "fireball",
        category: ENTITY_CATEGORIES.PROJECTILE,
        spawn: { offset: { x: 0, y: 47 }, rotation: 0, rotationSpace: "owner" },
        lifetime: { duration: 1200 },
        state: {
            damageMultiplier: contextValue("damageMultiplier", ownerStat("attackDamageMultiplier", 1)),
        },
        phases: Object.freeze([
            phase("active", PHASE_TYPES.PROJECTILE, {
                movement: { speed: 36 },
                hitbox: { shape: "rectangle", width: 30, length: 30 },
                effects: [
                    effect(EFFECT_TYPES.DAMAGE, { amount: 15 }),
                    statusEffect("burn", { amount: 2, durationMs: 5000, intervalMs: 1000 }),
                ],
                visual: visual("fireball", 30),
                events: {
                    [PHASE_EVENT_TYPES.COLLISION]: { targetKinds: DAMAGE_TARGET_KINDS, actions: [PHASE_ACTIONS.APPLY_EFFECTS, PHASE_ACTIONS.REMOVE] },
                },
            }),
        ]),
    }),
    11: entity(11, {
        entityType: "proximity_mine",
        runtimeType: "proximityMine",
        category: ENTITY_CATEGORIES.TRAP,
        spawn: { offset: { x: 0, y: 0 }, rotation: 0, rotationSpace: "owner" },
        lifetime: { duration: 20800 },
        phases: Object.freeze([
            phase("travel", PHASE_TYPES.PROJECTILE, {
                movement: { speed: 22 },
                hitbox: { shape: "circle", radius: 12 },
                visual: visual("proximityMine", 24, "moving"),
                durationMs: 800,
                events: {
                    [PHASE_EVENT_TYPES.LIFETIME_END]: { actions: [PHASE_ACTIONS.TRANSITION], transition: { to: "armed" } },
                },
            }),
            phase("armed", PHASE_TYPES.ZONE, {
                transitionOnly: true,
                movement: { speed: 0 },
                hitbox: { shape: "circle", radius: 87.5 },
                visual: visual("proximityMine", 24, "static"),
                trigger: {
                    radius: 87.5,
                    botContact: true,
                },
                durationMs: 20000,
                events: {
                    [PHASE_EVENT_TYPES.TRIGGER]: {
                        targetKinds: BOT_TARGET_KINDS, actions: [PHASE_ACTIONS.TRANSITION],
                        transition: { to: "active" },
                    },
                    [PHASE_EVENT_TYPES.LIFETIME_END]: { actions: [PHASE_ACTIONS.TRANSITION], transition: { to: "active" } },
                },
            }),
            phase("active", PHASE_TYPES.ZONE, {
                transitionOnly: true,
                movement: { speed: 0 },
                hitbox: { shape: "circle", radius: 87.5 },
                effects: [effect(EFFECT_TYPES.DAMAGE, { amount: 25 })],
                durationMs: 100,
                visual: visual("mineExplosion", 175, null, 300, "event"),
                events: {
                    [PHASE_EVENT_TYPES.COLLISION]: {
                        targetKinds: DAMAGE_TARGET_KINDS,
                        actions: [PHASE_ACTIONS.APPLY_EFFECTS, PHASE_ACTIONS.EMIT_VISUAL],
                        visualType: "mineExplosion",
                        visibleMs: 300,
                        visualSize: 175,
                        schedule: { mode: EVENT_SCHEDULE_MODES.ONCE },
                    },
                },
            }),
        ]),
    }),
    14: entity(14, {
        entityType: "gravity_zone",
        runtimeType: "gravityZone",
        category: ENTITY_CATEGORIES.ZONE,
        spawn: { offset: { x: 0, y: 0 }, rotation: 0, rotationSpace: "owner" },
        lifetime: { duration: 7000 },
        phases: Object.freeze([
            phase("travel", PHASE_TYPES.PROJECTILE, {
                movement: { speed: 22 },
                hitbox: { shape: "circle", radius: 120 },
                effects: [effect(EFFECT_TYPES.PULL, { amount: 6 })],
                visual: visual("gravityZone", 240),
                durationMs: 1000,
                events: {
                    [PHASE_EVENT_TYPES.COLLISION]: { targetKinds: BOT_TARGET_KINDS, actions: [PHASE_ACTIONS.APPLY_EFFECTS] },
                    [PHASE_EVENT_TYPES.LIFETIME_END]: { actions: [PHASE_ACTIONS.TRANSITION], transition: { to: "fuse" } },
                },
            }),
            phase("fuse", PHASE_TYPES.ZONE, {
                transitionOnly: true,
                movement: { speed: 0 },
                hitbox: { shape: "circle", radius: 120 },
                effects: [effect(EFFECT_TYPES.PULL, { amount: 6 })],
                visual: visual("gravityZone", 240),
                durationMs: 3000,
                events: {
                    [PHASE_EVENT_TYPES.COLLISION]: { targetKinds: BOT_TARGET_KINDS, actions: [PHASE_ACTIONS.APPLY_EFFECTS] },
                    [PHASE_EVENT_TYPES.LIFETIME_END]: { actions: [PHASE_ACTIONS.TRANSITION], transition: { to: "active" } },
                },
            }),
            phase("active", PHASE_TYPES.ZONE, {
                transitionOnly: true,
                movement: { speed: 0 },
                hitbox: { shape: "circle", radius: 120 },
                effects: [effect(EFFECT_TYPES.DAMAGE, { falloff: { maxAmount: 35, minAmount: 20, falloffStart: 0, falloffEnd: 90 } })],
                durationMs: 100,
                visual: visual("gravityExplosion", 240, null, 300, "event"),
                events: {
                    [PHASE_EVENT_TYPES.COLLISION]: {
                        targetKinds: DAMAGE_TARGET_KINDS,
                        actions: [PHASE_ACTIONS.APPLY_EFFECTS, PHASE_ACTIONS.EMIT_VISUAL],
                        visualType: "gravityExplosion",
                        visibleMs: 300,
                        visualSize: 240,
                        schedule: { mode: EVENT_SCHEDULE_MODES.ONCE },
                    },
                },
            }),
        ]),
    }),
    15: entity(15, {
        entityType: "silence_wave",
        runtimeType: "silenceWave",
        category: ENTITY_CATEGORIES.PROJECTILE,
        spawn: { offset: { x: 0, y: 0 }, rotation: 0, rotationSpace: "owner" },
        lifetime: { duration: 1200 },
        phases: Object.freeze([
            phase("active", PHASE_TYPES.PROJECTILE, {
                movement: { speed: 150 },
                hitbox: { shape: "rectangle", width: 150, length: 190 },
                effects: [
                    statusEffect("silence", { durationMs: 2000 }),
                    effect(EFFECT_TYPES.INTERRUPT, { durationMs: 100 }),
                ],
                visual: visual("silenceWave", 225),
                events: {
                    [PHASE_EVENT_TYPES.COLLISION]: { targetKinds: BOT_TARGET_KINDS, actions: [PHASE_ACTIONS.APPLY_EFFECTS],
                        schedule: { mode: EVENT_SCHEDULE_MODES.CONTINUOUS }, targetPolicy: { mode: TARGET_POLICY_MODES.ONCE } },
                },
            }),
        ]),
    }),
    17: entity(17, {
        entityType: "hunter_drone",
        runtimeType: "hunterDrone",
        category: ENTITY_CATEGORIES.SUMMON,
        spawn: { offset: { x: 0, y: 0 }, rotation: 0, rotationSpace: "owner" },
        lifetime: { duration: 6000 },
        phases: Object.freeze([
            phase("active", PHASE_TYPES.SUMMON, {
                movement: { speed: 4.5, turnDegrees: 8, size: 28 },
                hitbox: { shape: "circle", radius: 14 },
                health: { hp: 50, maxHp: 50 },
                visual: visual("hunterDrone", 28),
                events: {
                    [PHASE_EVENT_TYPES.KILLED]: { actions: [PHASE_ACTIONS.REMOVE] },
                },
                execution: { abilityId: "primary", intervalMs: 1000, startImmediately: true },
            }),
        ]),
        abilities: Object.freeze([
            entityAbility("primary", {
                spawn: { offset: { x: 0, y: 0 }, rotation: 0, rotationSpace: "owner" },
                phases: [
                    phase("active", PHASE_TYPES.RAY, {
                        hitbox: { shape: "ray", range: 200, width: 5 },
                        effects: [effect(EFFECT_TYPES.DAMAGE, { amount: 5 })],
                        visual: visual("gun", 16, null, 300),
                        events: {
                            [PHASE_EVENT_TYPES.COLLISION]: { targetKinds: BOT_TARGET_KINDS, actions: [PHASE_ACTIONS.APPLY_EFFECTS] },
                        },
                    }),
                ],
            }),
        ]),
    }),
    18: entity(18, {
        entityType: "windburst_projectile",
        runtimeType: "windburstProjectile",
        category: ENTITY_CATEGORIES.PROJECTILE,
        spawn: { offset: { x: 0, y: 44 }, rotation: 0, rotationSpace: "owner" },
        lifetime: { duration: 500 },
        state: { damageMultiplier: contextValue("damageMultiplier", ownerStat("attackDamageMultiplier", 1)) },
        phases: Object.freeze([
            phase("active", PHASE_TYPES.PROJECTILE, {
                movement: { speed: 44 },
                hitbox: { shape: "rectangle", width: 80, length: 115 },
                effects: [
                    effect(EFFECT_TYPES.DAMAGE, { amount: 20 }),
                    effect(EFFECT_TYPES.KNOCKBACK, { amount: 200 }),
                ],
                visual: visual("windburstProjectile", 24),
                events: {
                    [PHASE_EVENT_TYPES.COLLISION]: { targetKinds: DAMAGE_TARGET_KINDS, actions: [PHASE_ACTIONS.APPLY_EFFECTS, PHASE_ACTIONS.REMOVE] },
                },
            }),
        ]),
    }),
    21: entity(21, {
        entityType: "temporal_rewind_zone",
        runtimeType: "temporalRewindZone",
        category: ENTITY_CATEGORIES.ZONE,
        spawn: { offset: { x: 0, y: 0 }, rotation: 0, rotationSpace: "owner" },
        // The entity world advances the newly spawned zone during the same
        // arena step in which the ability is activated.
        lifetime: { duration: 3100, add: 0 },
        phases: Object.freeze([
            phase("active", PHASE_TYPES.ZONE, {
                hitbox: { shape: "circle", radius: 45 },
                effects: [effect(EFFECT_TYPES.RESTORE_STATE, { delayMs: 3000 })],
                events: {
                    [PHASE_EVENT_TYPES.ACTIVATION]: {
                        actions: [PHASE_ACTIONS.APPLY_EFFECTS],
                        effectTypes: [EFFECT_TYPES.RESTORE_STATE],
                    },
                },
                visual: visual("temporalRewindZone", 90),
            }),
        ]),
    }),
    22: entity(22, {
        entityType: "orbital_zone",
        runtimeType: "orbitalMarker",
        category: ENTITY_CATEGORIES.ZONE,
        spawn: { offset: { x: 0, y: 0 }, rotation: 0, rotationSpace: "world" },
        targeting: { owner: "owner", position: "target", defaultX: 500, defaultY: 400 },
        lifetime: { duration: 1500, add: 0 },
        phases: Object.freeze([
            phase("active", PHASE_TYPES.ZONE, {
                hitbox: { shape: "circle", radius: 130 },
                effects: [effect(EFFECT_TYPES.DAMAGE, { amount: 15 })],
                visual: visual("orbitalMarker", 260),
                skipOwner: true,
                events: {
                    [PHASE_EVENT_TYPES.COLLISION]: {
                        targetKinds: BOT_TARGET_KINDS, actions: [PHASE_ACTIONS.APPLY_EFFECTS, PHASE_ACTIONS.EMIT_VISUAL],
                        visualType: "orbitalExplosion",
                        visibleMs: 400,
                        visualSize: 260,
                        schedule: { mode: EVENT_SCHEDULE_MODES.REPEAT, intervalMs: 500, startImmediately: true },
                    },
                },
            }),
        ]),
    }),
    24: entity(24, {
        entityType: "null_zone",
        runtimeType: "nullZone",
        category: ENTITY_CATEGORIES.ZONE,
        spawn: { offset: { x: 0, y: 0 }, rotation: 0, rotationSpace: "world" },
        targeting: { position: "target", clampToRadius: 150, defaultX: "owner.x", defaultY: "owner.y" },
        lifetime: { duration: 5000 },
        phases: Object.freeze([
            phase("active", PHASE_TYPES.ZONE, {
                hitbox: { shape: "circle", radius: 150 },
                effects: [statusEffect("silence", { whileInside: true })],
                visual: visual("nullZone", 300),
                events: { [PHASE_EVENT_TYPES.COLLISION]: { targetKinds: BOT_TARGET_KINDS, actions: [PHASE_ACTIONS.APPLY_EFFECTS] } },
            }),
        ]),
    }),
    27: entity(27, {
        entityType: "singularity_zone",
        runtimeType: "singularityZone",
        category: ENTITY_CATEGORIES.ZONE,
        spawn: { offset: { x: 0, y: 0 }, rotation: 0, rotationSpace: "world" },
        targeting: { owner: "owner", position: "target", defaultX: 500, defaultY: 400 },
        lifetime: { duration: 1300 },
        phases: Object.freeze([
            phase("fuse", PHASE_TYPES.ZONE, {
                movement: { speed: 0 },
                hitbox: { shape: "circle", radius: 140 },
                effects: [effect(EFFECT_TYPES.PULL, { amount: 10 })],
                visual: visual("singularityZone", 280),
                durationMs: 1200,
                events: {
                    [PHASE_EVENT_TYPES.COLLISION]: { targetKinds: BOT_TARGET_KINDS, actions: [PHASE_ACTIONS.APPLY_EFFECTS] },
                    [PHASE_EVENT_TYPES.LIFETIME_END]: { actions: [PHASE_ACTIONS.TRANSITION], transition: { to: "active" } },
                },
            }),
            phase("active", PHASE_TYPES.ZONE, {
                transitionOnly: true,
                movement: { speed: 0 },
                hitbox: { shape: "circle", radius: 140 },
                effects: [effect(EFFECT_TYPES.DAMAGE, { falloff: { maxAmount: 35, minAmount: 15, falloffStart: 0, falloffEnd: 140 } })],
                durationMs: 100,
                visual: visual("singularityExplosion", 280, null, 400, "event"),
                events: {
                    [PHASE_EVENT_TYPES.COLLISION]: {
                        targetKinds: DAMAGE_TARGET_KINDS,
                        actions: [PHASE_ACTIONS.APPLY_EFFECTS, PHASE_ACTIONS.EMIT_VISUAL],
                        visualType: "singularityExplosion",
                        visibleMs: 400,
                        visualSize: 280,
                        schedule: { mode: EVENT_SCHEDULE_MODES.ONCE },
                    },
                },
            }),
        ]),
    }),
    28: entity(28, {
        entityType: "tether_bolt",
        runtimeType: "tetherBolt",
        category: ENTITY_CATEGORIES.PROJECTILE,
        spawn: { offset: { x: 0, y: 41 }, rotation: 0, rotationSpace: "owner" },
        lifetime: { duration: 1100 },
        state: { damageMultiplier: contextValue("damageMultiplier", ownerStat("attackDamageMultiplier", 1)) },
        phases: Object.freeze([
            phase("active", PHASE_TYPES.PROJECTILE, {
                movement: { speed: 42 },
                hitbox: { shape: "rectangle", width: 18, length: 18 },
                effects: [
                    effect(EFFECT_TYPES.DAMAGE, { amount: 10 }),
                    effect(EFFECT_TYPES.PULL, { amount: 100 }),
                    statusEffect("slow", { durationMs: 1200 }),
                ],
                events: {
                    [PHASE_EVENT_TYPES.COLLISION]: { targetKinds: DAMAGE_TARGET_KINDS, actions: [PHASE_ACTIONS.APPLY_EFFECTS, PHASE_ACTIONS.REMOVE] },
                },
            }),
        ]),
    }),
    29: entity(29, {
        entityType: "static_snare",
        runtimeType: "staticSnare",
        category: ENTITY_CATEGORIES.TRAP,
        spawn: { offset: { x: 0, y: 0 }, rotation: 0, rotationSpace: "owner" },
        lifetime: { duration: 16000 },
        phases: Object.freeze([
            phase("armed", PHASE_TYPES.ZONE, {
                movement: { speed: 0 },
                hitbox: { shape: "circle", radius: 12 },
                health: { hp: 20, maxHp: 20 },
                visual: visual("staticSnare", 24),
                trigger: {
                    radius: 75,
                    botContact: true,
                    chain: false,
                },
                effects: [
                    effect(EFFECT_TYPES.DAMAGE, { amount: 15 }),
                    statusEffect("slow", { durationMs: 2200 }),
                    effect(EFFECT_TYPES.INTERRUPT, { durationMs: 150 }),
                ],
                skipOwner: true,
                events: {
                    [PHASE_EVENT_TYPES.TRIGGER]: {
                        targetKinds: BOT_TARGET_KINDS,
                        actions: [PHASE_ACTIONS.APPLY_EFFECTS, PHASE_ACTIONS.TRANSITION, PHASE_ACTIONS.EMIT_VISUAL],
                        transition: { to: "triggered" },
                        visualType: "staticSnareBurst",
                        visibleMs: 300,
                        visualSize: 150,
                    },
                    [PHASE_EVENT_TYPES.KILLED]: {
                        actions: [PHASE_ACTIONS.TRANSITION],
                        transition: { to: "destroyed" },
                    },
                },
            }),
            phase("triggered", PHASE_TYPES.ZONE, {
                movement: { speed: 0 },
                hitbox: { shape: "circle", radius: 75 },
                durationMs: 100,
                skipOwner: true,
                events: {
                },
            }),
            phase("destroyed", PHASE_TYPES.ZONE, {
                movement: { speed: 0 },
                hitbox: { shape: "circle", radius: 120 },
                effects: [
                    effect(EFFECT_TYPES.DAMAGE, { amount: 20 }),
                    statusEffect("slow", { durationMs: 3000 }),
                    effect(EFFECT_TYPES.INTERRUPT, { durationMs: 150 }),
                ],
                skipOwner: true,
                durationMs: 100,
                visual: visual("staticSnareBurst", 240, null, 300, "event"),
                events: {
                    [PHASE_EVENT_TYPES.COLLISION]: {
                        targetKinds: DAMAGE_TARGET_KINDS,
                        actions: [PHASE_ACTIONS.APPLY_EFFECTS, PHASE_ACTIONS.EMIT_VISUAL],
                        visualType: "staticSnareBurst",
                        visibleMs: 300,
                        visualSize: 240,
                        schedule: { mode: EVENT_SCHEDULE_MODES.ONCE },
                    },
                },
            }),
        ]),
    }),
    31: entity(31, {
        entityType: "repeller_drone",
        // Repeller Drone uses the same physical/rendered drone as Hunter Drone;
        // ability 31 still owns a separate mini-ability contract for knockback shots.
        runtimeType: "hunterDrone",
        category: ENTITY_CATEGORIES.SUMMON,
        spawn: { offset: { x: 0, y: 0 }, rotation: 0, rotationSpace: "owner" },
        lifetime: { duration: 6000 },
        phases: Object.freeze([
            phase("active", PHASE_TYPES.SUMMON, {
                movement: { speed: 4.5, turnDegrees: 8, size: 28 },
                hitbox: { shape: "circle", radius: 14 },
                health: { hp: 50, maxHp: 50 },
                visual: visual("hunterDrone", 28),
                events: {
                    [PHASE_EVENT_TYPES.KILLED]: { actions: [PHASE_ACTIONS.REMOVE] },
                },
                execution: { abilityId: "primary", intervalMs: 1000, startImmediately: true },
            }),
        ]),
        abilities: Object.freeze([
            entityAbility("primary", {
                spawn: { offset: { x: 0, y: 0 }, rotation: 0, rotationSpace: "owner" },
                phases: [
                    phase("active", PHASE_TYPES.RAY, {
                        hitbox: { shape: "ray", range: 200, width: 5 },
                        effects: [
                            effect(EFFECT_TYPES.DAMAGE, { amount: 3 }),
                            effect(EFFECT_TYPES.KNOCKBACK, { amount: 40 }),
                        ],
                        visual: visual("gun", 16, null, 300),
                        events: {
                            [PHASE_EVENT_TYPES.COLLISION]: { targetKinds: BOT_TARGET_KINDS, actions: [PHASE_ACTIONS.APPLY_EFFECTS] },
                        },
                    }),
                ],
            }),
        ]),
    }),
});


const ABILITY_CONTRACTS_BY_RUNTIME_TYPE = Object.freeze(Object.fromEntries(
    Object.values({ ...ATTACHED_ABILITY_CONTRACTS, ...ENTITY_CONTRACTS })
        .filter((definition) => definition.runtimeType)
        .map((definition) => [definition.runtimeType, definition]),
));
const ABILITY_CONTRACTS_BY_ENTITY_TYPE = Object.freeze(Object.fromEntries(
    Object.values({ ...ATTACHED_ABILITY_CONTRACTS, ...ENTITY_CONTRACTS })
        .filter((definition) => definition.entityType)
        .map((definition) => [definition.entityType, definition]),
));

/** The single normalized lookup used by contract consumers. */
export const ABILITY_CONTRACTS = Object.freeze({
    ...ATTACHED_ABILITY_CONTRACTS,
    ...ENTITY_CONTRACTS,
});

function numericAbilityId(value) {
    const candidate = value && typeof value === "object" ? value.abilityId : value;
    if (Number.isSafeInteger(candidate)) return candidate;
    return resolveAbilityId(candidate);
}

export function abilityContract(value) {
    const numericId = numericAbilityId(value);
    if (numericId != null && ABILITY_CONTRACTS[numericId]) return ABILITY_CONTRACTS[numericId];
    if (value && typeof value === "object" && value.category && value.phases) return value;
    return ABILITY_CONTRACTS_BY_ENTITY_TYPE[value]
        ?? ABILITY_CONTRACTS_BY_RUNTIME_TYPE[value]
        ?? null;
}

export function phaseForAbility(value) {
    return abilityContract(value)?.phases?.[0] ?? null;
}

export function attachedAbilityContract(value) {
    const contract = abilityContract(value);
    return contract?.category === ENTITY_CATEGORIES.BOT_ATTACHED ? contract : null;
}

export function phaseForAttachedAbility(value) {
    return attachedAbilityContract(value)?.phases?.[0] ?? null;
}

/** True when the phase applies its effects to the owner at activation. */
export function attachedAbilityTargetsOwner(value) {
    return Boolean(phaseForAttachedAbility(value)?.events?.[PHASE_EVENT_TYPES.ACTIVATION]);
}

export function hasEffect(abilityId, effectType) {
    return effectsForAttachedAbility(abilityId).some(({ type }) => type === effectType);
}

/** Returns the concrete effect instances owned by the attached phases. */
export function effectsForAttachedAbility(abilityId) {
    return phaseForAttachedAbility(abilityId)?.effects ?? [];
}

export function isAttachedAbility(value) {
    return attachedAbilityContract(value) != null;
}

export function isEntityAbility(value) {
    const contract = abilityContract(value);
    return Boolean(contract && contract.category !== ENTITY_CATEGORIES.BOT_ATTACHED);
}

/** Returns the canonical lifecycle phases for an entity or entity payload. */
export function phasesForEntity(value) {
    const contract = value?.phases
        ? entityContract(value)
        : entityContract(value?.entityContractId
            ?? value?.abilityId
            ?? value?.entityContractType
            ?? value?.type
            ?? value);
    return Array.isArray(contract?.phases) ? contract.phases : [];
}

/** Resolves explicit phase state, falling back to the contract's first phase. */
export function phaseForEntity(value) {
    const phases = phasesForEntity(value);
    if (phases.length === 0) return null;
    if (value?.phaseId != null) {
        const explicit = phases.find((phaseValue) => phaseValue.id === value.phaseId);
        if (explicit) return explicit;
    }
    if (value?.armed) {
        const armed = phases.find((phaseValue) => phaseValue.id === "armed");
        if (armed) return armed;
    }
    return phases[0];
}

export function phaseTypeForEntity(value) {
    return phaseForEntity(value)?.type ?? null;
}

export function phaseById(value, phaseId) {
    return phasesForEntity(value).find((phaseValue) => phaseValue.id === phaseId) ?? null;
}

/** Resolves one contract-owned mini ability scheduled by an entity phase. */
export function entityAbilityForEntity(value, abilityId = null) {
    const contract = entityContract(value);
    const scheduledId = abilityId ?? phaseForEntity(value)?.execution?.abilityId;
    if (!contract || scheduledId == null) return null;
    return contract.abilities?.find((ability) => ability?.id === scheduledId) ?? null;
}

/** Resolves the active phase of one entity-owned mini ability. */
export function entityAbilityPhaseForEntity(value, abilityId = null) {
    return entityAbilityForEntity(value, abilityId)?.phases?.[0] ?? null;
}

/** Resolves the spawn point/orientation of one entity-owned mini ability. */
export function entityAbilitySpawnForEntity(value, abilityId = null) {
    return entityAbilityForEntity(value, abilityId)?.spawn ?? {
        offset: { x: 0, y: 0 },
        rotation: 0,
        rotationSpace: "owner",
    };
}

export function entityContract(value) {
    const numericId = numericAbilityId(value);
    if (numericId != null) {
        const contract = ABILITY_CONTRACTS[numericId];
        return contract?.category === ENTITY_CATEGORIES.BOT_ATTACHED ? null : contract ?? null;
    }
    if (value && typeof value === "object" && value.category
        && value.category !== ENTITY_CATEGORIES.BOT_ATTACHED && value.phases) {
        return value;
    }
    return ABILITY_CONTRACTS_BY_ENTITY_TYPE[value]
        ?? ABILITY_CONTRACTS_BY_RUNTIME_TYPE[value]
        ?? null;
}

export function entityContractForAbility(abilityValue) {
    return entityContract(abilityValue?.abilityId ?? abilityValue);
}
