import { BASE_BOT_STATS } from "../../loadout/BotLoadout.js";
import { absoluteMovementAngle, compassDirection, relativeMovementVector, vectorToCompassDegrees } from "../../botlogic/planner/arenaAngles.js";
import { clamp, normalizeAngle } from "../../gameconfig/geometry.js";
import { ARENA_HEIGHT_UNITS, ARENA_WIDTH_UNITS, ROTATION_STEP_DEG } from "../../modelPayloads/arenaConstants.js";
import { createAbilityEntity } from "../entities/EntityFactory.js";
import { tickBotState } from "./BotStateSystem.js";
import { effectiveMovementSpeedMultiplier, effectiveRotationSpeedMultiplier } from "../../gameconfig/HitStagger.js";
import { abilityResourceReady, abilityTimingReady, anotherAbilityActive, consumeAbilityCharges, interruptCurrentAbility, setAbilityCooldownState } from "../../gameconfig/AbilityResourceSystem.js";
import { abilityExecutionPayload } from "../../gameconfig/AbilityExecutionPayload.js";
import { statusEffectValue, statusIsActive, STATUS_EFFECT_APPLICATIONS } from "../contracts/StatusContracts.js";
import { attachedAbilitySpawnTransform } from "../../gameconfig/hitboxGeometry.js";
import { PHASE_ACTIONS, PHASE_EVENT_TYPES } from "../contracts/AbilityContracts.js";
import { DASH_ABILITY_ID, MOVEMENT_CONFIG } from "../../gameconfig/MovementConfig.js";
import { abilityStaminaReady, advanceStaminaTimers, botStamina, canCancelWindup, canFastTurn, cancelWindup, spendDash, spendStamina, withFastTurning, withSprinting } from "../../gameconfig/StaminaSystem.js";

/** Converts one selected action payload into the bot's next component state. */
export function applyBotAction(botShape, action, elapsedMs, applyDamage) {
    if ((botShape.hp ?? 0) <= 0) return tickBotState(botShape, elapsedMs, applyDamage);
    // Stamina lockouts count down (and stamina regenerates) at the start of the tick;
    // anything spent below restarts them for the next tick. Whether Dash, a cancel or a
    // sprint is allowed is judged on the state the previous tick left (`botShape`), which is
    // what the planner and conditions saw, exactly like ability cooldowns.
    const shape = advanceStaminaTimers(botShape, elapsedMs);
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
    // Fast turn doubles the rotation step on a tick that actually rotates, while the previous tick left
    // enough stamina (judged on `botShape`, like sprint). A stunned bot turns at the normal speed.
    const turn = clamp(executableAction.dRot ?? 0, -1, 1);
    const fastTurning = executableAction.fastTurn === true
        && Math.abs(turn) > 0.001
        && canFastTurn(botShape)
        && !statusIsActive(shape, "stun");
    const rotationStep = ROTATION_STEP_DEG * (fastTurning ? MOVEMENT_CONFIG.fastTurnMultiplier : 1);
    let next = { ...shape, rotation: normalizeAngle(Number(shape.rotation ?? 0) + turn * rotationStep * rotationMultiplier) };
    if (statusIsActive(shape, "stun")) {
        next = interruptCurrentAbility(next);
        return {
            ...tickBotState(next, elapsedMs, applyDamage),
            dashRemaining: 0,
            movementVelocityX: 0,
            movementVelocityY: 0,
            velocityX: 0,
            velocityY: 0,
            ...(shape.sprinting ? { sprinting: false } : {}),
            ...(shape.fastTurning ? { fastTurning: false } : {}),
        };
    }
    // A wind-up is locked once started, so Cancel Wind-up is handled before the locked
    // continuation. It only works while preparing with enough stamina; otherwise it does nothing.
    const cancelsWindup = preparationLocked
        && action?.cancelWindup === true
        && canCancelWindup(botShape);
    if (cancelsWindup) next = cancelWindup(next);
    const windupContinues = preparationLocked && !cancelsWindup;

    const selectedAbility = cancelsWindup
        ? null
        : windupContinues
            ? abilityExecutionPayload(next.preparingAbility)
            : abilityExecutionPayload(action?.abilityAction?.abilityPayload ?? action?.abilityAction);
    const abilityPayload = selectedAbility
        ? {
            ...selectedAbility,
            targetX: windupContinues ? next.preparingTargetX : action?.abilityAction?.targetX,
            targetY: windupContinues ? next.preparingTargetY : action?.abilityAction?.targetY,
            movementMode: action?.abilityAction?.movementMode,
            movementDirection: action?.abilityAction?.movementDirection,
            phaseFacingMode: action?.abilityAction?.phaseFacingMode,
        }
        : null;
    const abilityOptions = { slowedWasActive, gateShape: botShape };
    const sprinting = sprintsThisTick(shape, executableAction, magnitude, {
        busy: preparationLocked || startsAbility(next, abilityPayload, elapsedMs, cooldownMultiplier, abilityOptions),
        gateShape: botShape,
    });
    next = applyMovement(next, shape, executableAction, {
        dx, dy, magnitude, speedMultiplier, seconds, elapsedMs,
        maxMoveSpeed: sprinting ? maxMoveSpeed * MOVEMENT_CONFIG.sprintMultiplier : maxMoveSpeed,
    });
    if (sprinting) next = spendStamina(next, MOVEMENT_CONFIG.sprintDrainPerTick);
    next = withSprinting(next, sprinting);
    if (fastTurning) next = spendStamina(next, MOVEMENT_CONFIG.fastTurnDrainPerTick);
    next = withFastTurning(next, fastTurning);
    const abilityResult = executeAbility(next, abilityPayload, elapsedMs, cooldownMultiplier, abilityOptions);
    next = abilityResult.bot;
    const ticked = tickBotState(next, elapsedMs, applyDamage,
        abilityResult.triggeredPayload?.abilityId ?? null);
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
            : abilityPayload?.phaseFacingMode ?? abilityPayload?.activation?.phaseFacingDefault ?? null,
        abilityTargetX: abilityPayload?.targetX,
        abilityTargetY: abilityPayload?.targetY,
        abilitySpawn,
    };
}

/**
 * Sprint is a Walk setting: it applies on a tick that actually moves while the bot has
 * stamina and is not starting, winding up or active with any ability (attacking cancels it).
 */
function sprintsThisTick(shape, action, magnitude, { busy, gateShape }) {
    if (action?.sprint !== true || magnitude <= 0.001 || botStamina(gateShape) <= 0 || busy) return false;
    if (statusIsActive(shape, "movement-lock")) return false;
    return !Object.values(shape.abilityActiveMs ?? {}).some((activeMs) => Number(activeMs) > 0);
}

/** Dry run of this tick's ability, to know whether it starts (or begins winding up). */
function startsAbility(bot, payload, elapsedMs, cooldownMultiplier, options) {
    if (!payload) return false;
    const probe = executeAbility(bot, payload, elapsedMs, cooldownMultiplier, options);
    return probe.triggered != null
        || (probe.bot.preparingAbility === payload.abilityId && Number(probe.bot.preparingMs ?? 0) > 0);
}

function applyMovement(next, shape, action, movement) {
    const { dx, dy, magnitude, maxMoveSpeed, seconds } = movement;
    const movementStart = {
        movementStartX: Number(shape.x ?? next.x ?? 0),
        movementStartY: Number(shape.y ?? next.y ?? 0),
    };
    if (statusIsActive(shape, "stun") || statusIsActive(shape, "movement-lock")) {
        return { ...next, ...movementStart, dashRemaining: 0, movementVelocityX: 0, movementVelocityY: 0, velocityX: 0, velocityY: 0 };
    }
    if (Number(shape.abilityActiveMs?.[19] ?? 0) > 0 && Number(shape.dashRemaining ?? 0) > 0) {
        const dashX = Number(shape.dashDirectionX ?? 0), dashY = Number(shape.dashDirectionY ?? 0);
        const step = Math.min(Number(shape.dashStepDistance ?? 75), Number(shape.dashRemaining ?? 0));
        const x = clamp(shape.x + dashX * step, shape.size / 2, ARENA_WIDTH_UNITS - shape.size / 2);
        const y = clamp(shape.y + dashY * step, shape.size / 2, ARENA_HEIGHT_UNITS - shape.size / 2);
        const traveled = Math.hypot(x - shape.x, y - shape.y);
        const dashRemaining = Math.max(0, Number(shape.dashRemaining ?? 0) - traveled);
        return { ...next, ...movementStart, x, y, dashRemaining, movementVelocityX: dashX * maxMoveSpeed, movementVelocityY: dashY * maxMoveSpeed, velocityX: dashX * step / seconds, velocityY: dashY * step / seconds };
    }
    const velocity = movementVelocity(dx, dy, magnitude, maxMoveSpeed);
    return { ...next, ...movementStart, x: clamp(shape.x + velocity.dx, shape.size / 2, ARENA_WIDTH_UNITS - shape.size / 2), y: clamp(shape.y + velocity.dy, shape.size / 2, ARENA_HEIGHT_UNITS - shape.size / 2), dashRemaining: 0, movementVelocityX: velocity.dx, movementVelocityY: velocity.dy, velocityX: velocity.dx / seconds, velocityY: velocity.dy / seconds };
}

function executeAbility(bot, payload, elapsedMs, cooldownMultiplier, { slowedWasActive = false, gateShape = bot } = {}) {
    if (!payload || !hasAbility(bot, payload.abilityId)) return { bot, triggered: null, triggeredPayload: null };

    const phaseMovement = payload.contract?.phases?.[0]?.movement;
    if (statusIsActive(bot, "silence")
        || (phaseMovement?.blockedByStatus === "slow"
            && (statusIsActive(bot, "slow") || slowedWasActive))) {
        return cancelPreparation(bot, payload);
    }
    if (anotherAbilityActive(bot, payload.abilityId, payload.activation?.ignoresGlobalAbilityLock)) {
        return cancelPreparation(bot, payload);
    }
    const continuingPreparation = bot.preparingAbility === payload.abilityId
        && Number(bot.preparingMs ?? 0) > 0;
    if (!continuingPreparation
        && (!abilityTimingReady(bot, payload.abilityId, 0)
            || !abilityResourceReady(bot, payload.abilityId, 0)
            || !abilityStaminaReady(gateShape, payload.abilityId))) {
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
        abilityActiveMs: { ...(next.abilityActiveMs ?? {}), [payload.abilityId]: activeMs },
    }, payload.abilityId, configuredCooldownMs);
    const consumed = consumeAbilityCharges(activated, payload.abilityId, 1, {
        elapsedMs,
        cooldownMultiplier,
        activation: true,
    });
    if (!consumed.consumed) return { bot, triggered: null, triggeredPayload: null };
    // Dash pays stamina and starts its gap instead of a cooldown.
    const paid = payload.abilityId === DASH_ABILITY_ID ? spendDash(consumed.shape) : consumed.shape;
    return {
        bot: applyActivationState(paid, payload, elapsedMs),
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
    const phaseEffects = payload.contract?.phases?.flatMap((phase) => phase.effects ?? []) ?? [];
    if (phaseEffects.some((effect) => ["damage_reduction", "damage_immunity", "damage_reflection"].includes(effect.type)
        || (effect.type === "buff" && effect.buff === "overclock"))) return 0;
    const explicitActiveMs = payload.activation?.activeMs ?? payload.stats.activeMs;
    if (explicitActiveMs != null) return Math.max(0, Number(explicitActiveMs) || 0);
    return Math.max(300, Number(payload.stats.durationMs ?? payload.stats.visualMs ?? 0));
}

function applyActivationState(bot, payload, elapsedMs) {
    const activation = payload.activation ?? {};
    const phase = payload.contract?.phases?.[0];
    const actions = phase?.events?.[PHASE_EVENT_TYPES.ACTIVATION]?.actions ?? [];
    let next = bot;
    if (actions.includes(PHASE_ACTIONS.START_ORIENTATION)
        && phase?.orientation?.mode === "faceTarget"
        && phase.orientation.targetSource === "activationTarget"
        && Number.isFinite(Number(payload.targetX)) && Number.isFinite(Number(payload.targetY))) {
        next = { ...next, rotation: vectorToCompassDegrees(Number(payload.targetX) - next.x, Number(payload.targetY) - next.y) };
    }
    if (activation.capture) {
        // Capture the new activation from the current owner pose. Do not read
        // an older capture field that may still be present on the bot shape.
        const pose = attachedAbilitySpawnTransform(next, payload.contract?.spawn);
        next = {
            ...next,
            ...Object.fromEntries(Object.entries(activation.capture)
                .map(([field, source]) => [field,
                    source === "x" ? pose.x
                        : source === "y" ? pose.y
                            : source === "rotation" ? pose.rotation
                                : next[source] ?? null])),
        };
    }
    const phaseMovement = phase?.movement;
    if (actions.includes(PHASE_ACTIONS.START_MOVEMENT) && phaseMovement?.distance != null) {
        next = applyMovementActivation(next, payload, phaseMovement, elapsedMs);
    }
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
    const hasTarget = Number.isFinite(Number(payload.targetX)) && Number.isFinite(Number(payload.targetY));
    const targetDx = hasTarget ? Number(payload.targetX) - bot.x : 0;
    const targetDy = hasTarget ? Number(payload.targetY) - bot.y : 0;
    const targetVector = Math.hypot(targetDx, targetDy) > 0.001
        ? { x: targetDx, y: targetDy }
        : compassDirection(bot.rotation);
    const directions = { north: [0, -1], south: [0, 1], east: [1, 0], west: [-1, 0], northeast: [Math.SQRT1_2, -Math.SQRT1_2], northwest: [-Math.SQRT1_2, -Math.SQRT1_2], southeast: [Math.SQRT1_2, Math.SQRT1_2], southwest: [-Math.SQRT1_2, Math.SQRT1_2], stop: [0, 0] };
    const direction = payload.movementDirection ?? 0;
    const absoluteVector = compassDirection(absoluteMovementAngle(direction));
    const absolute = payload.movementMode === "absolute" ? (directions[direction] ?? [absoluteVector.x, absoluteVector.y]) : null;
    const relative = relativeMovementVector(targetVector.x, targetVector.y, direction);
    const [ux, uy] = absolute ?? [relative.x, relative.y];
    const distance = Number(movement.distance ?? 150);
    const stepDistance = Number(movement.speed ?? 75);
    const step = Math.min(stepDistance, distance);
    const x = clamp(bot.x + ux * step, bot.size / 2, ARENA_WIDTH_UNITS - bot.size / 2), y = clamp(bot.y + uy * step, bot.size / 2, ARENA_HEIGHT_UNITS - bot.size / 2);
    const traveled = Math.hypot(x - bot.x, y - bot.y);
    const trailMs = Number(movement.trailMs ?? 300);
    return {
        ...bot,
        // A dash starts after ordinary movement for this tick. Its swept hit
        // path must therefore begin at this pose, not at the pre-tick pose.
        movementStartX: bot.x,
        movementStartY: bot.y,
        x,
        y,
        // activeMs is ability-level timing and is intentionally invariant
        // across phases; movement-specific distance/speed/trail values live
        // on the phase above.
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

function movementVelocity(inputX, inputY, magnitude, maxSpeed) {
    return !Number.isFinite(magnitude) || magnitude <= 0.001
        ? { dx: 0, dy: 0 }
        : { dx: inputX * maxSpeed, dy: inputY * maxSpeed };
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
