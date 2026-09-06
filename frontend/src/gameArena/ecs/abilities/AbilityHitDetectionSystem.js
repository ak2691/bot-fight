import { ACTION_TO_ABILITY } from "../../loadout/BotLoadout.js";
import { abilityExecutionPayload } from "../../gameconfig/AbilityExecutionPayload.js";
import {
    attachedAbilityContract,
    attachedAbilityTargetsOwner,
    phaseForAttachedAbility,
} from "../../gameconfig/AttachedAbilityContracts.js";
import { movingRectangleCollision, segmentIntersectsCircle, segmentIntersectsSector, segmentsWithinDistance } from "../../gameconfig/geometry.js";
import { compassDegreesToRadians, compassDirection } from "../../botlogic/planner/arenaAngles.js";

/** Resolves attached-phase geometry without applying the resulting effects. */
export function abilityHitsTarget(
    attacker,
    target,
    payloadOrAbilityId = ACTION_TO_ABILITY[attacker?.triggeredAbility],
) {
    const payload = resolvePayload(payloadOrAbilityId);
    if (!attacker || !target || !payload || ACTION_TO_ABILITY[attacker.triggeredAbility] !== payload.abilityId) {
        return false;
    }

    const phase = phaseForAttachedAbility(payload.abilityId);
    if (!phase) return false;
    const shape = phase?.hitbox?.shape;
    if (attachedAbilityTargetsOwner(payload.abilityId)) return true;
    if (shape === "ray") return rayHits(attacker, target, payload, phase);
    return abilityRangeHits(attacker, target, payload, undefined, phase);
}

export function rayHits(source, target, payloadOrAbilityId, phase = undefined) {
    const payload = resolvePayload(payloadOrAbilityId);
    if (!source || !target || !payload) return false;
    const activePhase = phase ?? phaseForAttachedAbility(payload.abilityId);
    const hitbox = activePhase?.hitbox ?? {};
    const direction = compassDirection(Number(source.rotation ?? 0));
    const targetRadius = Number(target.size ?? 0) / 2;
    const rayWidth = resolveHitboxNumber(hitbox.width, payload, 5);
    const rayRange = resolveHitboxNumber(hitbox.range, payload, Number(payload.stats.range ?? 0));
    const effectiveDistance = targetRadius + (Number.isFinite(rayWidth) && rayWidth > 0 ? rayWidth : 5) / 2;
    const rayStart = {
        x: Number(source.x),
        y: Number(source.y),
    };
    const rayEnd = {
        x: Number(source.x) + direction.x * rayRange,
        y: Number(source.y) + direction.y * rayRange,
    };
    const targetPath = targetMovementSegment(target);
    return segmentsWithinDistance(rayStart, rayEnd, targetPath.start, targetPath.end, effectiveDistance);
}

export function abilityRangeHits(
    source,
    target,
    payloadOrAbilityId,
    range = undefined,
    phase = undefined,
) {
    const payload = resolvePayload(payloadOrAbilityId);
    if (!source || !target || !payload) return false;

    const activePhase = phase ?? phaseForAttachedAbility(payload.abilityId);
    const hitbox = activePhase?.hitbox ?? {};
    if (!["arc", "rectangle", "circle"].includes(hitbox.shape)) return false;
    const effectiveRange = Number(range ?? resolveHitboxNumber(
        hitbox.shape === "circle" ? hitbox.radius : hitbox.length ?? hitbox.range,
        payload,
        payload.stats.range ?? payload.stats.radius ?? 0,
    ));
    const targetRadius = hitbox.includeTargetRadius ? Number(target.size ?? 60) / 2 : 0;
    const targetPath = targetMovementSegment(target);
    if (hitbox.shape === "circle") {
        return segmentIntersectsCircle(
            targetPath.start,
            targetPath.end,
            { x: Number(source.x), y: Number(source.y), size: (effectiveRange + targetRadius) * 2 },
        );
    }
    if (hitbox.shape === "rectangle") {
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
            resolveHitboxNumber(hitbox.width, payload, Number(payload.stats.hitboxWidth ?? source.size ?? 60)),
            compassDegreesToRadians(pose.rotation),
            targetPath.start,
            targetPath.end,
            targetRadius,
        ).hit;
    }
    return segmentIntersectsSector(
        { x: Number(source.x), y: Number(source.y) },
        targetPath.start,
        targetPath.end,
        Number(source.rotation ?? 0),
        effectiveRange,
        resolveHitboxNumber(hitbox.arc, payload, Number(payload.stats.arc ?? 36)) / 2,
        targetRadius,
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

export function isAttachedAbilityPayload(payloadOrAbilityId) {
    const abilityId = typeof payloadOrAbilityId === "object"
        ? payloadOrAbilityId?.abilityId
        : payloadOrAbilityId;
    return attachedAbilityContract(abilityId) != null;
}

function resolvePayload(payloadOrAbilityId) {
    return abilityExecutionPayload(payloadOrAbilityId);
}

function resolveHitboxNumber(value, payload, fallback = 0) {
    if (typeof value === "number") return value;
    if (typeof value === "string") return Number(payload.stats[value] ?? fallback);
    if (value && typeof value === "object") {
        if (value.stat != null) return Number(payload.stats[value.stat] ?? value.fallback ?? fallback);
        if (value.value != null) return Number(value.value);
    }
    return Number(fallback);
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
