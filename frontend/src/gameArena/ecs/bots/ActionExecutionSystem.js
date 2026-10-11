import { BASE_BOT_STATS } from "../../loadout/BotLoadout.js";
import { clamp, normalizeAngle } from "../../gameconfig/geometry.js";
import { ARENA_HEIGHT_UNITS, ARENA_WIDTH_UNITS, ROTATION_STEP_DEG } from "../../modelPayloads/arenaConstants.js";
import { tickBotState } from "./BotStateSystem.js";
import { effectiveMovementSpeedMultiplier, effectiveRotationSpeedMultiplier } from "../../gameconfig/HitStagger.js";
import { abilityResourceReady, abilityTimingReady, anotherAbilityActive, consumeAbilityCharges, cooldownStartMultiplier, setAbilityCooldownState, startAbilityActive } from "../../gameconfig/AbilityResourceSystem.js";
import { ABILITY_STAGES, abilityRecord, channelActive, clearWindup, isWindingUp, patchAbilityRecord, preparingAbilityId, preparingRemainingMs, readyAbilityRecord } from "../../gameconfig/AbilityState.js";
import { DASH_CHANNEL, abilityChannel, abilityStaminaCost, channelBlockingStatuses } from "../../gameconfig/AbilityChannels.js";
import { abilityExecutionPayload } from "../../gameconfig/AbilityExecutionPayload.js";
import { statusIsActive } from "../contracts/StatusContracts.js";
import { interrupt } from "../abilities/effects.js";
import { EFFECT_TYPES, triggerEffects } from "../contracts/AbilityContracts.js";
import { applyActivationVerbs, dueTimelineSteps, spawnDueEntities, spawnTriggerEntities, stampTimelineSerial, startTimeline } from "../abilities/verbs.js";
import { MOVEMENT_CONFIG } from "../../gameconfig/MovementConfig.js";
import { advanceStaminaTimers, botStamina, canCancelWindup, cancelWindup, spendAbilityStamina, spendStamina, withFastTurning, withSprinting } from "../../gameconfig/StaminaSystem.js";

/**
 * Converts one selected action payload into the bot's next state, changing the bot in place. Returns the bot.
 * The gates (Dash, cancel, sprint, fast turn, an ability's stamina cost) are judged on what the previous tick
 * left, which is what the planner and conditions saw, exactly like ability cooldowns, so they are read before
 * this tick changes anything.
 */
export function applyBotAction(bot, action, elapsedMs) {
    if ((bot.hp ?? 0) <= 0) return tickBotState(bot, elapsedMs);
    const staminaBefore = botStamina(bot);
    const canCancel = canCancelWindup(bot);
    const wasSprinting = Boolean(bot.sprinting);
    const wasFastTurning = Boolean(bot.fastTurning);
    // Stamina lockouts count down (and stamina regenerates) at the start of the tick;
    // anything spent below restarts them for the next tick.
    advanceStaminaTimers(bot, elapsedMs);
    const seconds = Math.max(elapsedMs / 1000, 0.001);
    const cooldownMultiplier = 1 / Number(bot.attackSpeedMultiplier ?? 1);
    const slowedWasActive = statusIsActive(bot, "slow");
    const stunned = statusIsActive(bot, "stun");
    const movementLocked = statusIsActive(bot, "movement-lock");
    const speedMultiplier = effectiveMovementSpeedMultiplier(bot);
    const maxMoveSpeed = Number(bot.moveSpeed ?? BASE_BOT_STATS.moveSpeed) * speedMultiplier;
    const rotationMultiplier = effectiveRotationSpeedMultiplier(bot);
    const preparationLocked = isWindingUp(bot) && !statusIsActive(bot, "silence");
    const magnitude = Math.hypot(action.dx ?? 0, action.dy ?? 0);
    const dx = magnitude > 0.001 ? action.dx / magnitude : 0;
    const dy = magnitude > 0.001 ? action.dy / magnitude : 0;
    // Fast turn doubles the rotation step on a tick that actually rotates, while the previous tick left
    // enough stamina (judged like sprint). A stunned bot turns at the normal speed.
    const turn = clamp(action.dRot ?? 0, -1, 1);
    const fastTurning = action.fastTurn === true
        && Math.abs(turn) > 0.001
        && staminaBefore >= MOVEMENT_CONFIG.fastTurnDrainPerTick
        && !stunned;
    const rotationStep = ROTATION_STEP_DEG * (fastTurning ? MOVEMENT_CONFIG.fastTurnMultiplier : 1);
    bot.rotation = normalizeAngle(bot.rotation + turn * rotationStep * rotationMultiplier);
    if (stunned) {
        interrupt(bot);
        tickBotState(bot, elapsedMs);
        bot.dashRemaining = 0;
        bot.movementVelocityX = 0;
        bot.movementVelocityY = 0;
        bot.velocityX = 0;
        bot.velocityY = 0;
        if (wasSprinting) bot.sprinting = false;
        if (wasFastTurning) bot.fastTurning = false;
        return bot;
    }
    // A wind-up is locked once started, so Cancel Wind-up is handled before the locked
    // continuation. It only works while preparing with enough stamina; otherwise it does nothing.
    const cancelsWindup = preparationLocked && action.cancelWindup === true && canCancel;
    if (cancelsWindup) cancelWindup(bot);
    const windupContinues = preparationLocked && !cancelsWindup;

    // Channels are independent: a dash starts alongside whatever ability the tick selects, and a wind-up in
    // progress does not stop it. A dash-channel ability chosen through the ability slot (older callers) is
    // the same thing.
    const plannedAbility = action.abilityAction ?? null;
    const dashThroughAbility = isDashAction(plannedAbility);
    const abilitySource = dashThroughAbility ? null : plannedAbility;
    const dashSource = action.dashAction ?? (dashThroughAbility ? plannedAbility : null);
    const selectedAbility = cancelsWindup
        ? null
        : windupContinues
            ? abilityExecutionPayload(preparingAbilityId(bot))
            : abilityExecutionPayload(abilitySource?.abilityPayload ?? abilitySource);
    const preparingTarget = abilityRecord(bot, preparingAbilityId(bot))?.target;
    const abilityPayload = selectedAbility
        ? {
            ...selectedAbility,
            targetX: windupContinues ? preparingTarget?.x : abilitySource?.targetX,
            targetY: windupContinues ? preparingTarget?.y : abilitySource?.targetY,
            movementMode: abilitySource?.movementMode,
            movementDirection: abilitySource?.movementDirection,
            phaseFacingMode: abilitySource?.phaseFacingMode,
        }
        : null;
    const selectedDash = abilityExecutionPayload(dashSource?.abilityPayload ?? dashSource);
    const dashPayload = selectedDash
        ? {
            ...selectedDash,
            targetX: dashSource?.targetX,
            targetY: dashSource?.targetY,
            movementMode: dashSource?.movementMode,
            movementDirection: dashSource?.movementDirection,
            phaseFacingMode: dashSource?.phaseFacingMode,
        }
        : null;
    const abilityOptions = { slowedWasActive, staminaBefore };
    const sprinting = action.sprint === true && magnitude > 0.001 && staminaBefore > 0 && !movementLocked;
    applyMovement(bot, movementLocked, {
        dx, dy, magnitude, seconds,
        maxMoveSpeed: sprinting ? maxMoveSpeed * MOVEMENT_CONFIG.sprintMultiplier : maxMoveSpeed,
    });
    if (sprinting) spendStamina(bot, MOVEMENT_CONFIG.sprintDrainPerTick);
    withSprinting(bot, sprinting);
    if (fastTurning) spendStamina(bot, MOVEMENT_CONFIG.fastTurnDrainPerTick);
    withFastTurning(bot, fastTurning);
    // The ability starts first, then the dash, so a dash that moves the bot never changes where the same
    // tick's ability was captured; the hit and spawn are resolved after both, from the final pose.
    const abilityResult = executeAbility(bot, abilityPayload, elapsedMs, cooldownMultiplier, abilityOptions);
    const dashResult = executeAbility(bot, dashPayload, elapsedMs, cooldownMultiplier, abilityOptions);
    const triggered = abilityResult.triggered ?? dashResult.triggered;
    const entitySerial = Math.max(1, Math.trunc(Number(bot.abilityEntitySerial) || 1));
    // Each activation gets a serial so a hit refund is paid once per activation; a spawned entity remembers
    // the activation that made it.
    const activationSerial = (Math.trunc(Number(bot.activationSerial)) || 0)
        + (abilityResult.triggered != null ? 1 : 0) + (dashResult.triggered != null ? 1 : 0);
    // The spawn verbs of the ability that triggered create their entities from the final pose, in order.
    const abilitySpawn = spawnTriggerEntities(bot, abilityResult.triggeredPayload, {
        serial: entitySerial,
        targetX: abilityResult.triggeredPayload?.targetX,
        targetY: abilityResult.triggeredPayload?.targetY,
        activationSerial,
        clampFn: clamp,
    });
    // Every ability that activated this step keeps its stages for the step, so a dash started beside an
    // ability gets the same active/cooldown timing as a dash started alone.
    const justActivatedIds = [abilityResult.triggeredPayload?.abilityId, dashResult.triggeredPayload?.abilityId];
    // The timeline steps that come due on this tick (derived from the active time left, before the stage
    // advances): their spawn verbs create entities now, from the pose they name; their hit and applyEffects
    // verbs resolve with the trigger verbs.
    for (const abilityId of justActivatedIds) if (abilityId != null) stampTimelineSerial(bot, abilityId, activationSerial);
    const dueSteps = dueTimelineSteps(bot, elapsedMs, justActivatedIds);
    const delayedSpawn = spawnDueEntities(bot, dueSteps, { serial: entitySerial + abilitySpawn.length, clampFn: clamp });
    tickBotState(bot, elapsedMs, justActivatedIds);
    const phaseFacing = triggeredPayloadOptions(abilityResult, abilityPayload, dashPayload);
    bot.activationSerial = activationSerial;
    const spawned = [...abilitySpawn, ...delayedSpawn.map(({ entity }) => entity)];
    bot.entityActivations = spawned.length > 0
        ? {
            ...(bot.entityActivations ?? {}),
            ...Object.fromEntries(abilitySpawn.map((entity) => [entity.id, activationSerial])),
            ...Object.fromEntries(delayedSpawn.map(({ entity, serial }) => [entity.id, serial])),
        }
        : bot.entityActivations ?? {};
    bot.abilityEntitySerial = entitySerial + spawned.length;
    bot.dueSteps = dueSteps;
    bot.triggeredAbility = triggered;
    bot.triggeredPhaseFacingMode = triggered == null
        ? null
        : phaseFacing?.phaseFacingMode ?? phaseFacing?.activation?.phaseFacingDefault ?? null;
    bot.abilityTargetX = (abilityPayload ?? dashPayload)?.targetX;
    bot.abilityTargetY = (abilityPayload ?? dashPayload)?.targetY;
    bot.abilitySpawn = spawned;
    return bot;
}

/** True when an action payload (or a raw ability id) belongs to an ability of the dash channel. */
function isDashAction(source) {
    if (!source) return false;
    return abilityChannel(abilityExecutionPayload(source.abilityPayload ?? source)?.abilityId) === DASH_CHANNEL;
}

/** The payload that owns this tick's trigger: the ability's when it started, otherwise the dash's. */
function triggeredPayloadOptions(abilityResult, abilityPayload, dashPayload) {
    return abilityResult.triggered != null ? abilityPayload : dashPayload;
}

/** Moves the bot for the tick: held in place by a movement lock, along a dash, or by the action's heading. */
function applyMovement(bot, locked, movement) {
    const { dx, dy, magnitude, maxMoveSpeed, seconds } = movement;
    const startX = bot.x;
    const startY = bot.y;
    bot.movementStartX = startX;
    bot.movementStartY = startY;
    if (locked) {
        bot.dashRemaining = 0;
        bot.movementVelocityX = 0;
        bot.movementVelocityY = 0;
        bot.velocityX = 0;
        bot.velocityY = 0;
        return;
    }
    if (channelActive(bot, DASH_CHANNEL) && Number(bot.dashRemaining ?? 0) > 0) {
        const dashX = Number(bot.dashDirectionX ?? 0), dashY = Number(bot.dashDirectionY ?? 0);
        const step = Math.min(Number(bot.dashStepDistance ?? 75), Number(bot.dashRemaining ?? 0));
        const x = clamp(bot.x + dashX * step, bot.size / 2, ARENA_WIDTH_UNITS - bot.size / 2);
        const y = clamp(bot.y + dashY * step, bot.size / 2, ARENA_HEIGHT_UNITS - bot.size / 2);
        const traveled = Math.hypot(x - bot.x, y - bot.y);
        bot.dashRemaining = Math.max(0, Number(bot.dashRemaining ?? 0) - traveled);
        bot.x = x;
        bot.y = y;
        bot.movementVelocityX = dashX * maxMoveSpeed;
        bot.movementVelocityY = dashY * maxMoveSpeed;
        bot.velocityX = dashX * step / seconds;
        bot.velocityY = dashY * step / seconds;
        return;
    }
    const velocity = movementVelocity(dx, dy, magnitude, maxMoveSpeed);
    bot.x = clamp(bot.x + velocity.dx, bot.size / 2, ARENA_WIDTH_UNITS - bot.size / 2);
    bot.y = clamp(bot.y + velocity.dy, bot.size / 2, ARENA_HEIGHT_UNITS - bot.size / 2);
    bot.dashRemaining = 0;
    bot.movementVelocityX = velocity.dx;
    bot.movementVelocityY = velocity.dy;
    bot.velocityX = velocity.dx / seconds;
    bot.velocityY = velocity.dy / seconds;
}

const NOT_TRIGGERED = Object.freeze({ triggered: null, triggeredPayload: null });

/**
 * Starts, continues or cancels one ability on the bot, in place. Returns { triggered, triggeredPayload };
 * `triggered` is the action id when the ability fired this step.
 */
function executeAbility(bot, payload, elapsedMs, cooldownMultiplier, { slowedWasActive, staminaBefore }) {
    if (!payload || !hasAbility(bot, payload.abilityId)) return NOT_TRIGGERED;

    // The ability's channel decides which statuses stop it: silence stops the ability channel, slow the dash.
    // A slow that was active at the start of the tick still blocks it even if it expired during the tick.
    const channel = abilityChannel(payload.abilityId);
    if (channelBlockingStatuses(channel).some((status) => statusIsActive(bot, status)
        || (status === "slow" && slowedWasActive))) {
        return cancelPreparation(bot, payload);
    }
    if (anotherAbilityActive(bot, payload.abilityId)) {
        return cancelPreparation(bot, payload);
    }
    const continuingPreparation = preparingAbilityId(bot) === payload.abilityId;
    if (!continuingPreparation
        && (!abilityTimingReady(bot, payload.abilityId, 0)
            || !abilityResourceReady(bot, payload.abilityId, 0)
            || staminaBefore < abilityStaminaCost(payload.abilityId))) {
        return cancelPreparation(bot, payload);
    }

    // Only the ability records change before the charge is spent; if it cannot be, they are put back.
    const abilityStateBefore = bot.abilityState;
    const windupMs = Number(payload.stats.windupMs ?? 0);
    let triggered = null;
    if (windupMs > 0) {
        const continuing = preparingAbilityId(bot) === payload.abilityId;
        // The windup record's remainingMs is the remaining wind-up time exposed to bot logic and
        // presentation. Consume this fixed step before checking activation.
        const remainingMs = continuing
            ? Math.max(0, preparingRemainingMs(bot) - elapsedMs)
            : Math.max(0, windupMs - elapsedMs);
        const target = continuing
            ? abilityRecord(bot, payload.abilityId).target
            : { x: payload.targetX, y: payload.targetY };
        patchAbilityRecord(bot, payload.abilityId, {
            stage: ABILITY_STAGES.WINDUP,
            remainingMs,
            cooldownMs: undefined,
            target,
        });
        if (remainingMs <= 0) {
            triggered = payload.actionId;
            readyAbilityRecord(bot, payload.abilityId);
        }
    } else {
        triggered = payload.actionId;
    }

    if (triggered == null) return NOT_TRIGGERED;

    const activeMs = activationActiveMs(payload);
    const configuredCooldownMs = Math.round(Number(payload.stats.cooldownMs ?? payload.stats.reuseCooldownMs ?? 1000)
        * cooldownMultiplier * cooldownStartMultiplier(bot));
    startAbilityActive(bot, payload.abilityId, activeMs);
    setAbilityCooldownState(bot, payload.abilityId, configuredCooldownMs);
    const consumed = consumeAbilityCharges(bot, payload.abilityId, 1, {
        elapsedMs,
        cooldownMultiplier,
    });
    if (!consumed.consumed) {
        bot.abilityState = abilityStateBefore;
        return NOT_TRIGGERED;
    }
    // An ability that declares a stamina cost (the dash channel) pays it on activation.
    spendAbilityStamina(bot, payload.abilityId);
    applyActivationVerbs(bot, payload, elapsedMs);
    startTimeline(bot, payload, activeMs);
    return { triggered, triggeredPayload: payload };
}

function cancelPreparation(bot, payload) {
    if (preparingAbilityId(bot) === payload?.abilityId) clearWindup(bot);
    return NOT_TRIGGERED;
}

function activationActiveMs(payload) {
    // Defensive effects and Overclock own their duration as statuses, not as
    // post-activation action locks. Other short-lived combat visuals retain
    // their explicit active fallback.
    const effects = triggerEffects(payload.abilityId);
    if (effects.some((effect) => [EFFECT_TYPES.DAMAGE_REDUCTION, EFFECT_TYPES.DAMAGE_IMMUNITY, EFFECT_TYPES.DAMAGE_REFLECTION].includes(effect.type)
        || (effect.type === EFFECT_TYPES.BUFF && effect.buff === "overclock"))) return 0;
    const explicitActiveMs = payload.activation?.activeMs ?? payload.stats.activeMs;
    if (explicitActiveMs != null) return Math.max(0, Number(explicitActiveMs) || 0);
    return Math.max(300, Number(payload.stats.durationMs ?? payload.stats.visualMs ?? 0));
}

function movementVelocity(inputX, inputY, magnitude, maxSpeed) {
    return !Number.isFinite(magnitude) || magnitude <= 0.001
        ? { dx: 0, dy: 0 }
        : { dx: inputX * maxSpeed, dy: inputY * maxSpeed };
}

function hasAbility(shape, ability) {
    return Array.isArray(shape?.abilities) && shape.abilities.includes(ability);
}
