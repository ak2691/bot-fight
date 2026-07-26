import { BASE_BOT_STATS, PROTOTYPE_ABILITY_STATS, PROTOTYPE_ACTION_TO_ABILITY } from "../loadout/BotLoadout.js";
import {
    DASH_COOLDOWN_MS,
    FIREBALL_ACTIVE_MS,
    FIREBALL_CHARGES_MAX,
    FIREBALL_COOLDOWN_MS,
    FIREBALL_RELOAD_MS,
    GUN_ACTIVE_MS,
    GUN_COOLDOWN_MS,
    RANGED_AMMO_MAX,
    RANGED_RELOAD_MS,
    SWING_ACTIVE_MS,
    SWING_COOLDOWN_MS,
} from "../combat/Moves.js";
import { GRENADE_COOLDOWN_MS, STUN_ACTIVE_MS, STUN_COOLDOWN_MS } from "../combat/Abilities.js";
import { compassDegreesToRadians } from "../../logic/arenaAngles.js";
import { clamp, normalizeAngle } from "../combat/geometry.js";
import { ARENA_HEIGHT_UNITS, ARENA_WIDTH_UNITS, DASH_DURATION_MS, DASH_SPEED, MOVE_ACCELERATION_PER_TICK, MOVE_BRAKE_ACCELERATION_PER_TICK, ROTATION_STEP_DEG } from "../modelPayloads/arenaConstants.js";
import { hunterDroneEntity, nullZoneEntity, orbitalMarkerEntity, proximityMineEntity, silenceWaveEntity, temporalRewindZoneEntity, thrownFieldEntity } from "./EntityFactory.js";
import { createFireballEntity, createGrenadeEntity } from "./ProjectileSystem.js";
import { tickFighterStatus } from "./FighterStatusSystem.js";
import { BLOCK_REUSE_COOLDOWN_MS } from "../combat/ShieldSystem.js";

const SLOW_SPEED_MULTIPLIER = 0.6;

/** Converts one selected action payload into the fighter's next component state. */
export function applyFighterAction(shape, action, elapsedMs, applyDamage) {
    if ((shape.hp ?? 0) <= 0) return tickFighterStatus(shape, elapsedMs, applyDamage);
    const seconds = Math.max(elapsedMs / 1000, 0.001);
    const magnitude = Math.hypot(action.dx ?? 0, action.dy ?? 0);
    const dx = magnitude > 0.001 ? action.dx / magnitude : 0;
    const dy = magnitude > 0.001 ? action.dy / magnitude : 0;
    const cooldownMultiplier = 1 / Number(shape.attackSpeedMultiplier ?? 1);
    const speedMultiplier = Number(shape.slowedMs ?? 0) > 0 ? SLOW_SPEED_MULTIPLIER : 1;
    const maxMoveSpeed = Number(shape.moveSpeed ?? BASE_BOT_STATS.moveSpeed) * speedMultiplier;
    let next = { ...shape, rotation: normalizeAngle(Number(shape.rotation ?? 0) + clamp(action.dRot ?? 0, -1, 1) * ROTATION_STEP_DEG) };
    if (Number(shape.stunnedMs ?? 0) > 0) {
        return {
            ...tickFighterStatus(next, elapsedMs, applyDamage),
            preparingAbility: null,
            preparingMs: 0,
            preparingTargetX: null,
            preparingTargetY: null,
            dashActiveMs: 0,
            microDashActiveMs: 0,
            microDashRemaining: 0,
            movementVelocityX: 0,
            movementVelocityY: 0,
            velocityX: 0,
            velocityY: 0,
        };
    }
    next = applyMovement(next, shape, action, { dx, dy, magnitude, maxMoveSpeed, speedMultiplier, seconds, elapsedMs });

    const preparationLocked = Boolean(next.preparingAbility)
        && Number(next.silencedMs ?? 0) <= 0
        && !next.nullZoneSilenced;
    const selectedAction = preparationLocked ? next.preparingAbility : selectedAbilityAction(action);
    const wasBlocking = Number(shape.blockActiveMs ?? 0) > 0;
    const blockRequested = hasAbility(shape, "block") && selectedAction === "block";
    const blockActive = blockRequested && Number(next.blockCharges ?? 0) > 0
        && (wasBlocking || Number(next.blockCooldownMs ?? 0) <= 0);
    if (blockActive) next.blockActiveMs = 1;
    else if (wasBlocking) next.blockCooldownMs = BLOCK_REUSE_COOLDOWN_MS + elapsedMs;
    const swung = !blockActive && hasAbility(next, "swing") && selectedAction === "swing" && Number(next.swingCooldownMs ?? 0) <= 0;
    if (swung) {
        next.swingCooldownMs = SWING_COOLDOWN_MS * cooldownMultiplier;
        // Status timers are decremented at the end of this same step. Include
        // that step so the first rendered frame begins at the start of the arc.
        next.swingActiveMs = SWING_ACTIVE_MS + elapsedMs;
    }

    const firedGun = !blockActive && selectedAction === "fire_gun" && hasAbility(next, "fire_gun")
        && Number(next.gunAmmo ?? RANGED_AMMO_MAX) > 0 && Number(next.gunReloadMs ?? 0) <= 0
        && Number(next.gunCooldownMs ?? 0) <= 0 && Number(next.gunActiveMs ?? 0) <= 0;
    if (firedGun) {
        const ammo = Math.max(0, Number(next.gunAmmo ?? RANGED_AMMO_MAX) - 1);
        Object.assign(next, { gunAmmo: ammo, gunReloadMs: ammo <= 0 ? RANGED_RELOAD_MS * cooldownMultiplier : 0, gunActiveMs: GUN_ACTIVE_MS, gunCooldownMs: GUN_COOLDOWN_MS * cooldownMultiplier, gunRayOriginX: shape.x, gunRayOriginY: shape.y, gunRayRotation: shape.rotation ?? 0 });
    }

    const threwGrenade = !blockActive && selectedAction === "throw_grenade" && hasAbility(next, "throw_grenade") && Number(next.grenadeCooldownMs ?? 0) <= 0;
    if (threwGrenade) {
        next.grenadeCooldownMs = GRENADE_COOLDOWN_MS * cooldownMultiplier;
        next.thrownGrenade = createGrenadeEntity(next, Number(next.attackDamageMultiplier ?? 1));
        next.grenadeSerial = Number(next.grenadeSerial ?? 1) + 1;
    }

    const shotFireball = !blockActive && selectedAction === "shoot_fireball" && hasAbility(next, "shoot_fireball")
        && Number(next.fireballCharges ?? FIREBALL_CHARGES_MAX) > 0 && Number(next.fireballReloadMs ?? 0) <= 0
        && Number(next.fireballCooldownMs ?? 0) <= 0 && Number(next.fireballActiveMs ?? 0) <= 0;
    if (shotFireball) {
        const charges = Math.max(0, Number(next.fireballCharges ?? FIREBALL_CHARGES_MAX) - 1);
        Object.assign(next, { fireballCharges: charges, fireballReloadMs: charges <= 0 ? FIREBALL_RELOAD_MS * cooldownMultiplier : 0, fireballActiveMs: FIREBALL_ACTIVE_MS, fireballCooldownMs: FIREBALL_COOLDOWN_MS * cooldownMultiplier, thrownFireball: createFireballEntity(next, Number(next.attackDamageMultiplier ?? 1)), fireballSerial: Number(next.fireballSerial ?? 1) + 1 });
    }

    const castStun = !blockActive && selectedAction === "stun" && hasAbility(next, "stun")
        && Number(next.stunCooldownMs ?? 0) <= 0 && Number(next.stunActiveMs ?? 0) <= 0;
    if (castStun) Object.assign(next, { stunActiveMs: STUN_ACTIVE_MS, stunCooldownMs: STUN_COOLDOWN_MS * cooldownMultiplier, stunCastActive: true });

    const specialPayload = {
        specialAction: PROTOTYPE_ACTION_TO_ABILITY[selectedAction] ? selectedAction : null,
        specialTargetX: preparationLocked ? next.preparingTargetX : action?.abilityAction?.targetX ?? action?.specialTargetX,
        specialTargetY: preparationLocked ? next.preparingTargetY : action?.abilityAction?.targetY ?? action?.specialTargetY,
    };
    const specialResult = executeSpecial(next, specialPayload, elapsedMs, cooldownMultiplier, blockActive);
    next = specialResult.fighter;
    const ticked = tickFighterStatus(next, elapsedMs, applyDamage);
    return {
        ...ticked,
        blockActiveMs: blockActive ? 1 : ticked.blockActiveMs,
        swingTriggered: swung,
        gunShotActive: firedGun,
        stunCastActive: castStun,
        stunActiveMs: castStun ? STUN_ACTIVE_MS : ticked.stunActiveMs,
        thrownGrenade: next.thrownGrenade ?? null,
        thrownFireball: next.thrownFireball ?? null,
        preparingAbility: next.preparingAbility ?? null,
        preparingMs: next.preparingMs ?? 0,
        prototypeTriggered: specialResult.triggered,
        prototypeTargetX: specialPayload.specialTargetX,
        prototypeTargetY: specialPayload.specialTargetY,
        prototypeSpawn: spawnForSpecial(next, specialResult.triggered, specialPayload),
    };
}

function applyMovement(next, shape, action, movement) {
    const { dx, dy, magnitude, maxMoveSpeed, speedMultiplier, seconds, elapsedMs } = movement;
    if (Number(shape.stunnedMs ?? 0) > 0 || Number(shape.movementLockMs ?? 0) > 0) return { ...next, dashActiveMs: 0, microDashActiveMs: 0, microDashRemaining: 0, movementVelocityX: 0, movementVelocityY: 0, velocityX: 0, velocityY: 0 };
    if (Number(shape.microDashActiveMs ?? 0) > 0 && Number(shape.microDashRemaining ?? 0) > 0) {
        const dashX = Number(shape.microDashDirectionX ?? 0), dashY = Number(shape.microDashDirectionY ?? 0);
        const step = Math.min(Number(shape.microDashStepDistance ?? 75), Number(shape.microDashRemaining ?? 0));
        const x = clamp(shape.x + dashX * step, shape.size / 2, ARENA_WIDTH_UNITS - shape.size / 2);
        const y = clamp(shape.y + dashY * step, shape.size / 2, ARENA_HEIGHT_UNITS - shape.size / 2);
        const traveled = Math.hypot(x - shape.x, y - shape.y);
        return { ...next, x, y, microDashActiveMs: traveled > 0 ? Math.max(elapsedMs, Number(shape.microDashActiveMs ?? 0)) : 0, microDashRemaining: Math.max(0, Number(shape.microDashRemaining ?? 0) - traveled), movementVelocityX: dashX * maxMoveSpeed, movementVelocityY: dashY * maxMoveSpeed, velocityX: dashX * step / seconds, velocityY: dashY * step / seconds };
    }
    if (Number(shape.dashActiveMs ?? 0) > 0) {
        const dashX = Number(shape.dashDirectionX ?? 0), dashY = Number(shape.dashDirectionY ?? 0);
        return { ...next, x: clamp(shape.x + dashX * DASH_SPEED * speedMultiplier, shape.size / 2, ARENA_WIDTH_UNITS - shape.size / 2), y: clamp(shape.y + dashY * DASH_SPEED * speedMultiplier, shape.size / 2, ARENA_HEIGHT_UNITS - shape.size / 2), movementVelocityX: dashX * maxMoveSpeed, movementVelocityY: dashY * maxMoveSpeed, velocityX: dashX * DASH_SPEED / seconds, velocityY: dashY * DASH_SPEED / seconds };
    }
    const dashAvailable = hasAbility(shape, "dash") && Number(shape.dashCooldownMs ?? 0) <= 0;
    const dashRequested = Boolean(action?.dashAction?.startsWith?.("dash")) || Number(action?.dash ?? 0) > 0.5;
    if (dashRequested && dashAvailable) {
        const angle = compassDegreesToRadians(next.rotation);
        const dashX = magnitude > 0.001 ? dx : Math.cos(angle), dashY = magnitude > 0.001 ? dy : Math.sin(angle);
        return { ...next, x: clamp(shape.x + dashX * DASH_SPEED, shape.size / 2, ARENA_WIDTH_UNITS - shape.size / 2), y: clamp(shape.y + dashY * DASH_SPEED, shape.size / 2, ARENA_HEIGHT_UNITS - shape.size / 2), dashActiveMs: DASH_DURATION_MS, dashCooldownMs: DASH_COOLDOWN_MS, dashDirectionX: dashX, dashDirectionY: dashY, movementVelocityX: dashX * maxMoveSpeed, movementVelocityY: dashY * maxMoveSpeed, velocityX: dashX * DASH_SPEED * speedMultiplier / seconds, velocityY: dashY * DASH_SPEED * speedMultiplier / seconds };
    }
    if (!dashRequested) {
        const velocity = nextMovementVelocity(shape, dx, dy, magnitude, maxMoveSpeed);
        return { ...next, x: clamp(shape.x + velocity.dx, shape.size / 2, ARENA_WIDTH_UNITS - shape.size / 2), y: clamp(shape.y + velocity.dy, shape.size / 2, ARENA_HEIGHT_UNITS - shape.size / 2), movementVelocityX: velocity.dx, movementVelocityY: velocity.dy, velocityX: velocity.dx / seconds, velocityY: velocity.dy / seconds };
    }
    return { ...next, movementVelocityX: 0, movementVelocityY: 0, velocityX: 0, velocityY: 0 };
}

function executeSpecial(fighter, action, elapsedMs, cooldownMultiplier, blockActive) {
    const specialAction = action.specialAction;
    const ability = PROTOTYPE_ACTION_TO_ABILITY[specialAction];
    let next = fighter;
    let triggered = null;
    if (ability && hasAbility(next, ability) && !blockActive && Number(next.silencedMs ?? 0) <= 0 && !next.nullZoneSilenced && Number(next.abilityCooldowns?.[ability] ?? 0) <= 0) {
        const stats = PROTOTYPE_ABILITY_STATS[ability] ?? {};
        const windupMs = Number(stats.windupMs ?? 0);
        if (windupMs > 0) {
            const preparingMs = next.preparingAbility === ability ? Number(next.preparingMs ?? 0) + elapsedMs : elapsedMs;
            next = {
                ...next,
                preparingAbility: ability,
                preparingMs,
                preparingTargetX: next.preparingAbility === ability ? next.preparingTargetX : action.specialTargetX,
                preparingTargetY: next.preparingAbility === ability ? next.preparingTargetY : action.specialTargetY,
            };
            if (preparingMs >= windupMs) { triggered = specialAction; next = { ...next, preparingAbility: null, preparingMs: 0, preparingTargetX: null, preparingTargetY: null }; }
        } else triggered = specialAction;
        if (triggered) {
            next = { ...next, abilityCooldowns: { ...(next.abilityCooldowns ?? {}), [ability]: Number(stats.cooldownMs ?? 1000) * cooldownMultiplier }, abilityActiveMs: { ...(next.abilityActiveMs ?? {}), [ability]: Math.max(250, Number(stats.durationMs ?? 250)) } };
            if (ability === "micro_dash") next = startMicroDash(next, specialAction, action.specialTargetX, action.specialTargetY);
        }
    } else if (next.preparingAbility && (Number(next.silencedMs ?? 0) > 0 || next.nullZoneSilenced || Number(next.stunnedMs ?? 0) > 0)) {
        next = { ...next, preparingAbility: null, preparingMs: 0, preparingTargetX: null, preparingTargetY: null };
    }
    return { fighter: next, triggered };
}

function spawnForSpecial(fighter, action, payload) {
    if (action === "proximity_mine") return proximityMineEntity(fighter);
    if (action === "silence_pulse") return silenceWaveEntity(fighter);
    if (action === "gravity_grenade") return thrownFieldEntity(fighter, "gravityField", "gravity_grenade", 240, 2000);
    if (action === "null_zone") return nullZoneEntity(fighter, payload.specialTargetX, payload.specialTargetY, clamp);
    if (action === "hunter_drone") return hunterDroneEntity(fighter);
    if (action === "orbital_strike") return orbitalMarkerEntity(fighter, payload.specialTargetX, payload.specialTargetY, clamp);
    if (action === "temporal_rewind") return temporalRewindZoneEntity(fighter);
    return null;
}

function startMicroDash(fighter, action, targetX, targetY) {
    const stats = PROTOTYPE_ABILITY_STATS.micro_dash;
    const bearing = Number.isFinite(Number(targetX)) && Number.isFinite(Number(targetY)) ? Math.atan2(Number(targetY) - fighter.y, Number(targetX) - fighter.x) : compassDegreesToRadians(fighter.rotation);
    const directions = { north: [0, -1], south: [0, 1], east: [1, 0], west: [-1, 0], northeast: [Math.SQRT1_2, -Math.SQRT1_2], northwest: [-Math.SQRT1_2, -Math.SQRT1_2], southeast: [Math.SQRT1_2, Math.SQRT1_2], southwest: [-Math.SQRT1_2, Math.SQRT1_2] };
    const suffix = Object.keys(directions).find((name) => action.endsWith(`_${name}`));
    const diagonal = action.includes("_toward_") || action.includes("_away_");
    const radial = action.includes("_away_") ? -1 : 1, side = action.endsWith("right") ? 1 : -1;
    const [ux, uy] = suffix ? directions[suffix] : diagonal ? [(Math.cos(bearing) * radial - Math.sin(bearing) * side) * Math.SQRT1_2, (Math.sin(bearing) * radial + Math.cos(bearing) * side) * Math.SQRT1_2] : action.endsWith("outward") ? [-Math.cos(bearing), -Math.sin(bearing)] : action.endsWith("right") || action.endsWith("left") ? [-Math.sin(bearing) * side, Math.cos(bearing) * side] : [Math.cos(bearing), Math.sin(bearing)];
    const distance = Number(stats.distance ?? 150), step = Math.min(Number(stats.speedPerTick ?? 75), distance);
    const x = clamp(fighter.x + ux * step, fighter.size / 2, ARENA_WIDTH_UNITS - fighter.size / 2), y = clamp(fighter.y + uy * step, fighter.size / 2, ARENA_HEIGHT_UNITS - fighter.size / 2);
    const traveled = Math.hypot(x - fighter.x, y - fighter.y);
    return { ...fighter, x, y, microDashActiveMs: Number(stats.durationMs ?? 200), microDashRemaining: Math.max(0, distance - traveled), microDashInitialDistance: distance, microDashStepDistance: Number(stats.speedPerTick ?? 75), microDashDirectionX: ux, microDashDirectionY: uy, microDashOriginX: fighter.x, microDashOriginY: fighter.y, microDashTrailMs: 300, prototypeVisual: { ability: "micro_dash", ms: 300 } };
}

function nextMovementVelocity(shape, inputX, inputY, magnitude, maxSpeed) {
    const current = { dx: Number(shape.movementVelocityX ?? 0), dy: Number(shape.movementVelocityY ?? 0) };
    if (!Number.isFinite(magnitude) || magnitude <= 0.001) return { dx: decelerate(current.dx, MOVE_ACCELERATION_PER_TICK), dy: decelerate(current.dy, MOVE_ACCELERATION_PER_TICK) };
    return clampVelocity({ dx: accelerate(current.dx, inputX), dy: accelerate(current.dy, inputY) }, maxSpeed);
}

function accelerate(current, input) {
    if (!Number.isFinite(current) || !Number.isFinite(input)) return 0;
    if (Math.abs(input) <= 0.001) return decelerate(current, MOVE_ACCELERATION_PER_TICK);
    return current + input * (current * input < -0.001 ? MOVE_BRAKE_ACCELERATION_PER_TICK : MOVE_ACCELERATION_PER_TICK);
}

function decelerate(value, amount) {
    if (!Number.isFinite(value) || Math.abs(value) <= amount) return 0;
    return value > 0 ? value - amount : value + amount;
}

function clampVelocity(velocity, maxSpeed) {
    const speed = Math.hypot(velocity.dx, velocity.dy);
    return !Number.isFinite(speed) || speed <= maxSpeed ? velocity : { dx: velocity.dx / speed * maxSpeed, dy: velocity.dy / speed * maxSpeed };
}

function hasAbility(shape, ability) {
    return Array.isArray(shape?.abilities) && shape.abilities.includes(ability);
}

function selectedAbilityAction(action) {
    if (typeof action?.abilityAction?.action === "string") return action.abilityAction.action;
    if (Number(action?.swing ?? 0) > 0.5) return "swing";
    if (Number(action?.block ?? 0) > 0.5) return "block";
    if (Number(action?.gun ?? 0) > 0.5) return "fire_gun";
    if (Number(action?.grenade ?? 0) > 0.5) return "throw_grenade";
    if (Number(action?.fireball ?? 0) > 0.5) return "shoot_fireball";
    if (Number(action?.stun ?? 0) > 0.5) return "stun";
    return action?.specialAction ?? null;
}
