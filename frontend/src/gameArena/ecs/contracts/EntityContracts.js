import { abilityContract, EFFECT_TYPES } from "../../gameconfig/AbilityContracts.js";

/**
 * Declarative construction metadata for ability-created entities.
 *
 * AbilityContracts owns delivery/effect semantics. This registry owns the
 * entity payload shape and the ECS system that advances the payload. It is
 * keyed by the permanent ability contract ID; entity type strings are payload
 * metadata only and are never registry keys.
 */
export const ENTITY_FACTORY_TYPES = Object.freeze({
    ENTITY: "entity",
    THROWN_ZONE: "thrownZone",
});

export const ENTITY_SYSTEM_TYPES = Object.freeze({
    PROJECTILE: "projectile",
    ABILITY: "ability",
});

export const ENTITY_CATEGORIES = Object.freeze({
    PROJECTILE: "projectile",
    ZONE: "zone",
    TRAP: "trap",
    SUMMON: "summon",
});

const contextValue = (name, fallback = null) => Object.freeze({ context: name, fallback });
const ownerStat = (name, fallback = 0) => Object.freeze({ ownerStat: name, fallback });

const entity = (abilityId, definition) => Object.freeze({
    abilityId,
    factory: ENTITY_FACTORY_TYPES.ENTITY,
    system: ENTITY_SYSTEM_TYPES.ABILITY,
    ...definition,
    spawn: Object.freeze({ mode: "self", rotation: "owner", ...(definition.spawn ?? {}) }),
    targeting: Object.freeze({ owner: "owner", ...(definition.targeting ?? {}) }),
    motion: Object.freeze({ ...(definition.motion ?? {}) }),
    lifetime: Object.freeze({ ...(definition.lifetime ?? {}) }),
    phases: Object.freeze([...(definition.phases ?? [])]),
    collider: Object.freeze({ ...(definition.collider ?? {}) }),
    state: Object.freeze({ ...(definition.state ?? {}) }),
});

const thrownZone = (abilityId, definition) => entity(abilityId, {
    factory: ENTITY_FACTORY_TYPES.THROWN_ZONE,
    ...definition,
});

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
        system: ENTITY_SYSTEM_TYPES.PROJECTILE,
        spawn: { mode: "forward", rotation: "zero", padding: 2 },
        motion: { speedStat: "speed", traveled: 0 },
        collider: { sizeStat: "size", shape: "rectangle" },
        state: {
            stoppedMs: 0,
            damageMultiplier: contextValue("damageMultiplier", ownerStat("attackDamageMultiplier", 1)),
        },
        projectile: Object.freeze({
            hit: "explode",
            explosion: Object.freeze({
                type: "grenadeExplosion",
                behaviorKey: "grenadeExplosion",
                category: ENTITY_CATEGORIES.ZONE,
                system: ENTITY_SYSTEM_TYPES.ABILITY,
                sizeStat: "explosionRadius",
                sizeMultiplier: 2,
                remainingStat: "explosionVisibleMs",
                durationMs: 200,
            }),
        }),
        derived: Object.freeze({
            grenadeExplosion: Object.freeze({
                kind: "radial",
                type: "grenadeExplosion",
                damageAbilityId: 4,
                effectTypes: Object.freeze([EFFECT_TYPES.DAMAGE]),
                once: true,
            }),
        }),
    }),
    5: entity(5, {
        entityType: "fireball",
        runtimeType: "fireball",
        category: ENTITY_CATEGORIES.PROJECTILE,
        system: ENTITY_SYSTEM_TYPES.PROJECTILE,
        spawn: { mode: "forward", rotation: "owner", padding: 2 },
        motion: { speedStat: "speed", traveled: 0 },
        lifetime: { durationStat: "durationMs" },
        collider: { sizeStat: "size", shape: "rectangle" },
        state: {
            damageMultiplier: contextValue("damageMultiplier", ownerStat("attackDamageMultiplier", 1)),
        },
        projectile: Object.freeze({ hit: "effects" }),
    }),
    11: thrownZone(11, {
        entityType: "proximity_mine",
        runtimeType: "proximityMine",
        category: ENTITY_CATEGORIES.TRAP,
        system: ENTITY_SYSTEM_TYPES.ABILITY,
        spawn: { mode: "self", rotation: "owner" },
        motion: { speedStat: "speedPerTick", traveled: 0 },
        lifetime: { durationStat: "durationMs" },
        collider: { sizeStat: "size", hittable: true },
        state: { phaseId: "travel", phaseTimerMs: 0, armed: false },
        behavior: Object.freeze({
            kind: "phase",
            phases: Object.freeze([
                Object.freeze({
                    id: "travel",
                    startMs: 0,
                    movement: Object.freeze({ mode: "travel" }),
                }),
                Object.freeze({
                    id: "armed",
                    startMs: 800,
                    movement: Object.freeze({ mode: "stopped" }),
                    trigger: Object.freeze({
                        radiusStat: "radius",
                        attackHits: true,
                        projectileOverlap: true,
                        botContact: true,
                        chain: true,
                    }),
                    effectTypes: Object.freeze([EFFECT_TYPES.DAMAGE]),
                    statOverrides: Object.freeze({ speedPerTick: 0 }),
                    explosion: Object.freeze({
                        type: "mineExplosion",
                        behaviorKey: "mineExplosion",
                        category: ENTITY_CATEGORIES.ZONE,
                        system: ENTITY_SYSTEM_TYPES.ABILITY,
                        sizeStat: "radius",
                        sizeMultiplier: 2,
                        visibleStat: "explosionVisibleMs",
                    }),
                }),
            ]),
            movement: Object.freeze({ mode: "travel" }),
            trigger: Object.freeze({
                radiusStat: "radius",
                attackHits: true,
                projectileOverlap: true,
                botContact: true,
                chain: true,
            }),
            effectTypes: Object.freeze([EFFECT_TYPES.DAMAGE]),
            explosion: Object.freeze({
                type: "mineExplosion",
                behaviorKey: "mineExplosion",
                category: ENTITY_CATEGORIES.ZONE,
                system: ENTITY_SYSTEM_TYPES.ABILITY,
                sizeStat: "radius",
                sizeMultiplier: 2,
                visibleStat: "explosionVisibleMs",
            }),
        }),
        derived: Object.freeze({
            mineExplosion: Object.freeze({
                kind: "visualZone",
                type: "mineExplosion",
                damageAbilityId: 11,
            }),
        }),
    }),
    14: thrownZone(14, {
        entityType: "gravity_zone",
        runtimeType: "gravityZone",
        category: ENTITY_CATEGORIES.ZONE,
        system: ENTITY_SYSTEM_TYPES.ABILITY,
        spawn: { mode: "self", rotation: "owner" },
        motion: { speedStat: "speedPerTick", traveled: 0 },
        lifetime: { durationStat: "durationMs" },
        collider: { sizeStat: "zoneSize" },
        state: {
            phaseId: "travel",
            armed: false,
            phaseTimerMs: 0,
        },
        behavior: Object.freeze({
            kind: "zone",
            phases: Object.freeze([
                Object.freeze({ id: "travel", startMs: 0, movement: Object.freeze({ mode: "travel" }) }),
                Object.freeze({
                    id: "fuse",
                    startMs: 2000,
                    movement: Object.freeze({ mode: "stopped" }),
                    effectTypes: Object.freeze([EFFECT_TYPES.PULL]),
                    statOverrides: Object.freeze({ speedPerTick: 0 }),
                }),
                Object.freeze({
                    id: "active",
                    startMs: 5000,
                    movement: Object.freeze({ mode: "stopped" }),
                    effectTypes: Object.freeze([EFFECT_TYPES.DAMAGE]),
                    statOverrides: Object.freeze({ speedPerTick: 0 }),
                    explosion: Object.freeze({
                        type: "gravityExplosion",
                        behaviorKey: "gravityExplosion",
                        category: ENTITY_CATEGORIES.ZONE,
                        system: ENTITY_SYSTEM_TYPES.ABILITY,
                        sizeStat: "zoneSize",
                        sizeMultiplier: 2,
                        visibleStat: "explosionVisibleMs",
                    }),
                }),
            ]),
        }),
        derived: Object.freeze({
            gravityExplosion: Object.freeze({
                kind: "visualZone",
                type: "gravityExplosion",
                damageAbilityId: 14,
            }),
        }),
    }),
    15: entity(15, {
        entityType: "silence_wave",
        runtimeType: "silenceWave",
        category: ENTITY_CATEGORIES.PROJECTILE,
        system: ENTITY_SYSTEM_TYPES.ABILITY,
        spawn: { mode: "self", rotation: "owner" },
        motion: { speedStat: "waveSpeedPerTick" },
        lifetime: { durationStat: "durationMs" },
        collider: { sizeStat: "projectileSize", shape: "rectangle" },
        state: { hitSlots: [] },
        behavior: Object.freeze({
            kind: "segment",
            movement: Object.freeze({ mode: "segment", scale: "unit", clamp: true }),
            lifetimeField: "remainingMs",
            hit: Object.freeze({
                mode: "all",
                oncePerSlot: true,
                effectTypes: Object.freeze([EFFECT_TYPES.DEBUFF, EFFECT_TYPES.INTERRUPT]),
            }),
        }),
    }),
    17: entity(17, {
        entityType: "hunter_drone",
        runtimeType: "hunterDrone",
        category: ENTITY_CATEGORIES.SUMMON,
        spawn: { mode: "self", rotation: "owner" },
        lifetime: { durationStat: "durationMs" },
        collider: { sizeStat: "size", hittable: true },
        health: { hpStat: "hp", maxHpStat: "hp" },
        state: { shotCooldownMs: 0 },
        behavior: Object.freeze({
            kind: "summon",
            movement: Object.freeze({ mode: "seek", speedStat: "moveSpeed", turnStat: "turnStepDegrees", sizeStat: "size" }),
            attack: Object.freeze({
                rangeStat: "range",
                cooldownField: "shotCooldownMs",
                cooldownStat: "shotCooldownMs",
                visualField: "shotVisualMs",
                visualStat: "shotVisualMs",
                effectTypes: Object.freeze([EFFECT_TYPES.DAMAGE]),
            }),
        }),
    }),
    18: entity(18, {
        entityType: "windburst_projectile",
        runtimeType: "windburstProjectile",
        category: ENTITY_CATEGORIES.PROJECTILE,
        spawn: { mode: "forward", rotation: "owner", padding: 2 },
        motion: { speedStat: "speedPerTick", traveled: 0 },
        lifetime: { durationStat: "durationMs" },
        collider: { sizeStat: "size", hittable: true, shape: "rectangle" },
        state: { damageMultiplier: contextValue("damageMultiplier", ownerStat("attackDamageMultiplier", 1)) },
        behavior: Object.freeze({
            kind: "segment",
            movement: Object.freeze({ mode: "segment", scale: "stepRatio", clamp: true }),
            rangeStat: "range",
            lifetimeField: "remainingMs",
            hit: Object.freeze({
                mode: "nearest",
                removeOnHit: true,
                knockbackDirection: "velocity",
                effectTypes: Object.freeze([EFFECT_TYPES.DAMAGE, EFFECT_TYPES.KNOCKBACK]),
            }),
        }),
    }),
    21: entity(21, {
        entityType: "temporal_rewind_zone",
        runtimeType: "temporalRewindZone",
        category: ENTITY_CATEGORIES.ZONE,
        spawn: { mode: "self", rotation: "zero" },
        // The entity world advances the newly spawned zone during the same
        // arena step in which the ability is activated.
        lifetime: { durationStat: "durationMs", add: 0 },
        collider: { sizeStat: "zoneSize" },
        behavior: Object.freeze({ kind: "lifetime" }),
    }),
    22: entity(22, {
        entityType: "orbital_zone",
        runtimeType: "orbitalMarker",
        category: ENTITY_CATEGORIES.ZONE,
        targeting: { owner: "owner" },
        spawn: { mode: "target", rotation: "zero", defaultX: 500, defaultY: 400 },
        lifetime: { durationStat: "durationMs", add: 0 },
        collider: { sizeStat: "markerSize" },
        state: { intervalTimerMs: 0 },
        behavior: Object.freeze({
            kind: "interval",
            intervalStat: "intervalMs",
            effectTypes: Object.freeze([EFFECT_TYPES.DAMAGE]),
            radiusStat: "radius",
            explosion: Object.freeze({
                type: "orbitalExplosion",
                behaviorKey: "orbitalExplosion",
                category: ENTITY_CATEGORIES.ZONE,
                system: ENTITY_SYSTEM_TYPES.ABILITY,
                sizeStat: "markerSize",
                sizeMultiplier: 1,
                visibleStat: "explosionVisibleMs",
            }),
            skipOwner: true,
        }),
        derived: Object.freeze({
            orbitalExplosion: Object.freeze({
                kind: "visualZone",
                type: "orbitalExplosion",
                damageAbilityId: 22,
            }),
        }),
    }),
    24: entity(24, {
        entityType: "null_zone",
        runtimeType: "nullZone",
        category: ENTITY_CATEGORIES.ZONE,
        spawn: { mode: "target", rotation: "zero", clampToRadiusStat: "radius", defaultX: "owner.x", defaultY: "owner.y" },
        motion: { traveled: 0 },
        lifetime: { durationStat: "durationMs" },
        collider: { sizeStat: "zoneSize" },
        state: { armed: true },
        behavior: Object.freeze({
            kind: "zone",
            activeEffectTypes: Object.freeze([EFFECT_TYPES.DEBUFF]),
        }),
    }),
    27: entity(27, {
        entityType: "singularity_zone",
        runtimeType: "singularityZone",
        category: ENTITY_CATEGORIES.ZONE,
        system: ENTITY_SYSTEM_TYPES.ABILITY,
        targeting: { owner: "owner" },
        spawn: { mode: "target", rotation: "zero", defaultX: 500, defaultY: 400 },
        lifetime: { durationStat: "durationMs" },
        collider: { sizeStat: "zoneSize" },
        state: { phaseId: "fuse", phaseTimerMs: 0, armed: true },
        behavior: Object.freeze({
            kind: "zone",
            phases: Object.freeze([
                Object.freeze({
                    id: "fuse",
                    startMs: 0,
                    movement: Object.freeze({ mode: "stopped" }),
                    effectTypes: Object.freeze([EFFECT_TYPES.PULL]),
                    statOverrides: Object.freeze({ speedPerTick: 0 }),
                }),
                Object.freeze({
                    id: "active",
                    startMs: 1200,
                    movement: Object.freeze({ mode: "stopped" }),
                    effectTypes: Object.freeze([EFFECT_TYPES.DAMAGE]),
                    statOverrides: Object.freeze({ speedPerTick: 0 }),
                    explosion: Object.freeze({
                        type: "singularityExplosion",
                        behaviorKey: "singularityExplosion",
                        category: ENTITY_CATEGORIES.ZONE,
                        system: ENTITY_SYSTEM_TYPES.ABILITY,
                        sizeStat: "zoneSize",
                        sizeMultiplier: 1,
                        visibleStat: "explosionVisibleMs",
                    }),
                }),
            ]),
        }),
        derived: Object.freeze({
            singularityExplosion: Object.freeze({
                kind: "visualZone",
                type: "singularityExplosion",
                damageAbilityId: 27,
            }),
        }),
    }),
    28: entity(28, {
        entityType: "tether_bolt",
        runtimeType: "tetherBolt",
        category: ENTITY_CATEGORIES.PROJECTILE,
        system: ENTITY_SYSTEM_TYPES.ABILITY,
        spawn: { mode: "forward", rotation: "owner", padding: 2 },
        motion: { speedStat: "speedPerTick", traveled: 0 },
        lifetime: { durationStat: "durationMs" },
        collider: { sizeStat: "size", shape: "rectangle" },
        state: { damageMultiplier: contextValue("damageMultiplier", ownerStat("attackDamageMultiplier", 1)) },
        behavior: Object.freeze({
            kind: "segment",
            movement: Object.freeze({ mode: "segment", scale: "stepRatio", clamp: true }),
            rangeStat: "range",
            lifetimeField: "remainingMs",
            hit: Object.freeze({
                mode: "nearest",
                removeOnHit: true,
                oncePerSlot: true,
                effectTypes: Object.freeze([EFFECT_TYPES.DAMAGE, EFFECT_TYPES.PULL, EFFECT_TYPES.DEBUFF]),
            }),
        }),
    }),
    29: thrownZone(29, {
        entityType: "static_snare",
        runtimeType: "staticSnare",
        category: ENTITY_CATEGORIES.TRAP,
        system: ENTITY_SYSTEM_TYPES.ABILITY,
        spawn: { mode: "self", rotation: "owner" },
        lifetime: { durationStat: "durationMs" },
        collider: { sizeStat: "size", hittable: true },
        health: { hpStat: "hp", maxHpStat: "hp" },
        state: { armed: true },
        behavior: Object.freeze({
            kind: "trap",
            trigger: Object.freeze({
                radiusStat: "triggerRadius",
                attackHits: true,
                projectileOverlap: true,
                botContact: true,
                chain: false,
                requiresDestruction: true,
            }),
            effectTypes: Object.freeze([EFFECT_TYPES.DAMAGE, EFFECT_TYPES.DEBUFF, EFFECT_TYPES.INTERRUPT]),
            skipOwner: true,
            phases: Object.freeze([
                Object.freeze({
                    id: "armed",
                    startMs: 0,
                    movement: Object.freeze({ mode: "stopped" }),
                    trigger: Object.freeze({
                        radiusStat: "triggerRadius",
                        attackHits: true,
                        projectileOverlap: true,
                        botContact: true,
                        chain: false,
                        requiresDestruction: true,
                    }),
                    effectTypes: Object.freeze([EFFECT_TYPES.DAMAGE, EFFECT_TYPES.DEBUFF, EFFECT_TYPES.INTERRUPT]),
                }),
                Object.freeze({
                    id: "destroyed",
                    startMs: 0,
                    movement: Object.freeze({ mode: "stopped" }),
                    trigger: Object.freeze({
                        radiusStat: "triggerRadius",
                        attackHits: true,
                        projectileOverlap: true,
                        botContact: false,
                        chain: false,
                        requiresDestruction: true,
                    }),
                    effectTypes: Object.freeze([EFFECT_TYPES.DAMAGE, EFFECT_TYPES.DEBUFF, EFFECT_TYPES.INTERRUPT]),
                    statOverrides: Object.freeze({ triggerRadius: 120 }),
                    effectOverrides: Object.freeze({
                        [EFFECT_TYPES.DAMAGE]: Object.freeze({ amount: 20 }),
                        [EFFECT_TYPES.DEBUFF]: Object.freeze({ durationMs: 3000 }),
                    }),
                }),
            ]),
            explosion: Object.freeze({
                type: "staticSnareBurst",
                behaviorKey: "staticSnareBurst",
                category: ENTITY_CATEGORIES.ZONE,
                system: ENTITY_SYSTEM_TYPES.ABILITY,
                sizeStat: "triggerRadius",
                sizeMultiplier: 2,
                visibleStat: "explosionVisibleMs",
            }),
        }),
        derived: Object.freeze({
            staticSnareBurst: Object.freeze({
                kind: "visualZone",
                type: "staticSnareBurst",
            }),
        }),
    }),
    31: entity(31, {
        entityType: "repeller_drone",
        // Repeller Drone uses the same physical/rendered drone as Hunter Drone;
        // ability 31 still owns a separate attack contract for knockback shots.
        runtimeType: "hunterDrone",
        category: ENTITY_CATEGORIES.SUMMON,
        spawn: { mode: "self", rotation: "owner" },
        lifetime: { durationStat: "durationMs" },
        collider: { sizeStat: "size", hittable: true },
        health: { hpStat: "hp", maxHpStat: "hp" },
        state: { shotCooldownMs: 0 },
        behavior: Object.freeze({
            kind: "summon",
            movement: Object.freeze({ mode: "seek", speedStat: "moveSpeed", turnStat: "turnStepDegrees", sizeStat: "size" }),
            attack: Object.freeze({
                rangeStat: "range",
                cooldownField: "shotCooldownMs",
                cooldownStat: "shotCooldownMs",
                visualField: "shotVisualMs",
                visualStat: "shotVisualMs",
                effectTypes: Object.freeze([EFFECT_TYPES.DAMAGE, EFFECT_TYPES.KNOCKBACK]),
            }),
        }),
    }),
});

const CONTRACTS_BY_RUNTIME_TYPE = Object.freeze(Object.fromEntries(
    Object.values(ENTITY_CONTRACTS).map((definition) => [definition.runtimeType, definition]),
));
const CONTRACTS_BY_ENTITY_TYPE = Object.freeze(Object.fromEntries(
    Object.values(ENTITY_CONTRACTS).map((definition) => [definition.entityType, definition]),
));
const CONTRACTS_BY_DERIVED_TYPE = Object.freeze(Object.fromEntries(
    Object.values(ENTITY_CONTRACTS)
        .flatMap((definition) => Object.values(definition.derived ?? {})
            .filter((derived) => derived.type)
            .map((derived) => [derived.type, definition])),
));

export function entityContract(value) {
    if (value && typeof value === "object" && value.runtimeType) return value;
    if (Number.isSafeInteger(value)) return ENTITY_CONTRACTS[value] ?? null;
    return CONTRACTS_BY_ENTITY_TYPE[value] ?? CONTRACTS_BY_RUNTIME_TYPE[value] ?? CONTRACTS_BY_DERIVED_TYPE[value] ?? null;
}

export function entityContractForAbility(abilityValue) {
    const abilityId = abilityValue?.abilityId ?? abilityValue;
    const contract = abilityContract(abilityId);
    return contract?.effects.some(({ type }) => type === "spawn_entity")
        ? entityContract(abilityId)
        : null;
}

export function entitySystemType(entity) {
    return entity?.entitySystem
        ?? entityContract(entity?.abilityId)?.system
        ?? entityContract(entity?.entityContractType ?? entity?.type)?.system
        ?? (["mineExplosion", "orbitalExplosion", "gravityExplosion", "grenadeExplosion", "staticSnareBurst"].includes(entity?.type)
            ? ENTITY_SYSTEM_TYPES.ABILITY
            : null);
}

export function isProjectileEntity(entity) {
    return entitySystemType(entity) === ENTITY_SYSTEM_TYPES.PROJECTILE;
}
