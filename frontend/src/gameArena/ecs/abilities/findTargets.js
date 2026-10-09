import {
    movingCirclesDistance,
    movingCirclesIntersect,
    movingRectangleCollision,
    segmentIntersectsCircle,
    segmentIntersectsSector,
    segmentsWithinDistance,
} from "../../gameconfig/geometry.js";
import { movingEntityCollision } from "../../gameconfig/hitboxGeometry.js";
import { compassDegreesToRadians, compassDirection } from "../../botlogic/planner/arenaAngles.js";
import { phaseForEntity } from "../contracts/AbilityContracts.js";

export const TARGET_KIND_BOT = "bot";
export const TARGET_KIND_ENTITY = "entity";

/**
 * The one target query. Direct hits, entity collisions, traps and entity-vs-entity damage all ask it who a
 * shape touches.
 *
 * `pose` is { x, y, rotation }. `hitbox` is a resolved shape:
 *   { shape: "ray", range, width }
 *   { shape: "arc", range, arc, includeTargetRadius }
 *   { shape: "rectangle", range, width, includeTargetRadius }
 *   { shape: "circle", radius, includeTargetRadius }
 * With `options.source` (an arena entity that moves) the query is a sweep from `sweep.start` to `sweep.end`
 * (default: stationary at the pose): a "circle" hitbox sweeps a circle against bots, and any other shape,
 * and every entity target, uses the source entity's own collider.
 *
 * options:
 *   world      { bots, entities, stepMs } the candidates
 *   kinds      which candidates to test: "bot" and/or "entity"
 *   sweep      { start, end } of a moving source
 *   source     the entity doing the sweeping
 *   skipOwner  leave out the bot that owns `source`
 *   isTarget   (target, kind) => boolean, for hostility and vulnerability
 *
 * Returns [{ target, distance }] nearest first.
 */
export function findTargets(pose, hitbox, {
    world = {},
    kinds = [TARGET_KIND_BOT],
    sweep = null,
    source = null,
    skipOwner = false,
    isTarget = null,
    stepMs = world.stepMs ?? 100,
} = {}) {
    const start = sweep?.start ?? { x: Number(pose.x), y: Number(pose.y) };
    const end = sweep?.end ?? start;
    const found = [];
    const test = (target, kind) => {
        if (isTarget && !isTarget(target, kind)) return;
        const path = kind === TARGET_KIND_BOT ? botMovementSegment(target, stepMs) : entityMovementSegment(target);
        const distance = source
            ? sweepDistance(source, hitbox, start, end, target, kind, path)
            : shapeDistance(pose, hitbox, target, path);
        if (distance != null) found.push({ target, distance });
    };
    if (kinds.includes(TARGET_KIND_BOT)) {
        for (const bot of world.bots ?? []) {
            if (skipOwner && Number(bot.slot) === Number(source?.ownerSlot)) continue;
            test(bot, TARGET_KIND_BOT);
        }
    }
    if (kinds.includes(TARGET_KIND_ENTITY)) {
        for (const entity of world.entities ?? []) {
            if (entity?.id === source?.id) continue;
            test(entity, TARGET_KIND_ENTITY);
        }
    }
    return found.sort((first, second) => first.distance - second.distance);
}

/** True when the shape touches `target`. */
export function hitsTarget(pose, hitbox, target, options = {}) {
    const kind = options.kinds?.[0] ?? TARGET_KIND_BOT;
    return findTargets(pose, hitbox, {
        ...options,
        world: kind === TARGET_KIND_BOT ? { bots: [target] } : { entities: [target] },
        kinds: [kind],
    }).length > 0;
}

/** A moving entity against a target: a swept circle against bots, the entity's collider otherwise. */
function sweepDistance(source, hitbox, start, end, target, kind, path) {
    if (kind === TARGET_KIND_BOT && hitbox.shape === "circle") {
        return movingCirclesIntersect(start, end, hitbox.radius, path.start, path.end, Number(target.size ?? 60) / 2)
            ? movingCirclesDistance(start, end, path.start, path.end)
            : null;
    }
    const collision = movingEntityCollision(source, start, end, target, path.start, path.end);
    return collision?.hit
        ? collision.distance ?? movingCirclesDistance(start, end, path.start, path.end)
        : null;
}

/** A bot's trigger hitbox against a target; the distance is centre to centre. */
function shapeDistance(pose, hitbox, target, path) {
    return shapeHits(pose, hitbox, target, path)
        ? Math.hypot(Number(target.x) - Number(pose.x), Number(target.y) - Number(pose.y))
        : null;
}

function shapeHits(pose, hitbox, target, path) {
    const targetRadius = targetHitRadius(target);
    if (hitbox.shape === "ray") {
        const direction = compassDirection(pose.rotation);
        const width = Number(hitbox.width);
        return segmentsWithinDistance(
            { x: pose.x, y: pose.y },
            { x: pose.x + direction.x * hitbox.range, y: pose.y + direction.y * hitbox.range },
            path.start,
            path.end,
            targetRadius + (Number.isFinite(width) && width > 0 ? width : 5) / 2,
        );
    }
    const padding = hitbox.includeTargetRadius ? targetRadius : 0;
    if (hitbox.shape === "circle") {
        return segmentIntersectsCircle(path.start, path.end, { x: pose.x, y: pose.y, size: ((hitbox.radius ?? hitbox.range) + padding) * 2 });
    }
    if (hitbox.shape === "rectangle") {
        const direction = compassDirection(pose.rotation);
        const center = {
            x: pose.x + direction.x * hitbox.range / 2,
            y: pose.y + direction.y * hitbox.range / 2,
        };
        return movingRectangleCollision(
            center,
            center,
            hitbox.range,
            hitbox.width,
            compassDegreesToRadians(pose.rotation),
            path.start,
            path.end,
            padding,
        ).hit;
    }
    if (hitbox.shape === "arc") {
        return segmentIntersectsSector(
            { x: pose.x, y: pose.y },
            path.start,
            path.end,
            pose.rotation,
            hitbox.range,
            hitbox.arc / 2,
            padding,
        );
    }
    return false;
}

/** The start and end of a bot's movement this tick (velocity is in units per second). */
export function botMovementSegment(bot, stepMs) {
    const seconds = Math.max(Number(stepMs ?? 0) / 1000, 0);
    const startX = bot.movementStartX != null && Number.isFinite(Number(bot.movementStartX))
        ? Number(bot.movementStartX)
        : Number(bot.x) - Number(bot.velocityX ?? 0) * seconds;
    const startY = bot.movementStartY != null && Number.isFinite(Number(bot.movementStartY))
        ? Number(bot.movementStartY)
        : Number(bot.y) - Number(bot.velocityY ?? 0) * seconds;
    return {
        start: { x: startX, y: startY },
        end: { x: Number(bot.x), y: Number(bot.y) },
    };
}

/** The start and end of an entity's movement this tick (velocity is in units per tick). */
export function entityMovementSegment(entity) {
    const startX = Number.isFinite(Number(entity.movementStartX))
        ? Number(entity.movementStartX)
        : Number(entity.x) - entity.velocityX;
    const startY = Number.isFinite(Number(entity.movementStartY))
        ? Number(entity.movementStartY)
        : Number(entity.y) - entity.velocityY;
    return {
        start: { x: startX, y: startY },
        end: { x: Number(entity.x), y: Number(entity.y) },
    };
}

/** An entity's hit radius is its circle hitbox when it declares one, else half its size. */
export function targetHitRadius(target) {
    const hitbox = phaseForEntity(target)?.hitbox;
    if (hitbox?.shape === "circle") {
        const radius = Number(hitbox.radius);
        const multiplier = Number(hitbox.radiusMultiplier ?? 1);
        if (Number.isFinite(radius) && radius >= 0 && Number.isFinite(multiplier)) {
            return radius * multiplier;
        }
    }
    return Number(target.size ?? 0) / 2;
}
