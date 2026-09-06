import {
    abilityPhase,
    effect,
    statusEffect,
    EFFECT_TYPES,
    PHASE_ACTIONS,
    PHASE_EVENT_TYPES,
    PHASE_TYPES,
    TARGET_POLICY_MODES,
} from "../../gameconfig/AttachedAbilityContracts.js";

/**
 * Declarative construction metadata for ability-created entities.
 *
 * AttachedAbilityContracts owns direct activation metadata. This registry owns the
 * entity payload shape, lifecycle, phases, and the ECS system that advances
 * the payload. It is keyed by the permanent ability ID from AbilityRegistry; entity type strings
 * are payload metadata only and are never registry keys.
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
        spawn: Object.freeze({ offset: Object.freeze({ x: 0, y: 0 }), rotation: "owner", ...(definition.spawn ?? {}) }),
        targeting: Object.freeze({ owner: "owner", ...(definition.targeting ?? {}) }),
        lifetime: Object.freeze({ ...(definition.lifetime ?? {}) }),
        collider: Object.freeze({ ...(definition.collider ?? {}) }),
        state: Object.freeze({ ...(definition.state ?? {}) }),
    };
    return Object.freeze({
        ...base,
        phases: Object.freeze(definition.phases ?? []),
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
        spawn: { offset: { x: 0, y: 38 }, rotation: "zero" },
        collider: { size: 12, shape: "rectangle" },
        state: {
            phaseId: "travel",
            damageMultiplier: contextValue("damageMultiplier", ownerStat("attackDamageMultiplier", 1)),
        },
        phases: Object.freeze([
            phase("travel", PHASE_TYPES.PROJECTILE, {
                movement: { speed: 32 },
                hitbox: { shape: "rectangle", width: 12, length: 12 },
                visual: visual("grenade", 12, "moving"),
                durationMs: 1000,
                events: {
                    [PHASE_EVENT_TYPES.COLLISION]: { actions: [PHASE_ACTIONS.TRANSITION], transition: { to: "active" } },
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
                    [PHASE_EVENT_TYPES.COLLISION]: { actions: [PHASE_ACTIONS.TRANSITION], transition: { to: "active" } },
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
                durationMs: 200,
                visual: visual("grenadeExplosion", 140, null, 200),
                events: {
                    [PHASE_EVENT_TYPES.COLLISION]: { actions: [PHASE_ACTIONS.APPLY_EFFECTS], targetPolicy: { mode: TARGET_POLICY_MODES.ONCE } },
                },
            }),
        ]),
    }),
    5: entity(5, {
        entityType: "fireball",
        runtimeType: "fireball",
        category: ENTITY_CATEGORIES.PROJECTILE,
        spawn: { offset: { x: 0, y: 47 }, rotation: "owner" },
        lifetime: { duration: 1200 },
        collider: { size: 30, shape: "rectangle" },
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
                    [PHASE_EVENT_TYPES.COLLISION]: { actions: [PHASE_ACTIONS.APPLY_EFFECTS, PHASE_ACTIONS.REMOVE] },
                },
            }),
        ]),
    }),
    11: entity(11, {
        entityType: "proximity_mine",
        runtimeType: "proximityMine",
        category: ENTITY_CATEGORIES.TRAP,
         spawn: { offset: { x: 0, y: 0 }, rotation: "owner" },
        lifetime: { duration: 20800 },
        collider: { size: 24, hittable: true },
        state: { phaseId: "travel", phaseTimerMs: 0, armed: false },
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
                    attackHits: true,
                    projectileOverlap: true,
                    botContact: true,
                    chain: true,
                },
                effects: [effect(EFFECT_TYPES.DAMAGE, { amount: 25 })],
                durationMs: 20000,
                events: {
                    [PHASE_EVENT_TYPES.COLLISION]: {
                        actions: [PHASE_ACTIONS.TRANSITION],
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
                durationMs: 300,
                visual: visual("mineExplosion", 175, null, 300),
                events: {
                    [PHASE_EVENT_TYPES.COLLISION]: { actions: [PHASE_ACTIONS.APPLY_EFFECTS], targetPolicy: { mode: TARGET_POLICY_MODES.ONCE } },
                },
            }),
        ]),
    }),
    14: entity(14, {
        entityType: "gravity_zone",
        runtimeType: "gravityZone",
        category: ENTITY_CATEGORIES.ZONE,
         spawn: { offset: { x: 0, y: 0 }, rotation: "owner" },
        lifetime: { duration: 7000 },
        collider: { size: 240 },
        state: {
            phaseId: "travel",
            armed: false,
            phaseTimerMs: 0,
        },
        phases: Object.freeze([
            phase("travel", PHASE_TYPES.PROJECTILE, {
                movement: { speed: 22 },
                hitbox: { shape: "circle", radius: 120 },
                effects: [effect(EFFECT_TYPES.PULL, { amount: 6 })],
                visual: visual("gravityZone", 240),
                durationMs: 1000,
                events: {
                    [PHASE_EVENT_TYPES.COLLISION]: { actions: [PHASE_ACTIONS.APPLY_EFFECTS] },
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
                    [PHASE_EVENT_TYPES.COLLISION]: { actions: [PHASE_ACTIONS.APPLY_EFFECTS] },
                    [PHASE_EVENT_TYPES.LIFETIME_END]: { actions: [PHASE_ACTIONS.TRANSITION], transition: { to: "active" } },
                },
            }),
            phase("active", PHASE_TYPES.ZONE, {
                transitionOnly: true,
                movement: { speed: 0 },
                hitbox: { shape: "circle", radius: 120 },
                effects: [effect(EFFECT_TYPES.DAMAGE, { falloff: { maxAmount: 35, minAmount: 20, falloffStart: 0, falloffEnd: 90 } })],
                durationMs: 300,
                visual: visual("gravityExplosion", 240, null, 300),
                events: {
                    [PHASE_EVENT_TYPES.COLLISION]: { actions: [PHASE_ACTIONS.APPLY_EFFECTS], targetPolicy: { mode: TARGET_POLICY_MODES.ONCE } },
                },
            }),
        ]),
    }),
    15: entity(15, {
        entityType: "silence_wave",
        runtimeType: "silenceWave",
        category: ENTITY_CATEGORIES.PROJECTILE,
         spawn: { offset: { x: 0, y: 0 }, rotation: "owner" },
        lifetime: { duration: 1200 },
        collider: { size: 225, shape: "rectangle" },
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
                    [PHASE_EVENT_TYPES.COLLISION]: { actions: [PHASE_ACTIONS.APPLY_EFFECTS], targetPolicy: { mode: TARGET_POLICY_MODES.ONCE } },
                },
            }),
        ]),
    }),
    17: entity(17, {
        entityType: "hunter_drone",
        runtimeType: "hunterDrone",
        category: ENTITY_CATEGORIES.SUMMON,
         spawn: { offset: { x: 0, y: 0 }, rotation: "owner" },
        lifetime: { duration: 6000 },
        collider: { size: 28, hittable: true },
        health: { hp: 50, maxHp: 50 },
        state: { shotCooldownMs: 0 },
        phases: Object.freeze([
            phase("active", PHASE_TYPES.SUMMON, {
                movement: { speed: 4.5, turnDegrees: 8, size: 28 },
                hitbox: { shape: "ray", range: 200, width: 5 },
                effects: [effect(EFFECT_TYPES.DAMAGE, { amount: 5 })],
                visual: visual("hunterDrone", 28),
                attack: {
                    range: 200,
                    hitbox: { shape: "ray", range: 200, width: 5 },
                    cooldownField: "shotCooldownMs",
                    cooldown: 1000,
                    visualField: "shotVisualMs",
                    visual: 300,
                    effectTypes: [EFFECT_TYPES.DAMAGE],
                },
                events: { [PHASE_EVENT_TYPES.COLLISION]: { actions: [PHASE_ACTIONS.APPLY_EFFECTS] } },
                repeat: { intervalMs: 1000, event: PHASE_EVENT_TYPES.COLLISION, startImmediately: true },
            }),
        ]),
    }),
    18: entity(18, {
        entityType: "windburst_projectile",
        runtimeType: "windburstProjectile",
        category: ENTITY_CATEGORIES.PROJECTILE,
        spawn: { offset: { x: 0, y: 44 }, rotation: "owner" },
        lifetime: { duration: 500 },
        collider: { size: 24, hittable: true, shape: "rectangle" },
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
                    [PHASE_EVENT_TYPES.COLLISION]: { actions: [PHASE_ACTIONS.APPLY_EFFECTS, PHASE_ACTIONS.REMOVE] },
                },
            }),
        ]),
    }),
    21: entity(21, {
        entityType: "temporal_rewind_zone",
        runtimeType: "temporalRewindZone",
        category: ENTITY_CATEGORIES.ZONE,
         spawn: { offset: { x: 0, y: 0 }, rotation: "zero" },
        // The entity world advances the newly spawned zone during the same
        // arena step in which the ability is activated.
        lifetime: { duration: 3100, add: 0 },
        collider: { size: 90 },
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
         spawn: { offset: { x: 0, y: 0 }, rotation: "zero" },
         targeting: { owner: "owner", position: "target", defaultX: 500, defaultY: 400 },
        lifetime: { duration: 1500, add: 0 },
        collider: { size: 260 },
        state: { intervalTimerMs: 0 },
        phases: Object.freeze([
            phase("active", PHASE_TYPES.ZONE, {
                hitbox: { shape: "circle", radius: 130 },
                effects: [effect(EFFECT_TYPES.DAMAGE, { amount: 15 })],
                visual: visual("orbitalMarker", 260),
                skipOwner: true,
                events: {
                    [PHASE_EVENT_TYPES.INTERVAL]: {
                        actions: [PHASE_ACTIONS.APPLY_EFFECTS, PHASE_ACTIONS.EMIT_VISUAL],
                        intervalMs: 500,
                        visualType: "orbitalExplosion",
                        visibleMs: 400,
                        visualSize: 260,
                    },
                },
                repeat: { intervalMs: 500, event: PHASE_EVENT_TYPES.INTERVAL, startImmediately: true },
            }),
        ]),
    }),
    24: entity(24, {
        entityType: "null_zone",
        runtimeType: "nullZone",
        category: ENTITY_CATEGORIES.ZONE,
         spawn: { offset: { x: 0, y: 0 }, rotation: "zero" },
        targeting: { position: "target", clampToRadius: 150, defaultX: "owner.x", defaultY: "owner.y" },
        lifetime: { duration: 5000 },
        collider: { size: 300 },
        state: { armed: true },
        phases: Object.freeze([
            phase("active", PHASE_TYPES.ZONE, {
                hitbox: { shape: "circle", radius: 150 },
                effects: [statusEffect("silence", { whileInside: true })],
                visual: visual("nullZone", 300),
                events: { [PHASE_EVENT_TYPES.COLLISION]: { actions: [PHASE_ACTIONS.APPLY_EFFECTS] } },
            }),
        ]),
    }),
    27: entity(27, {
        entityType: "singularity_zone",
        runtimeType: "singularityZone",
        category: ENTITY_CATEGORIES.ZONE,
         spawn: { offset: { x: 0, y: 0 }, rotation: "zero" },
         targeting: { owner: "owner", position: "target", defaultX: 500, defaultY: 400 },
        lifetime: { duration: 1300 },
        collider: { size: 280 },
        state: { phaseId: "fuse", phaseTimerMs: 0, armed: true },
        phases: Object.freeze([
            phase("fuse", PHASE_TYPES.ZONE, {
                movement: { speed: 0 },
                hitbox: { shape: "circle", radius: 140 },
                effects: [effect(EFFECT_TYPES.PULL, { amount: 10 })],
                visual: visual("singularityZone", 280),
                durationMs: 1200,
                events: {
                    [PHASE_EVENT_TYPES.COLLISION]: { actions: [PHASE_ACTIONS.APPLY_EFFECTS] },
                    [PHASE_EVENT_TYPES.LIFETIME_END]: { actions: [PHASE_ACTIONS.TRANSITION], transition: { to: "active" } },
                },
            }),
            phase("active", PHASE_TYPES.ZONE, {
                transitionOnly: true,
                movement: { speed: 0 },
                hitbox: { shape: "circle", radius: 140 },
                effects: [effect(EFFECT_TYPES.DAMAGE, { falloff: { maxAmount: 35, minAmount: 15, falloffStart: 0, falloffEnd: 140 } })],
                durationMs: 400,
                visual: visual("singularityExplosion", 280, null, 400),
                events: {
                    [PHASE_EVENT_TYPES.COLLISION]: { actions: [PHASE_ACTIONS.APPLY_EFFECTS], targetPolicy: { mode: TARGET_POLICY_MODES.ONCE } },
                },
            }),
        ]),
    }),
    28: entity(28, {
        entityType: "tether_bolt",
        runtimeType: "tetherBolt",
        category: ENTITY_CATEGORIES.PROJECTILE,
        spawn: { offset: { x: 0, y: 41 }, rotation: "owner" },
        lifetime: { duration: 1100 },
        collider: { size: 18, shape: "rectangle" },
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
                    [PHASE_EVENT_TYPES.COLLISION]: { actions: [PHASE_ACTIONS.APPLY_EFFECTS, PHASE_ACTIONS.REMOVE] },
                },
            }),
        ]),
    }),
    29: entity(29, {
        entityType: "static_snare",
        runtimeType: "staticSnare",
        category: ENTITY_CATEGORIES.TRAP,
         spawn: { offset: { x: 0, y: 0 }, rotation: "owner" },
        lifetime: { duration: 16000 },
        collider: { size: 24, hittable: true },
        health: { hp: 20, maxHp: 20 },
        state: { armed: true },
        phases: Object.freeze([
            phase("armed", PHASE_TYPES.ZONE, {
                movement: { speed: 0 },
                hitbox: { shape: "circle", radius: 75 },
                trigger: {
                    radius: 75,
                    attackHits: true,
                    projectileOverlap: true,
                    botContact: true,
                    chain: false,
                    requiresDestruction: true,
                },
                effects: [
                    effect(EFFECT_TYPES.DAMAGE, { amount: 15 }),
                    statusEffect("slow", { durationMs: 2200 }),
                    effect(EFFECT_TYPES.INTERRUPT, { durationMs: 150 }),
                ],
                skipOwner: true,
                events: {
                    [PHASE_EVENT_TYPES.COLLISION]: {
                        actions: [PHASE_ACTIONS.APPLY_EFFECTS, PHASE_ACTIONS.EMIT_VISUAL, PHASE_ACTIONS.TRANSITION],
                        transition: { to: "triggered" },
                        targetPolicy: { mode: TARGET_POLICY_MODES.ONCE },
                        visualType: "staticSnareBurst",
                        visualSize: 150,
                        visibleMs: 300,
                    },
                },
            }),
            phase("triggered", PHASE_TYPES.ZONE, {
                movement: { speed: 0 },
                hitbox: { shape: "circle", radius: 75 },
                durationMs: 300,
                visual: visual("staticSnareBurst", 150, null, 300),
                skipOwner: true,
                events: {
                },
            }),
            phase("destroyed", PHASE_TYPES.ZONE, {
                movement: { speed: 0 },
                hitbox: { shape: "circle", radius: 120 },
                trigger: {
                    radius: 120,
                    attackHits: true,
                    projectileOverlap: true,
                    botContact: false,
                    chain: false,
                    requiresDestruction: true,
                },
                effects: [
                    effect(EFFECT_TYPES.DAMAGE, { amount: 20 }),
                    statusEffect("slow", { durationMs: 3000 }),
                    effect(EFFECT_TYPES.INTERRUPT, { durationMs: 150 }),
                ],
                skipOwner: true,
                durationMs: 300,
                visual: visual("staticSnareBurst", 240, null, 300),
                events: {
                    [PHASE_EVENT_TYPES.COLLISION]: { actions: [PHASE_ACTIONS.APPLY_EFFECTS], targetPolicy: { mode: TARGET_POLICY_MODES.ONCE } },
                },
            }),
        ]),
    }),
    31: entity(31, {
        entityType: "repeller_drone",
        // Repeller Drone uses the same physical/rendered drone as Hunter Drone;
        // ability 31 still owns a separate attack contract for knockback shots.
        runtimeType: "hunterDrone",
        category: ENTITY_CATEGORIES.SUMMON,
         spawn: { offset: { x: 0, y: 0 }, rotation: "owner" },
        lifetime: { duration: 6000 },
        collider: { size: 28, hittable: true },
        health: { hp: 50, maxHp: 50 },
        state: { shotCooldownMs: 0 },
        phases: Object.freeze([
            phase("active", PHASE_TYPES.SUMMON, {
                movement: { speed: 4.5, turnDegrees: 8, size: 28 },
                hitbox: { shape: "ray", range: 200, width: 5 },
                effects: [
                    effect(EFFECT_TYPES.DAMAGE, { amount: 3 }),
                    effect(EFFECT_TYPES.KNOCKBACK, { amount: 40 }),
                ],
                visual: visual("hunterDrone", 28),
                attack: {
                    range: 200,
                    hitbox: { shape: "ray", range: 200, width: 5 },
                    cooldownField: "shotCooldownMs",
                    cooldown: 1000,
                    visualField: "shotVisualMs",
                    visual: 300,
                    effectTypes: [EFFECT_TYPES.DAMAGE, EFFECT_TYPES.KNOCKBACK],
                },
                events: { [PHASE_EVENT_TYPES.COLLISION]: { actions: [PHASE_ACTIONS.APPLY_EFFECTS] } },
                repeat: { intervalMs: 1000, event: PHASE_EVENT_TYPES.COLLISION, startImmediately: true },
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

/** Resolves explicit phase state, falling back to the contract's first phase. */
export function phaseForEntity(value) {
    const phases = phasesForEntity(value);
    if (phases.length === 0) return null;
    if (value?.phaseId != null) {
        const explicit = phases.find((phase) => phase.id === value.phaseId);
        if (explicit) return explicit;
    }
    if (value?.destroyedByDamage) {
        const destroyed = phases.find((phase) => phase.id === "destroyed");
        if (destroyed) return destroyed;
    }
    if (value?.armed) {
        const armed = phases.find((phase) => phase.id === "armed");
        if (armed) return armed;
    }
    return phases[0];
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
    return entityContract(abilityId);
}
