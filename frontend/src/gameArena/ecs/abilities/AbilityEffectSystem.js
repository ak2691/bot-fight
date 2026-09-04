import { ABILITY_STATS, ACTION_TO_ABILITY } from "../../loadout/BotLoadout.js";
import { statusIntervalMs } from "../../gameconfig/Abilities.js";
import {
    abilityContract,
    DELIVERY_TYPES,
    EFFECT_TYPES,
    PHASE_ACTIONS,
    PHASE_EVENT_TYPES,
    TELEPORT_DISTANCE_MODES,
    resolveEffectOverride,
} from "../../gameconfig/AbilityContracts.js";
import { ignoresHostileEffects, isAliveBot } from "../../gameconfig/DefensiveState.js";
import { clamp, normalizeAngle } from "../../gameconfig/geometry.js";
import { ARENA_HEIGHT_UNITS, ARENA_WIDTH_UNITS } from "../../modelPayloads/arenaConstants.js";
import { compassDegreesToRadians, vectorToCompassDegrees } from "../../botlogic/planner/arenaAngles.js";
import { abilityHitsTarget, isDirectDelivery } from "./AbilityHitDetectionSystem.js";
import { combatVisualDurationMs } from "../../gameconfig/visualState.js";
import { interruptCurrentAbility } from "../../gameconfig/AbilityResourceSystem.js";
import {
    STATUS_EFFECT_APPLICATIONS,
    upsertStatusEffect,
} from "../contracts/StatusContracts.js";
import {
    CONCUSSIVE_ROTATION_MULTIPLIER,
    CONCUSSIVE_SHOT_MOVEMENT_MULTIPLIER,
} from "../../gameconfig/HitStagger.js";

const BLEED_INCOMING_DAMAGE_MODIFIER = 0.25;

export { abilityHitsTarget } from "./AbilityHitDetectionSystem.js";

export function resolveTriggeredAbilityEffects(attacker, defender, combat, {
    hitTestAttacker = attacker,
    effectSource = attacker,
    visualSource = attacker,
    skipEffectTypes = null,
} = {}) {
    const action = attacker?.triggeredAbility;
    const abilityId = ACTION_TO_ABILITY[action];
    const contract = abilityContract(abilityId);
    if (!abilityId || !contract || !isDirectDelivery(contract.delivery.type)) return [attacker, defender];

    const stats = ABILITY_STATS[abilityId] ?? {};
    let nextAttacker = withAbilityVisual(attacker, abilityId, stats, visualSource);
    let nextDefender = defender;
    const phase = contract.phases?.[0] ?? null;
    const phaseStats = { ...stats, ...(phase?.statOverrides ?? {}) };
    const eventType = contract.delivery.type === DELIVERY_TYPES.SELF
        ? PHASE_EVENT_TYPES.ACTIVATION : PHASE_EVENT_TYPES.COLLISION;
    const event = phase?.events?.[eventType] ?? null;
    const phaseEffects = directPhaseEffects(contract, phase, event)
        .map((effect) => resolveEffectOverride(effect, phase?.effectOverrides));
    if (event && !event.actions?.includes(PHASE_ACTIONS.APPLY_EFFECTS)) {
        return [nextAttacker, nextDefender];
    }
    const targetHit = contract.delivery.type === DELIVERY_TYPES.SELF
        || abilityHitsTarget(hitTestAttacker, defender, abilityId);
    if (!targetHit) return [nextAttacker, nextDefender];

    const hostileImpact = contract.delivery.type !== DELIVERY_TYPES.SELF && defender && !ignoresHostileEffects(defender);
    if (!hostileImpact && contract.delivery.type !== DELIVERY_TYPES.SELF) return [nextAttacker, nextDefender];

    let damageConfirmed = false;
    let damageConfirmedAmount = 0;
    for (const effect of phaseEffects) {
        if (skipEffectTypes?.has(effect.type)) continue;
        const defenderHpBefore = Number(nextDefender?.hp ?? 0);
        [nextAttacker, nextDefender] = applyEffect(effect, {
            abilityId,
            stats: phaseStats,
            attacker: nextAttacker,
            originalAttacker: effectSource,
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

/** Resolves the effects owned by the direct ability phase in declaration order. */
function directPhaseEffects(contract, phase, event) {
    const declared = phase?.effects?.length ? phase.effects : contract.effects ?? [];
    const allowed = event?.effectTypes ?? event?.effects ?? null;
    const allowedTypes = Array.isArray(allowed)
        ? new Set(allowed.map((effect) => typeof effect === "string" ? effect : effect?.type).filter(Boolean))
        : null;
    return declared
        .flatMap((effect) => typeof effect === "string"
            ? (contract.effects ?? []).filter((candidate) => candidate.type === effect)
            : [effect])
        .filter((effect) => effect?.type !== EFFECT_TYPES.SPAWN_ENTITY)
        .filter((effect) => !allowedTypes || allowedTypes.has(effect.type));
}

export function triggeredAbilityDamage(attacker, target) {
    const abilityId = ACTION_TO_ABILITY[attacker?.triggeredAbility];
    if (!abilityHitsTarget(attacker, target, abilityId)) return 0;
    const distance = Math.hypot(target.x - attacker.x, target.y - attacker.y);
    const contract = abilityContract(abilityId);
    if (!contract) return 0;
    const phase = contract?.phases?.[0] ?? null;
    const eventType = contract?.delivery?.type === DELIVERY_TYPES.SELF
        ? PHASE_EVENT_TYPES.ACTIVATION : PHASE_EVENT_TYPES.COLLISION;
    const damageEffect = directPhaseEffects(contract, phase, phase?.events?.[eventType] ?? null)
        .find((effect) => effect.type === EFFECT_TYPES.DAMAGE) ?? null;
    const resolvedDamageEffect = resolveEffectOverride(damageEffect, phase?.effectOverrides);
    return roundCombatValue(amountAtDistance(abilityId, distance, resolvedDamageEffect, {
        ...(ABILITY_STATS[abilityId] ?? {}), ...(phase?.statOverrides ?? {}),
    })
        * damageMultiplier(attacker));
}

function applyEffect(effect, context) {
    const { attacker, defender, originalAttacker, originalDefender, abilityId, stats, combat, damageConfirmed, damageConfirmedAmount } = context;
    const damageSource = originalAttacker ?? attacker;
    const distance = defender && damageSource
        ? Math.hypot(Number(defender.x) - Number(damageSource.x), Number(defender.y) - Number(damageSource.y))
        : 0;
    const resolvedEffect = hasDurationFalloff(effect)
        ? { ...effect, durationMs: durationAtDistance(abilityId, distance, effect, stats) }
        : effect;
    if (resolvedEffect.type === EFFECT_TYPES.DAMAGE) {
        if (!defender) return [attacker, defender];
        const amount = amountAtDistance(abilityId, distance, resolvedEffect, stats);
        return combat.applyDamageFromShapes(attacker, defender,
            amount * damageMultiplier(originalAttacker), damageSource);
    }
    if (resolvedEffect.type === EFFECT_TYPES.HEALING) {
        if (resolvedEffect.requiresConfirmedDamage && !damageConfirmed) return [attacker, defender];
        const recipient = ["target", "defender"].includes(resolvedEffect.recipient) ? defender : attacker;
        if (!recipient) return [attacker, defender];
        const healingAmount = resolvedEffect.mirrorsDamage
            ? damageConfirmedAmount
            : amountAtDistance(abilityId, distance, resolvedEffect, stats);
        const healed = {
            ...recipient,
            pendingHealing: roundCombatValue(Number(recipient.pendingHealing ?? 0) + healingAmount),
        };
        return recipient === attacker ? [healed, defender] : [attacker, healed];
    }
    if (resolvedEffect.type === EFFECT_TYPES.BUFF) {
        return [applyBuff(attacker, resolvedEffect, stats), defender];
    }
    if (resolvedEffect.type === EFFECT_TYPES.DAMAGE_REDUCTION
        || resolvedEffect.type === EFFECT_TYPES.DAMAGE_REFLECTION) {
        return [applyReactiveArmor(attacker, resolvedEffect, abilityId, stats), defender];
    }
    if (resolvedEffect.type === EFFECT_TYPES.DAMAGE_IMMUNITY) {
        return [applyDefensiveStatus(attacker, "absolute-guard", resolvedEffect, abilityId, [{
            type: STATUS_EFFECT_APPLICATIONS.DAMAGE_IMMUNITY,
            mode: "constant",
            amount: Number(resolvedEffect.amount ?? 1),
        }], stats), defender];
    }
    if (resolvedEffect.type === EFFECT_TYPES.STATUS) {
        return [attacker, applyStatusEffect(defender, resolvedEffect, stats, originalAttacker, abilityId)];
    }
    if (resolvedEffect.type === EFFECT_TYPES.INTERRUPT) {
        if (!isAliveBot(defender)) return [attacker, defender];
        const interrupted = interruptCurrentAbility(defender);
        return [attacker, upsertStatusEffect({
            ...interrupted,
            movementVelocityX: 0,
            movementVelocityY: 0,
            velocityX: 0,
            velocityY: 0,
        }, {
            type: "stun",
            abilityId,
            remainingMs: Number(resolvedEffect.durationMs ?? 0),
            effects: [{ type: STATUS_EFFECT_APPLICATIONS.STUN, mode: "constant" }],
        })];
    }
    if (resolvedEffect.type === EFFECT_TYPES.KNOCKBACK) {
        return [attacker, applyKnockback(defender, originalAttacker, amountAtDistance(abilityId, distance, resolvedEffect, stats))];
    }
    if (resolvedEffect.type === EFFECT_TYPES.TELEPORT) {
        const source = originalAttacker ?? attacker;
        const target = originalDefender ?? defender;
        const teleportDistance = resolvedEffect.distanceMode === TELEPORT_DISTANCE_MODES.CENTER_DISTANCE
            ? Math.hypot(Number(target?.x ?? 0) - Number(source?.x ?? 0), Number(target?.y ?? 0) - Number(source?.y ?? 0))
            : amountAtDistance(abilityId, distance, resolvedEffect, stats);
        return [applyTeleport(attacker, source, target, teleportDistance), defender];
    }
    if (resolvedEffect.type === EFFECT_TYPES.RESTORE_STATE) {
        return [{
            ...attacker,
            temporalRewindX: originalAttacker.x,
            temporalRewindY: originalAttacker.y,
            temporalRewindVisualX: originalAttacker.x,
            temporalRewindVisualY: originalAttacker.y,
            temporalRewindHp: originalAttacker.hp,
            temporalRewindMs: Number(resolvedEffect.delayMs ?? stats.delayMs ?? 0),
            temporalRewindPulseMs: 0,
        }, defender];
    }
    return [attacker, defender];
}

export function applyStatusEffect(defender, effect, stats, attacker, abilityId = effect.abilityId) {
    if (!isAliveBot(defender)) return defender;
    const sourceAbilityId = abilityId ?? effect.abilityId ?? null;
    const durationMs = Number(effect.durationMs ?? 0);
    const source = sourceSlot(attacker);
    if (effect.subtype === "burn") return upsertStatusEffect(defender, {
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
    if (effect.subtype === "silence") return upsertStatusEffect(defender, {
        type: "silence",
        abilityId: sourceAbilityId,
        mode: effect.whileInside ? "presence" : "duration",
        remainingMs: effect.whileInside ? 0 : durationMs,
        source: effect.presenceField ?? null,
        effects: [{ type: STATUS_EFFECT_APPLICATIONS.SILENCE, mode: "constant" }],
    });
    if (effect.subtype === "stun") return upsertStatusEffect({
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
    if (effect.subtype === "slow") return upsertStatusEffect(defender, {
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
    if (effect.subtype === "shock") return upsertStatusEffect(defender, {
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
    if (effect.subtype === "bleed") return upsertStatusEffect(defender, {
        type: "bleed",
        abilityId: sourceAbilityId,
        remainingMs: durationMs,
        tickMs: statusIntervalMs(sourceAbilityId, "bleed", 1000),
        sourceSlot: source,
        effects: [{
            type: STATUS_EFFECT_APPLICATIONS.DAMAGE,
            mode: "tick",
            amount: Number(stats.bleedDamage ?? 0),
        }, {
            type: STATUS_EFFECT_APPLICATIONS.INCOMING_DAMAGE_MODIFIER,
            mode: "constant",
            damageModifier: BLEED_INCOMING_DAMAGE_MODIFIER,
            rounding: "truncate_tenths",
            excludedDamageSourceTypes: ["bleed"],
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

function applyTeleport(attacker, source, target, teleportDistance) {
    if (!target) return attacker;
    const directionSource = attacker ?? source;
    const bearing = vectorToCompassDegrees(target.x - directionSource.x, target.y - directionSource.y);
    const radians = compassDegreesToRadians(bearing);
    const nextX = clamp(target.x + Math.cos(radians) * teleportDistance, attacker.size / 2, ARENA_WIDTH_UNITS - attacker.size / 2);
    const nextY = clamp(target.y + Math.sin(radians) * teleportDistance, attacker.size / 2, ARENA_HEIGHT_UNITS - attacker.size / 2);
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
    const relativeDirection = Number(attacker?.triggeredPhaseFacingMode ?? 0);
    const originalRotation = Number(attacker?.rotation ?? source?.rotation ?? 0);
    next.rotation = normalizeAngle(originalRotation + (Number.isFinite(relativeDirection) ? relativeDirection : 0));
    return next;
}

function withAbilityVisual(attacker, abilityId, stats, visualSource = attacker) {
    return {
        ...attacker,
        abilityVisual: {
            ability: abilityId,
            ms: combatVisualDurationMs(abilityId, stats),
            x: Number(visualSource?.x ?? attacker.x ?? 0),
            y: Number(visualSource?.y ?? attacker.y ?? 0),
            rotation: Number(visualSource?.rotation ?? attacker.rotation ?? 0),
        },
    };
}

/** Resolves a generic effect amount, optionally using the effect's falloff profile. */
export function amountAtDistance(abilityId, distance, effect = null, statsOverride = null) {
    const baseStats = ABILITY_STATS[abilityId] ?? {};
    const stats = { ...baseStats, ...(statsOverride ?? {}) };
    const profile = effect?.falloff && typeof effect.falloff === "object"
        ? effect.falloff : effect == null ? stats.falloff : null;
    if (!hasAmountFalloff(profile)) {
        return roundCombatValue(Number(effect?.amount ?? stats.amount ?? stats.damage ?? 0));
    }

    const maxAmount = Number(profile.maxAmount ?? effect?.amount ?? stats.amount ?? stats.damage ?? 0);
    const minAmount = Number(profile.minAmount ?? maxAmount);
    const falloffStart = Number(profile.falloffStart ?? 0);
    const falloffEnd = Number(profile.falloffEnd ?? falloffStart);
    const range = effectRange(stats, effect, profile);
    return resolveFalloffValue(distance, minAmount, maxAmount,
        falloffStart, falloffEnd, range);
}

/** Resolves a generic effect duration, optionally using distance-based falloff. */
export function durationAtDistance(abilityId, distance, effect, statsOverride = null) {
    const stats = { ...(ABILITY_STATS[abilityId] ?? {}), ...(statsOverride ?? {}) };
    const profile = effect?.falloff && typeof effect.falloff === "object"
        ? effect.falloff : null;
    if (!hasDurationFalloff(effect)) {
        return Math.max(0, Number(effect?.durationMs ?? stats.durationMs ?? 0));
    }
    const maxDurationMs = Number(profile.maxDurationMs ?? effect.durationMs ?? stats.durationMs ?? 0);
    const minDurationMs = Number(profile.minDurationMs ?? maxDurationMs);
    const falloffStart = Number(profile.falloffStart ?? 0);
    const falloffEnd = Number(profile.falloffEnd ?? falloffStart);
    const range = effectRange(stats, effect, profile);
    return Math.max(0, Math.round(resolveFalloffValue(distance, minDurationMs,
        maxDurationMs, falloffStart, falloffEnd, range)));
}

function hasAmountFalloff(profile) {
    return Boolean(profile && (profile.minAmount != null || profile.maxAmount != null)
        && profile.falloffStart != null && profile.falloffEnd != null);
}

function hasDurationFalloff(effect) {
    const profile = effect?.falloff;
    return Boolean(profile && typeof profile === "object"
        && (profile.minDurationMs != null || profile.maxDurationMs != null)
        && profile.falloffStart != null && profile.falloffEnd != null);
}

function effectRange(stats, effect, profile) {
    const explicit = Number(effect?.range ?? stats.range ?? stats.radius);
    if (Number.isFinite(explicit) && explicit > 0) return explicit;
    const end = Number(profile?.falloffEnd);
    return Number.isFinite(end) && end > 0 ? end : 0;
}

function resolveFalloffValue(distance, minValue, maxValue, start, end, range) {
    if (!Number.isFinite(distance) || !Number.isFinite(minValue) || !Number.isFinite(maxValue)
        || !Number.isFinite(start) || !Number.isFinite(end)) return 0;
    const maxRange = Number.isFinite(range) && range > 0 ? range : Math.max(0, end);
    if (maxRange > 0 && distance > maxRange) return 0;

    // A profile cannot extend past the ability's actual range. Clamping the
    // end point means the minimum value is reached at the last valid unit.
    const clampedStart = Math.min(Math.max(0, start), maxRange);
    const clampedEnd = Math.min(Math.max(0, end), maxRange);
    if (clampedEnd > clampedStart && minValue !== maxValue) {
        return roundCombatValue(interpolate(distance, clampedStart, clampedEnd,
            maxValue, minValue));
    }
    return roundCombatValue(maxValue);
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
            damageModifier: Math.min(0, Math.max(0, Number(effect.multiplier ?? (1 - Number(effect.amount ?? 0)))) - 1),
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
