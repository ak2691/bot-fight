import { ABILITY_STATS, ACTION_TO_ABILITY } from "../../loadout/BotLoadout.js";
import { statusIntervalMs } from "../../gameconfig/Abilities.js";
import { abilityContract, DELIVERY_TYPES, EFFECT_TYPES } from "../../gameconfig/AbilityContracts.js";
import { ignoresHostileEffects, isAliveBot } from "../../gameconfig/DefensiveState.js";
import { resolveShieldInteraction } from "../../gameconfig/ShieldSystem.js";
import { clamp, normalizeAngle } from "../../gameconfig/geometry.js";
import { ARENA_HEIGHT_UNITS, ARENA_WIDTH_UNITS } from "../../modelPayloads/arenaConstants.js";
import { compassDegreesToRadians, vectorToCompassDegrees } from "../../botlogic/planner/arenaAngles.js";
import { abilityHitsTarget, isDirectDelivery } from "./AbilityHitDetectionSystem.js";
import {
    STATUS_EFFECT_APPLICATIONS,
    upsertStatusEffect,
} from "../contracts/StatusContracts.js";
import {
    CONCUSSIVE_ROTATION_MULTIPLIER,
    CONCUSSIVE_SHOT_MOVEMENT_MULTIPLIER,
} from "../../gameconfig/HitStagger.js";

export { abilityHitsTarget } from "./AbilityHitDetectionSystem.js";

export function resolveTriggeredAbilityEffects(attacker, defender, combat) {
    const action = attacker?.triggeredAbility;
    const abilityId = ACTION_TO_ABILITY[action];
    const contract = abilityContract(abilityId);
    if (!abilityId || !contract || !isDirectDelivery(contract.delivery.type)) return [attacker, defender];

    const stats = ABILITY_STATS[abilityId] ?? {};
    let nextAttacker = withAbilityVisual(attacker, abilityId, stats);
    let nextDefender = defender;
    const targetHit = contract.delivery.type === DELIVERY_TYPES.SELF || abilityHitsTarget(attacker, defender, abilityId);
    if (!targetHit) return [nextAttacker, nextDefender];

    const hostileImpact = contract.delivery.type !== DELIVERY_TYPES.SELF && defender && !ignoresHostileEffects(defender);
    const shield = hostileImpact
        ? resolveShieldInteraction(defender, attacker, contract.shieldInteraction)
        : { bot: defender, preventedEffects: new Set() };
    if (hostileImpact) nextDefender = shield.bot;
    else if (contract.delivery.type !== DELIVERY_TYPES.SELF) return [nextAttacker, nextDefender];

    let damageConfirmed = false;
    let damageConfirmedAmount = 0;
    for (const effect of contract.effects) {
        if (shield.preventedEffects.has(effect.type)) continue;
        const defenderHpBefore = Number(nextDefender?.hp ?? 0);
        [nextAttacker, nextDefender] = applyEffect(effect, {
            abilityId,
            stats,
            attacker: nextAttacker,
            originalAttacker: attacker,
            defender: nextDefender,
            originalDefender: defender,
            combat,
            damageConfirmed,
            damageConfirmedAmount,
        });
        if (effect.type === EFFECT_TYPES.DAMAGE) {
            const appliedDamage = Math.max(0, defenderHpBefore - Number(nextDefender?.hp ?? 0));
            if (appliedDamage > 0) {
                damageConfirmed = true;
                damageConfirmedAmount = roundCombatValue(damageConfirmedAmount + appliedDamage);
            }
        }
    }
    return [nextAttacker, nextDefender];
}

export function triggeredAbilityDamage(attacker, target) {
    const abilityId = ACTION_TO_ABILITY[attacker?.triggeredAbility];
    if (!abilityHitsTarget(attacker, target, abilityId)) return 0;
    const distance = Math.hypot(target.x - attacker.x, target.y - attacker.y);
    return roundCombatValue(damageAtDistance(abilityId, distance) * damageMultiplier(attacker));
}

function applyEffect(effect, context) {
    const { attacker, defender, originalAttacker, originalDefender, abilityId, stats, combat, damageConfirmed, damageConfirmedAmount } = context;
    if (effect.type === EFFECT_TYPES.DAMAGE) {
        if (!defender) return [attacker, defender];
        const damageSource = originalAttacker ?? attacker;
        const distance = Math.hypot(defender.x - damageSource.x, defender.y - damageSource.y);
        return combat.applyDamageFromShapes(attacker, defender,
            damageAtDistance(abilityId, distance) * damageMultiplier(originalAttacker), damageSource);
    }
    if (effect.type === EFFECT_TYPES.HEALING) {
        if (effect.requiresConfirmedDamage && !damageConfirmed) return [attacker, defender];
        const recipient = ["target", "defender"].includes(effect.recipient) ? defender : attacker;
        if (!recipient) return [attacker, defender];
        const healingAmount = effect.mirrorsDamage
            ? damageConfirmedAmount
            : Number(effect.amount ?? stats.healing ?? 0);
        const healed = {
            ...recipient,
            pendingHealing: roundCombatValue(Number(recipient.pendingHealing ?? 0) + healingAmount),
        };
        return recipient === attacker ? [healed, defender] : [attacker, healed];
    }
    if (effect.type === EFFECT_TYPES.BUFF) {
        return [applyBuff(attacker, effect, stats), defender];
    }
    if (effect.type === EFFECT_TYPES.DAMAGE_REDUCTION
        || effect.type === EFFECT_TYPES.DAMAGE_REFLECTION) {
        return [applyReactiveArmor(attacker, effect, abilityId, stats), defender];
    }
    if (effect.type === EFFECT_TYPES.DAMAGE_IMMUNITY) {
        return [applyDefensiveStatus(attacker, "absolute-guard", effect, abilityId, [{
            type: STATUS_EFFECT_APPLICATIONS.DAMAGE_IMMUNITY,
            mode: "constant",
            amount: Number(effect.amount ?? 1),
        }], stats), defender];
    }
    if (effect.type === EFFECT_TYPES.DEBUFF) {
        return [attacker, applyDebuff(defender, effect, stats, originalAttacker, abilityId)];
    }
    if (effect.type === EFFECT_TYPES.KNOCKBACK) {
        return [attacker, applyKnockback(defender, originalAttacker, Number(effect.distance ?? stats.knockback ?? 0))];
    }
    if (effect.type === EFFECT_TYPES.TELEPORT) {
        return [applyTeleport(attacker, originalAttacker, originalDefender, Number(effect.passThroughDistance ?? stats.passThroughDistance ?? 0)), defender];
    }
    if (effect.type === EFFECT_TYPES.RESTORE_STATE) {
        return [{
            ...attacker,
            temporalRewindX: originalAttacker.x,
            temporalRewindY: originalAttacker.y,
            temporalRewindVisualX: originalAttacker.x,
            temporalRewindVisualY: originalAttacker.y,
            temporalRewindHp: originalAttacker.hp,
            temporalRewindMs: Number(effect.delayMs ?? stats.delayMs ?? 0),
            temporalRewindPulseMs: 0,
        }, defender];
    }
    return [attacker, defender];
}

export function applyDebuff(defender, effect, stats, attacker, abilityId = effect.abilityId) {
    if (!isAliveBot(defender)) return defender;
    const sourceAbilityId = abilityId ?? effect.abilityId ?? null;
    const durationMs = Number(effect.durationMs ?? 0);
    const source = sourceSlot(attacker);
    if (effect.debuff === "burn") return upsertStatusEffect(defender, {
        type: "burn",
        remainingMs: durationMs,
        tickMs: statusIntervalMs(sourceAbilityId, "burn", 1000),
        sourceSlot: source,
        abilityId: sourceAbilityId,
        effects: [{
            type: STATUS_EFFECT_APPLICATIONS.DAMAGE,
            mode: "tick",
            amount: Number(stats.burnDamage ?? 0),
            multiplier: Math.max(1, Number(attacker?.damageMultiplier ?? attacker?.attackDamageMultiplier ?? 1)),
        }],
    });
    if (effect.debuff === "silence") return upsertStatusEffect(defender, {
        type: "silence",
        abilityId: sourceAbilityId,
        mode: effect.whileInside ? "presence" : "duration",
        remainingMs: effect.whileInside ? 0 : durationMs,
        source: effect.presenceField ?? null,
        effects: [{ type: STATUS_EFFECT_APPLICATIONS.SILENCE, mode: "constant" }],
    });
    if (effect.debuff === "stun") return upsertStatusEffect({
        ...defender,
        movementVelocityX: 0,
        movementVelocityY: 0,
        velocityX: 0,
        velocityY: 0,
    }, {
        type: "stun",
        abilityId: sourceAbilityId,
        remainingMs: durationMs,
        effects: [{ type: STATUS_EFFECT_APPLICATIONS.STUN, mode: "constant" }],
    });
    if (effect.debuff === "slow") return upsertStatusEffect(defender, {
        type: "slow",
        abilityId: sourceAbilityId,
        remainingMs: durationMs,
        effects: [{
            type: STATUS_EFFECT_APPLICATIONS.MOVEMENT_MODIFIER,
            mode: "constant",
            movementMultiplier: CONCUSSIVE_SHOT_MOVEMENT_MULTIPLIER,
            rotationMultiplier: CONCUSSIVE_ROTATION_MULTIPLIER,
        }],
    });
    if (effect.debuff === "shock") return upsertStatusEffect(defender, {
        type: "shock",
        abilityId: sourceAbilityId,
        remainingMs: durationMs,
        tickMs: statusIntervalMs(sourceAbilityId, "shock", 1000),
        sourceSlot: source,
        effects: [
            { type: STATUS_EFFECT_APPLICATIONS.DAMAGE, mode: "tick", amount: Number(stats.shockDamage ?? 0) },
            { type: STATUS_EFFECT_APPLICATIONS.MOVEMENT_LOCK, mode: "tick", durationMs: Number(stats.movementLockMs ?? 0) },
        ],
    });
    if (effect.debuff === "bleed") return upsertStatusEffect(defender, {
        type: "bleed",
        abilityId: sourceAbilityId,
        remainingMs: durationMs,
        tickMs: statusIntervalMs(sourceAbilityId, "bleed", 1000),
        sourceSlot: source,
        effects: [{
            type: STATUS_EFFECT_APPLICATIONS.DAMAGE,
            mode: "tick",
            amount: Number(stats.bleedDamage ?? 0),
        }],
    });
    return defender;
}

function applyKnockback(defender, source, distance) {
    if (!defender) return defender;
    const dx = defender.x - source.x;
    const dy = defender.y - source.y;
    const magnitude = Math.max(1, Math.hypot(dx, dy));
    return {
        ...defender,
        x: clamp(defender.x + dx / magnitude * distance, defender.size / 2, ARENA_WIDTH_UNITS - defender.size / 2),
        y: clamp(defender.y + dy / magnitude * distance, defender.size / 2, ARENA_HEIGHT_UNITS - defender.size / 2),
    };
}

function applyTeleport(attacker, source, target, passThroughDistance) {
    if (!target) return attacker;
    const bearing = vectorToCompassDegrees(target.x - source.x, target.y - source.y);
    const radians = compassDegreesToRadians(bearing);
    const nextX = clamp(target.x + Math.cos(radians) * passThroughDistance, source.size / 2, ARENA_WIDTH_UNITS - source.size / 2);
    const nextY = clamp(target.y + Math.sin(radians) * passThroughDistance, source.size / 2, ARENA_HEIGHT_UNITS - source.size / 2);
    const next = {
        ...attacker,
        x: nextX,
        y: nextY,
        movementStartX: nextX,
        movementStartY: nextY,
        movementVelocityX: 0,
        movementVelocityY: 0,
        velocityX: 0,
        velocityY: 0,
    };
    const facingMode = attacker?.triggeredPhaseFacingMode ?? "face_target";
    if (facingMode === "face_target" || facingMode === "face_origin") next.rotation = normalizeAngle(bearing + 180);
    else if (facingMode === "mirror") next.rotation = normalizeAngle(2 * bearing - Number(source.rotation ?? 0));
    return next;
}

function withAbilityVisual(attacker, abilityId, stats) {
    return {
        ...attacker,
        abilityVisual: {
            ability: abilityId,
            ms: Math.max(300, Number(stats.visualDurationMs ?? stats.visualMs ?? stats.durationMs ?? 0)),
            x: Number(attacker.x ?? 0),
            y: Number(attacker.y ?? 0),
            rotation: Number(attacker.rotation ?? 0),
        },
    };
}

export function damageAtDistance(abilityId, distance) {
    const stats = ABILITY_STATS[abilityId] ?? {};
    const hasFalloff = stats.maxDamage != null || stats.minDamage != null;
    if (!hasFalloff) return roundCombatValue(Number(stats.damage ?? 0));
    const maxDamage = Number(stats.maxDamage ?? stats.damage ?? 0);
    const minDamage = Number(stats.minDamage ?? maxDamage);
    const falloffStart = Number(stats.damageFalloffStart ?? 0);
    const falloffEnd = Number(stats.damageFalloffEnd ?? falloffStart);
    const range = Number(stats.range ?? stats.radius ?? stats.explosionRadius ?? falloffEnd);
    if (!Number.isFinite(distance) || (range > 0 && distance > range)) return 0;
    if (!Number.isFinite(maxDamage) || !Number.isFinite(minDamage)) return 0;
    if (falloffEnd > falloffStart && minDamage !== maxDamage) {
        return roundCombatValue(interpolate(distance, falloffStart, falloffEnd, maxDamage, minDamage));
    }
    return roundCombatValue(maxDamage);
}

function applyBuff(attacker, effect, stats) {
    if (effect.buff !== "overclock") return attacker;
    const durationMs = Math.max(0, Number(effect.durationMs ?? stats.durationMs ?? 0));
    const multiplier = Math.min(1, Math.max(0, Number(effect.multiplier ?? (1 - Number(effect.amount ?? 0)))));
    return upsertStatusEffect(attacker, {
        type: "overclock",
        remainingMs: durationMs,
        effects: [{
            type: STATUS_EFFECT_APPLICATIONS.COOLDOWN_MODIFIER,
            mode: "constant",
            multiplier,
        }],
    });
}

function applyReactiveArmor(attacker, effect, abilityId, stats) {
    const application = effect.type === EFFECT_TYPES.DAMAGE_REDUCTION
        ? {
            type: STATUS_EFFECT_APPLICATIONS.INCOMING_DAMAGE_MODIFIER,
            mode: "constant",
            multiplier: Math.max(0, Number(effect.multiplier ?? (1 - Number(effect.amount ?? 0)))),
        }
        : {
            type: STATUS_EFFECT_APPLICATIONS.DAMAGE_REFLECTION,
            mode: "constant",
            multiplier: Math.max(0, Number(effect.multiplier ?? effect.amount ?? 0)),
        };
    return applyDefensiveStatus(attacker, "reactive-armor", effect, abilityId, [application], stats);
}

function applyDefensiveStatus(attacker, type, effect, abilityId, effects, stats = {}) {
    return upsertStatusEffect(attacker, {
        type,
        remainingMs: Math.max(0, Number(effect.durationMs ?? stats.durationMs ?? 0)),
        abilityId,
        effects,
    });
}

function sourceSlot(source) {
    const slot = Number(source?.slot ?? source?.ownerSlot);
    return Number.isFinite(slot) ? slot : null;
}

function damageMultiplier(attacker) {
    return Math.max(0, Number(attacker?.attackDamageMultiplier ?? 1));
}

function interpolate(value, min, max, near, far) {
    const t = clamp((value - min) / (max - min), 0, 1);
    return near + (far - near) * t;
}

function roundCombatValue(value) {
    return Math.round(Number(value) * 1000) / 1000;
}
