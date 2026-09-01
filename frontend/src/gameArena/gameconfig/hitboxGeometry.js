import { ABILITY_STATS } from "./Abilities.js";
import { abilityContract, DELIVERY_TYPES, HITBOX_GEOMETRIES } from "./AbilityContracts.js";
import { movingCircleCollision, movingRectangleCollision } from "./geometry.js";
import { compassDegreesToRadians } from "../botlogic/planner/arenaAngles.js";
import { entityContract } from "../ecs/contracts/EntityContracts.js";
import { COMBAT_VISUAL_ABILITY_IDS, combatVisualDurationMs, combatVisualRemainingMs } from "./visualState.js";

export const COLLIDER_SHAPES = Object.freeze({
    CIRCLE: "circle",
    RECTANGLE: "rectangle",
});

/** Resolves the declarative collider metadata for an arena entity. */
export function colliderShapeForEntity(entity) {
    const contract = contractForEntity(entity);
    return contract?.collider?.shape ?? COLLIDER_SHAPES.CIRCLE;
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
        return length > 0 ? {
            shape: "ray",
            x: origin.x,
            y: origin.y,
            length,
            width: Math.max(4, Math.min(14, Number(bot?.size ?? 60) * 0.12)),
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
        halfAngle: Number(stats.arcDegrees ?? 36) * Math.PI / 360,
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
 * rectangles; all other colliders retain their existing circular behavior.
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
    const firstShape = colliderShapeForEntity(first);
    const secondShape = colliderShapeForEntity(second);
    if (firstShape === COLLIDER_SHAPES.RECTANGLE) {
        const extra = Math.max(0, Number(padding) || 0) * 2;
        return movingRectangleCollision(
            firstStart,
            firstEnd,
            firstSize + extra,
            firstSize + extra,
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
            secondSize,
            secondSize,
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

/**
 * Returns the debug geometry for an entity-backed gameplay hitbox. Derived
 * visual explosion entities are included for the duration of their impact
 * animation, but this function is never called by gameplay collision code.
 */
export function hitboxGeometryForEntity(entity) {
    const contract = contractForEntity(entity);
    if (!contract?.collider) return null;
    const derived = derivedForEntity(entity, contract);
    const behavior = behaviorForEntity(entity, contract);
    if (behavior?.kind === "lifetime") return null;
    if (contract.category === "trap" && behavior?.kind === "phase" && !entity.armed) return null;
    if (!derived && colliderShapeForEntity(entity) === COLLIDER_SHAPES.RECTANGLE) {
        const size = entitySize(entity);
        return {
            shape: COLLIDER_SHAPES.RECTANGLE,
            width: size,
            height: size,
            rotation: entityMotionAngle(entity),
        };
    }

    const stats = ABILITY_STATS[Number(contract.abilityId)] ?? {};
    // A visual explosion uses its parent behavior to recover the radius that
    // applied damage. Most effects also encode that radius in their size, but
    // keeping the parent lookup makes interval effects future-proof.
    const effectBehavior = derived ? contract.behavior ?? null : behavior;
    const phase = activePhase(effectBehavior, entity);
    const trigger = phase?.trigger ?? effectBehavior?.trigger;
    const radiusStat = phase?.radiusStat ?? effectBehavior?.radiusStat ?? trigger?.radiusStat;
    const radius = phase?.statOverrides?.[radiusStat]
        ?? (radiusStat ? Number(stats[radiusStat]) : NaN);
    return {
        shape: COLLIDER_SHAPES.CIRCLE,
        radius: Number.isFinite(radius) && radius > 0 ? radius : entitySize(entity) / 2,
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
    const behavior = contract?.behavior;
    const attack = behavior?.kind === "summon" ? behavior.attack : null;
    const remainingMs = Number(entity?.[attack?.visualField] ?? 0);
    if (!attack || remainingMs <= 0) return null;
    const stats = ABILITY_STATS[Number(contract.abilityId)] ?? {};
    const length = Number(stats[attack.rangeStat] ?? 0);
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

function behaviorForEntity(entity, contract) {
    return derivedForEntity(entity, contract) ?? contract?.behavior ?? null;
}

function derivedForEntity(entity, contract) {
    if (entity?.entityBehaviorKey && contract?.derived?.[entity.entityBehaviorKey]) {
        return contract.derived[entity.entityBehaviorKey];
    }
    return Object.values(contract?.derived ?? {}).find((value) => value.type === entity?.type) ?? null;
}

function activePhase(behavior, entity) {
    const phases = behavior?.phases;
    if (!Array.isArray(phases) || phases.length === 0) return null;
    if (entity?.phaseId) return phases.find((phase) => phase.id === entity.phaseId) ?? null;
    const elapsed = Math.max(0, Number(entity?.ageMs ?? 0));
    return phases.reduce((current, phase) => phase.startMs <= elapsed
        && (!current || phase.startMs > current.startMs) ? phase : current, null);
}

function entitySize(entity) {
    return Math.max(0, Number(entity?.size ?? 0));
}
