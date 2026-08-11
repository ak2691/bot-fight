import { ABILITY_STATS, ACTION_TO_ABILITY } from "../loadout/BotLoadout.js";
import { abilityContract, DELIVERY_TYPES, EFFECT_TYPES } from "../gameconfig/AbilityContracts.js";
import { ignoresHostileEffects, isAliveBot } from "../gameconfig/DefensiveState.js";
import { resolveShieldInteraction } from "../gameconfig/ShieldSystem.js";
import { angleDelta, clamp, normalizeAngle, rayIntersectsCircle } from "../gameconfig/geometry.js";
import { ARENA_HEIGHT_UNITS, ARENA_WIDTH_UNITS } from "../modelPayloads/arenaConstants.js";
import { compassDegreesToRadians, vectorToCompassDegrees } from "../botlogic/planner/arenaAngles.js";

const DIRECT_DELIVERIES = new Set([DELIVERY_TYPES.SELF, DELIVERY_TYPES.MELEE, DELIVERY_TYPES.RAY, DELIVERY_TYPES.RADIAL]);

export function resolveTriggeredAbilityEffects(attacker, defender, combat) {
    const action = attacker?.triggeredAbility;
    const abilityId = ACTION_TO_ABILITY[action];
    const contract = abilityContract(abilityId);
    if (!abilityId || !contract || !DIRECT_DELIVERIES.has(contract.delivery.type)) return [attacker, defender];

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

    for (const effect of contract.effects) {
        if (shield.preventedEffects.has(effect.type)) continue;
        [nextAttacker, nextDefender] = applyEffect(effect, {
            abilityId,
            stats,
            attacker: nextAttacker,
            originalAttacker: attacker,
            defender: nextDefender,
            originalDefender: defender,
            combat,
        });
    }
    return [nextAttacker, nextDefender];
}

export function abilityHitsTarget(attacker, target, abilityId = ACTION_TO_ABILITY[attacker?.triggeredAbility]) {
    const stats = ABILITY_STATS[abilityId];
    const delivery = abilityContract(abilityId)?.delivery;
    if (!attacker || !target || !stats || !delivery || ACTION_TO_ABILITY[attacker.triggeredAbility] !== abilityId) return false;
    if (delivery.type === DELIVERY_TYPES.RAY) {
        return rayIntersectsCircle(attacker, Number(attacker.rotation ?? 0), Number(stats.range ?? 0), target);
    }
    const dx = target.x - attacker.x;
    const dy = target.y - attacker.y;
    const targetRadius = delivery.includeTargetRadius ? Number(target.size ?? 60) / 2 : 0;
    if (Math.hypot(dx, dy) > Number(stats.range ?? stats.radius ?? 0) + targetRadius) return false;
    if (delivery.type === DELIVERY_TYPES.RADIAL) return true;
    if (delivery.type !== DELIVERY_TYPES.MELEE) return false;
    return Math.abs(angleDelta(attacker.rotation ?? 0, vectorToCompassDegrees(dx, dy))) <= Number(stats.arcDegrees ?? 36) / 2;
}

export function triggeredAbilityDamage(attacker, target) {
    const abilityId = ACTION_TO_ABILITY[attacker?.triggeredAbility];
    if (!abilityHitsTarget(attacker, target, abilityId)) return 0;
    const distance = Math.hypot(target.x - attacker.x, target.y - attacker.y);
    return Math.round(damageAtDistance(abilityId, distance) * damageMultiplier(attacker));
}

function applyEffect(effect, context) {
    const { attacker, defender, originalAttacker, originalDefender, abilityId, stats, combat } = context;
    if (effect.type === EFFECT_TYPES.DAMAGE) {
        if (!defender) return [attacker, defender];
        const distance = Math.hypot(defender.x - attacker.x, defender.y - attacker.y);
        return combat.applyDamageFromShapes(attacker, defender, damageAtDistance(abilityId, distance) * damageMultiplier(originalAttacker));
    }
    if (effect.type === EFFECT_TYPES.HEALING) {
        return [{ ...attacker, pendingHealing: Number(attacker.pendingHealing ?? 0) + Number(effect.amount ?? stats.healing ?? 0) }, defender];
    }
    if (effect.type === EFFECT_TYPES.DEBUFF) {
        return [attacker, applyDebuff(defender, effect, stats, originalAttacker)];
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

function applyDebuff(defender, effect, stats, attacker) {
    if (!isAliveBot(defender)) return defender;
    const durationMs = Number(effect.durationMs ?? 0);
    if (effect.debuff === "stun") return {
        ...defender,
        stunnedMs: Math.max(Number(defender.stunnedMs ?? 0), durationMs),
        movementVelocityX: 0,
        movementVelocityY: 0,
        velocityX: 0,
        velocityY: 0,
    };
    if (effect.debuff === "slow") return { ...defender, slowedMs: Math.max(Number(defender.slowedMs ?? 0), durationMs) };
    if (effect.debuff === "shock") return { ...defender, shockRemainingMs: durationMs, shockTickElapsedMs: 0, shockSourceSlot: Number(attacker.slot) };
    if (effect.debuff === "bleed") return {
        ...defender,
        bleedRemainingMs: durationMs,
        bleedTickMs: Number(defender.bleedRemainingMs ?? 0) > 0
            ? Math.max(0, Number(defender.bleedTickMs ?? 0))
            : Number(stats.bleedTickMs ?? 1000),
        bleedDamage: Math.max(Number(defender.bleedDamage ?? 0), Number(stats.bleedDamage ?? 0)),
        bleedSourceSlot: Number(attacker.slot),
    };
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
    const next = {
        ...attacker,
        x: clamp(target.x + Math.cos(radians) * passThroughDistance, source.size / 2, ARENA_WIDTH_UNITS - source.size / 2),
        y: clamp(target.y + Math.sin(radians) * passThroughDistance, source.size / 2, ARENA_HEIGHT_UNITS - source.size / 2),
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

function damageAtDistance(abilityId, distance) {
    const stats = ABILITY_STATS[abilityId] ?? {};
    const ranges = Array.isArray(stats.damageRanges) ? stats.damageRanges : [];
    const damages = Array.isArray(stats.damageByRange) ? stats.damageByRange : [];
    if (ranges.length === 0 || damages.length === 0) return Number(stats.damage ?? 0);
    if (stats.damageRangeMode === "interpolated") {
        if (distance <= Number(ranges[0])) return Number(damages[0] ?? 0);
        for (let index = 1; index < ranges.length; index += 1) {
            if (distance <= Number(ranges[index])) return interpolate(distance, Number(ranges[index - 1]), Number(ranges[index]), Number(damages[index - 1]), Number(damages[index]));
        }
        return 0;
    }
    let index = 0;
    for (let rangeIndex = 1; rangeIndex < ranges.length; rangeIndex += 1) {
        if (distance < Number(ranges[rangeIndex])) break;
        index = rangeIndex;
    }
    return Number(damages[Math.min(index, damages.length - 1)] ?? 0);
}

function damageMultiplier(attacker) {
    return Math.max(0, Number(attacker?.attackDamageMultiplier ?? 1));
}

function interpolate(value, min, max, near, far) {
    const t = clamp((value - min) / (max - min), 0, 1);
    return near + (far - near) * t;
}
