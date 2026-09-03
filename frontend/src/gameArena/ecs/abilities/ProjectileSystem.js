import { ABILITY_STATS } from "../../gameconfig/Abilities.js";
import { abilityContract, EFFECT_TYPES } from "../../gameconfig/AbilityContracts.js";
import { applyDebuff, damageAtDistance } from "./AbilityEffectSystem.js";
import { clamp } from "../../gameconfig/geometry.js";
import { movingEntityCollision } from "../../gameconfig/hitboxGeometry.js";
import { ignoresHostileEffects, isProjectileHittable } from "../../gameconfig/DefensiveState.js";
import { applyEntityDamage } from "../entities/EntityCombat.js";
import { ENTITY_SYSTEM_TYPES, entityContract } from "../contracts/EntityContracts.js";
import { advanceEntityAge, withComponentState } from "../entities/EntityWorld.js";

/** Advances every entity assigned to the projectile system. */
export function tickProjectileWorld(world, combat) {
    const sourceEntities = world.entities;
    let bots = world.bots;
    const entities = [];
    const spawnedEntities = [];

    for (const entity of sourceEntities) {
        const contract = entityContract(entity.entityContractId ?? entity.abilityId ?? entity.entityContractType ?? entity.type);
        if (!contract || contract.system !== ENTITY_SYSTEM_TYPES.PROJECTILE) {
            entities.push(entity);
            continue;
        }

        const next = advanceProjectile(entity, contract, world);
        const hit = findMovingColliderHit(entity, next, bots, world);
        const targetIndex = hit?.index ?? -1;
        const timedExplosion = contract.projectile?.hit === "explode"
            && Number(next.stoppedMs ?? 0) >= Number((ABILITY_STATS[contract.abilityId] ?? {}).fuseMs ?? Number.POSITIVE_INFINITY);
        if (targetIndex >= 0 || timedExplosion) {
            if (contract.projectile?.hit === "explode") {
                if (hit) {
                    // A projectile contact is the grenade's direct/on-hit
                    // phase. Its hitbox has already established contact, so
                    // use zero distance for the configured maximum damage.
                    bots = applyProjectileEffects(next, targetIndex, bots, combat, contract, 0);
                }
                // Contact damage is applied above; a fuse-only explosion still
                // goes through the normal radial center-distance falloff.
                spawnedEntities.push(createExplosionEntity(next, contract, { damageApplied: Boolean(hit) }));
            } else {
                bots = applyProjectileEffects(next, targetIndex, bots, combat, contract, hit?.distance);
            }
        } else if (shouldKeepProjectile(next, contract, world)) {
            entities.push(next);
        }
    }

    return {
        bots,
        entities,
        spawnedEntities,
        grenadeExplosions: spawnedEntities.filter(({ type }) => type === "grenadeExplosion"),
    };
}

export function overlapsEntity(first, second, padding = 0) {
    const firstPath = entityMovementSegment(first);
    const secondPath = entityMovementSegment(second);
    return movingEntityCollision(
        first,
        firstPath.start,
        firstPath.end,
        second,
        secondPath.start,
        secondPath.end,
        padding,
    ).hit;
}

function findMovingColliderHit(previous, projectile, bots, world) {
    const projectileStart = { x: Number(previous.x), y: Number(previous.y) };
    const projectileEnd = { x: Number(projectile.x), y: Number(projectile.y) };
    for (let index = 0; index < bots.length; index += 1) {
        const bot = bots[index];
        if (!isProjectileHittable(bot) || !isEnemyProjectileTarget(projectile, bot, bots)) continue;
        const botPath = botMovementSegment(bot, world.stepMs);
        const collision = movingEntityCollision(
            projectile,
            projectileStart,
            projectileEnd,
            bot,
            botPath.start,
            botPath.end,
        );
        if (collision.hit) return { index, ...collision };
    }
    return null;
}

function isEnemyProjectileTarget(projectile, target, bots) {
    const owner = bots.find((bot) => bot?.id === projectile.ownerId
        || (Number.isFinite(Number(projectile.ownerSlot)) && Number(bot?.slot) === Number(projectile.ownerSlot)));
    const ownerTeam = Number(owner?.teamNumber ?? projectile.ownerTeam);
    const targetTeam = Number(target?.teamNumber);
    if (Number.isFinite(ownerTeam) && Number.isFinite(targetTeam)
        && ownerTeam > 0 && targetTeam > 0) return ownerTeam !== targetTeam;
    return target.id !== projectile.ownerId || Boolean(projectile.reflected);
}

function botMovementSegment(bot, stepMs) {
    const seconds = Math.max(Number(stepMs ?? 0) / 1000, 0);
    const startX = Number.isFinite(Number(bot.movementStartX))
        ? Number(bot.movementStartX)
        : Number(bot.x) - Number(bot.velocityX ?? 0) * seconds;
    const startY = Number.isFinite(Number(bot.movementStartY))
        ? Number(bot.movementStartY)
        : Number(bot.y) - Number(bot.velocityY ?? 0) * seconds;
    return {
        start: { x: startX, y: startY },
        end: { x: Number(bot.x), y: Number(bot.y) },
    };
}

function entityMovementSegment(entity) {
    const startX = Number.isFinite(Number(entity.movementStartX))
        ? Number(entity.movementStartX)
        : Number(entity.x) - Number(entity.velocityX ?? 0);
    const startY = Number.isFinite(Number(entity.movementStartY))
        ? Number(entity.movementStartY)
        : Number(entity.y) - Number(entity.velocityY ?? 0);
    return {
        start: { x: startX, y: startY },
        end: { x: Number(entity.x), y: Number(entity.y) },
    };
}

function advanceProjectile(entity, contract, world) {
    const stats = ABILITY_STATS[contract.abilityId] ?? {};
    const intendedX = Number(entity.x) + Number(entity.velocityX ?? 0);
    const intendedY = Number(entity.y) + Number(entity.velocityY ?? 0);
    const next = withComponentState(advanceEntityAge(entity, world.stepMs), {
        movementStartX: Number(entity.x),
        movementStartY: Number(entity.y),
        x: intendedX,
        y: intendedY,
        traveled: Number(entity.traveled ?? 0) + Math.hypot(Number(entity.velocityX ?? 0), Number(entity.velocityY ?? 0)),
    });

    if (contract.projectile?.hit !== "explode") return next;

    next.x = clamp(intendedX, Number(entity.size ?? 0) / 2, world.width - Number(entity.size ?? 0) / 2);
    next.y = clamp(intendedY, Number(entity.size ?? 0) / 2, world.height - Number(entity.size ?? 0) / 2);
    if (next.x !== intendedX || next.y !== intendedY) {
        next.velocityX = 0;
        next.velocityY = 0;
    } else {
        const speed = Math.hypot(Number(next.velocityX ?? 0), Number(next.velocityY ?? 0));
        const nextSpeed = Math.max(0, speed - Number(stats.decelerationPerTick ?? 0));
        next.velocityX = speed > 0 ? next.velocityX / speed * nextSpeed : 0;
        next.velocityY = speed > 0 ? next.velocityY / speed * nextSpeed : 0;
    }
    next.stoppedMs = Math.hypot(next.velocityX, next.velocityY) <= 0.001
        ? Number(next.stoppedMs ?? 0) + Number(world.stepMs ?? 0)
        : 0;
    return next;
}

function shouldKeepProjectile(entity, contract, world) {
    if (contract.projectile?.hit === "explode") {
        const stats = ABILITY_STATS[contract.abilityId] ?? {};
        return Number(entity.stoppedMs ?? 0) < Number(stats.fuseMs ?? Number.POSITIVE_INFINITY);
    }
    const stats = ABILITY_STATS[contract.abilityId] ?? {};
    const lifetimeStat = contract.lifetime?.durationStat ?? "durationMs";
    return Number(entity.ageMs ?? 0) < Number(stats[lifetimeStat] ?? Number.POSITIVE_INFINITY)
        && insideArena(entity, world);
}

function applyProjectileEffects(entity, targetIndex, bots, combat, contract, collisionDistance = undefined) {
    if (ignoresHostileEffects(bots[targetIndex])) return bots;
    const ability = abilityContract(contract.abilityId);
    let nextBots = [...bots];

    for (const effect of ability?.effects ?? []) {
        if (effect.type === EFFECT_TYPES.DAMAGE) {
            const distance = Number.isFinite(Number(collisionDistance))
                ? Number(collisionDistance)
                : Math.hypot(entity.x - nextBots[targetIndex].x, entity.y - nextBots[targetIndex].y);
            const baseDamage = effect.amount ?? damageAtDistance(contract.abilityId, distance);
            nextBots = applyEntityDamage(
                nextBots,
                targetIndex,
                entity,
                Number(baseDamage) * Number(entity.damageMultiplier ?? 1),
                combat,
            );
        } else if (effect.type === EFFECT_TYPES.DEBUFF) {
            nextBots[targetIndex] = applyDebuff(
                nextBots[targetIndex],
                effect,
                ABILITY_STATS[contract.abilityId] ?? {},
                entity,
                contract.abilityId,
            );
        }
    }
    return nextBots;
}

function createExplosionEntity(projectile, contract, { damageApplied = false } = {}) {
    const stats = ABILITY_STATS[contract.abilityId] ?? {};
    const definition = contract.projectile.explosion;
    const size = Number(stats[definition.sizeStat] ?? projectile.size ?? 0) * 2;
    return withComponentState(projectile, {
        id: `${projectile.id}-explosion`,
        type: definition.type,
        entityBehaviorKey: definition.behaviorKey,
        entityCategory: definition.category,
        category: definition.category,
        entitySystem: definition.system,
        size,
        velocityX: 0,
        velocityY: 0,
        ageMs: 0,
        remainingMs: Number(stats[definition.remainingStat] ?? definition.durationMs ?? 0),
        damageApplied,
    });
}

function insideArena(entity, world) {
    return entity.x >= -entity.size && entity.x <= world.width + entity.size
        && entity.y >= -entity.size && entity.y <= world.height + entity.size;
}
