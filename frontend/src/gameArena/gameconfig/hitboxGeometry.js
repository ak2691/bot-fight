import { attachedAbilityContract } from "../ecs/contracts/AbilityContracts.js";
import { movingCircleCollision, movingRectangleCollision } from "./geometry.js";
import { compassDegreesToRadians, compassDirection } from "../botlogic/planner/arenaAngles.js";
import { entityAbilityPhaseForEntity, entityAbilitySpawnForEntity, entityContract, phaseForEntity } from "../ecs/contracts/AbilityContracts.js";
import { COMBAT_VISUAL_ABILITY_IDS, combatVisualDurationMs, combatVisualRemainingMs } from "./visualState.js";

export const COLLIDER_SHAPES = Object.freeze({
    CIRCLE: "circle",
    RECTANGLE: "rectangle",
});

/** Resolves an entity-owned ability's local spawn point and firing rotation. */
export function entityAbilitySpawnTransform(entity, spawn = null, ownerRotation = null) {
    const rotation = Number(ownerRotation ?? entity?.rotation ?? 0);
    const offset = spawn?.offset ?? {};
    const forward = compassDirection(rotation);
    const right = compassDirection(rotation + 90);
    const rotationOffset = Number(spawn?.rotation ?? 0);
    const spawnRotation = spawn?.rotationSpace === "world"
        ? rotationOffset : rotation + rotationOffset;
    return {
        x: Number(entity?.x ?? 0) + right.x * Number(offset.x ?? 0) + forward.x * Number(offset.y ?? 0),
        y: Number(entity?.y ?? 0) + right.y * Number(offset.x ?? 0) + forward.y * Number(offset.y ?? 0),
        rotation: spawnRotation,
    };
}

/** Resolves a direct attached ability's owner-relative spawn point. */
export function attachedAbilitySpawnTransform(bot, spawn = null, ownerRotation = null) {
    return entityAbilitySpawnTransform(bot, spawn, ownerRotation);
}

/**
 * Resolves a direct ability pose, using authored activation capture fields when
 * present and otherwise resolving the root spawn against the current owner.
 */
export function attachedAbilityPose(bot, spawn = null, capture = null) {
    const captureFields = capture && typeof capture === "object"
        ? Object.entries(capture) : [];
    const fieldForSource = (source) => captureFields.find(([, value]) => value === source)?.[0];
    const xField = fieldForSource("x");
    const yField = fieldForSource("y");
    const rotationField = fieldForSource("rotation");
    const hasCapturedPose = [xField, yField, rotationField]
        .every((field) => field && Number.isFinite(Number(bot?.[field])));
    if (hasCapturedPose) {
        return {
            x: Number(bot[xField]),
            y: Number(bot[yField]),
            rotation: Number(bot[rotationField]),
        };
    }
    return attachedAbilitySpawnTransform(bot, spawn);
}

/** Resolves the declarative collider metadata for an arena entity. */
export function colliderShapeForEntity(entity) {
    return phaseForEntity(entity)?.hitbox?.shape
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

    const contract = attachedAbilityContract(abilityId);
    const hitbox = contract?.phases?.[0]?.hitbox;
    if (!hitbox?.shape) return null;

    const remainingMs = combatVisualRemainingMs(bot, abilityId);
    if (remainingMs <= 0) return null;
    const durationMs = Math.max(1, combatVisualDurationMs(abilityId), remainingMs);
    const origin = botActivationOrigin(bot, position);
    const rotation = compassDegreesToRadians(bot?.abilityVisual?.rotation
        ?? bot?.visualOriginRotation
        ?? bot?.hitboxRotation
        ?? bot?.rotation
        ?? 0);
    const opacity = Math.min(1, remainingMs / durationMs);

    if (hitbox.shape === "rectangle") {
        const length = phaseStat(hitbox.length ?? hitbox.range, {}, 0);
        const height = Math.max(0, phaseStat(hitbox.width, {}, Number(bot?.size ?? 60)));
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

    if (hitbox.shape === "ray") {
        const length = phaseStat(hitbox.range, {}, 0);
        const width = phaseStat(hitbox.width, {}, 5);
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

    if (hitbox.shape === "circle") {
        const radius = phaseStat(hitbox.radius, {}, 0);
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

    if (hitbox.shape !== "arc") return null;
    const radius = phaseStat(hitbox.range, {}, 0);
    if (radius <= 0) return null;
    return {
        shape: "sector",
        x: origin.x,
        y: origin.y,
        radius,
        rotation,
        halfAngle: phaseStat(hitbox.arc, {}, 36) * Math.PI / 360,
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
    const scheduledAbility = summonAbilityHitboxGeometry(entity);
    if (scheduledAbility) geometries.push(scheduledAbility);
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
            entityCircleRadius(second),
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
            entityCircleRadius(first) + extra / 2,
        );
    }
    return movingCircleCollision(
        firstStart,
        firstEnd,
        entityCircleRadius(first) + Math.max(0, Number(padding) || 0),
        secondStart,
        secondEnd,
        entityCircleRadius(second),
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
    if (!contract) return null;
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

    const trigger = phase?.trigger;
    const radiusValue = phase?.hitbox?.radius
        ?? phase?.statOverrides?.radius
        ?? trigger?.radius
        ?? phase?.radius;
    const radius = resolveStatValue(radiusValue, {}, phase);
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

function summonAbilityHitboxGeometry(entity) {
    const contract = contractForEntity(entity);
    const phase = entityAbilityPhaseForEntity(entity);
    const transform = entityAbilitySpawnTransform(entity, entityAbilitySpawnForEntity(entity));
    const remainingMs = Number(entity?.shotVisualMs ?? 0);
    if (!phase || remainingMs <= 0) return null;
    const rangeValue = phase.hitbox?.range ?? phase.hitbox?.length;
    const length = resolveStatValue(rangeValue, {}, phase);
    if (length <= 0) return null;
    const durationMs = Math.max(
        1,
        Number(phase.visual?.visibleMs ?? phase.durationMs ?? 300),
        remainingMs,
    );
    return {
        shape: "ray",
        x: transform.x,
        y: transform.y,
        length,
        width: Math.max(1, Number(phase.hitbox?.width ?? 5)),
        rotation: compassDegreesToRadians(transform.rotation),
        opacity: Math.min(1, remainingMs / durationMs),
        remainingMs,
        durationMs,
        abilityId: Number(contract.abilityId),
    };
}

function activeDirectAbilityForBot(bot) {
    const visualAbility = Number(bot?.abilityVisual?.ability);
    if (Number.isSafeInteger(visualAbility)
        && hasAttachedHitbox(visualAbility)
        && Number(bot?.abilityVisual?.ms ?? 0) > 0) return visualAbility;
    return COMBAT_VISUAL_ABILITY_IDS.find((abilityId) =>
        hasAttachedHitbox(abilityId)
        && Number(bot?.abilityActiveMs?.[abilityId] ?? 0) > 0) ?? null;
}

function hasAttachedHitbox(abilityId) {
    const phase = attachedAbilityContract(abilityId)?.phases?.[0];
    return phase?.type === "botAttached" && Boolean(phase.hitbox?.shape);
}

function phaseStat(value, stats, fallback) {
    if (typeof value === "number") return value;
    return Number(stats?.[value] ?? fallback);
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

function entityCircleRadius(entity) {
    const phase = phaseForEntity(entity);
    const hitbox = phase?.hitbox;
    if (hitbox?.shape === COLLIDER_SHAPES.CIRCLE) {
        const radius = resolveStatValue(hitbox.radius, {}, phase);
        const multiplier = Number(hitbox.radiusMultiplier ?? 1);
        if (Number.isFinite(radius) && radius >= 0 && Number.isFinite(multiplier)) {
            return radius * multiplier;
        }
    }
    return entitySize(entity) / 2;
}

function entityLength(entity) {
    const phase = phaseForEntity(entity);
    const lengthValue = phase?.hitbox?.length
        ?? phase?.statOverrides?.hitboxLength
        ?? null;
    const length = resolveStatValue(lengthValue, {}, phase);
    return Number.isFinite(length) && length > 0 ? length : entitySize(entity);
}

function entityHitboxWidth(entity) {
    const phase = phaseForEntity(entity);
    const widthValue = phase?.hitbox?.width
        ?? phase?.statOverrides?.hitboxWidth
        ?? null;
    const width = resolveStatValue(widthValue, {}, phase);
    return Number.isFinite(width) && width > 0 ? width : entitySize(entity);
}

function resolveStatValue(value, stats, phase) {
    if (value == null) return NaN;
    if (typeof value === "number") return value;
    if (typeof value === "string") return Number(phase?.statOverrides?.[value] ?? stats[value]);
    return Number(value);
}
