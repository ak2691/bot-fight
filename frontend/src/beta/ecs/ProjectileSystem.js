import {
    FIREBALL_BURN_DURATION_MS,
    FIREBALL_BURN_TICK_MS,
    FIREBALL_DAMAGE,
    FIREBALL_RANGE,
    FIREBALL_SIZE,
    FIREBALL_SPEED,
    GRENADE_DECELERATION_PER_TICK,
    GRENADE_SIZE,
    GRENADE_STOP_FUSE_MS,
    GRENADE_THROW_SPEED,
} from "../combat/Moves.js";
import { GRENADE_EXPLOSION_RADIUS } from "../combat/Abilities.js";
import { clamp } from "../combat/geometry.js";
import { abilityContract, EFFECT_TYPES } from "../combat/AbilityContracts.js";
import { resolveShieldInteraction } from "../combat/ShieldSystem.js";
import { ignoresHostileEffects, isProjectileHittable } from "../combat/DefensiveState.js";
import { compassDirection } from "../../logic/arenaAngles.js";

export function createGrenadeEntity(fighter, damageMultiplier = 1) {
    const { x: directionX, y: directionY } = compassDirection(fighter.rotation);
    const spawnDistance = Number(fighter.size ?? 60) / 2 + GRENADE_SIZE / 2 + 2;
    return {
        id: `grenade-${fighter.id}-${fighter.grenadeSerial ?? 1}`,
        type: "grenade",
        ownerId: fighter.id,
        x: fighter.x + directionX * spawnDistance,
        y: fighter.y + directionY * spawnDistance,
        size: GRENADE_SIZE,
        rotation: 0,
        velocityX: directionX * GRENADE_THROW_SPEED,
        velocityY: directionY * GRENADE_THROW_SPEED,
        stoppedMs: 0,
        damageMultiplier,
        locked: true,
    };
}

export function createFireballEntity(fighter, damageMultiplier = 1) {
    const { x: directionX, y: directionY } = compassDirection(fighter.rotation);
    const spawnDistance = Number(fighter.size ?? 60) / 2 + FIREBALL_SIZE / 2 + 2;
    return {
        id: `fireball-${fighter.id}-${fighter.fireballSerial ?? 1}`,
        type: "fireball",
        ownerId: fighter.id,
        x: fighter.x + directionX * spawnDistance,
        y: fighter.y + directionY * spawnDistance,
        size: FIREBALL_SIZE,
        rotation: fighter.rotation ?? 0,
        velocityX: directionX * FIREBALL_SPEED,
        velocityY: directionY * FIREBALL_SPEED,
        traveled: 0,
        damageMultiplier,
        locked: true,
    };
}

/** Advances all short-lived projectiles and returns their net fighter changes. */
export function tickProjectileWorld(world, combat) {
    const grenadeResult = tickGrenades(world.grenades, world.fighters, world, combat);
    const fireballResult = tickFireballs(world.fireballs, grenadeResult.fighters, world, combat);
    return {
        fighters: fireballResult.fighters,
        grenades: [...grenadeResult.grenades, ...grenadeResult.explosions],
        fireballs: fireballResult.fireballs,
        grenadeExplosions: grenadeResult.explosions,
    };
}

export function grenadeDamageToEntity(explosion, entity) {
    const nearestBodyDistance = Math.max(0, Math.hypot(entity.x - explosion.x, entity.y - explosion.y) - Number(entity.size ?? 60) / 2);
    if (nearestBodyDistance > GRENADE_EXPLOSION_RADIUS) return 0;
    const rawDamage = interpolate(nearestBodyDistance, 0, GRENADE_EXPLOSION_RADIUS, 50, 25);
    return clamp(Math.round(rawDamage / 5) * 5, 25, 50) * Number(explosion.damageMultiplier ?? 1);
}

export function overlapsEntity(first, second, padding = 0) {
    return Math.hypot(first.x - second.x, first.y - second.y) <= (Number(first.size ?? 60) + Number(second.size ?? 0)) / 2 + padding;
}

function tickGrenades(grenades, fighters, world, combat) {
    const remaining = [];
    const explosions = [];
    for (const grenade of grenades) {
        if (grenade.type === "grenadeExplosion") {
            const remainingMs = Math.max(0, Number(grenade.remainingMs ?? 0) - world.stepMs);
            if (remainingMs > 0) remaining.push({ ...grenade, remainingMs });
            continue;
        }
        const next = advanceGrenade(grenade, world);
        const touchedFighter = fighters.some((fighter) => isProjectileHittable(fighter)
            && (fighter.id !== next.ownerId || next.reflected) && overlapsEntity(fighter, next));
        const stoppedLongEnough = Math.hypot(next.velocityX ?? 0, next.velocityY ?? 0) <= 0.001
            && Number(next.stoppedMs ?? 0) >= GRENADE_STOP_FUSE_MS;
        if (touchedFighter || stoppedLongEnough) explosions.push(createGrenadeExplosion(next));
        else remaining.push(next);
    }
    let nextFighters = fighters;
    for (const explosion of explosions) {
        nextFighters = nextFighters.map((fighter) => {
            if (ignoresHostileEffects(fighter)) return fighter;
            const damage = grenadeDamageToEntity(explosion, fighter);
            const blockCharges = grenadeBlockCharges(explosion, fighter);
            if (damage <= 0 && blockCharges <= 0) return fighter;
            const shield = resolveShieldInteraction(fighter, explosion, abilityContract("throw_grenade").shieldInteraction, { chargeCost: blockCharges });
            if (shield.preventedEffects.has(EFFECT_TYPES.DAMAGE)) return shield.fighter;
            return damage > 0 ? combat.applyDamageToShape(fighter, damage) : fighter;
        });
    }
    return { grenades: remaining, explosions, fighters: nextFighters };
}

function tickFireballs(fireballs, fighters, world, combat) {
    const remaining = [];
    let nextFighters = fighters;
    for (const fireball of fireballs) {
        const next = {
            ...fireball,
            x: fireball.x + Number(fireball.velocityX ?? 0),
            y: fireball.y + Number(fireball.velocityY ?? 0),
            traveled: Number(fireball.traveled ?? 0) + Math.hypot(Number(fireball.velocityX ?? 0), Number(fireball.velocityY ?? 0)),
        };
        const hit = nextFighters.find((fighter) => isProjectileHittable(fighter)
            && (fighter.id !== next.ownerId || next.reflected) && overlapsEntity(fighter, next));
        if (hit) {
            const damageMultiplier = Number(next.damageMultiplier ?? 1);
            nextFighters = nextFighters.map((fighter) => {
                if (fighter.id !== hit.id) return fighter;
                if (ignoresHostileEffects(fighter)) return fighter;
                const shield = resolveShieldInteraction(fighter, next, abilityContract("shoot_fireball").shieldInteraction);
                if (shield.preventedEffects.has(EFFECT_TYPES.DAMAGE)) return shield.fighter;
                const damaged = combat.applyDamageToShape(shield.fighter, FIREBALL_DAMAGE * damageMultiplier);
                if (ignoresHostileEffects(damaged)) return damaged;
                return {
                    ...damaged,
                    burnRemainingMs: FIREBALL_BURN_DURATION_MS,
                    // Refreshing burn extends its lifetime without postponing an
                    // already-running damage tick.
                    burnTickMs: Number(fighter.burnRemainingMs ?? 0) > 0
                        ? Math.max(0, Number(fighter.burnTickMs ?? 0))
                        : FIREBALL_BURN_TICK_MS,
                    burnDamageMultiplier: Math.max(Number(fighter.burnDamageMultiplier ?? 1), damageMultiplier),
                };
            });
        } else if (Number(next.traveled ?? 0) < FIREBALL_RANGE && insideArena(next, world)) {
            remaining.push(next);
        }
    }
    return { fireballs: remaining, fighters: nextFighters };
}

function advanceGrenade(grenade, world) {
    const intendedX = grenade.x + Number(grenade.velocityX ?? 0);
    const intendedY = grenade.y + Number(grenade.velocityY ?? 0);
    const next = {
        ...grenade,
        x: clamp(intendedX, GRENADE_SIZE / 2, world.width - GRENADE_SIZE / 2),
        y: clamp(intendedY, GRENADE_SIZE / 2, world.height - GRENADE_SIZE / 2),
    };
    if (next.x !== intendedX || next.y !== intendedY) {
        next.velocityX = 0;
        next.velocityY = 0;
    } else {
        const speed = Math.hypot(Number(next.velocityX ?? 0), Number(next.velocityY ?? 0));
        const nextSpeed = Math.max(0, speed - GRENADE_DECELERATION_PER_TICK);
        next.velocityX = speed > 0 ? next.velocityX / speed * nextSpeed : 0;
        next.velocityY = speed > 0 ? next.velocityY / speed * nextSpeed : 0;
    }
    next.stoppedMs = Math.hypot(next.velocityX, next.velocityY) <= 0.001 ? Number(next.stoppedMs ?? 0) + world.stepMs : 0;
    return next;
}

function createGrenadeExplosion(grenade) {
    return { ...grenade, id: `${grenade.id}-explosion`, type: "grenadeExplosion", size: GRENADE_EXPLOSION_RADIUS * 2, velocityX: 0, velocityY: 0, remainingMs: 200 };
}

function insideArena(entity, world) {
    return entity.x >= -entity.size && entity.x <= world.width + entity.size
        && entity.y >= -entity.size && entity.y <= world.height + entity.size;
}

function interpolate(value, min, max, near, far) {
    const t = clamp((value - min) / (max - min), 0, 1);
    return near + (far - near) * t;
}

function grenadeBlockCharges(explosion, fighter) {
    const distance = Math.max(0, Math.hypot(fighter.x - explosion.x, fighter.y - explosion.y) - Number(fighter.size ?? 60) / 2);
    if (distance > GRENADE_EXPLOSION_RADIUS) return 0;
    return clamp(Math.round(interpolate(distance, 0, GRENADE_EXPLOSION_RADIUS, 5, 1)), 1, 5);
}
