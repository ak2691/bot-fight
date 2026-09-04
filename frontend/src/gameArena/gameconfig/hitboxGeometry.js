import { ABILITY_STATS } from "./Abilities.js";
import { abilityContract, DELIVERY_TYPES, HITBOX_GEOMETRIES } from "./AbilityContracts.js";
import { movingCircleCollision, movingRectangleCollision } from "./geometry.js";
import { compassDegreesToRadians } from "../botlogic/planner/arenaAngles.js";
import { entityContract, phaseForEntity } from "../ecs/contracts/EntityContracts.js";
import { COMBAT_VISUAL_ABILITY_IDS, combatVisualDurationMs, combatVisualRemainingMs } from "./visualState.js";

export const COLLIDER_SHAPES = Object.freeze({
    CIRCLE: "circle",
    RECTANGLE: "rectangle",
});

/** Resolves the declarative collider metadata for an arena entity. */
export function colliderShapeForEntity(entity) {
    const contract = contractForEntity(entity);
    return phaseForEntity(entity)?.hitbox?.shape
        ?? contract?.collider?.shape
        ?? COLLIDER_SHAPES.CIRCLE;
}

/**
 * Returns the active direct-ability hitbox used by the practice overlay.
 * Origin and facing come from the captured activation pose when available so
 * a moving bot cannot visually drag an already-fired hitbox with it.
 */
export function hitboxGeometryForBot(bot, position = null) {
    if (bot?.hp != null && Number(bot.hp) <= 0) return null;
    const abilityId = activeDirectAbilityForBot(bot);
    if (abilityId == null) return null;

    const contract = abilityContract(abilityId);
    const delivery = contract?.delivery?.type;
    if (!isHitboxDelivery(delivery)) return null;

    const remainingMs = combatVisualRemainingMs(bot, abilityId);
    if (remainingMs <= 0) return null;
    const stats = ABILITY_STATS[abilityId] ?? {};
    const durationMs = Math.max(1, combatVisualDurationMs(abilityId, stats), remainingMs);
    const origin = botActivationOrigin(bot, position);
    const rotation = compassDegreesToRadians(bot?.abilityVisual?.rotation
        ?? bot?.visualOriginRotation
        ?? bot?.hitboxRotation
        ?? bot?.rotation
        ?? 0);
    const opacity = Math.min(1, remainingMs / durationMs);

    if (delivery === DELIVERY_TYPES.MELEE
        && contract.delivery.geometry === HITBOX_GEOMETRIES.RECTANGLE) {
        const length = Number(stats.range ?? 0);
        const height = Math.max(0, Number(stats.hitboxWidth ?? bot?.size ?? 60));
        if (length <= 0 || height <= 0) return null;
        const direction = { x: Math.cos(rotation), y: Math.sin(rotation) };
        return {
            shape: COLLIDER_SHAPES.RECTANGLE,
            x: origin.x + direction.x * length / 2,
            y: origin.y + direction.y * length / 2,
            width: length,
            height,
            rotation,
            opacity,
            remainingMs,
            durationMs,
            abilityId,
        };
    }

    if (delivery === DELIVERY_TYPES.RAY) {
        const length = Number(stats.range ?? 0);
        const width = Number(stats.hitboxWidth ?? 5);
        return length > 0 ? {
            shape: "ray",
            x: origin.x,
            y: origin.y,
            length,
            width: Number.isFinite(width) && width > 0 ? width : 5,
            rotation,
            opacity,
            remainingMs,
            durationMs,
            abilityId,
        } : null;
    }

    if (delivery === DELIVERY_TYPES.RADIAL) {
        const radius = Number(stats.radius ?? stats.range ?? 0);
        return radius > 0 ? {
            shape: COLLIDER_SHAPES.CIRCLE,
            x: origin.x,
            y: origin.y,
            radius,
            opacity,
            remainingMs,
            durationMs,
            abilityId,
        } : null;
    }

    const radius = Number(stats.range ?? 0);
    if (radius <= 0) return null;
    return {
        shape: "sector",
        x: origin.x,
        y: origin.y,
        radius,
        rotation,
        halfAngle: Number(stats.arc ?? 36) * Math.PI / 360,
        opacity,
        remainingMs,
        durationMs,
        abilityId,
    };
}

/** Returns all debug hitboxes represented by one entity, including summon rays. */
export function hitboxGeometriesForEntity(entity) {
    const geometries = [];
    const collider = hitboxGeometryForEntity(entity);
    if (collider) geometries.push(collider);
    const attack = summonAttackHitboxGeometry(entity);
    if (attack) geometries.push(attack);
    return geometries;
}

/**
 * Resolves one entity-vs-entity movement collision. Projectile colliders are
 * rectangles with independent longitudinal length and cross-axis width; all
 * other colliders retain their existing circular fallback.
 * Keeping this dispatch in one helper prevents the renderer and the two
 * browser ECS systems from silently drifting apart.
 */
export function movingEntityCollision(
    first,
    firstStart,
    firstEnd,
    second,
    secondStart,
    secondEnd,
    padding = 0,
) {
    const firstSize = entitySize(first);
    const secondSize = entitySize(second);
    const firstWidth = entityHitboxWidth(first);
    const secondWidth = entityHitboxWidth(second);
    const firstLength = entityLength(first);
    const secondLength = entityLength(second);
    const firstShape = colliderShapeForEntity(first);
    const secondShape = colliderShapeForEntity(second);
    if (firstShape === COLLIDER_SHAPES.RECTANGLE) {
        const extra = Math.max(0, Number(padding) || 0) * 2;
        return movingRectangleCollision(
            firstStart,
            firstEnd,
            firstLength + extra,
            firstWidth + extra,
            entityMotionAngle(first, firstStart, firstEnd),
            secondStart,
            secondEnd,
            secondSize / 2,
        );
    }
    if (secondShape === COLLIDER_SHAPES.RECTANGLE) {
        const extra = Math.max(0, Number(padding) || 0) * 2;
        return movingRectangleCollision(
            secondStart,
            secondEnd,
            secondLength,
            secondWidth,
            entityMotionAngle(second, secondStart, secondEnd),
            firstStart,
            firstEnd,
            firstSize / 2 + extra / 2,
        );
    }
    return movingCircleCollision(
        firstStart,
        firstEnd,
        firstSize / 2 + Math.max(0, Number(padding) || 0),
        secondStart,
        secondEnd,
        secondSize / 2,
    );
}

/** Returns whether two phase-defined entities overlap during their movement. */
export function overlapsEntity(first, second, padding = 0) {
    const firstPath = entityMovementSegment(first);
    const secondPath = entityMovementSegment(second);
    return movingEntityCollision(
        first,
        firstPath.start,
        firstPath.end,
        second,
        secondPath.start,
        secondPath.end,
        padding,
    ).hit;
}

/**
 * Returns the debug geometry for an entity-backed gameplay hitbox. The active
 * phase owns both the collider shape and its dimensions.
 */
export function hitboxGeometryForEntity(entity) {
    const contract = contractForEntity(entity);
    if (!contract?.collider) return null;
    const phase = phaseForEntity(entity);
    if (phase?.type === "self" || phase?.type === "summon" && !phase.hitbox) return null;
    if (contract.category === "trap" && phase?.id === "travel" && !entity.armed) return null;
    if (colliderShapeForEntity(entity) === COLLIDER_SHAPES.RECTANGLE) {
        const width = entityHitboxWidth(entity);
        const length = entityLength(entity);
        return {
            shape: COLLIDER_SHAPES.RECTANGLE,
            width: length,
            height: width,
            rotation: entityMotionAngle(entity),
        };
    }

    const stats = ABILITY_STATS[Number(contract.abilityId)] ?? {};
    const trigger = phase?.trigger;
    const radiusValue = phase?.hitbox?.radius
        ?? phase?.statOverrides?.radius
        ?? trigger?.radius
        ?? phase?.radius;
    const radius = resolveStatValue(radiusValue, stats, phase);
    const radiusMultiplier = Number(phase?.hitbox?.radiusMultiplier ?? 1);
    return {
        shape: COLLIDER_SHAPES.CIRCLE,
        radius: Number.isFinite(radius) && radius > 0 ? radius * radiusMultiplier : entitySize(entity) / 2,
    };
}

export function entityMotionAngle(entity, start = null, end = null) {
    const from = start ?? { x: Number(entity?.x ?? 0), y: Number(entity?.y ?? 0) };
    const to = end ?? {
        x: Number(entity?.x ?? 0) + Number(entity?.velocityX ?? 0),
        y: Number(entity?.y ?? 0) + Number(entity?.velocityY ?? 0),
    };
    const pathX = Number(to.x) - Number(from.x);
    const pathY = Number(to.y) - Number(from.y);
    if (Math.hypot(pathX, pathY) > 0.001) return Math.atan2(pathY, pathX);
    const velocityX = Number(entity?.velocityX ?? 0);
    const velocityY = Number(entity?.velocityY ?? 0);
    if (Math.hypot(velocityX, velocityY) > 0.001) return Math.atan2(velocityY, velocityX);
    return compassDegreesToRadians(entity?.rotation ?? 0);
}

function summonAttackHitboxGeometry(entity) {
    const contract = contractForEntity(entity);
    const phase = phaseForEntity(entity);
    const attack = phase?.attack;
    const remainingMs = Number(entity?.[attack?.visualField] ?? 0);
    if (!attack || remainingMs <= 0) return null;
    const stats = ABILITY_STATS[Number(contract.abilityId)] ?? {};
    const rangeValue = attack.range ?? attack.rangeStat ?? "range";
    const length = resolveStatValue(rangeValue, stats, phase);
    if (length <= 0) return null;
    const durationMs = Math.max(1, Number(stats[attack.visualStat] ?? 300), remainingMs);
    return {
        shape: "ray",
        x: Number(entity?.x ?? 0),
        y: Number(entity?.y ?? 0),
        length,
        width: Math.max(4, Math.min(12, Number(entity?.size ?? 28) * 0.2)),
        rotation: compassDegreesToRadians(entity?.rotation ?? 0),
        opacity: Math.min(1, remainingMs / durationMs),
        remainingMs,
        durationMs,
        abilityId: Number(contract.abilityId),
    };
}

function activeDirectAbilityForBot(bot) {
    const visualAbility = Number(bot?.abilityVisual?.ability);
    if (Number.isSafeInteger(visualAbility)
        && isHitboxDelivery(abilityContract(visualAbility)?.delivery?.type)
        && Number(bot?.abilityVisual?.ms ?? 0) > 0) return visualAbility;
    return COMBAT_VISUAL_ABILITY_IDS.find((abilityId) =>
        isHitboxDelivery(abilityContract(abilityId)?.delivery?.type)
        && Number(bot?.abilityActiveMs?.[abilityId] ?? 0) > 0) ?? null;
}

function isHitboxDelivery(delivery) {
    return [DELIVERY_TYPES.MELEE, DELIVERY_TYPES.RAY, DELIVERY_TYPES.RADIAL].includes(delivery);
}

function botActivationOrigin(bot, position) {
    return {
        x: finiteNumber(bot?.abilityVisual?.x, bot?.visualOriginX, bot?.hitboxOriginX, position?.x, bot?.x),
        y: finiteNumber(bot?.abilityVisual?.y, bot?.visualOriginY, bot?.hitboxOriginY, position?.y, bot?.y),
    };
}

function finiteNumber(...values) {
    for (const value of values) {
        if (value == null || value === "") continue;
        const number = Number(value);
        if (Number.isFinite(number)) return number;
    }
    return 0;
}

function contractForEntity(entity) {
    return entityContract(entity?.entityContractId
        ?? entity?.abilityId
        ?? entity?.entityContractType
        ?? entity?.type);
}

function entityMovementSegment(entity) {
    const startX = Number.isFinite(Number(entity?.movementStartX))
        ? Number(entity.movementStartX)
        : Number(entity?.x ?? 0) - Number(entity?.velocityX ?? 0);
    const startY = Number.isFinite(Number(entity?.movementStartY))
        ? Number(entity.movementStartY)
        : Number(entity?.y ?? 0) - Number(entity?.velocityY ?? 0);
    return {
        start: { x: startX, y: startY },
        end: { x: Number(entity?.x ?? 0), y: Number(entity?.y ?? 0) },
    };
}

function entitySize(entity) {
    return Math.max(0, Number(entity?.size ?? 0));
}

function entityLength(entity) {
    const contract = contractForEntity(entity);
    const phase = phaseForEntity(entity);
    const stats = ABILITY_STATS[Number(contract?.abilityId)] ?? {};
    const lengthValue = phase?.hitbox?.length
        ?? phase?.statOverrides?.hitboxLength
        ?? stats.hitboxLength;
    const length = resolveStatValue(lengthValue, stats, phase);
    return Number.isFinite(length) && length > 0 ? length : entitySize(entity);
}

function entityHitboxWidth(entity) {
    const contract = contractForEntity(entity);
    const phase = phaseForEntity(entity);
    const stats = ABILITY_STATS[Number(contract?.abilityId)] ?? {};
    const widthValue = phase?.hitbox?.width
        ?? phase?.statOverrides?.hitboxWidth
        ?? stats.hitboxWidth;
    const width = resolveStatValue(widthValue, stats, phase);
    return Number.isFinite(width) && width > 0 ? width : entitySize(entity);
}

function resolveStatValue(value, stats, phase) {
    if (value == null) return NaN;
    if (typeof value === "number") return value;
    if (typeof value === "string") return Number(phase?.statOverrides?.[value] ?? stats[value]);
    return Number(value);
}
