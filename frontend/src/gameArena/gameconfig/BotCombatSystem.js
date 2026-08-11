import { ignoresHostileEffects, withoutBotStatuses } from "./DefensiveState.js";
import { HIT_STAGGER_DURATION_MS } from "./HitStagger.js";
import { resolveTriggeredAbilityEffects } from "../ecs/AbilityEffectSystem.js";

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
    let remaining = Math.max(0, Number(damage) || 0);
    if (Number(shape.abilityActiveMs?.[16] ?? 0) > 0) remaining *= 0.5;
    let shieldHp = Math.max(0, Number(shape.shieldHp ?? 0));
    if (shieldHp > 0 && remaining > 0) {
        const absorbed = Math.min(shieldHp, remaining);
        shieldHp -= absorbed;
        remaining -= absorbed;
    }
    const hpBefore = Number(shape.hp ?? shape.maxHp ?? 100);
    const hp = remaining > 0 ? Math.max(0, hpBefore - remaining) : shape.hp;
    const appliedDamage = Math.max(0, hpBefore - Number(hp));
    const hostile = isHostileDamageSource(source, shape);
    const damaged = {
        ...shape,
        hp,
        damageTakenThisTick: Number(shape.damageTakenThisTick ?? 0) + appliedDamage,
        hitFlashMs: 200,
        ...(shape.shieldHp == null ? {} : { shieldHp }),
        hitStaggerMs: appliedDamage > 0 && hostile
            ? Math.max(Number(shape.hitStaggerMs ?? 0), HIT_STAGGER_DURATION_MS)
            : Number(shape.hitStaggerMs ?? 0),
    };
    return hp <= 0 ? withoutBotStatuses(damaged) : damaged;
}

export function settlePendingHealing(shape) {
    const healing = Math.max(0, Number(shape?.pendingHealing ?? 0));
    if (!shape || healing <= 0) return shape;
    return { ...shape, hp: Math.min(Number(shape.maxHp ?? 100), Number(shape.hp ?? 0) + healing), pendingHealing: 0 };
}

export function applyDamageFromShapes(source, target, damage) {
    const reflecting = source?.id !== target?.id && Number(target?.abilityActiveMs?.[16] ?? 0) > 0;
    const nextTarget = applyDamageToShape(target, damage, source);
    const nextSource = reflecting ? applyDamageToShape(source, Math.max(0, Number(damage) || 0) * 0.5, target) : source;
    return [nextSource, nextTarget];
}

function isHostileDamageSource(source, target) {
    const sourceSlot = Number(source?.slot ?? source?.ownerSlot);
    const targetSlot = Number(target?.slot);
    return Number.isFinite(sourceSlot) && Number.isFinite(targetSlot) && sourceSlot !== targetSlot;
}
