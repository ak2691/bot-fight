import { ABILITY_STATS } from "../gameconfig/Abilities.js";
import { angleDelta, clamp, normalizeAngle, rayIntersectsCircle, segmentIntersectsCircle } from "../gameconfig/geometry.js";
import { runEntityWorld, withComponentState } from "./EntityWorld.js";
import { abilityContract, EFFECT_TYPES } from "../gameconfig/AbilityContracts.js";
import { resolveShieldInteraction } from "../gameconfig/ShieldSystem.js";
import { ignoresHostileEffects } from "../gameconfig/DefensiveState.js";
import { vectorToCompassDegrees } from "../botlogic/planner/arenaAngles.js";

const ENTITY_TYPES = new Set([
    "proximityMine", "mineExplosion", "orbitalMarker", "orbitalExplosion",
    "gravityField", "gravityExplosion", "nullZone", "hunterDrone", "silenceWave", "temporalRewindZone", "windburstProjectile",
]);

export function isAbilityEntity(entity) {
    return ENTITY_TYPES.has(entity?.type);
}

/**
 * Advances persistent ability entities through deterministic ordered systems.
 * Combat math is injected so this system does not own bot rules.
 */
export function tickAbilityEntityWorld(world, combat) {
    return runEntityWorld({
        ...world,
        bots: world.bots.map((bot) => ({ ...bot, nullZoneSilenced: false })),
    }, [
        markMinesHitByAttacks(combat),
        tickMines(combat),
        tickNonMineEntities(combat),
    ]);
}

function markMinesHitByAttacks(combat) {
    return (world) => ({
        entities: world.entities.map((entity) => entity.type === "proximityMine"
            && mineHitByCurrentAttack(entity, world, combat)
            ? withComponentState(entity, { hitTriggered: true })
            : entity),
    });
}

function tickMines(combat) {
    return (world) => {
        let bots = world.bots.map((bot) => ({ ...bot }));
        const stats = ABILITY_STATS[11];
        const mineRadius = Number(stats.radius ?? 87.5);
        const mineSize = Number(stats.size ?? 24);
        const mines = world.entities.filter((entity) => entity.type === "proximityMine").map((mine) => {
            const traveled = Number(mine.traveled ?? 0);
            const moving = traveled < Number(stats.travelDistance ?? 176);
            return moving
                ? withComponentState(mine, {
                    x: clamp(mine.x + mine.velocityX, mineSize / 2, world.width - mineSize / 2),
                    y: clamp(mine.y + mine.velocityY, mineSize / 2, world.height - mineSize / 2),
                    traveled: traveled + Math.hypot(mine.velocityX, mine.velocityY),
                    ageMs: Number(mine.ageMs ?? 0) + world.stepMs,
                    armed: false,
                })
                : withComponentState(mine, {
                    velocityX: 0,
                    velocityY: 0,
                    ageMs: Number(mine.ageMs ?? 0) + world.stepMs,
                    armed: true,
                });
        });
        const triggered = new Set(mines.filter((mine) => (
            Number(mine.ageMs) >= Number(stats.lifetimeMs ?? 20_000)
            || mine.hitTriggered
            || (mine.armed && bots.some((bot) => bot.slot !== mine.ownerSlot
                && Math.hypot(bot.x - mine.x, bot.y - mine.y) <= mineRadius))
        )).map((mine) => mine.id));
        let changed = true;
        while (changed) {
            changed = false;
            for (const source of mines.filter((mine) => triggered.has(mine.id))) {
                for (const target of mines) {
                    if (!triggered.has(target.id) && Math.hypot(target.x - source.x, target.y - source.y) <= mineRadius) {
                        triggered.add(target.id);
                        changed = true;
                    }
                }
            }
        }
        const entities = world.entities.filter((entity) => entity.type !== "proximityMine");
        for (const mine of mines) {
            if (!triggered.has(mine.id)) {
                entities.push(mine);
                continue;
            }
            for (let index = 0; index < bots.length; index += 1) {
                const bot = bots[index];
                if (Math.hypot(bot.x - mine.x, bot.y - mine.y) > mineRadius) continue;
                if (ignoresHostileEffects(bot)) continue;
                const shield = resolveEntityShield(bot, mine, 11);
                if (shield.preventedEffects.has(EFFECT_TYPES.DAMAGE)) bots[index] = shield.bot;
                else bots = applyEntityDamage(bots, index, mine, Number(stats.damage ?? 18), combat);
            }
            entities.push(withComponentState(mine, { id: `${mine.id}-blast`, type: "mineExplosion", size: mineRadius * 2, visibleMs: Number(stats.explosionVisibleMs ?? 300), spawnedThisTick: true }));
        }
        return { entities, bots };
    };
}

function tickNonMineEntities(combat) {
    return (world) => {
        let bots = world.bots;
        const entities = [];
        for (const entity of world.entities) {
            if (entity.spawnedThisTick) {
                const readyNextTick = { ...entity };
                delete readyNextTick.spawnedThisTick;
                entities.push(readyNextTick);
                continue;
            }
            if (entity.type === "proximityMine") {
                entities.push(entity);
                continue;
            }
            const result = tickEntity(entity, { ...world, bots }, combat);
            bots = result.bots;
            if (result.entity) entities.push(result.entity);
        }
        return { entities, bots };
    };
}

function tickEntity(entity, world, combat) {
    if (entity.type === "silenceWave") return tickSilenceWave(entity, world);
    if (entity.type === "windburstProjectile") return tickWindburstProjectile(entity, world, combat);
    if (entity.type === "gravityField" || entity.type === "nullZone") return tickField(entity, world, combat);
    if (entity.type === "hunterDrone") return tickHunterDrone(entity, world, combat);
    if (entity.type === "orbitalMarker") return tickOrbitalMarker(entity, world, combat);
    if (entity.type === "temporalRewindZone") {
        const remainingMs = Number(entity.remainingMs ?? ABILITY_STATS[21].zoneLifetimeMs ?? 3100) - world.stepMs;
        return { bots: world.bots, entity: remainingMs > 0 ? withComponentState(entity, { remainingMs }) : null };
    }
    if (["mineExplosion", "orbitalExplosion", "gravityExplosion"].includes(entity.type)) {
        const visibleMs = Number(entity.visibleMs ?? 0) - world.stepMs;
        return { bots: world.bots, entity: visibleMs > 0 ? withComponentState(entity, { visibleMs }) : null };
    }
    return { bots: world.bots, entity };
}

function tickWindburstProjectile(entity, world, combat) {
    const stats = ABILITY_STATS[18] ?? {};
    const speed = Math.max(0, Number(stats.speedPerTick ?? 44));
    const maxRange = Math.max(0, Number(stats.range ?? 220));
    const stepScale = Math.max(0, Number(world.stepMs ?? 100)) / 100;
    const stepDistance = Math.min(Math.max(0, maxRange - Number(entity.traveled ?? 0)), speed * stepScale);
    const start = { x: Number(entity.x), y: Number(entity.y) };
    const rawEnd = {
        x: start.x + Number(entity.velocityX ?? 0) * stepScale,
        y: start.y + Number(entity.velocityY ?? 0) * stepScale,
    };
    const end = {
        x: clamp(rawEnd.x, 0, world.width),
        y: clamp(rawEnd.y, 0, world.height),
    };
    const target = world.bots
        .filter((bot) => bot.slot !== entity.ownerSlot && Number(bot.hp ?? 100) > 0 && !ignoresHostileEffects(bot))
        .filter((bot) => segmentIntersectsCircle(start, end, { ...bot, size: Number(bot.size ?? 60) + Number(entity.size ?? 24) }))
        .sort((first, second) => Math.hypot(first.x - start.x, first.y - start.y) - Math.hypot(second.x - start.x, second.y - start.y))[0];
    if (target) {
        let bots = [...world.bots];
        const targetIndex = bots.findIndex((bot) => bot.id === target.id);
        const ownerIndex = bots.findIndex((bot) => bot.slot === entity.ownerSlot);
        const shield = resolveEntityShield(target, entity, 18);
        bots[targetIndex] = shield.bot;
        if (!shield.preventedEffects.has(EFFECT_TYPES.DAMAGE)) {
            const damage = Number(stats.damage ?? 15) * Number(entity.damageMultiplier ?? 1);
            if (ownerIndex >= 0 && ownerIndex !== targetIndex && typeof combat.applyDamageFromShapes === "function") {
                const [owner, damagedTarget] = combat.applyDamageFromShapes(bots[ownerIndex], bots[targetIndex], damage);
                bots[ownerIndex] = owner;
                bots[targetIndex] = damagedTarget;
            } else {
                bots[targetIndex] = combat.applyDamageToShape(bots[targetIndex], damage, entity);
            }
        }
        if (!shield.preventedEffects.has(EFFECT_TYPES.KNOCKBACK)) {
            const currentTarget = bots[targetIndex];
            const velocityLength = Math.max(0.001, Math.hypot(Number(entity.velocityX ?? 0), Number(entity.velocityY ?? 0)));
            const knockback = Number(stats.knockback);
            bots[targetIndex] = {
                ...currentTarget,
                x: clamp(currentTarget.x + Number(entity.velocityX ?? 0) / velocityLength * knockback, currentTarget.size / 2, world.width - currentTarget.size / 2),
                y: clamp(currentTarget.y + Number(entity.velocityY ?? 0) / velocityLength * knockback, currentTarget.size / 2, world.height - currentTarget.size / 2),
            };
        }
        return { bots, entity: null };
    }
    const traveled = Number(entity.traveled ?? 0) + stepDistance;
    const remainingMs = Number(entity.remainingMs ?? 500) - Number(world.stepMs ?? 100);
    const atEdge = end.x <= 0 || end.x >= world.width || end.y <= 0 || end.y >= world.height;
    if (stepDistance <= 0 || traveled >= maxRange || remainingMs <= 0 || atEdge) return { bots: world.bots, entity: null };
    return {
        bots: world.bots,
        entity: withComponentState(entity, { x: end.x, y: end.y, traveled, remainingMs }),
    };
}

function tickSilenceWave(entity, world) {
    const stats = ABILITY_STATS[15];
    const start = { x: entity.x, y: entity.y };
    const end = {
        x: clamp(entity.x + entity.velocityX, 0, world.width),
        y: clamp(entity.y + entity.velocityY, 0, world.height),
    };
    const remainingMs = Number(entity.remainingMs ?? stats.projectileLifetimeMs ?? 1200) - world.stepMs;
    const hitSlots = [...(entity.hitSlots ?? [])];
    let blocked = false;
    const bots = world.bots.map((bot) => {
        if (bot.slot === entity.ownerSlot || hitSlots.includes(bot.slot)
            || !segmentIntersectsCircle(start, end, { ...bot, size: bot.size + entity.size })) return bot;
        if (ignoresHostileEffects(bot)) return bot;
        hitSlots.push(bot.slot);
        const shield = resolveEntityShield(bot, entity, 15);
        if (shield.preventedEffects.has(EFFECT_TYPES.DEBUFF)) {
            blocked = true;
            return shield.bot;
        }
        return { ...bot, silencedMs: Number(stats.durationMs ?? 2000), stunnedMs: Math.max(Number(bot.stunnedMs ?? 0), Number(stats.stunDurationMs ?? 100)), preparingAbility: null, preparingMs: 0 };
    });
    const hitEdge = end.x === 0 || end.x === world.width || end.y === 0 || end.y === world.height;
    return {
        bots,
        entity: remainingMs > 0 && !hitEdge && !blocked ? withComponentState(entity, { ...end, remainingMs, hitSlots }) : null,
    };
}

function tickField(entity, world, combat) {
    const stats = entity.type === "gravityField" ? ABILITY_STATS[14] : ABILITY_STATS[24];
    const traveled = Number(entity.traveled ?? 0);
    const moving = traveled < Number(stats.travelDistance ?? 0);
    const ageMs = Number(entity.ageMs ?? 0) + world.stepMs;
    const fuseMs = entity.type === "gravityField" && !moving
        ? Math.max(0, Number(entity.fuseMs ?? stats.fuseMs ?? 3000) - world.stepMs)
        : Number(entity.fuseMs ?? 0);
    const active = !moving && (entity.type !== "gravityField" || fuseMs <= 0);
    const remainingMs = Number(entity.remainingMs ?? stats.durationMs ?? 5000) - (active ? world.stepMs : 0);
    const field = moving
        ? withComponentState(entity, {
            x: clamp(entity.x + entity.velocityX, entity.size / 2, world.width - entity.size / 2),
            y: clamp(entity.y + entity.velocityY, entity.size / 2, world.height - entity.size / 2),
            traveled: traveled + Math.hypot(entity.velocityX, entity.velocityY), ageMs, armed: false,
        })
        : withComponentState(entity, { velocityX: 0, velocityY: 0, ageMs, fuseMs, remainingMs, armed: active });
    if (remainingMs <= 0) return { bots: world.bots, entity: null };
    let bots = world.bots;
    if (!moving && entity.type === "gravityField" && fuseMs > 0) {
        bots = bots.map((bot) => {
            const dx = field.x - bot.x;
            const dy = field.y - bot.y;
            const distance = Math.hypot(dx, dy);
            if (distance <= 0.001 || distance > field.size / 2) return bot;
            if (ignoresHostileEffects(bot)) return bot;
            return {
                ...bot,
                x: clamp(bot.x + dx / distance * Number(stats.pullPerTick ?? 6), bot.size / 2, world.width - bot.size / 2),
                y: clamp(bot.y + dy / distance * Number(stats.pullPerTick ?? 6), bot.size / 2, world.height - bot.size / 2),
            };
        });
        return { bots, entity: field };
    }
    if (active) {
        for (let index = 0; index < bots.length; index += 1) {
            const bot = bots[index];
            const dx = field.x - bot.x;
            const dy = field.y - bot.y;
            const distance = Math.hypot(dx, dy);
            if (distance > field.size / 2) continue;
            if (ignoresHostileEffects(bot)) continue;
            if (entity.type === "nullZone") {
                bots[index] = { ...bot, nullZoneSilenced: true };
                continue;
            }
            const band = Math.min(3, Math.floor(distance / Math.max(1, Number(stats.radius) / 4)));
            const damage = Number(stats.maxDamage) - band * Number(stats.damageStep);
            if (field.damageApplied) continue;
            const shield = resolveEntityShield(bot, field, 14);
            if (shield.preventedEffects.has(EFFECT_TYPES.DAMAGE)) bots[index] = shield.bot;
            else bots = applyEntityDamage(bots, index, field, damage, combat);
        }
    }
    return {
        bots,
        entity: entity.type === "gravityField" && active
            ? withComponentState(field, { id: `${field.id}-blast`, type: "gravityExplosion", visibleMs: Number(stats.explosionVisibleMs ?? 300), armed: true })
            : field,
    };
}

function tickHunterDrone(entity, world, combat) {
    const stats = ABILITY_STATS[17];
    const remainingMs = Number(entity.remainingMs ?? stats.durationMs ?? 6000) - world.stepMs;
    if (remainingMs <= 0) return { bots: world.bots, entity: null };
    const hp = Number(entity.hp ?? stats.hp ?? 50) - damageToDroneThisTick(entity, world, combat);
    if (hp <= 0) return { bots: world.bots, entity: null };
    let bots = world.bots;
        const target = bots.filter((bot) => bot.slot !== entity.ownerSlot && Number(bot.hp ?? 0) > 0)
        .sort((a, b) => Math.hypot(a.x - entity.x, a.y - entity.y) - Math.hypot(b.x - entity.x, b.y - entity.y))[0];
    let drone = withComponentState(entity, {
        hp, remainingMs, ageMs: Number(entity.ageMs ?? 0) + world.stepMs,
        shotCooldownMs: Math.max(0, Number(entity.shotCooldownMs ?? 0) - world.stepMs),
    });
    if (target) {
        const dx = target.x - drone.x;
        const dy = target.y - drone.y;
        const distance = Math.max(1, Math.hypot(dx, dy));
        const desiredRotation = vectorToCompassDegrees(dx, dy);
        const rotation = normalizeAngle(Number(drone.rotation ?? 0) + clamp(angleDelta(Number(drone.rotation ?? 0), desiredRotation), -Number(stats.turnStepDegrees ?? 8), Number(stats.turnStepDegrees ?? 8)));
        drone = withComponentState(drone, {
            x: clamp(drone.x + dx / distance * Math.min(Number(stats.moveSpeed ?? 4.5), distance), Number(stats.size ?? 28) / 2, world.width - Number(stats.size ?? 28) / 2),
            y: clamp(drone.y + dy / distance * Math.min(Number(stats.moveSpeed ?? 4.5), distance), Number(stats.size ?? 28) / 2, world.height - Number(stats.size ?? 28) / 2),
            rotation,
        });
        const shotRange = Number(ABILITY_STATS[17].range ?? 200);
        if (drone.shotCooldownMs <= 0 && rayIntersectsCircle(drone, rotation, shotRange, target)) {
            const ownerIndex = bots.findIndex((bot) => bot.slot === entity.ownerSlot);
            const targetIndex = bots.findIndex((bot) => bot.id === target.id);
            bots = [...bots];
            const shield = targetIndex >= 0 && !ignoresHostileEffects(bots[targetIndex]) ? resolveEntityShield(bots[targetIndex], drone, 17) : { preventedEffects: new Set([EFFECT_TYPES.DAMAGE]) };
            if (shield.preventedEffects.has(EFFECT_TYPES.DAMAGE)) bots[targetIndex] = shield.bot;
            else if (targetIndex >= 0 && ownerIndex >= 0) [bots[ownerIndex], bots[targetIndex]] = combat.applyDamageFromShapes(bots[ownerIndex], bots[targetIndex], 3);
            else if (targetIndex >= 0) bots[targetIndex] = combat.applyDamageToShape(bots[targetIndex], Number(stats.damage ?? 3), entity);
            drone = withComponentState(drone, {
                shotCooldownMs: Number(stats.shotCooldownMs ?? 1000),
                shotVisualMs: Number(stats.shotVisualMs ?? 300),
            });
        }
    }
    drone = withComponentState(drone, { shotVisualMs: Math.max(0, Number(drone.shotVisualMs ?? 0) - world.stepMs) });
    return { bots, entity: drone };
}

function tickOrbitalMarker(entity, world, combat) {
    const stats = ABILITY_STATS[22];
    const fuseMs = Number(entity.fuseMs ?? stats.delayMs ?? 1500) - world.stepMs;
    if (fuseMs > 0) return { bots: world.bots, entity: withComponentState(entity, { fuseMs }) };
    let bots = world.bots;
    for (let index = 0; index < bots.length; index += 1) {
        const bot = bots[index];
        const distance = Math.hypot(bot.x - entity.x, bot.y - entity.y);
        if (distance > Number(stats.radius ?? 130) || ignoresHostileEffects(bot)) continue;
        const shield = resolveEntityShield(bot, entity, 22);
        bots[index] = shield.bot;
        if (!shield.preventedEffects.has(EFFECT_TYPES.DAMAGE)) bots = applyEntityDamage(bots, index, entity, Number(stats.damage ?? 50) * Math.max(0.25, 1 - distance / Number(stats.radius ?? 130)), combat);
    }
    return {
        bots,
        entity: withComponentState(entity, { id: `${entity.id}-blast`, type: "orbitalExplosion", size: Number(stats.markerSize ?? 260), visibleMs: Number(stats.explosionVisibleMs ?? 400) }),
    };
}

function applyEntityDamage(bots, targetIndex, entity, damage, combat) {
    const target = bots[targetIndex];
    const owner = bots.find((bot) => bot.id === entity?.ownerId
        || (Number.isFinite(Number(entity?.ownerSlot)) && Number(bot.slot) === Number(entity.ownerSlot)));
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

function resolveEntityShield(bot, source, abilityId) {
    return resolveShieldInteraction(bot, source, abilityContract(abilityId)?.shieldInteraction);
}

function mineHitByCurrentAttack(mine, world, combat) {
    const { bots, grenades = [], fireballs = [], entities } = world;
    if (bots.some((bot) => (bot.entityHitIds ?? []).includes(mine.id))) return true;
    if ([...grenades, ...fireballs].some((entity) => Math.hypot(entity.x - mine.x, entity.y - mine.y) <= (Number(entity.size ?? 12) + mine.size) / 2)) return true;
    if (entities.some((entity) => entity.id !== mine.id && ["silenceWave", "windburstProjectile"].includes(entity.type)
        && Math.hypot(entity.x - mine.x, entity.y - mine.y) <= (Number(entity.size ?? 0) + mine.size) / 2)) return true;
    return bots.some((bot) => combat.abilityHitsTarget(bot, mine));
}

function damageToDroneThisTick(drone, world, combat) {
    let damage = 0;
    for (const bot of world.bots) {
        damage += combat.triggeredAbilityDamage(bot, drone);
    }
    for (const fireball of world.fireballs ?? []) if (fireball.type === "fireball" && combat.overlapsShape(fireball, drone)) damage += ABILITY_STATS[5].damage * Number(fireball.damageMultiplier ?? 1);
    for (const grenade of world.grenades ?? []) if (grenade.type === "grenadeExplosion") damage += combat.grenadeDamageToBot(grenade, drone);
    for (const effect of world.entities.filter((candidate) => !candidate.spawnedThisTick)) {
        const distance = Math.hypot(effect.x - drone.x, effect.y - drone.y);
        if (effect.type === "mineExplosion" && distance <= effect.size / 2) damage += Number(ABILITY_STATS[11].damage ?? 18);
        if (effect.type === "gravityExplosion" && distance <= effect.size / 2) damage += Number(ABILITY_STATS[14].maxDamage ?? 35);
        if (effect.type === "orbitalExplosion" && distance <= effect.size / 2) damage += Number(ABILITY_STATS[22].damage ?? 50) * Math.max(0.25, 1 - distance / Number(ABILITY_STATS[22].radius ?? 130));
    }
    return damage;
}
