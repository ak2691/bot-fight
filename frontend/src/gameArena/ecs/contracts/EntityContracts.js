import {
    abilityPhase,
    abilityContract,
    EFFECT_TYPES,
    PHASE_ACTIONS,
    PHASE_EVENT_TYPES,
    PHASE_TYPES,
    PERSISTENCE_MODES,
} from "../../gameconfig/AbilityContracts.js";

/**
 * Declarative construction metadata for ability-created entities.
 *
 * AbilityContracts owns delivery/effect semantics. This registry owns the
 * entity payload shape and the ECS system that advances the payload. It is
 * keyed by the permanent ability contract ID; entity type strings are payload
 * metadata only and are never registry keys.
 */
export const ENTITY_CATEGORIES = Object.freeze({
    PROJECTILE: "projectile",
    ZONE: "zone",
    TRAP: "trap",
    SUMMON: "summon",
});

const contextValue = (name, fallback = null) => Object.freeze({ context: name, fallback });
const ownerStat = (name, fallback = 0) => Object.freeze({ ownerStat: name, fallback });
const visual = (type, visualSize, state = null, visibleMs = null) => Object.freeze({
    type,
    ...(state == null ? {} : { state }),
    visualSize,
    ...(visibleMs == null ? {} : { visibleMs }),
});
const phase = (id, type, values = {}) => abilityPhase(id, type, values);

const entity = (abilityId, definition) => {
    const base = {
        abilityId,
        ...definition,
        spawn: Object.freeze({ mode: "self", rotation: "owner", ...(definition.spawn ?? {}) }),
        targeting: Object.freeze({ owner: "owner", ...(definition.targeting ?? {}) }),
        motion: Object.freeze({ ...(definition.motion ?? {}) }),
        lifetime: Object.freeze({ ...(definition.lifetime ?? {}) }),
        collider: Object.freeze({ ...(definition.collider ?? {}) }),
        state: Object.freeze({ ...(definition.state ?? {}) }),
    };
    return Object.freeze({
        ...base,
        phases: Object.freeze([...(definition.phases ?? [])]),
    });
};

/**
 * The keys are the stable numeric ability IDs declared by AbilityContracts.
 * `entityType` is the external spawn value from the ability contract and
 * `runtimeType` is the camelCase payload value used by the arena.
 */
export const ENTITY_CONTRACTS = Object.freeze({
    4: entity(4, {
        entityType: "grenade",
        runtimeType: "grenade",
        category: ENTITY_CATEGORIES.PROJECTILE,
        spawn: { mode: "forward", rotation: "zero", padding: 2 },
        motion: { speed: "speed", traveled: 0 },
        collider: { size: "hitboxWidth", shape: "rectangle" },
        state: {
            phaseId: "travel",
            damageMultiplier: contextValue("damageMultiplier", ownerStat("attackDamageMultiplier", 1)),
        },
        phases: Object.freeze([
            phase("travel", PHASE_TYPES.PROJECTILE, {
                startMs: 0,
                movement: {
                    mode: "travel",
                    clamp: true,
                },
                hitbox: { shape: "rectangle", width: "hitboxWidth", length: "hitboxLength" },
                visual: visual("grenade", 12, "moving"),
                durationMs: 1000,
                events: {
                    [PHASE_EVENT_TYPES.COLLISION]: { actions: [PHASE_ACTIONS.TRANSITION], transition: "active" },
                    [PHASE_EVENT_TYPES.LIFETIME_END]: { actions: [PHASE_ACTIONS.TRANSITION], transition: "armed" },
                },
                persistence: { mode: PERSISTENCE_MODES.ONCE, scope: "target" },
            }),
            phase("armed", PHASE_TYPES.PROJECTILE, {
                // Armed is reached when the fixed one-second travel phase ends.
                startMs: -1,
                transitionOnly: true,
                movement: { mode: "stopped" },
                hitbox: { shape: "rectangle", width: "hitboxWidth", length: "hitboxLength" },
                durationMs: 1000,
                visual: visual("grenade", 12, "static"),
                events: {
                    [PHASE_EVENT_TYPES.COLLISION]: { actions: [PHASE_ACTIONS.TRANSITION], transition: "active" },
                    [PHASE_EVENT_TYPES.LIFETIME_END]: { actions: [PHASE_ACTIONS.TRANSITION], transition: "active" },
                },
                persistence: { mode: PERSISTENCE_MODES.ONCE, scope: "target" },
            }),
            phase("active", PHASE_TYPES.ZONE, {
                // The explosion is reached by collision or armed-phase expiry;
                // it is not an elapsed-time phase from the grenade's spawn.
                startMs: -1,
                transitionOnly: true,
                movement: { mode: "stopped" },
                hitbox: { shape: "circle", radius: "radius" },
                effects: [EFFECT_TYPES.DAMAGE],
                durationMs: 200,
                visual: visual("grenadeExplosion", 140, null, 200),
                events: {
                    [PHASE_EVENT_TYPES.COLLISION]: { actions: [PHASE_ACTIONS.APPLY_EFFECTS] },
                    [PHASE_EVENT_TYPES.LIFETIME_END]: { actions: [PHASE_ACTIONS.REMOVE] },
                },
                persistence: { mode: PERSISTENCE_MODES.ONCE, scope: "target" },
            }),
        ]),
    }),
    5: entity(5, {
        entityType: "fireball",
        runtimeType: "fireball",
        category: ENTITY_CATEGORIES.PROJECTILE,
        spawn: { mode: "forward", rotation: "owner", padding: 2 },
        motion: { speed: "speed", traveled: 0 },
        lifetime: { duration: "durationMs" },
        collider: { size: "hitboxWidth", shape: "rectangle" },
        state: {
            damageMultiplier: contextValue("damageMultiplier", ownerStat("attackDamageMultiplier", 1)),
        },
        visual: visual("fireball", 30),
        phases: Object.freeze([
            phase("active", PHASE_TYPES.PROJECTILE, {
                movement: { mode: "travel", scale: "unit", clamp: true },
                hitbox: { shape: "rectangle", width: "hitboxWidth", length: "hitboxLength" },
                effects: [EFFECT_TYPES.DAMAGE, EFFECT_TYPES.STATUS],
                visual: visual("fireball", 30),
                events: {
                    [PHASE_EVENT_TYPES.COLLISION]: { actions: [PHASE_ACTIONS.APPLY_EFFECTS, PHASE_ACTIONS.REMOVE] },
                    [PHASE_EVENT_TYPES.LIFETIME_END]: { actions: [PHASE_ACTIONS.REMOVE] },
                },
                persistence: { mode: PERSISTENCE_MODES.ONCE, scope: "target" },
            }),
        ]),
    }),
    11: entity(11, {
        entityType: "proximity_mine",
        runtimeType: "proximityMine",
        category: ENTITY_CATEGORIES.TRAP,
        spawn: { mode: "self", rotation: "owner" },
        motion: { speed: "speed", traveled: 0 },
        lifetime: { duration: "durationMs" },
        collider: { size: "size", hittable: true },
        state: { phaseId: "travel", phaseTimerMs: 0, armed: false },
        phases: Object.freeze([
            phase("travel", PHASE_TYPES.PROJECTILE, {
                startMs: 0,
                movement: { mode: "travel" },
                hitbox: { shape: "circle", radius: "size", radiusMultiplier: 0.5 },
                visual: visual("proximityMine", 24, "moving"),
            }),
            phase("armed", PHASE_TYPES.ZONE, {
                startMs: 800,
                movement: { mode: "stopped" },
                hitbox: { shape: "circle", radius: "radius" },
                visual: visual("proximityMine", 24, "static"),
                trigger: {
                    radius: "radius",
                    attackHits: true,
                    projectileOverlap: true,
                    botContact: true,
                    chain: true,
                },
                effects: [EFFECT_TYPES.DAMAGE],
                events: {
                    [PHASE_EVENT_TYPES.COLLISION]: {
                        actions: [PHASE_ACTIONS.TRANSITION],
                        transition: "active",
                    },
                },
                persistence: { mode: PERSISTENCE_MODES.ONCE, scope: "target" },
            }),
            phase("active", PHASE_TYPES.ZONE, {
                movement: { mode: "stopped" },
                hitbox: { shape: "circle", radius: "radius" },
                effects: [EFFECT_TYPES.DAMAGE],
                durationMs: 300,
                visual: visual("mineExplosion", 175, null, 300),
                events: {
                    [PHASE_EVENT_TYPES.COLLISION]: { actions: [PHASE_ACTIONS.APPLY_EFFECTS] },
                    [PHASE_EVENT_TYPES.LIFETIME_END]: { actions: [PHASE_ACTIONS.REMOVE] },
                },
                persistence: { mode: PERSISTENCE_MODES.ONCE, scope: "target" },
            }),
        ]),
    }),
    14: entity(14, {
        entityType: "gravity_zone",
        runtimeType: "gravityZone",
        category: ENTITY_CATEGORIES.ZONE,
        spawn: { mode: "self", rotation: "owner" },
        motion: { speed: "speed", traveled: 0 },
        lifetime: { duration: "durationMs" },
        collider: { size: "radius", sizeMultiplier: 2 },
        state: {
            phaseId: "travel",
            armed: false,
            phaseTimerMs: 0,
        },
        phases: Object.freeze([
            phase("travel", PHASE_TYPES.PROJECTILE, {
                startMs: 0,
                movement: { mode: "travel" },
                hitbox: { shape: "circle", radius: "radius" },
                visual: visual("gravityZone", 240),
            }),
            phase("fuse", PHASE_TYPES.ZONE, {
                startMs: 2000,
                movement: { mode: "stopped" },
                hitbox: { shape: "circle", radius: "radius" },
                effects: [EFFECT_TYPES.PULL],
                visual: visual("gravityZone", 240),
                events: { [PHASE_EVENT_TYPES.COLLISION]: { actions: [PHASE_ACTIONS.APPLY_EFFECTS] } },
                persistence: { mode: PERSISTENCE_MODES.EVERY_TICK },
            }),
            phase("active", PHASE_TYPES.ZONE, {
                startMs: 5000,
                movement: { mode: "stopped" },
                hitbox: { shape: "circle", radius: "radius" },
                effects: [EFFECT_TYPES.DAMAGE],
                durationMs: 300,
                visual: visual("gravityExplosion", 240, null, 300),
                events: {
                    [PHASE_EVENT_TYPES.COLLISION]: { actions: [PHASE_ACTIONS.APPLY_EFFECTS] },
                    [PHASE_EVENT_TYPES.LIFETIME_END]: { actions: [PHASE_ACTIONS.REMOVE] },
                },
                persistence: { mode: PERSISTENCE_MODES.ONCE, scope: "target" },
            }),
        ]),
    }),
    15: entity(15, {
        entityType: "silence_wave",
        runtimeType: "silenceWave",
        category: ENTITY_CATEGORIES.PROJECTILE,
        spawn: { mode: "self", rotation: "owner" },
        motion: { speed: "speed" },
        lifetime: { duration: "durationMs" },
        collider: { size: "size", shape: "rectangle" },
        visual: visual("silenceWave", 225),
        phases: Object.freeze([
            phase("active", PHASE_TYPES.PROJECTILE, {
                movement: { mode: "segment", scale: "unit", clamp: true },
                hitbox: { shape: "rectangle", width: "hitboxWidth", length: "hitboxLength" },
                effects: [EFFECT_TYPES.STATUS, EFFECT_TYPES.INTERRUPT],
                visual: visual("silenceWave", 225),
                events: {
                    [PHASE_EVENT_TYPES.COLLISION]: { actions: [PHASE_ACTIONS.APPLY_EFFECTS] },
                    [PHASE_EVENT_TYPES.LIFETIME_END]: { actions: [PHASE_ACTIONS.REMOVE] },
                },
                persistence: { mode: PERSISTENCE_MODES.ONCE, scope: "target" },
            }),
        ]),
    }),
    17: entity(17, {
        entityType: "hunter_drone",
        runtimeType: "hunterDrone",
        visual: visual("hunterDrone", 28),
        category: ENTITY_CATEGORIES.SUMMON,
        spawn: { mode: "self", rotation: "owner" },
        lifetime: { duration: "durationMs" },
        collider: { size: "size", hittable: true },
        health: { hp: "hp", maxHp: "hp" },
        state: { shotCooldownMs: 0 },
        phases: Object.freeze([
            phase("active", PHASE_TYPES.SUMMON, {
                movement: { mode: "seek", speed: "speed", turn: "turnStepDegrees", size: "size" },
                hitbox: { shape: "ray", range: "range", width: 5 },
                effects: [EFFECT_TYPES.DAMAGE],
                visual: visual("hunterDrone", 28),
                attack: {
                    range: "range",
                    hitbox: { shape: "ray", range: "range", width: 5 },
                    cooldownField: "shotCooldownMs",
                    cooldown: "shotCooldownMs",
                    visualField: "shotVisualMs",
                    visual: "shotVisualMs",
                    effectTypes: [EFFECT_TYPES.DAMAGE],
                },
                events: { [PHASE_EVENT_TYPES.COLLISION]: { actions: [PHASE_ACTIONS.APPLY_EFFECTS] } },
                persistence: { mode: PERSISTENCE_MODES.INTERVAL, intervalMs: "shotCooldownMs", scope: "target" },
                repeat: { intervalMs: "shotCooldownMs", event: PHASE_EVENT_TYPES.COLLISION },
            }),
        ]),
    }),
    18: entity(18, {
        entityType: "windburst_projectile",
        runtimeType: "windburstProjectile",
        visual: visual("windburstProjectile", 24),
        category: ENTITY_CATEGORIES.PROJECTILE,
        spawn: { mode: "forward", rotation: "owner", padding: 2 },
        motion: { speed: "speed", traveled: 0 },
        lifetime: { duration: "durationMs" },
        collider: { size: "size", hittable: true, shape: "rectangle" },
        state: { damageMultiplier: contextValue("damageMultiplier", ownerStat("attackDamageMultiplier", 1)) },
        phases: Object.freeze([
            phase("active", PHASE_TYPES.PROJECTILE, {
                movement: { mode: "segment", scale: "stepRatio", clamp: true },
                hitbox: { shape: "rectangle", width: "hitboxWidth", length: "hitboxLength" },
                effects: [EFFECT_TYPES.DAMAGE, EFFECT_TYPES.KNOCKBACK],
                visual: visual("windburstProjectile", 24),
                events: {
                    [PHASE_EVENT_TYPES.COLLISION]: { actions: [PHASE_ACTIONS.APPLY_EFFECTS, PHASE_ACTIONS.REMOVE] },
                    [PHASE_EVENT_TYPES.LIFETIME_END]: { actions: [PHASE_ACTIONS.REMOVE] },
                },
                persistence: { mode: PERSISTENCE_MODES.ONCE, scope: "target" },
            }),
        ]),
    }),
    21: entity(21, {
        entityType: "temporal_rewind_zone",
        runtimeType: "temporalRewindZone",
        visual: visual("temporalRewindZone", 90),
        category: ENTITY_CATEGORIES.ZONE,
        spawn: { mode: "self", rotation: "zero" },
        // The entity world advances the newly spawned zone during the same
        // arena step in which the ability is activated.
        lifetime: { duration: "durationMs", add: 0 },
        collider: { size: "radius", sizeMultiplier: 2 },
        phases: Object.freeze([
            phase("active", PHASE_TYPES.ZONE, {
                hitbox: { shape: "circle", radius: "radius" },
                visual: visual("temporalRewindZone", 90),
            }),
        ]),
    }),
    22: entity(22, {
        entityType: "orbital_zone",
        runtimeType: "orbitalMarker",
        visual: visual("orbitalMarker", 260),
        category: ENTITY_CATEGORIES.ZONE,
        targeting: { owner: "owner" },
        spawn: { mode: "target", rotation: "zero", defaultX: 500, defaultY: 400 },
        lifetime: { duration: "durationMs", add: 0 },
        collider: { size: "radius", sizeMultiplier: 2 },
        state: { intervalTimerMs: 0 },
        phases: Object.freeze([
            phase("active", PHASE_TYPES.ZONE, {
                hitbox: { shape: "circle", radius: "radius" },
                effects: [EFFECT_TYPES.DAMAGE],
                visual: visual("orbitalMarker", 260),
                skipOwner: true,
                events: {
                    [PHASE_EVENT_TYPES.INTERVAL]: {
                        actions: [PHASE_ACTIONS.APPLY_EFFECTS, PHASE_ACTIONS.EMIT_VISUAL],
                        intervalMs: "intervalMs",
                        visualType: "orbitalExplosion",
                        visibleMs: "visibleMs",
                        visualSize: "visualSize",
                    },
                    [PHASE_EVENT_TYPES.LIFETIME_END]: { actions: [PHASE_ACTIONS.REMOVE] },
                },
                persistence: { mode: PERSISTENCE_MODES.INTERVAL, intervalMs: "intervalMs", scope: "target" },
                repeat: { intervalMs: "intervalMs", event: PHASE_EVENT_TYPES.INTERVAL },
            }),
        ]),
    }),
    24: entity(24, {
        entityType: "null_zone",
        runtimeType: "nullZone",
        visual: visual("nullZone", 300),
        category: ENTITY_CATEGORIES.ZONE,
        spawn: { mode: "target", rotation: "zero", clampToRadius: "radius", defaultX: "owner.x", defaultY: "owner.y" },
        motion: { traveled: 0 },
        lifetime: { duration: "durationMs" },
        collider: { size: "radius", sizeMultiplier: 2 },
        state: { armed: true },
        phases: Object.freeze([
            phase("active", PHASE_TYPES.ZONE, {
                hitbox: { shape: "circle", radius: "radius" },
                effects: [EFFECT_TYPES.STATUS],
                visual: visual("nullZone", 300),
                events: { [PHASE_EVENT_TYPES.COLLISION]: { actions: [PHASE_ACTIONS.APPLY_EFFECTS] } },
                persistence: { mode: PERSISTENCE_MODES.EVERY_TICK },
            }),
        ]),
    }),
    27: entity(27, {
        entityType: "singularity_zone",
        runtimeType: "singularityZone",
        category: ENTITY_CATEGORIES.ZONE,
        targeting: { owner: "owner" },
        spawn: { mode: "target", rotation: "zero", defaultX: 500, defaultY: 400 },
        lifetime: { duration: "durationMs" },
        collider: { size: "radius", sizeMultiplier: 2 },
        state: { phaseId: "fuse", phaseTimerMs: 0, armed: true },
        phases: Object.freeze([
            phase("fuse", PHASE_TYPES.ZONE, {
                startMs: 0,
                movement: { mode: "stopped" },
                hitbox: { shape: "circle", radius: "radius" },
                effects: [EFFECT_TYPES.PULL],
                visual: visual("singularityZone", 280),
                events: { [PHASE_EVENT_TYPES.COLLISION]: { actions: [PHASE_ACTIONS.APPLY_EFFECTS] } },
                persistence: { mode: PERSISTENCE_MODES.EVERY_TICK },
            }),
            phase("active", PHASE_TYPES.ZONE, {
                startMs: 1200,
                movement: { mode: "stopped" },
                hitbox: { shape: "circle", radius: "radius" },
                effects: [EFFECT_TYPES.DAMAGE],
                durationMs: 400,
                visual: visual("singularityExplosion", 280, null, 400),
                events: {
                    [PHASE_EVENT_TYPES.COLLISION]: { actions: [PHASE_ACTIONS.APPLY_EFFECTS] },
                    [PHASE_EVENT_TYPES.LIFETIME_END]: { actions: [PHASE_ACTIONS.REMOVE] },
                },
                persistence: { mode: PERSISTENCE_MODES.ONCE, scope: "target" },
            }),
        ]),
    }),
    28: entity(28, {
        entityType: "tether_bolt",
        runtimeType: "tetherBolt",
        category: ENTITY_CATEGORIES.PROJECTILE,
        spawn: { mode: "forward", rotation: "owner", padding: 2 },
        motion: { speed: "speed", traveled: 0 },
        lifetime: { duration: "durationMs" },
        collider: { size: "hitboxWidth", shape: "rectangle" },
        state: { damageMultiplier: contextValue("damageMultiplier", ownerStat("attackDamageMultiplier", 1)) },
        phases: Object.freeze([
            phase("active", PHASE_TYPES.PROJECTILE, {
                movement: { mode: "segment", scale: "stepRatio", clamp: true },
                hitbox: { shape: "rectangle", width: "hitboxWidth", length: "hitboxLength" },
                effects: [EFFECT_TYPES.DAMAGE, EFFECT_TYPES.PULL, EFFECT_TYPES.STATUS],
                events: {
                    [PHASE_EVENT_TYPES.COLLISION]: { actions: [PHASE_ACTIONS.APPLY_EFFECTS, PHASE_ACTIONS.REMOVE] },
                    [PHASE_EVENT_TYPES.LIFETIME_END]: { actions: [PHASE_ACTIONS.REMOVE] },
                },
                persistence: { mode: PERSISTENCE_MODES.ONCE, scope: "target" },
            }),
        ]),
    }),
    29: entity(29, {
        entityType: "static_snare",
        runtimeType: "staticSnare",
        category: ENTITY_CATEGORIES.TRAP,
        spawn: { mode: "self", rotation: "owner" },
        lifetime: { duration: "durationMs" },
        collider: { size: "size", hittable: true },
        health: { hp: "hp", maxHp: "hp" },
        state: { armed: true },
        phases: Object.freeze([
            phase("armed", PHASE_TYPES.ZONE, {
                startMs: 0,
                movement: { mode: "stopped" },
                hitbox: { shape: "circle", radius: "radius" },
                trigger: {
                    radius: "radius",
                    attackHits: true,
                    projectileOverlap: true,
                    botContact: true,
                    chain: false,
                    requiresDestruction: true,
                },
                effects: [EFFECT_TYPES.DAMAGE, EFFECT_TYPES.STATUS, EFFECT_TYPES.INTERRUPT],
                skipOwner: true,
                events: {
                    [PHASE_EVENT_TYPES.COLLISION]: {
                        actions: [PHASE_ACTIONS.APPLY_EFFECTS, PHASE_ACTIONS.EMIT_VISUAL, PHASE_ACTIONS.TRANSITION],
                        transition: "triggered",
                        visualType: "staticSnareBurst",
                        visualSize: 150,
                        visibleMs: "visibleMs",
                    },
                },
                persistence: { mode: PERSISTENCE_MODES.ONCE, scope: "target" },
            }),
            phase("triggered", PHASE_TYPES.ZONE, {
                startMs: 0,
                movement: { mode: "stopped" },
                hitbox: { shape: "circle", radius: "radius" },
                durationMs: 300,
                visual: visual("staticSnareBurst", 150, null, 300),
                skipOwner: true,
                events: {
                    [PHASE_EVENT_TYPES.LIFETIME_END]: { actions: [PHASE_ACTIONS.REMOVE] },
                },
                persistence: { mode: PERSISTENCE_MODES.ONCE, scope: "target" },
            }),
            phase("destroyed", PHASE_TYPES.ZONE, {
                startMs: 0,
                movement: { mode: "stopped" },
                hitbox: { shape: "circle", radius: "radius" },
                trigger: {
                    radius: "radius",
                    attackHits: true,
                    projectileOverlap: true,
                    botContact: false,
                    chain: false,
                    requiresDestruction: true,
                },
                effects: [EFFECT_TYPES.DAMAGE, EFFECT_TYPES.STATUS, EFFECT_TYPES.INTERRUPT],
                statOverrides: { radius: 120 },
                effectOverrides: {
                    [EFFECT_TYPES.DAMAGE]: { amount: 20 },
                    [`${EFFECT_TYPES.STATUS}:slow`]: { durationMs: 3000 },
                },
                skipOwner: true,
                durationMs: 300,
                visual: visual("staticSnareBurst", 240, null, 300),
                events: {
                    [PHASE_EVENT_TYPES.COLLISION]: { actions: [PHASE_ACTIONS.APPLY_EFFECTS] },
                    [PHASE_EVENT_TYPES.LIFETIME_END]: { actions: [PHASE_ACTIONS.REMOVE] },
                },
                persistence: { mode: PERSISTENCE_MODES.ONCE, scope: "target" },
            }),
        ]),
    }),
    31: entity(31, {
        entityType: "repeller_drone",
        // Repeller Drone uses the same physical/rendered drone as Hunter Drone;
        // ability 31 still owns a separate attack contract for knockback shots.
        runtimeType: "hunterDrone",
        visual: visual("hunterDrone", 28),
        category: ENTITY_CATEGORIES.SUMMON,
        spawn: { mode: "self", rotation: "owner" },
        lifetime: { duration: "durationMs" },
        collider: { size: "size", hittable: true },
        health: { hp: "hp", maxHp: "hp" },
        state: { shotCooldownMs: 0 },
        phases: Object.freeze([
            phase("active", PHASE_TYPES.SUMMON, {
                movement: { mode: "seek", speed: "speed", turn: "turnStepDegrees", size: "size" },
                hitbox: { shape: "ray", range: "range", width: 5 },
                effects: [EFFECT_TYPES.DAMAGE, EFFECT_TYPES.KNOCKBACK],
                visual: visual("hunterDrone", 28),
                attack: {
                    range: "range",
                    hitbox: { shape: "ray", range: "range", width: 5 },
                    cooldownField: "shotCooldownMs",
                    cooldown: "shotCooldownMs",
                    visualField: "shotVisualMs",
                    visual: "shotVisualMs",
                    effectTypes: [EFFECT_TYPES.DAMAGE, EFFECT_TYPES.KNOCKBACK],
                },
                events: { [PHASE_EVENT_TYPES.COLLISION]: { actions: [PHASE_ACTIONS.APPLY_EFFECTS] } },
                persistence: { mode: PERSISTENCE_MODES.INTERVAL, intervalMs: "shotCooldownMs", scope: "target" },
                repeat: { intervalMs: "shotCooldownMs", event: PHASE_EVENT_TYPES.COLLISION },
            }),
        ]),
    }),
});

const CONTRACTS_BY_RUNTIME_TYPE = Object.freeze(Object.fromEntries(
    Object.values(ENTITY_CONTRACTS).map((definition) => [definition.runtimeType, definition]),
));
const CONTRACTS_BY_ENTITY_TYPE = Object.freeze(Object.fromEntries(
    Object.values(ENTITY_CONTRACTS).map((definition) => [definition.entityType, definition]),
));
/** Returns the canonical lifecycle phases for an entity or contract value. */
export function phasesForEntity(value) {
    const contract = value?.phases
        ? value
        : entityContract(value?.entityContractId
            ?? value?.abilityId
            ?? value?.entityContractType
            ?? value?.type
            ?? value);
    return Array.isArray(contract?.phases) ? contract.phases : [];
}

/** Resolves the phase selected by an entity's explicit state or elapsed age. */
export function phaseForEntity(value) {
    const phases = phasesForEntity(value);
    if (phases.length === 0) return null;
    if (value?.phaseLocked && value?.phaseId != null) {
        const explicit = phases.find((phase) => phase.id === value.phaseId);
        if (explicit) return explicit;
    }
    if (value?.destroyedByDamage) {
        const destroyed = phases.find((phase) => phase.id === "destroyed");
        if (destroyed) return destroyed;
    }
    const explicit = value?.phaseId == null
        ? null : phases.find((phase) => phase.id === value.phaseId);
    // The factory records the first phase before elapsed-time selection has
    // begun. Later explicit phases are event/replay state and must win.
    if (explicit && (value?.phaseLocked || explicit !== phases[0])) return explicit;
    if (value?.armed) {
        const armed = phases.find((phase) => phase.id === "armed");
        if (armed) return armed;
    }
    const elapsed = Math.max(0, Number(value?.ageMs ?? 0));
    return phases.reduce((current, phase) => !phase.transitionOnly
        && Number(phase.startMs ?? 0) >= 0
        && Number(phase.startMs ?? 0) <= elapsed
        && (!current || Number(phase.startMs ?? 0) > Number(current.startMs ?? 0))
        ? phase : current, phases[0]);
}

export function phaseTypeForEntity(value) {
    return phaseForEntity(value)?.type ?? null;
}

export function phaseById(value, phaseId) {
    return phasesForEntity(value).find((phase) => phase.id === phaseId) ?? null;
}

export function entityContract(value) {
    if (value && typeof value === "object" && value.runtimeType) return value;
    if (Number.isSafeInteger(value)) return ENTITY_CONTRACTS[value] ?? null;
    return CONTRACTS_BY_ENTITY_TYPE[value] ?? CONTRACTS_BY_RUNTIME_TYPE[value] ?? null;
}

export function entityContractForAbility(abilityValue) {
    const abilityId = abilityValue?.abilityId ?? abilityValue;
    const contract = abilityContract(abilityId);
    return contract?.effects.some(({ type }) => type === "spawn_entity")
        ? entityContract(abilityId)
        : null;
}
