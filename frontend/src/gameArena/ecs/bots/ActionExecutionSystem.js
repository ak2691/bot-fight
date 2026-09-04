import { BASE_BOT_STATS } from "../../loadout/BotLoadout.js";
import { compassDirection, relativeMovementVector, vectorToCompassDegrees } from "../../botlogic/planner/arenaAngles.js";
import { clamp, normalizeAngle } from "../../gameconfig/geometry.js";
import { ARENA_HEIGHT_UNITS, ARENA_WIDTH_UNITS, ROTATION_STEP_DEG } from "../../modelPayloads/arenaConstants.js";
import { createAbilityEntity } from "../entities/EntityFactory.js";
import { tickBotState } from "./BotStateSystem.js";
import { effectiveMovementSpeedMultiplier, effectiveRotationSpeedMultiplier } from "../../gameconfig/HitStagger.js";
import { abilityResourceReady, abilityTimingReady, anotherAbilityActive, consumeAbilityCharges, interruptCurrentAbility, setAbilityCooldownState } from "../../gameconfig/AbilityResourceSystem.js";
import { abilityExecutionPayload } from "../../gameconfig/AbilityExecutionPayload.js";
import { statusEffectValue, statusIsActive, STATUS_EFFECT_APPLICATIONS } from "../contracts/StatusContracts.js";

/** Converts one selected action payload into the bot's next component state. */
export function applyBotAction(shape, action, elapsedMs, applyDamage) {
    if ((shape.hp ?? 0) <= 0) return tickBotState(shape, elapsedMs, applyDamage);
    const seconds = Math.max(elapsedMs / 1000, 0.001);
    const cooldownMultiplier = 1 / Number(shape.attackSpeedMultiplier ?? 1);
    const slowedWasActive = statusIsActive(shape, "slow");
    const speedMultiplier = effectiveMovementSpeedMultiplier(shape);
    const maxMoveSpeed = Number(shape.moveSpeed ?? BASE_BOT_STATS.moveSpeed) * speedMultiplier;
    const rotationMultiplier = effectiveRotationSpeedMultiplier(shape);
    const preparationLocked = Boolean(shape.preparingAbility)
        && Number(shape.preparingMs ?? 0) > 0
        && !statusIsActive(shape, "silence");
    const executableAction = action;
    const magnitude = Math.hypot(executableAction.dx ?? 0, executableAction.dy ?? 0);
    const dx = magnitude > 0.001 ? executableAction.dx / magnitude : 0;
    const dy = magnitude > 0.001 ? executableAction.dy / magnitude : 0;
    let next = { ...shape, rotation: normalizeAngle(Number(shape.rotation ?? 0) + clamp(executableAction.dRot ?? 0, -1, 1) * ROTATION_STEP_DEG * rotationMultiplier) };
    if (statusIsActive(shape, "stun")) {
        next = interruptCurrentAbility(next);
        return {
            ...tickBotState(next, elapsedMs, applyDamage),
            dashActiveMs: 0,
            dashRemaining: 0,
            movementVelocityX: 0,
            movementVelocityY: 0,
            velocityX: 0,
            velocityY: 0,
        };
    }
    next = applyMovement(next, shape, executableAction, { dx, dy, magnitude, maxMoveSpeed, speedMultiplier, seconds, elapsedMs });

    const selectedAbility = preparationLocked
        ? abilityExecutionPayload(next.preparingAbility)
        : abilityExecutionPayload(action?.abilityAction?.abilityPayload ?? action?.abilityAction);
    const abilityPayload = selectedAbility
        ? {
            ...selectedAbility,
            targetX: preparationLocked ? next.preparingTargetX : action?.abilityAction?.targetX,
            targetY: preparationLocked ? next.preparingTargetY : action?.abilityAction?.targetY,
            movementMode: action?.abilityAction?.movementMode,
            movementDirection: action?.abilityAction?.movementDirection,
            phaseFacingMode: action?.abilityAction?.phaseFacingMode,
        }
        : null;
    const abilityResult = executeAbility(next, abilityPayload, elapsedMs, cooldownMultiplier, { slowedWasActive });
    next = abilityResult.bot;
    const ticked = tickBotState(next, elapsedMs, applyDamage);
    const entitySerial = Math.max(1, Math.trunc(Number(next.abilityEntitySerial) || 1));
    const abilitySpawn = spawnForAbility(next, abilityResult.triggeredPayload, entitySerial);
    return {
        ...ticked,
        abilityEntitySerial: abilitySpawn ? entitySerial + 1 : entitySerial,
        preparingAbility: next.preparingAbility ?? null,
        preparingMs: next.preparingMs ?? 0,
        triggeredAbility: abilityResult.triggered,
        triggeredPhaseFacingMode: abilityResult.triggered == null
            ? null
            : abilityPayload?.phaseFacingMode ?? abilityPayload?.execution?.phaseFacingDefault ?? null,
        abilityTargetX: abilityPayload?.targetX,
        abilityTargetY: abilityPayload?.targetY,
        abilitySpawn,
    };
}

function applyMovement(next, shape, action, movement) {
    const { dx, dy, magnitude, maxMoveSpeed, seconds, elapsedMs } = movement;
    const movementStart = {
        movementStartX: Number(shape.x ?? next.x ?? 0),
        movementStartY: Number(shape.y ?? next.y ?? 0),
    };
    if (statusIsActive(shape, "stun") || statusIsActive(shape, "movement-lock")) {
        return { ...next, ...movementStart, dashActiveMs: 0, dashRemaining: 0, movementVelocityX: 0, movementVelocityY: 0, velocityX: 0, velocityY: 0 };
    }
    if (Number(shape.dashActiveMs ?? 0) > 0 && Number(shape.dashRemaining ?? 0) > 0) {
        const dashX = Number(shape.dashDirectionX ?? 0), dashY = Number(shape.dashDirectionY ?? 0);
        const step = Math.min(Number(shape.dashStepDistance ?? 75), Number(shape.dashRemaining ?? 0));
        const x = clamp(shape.x + dashX * step, shape.size / 2, ARENA_WIDTH_UNITS - shape.size / 2);
        const y = clamp(shape.y + dashY * step, shape.size / 2, ARENA_HEIGHT_UNITS - shape.size / 2);
        const traveled = Math.hypot(x - shape.x, y - shape.y);
        const dashRemaining = Math.max(0, Number(shape.dashRemaining ?? 0) - traveled);
        return { ...next, ...movementStart, x, y, dashActiveMs: traveled > 0 && dashRemaining > 0 ? Math.max(elapsedMs, Number(shape.dashActiveMs ?? 0)) : 0, dashRemaining, movementVelocityX: dashX * maxMoveSpeed, movementVelocityY: dashY * maxMoveSpeed, velocityX: dashX * step / seconds, velocityY: dashY * step / seconds };
    }
    const velocity = nextMovementVelocity(shape, dx, dy, magnitude, maxMoveSpeed);
    return { ...next, ...movementStart, x: clamp(shape.x + velocity.dx, shape.size / 2, ARENA_WIDTH_UNITS - shape.size / 2), y: clamp(shape.y + velocity.dy, shape.size / 2, ARENA_HEIGHT_UNITS - shape.size / 2), movementVelocityX: velocity.dx, movementVelocityY: velocity.dy, velocityX: velocity.dx / seconds, velocityY: velocity.dy / seconds };
}

function executeAbility(bot, payload, elapsedMs, cooldownMultiplier, { slowedWasActive = false } = {}) {
    if (!payload || !hasAbility(bot, payload.abilityId)) return { bot, triggered: null, triggeredPayload: null };

    if (statusIsActive(bot, "silence")
        || (payload.execution?.blockedByStatus === "slow"
            && (statusIsActive(bot, "slow") || slowedWasActive))) {
        return cancelPreparation(bot, payload);
    }
    if (anotherAbilityActive(bot, payload.abilityId, payload.execution?.ignoresGlobalAbilityLock)) {
        return cancelPreparation(bot, payload);
    }
    const continuingPreparation = bot.preparingAbility === payload.abilityId
        && Number(bot.preparingMs ?? 0) > 0;
    if (!continuingPreparation
        && (!abilityTimingReady(bot, payload.abilityId, 0)
            || !abilityResourceReady(bot, payload.abilityId, 0))) {
        return cancelPreparation(bot, payload);
    }

    const windupMs = Number(payload.stats.windupMs ?? 0);
    let next = bot;
    let triggered = null;
    if (windupMs > 0) {
        const continuingPreparation = next.preparingAbility === payload.abilityId;
        // `preparingMs` is the remaining wind-up time exposed to bot logic and
        // presentation. Consume this fixed step before checking activation.
        const preparingMs = continuingPreparation
            ? Math.max(0, Number(next.preparingMs ?? 0) - elapsedMs)
            : Math.max(0, windupMs - elapsedMs);
        next = {
            ...next,
            preparingAbility: payload.abilityId,
            preparingMs,
            preparingTargetX: continuingPreparation ? next.preparingTargetX : payload.targetX,
            preparingTargetY: continuingPreparation ? next.preparingTargetY : payload.targetY,
        };
        if (preparingMs <= 0) {
            triggered = payload.actionId;
            next = clearPreparation(next);
        }
    } else {
        triggered = payload.actionId;
    }

    if (triggered == null) return { bot: next, triggered, triggeredPayload: null };

    const activeMs = activationActiveMs(payload);
    const configuredCooldownMs = Math.round(Number(payload.stats.cooldownMs ?? payload.stats.reuseCooldownMs ?? 1000)
        * cooldownMultiplier * cooldownStartMultiplier(next));
    const activated = setAbilityCooldownState({
        ...next,
        abilityActiveMs: { ...(next.abilityActiveMs ?? {}), [payload.abilityId]: activeMs + elapsedMs },
    }, payload.abilityId, configuredCooldownMs);
    const consumed = consumeAbilityCharges(activated, payload.abilityId, 1, {
        elapsedMs,
        cooldownMultiplier,
        activation: true,
    });
    if (!consumed.consumed) return { bot, triggered: null, triggeredPayload: null };
    return {
        bot: applyActivationState(consumed.shape, payload, elapsedMs),
        triggered,
        triggeredPayload: payload,
    };
}

function cancelPreparation(bot, payload) {
    return bot.preparingAbility === payload?.abilityId
        ? { bot: clearPreparation(bot), triggered: null, triggeredPayload: null }
        : { bot, triggered: null, triggeredPayload: null };
}

function activationActiveMs(payload) {
    // Defensive effects and Overclock own their duration as statuses, not as
    // post-activation action locks. Other short-lived combat visuals retain
    // their explicit active fallback.
    if (payload.contract?.effects?.some((effect) => ["damage_reduction", "damage_immunity", "damage_reflection"].includes(effect.type)
        || (effect.type === "buff" && effect.buff === "overclock"))) return 0;
    const explicitActiveMs = payload.execution?.activeMs ?? payload.stats.activeMs;
    if (explicitActiveMs != null) return Math.max(0, Number(explicitActiveMs) || 0);
    return Math.max(300, Number(payload.stats.durationMs ?? payload.stats.visualMs ?? 0));
}

function applyActivationState(bot, payload, elapsedMs) {
    const execution = payload.execution ?? {};
    let next = bot;
    if (execution.capture) {
        next = {
            ...next,
            ...Object.fromEntries(Object.entries(execution.capture)
                .map(([field, source]) => [field, next[source] ?? null])),
        };
    }
    if (execution.faceTargetFromPayload && Number.isFinite(Number(payload.targetX)) && Number.isFinite(Number(payload.targetY))) {
        next = { ...next, rotation: vectorToCompassDegrees(Number(payload.targetX) - next.x, Number(payload.targetY) - next.y) };
    }
    if (execution.movement) next = applyMovementActivation(next, payload, execution.movement, elapsedMs);
    return next;
}

function spawnForAbility(bot, payload, serial) {
    return createAbilityEntity(bot, payload?.abilityId, {
        serial,
        targetX: payload?.targetX,
        targetY: payload?.targetY,
        clamp,
        width: ARENA_WIDTH_UNITS,
        height: ARENA_HEIGHT_UNITS,
    });
}

function applyMovementActivation(bot, payload, movement, elapsedMs) {
    const stats = payload.stats;
    const hasTarget = Number.isFinite(Number(payload.targetX)) && Number.isFinite(Number(payload.targetY));
    const targetDx = hasTarget ? Number(payload.targetX) - bot.x : 0;
    const targetDy = hasTarget ? Number(payload.targetY) - bot.y : 0;
    const targetVector = Math.hypot(targetDx, targetDy) > 0.001
        ? { x: targetDx, y: targetDy }
        : compassDirection(bot.rotation);
    const directions = { north: [0, -1], south: [0, 1], east: [1, 0], west: [-1, 0], northeast: [Math.SQRT1_2, -Math.SQRT1_2], northwest: [-Math.SQRT1_2, -Math.SQRT1_2], southeast: [Math.SQRT1_2, Math.SQRT1_2], southwest: [-Math.SQRT1_2, Math.SQRT1_2], stop: [0, 0] };
    const direction = payload.movementDirection ?? 0;
    const absolute = payload.movementMode === "absolute" ? (directions[direction] ?? [0, 0]) : null;
    const relative = relativeMovementVector(targetVector.x, targetVector.y, direction);
    const [ux, uy] = absolute ?? [relative.x, relative.y];
    const distance = Number(stats[movement.distanceStat] ?? 150);
    const stepDistance = Number(stats[movement.speedStat] ?? 75);
    const step = Math.min(stepDistance, distance);
    const x = clamp(bot.x + ux * step, bot.size / 2, ARENA_WIDTH_UNITS - bot.size / 2), y = clamp(bot.y + uy * step, bot.size / 2, ARENA_HEIGHT_UNITS - bot.size / 2);
    const traveled = Math.hypot(x - bot.x, y - bot.y);
    const trailMs = Number(stats[movement.trailDurationStat] ?? 300);
    return {
        ...bot,
        // A dash starts after ordinary movement for this tick. Its swept hit
        // path must therefore begin at this pose, not at the pre-tick pose.
        movementStartX: bot.x,
        movementStartY: bot.y,
        x,
        y,
        dashActiveMs: Number(stats[movement.durationStat] ?? 200) + elapsedMs,
        dashRemaining: Math.max(0, distance - traveled),
        dashInitialDistance: distance,
        dashStepDistance: stepDistance,
        dashDirectionX: ux,
        dashDirectionY: uy,
        dashOriginX: bot.x,
        dashOriginY: bot.y,
        dashTrailMs: trailMs + elapsedMs,
        abilityVisual: { ability: payload.abilityId, ms: trailMs },
    };
}

function nextMovementVelocity(shape, inputX, inputY, magnitude, maxSpeed) {
    const current = { dx: Number(shape.movementVelocityX ?? 0), dy: Number(shape.movementVelocityY ?? 0) };
    const acceleration = Math.max(0, maxSpeed * 0.5);
    const target = !Number.isFinite(magnitude) || magnitude <= 0.001
        ? { dx: 0, dy: 0 }
        : { dx: inputX * maxSpeed, dy: inputY * maxSpeed };
    return steerVelocity(current, target, acceleration, maxSpeed);
}

function steerVelocity(current, target, maxDelta, maxSpeed) {
    // The bounded vector delta incorporates the angle between current and target
    // directions, so turns brake proportionally instead of using a fixed step.
    const delta = { dx: target.dx - current.dx, dy: target.dy - current.dy };
    const distance = Math.hypot(delta.dx, delta.dy);
    if (!Number.isFinite(distance) || distance <= maxDelta) return clampVelocity(target, maxSpeed);
    return clampVelocity({ dx: current.dx + delta.dx / distance * maxDelta, dy: current.dy + delta.dy / distance * maxDelta }, maxSpeed);
}

function clampVelocity(velocity, maxSpeed) {
    const speed = Math.hypot(velocity.dx, velocity.dy);
    return !Number.isFinite(speed) || speed <= maxSpeed ? velocity : { dx: velocity.dx / speed * maxSpeed, dy: velocity.dy / speed * maxSpeed };
}

function hasAbility(shape, ability) {
    return Array.isArray(shape?.abilities) && shape.abilities.includes(ability);
}

function clearPreparation(shape) {
    return {
        ...shape,
        preparingAbility: null,
        preparingMs: 0,
        preparingTargetX: null,
        preparingTargetY: null,
    };
}

function cooldownStartMultiplier(shape) {
    return statusIsActive(shape, "overclock")
        ? Math.min(1, Math.max(0, statusEffectValue(
            shape,
            "overclock",
            STATUS_EFFECT_APPLICATIONS.COOLDOWN_MODIFIER,
            "multiplier",
            1,
        )))
        : 1;
}
