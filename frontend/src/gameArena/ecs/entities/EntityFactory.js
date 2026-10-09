import { compassDirection } from "../../botlogic/planner/arenaAngles.js";
import { abilityId as resolveAbilityId } from "../../gameconfig/AbilityRegistry.js";
import { ARENA_HEIGHT_UNITS, ARENA_WIDTH_UNITS } from "../../modelPayloads/arenaConstants.js";
import { abilityContract, entityContractForAbility, SPAWN_PATTERN_TYPES } from "../contracts/AbilityContracts.js";
import { selectableIdentitiesForAbilityEntity } from "../../modelPayloads/selectableIdentities.js";
import { ENTITY_KIND } from "./EntityCombat.js";

let nextEntityId = 1;

/**
 * Creates the one entity format. Every field is present, in this order, for every entity (`null` or a
 * neutral value when it does not apply), so all entities share one object shape.
 */
export function createEntity({
    id,
    type,
    entityContractId,
    entityContractType,
    entityCategory,
    selectableIdentities,
    owner,
    transform,
    motion,
    lifetime,
    health,
    size,
    state,
    phaseId,
    phaseTimerMs,
    eventScheduleState,
    intervalTimerMs,
    armed,
    entityKey,
    patternAngle,
    patternLateral,
    bindToCast,
    boundActivation,
}) {
    const entityId = id ?? `${type}-${owner.id}-${Date.now()}-${nextEntityId++}`;
    return {
        kind: ENTITY_KIND,
        id: entityId,
        type,
        entityContractId,
        entityContractType,
        category: entityCategory,
        entityCategory,
        selectableIdentities,
        abilityId: owner.abilityId,
        ownerId: owner.id,
        ownerSlot: owner.slot,
        ownerTeam: owner.teamNumber ?? null,
        x: transform.x,
        y: transform.y,
        rotation: transform.rotation,
        size,
        velocityX: motion.x,
        velocityY: motion.y,
        traveled: motion.traveled,
        ageMs: lifetime.ageMs,
        remainingMs: lifetime.remainingMs,
        hp: health ? health.hp : null,
        maxHp: health ? health.maxHp : null,
        statusEffects: [],
        phaseId,
        phaseTimerMs,
        eventScheduleState,
        intervalTimerMs,
        armed,
        phaseLocked: false,
        phaseEnteredThisTick: false,
        hitLedger: {},
        locked: true,
        damageMultiplier: state.damageMultiplier ?? null,
        entityKey,
        patternAngle,
        patternLateral,
        bindToCast,
        boundActivation,
        tickStartHp: null,
        damageTakenThisTick: 0,
        damageTakenLastTick: 0,
        hpNetChangeLastTick: 0,
        eventSequence: 0,
        eventType: null,
        eventPhaseId: null,
        visualEvent: 0,
        visualEventMs: 0,
        shotVisualMs: null,
    };
}

/**
 * Resolves the entity definition of an ability and creates its normalized payload (the single entity of the
 * ability's `spawn` verb, with no pattern).
 */
export function createAbilityEntity(bot, abilityValue, context = {}) {
    const abilityId = resolveAbilityId(abilityValue);
    if (abilityId == null) return null;

    const entityDefinition = entityContractForAbility(abilityId);
    if (!entityDefinition) return null;
    return createEntityForDefinition(bot, abilityId, entityDefinition, context, 0, { angle: 0, lateral: 0 });
}

/**
 * The placements a spawn pattern describes, in index order: a heading offset in degrees and a sideways
 * offset in units from the spawn point. No pattern is one entity straight ahead.
 */
export function spawnPlacements(pattern) {
    if (!pattern) return [{ angle: 0, lateral: 0 }];
    const count = Math.max(1, Math.trunc(Number(pattern.count)));
    return Array.from({ length: count }, (_, index) => {
        if (pattern.type === SPAWN_PATTERN_TYPES.FAN) {
            const spread = Number(pattern.spreadDeg);
            return { angle: count === 1 ? 0 : -spread / 2 + index * spread / (count - 1), lateral: 0 };
        }
        if (pattern.type === SPAWN_PATTERN_TYPES.RING) return { angle: 360 * index / count, lateral: 0 };
        if (pattern.type === SPAWN_PATTERN_TYPES.LINE) {
            return { angle: 0, lateral: (index - (count - 1) / 2) * Number(pattern.spacing) };
        }
        return { angle: 0, lateral: 0 };
    });
}

/**
 * Creates the entities one `spawn` verb makes from `source` (the bot, or an entity spawning from its own
 * pose). Serial IDs run in index order from `context.serial`.
 */
export function spawnVerbEntities(source, abilityId, verb, context = {}) {
    const definition = abilityContract(abilityId)?.entities?.[verb?.entity];
    if (!definition) return [];
    return spawnPlacements(verb.pattern).map((placement, index) =>
        createEntityForDefinition(source, abilityId, definition, context, index, placement));
}

function createEntityForDefinition(bot, abilityId, definition, context, index, placement) {
    const serial = context.serial ?? null;
    return createEntityFromContract(bot, definition, {
        ...context,
        abilityId,
        entityContractId: abilityId,
        entityContractType: definition.entityType,
        placement,
        id: context.id ?? (serial == null ? undefined : `${definition.runtimeType}-${bot.id}-${serial + index}`),
    });
}

/** Creates a payload from its entity contract. */
export function createEntityFromContract(bot, contract, context = {}) {
    if (!contract?.runtimeType) return null;
    const options = buildEntityOptions(bot, contract, context);
    return createEntity(options);
}

function buildEntityOptions(bot, contract, context) {
    const abilityId = context.abilityId ?? bot.abilityId;
    // Entity behavior is phase-owned. Keep the resolver context available for
    // owner/context substitutions without importing the legacy ability stat
    // catalogue as a second entity-definition source.
    const stats = {};
    const firstPhase = contract.phases?.[0] ?? null;
    const placement = context.placement ?? { angle: 0, lateral: 0 };
    const size = Number(context.sizeOverride ?? phaseSize(firstPhase));
    const transform = buildTransform(bot, contract.spawn, contract.targeting, size, { ...context, stats }, placement);
    const motion = buildMotion(bot, firstPhase, { stats, context }, placement);
    const state = resolveRecord(contract.state, { bot, stats, context });
    const healthDefinition = firstPhase?.health ?? null;
    const lifetime = buildLifetime(contract.lifetime, {
        bot,
        stats,
        context,
    });
    const health = healthDefinition
        ? {
            hp: Number(resolveStat(healthDefinition.hp ?? healthDefinition.maxHp, { bot, stats, context })),
            maxHp: Number(resolveStat(healthDefinition.maxHp ?? healthDefinition.hp, { bot, stats, context })),
        }
        : null;
    return {
        id: context.id,
        type: contract.runtimeType,
        entityContractId: context.entityContractId ?? contract.abilityId,
        entityContractType: context.entityContractType ?? contract.entityType ?? contract.runtimeType,
        entityCategory: contract.category,
        selectableIdentities: selectableIdentitiesForAbilityEntity(contract, abilityId),
        owner: { id: bot.id, slot: bot.slot, abilityId },
        transform,
        motion,
        lifetime,
        health,
        size,
        phaseId: firstPhase?.id ?? null,
        phaseTimerMs: 0,
        eventScheduleState: {},
        intervalTimerMs: 0,
        armed: firstPhase?.id === "armed",
        state,
        entityKey: contract.entityType,
        patternAngle: placement.angle,
        patternLateral: placement.lateral,
        // A bound entity lives only while the activation that made it is still the ability's active stage.
        bindToCast: Boolean(contract.bindToCast),
        boundActivation: contract.bindToCast ? Number(context.activationSerial ?? 0) : null,
    };
}

function phaseSize(phase) {
    const visualSize = Number(phase?.visual?.visualSize);
    if (Number.isFinite(visualSize) && visualSize > 0) return visualSize;

    const hitbox = phase?.hitbox ?? {};
    if (hitbox.shape === "circle") return Math.max(0, Number(hitbox.radius ?? 0) * 2);
    if (hitbox.shape === "rectangle") {
        return Math.max(Number(hitbox.width ?? 0), Number(hitbox.length ?? 0));
    }
    if (hitbox.shape === "ray") return Math.max(0, Number(hitbox.width ?? 0));
    if (hitbox.shape === "arc") return Math.max(0, Number(hitbox.range ?? 0) * 2);
    return 0;
}

function buildTransform(bot, spawn, targeting, size, context, placement) {
    const ownerRotation = bot.rotation;
    const rotation = (spawn?.rotationSpace === "world"
        ? Number(spawn.rotation ?? 0)
        : ownerRotation + Number(spawn?.rotation ?? 0)) + placement.angle;
    if (targeting?.position === "target") {
        const radius = targeting.clampToRadius == null
            ? 0
            : Number(typeof targeting.clampToRadius === "number"
                ? targeting.clampToRadius
                : resolveValue({ stat: targeting.clampToRadius, fallback: 0 }, { bot, stats: context.stats ?? {}, context }));
        const width = Number(context.width ?? ARENA_WIDTH_UNITS);
        const height = Number(context.height ?? ARENA_HEIGHT_UNITS);
        const targetX = context.targetX ?? resolveTargetDefault(targeting.defaultX, bot.x);
        const targetY = context.targetY ?? resolveTargetDefault(targeting.defaultY, bot.y);
        return {
            x: clampTarget(targetX, radius, width - radius, context.clamp),
            y: clampTarget(targetY, radius, height - radius, context.clamp),
            rotation,
        };
    }
    return ownerRelativePose(bot, spawn, placement);
}

/** The pose of an entity placed relative to its owner: spawn offset (x right, y forward) and rotation. */
export function ownerRelativePose(bot, spawn, placement = { angle: 0, lateral: 0 }) {
    const ownerRotation = bot.rotation;
    const rotation = (spawn?.rotationSpace === "world"
        ? Number(spawn.rotation ?? 0)
        : ownerRotation + Number(spawn?.rotation ?? 0)) + placement.angle;
    const offset = spawn?.offset ?? { x: 0, y: 0 };
    const localX = Number(offset.x ?? 0) + placement.lateral;
    const localY = Number(offset.y ?? 0);
    const forward = compassDirection(bot.rotation);
    const right = compassDirection(bot.rotation + 90);
    return {
        x: Number(bot.x) + right.x * localX + forward.x * localY,
        y: Number(bot.y) + right.y * localX + forward.y * localY,
        rotation,
    };
}

function buildMotion(bot, firstPhase, { stats, context }, placement) {
    const direction = compassDirection(bot.rotation + placement.angle);
    const speedValue = firstPhase?.movement?.unitsPerTick;
    const speed = typeof speedValue === "number"
        ? speedValue
        : Number(resolveStat(speedValue, { bot, stats, context }));
    const traveled = context.traveledOverride ?? 0;
    return {
        x: direction.x * speed,
        y: direction.y * speed,
        traveled: Number(traveled ?? 0),
    };
}

function buildLifetime(definition, { bot, stats, context }) {
    const remaining = context.durationOverride
        ?? (definition?.duration
            ? Number(resolveStat(definition.duration, { bot, stats, context }))
            : null);
    const adjusted = remaining == null ? null : remaining + Number(definition?.add ?? 0);
    return { ageMs: 0, remainingMs: adjusted };
}

function resolveRecord(record, values, { skip = [] } = {}) {
    return Object.fromEntries(Object.entries(record ?? {})
        .filter(([key]) => !skip.includes(key))
        .map(([key, value]) => [key, resolveValue(value, values)]));
}

function resolveValue(value, { bot, stats, context }) {
    if (value == null) return value;
    if (typeof value === "number" || typeof value === "boolean" || typeof value === "string") {
        return value;
    }
    if (Array.isArray(value)) return value.map((item) => resolveValue(item, { bot, stats, context }));
    if (Object.hasOwn(value, "stat")) return stats[value.stat] ?? value.fallback;
    if (Object.hasOwn(value, "ownerStat")) return bot[value.ownerStat] ?? value.fallback;
    if (Object.hasOwn(value, "context")) {
        return context[value.context] ?? resolveValue(value.fallback, { bot, stats, context });
    }
    if (Object.hasOwn(value, "add")) {
        return Number(resolveValue(value.add, { bot, stats, context })) + Number(value.amount ?? 0);
    }
    return value;
}

function resolveStat(name, values) {
    if (name == null) return null;
    return typeof name === "number"
        ? name
        : resolveValue({ stat: name, fallback: 0 }, values);
}

function resolveTargetDefault(value, fallback) {
    if (value === "owner.x" || value === "owner.y") return fallback;
    return value ?? fallback;
}

function clampTarget(value, min, max, clamp) {
    const numeric = Number(value);
    if (typeof clamp === "function") return clamp(numeric, min, max);
    return Math.max(min, Math.min(max, numeric));
}
