import { ignoresHostileEffects, withoutBotStatuses } from "./DefensiveState.js";
import { HIT_STAGGER_DURATION_MS } from "./HitStagger.js";
import { CLOSING_ZONE_TYPE } from "./ArenaHazardConfig.js";
import { resolveTriggeredAbilityEffects } from "../ecs/abilities/AbilityEffectSystem.js";
import { BASE_BOT_HP } from "../modelPayloads/arenaConstants.js";
import {
    STATUS_EFFECT_APPLICATIONS,
    statusEffectValue,
    upsertStatusEffect,
} from "../ecs/contracts/StatusContracts.js";

export function resolveTriggeredAbilityCombat(first, second) {
    let nextFirst = { ...first };
    let nextSecond = second ? { ...second } : null;
    const combat = { applyDamageFromShapes };
    [nextFirst, nextSecond] = resolveTriggeredAbilityEffects(nextFirst, nextSecond, combat);
    if (nextSecond) [nextSecond, nextFirst] = resolveTriggeredAbilityEffects(nextSecond, nextFirst, combat);
    return [nextFirst, nextSecond];
}

export function applyDamageToShape(shape, damage, source = null) {
    if ((shape.hp ?? 0) <= 0) return shape;
    if (ignoresHostileEffects(shape)) return shape;
    const incomingDamageMultiplier = statusEffectValue(
        shape,
        "incoming-damage",
        STATUS_EFFECT_APPLICATIONS.INCOMING_DAMAGE_MODIFIER,
        "multiplier",
        1,
    );
    let remaining = Math.max(0, Number(damage) || 0) * Math.max(0, incomingDamageMultiplier);
    const reactiveArmorMultiplier = statusEffectValue(
        shape,
        "reactive-armor",
        STATUS_EFFECT_APPLICATIONS.INCOMING_DAMAGE_MODIFIER,
        "multiplier",
        1,
    );
    remaining = roundCombatValue(remaining * Math.max(0, reactiveArmorMultiplier));
    const hpBefore = Math.max(0, Number(shape.hp ?? shape.maxHp ?? BASE_BOT_HP));
    const hp = remaining > 0 ? roundCombatValue(Math.max(0, hpBefore - remaining)) : hpBefore;
    const appliedDamage = roundCombatValue(Math.max(0, hpBefore - hp));
    const hostile = isHostileDamageSource(source, shape);
    // Monotonic presentation metadata lets Pixi see repeated hazard ticks.
    const closingZoneDamage = appliedDamage > 0 && source?.type === CLOSING_ZONE_TYPE;
    let damaged = {
        ...shape,
        hp,
        damageTakenThisTick: roundCombatValue(Math.max(0, Number(shape.damageTakenThisTick ?? 0)) + appliedDamage),
        hitFlashMs: 200,
        ...(appliedDamage > 0
            ? { hitParticleEvent: Number(shape.hitParticleEvent ?? 0) + 1 }
            : {}),
        ...(closingZoneDamage
            ? { closingZoneDamageCount: Number(shape.closingZoneDamageCount ?? 0) + 1 }
            : {}),
    };
    if (appliedDamage > 0 && hostile) {
        damaged = upsertStatusEffect(damaged, {
            type: "hit-stagger",
            remainingMs: HIT_STAGGER_DURATION_MS,
            effects: [{
                type: "movement_modifier",
                mode: "constant",
                movementMultiplier: 0.85,
                rotationMultiplier: 0.85,
            }],
        });
    }
    return hp <= 0 ? withoutBotStatuses(damaged) : damaged;
}

export function settlePendingHealing(shape) {
    const healing = Math.max(0, Number(shape?.pendingHealing ?? 0));
    if (!shape || healing <= 0) return shape;
    const maxHp = Math.max(0, Number(shape.maxHp ?? BASE_BOT_HP));
    const hp = Math.max(0, Number(shape.hp ?? 0));
    return { ...shape, hp: roundCombatValue(Math.min(maxHp, hp + healing)), pendingHealing: 0 };
}

export function applyDamageFromShapes(source, target, damage, damageSource = source) {
    const reflectionMultiplier = statusEffectValue(
        target,
        "reactive-armor",
        STATUS_EFFECT_APPLICATIONS.DAMAGE_REFLECTION,
        "multiplier",
        0,
    );
    const reflecting = source?.id !== target?.id && reflectionMultiplier > 0;
    const nextTarget = applyDamageToShape(target, damage, damageSource);
    const nextSource = reflecting
        ? applyDamageToShape(source, roundCombatValue(Math.max(0, Number(damage) || 0) * reflectionMultiplier), target)
        : source;
    return [nextSource, nextTarget];
}

function roundCombatValue(value) {
    return Math.round(Number(value) * 1000) / 1000;
}

function isHostileDamageSource(source, target) {
    const sourceSlot = Number(source?.slot ?? source?.ownerSlot);
    const targetSlot = Number(target?.slot);
    return Number.isFinite(sourceSlot) && Number.isFinite(targetSlot) && sourceSlot !== targetSlot;
}
