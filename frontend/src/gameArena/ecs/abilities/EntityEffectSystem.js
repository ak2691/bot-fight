import {
    EFFECT_TYPES,
    effectTargetsTarget,
    resolveEffectOverride,
    TARGET_KINDS,
} from "../contracts/AbilityContracts.js";
import { amountAtDistance, applyStatusEffect, durationAtDistance, ENEMY_HIT_EFFECT_TYPES } from "./AbilityEffectSystem.js";
import { recordAbilityHit } from "../../gameconfig/AbilityHitRecord.js";
import { clamp } from "../../gameconfig/geometry.js";
import { ignoresHostileEffects, isAliveBot } from "../../gameconfig/DefensiveState.js";
import { applyEntityDamage, ownerBot } from "../entities/EntityCombat.js";
import { upsertStatusEffect } from "../contracts/StatusContracts.js";
import { interruptCurrentAbility } from "../../gameconfig/AbilityResourceSystem.js";
import { ARENA_HEIGHT_UNITS, ARENA_WIDTH_UNITS } from "../../modelPayloads/arenaConstants.js";

/** Applies the allowlisted effects declared by an entity's ability contract. */
export function applyEntityEffects(bots, targetIndex, source, abilityId, combat, {
    effectTypes = null,
    statusTypes = null,
    world = null,
    knockbackDirection = "source",
    pullDirection = "source",
    collisionDistance = undefined,
    effectOverrides = null,
    statOverrides = null,
    effects = null,
} = {}) {
    const target = bots[targetIndex];
    if (!target || ignoresHostileEffects(target)) return { bots };
    let nextBots = [...bots];
    const allowed = effectTypes ? new Set(effectTypes) : null;
    let landedOnEnemy = false;

    for (const effect of effects ?? []) {
        if (!effectTargetsTarget(effect, [TARGET_KINDS.BOT])) continue;
        if (allowed && !allowed.has(effect.type)) continue;
        if (effect.type === EFFECT_TYPES.STATUS
            && Array.isArray(statusTypes)
            && statusTypes.length > 0
            && !statusTypes.some((statusType) =>
                String(statusType).toLowerCase() === String(effect.subtype ?? "").toLowerCase())) continue;
        const resolvedEffect = resolveEffectOverride(effect, effectOverrides);
        if (ENEMY_HIT_EFFECT_TYPES.has(resolvedEffect.type) && isAliveBot(nextBots[targetIndex])) landedOnEnemy = true;
        const distance =Number.isFinite(Number(collisionDistance))
            ? Number(collisionDistance)
            : Math.hypot(Number(source.x) - Number(nextBots[targetIndex].x), Number(source.y) - Number(nextBots[targetIndex].y));
        if (resolvedEffect.type === EFFECT_TYPES.DAMAGE) {
            const baseDamage = amountAtDistance(abilityId, distance, resolvedEffect, statOverrides);
            nextBots = applyEntityDamage(nextBots, targetIndex, source, Number(baseDamage) * Number(source.damageMultiplier ?? 1), combat);
        } else if (resolvedEffect.type === EFFECT_TYPES.STATUS) {
            const durationMs = durationAtDistance(abilityId, distance, resolvedEffect, statOverrides);
            nextBots[targetIndex] = applyStatusEffect(nextBots[targetIndex], {
                ...resolvedEffect,
                durationMs,
            }, statOverrides ?? {}, source, abilityId);
        } else if (resolvedEffect.type === EFFECT_TYPES.INTERRUPT) {
            if (!isAliveBot(nextBots[targetIndex])) continue;
            nextBots[targetIndex] = upsertStatusEffect({
                ...interruptCurrentAbility(nextBots[targetIndex]),
                movementVelocityX: 0,
                movementVelocityY: 0,
                velocityX: 0,
                velocityY: 0,
            }, {
                type: "stun",
                abilityId,
                remainingMs: durationAtDistance(abilityId, distance, resolvedEffect, statOverrides),
                effects: [{ type: "stun", mode: "constant" }],
            });
        } else if (resolvedEffect.type === EFFECT_TYPES.KNOCKBACK) {
            nextBots[targetIndex] = applyKnockback(nextBots[targetIndex], source, amountAtDistance(abilityId, distance, resolvedEffect, statOverrides), world, knockbackDirection);
        } else if (resolvedEffect.type === EFFECT_TYPES.PULL) {
            const pullSource = pullDirection === "owner"
                ? world?.bots?.find((bot) => bot?.id === source?.ownerId
                    || Number(bot?.slot) === Number(source?.ownerSlot)) ?? source
                : source;
            nextBots[targetIndex] = applyPull(nextBots[targetIndex], pullSource, amountAtDistance(abilityId, distance, resolvedEffect, statOverrides), world);
        }
    }
    if (landedOnEnemy) nextBots = recordEntityHit(nextBots, targetIndex, source, abilityId);
    return { bots: nextBots };
}

/** Attributes a hit on an enemy bot to the entity's owner and ability. Allies never count. */
function recordEntityHit(bots, targetIndex, source, abilityId) {
    const target = bots[targetIndex];
    const owner = ownerBot(bots, source);
    if (!owner || owner.id === target.id || !opposingBots(owner, target)) return bots;
    const ownerIndex = bots.findIndex((bot) => bot.id === owner.id);
    const next = [...bots];
    next[ownerIndex] = recordAbilityHit(bots[ownerIndex], abilityId);
    return next;
}

function opposingBots(first, second) {
    const firstTeam = Number(first?.teamNumber);
    const secondTeam = Number(second?.teamNumber);
    if (Number.isFinite(firstTeam) && Number.isFinite(secondTeam) && firstTeam > 0 && secondTeam > 0) {
        return firstTeam !== secondTeam;
    }
    return Number(first?.slot) !== Number(second?.slot);
}

function applyKnockback(target, source, distance, world, directionMode) {
    const dx = directionMode === "velocity" ? Number(source.velocityX ?? 0) : Number(target.x) - Number(source.x);
    const dy = directionMode === "velocity" ? Number(source.velocityY ?? 0) : Number(target.y) - Number(source.y);
    const magnitude = Math.max(0.001, Math.hypot(dx, dy));
    const width = Number(world?.width ?? ARENA_WIDTH_UNITS);
    const height = Number(world?.height ?? ARENA_HEIGHT_UNITS);
    return {
        ...target,
        x: clamp(target.x + dx / magnitude * distance, target.size / 2, width - target.size / 2),
        y: clamp(target.y + dy / magnitude * distance, target.size / 2, height - target.size / 2),
    };
}

function applyPull(target, source, distance, world) {
    const dx = Number(source.x) - Number(target.x);
    const dy = Number(source.y) - Number(target.y);
    const magnitude = Math.hypot(dx, dy);
    if (magnitude <= 0.001) return target;
    const width = Number(world?.width ?? ARENA_WIDTH_UNITS);
    const height = Number(world?.height ?? ARENA_HEIGHT_UNITS);
    return {
        ...target,
        x: clamp(target.x + dx / magnitude * distance, target.size / 2, width - target.size / 2),
        y: clamp(target.y + dy / magnitude * distance, target.size / 2, height - target.size / 2),
    };
}
