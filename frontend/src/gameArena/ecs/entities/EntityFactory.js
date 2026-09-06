import { compassDirection } from "../../botlogic/planner/arenaAngles.js";
import { abilityId as resolveAbilityId } from "../../gameconfig/AbilityRegistry.js";
import { ARENA_HEIGHT_UNITS, ARENA_WIDTH_UNITS } from "../../modelPayloads/arenaConstants.js";
import { entityContractForAbility } from "../contracts/EntityContracts.js";
import { selectableIdentitiesForAbilityEntity } from "../../modelPayloads/selectableIdentities.js";

let nextEntityId = 1;

/** Creates the canonical component envelope used by browser arena systems. */
export function createEntity({
    id,
    type,
    entityContractId,
    entityContractType,
    entityCategory,
        selectableIdentities,
        owner,
    transform,
    motion = {},
    lifetime = {},
    collider = {},
    health = null,
    state = {},
}) {
    const entityId = id ?? `${type}-${owner.id}-${Date.now()}-${nextEntityId++}`;
    return {
        id: entityId,
        type,
        ...(entityContractId ? { entityContractId } : {}),
        ...(entityContractType ? { entityContractType } : {}),
        ...(entityCategory ? { category: entityCategory, entityCategory } : {}),
        selectableIdentities: selectableIdentities ?? [],
        abilityId: owner.abilityId,
        ownerId: owner.id,
        ownerSlot: owner.slot,
        ownerTeam: owner.teamNumber,
        x: transform.x,
        y: transform.y,
        rotation: transform.rotation ?? 0,
        size: collider.size ?? 0,
        velocityX: motion.x ?? 0,
        velocityY: motion.y ?? 0,
        traveled: motion.traveled ?? 0,
        ageMs: lifetime.ageMs ?? 0,
        remainingMs: lifetime.remainingMs ?? null,
        hp: health?.hp,
        maxHp: health?.maxHp,
        locked: true,
        components: {
            transform: { ...transform },
            motion: { ...motion },
            lifetime: { ...lifetime },
            collider: { ...collider },
            ownership: { ownerId: owner.id, ownerSlot: owner.slot, ownerTeam: owner.teamNumber },
            ...(health ? { health: { ...health } } : {}),
        },
        ...state,
    };
}

/**
 * Resolves the entity contract for an ability and creates its normalized
 * payload. Entity existence and behavior are owned by the entity registry;
 * direct ability contracts do not carry a duplicate spawn effect.
 */
export function createAbilityEntity(bot, abilityValue, context = {}) {
    const abilityId = resolveAbilityId(abilityValue);
    if (abilityId == null) return null;

    const entityDefinition = entityContractForAbility(abilityId);
    if (!entityDefinition) return null;

    const serial = context.serial ?? null;
    return createEntityFromContract(bot, entityDefinition, {
        ...context,
        abilityId,
        entityContractId: entityDefinition.abilityId,
        entityContractType: entityDefinition.entityType,
        id: context.id ?? (serial == null ? undefined : `${entityDefinition.runtimeType}-${bot.id}-${serial}`),
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
    const resolvedColliderSize = Number(resolveStat(contract.collider.size, { bot, stats, context }));
    const size = Number(context.sizeOverride ?? (resolvedColliderSize
        * Number(contract.collider.sizeMultiplier ?? 1)));
    const transform = buildTransform(bot, contract.spawn, contract.targeting, size, { ...context, stats });
    const motion = buildMotion(bot, contract.phases?.[0], { stats, context });
    const state = resolveRecord(contract.state, { bot, stats, context });
    const lifetime = buildLifetime(contract.lifetime, {
        bot,
        stats,
        context,
    });
    const collider = resolveRecord(contract.collider, {
        bot,
        stats,
        context,
        skip: ["size", "sizeMultiplier"],
    });
    collider.size = size;
    const health = contract.health
        ? {
            hp: Number(resolveStat(contract.health.hp, { bot, stats, context })),
            maxHp: Number(resolveStat(contract.health.maxHp ?? contract.health.hp, { bot, stats, context })),
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
        collider,
        health,
        state,
    };
}

function buildTransform(bot, spawn, targeting, size, context) {
    const rotation = spawn?.rotation === "zero" ? 0 : Number(bot.rotation ?? 0);
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
    const offset = spawn?.offset ?? { x: 0, y: 0 };
    const localX = Number(offset.x ?? 0);
    const localY = Number(offset.y ?? 0);
    const forward = compassDirection(bot.rotation);
    const right = compassDirection(Number(bot.rotation ?? 0) + 90);
    return {
        x: Number(bot.x) + right.x * localX + forward.x * localY,
        y: Number(bot.y) + right.y * localX + forward.y * localY,
        rotation,
    };
}

function buildMotion(bot, firstPhase, { stats, context }) {
    const direction = compassDirection(bot.rotation);
    const speedValue = firstPhase?.movement?.speed;
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
