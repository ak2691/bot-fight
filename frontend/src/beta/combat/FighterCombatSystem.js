import { PROTOTYPE_ABILITY_STATS, PROTOTYPE_ACTION_TO_ABILITY } from "../loadout/BotLoadout.js";
import { GUN_RANGE, MELEE_DAMAGE, MOVE_STATS, RANGED_DAMAGE_FALLOFF } from "./Moves.js";
import { STUN_DAMAGE, STUN_DURATION_MS, STUN_RANGE } from "./Abilities.js";
import { angleDelta, clamp, normalizeAngle, rayIntersectsCircle } from "./geometry.js";
import { ARENA_HEIGHT_UNITS, ARENA_WIDTH_UNITS } from "../modelPayloads/arenaConstants.js";
import { abilityContract, EFFECT_TYPES } from "./AbilityContracts.js";
import { resolveShieldInteraction } from "./ShieldSystem.js";
import { ignoresHostileEffects, isAliveFighter, withoutFighterStatuses } from "./DefensiveState.js";
import { compassDegreesToRadians, vectorToCompassDegrees } from "../../logic/arenaAngles.js";

export function resolveBasicCombat(first, second) {
    let nextFirst = { ...first, gunBounceRay: null, gunRayLength: GUN_RANGE };
    let nextSecond = { ...second, gunBounceRay: null, gunRayLength: GUN_RANGE };
    if (isSwingHitting(first, second)) [nextFirst, nextSecond] = resolveBlockOrDamage(nextFirst, nextSecond, incomingMeleeDamage(first, nextSecond), "swing");
    if (isSwingHitting(second, first)) [nextSecond, nextFirst] = resolveBlockOrDamage(nextSecond, nextFirst, incomingMeleeDamage(second, nextFirst), "swing");
    if (isGunHitting(first, second)) [nextFirst, nextSecond] = resolveBlockOrDamage(nextFirst, nextSecond, incomingGunDamage(first, second), "fire_gun");
    if (isGunHitting(second, first)) [nextSecond, nextFirst] = resolveBlockOrDamage(nextSecond, nextFirst, incomingGunDamage(second, first), "fire_gun");
    return [nextFirst, nextSecond];
}

export function resolvePrototypeCombat(first, second) {
    let nextFirst = { ...first };
    let nextSecond = second ? { ...second } : null;
    [nextFirst, nextSecond] = applyPrototypeTrigger(nextFirst, nextSecond);
    if (nextSecond) [nextSecond, nextFirst] = applyPrototypeTrigger(nextSecond, nextFirst);
    return [nextFirst, nextSecond];
}

export function applyStunHits(fighters) {
    let nextFighters = fighters;
    for (const defender of fighters) {
        if (ignoresHostileEffects(defender)) continue;
        const attacker = nextFighters.find((candidate) => candidate.id !== defender.id && stunHits(candidate, defender) && !resolveAbilityShield(defender, candidate, "stun").blocked);
        if (!attacker) continue;
        const currentDefender = nextFighters.find((fighter) => fighter.id === defender.id) ?? defender;
        let nextDefender = applyDamageToShape(currentDefender, STUN_DAMAGE * attackerDamageMultiplier(attacker));
        if (isAliveFighter(nextDefender)) nextDefender = {
            ...nextDefender,
            stunnedMs: Math.max(currentDefender.stunnedMs ?? 0, STUN_DURATION_MS),
            dashActiveMs: 0,
            movementVelocityX: 0,
            movementVelocityY: 0,
            velocityX: 0,
            velocityY: 0,
        };
        nextFighters = nextFighters.map((fighter) => fighter.id === nextDefender.id ? nextDefender : fighter);
    }
    return nextFighters.map((fighter) => {
        return nextFighters.filter((attacker) => attacker.id !== fighter.id && stunHits(attacker, fighter))
            .reduce((next, attacker) => resolveAbilityShield(next, attacker, "stun").fighter, fighter);
    });
}

export function applyDamageToShape(shape, damage) {
    if ((shape.hp ?? 0) <= 0) return shape;
    if (ignoresHostileEffects(shape)) return shape;
    let remaining = Math.max(0, Number(damage) || 0);
    if (Number(shape.abilityActiveMs?.reactive_armor ?? 0) > 0) remaining *= 0.5;
    const hp = remaining > 0 ? Math.max(0, Number(shape.hp ?? shape.maxHp ?? 100) - remaining) : shape.hp;
    const appliedDamage = Math.max(0, Number(shape.hp ?? shape.maxHp ?? 100) - Number(hp));
    const damaged = {
        ...shape,
        hp,
        damageTakenThisTick: Number(shape.damageTakenThisTick ?? 0) + appliedDamage,
        hitFlashMs: 200,
    };
    return hp <= 0 ? withoutFighterStatuses(damaged) : damaged;
}

export function settlePendingHealing(shape) {
    const healing = Math.max(0, Number(shape?.pendingHealing ?? 0));
    if (!shape || healing <= 0) return shape;
    return { ...shape, hp: Math.min(Number(shape.maxHp ?? 100), Number(shape.hp ?? 0) + healing), pendingHealing: 0 };
}

export function applyDamageFromShapes(source, target, damage) {
    const reflecting = source?.id !== target?.id && Number(target?.abilityActiveMs?.reactive_armor ?? 0) > 0;
    const nextTarget = applyDamageToShape(target, damage);
    const nextSource = reflecting ? applyDamageToShape(source, Math.max(0, Number(damage) || 0) * 0.5) : source;
    return [nextSource, nextTarget];
}

export function isSwingHitting(attacker, defender) {
    // The timer is cosmetic. New runtime state carries a one-tick trigger so
    // the full visual sweep cannot apply the instantaneous hit more than once.
    if (!(attacker.swingTriggered ?? (attacker.swingActiveMs ?? 0) > 0)) return false;
    const relX = defender.x - attacker.x, relY = defender.y - attacker.y;
    const defenderRadius = Number(defender.size ?? 60) / 2;
    const distance = Math.hypot(relX, relY);
    const bearing = vectorToCompassDegrees(relX, relY);
    return distance <= Number(MOVE_STATS.swing.range) + defenderRadius
        && Math.abs(angleDelta(attacker.rotation ?? 0, bearing)) <= Number(MOVE_STATS.swing.arcDegrees) / 2;
}

export function stunHits(attacker, defender) {
    if (!attacker?.stunCastActive || !hasAbility(attacker, "stun")) return false;
    const dx = defender.x - attacker.x, dy = defender.y - attacker.y;
    if (Math.hypot(dx, dy) > STUN_RANGE + Number(defender.size ?? 60) / 2) return false;
    return Math.abs(angleDelta(attacker.rotation ?? 0, vectorToCompassDegrees(dx, dy))) <= 50;
}

export function attackerDamageMultiplier(attacker) {
    return Math.max(0, Number(attacker?.attackDamageMultiplier ?? 1));
}

export function incomingMeleeDamage(attacker) {
    return Math.round(MELEE_DAMAGE * attackerDamageMultiplier(attacker));
}

export function incomingGunDamage(attacker, defender) {
    const distance = Math.hypot(defender.x - attacker.x, defender.y - attacker.y);
    let damage = 0;
    if (distance <= RANGED_DAMAGE_FALLOFF[0].distance) damage = RANGED_DAMAGE_FALLOFF[0].damage;
    else for (let index = 1; index < RANGED_DAMAGE_FALLOFF.length; index += 1) {
        const previous = RANGED_DAMAGE_FALLOFF[index - 1], next = RANGED_DAMAGE_FALLOFF[index];
        if (distance <= next.distance) {
            damage = interpolate(distance, previous.distance, next.distance, previous.damage, next.damage);
            break;
        }
    }
    return Math.round(damage * attackerDamageMultiplier(attacker));
}

function applyPrototypeTrigger(attacker, defender) {
    const action = attacker?.prototypeTriggered;
    const ability = PROTOTYPE_ACTION_TO_ABILITY[action];
    if (!action || !ability) return [attacker, defender];
    const stats = PROTOTYPE_ABILITY_STATS[ability] ?? {};
    const distance = defender ? Math.hypot(defender.x - attacker.x, defender.y - attacker.y) : Infinity;
    const bearing = defender ? vectorToCompassDegrees(defender.x - attacker.x, defender.y - attacker.y) : Number(attacker.rotation ?? 0);
    const facing = Math.abs(angleDelta(attacker.rotation ?? 0, bearing));
    const meleeArc = ["heavy_slash", "quick_jab", "thrust"].includes(ability);
    const inRange = Boolean(defender) && distance <= Number(stats.range ?? stats.radius ?? Infinity) + (meleeArc ? Number(defender.size ?? 60) / 2 : 0);
    const rayAbility = ["pistol_shot", "concussive_shot", "rail_shot"].includes(ability);
    const directHit = Boolean(defender) && (rayAbility ? rayIntersectsCircle(attacker, Number(attacker.rotation ?? 0), Number(stats.range ?? 0), defender) : inRange && facing <= (meleeArc ? 28 : 18));
    const acceptsHostileEffects = !ignoresHostileEffects(defender);
    const effectiveDirectHit = directHit && acceptsHostileEffects;
    const activationVisualMs = ["reactive_armor", "absolute_guard"].includes(ability) ? 300 : Math.max(300, Number(stats.visualMs ?? stats.durationMs ?? 0));
    let nextAttacker = {
        ...attacker,
        prototypeVisual: {
            ability,
            ms: activationVisualMs,
            x: Number(attacker.x ?? 0),
            y: Number(attacker.y ?? 0),
            rotation: Number(attacker.rotation ?? 0),
        },
    };
    if (!defender) return [nextAttacker, defender];
    let nextDefender = defender;
    let directHitShield = null;
    if (["heavy_slash", "quick_jab", "thrust", "pistol_shot", "rail_shot", "concussive_shot"].includes(ability) && effectiveDirectHit) {
        const baseDamage = ability === "quick_jab"
            ? Math.min(Number(stats.maxComboDamage ?? 15), Number(stats.damage ?? 8) + Number(attacker.quickJabComboCount ?? 0))
            : ability === "pistol_shot"
                ? Number((stats.falloffDamage ?? [8, 6, 4])[Math.min(2, Math.floor(distance / (Number(stats.range ?? 500) / 3)))] ?? 4)
                : Number(stats.damage ?? 0);
        const shield = resolveAbilityShield(defender, attacker, ability);
        directHitShield = shield;
        nextDefender = shield.fighter;
        if (!shield.preventedEffects.has(EFFECT_TYPES.DAMAGE)) [nextAttacker, nextDefender] = applyDamageFromShapes(nextAttacker, nextDefender, baseDamage * attackerDamageMultiplier(attacker));
        if (ability === "heavy_slash" && isAliveFighter(nextDefender) && !shield.preventedEffects.has(EFFECT_TYPES.DEBUFF)) nextDefender = {
            ...nextDefender,
            bleedRemainingMs: Number(stats.bleedDurationMs ?? 5000),
            // A second slash refreshes duration but does not postpone the
            // bleed tick already counting down.
            bleedTickMs: Number(nextDefender.bleedRemainingMs ?? 0) > 0
                ? Math.max(0, Number(nextDefender.bleedTickMs ?? 0))
                : Number(stats.bleedTickMs ?? 1000),
            bleedDamage: Math.max(Number(nextDefender.bleedDamage ?? 0), Number(stats.bleedDamage ?? 2)),
        };
        if (ability === "quick_jab") nextAttacker = { ...nextAttacker, quickJabComboCount: Math.min(7, Number(attacker.quickJabComboCount ?? 0) + 1), quickJabComboMs: Number(stats.comboWindowMs ?? 1000) };
        if (ability === "rail_shot" && isAliveFighter(nextDefender) && !shield.preventedEffects.has(EFFECT_TYPES.DEBUFF)) nextDefender = { ...nextDefender, shockRemainingMs: Number(stats.shockDurationMs ?? 3000), shockTickElapsedMs: 0 };
    }
    if (ability === "concussive_shot" && effectiveDirectHit) {
        // Damage and slow share the one shield resolution performed above.
        const shield = directHitShield ?? resolveAbilityShield(defender, attacker, ability);
        if (isAliveFighter(nextDefender) && !shield.preventedEffects.has(EFFECT_TYPES.DEBUFF)) nextDefender = { ...nextDefender, slowedMs: Math.max(nextDefender.slowedMs ?? 0, 2000) };
    }
    if (ability === "repulsor_burst" && inRange && acceptsHostileEffects) {
        const shield = resolveAbilityShield(nextDefender, attacker, ability);
        nextDefender = shield.fighter;
        if (!shield.preventedEffects.has(EFFECT_TYPES.DAMAGE)) nextDefender = applyDamageToShape(nextDefender, Number(stats.damage ?? 20) * attackerDamageMultiplier(attacker));
        const magnitude = Math.max(1, distance);
        const knockback = Number(stats.knockback ?? 250);
        nextDefender = { ...nextDefender, x: clamp(nextDefender.x + (nextDefender.x - attacker.x) / magnitude * knockback, nextDefender.size / 2, ARENA_WIDTH_UNITS - nextDefender.size / 2), y: clamp(nextDefender.y + (nextDefender.y - attacker.y) / magnitude * knockback, nextDefender.size / 2, ARENA_HEIGHT_UNITS - nextDefender.size / 2) };
    }
    if (ability === "thrust" && effectiveDirectHit && distance > 0) nextDefender = { ...nextDefender, x: clamp(nextDefender.x + (defender.x - attacker.x) / distance * 30, nextDefender.size / 2, ARENA_WIDTH_UNITS - nextDefender.size / 2), y: clamp(nextDefender.y + (defender.y - attacker.y) / distance * 30, nextDefender.size / 2, ARENA_HEIGHT_UNITS - nextDefender.size / 2) };
    if (ability === "repair_pulse") nextAttacker = { ...nextAttacker, pendingHealing: Number(nextAttacker.pendingHealing ?? 0) + Number(stats.healing ?? 15) };
    if (ability === "temporal_rewind") nextAttacker = {
        ...nextAttacker,
        temporalRewindX: attacker.x,
        temporalRewindY: attacker.y,
        temporalRewindVisualX: attacker.x,
        temporalRewindVisualY: attacker.y,
        temporalRewindHp: attacker.hp,
        temporalRewindMs: Number(stats.delayMs ?? 3000),
        temporalRewindPulseMs: 0,
    };
    if (ability === "phase_strike" && distance <= Number(stats.range ?? 160)) {
        const radians = compassDegreesToRadians(bearing);
        const passThrough = Number(stats.passThroughDistance ?? 50);
        nextAttacker = { ...nextAttacker, x: clamp(defender.x + Math.cos(radians) * passThrough, attacker.size / 2, ARENA_WIDTH_UNITS - attacker.size / 2), y: clamp(defender.y + Math.sin(radians) * passThrough, attacker.size / 2, ARENA_HEIGHT_UNITS - attacker.size / 2) };
        if (action === "phase_strike" || action === "phase_strike_face_origin") nextAttacker.rotation = normalizeAngle(bearing + 180);
        else if (action === "phase_strike_mirror_facing") nextAttacker.rotation = normalizeAngle(2 * bearing - Number(attacker.rotation ?? 0));
        nextDefender = applyDamageToShape(nextDefender, Number(stats.damage ?? 14) * attackerDamageMultiplier(attacker));
    }
    return [nextAttacker, nextDefender];
}

function resolveBlockOrDamage(attacker, defender, damage, abilityId) {
    const shield = resolveAbilityShield(defender, attacker, abilityId);
    return shield.preventedEffects.has(EFFECT_TYPES.DAMAGE)
        ? [attacker, shield.fighter]
        : applyDamageFromShapes(attacker, shield.fighter, damage);
}

function resolveAbilityShield(defender, source, abilityId) {
    if (ignoresHostileEffects(defender)) {
        return { fighter: defender, blocked: true, preventedEffects: new Set(Object.values(EFFECT_TYPES)) };
    }
    return resolveShieldInteraction(defender, source, abilityContract(abilityId)?.shieldInteraction);
}

function isGunHitting(attacker, defender) {
    return Boolean(attacker.gunShotActive) && rayIntersectsCircle(attacker, Number(attacker.rotation ?? 0), GUN_RANGE, defender);
}

function interpolate(value, min, max, near, far) {
    const t = clamp((value - min) / (max - min), 0, 1);
    return near + (far - near) * t;
}

function hasAbility(shape, ability) {
    return Array.isArray(shape?.abilities) && shape.abilities.includes(ability);
}
