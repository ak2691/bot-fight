import { ACTION_TO_ABILITY } from "../../loadout/BotLoadout.js";
import { abilityExecutionPayload } from "../../gameconfig/AbilityExecutionPayload.js";
import { DELIVERY_TYPES, HITBOX_GEOMETRIES } from "../../gameconfig/AbilityContracts.js";
import { angleDelta, clamp, movingRectangleCollision, segmentIntersectsCircle, segmentsWithinDistance } from "../../gameconfig/geometry.js";
import { compassDegreesToRadians, compassDirection, vectorToCompassDegrees } from "../../botlogic/planner/arenaAngles.js";

const DIRECT_DELIVERIES = new Set([
    DELIVERY_TYPES.SELF,
    DELIVERY_TYPES.MELEE,
    DELIVERY_TYPES.RAY,
    DELIVERY_TYPES.RADIAL,
]);

/** Resolves declarative delivery geometry without applying the resulting effects. */
export function abilityHitsTarget(
    attacker,
    target,
    payloadOrAbilityId = ACTION_TO_ABILITY[attacker?.triggeredAbility],
) {
    const payload = resolvePayload(payloadOrAbilityId);
    if (!attacker || !target || !payload || ACTION_TO_ABILITY[attacker.triggeredAbility] !== payload.abilityId) {
        return false;
    }

    const delivery = payload.contract.delivery;
    if (delivery.type === DELIVERY_TYPES.SELF) return true;
    if (delivery.type === DELIVERY_TYPES.RAY) return rayHits(attacker, target, payload);
    return abilityRangeHits(attacker, target, payload);
}

export function rayHits(source, target, payloadOrAbilityId) {
    const payload = resolvePayload(payloadOrAbilityId);
    if (!source || !target || !payload || payload.contract.delivery.type !== DELIVERY_TYPES.RAY) return false;
    const direction = compassDirection(Number(source.rotation ?? 0));
    const targetRadius = Number(target.size ?? 0) / 2;
    const rayStart = {
        x: Number(source.x),
        y: Number(source.y),
    };
    const rayEnd = {
        x: Number(source.x) + direction.x * Number(payload.stats.range ?? 0),
        y: Number(source.y) + direction.y * Number(payload.stats.range ?? 0),
    };
    const targetPath = targetMovementSegment(target);
    return segmentsWithinDistance(rayStart, rayEnd, targetPath.start, targetPath.end, targetRadius);
}

export function abilityRangeHits(
    source,
    target,
    payloadOrAbilityId,
    range = undefined,
) {
    const payload = resolvePayload(payloadOrAbilityId);
    if (!source || !target || !payload) return false;

    const delivery = payload.contract.delivery;
    if (delivery.type !== DELIVERY_TYPES.MELEE && delivery.type !== DELIVERY_TYPES.RADIAL) return false;

    const effectiveRange = Number(range ?? payload.stats.range ?? payload.stats.radius ?? 0);
    const targetRadius = delivery.includeTargetRadius ? Number(target.size ?? 60) / 2 : 0;
    const targetPath = targetMovementSegment(target);
    if (delivery.type === DELIVERY_TYPES.RADIAL) {
        return segmentIntersectsCircle(
            targetPath.start,
            targetPath.end,
            { x: Number(source.x), y: Number(source.y), size: (effectiveRange + targetRadius) * 2 },
        );
    }
    if (delivery.geometry === HITBOX_GEOMETRIES.RECTANGLE) {
        const pose = capturedHitboxPose(source);
        const direction = compassDirection(pose.rotation);
        const center = {
            x: pose.x + direction.x * effectiveRange / 2,
            y: pose.y + direction.y * effectiveRange / 2,
        };
        return movingRectangleCollision(
            center,
            center,
            effectiveRange,
            Number(payload.stats.hitboxWidth ?? source.size ?? 60),
            compassDegreesToRadians(pose.rotation),
            targetPath.start,
            targetPath.end,
            targetRadius,
        ).hit;
    }
    return segmentIntersectsArc(
        { x: Number(source.x), y: Number(source.y) },
        targetPath.start,
        targetPath.end,
        Number(source.rotation ?? 0),
        effectiveRange + targetRadius,
        Number(payload.stats.arcDegrees ?? 36) / 2,
    );
}

function capturedHitboxPose(source) {
    return {
        x: finiteNumber(source.hitboxOriginX, source.x),
        y: finiteNumber(source.hitboxOriginY, source.y),
        rotation: finiteNumber(source.hitboxRotation, source.rotation),
    };
}

function finiteNumber(...values) {
    for (const value of values) {
        const number = Number(value);
        if (Number.isFinite(number)) return number;
    }
    return 0;
}

export function isDirectDelivery(delivery) {
    return DIRECT_DELIVERIES.has(delivery);
}

function resolvePayload(payloadOrAbilityId) {
    return abilityExecutionPayload(payloadOrAbilityId);
}

function targetMovementSegment(target) {
    const seconds = 0.1;
    const startX = Number.isFinite(Number(target.movementStartX))
        ? Number(target.movementStartX)
        : Number(target.x) - Number(target.velocityX ?? 0) * seconds;
    const startY = Number.isFinite(Number(target.movementStartY))
        ? Number(target.movementStartY)
        : Number(target.y) - Number(target.velocityY ?? 0) * seconds;
    return {
        start: { x: startX, y: startY },
        end: { x: Number(target.x), y: Number(target.y) },
    };
}

function segmentIntersectsArc(source, start, end, rotation, range, halfArc) {
    const candidates = [0, 1];
    const dx = end.x - start.x;
    const dy = end.y - start.y;
    const lengthSquared = dx * dx + dy * dy;
    if (lengthSquared > 0) candidates.push(clamp(
        ((source.x - start.x) * dx + (source.y - start.y) * dy) / lengthSquared,
        0,
        1,
    ));
    for (const boundary of [rotation - halfArc, rotation + halfArc]) {
        const edge = compassDirection(boundary);
        const denominator = dx * edge.y - dy * edge.x;
        if (Math.abs(denominator) <= 1e-9) continue;
        const sourceToStartX = source.x - start.x;
        const sourceToStartY = source.y - start.y;
        const t = (sourceToStartX * edge.y - sourceToStartY * edge.x) / denominator;
        const rayDistance = (sourceToStartX * dy - sourceToStartY * dx) / denominator;
        if (t >= 0 && t <= 1 && rayDistance >= 0 && rayDistance <= range) candidates.push(t);
    }
    return candidates.some((t) => {
        const x = start.x + dx * t;
        const y = start.y + dy * t;
        const distance = Math.hypot(x - source.x, y - source.y);
        if (distance > range) return false;
        if (distance <= 0.001) return true;
        return Math.abs(angleDelta(rotation, vectorToCompassDegrees(x - source.x, y - source.y))) <= halfArc;
    });
}
