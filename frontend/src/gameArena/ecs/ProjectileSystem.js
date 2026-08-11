import { ABILITY_STATS } from "../gameconfig/Abilities.js";
import { clamp } from "../gameconfig/geometry.js";
import { abilityContract, EFFECT_TYPES } from "../gameconfig/AbilityContracts.js";
import { resolveShieldInteraction } from "../gameconfig/ShieldSystem.js";
import { ignoresHostileEffects, isProjectileHittable } from "../gameconfig/DefensiveState.js";
import { compassDirection } from "../botlogic/planner/arenaAngles.js";

const grenadeStats = ABILITY_STATS[4];
const fireballStats = ABILITY_STATS[5];

export function createGrenadeEntity(bot, damageMultiplier = 1) {
    const { x: directionX, y: directionY } = compassDirection(bot.rotation);
    const spawnDistance = Number(bot.size ?? 60) / 2 + grenadeStats.size / 2 + 2;
    return {
        id: `grenade-${bot.id}-${bot.grenadeSerial ?? 1}`,
        type: "grenade",
        ownerId: bot.id,
        ownerSlot: bot.slot,
        x: bot.x + directionX * spawnDistance,
        y: bot.y + directionY * spawnDistance,
        size: grenadeStats.size,
        rotation: 0,
        velocityX: directionX * grenadeStats.speed,
        velocityY: directionY * grenadeStats.speed,
        stoppedMs: 0,
        damageMultiplier,
        locked: true,
    };
}

export function createFireballEntity(bot, damageMultiplier = 1) {
    const { x: directionX, y: directionY } = compassDirection(bot.rotation);
    const spawnDistance = Number(bot.size ?? 60) / 2 + fireballStats.size / 2 + 2;
    return {
        id: `fireball-${bot.id}-${bot.fireballSerial ?? 1}`,
        type: "fireball",
        ownerId: bot.id,
        ownerSlot: bot.slot,
        x: bot.x + directionX * spawnDistance,
        y: bot.y + directionY * spawnDistance,
        size: fireballStats.size,
        rotation: bot.rotation ?? 0,
        velocityX: directionX * fireballStats.speed,
        velocityY: directionY * fireballStats.speed,
        traveled: 0,
        damageMultiplier,
        locked: true,
    };
}

/** Advances all short-lived projectiles and returns their net bot changes. */
export function tickProjectileWorld(world, combat) {
    const grenadeResult = tickGrenades(world.grenades, world.bots, world, combat);
    const fireballResult = tickFireballs(world.fireballs, grenadeResult.bots, world, combat);
    return {
        bots: fireballResult.bots,
        grenades: [...grenadeResult.grenades, ...grenadeResult.explosions],
        fireballs: fireballResult.fireballs,
        grenadeExplosions: grenadeResult.explosions,
    };
}

export function grenadeDamageToEntity(explosion, entity) {
    const centerDistance = Math.hypot(entity.x - explosion.x, entity.y - explosion.y);
    if (centerDistance > grenadeStats.explosionRadius) return 0;
    const rawDamage = interpolate(centerDistance, 0, grenadeStats.explosionRadius, 50, 25);
    return clamp(Math.round(rawDamage / 5) * 5, 25, 50) * Number(explosion.damageMultiplier ?? 1);
}

export function overlapsEntity(first, second, padding = 0) {
    return Math.hypot(first.x - second.x, first.y - second.y) <= (Number(first.size ?? 60) + Number(second.size ?? 0)) / 2 + padding;
}

function tickGrenades(grenades, bots, world, combat) {
    const remaining = [];
    const explosions = [];
    for (const grenade of grenades) {
        if (grenade.type === "grenadeExplosion") {
            const remainingMs = Math.max(0, Number(grenade.remainingMs ?? 0) - world.stepMs);
            if (remainingMs > 0) remaining.push({ ...grenade, remainingMs });
            continue;
        }
        const next = advanceGrenade(grenade, world);
        const touchedBot = bots.some((bot) => isProjectileHittable(bot)
            && (bot.id !== next.ownerId || next.reflected) && overlapsEntity(bot, next));
        const stoppedLongEnough = Math.hypot(next.velocityX ?? 0, next.velocityY ?? 0) <= 0.001
            && Number(next.stoppedMs ?? 0) >= grenadeStats.fuseMs;
        if (touchedBot || stoppedLongEnough) explosions.push(createGrenadeExplosion(next));
        else remaining.push(next);
    }
    let nextBots = bots;
    for (const explosion of explosions) {
        for (let index = 0; index < nextBots.length; index += 1) {
            const bot = nextBots[index];
            if (ignoresHostileEffects(bot)) continue;
            const damage = grenadeDamageToEntity(explosion, bot);
            const blockCharges = grenadeBlockCharges(explosion, bot);
            if (damage <= 0 && blockCharges <= 0) continue;
            const shield = resolveShieldInteraction(bot, explosion, abilityContract(4).shieldInteraction, { chargeCost: blockCharges });
            if (shield.preventedEffects.has(EFFECT_TYPES.DAMAGE)) {
                nextBots[index] = shield.bot;
                continue;
            }
            if (damage > 0) nextBots = applyEntityDamage(nextBots, index, explosion, damage, combat);
        }
    }
    return { grenades: remaining, explosions, bots: nextBots };
}

function tickFireballs(fireballs, bots, world, combat) {
    const remaining = [];
    let nextBots = bots;
    for (const fireball of fireballs) {
        const next = {
            ...fireball,
            x: fireball.x + Number(fireball.velocityX ?? 0),
            y: fireball.y + Number(fireball.velocityY ?? 0),
            traveled: Number(fireball.traveled ?? 0) + Math.hypot(Number(fireball.velocityX ?? 0), Number(fireball.velocityY ?? 0)),
        };
        const hit = nextBots.find((bot) => isProjectileHittable(bot)
            && (bot.id !== next.ownerId || next.reflected) && overlapsEntity(bot, next));
        if (hit) {
            const damageMultiplier = Number(next.damageMultiplier ?? 1);
            const targetIndex = nextBots.findIndex((bot) => bot.id === hit.id);
            if (targetIndex >= 0 && !ignoresHostileEffects(nextBots[targetIndex])) {
                const bot = nextBots[targetIndex];
                const shield = resolveShieldInteraction(bot, next, abilityContract(5).shieldInteraction);
                if (shield.preventedEffects.has(EFFECT_TYPES.DAMAGE)) nextBots[targetIndex] = shield.bot;
                else {
                    nextBots = applyEntityDamage(nextBots, targetIndex, next, fireballStats.damage * damageMultiplier, combat);
                    const damaged = nextBots[targetIndex];
                    if (!ignoresHostileEffects(damaged)) nextBots[targetIndex] = {
                        ...damaged,
                        burnRemainingMs: fireballStats.burnDurationMs,
                        // Refreshing burn extends its lifetime without postponing an
                        // already-running damage tick.
                        burnTickMs: Number(bot.burnRemainingMs ?? 0) > 0
                            ? Math.max(0, Number(bot.burnTickMs ?? 0))
                            : fireballStats.burnTickMs,
                        burnDamageMultiplier: Math.max(Number(bot.burnDamageMultiplier ?? 1), damageMultiplier),
                        burnSourceSlot: sourceSlot(ownerBot(nextBots, next) ?? next),
                    };
                }
            }
        } else if (Number(next.traveled ?? 0) < fireballStats.range && insideArena(next, world)) {
            remaining.push(next);
        }
    }
    return { fireballs: remaining, bots: nextBots };
}

function applyEntityDamage(bots, targetIndex, entity, damage, combat) {
    const target = bots[targetIndex];
    const owner = ownerBot(bots, entity);
    const ownerIndex = owner ? bots.findIndex((bot) => bot.id === owner.id) : -1;
    if (ownerIndex >= 0 && ownerIndex !== targetIndex && typeof combat.applyDamageFromShapes === "function") {
        const nextBots = [...bots];
        [nextBots[ownerIndex], nextBots[targetIndex]] = combat.applyDamageFromShapes(owner, target, damage);
        return nextBots;
    }
    return bots.map((bot, index) => index === targetIndex
        ? combat.applyDamageToShape(bot, damage, owner ?? entity)
        : bot);
}

function ownerBot(bots, entity) {
    return bots.find((bot) => bot.id === entity?.ownerId
        || (Number.isFinite(Number(entity?.ownerSlot)) && Number(bot.slot) === Number(entity.ownerSlot)));
}

function sourceSlot(source) {
    const slot = Number(source?.slot ?? source?.ownerSlot);
    return Number.isFinite(slot) ? slot : null;
}

function advanceGrenade(grenade, world) {
    const intendedX = grenade.x + Number(grenade.velocityX ?? 0);
    const intendedY = grenade.y + Number(grenade.velocityY ?? 0);
    const next = {
        ...grenade,
        x: clamp(intendedX, grenadeStats.size / 2, world.width - grenadeStats.size / 2),
        y: clamp(intendedY, grenadeStats.size / 2, world.height - grenadeStats.size / 2),
    };
    if (next.x !== intendedX || next.y !== intendedY) {
        next.velocityX = 0;
        next.velocityY = 0;
    } else {
        const speed = Math.hypot(Number(next.velocityX ?? 0), Number(next.velocityY ?? 0));
        const nextSpeed = Math.max(0, speed - grenadeStats.decelerationPerTick);
        next.velocityX = speed > 0 ? next.velocityX / speed * nextSpeed : 0;
        next.velocityY = speed > 0 ? next.velocityY / speed * nextSpeed : 0;
    }
    next.stoppedMs = Math.hypot(next.velocityX, next.velocityY) <= 0.001 ? Number(next.stoppedMs ?? 0) + world.stepMs : 0;
    return next;
}

function createGrenadeExplosion(grenade) {
    return { ...grenade, id: `${grenade.id}-explosion`, type: "grenadeExplosion", size: grenadeStats.explosionRadius * 2, velocityX: 0, velocityY: 0, remainingMs: 200 };
}

function insideArena(entity, world) {
    return entity.x >= -entity.size && entity.x <= world.width + entity.size
        && entity.y >= -entity.size && entity.y <= world.height + entity.size;
}

function interpolate(value, min, max, near, far) {
    const t = clamp((value - min) / (max - min), 0, 1);
    return near + (far - near) * t;
}

function grenadeBlockCharges(explosion, bot) {
    const distance = Math.hypot(bot.x - explosion.x, bot.y - explosion.y);
    if (distance > grenadeStats.explosionRadius) return 0;
    return clamp(Math.round(interpolate(distance, 0, grenadeStats.explosionRadius, 5, 1)), 1, grenadeStats.maxCharges ?? 5);
}
