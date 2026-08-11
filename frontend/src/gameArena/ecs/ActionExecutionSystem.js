import { BASE_BOT_STATS, ABILITY_STATS, ACTION_TO_ABILITY } from "../loadout/BotLoadout.js";
import { compassDegreesToRadians, vectorToCompassDegrees } from "../botlogic/planner/arenaAngles.js";
import { clamp, normalizeAngle } from "../gameconfig/geometry.js";
import { ARENA_HEIGHT_UNITS, ARENA_WIDTH_UNITS, ROTATION_STEP_DEG } from "../modelPayloads/arenaConstants.js";
import { hunterDroneEntity, nullZoneEntity, orbitalMarkerEntity, proximityMineEntity, silenceWaveEntity, temporalRewindZoneEntity, thrownFieldEntity, windburstProjectileEntity } from "./EntityFactory.js";
import { createFireballEntity, createGrenadeEntity } from "./ProjectileSystem.js";
import { tickBotStatus } from "./BotStatusSystem.js";
import { effectiveMovementSpeedMultiplier, HIT_STAGGER_ROTATION_MULTIPLIER } from "../gameconfig/HitStagger.js";

/** Converts one selected action payload into the bot's next component state. */
export function applyBotAction(shape, action, elapsedMs, applyDamage) {
    if ((shape.hp ?? 0) <= 0) return tickBotStatus(shape, elapsedMs, applyDamage);
    const seconds = Math.max(elapsedMs / 1000, 0.001);
    const cooldownMultiplier = 1 / Number(shape.attackSpeedMultiplier ?? 1);
    const speedMultiplier = effectiveMovementSpeedMultiplier(shape);
    const maxMoveSpeed = Number(shape.moveSpeed ?? BASE_BOT_STATS.moveSpeed) * speedMultiplier;
    const rotationMultiplier = Number(shape.hitStaggerMs ?? 0) > 0 ? HIT_STAGGER_ROTATION_MULTIPLIER : 1;
    const preparationLocked = Boolean(shape.preparingAbility)
        && Number(shape.silencedMs ?? 0) <= 0
        && !shape.nullZoneSilenced;
    const executableAction = action;
    const magnitude = Math.hypot(executableAction.dx ?? 0, executableAction.dy ?? 0);
    const dx = magnitude > 0.001 ? executableAction.dx / magnitude : 0;
    const dy = magnitude > 0.001 ? executableAction.dy / magnitude : 0;
    let next = { ...shape, rotation: normalizeAngle(Number(shape.rotation ?? 0) + clamp(executableAction.dRot ?? 0, -1, 1) * ROTATION_STEP_DEG * rotationMultiplier) };
    if (Number(shape.stunnedMs ?? 0) > 0) {
        return {
            ...tickBotStatus(next, elapsedMs, applyDamage),
            preparingAbility: null,
            preparingMs: 0,
            preparingTargetX: null,
            preparingTargetY: null,
            microDashActiveMs: 0,
            microDashRemaining: 0,
            movementVelocityX: 0,
            movementVelocityY: 0,
            velocityX: 0,
            velocityY: 0,
        };
    }
    next = applyMovement(next, shape, executableAction, { dx, dy, magnitude, maxMoveSpeed, speedMultiplier, seconds, elapsedMs });

    const selectedAction = preparationLocked ? next.preparingAbility : selectedAbilityAction(action);
    const wasBlocking = Number(shape.abilityActiveMs?.[2] ?? 0) > 0;
    const blockRequested = hasAbility(shape, 2) && selectedAction === 2;
    const blockActive = blockRequested && Number(next.blockCharges ?? 0) > 0
        && (wasBlocking || Number(next.blockCooldownMs ?? 0) <= 0);
    if (blockActive) next.abilityActiveMs = { ...(next.abilityActiveMs ?? {}), [2]: elapsedMs + 1 };
    else if (wasBlocking) next.blockCooldownMs = Number(ABILITY_STATS[2].reuseCooldownMs ?? 2000) + elapsedMs;
    const abilityPayload = {
        action: ACTION_TO_ABILITY[selectedAction] ? selectedAction : null,
        targetX: preparationLocked ? next.preparingTargetX : action?.abilityAction?.targetX,
        targetY: preparationLocked ? next.preparingTargetY : action?.abilityAction?.targetY,
        movementMode: action?.abilityAction?.movementMode,
        movementDirection: action?.abilityAction?.movementDirection,
        phaseFacingMode: action?.abilityAction?.phaseFacingMode,
    };
    const abilityResult = executeAbility(next, abilityPayload, elapsedMs, cooldownMultiplier, blockActive);
    next = abilityResult.bot;
    const ticked = tickBotStatus(next, elapsedMs, applyDamage);
    return {
        ...ticked,
        thrownGrenade: next.thrownGrenade ?? null,
        thrownFireball: next.thrownFireball ?? null,
        preparingAbility: next.preparingAbility ?? null,
        preparingMs: next.preparingMs ?? 0,
        triggeredAbility: abilityResult.triggered,
        triggeredPhaseFacingMode: abilityResult.triggered === 25 ? abilityPayload.phaseFacingMode ?? "face_target" : null,
        abilityTargetX: abilityPayload.targetX,
        abilityTargetY: abilityPayload.targetY,
        abilitySpawn: spawnForAbility(next, abilityResult.triggered, abilityPayload),
    };
}

function applyMovement(next, shape, action, movement) {
    const { dx, dy, magnitude, maxMoveSpeed, seconds, elapsedMs } = movement;
    if (Number(shape.stunnedMs ?? 0) > 0 || Number(shape.movementLockMs ?? 0) > 0) return { ...next, microDashActiveMs: 0, microDashRemaining: 0, movementVelocityX: 0, movementVelocityY: 0, velocityX: 0, velocityY: 0 };
    if (Number(shape.microDashActiveMs ?? 0) > 0 && Number(shape.microDashRemaining ?? 0) > 0) {
        const dashX = Number(shape.microDashDirectionX ?? 0), dashY = Number(shape.microDashDirectionY ?? 0);
        const step = Math.min(Number(shape.microDashStepDistance ?? 75), Number(shape.microDashRemaining ?? 0));
        const x = clamp(shape.x + dashX * step, shape.size / 2, ARENA_WIDTH_UNITS - shape.size / 2);
        const y = clamp(shape.y + dashY * step, shape.size / 2, ARENA_HEIGHT_UNITS - shape.size / 2);
        const traveled = Math.hypot(x - shape.x, y - shape.y);
        return { ...next, x, y, microDashActiveMs: traveled > 0 ? Math.max(elapsedMs, Number(shape.microDashActiveMs ?? 0)) : 0, microDashRemaining: Math.max(0, Number(shape.microDashRemaining ?? 0) - traveled), movementVelocityX: dashX * maxMoveSpeed, movementVelocityY: dashY * maxMoveSpeed, velocityX: dashX * step / seconds, velocityY: dashY * step / seconds };
    }
    const velocity = nextMovementVelocity(shape, dx, dy, magnitude, maxMoveSpeed);
    return { ...next, x: clamp(shape.x + velocity.dx, shape.size / 2, ARENA_WIDTH_UNITS - shape.size / 2), y: clamp(shape.y + velocity.dy, shape.size / 2, ARENA_HEIGHT_UNITS - shape.size / 2), movementVelocityX: velocity.dx, movementVelocityY: velocity.dy, velocityX: velocity.dx / seconds, velocityY: velocity.dy / seconds };
}

function executeAbility(bot, action, elapsedMs, cooldownMultiplier, blockActive) {
    const abilityAction = action.action;
    const ability = ACTION_TO_ABILITY[abilityAction];
    const immediateResult = executeImmediateAbility(bot, abilityAction, elapsedMs, cooldownMultiplier, blockActive);
    if (immediateResult) return immediateResult;
    let next = bot;
    let triggered = null;
    const charges = ability ? next.abilityCharges?.[ability] : null;
    if (ability && hasAbility(next, ability) && !blockActive && Number(next.silencedMs ?? 0) <= 0 && !next.nullZoneSilenced && Number(next.abilityCooldowns?.[ability] ?? 0) <= 0 && (charges == null || Number(charges) > 0)) {
        const stats = ABILITY_STATS[ability] ?? {};
        const windupMs = Number(stats.windupMs ?? 0);
        if (windupMs > 0) {
            const preparingMs = next.preparingAbility === ability ? Number(next.preparingMs ?? 0) + elapsedMs : elapsedMs;
            next = {
                ...next,
                preparingAbility: ability,
                preparingMs,
                preparingTargetX: next.preparingAbility === ability ? next.preparingTargetX : action.targetX,
                preparingTargetY: next.preparingAbility === ability ? next.preparingTargetY : action.targetY,
            };
            if (preparingMs >= windupMs) { triggered = abilityAction; next = { ...next, preparingAbility: null, preparingMs: 0, preparingTargetX: null, preparingTargetY: null }; }
        } else triggered = abilityAction;
        if (triggered) {
            const configuredActiveMs = ability === 20
                ? Number(stats.activeMs ?? stats.durationMs ?? stats.visualMs ?? 0)
                : 0;
            const activeMs = configuredActiveMs > 0
                ? configuredActiveMs
                : Math.max(300, Number(stats.durationMs ?? stats.visualMs ?? 0));
            next = { ...next, abilityCooldowns: { ...(next.abilityCooldowns ?? {}), [ability]: Number(stats.cooldownMs ?? 1000) * cooldownMultiplier + elapsedMs }, abilityActiveMs: { ...(next.abilityActiveMs ?? {}), [ability]: activeMs + elapsedMs } };
            if (charges != null) next = { ...next, abilityCharges: { ...(next.abilityCharges ?? {}), [ability]: Math.max(0, Number(charges) - 1) } };
            if (ability === 19) next = startMicroDash(next, action, elapsedMs);
            if (ability === 20 && Number.isFinite(Number(action.targetX)) && Number.isFinite(Number(action.targetY))) {
                next = { ...next, rotation: vectorToCompassDegrees(Number(action.targetX) - next.x, Number(action.targetY) - next.y) };
            }
        }
    } else if (next.preparingAbility && (Number(next.silencedMs ?? 0) > 0 || next.nullZoneSilenced || Number(next.stunnedMs ?? 0) > 0)) {
        next = { ...next, preparingAbility: null, preparingMs: 0, preparingTargetX: null, preparingTargetY: null };
    }
    return { bot: next, triggered };
}

function executeImmediateAbility(bot, action, elapsedMs, cooldownMultiplier, blockActive) {
    const ability = ACTION_TO_ABILITY[action];
    if (!ability) return null;
    const stats = ABILITY_STATS[ability] ?? {};
    if (stats.activationModel !== "immediate") return null;
    if (action === 2) {
        return blockActive
            ? { bot: { ...bot, abilityActiveMs: { ...(bot.abilityActiveMs ?? {}), [2]: elapsedMs + 1 } }, triggered: 2 }
            : { bot, triggered: null };
    }
    if (blockActive || !hasAbility(bot, action)) return { bot, triggered: null };
    const abilityCooldowns = { ...(bot.abilityCooldowns ?? {}) };
    const abilityActiveMs = { ...(bot.abilityActiveMs ?? {}) };
    if (action === 1) {
        if (Number(bot.swingCooldownMs ?? 0) > 0) return { bot, triggered: null };
        const cooldownMs = ABILITY_STATS[1].cooldownMs * cooldownMultiplier + elapsedMs;
        return {
            bot: { ...bot, swingCooldownMs: cooldownMs, abilityCooldowns: { ...abilityCooldowns, [ability]: cooldownMs }, abilityActiveMs: { ...abilityActiveMs, [ability]: ABILITY_STATS[1].activeMs + elapsedMs } },
            triggered: action,
        };
    }
    if (action === 3) {
        if (Number(bot.gunAmmo ?? ABILITY_STATS[3].ammoMax) <= 0 || Number(bot.gunReloadMs ?? 0) > 0
            || Number(bot.gunCooldownMs ?? 0) > 0 || Number(abilityActiveMs[ability] ?? 0) > 0) return { bot, triggered: null };
        const ammo = Math.max(0, Number(bot.gunAmmo ?? ABILITY_STATS[3].ammoMax) - 1);
        const cooldownMs = ABILITY_STATS[3].cooldownMs * cooldownMultiplier + elapsedMs;
        return {
            bot: { ...bot, gunAmmo: ammo, gunReloadMs: ammo <= 0 ? ABILITY_STATS[3].reloadMs * cooldownMultiplier + elapsedMs : 0, gunCooldownMs: cooldownMs, abilityCooldowns: { ...abilityCooldowns, [ability]: cooldownMs }, abilityActiveMs: { ...abilityActiveMs, [ability]: ABILITY_STATS[3].activeMs + elapsedMs }, gunRayOriginX: bot.x, gunRayOriginY: bot.y, gunRayRotation: bot.rotation ?? 0 },
            triggered: action,
        };
    }
    if (action === 4) {
        if (Number(bot.grenadeCooldownMs ?? 0) > 0) return { bot, triggered: null };
        const cooldownMs = ABILITY_STATS[4].cooldownMs * cooldownMultiplier + elapsedMs;
        return {
            bot: { ...bot, grenadeCooldownMs: cooldownMs, abilityCooldowns: { ...abilityCooldowns, [ability]: cooldownMs }, abilityActiveMs: { ...abilityActiveMs, [ability]: elapsedMs + 1 }, thrownGrenade: createGrenadeEntity(bot, Number(bot.attackDamageMultiplier ?? 1)), grenadeSerial: Number(bot.grenadeSerial ?? 1) + 1 },
            triggered: action,
        };
    }
    if (action === 5) {
        if (Number(bot.fireballCharges ?? ABILITY_STATS[5].maxCharges) <= 0 || Number(bot.fireballReloadMs ?? 0) > 0
            || Number(bot.fireballCooldownMs ?? 0) > 0 || Number(abilityActiveMs[ability] ?? 0) > 0) return { bot, triggered: null };
        const charges = Math.max(0, Number(bot.fireballCharges ?? ABILITY_STATS[5].maxCharges) - 1);
        const cooldownMs = ABILITY_STATS[5].cooldownMs * cooldownMultiplier + elapsedMs;
        return {
            bot: { ...bot, fireballCharges: charges, fireballReloadMs: charges <= 0 ? ABILITY_STATS[5].reloadMs * cooldownMultiplier + elapsedMs : 0, fireballCooldownMs: cooldownMs, abilityCooldowns: { ...abilityCooldowns, [ability]: cooldownMs }, abilityActiveMs: { ...abilityActiveMs, [ability]: ABILITY_STATS[5].activeMs + elapsedMs }, thrownFireball: createFireballEntity(bot, Number(bot.attackDamageMultiplier ?? 1)), fireballSerial: Number(bot.fireballSerial ?? 1) + 1 },
            triggered: action,
        };
    }
    if (Number(bot.stunCooldownMs ?? 0) > 0 || Number(abilityActiveMs[ability] ?? 0) > 0) return { bot, triggered: null };
    const cooldownMs = ABILITY_STATS[6].cooldownMs * cooldownMultiplier + elapsedMs;
    return { bot: { ...bot, stunCooldownMs: cooldownMs, abilityCooldowns: { ...abilityCooldowns, [ability]: cooldownMs }, abilityActiveMs: { ...abilityActiveMs, [ability]: ABILITY_STATS[6].windupMs + elapsedMs } }, triggered: action };
}

function spawnForAbility(bot, action, payload) {
    if (action === 11) return proximityMineEntity(bot);
    if (action === 15) return silenceWaveEntity(bot);
    if (action === 14) {
        const stats = ABILITY_STATS[14];
        return thrownFieldEntity(bot, "gravityField", 14, Number(stats.fieldSize ?? 240), Number(stats.durationMs ?? 2000));
    }
    if (action === 24) return nullZoneEntity(bot, payload.targetX, payload.targetY, clamp);
    if (action === 17) return hunterDroneEntity(bot);
    if (action === 22) return orbitalMarkerEntity(bot, payload.targetX, payload.targetY, clamp);
    if (action === 21) return temporalRewindZoneEntity(bot);
    if (action === 18) return windburstProjectileEntity(bot);
    return null;
}

function startMicroDash(bot, action, elapsedMs) {
    const stats = ABILITY_STATS[19];
    const bearing = Number.isFinite(Number(action.targetX)) && Number.isFinite(Number(action.targetY)) ? Math.atan2(Number(action.targetY) - bot.y, Number(action.targetX) - bot.x) : compassDegreesToRadians(bot.rotation);
    const directions = { north: [0, -1], south: [0, 1], east: [1, 0], west: [-1, 0], northeast: [Math.SQRT1_2, -Math.SQRT1_2], northwest: [-Math.SQRT1_2, -Math.SQRT1_2], southeast: [Math.SQRT1_2, Math.SQRT1_2], southwest: [-Math.SQRT1_2, Math.SQRT1_2] };
    const direction = action.movementDirection ?? "toward";
    const absolute = action.movementMode === "absolute" ? directions[direction] : null;
    const radial = direction.startsWith("away") ? -1 : 1;
    const diagonal = direction.endsWith("_left") || direction.endsWith("_right");
    const side = direction.endsWith("right") ? 1 : -1;
    const [ux, uy] = absolute ?? (diagonal
        ? [(Math.cos(bearing) * radial - Math.sin(bearing) * side) * Math.SQRT1_2, (Math.sin(bearing) * radial + Math.cos(bearing) * side) * Math.SQRT1_2]
        : direction === "away" ? [-Math.cos(bearing), -Math.sin(bearing)]
        : direction === "left" || direction === "right" ? [-Math.sin(bearing) * side, Math.cos(bearing) * side]
        : [Math.cos(bearing), Math.sin(bearing)]);
    const distance = Number(stats.distance ?? 150), step = Math.min(Number(stats.speedPerTick ?? 75), distance);
    const x = clamp(bot.x + ux * step, bot.size / 2, ARENA_WIDTH_UNITS - bot.size / 2), y = clamp(bot.y + uy * step, bot.size / 2, ARENA_HEIGHT_UNITS - bot.size / 2);
    const traveled = Math.hypot(x - bot.x, y - bot.y);
    const trailMs = Number(stats.trailMs ?? 300);
    return { ...bot, x, y, microDashActiveMs: Number(stats.durationMs ?? 200) + elapsedMs, microDashRemaining: Math.max(0, distance - traveled), microDashInitialDistance: distance, microDashStepDistance: Number(stats.speedPerTick ?? 75), microDashDirectionX: ux, microDashDirectionY: uy, microDashOriginX: bot.x, microDashOriginY: bot.y, microDashTrailMs: trailMs + elapsedMs, abilityVisual: { ability: 19, ms: trailMs } };
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

function selectedAbilityAction(action) {
    return Number.isSafeInteger(action?.abilityAction?.action) ? action.abilityAction.action : null;
}
