import { ABILITY_STATS } from "../../gameconfig/Abilities.js";
import { abilityContract, EFFECT_TYPES } from "../../gameconfig/AbilityContracts.js";
import { applyDebuff, damageAtDistance } from "./AbilityEffectSystem.js";
import { clamp } from "../../gameconfig/geometry.js";
import { resolveShieldInteraction } from "../../gameconfig/ShieldSystem.js";
import { ignoresHostileEffects } from "../../gameconfig/DefensiveState.js";
import { applyEntityDamage } from "../entities/EntityCombat.js";
import { upsertStatusEffect } from "../contracts/StatusContracts.js";

/** Applies the allowlisted effects declared by an entity's ability contract. */
export function applyEntityEffects(bots, targetIndex, source, abilityId, combat, {
    effectTypes = null,
    world = null,
    shieldChargeCost,
    skipShield = false,
    knockbackDirection = "source",
    collisionDistance = undefined,
    effectOverrides = null,
} = {}) {
    const target = bots[targetIndex];
    if (!target || ignoresHostileEffects(target)) return { bots, shield: null };
    const contract = abilityContract(abilityId);
    const shield = skipShield
        ? { bot: target, preventedEffects: new Set() }
        : resolveShieldInteraction(target, source, contract?.shieldInteraction, { chargeCost: shieldChargeCost });
    let nextBots = [...bots];
    nextBots[targetIndex] = shield.bot;
    const allowed = effectTypes ? new Set(effectTypes) : null;

    for (const effect of contract?.effects ?? []) {
        if (allowed && !allowed.has(effect.type)) continue;
        if (shield.preventedEffects.has(effect.type)) continue;
        const resolvedEffect = {
            ...effect,
            ...(effectOverrides?.[effect.type] ?? {}),
        };
        if (resolvedEffect.type === EFFECT_TYPES.DAMAGE) {
            const distance = Number.isFinite(Number(collisionDistance))
                ? Number(collisionDistance)
                : Math.hypot(Number(source.x) - Number(nextBots[targetIndex].x), Number(source.y) - Number(nextBots[targetIndex].y));
            const baseDamage = resolvedEffect.amount ?? damageAtDistance(abilityId, distance);
            nextBots = applyEntityDamage(nextBots, targetIndex, source, Number(baseDamage) * Number(source.damageMultiplier ?? 1), combat);
        } else if (resolvedEffect.type === EFFECT_TYPES.DEBUFF) {
            nextBots[targetIndex] = applyDebuff(nextBots[targetIndex], resolvedEffect, ABILITY_STATS[abilityId] ?? {}, source, abilityId);
        } else if (resolvedEffect.type === EFFECT_TYPES.INTERRUPT) {
            nextBots[targetIndex] = upsertStatusEffect({
                ...nextBots[targetIndex],
                preparingAbility: null,
                preparingMs: 0,
            }, {
                type: "stun",
                remainingMs: Number(resolvedEffect.durationMs ?? 0),
                effects: [{ type: "stun", mode: "constant" }],
            });
        } else if (resolvedEffect.type === EFFECT_TYPES.KNOCKBACK) {
            nextBots[targetIndex] = applyKnockback(nextBots[targetIndex], source, Number(resolvedEffect.distance ?? ABILITY_STATS[abilityId]?.knockback ?? 0), world, knockbackDirection);
        } else if (resolvedEffect.type === EFFECT_TYPES.PULL) {
            nextBots[targetIndex] = applyPull(nextBots[targetIndex], source, Number(resolvedEffect.perTick ?? 0), world);
        }
    }
    return { bots: nextBots, shield };
}

function applyKnockback(target, source, distance, world, directionMode) {
    const dx = directionMode === "velocity" ? Number(source.velocityX ?? 0) : Number(target.x) - Number(source.x);
    const dy = directionMode === "velocity" ? Number(source.velocityY ?? 0) : Number(target.y) - Number(source.y);
    const magnitude = Math.max(0.001, Math.hypot(dx, dy));
    const width = Number(world?.width ?? 1000);
    const height = Number(world?.height ?? 800);
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
    const width = Number(world?.width ?? 1000);
    const height = Number(world?.height ?? 800);
    return {
        ...target,
        x: clamp(target.x + dx / magnitude * distance, target.size / 2, width - target.size / 2),
        y: clamp(target.y + dy / magnitude * distance, target.size / 2, height - target.size / 2),
    };
}
