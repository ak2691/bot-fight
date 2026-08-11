import { ABILITY_STATS } from "../gameconfig/Abilities.js";
import { withoutBotStatuses } from "../gameconfig/DefensiveState.js";

/** Advances cooldown, resource, timed-effect, and delayed-state components. */
export function tickBotStatus(shape, elapsedMs, applyDamage) {
    if ((shape.hp ?? 0) <= 0) {
        return {
            ...shape,
            hp: 0,
            matchElapsedMs: Math.min(99_999_000, Math.max(0, Number(shape.matchElapsedMs ?? 0) + elapsedMs)),
            hitFlashMs: timer(shape.hitFlashMs, elapsedMs),
            hitStaggerMs: 0,
            abilityActiveMs: mapTimers(shape.abilityActiveMs, elapsedMs),
            thrownGrenade: null,
            thrownFireball: null,
            abilityVisual: shape.abilityVisual ? { ...shape.abilityVisual, ms: timer(shape.abilityVisual.ms, elapsedMs) } : null,
            triggeredAbility: null,
            abilitySpawn: null,
            microDashActiveMs: 0,
            microDashRemaining: 0,
            movementVelocityX: 0,
            movementVelocityY: 0,
            velocityX: 0,
            velocityY: 0,
            entityHitIds: [],
        };
    }
    const blockRecharge = rechargeBlockCharges(shape, elapsedMs);
    const abilityCooldowns = mapTimers(shape.abilityCooldowns, elapsedMs);
    const abilityCharges = rechargeMicroDash(shape, abilityCooldowns);
    const abilityActiveMs = mapTimers(shape.abilityActiveMs, elapsedMs);
    const quickJabComboMs = Math.max(0, Number(shape.quickJabComboMs ?? 0) - elapsedMs);
    const shockRemainingMs = Math.max(0, Number(shape.shockRemainingMs ?? 0) - elapsedMs);
    const shockElapsed = Number(shape.shockTickElapsedMs ?? 0) + (Number(shape.shockRemainingMs ?? 0) > 0 ? elapsedMs : 0);
    const shockInterval = Number(ABILITY_STATS[13].shockTickMs ?? 1000);
    const shockTicked = Number(shape.shockRemainingMs ?? 0) > 0 && shockElapsed >= shockInterval;
    const burnTick = tickBurn(shape, elapsedMs, applyDamage);
    const bleedTick = tickBleed({ ...shape, ...burnTick }, elapsedMs, applyDamage);
    const rewindWasPending = Number(shape.temporalRewindMs ?? 0) > 0;
    const temporalRewindMs = Math.max(0, Number(shape.temporalRewindMs ?? 0) - elapsedMs);
    const rewindCompletes = rewindWasPending && temporalRewindMs <= 0;
    const temporalRewindPulseMs = rewindCompletes
        ? Number(ABILITY_STATS[21].pulseMs ?? 400)
        : timer(shape.temporalRewindPulseMs, elapsedMs);
    const shockTick = shockTicked
        ? (() => {
            const previousHp = Number(bleedTick.hp ?? 0);
            const damaged = applyDamage(
                { ...shape, ...bleedTick, hp: bleedTick.hp, damageTakenThisTick: bleedTick.damageTakenThisTick },
                Number(ABILITY_STATS[13].shockDamage ?? 3),
                statusSource(shape.shockSourceSlot),
            );
            return { ...damaged, hitStaggerMs: Number(damaged.hp ?? 0) < previousHp ? Number(damaged.hitStaggerMs ?? 0) : 0 };
        })()
        : { hp: bleedTick.hp, damageTakenThisTick: bleedTick.damageTakenThisTick, hitStaggerMs: 0 };
    const statusHp = shockTick.hp;
    const next = {
        ...shape,
        matchElapsedMs: Math.min(99_999_000, Math.max(0, Number(shape.matchElapsedMs ?? 0) + elapsedMs)),
        hitFlashMs: timer(shape.hitFlashMs, elapsedMs),
        slowedMs: timer(shape.slowedMs, elapsedMs),
        silencedMs: timer(shape.silencedMs, elapsedMs),
        movementLockMs: Math.max(shockTicked ? Number(ABILITY_STATS[13].movementLockMs ?? 300) : 0, timer(shape.movementLockMs, elapsedMs)),
        shockRemainingMs,
        shockSourceSlot: shockRemainingMs > 0 ? shape.shockSourceSlot ?? null : null,
        shockTickElapsedMs: shockTicked ? shockElapsed - shockInterval : shockElapsed,
        swingCooldownMs: timer(shape.swingCooldownMs, elapsedMs),
        blockCooldownMs: timer(shape.blockCooldownMs, elapsedMs),
        blockCharges: blockRecharge.charges,
        blockRechargeMs: blockRecharge.rechargeMs,
        gunCooldownMs: timer(shape.gunCooldownMs, elapsedMs),
        ...tickGunReload(shape, elapsedMs),
        grenadeCooldownMs: timer(shape.grenadeCooldownMs, elapsedMs),
        thrownGrenade: null,
        fireballCooldownMs: timer(shape.fireballCooldownMs, elapsedMs),
        ...tickFireballReload(shape, elapsedMs),
        thrownFireball: null,
        stunCooldownMs: timer(shape.stunCooldownMs, elapsedMs),
        stunnedMs: timer(shape.stunnedMs, elapsedMs),
        ...burnTick,
        ...bleedTick,
        hitStaggerMs: statusHp <= 0 ? 0 : Math.max(
            timer(shape.hitStaggerMs, elapsedMs),
            Number(burnTick.hitStaggerMs ?? 0),
            Number(bleedTick.hitStaggerMs ?? 0),
            Number(shockTick.hitStaggerMs ?? 0),
        ),
        x: rewindCompletes ? Number(shape.temporalRewindX ?? shape.x) : shape.x,
        y: rewindCompletes ? Number(shape.temporalRewindY ?? shape.y) : shape.y,
        hp: rewindCompletes ? Math.min(Number(shape.maxHp ?? 100), Number(shape.temporalRewindHp ?? statusHp)) : statusHp,
        temporalRewindMs,
        temporalRewindPulseMs,
        temporalRewindX: rewindCompletes ? null : shape.temporalRewindX,
        temporalRewindY: rewindCompletes ? null : shape.temporalRewindY,
        temporalRewindHp: rewindCompletes ? null : shape.temporalRewindHp,
        temporalRewindVisualX: temporalRewindMs > 0 || temporalRewindPulseMs > 0 ? shape.temporalRewindVisualX : null,
        temporalRewindVisualY: temporalRewindMs > 0 || temporalRewindPulseMs > 0 ? shape.temporalRewindVisualY : null,
        microDashActiveMs: timer(shape.microDashActiveMs, elapsedMs),
        microDashTrailMs: timer(shape.microDashTrailMs, elapsedMs),
        abilityCooldowns,
        abilityCharges,
        abilityActiveMs,
        abilityVisual: shape.abilityVisual ? { ...shape.abilityVisual, ms: timer(shape.abilityVisual.ms, elapsedMs) } : null,
        triggeredAbility: null,
        quickJabComboMs,
        quickJabComboCount: quickJabComboMs > 0 ? Number(shape.quickJabComboCount ?? 0) : 0,
        entityHitIds: [],
    };
    return Number(next.hp ?? 0) <= 0 ? withoutBotStatuses(next) : next;
}

function tickGunReload(shape, elapsedMs) {
    if (!hasAbility(shape, 3)) return { gunAmmo: 0, gunReloadMs: 0 };
    const ammoMax = ABILITY_STATS[3].ammoMax;
    const ammo = Math.max(0, Math.min(ammoMax, Math.round(Number(shape.gunAmmo ?? ammoMax))));
    const reloadMs = timer(shape.gunReloadMs, elapsedMs);
    return ammo <= 0 && reloadMs <= 0
        ? { gunAmmo: ammoMax, gunReloadMs: 0 }
        : { gunAmmo: ammo, gunReloadMs: reloadMs };
}

function tickFireballReload(shape, elapsedMs) {
    if (!hasAbility(shape, 5)) return { fireballCharges: 0, fireballReloadMs: 0 };
    const maxCharges = ABILITY_STATS[5].maxCharges;
    const charges = Math.max(0, Math.min(maxCharges, Math.round(Number(shape.fireballCharges ?? maxCharges))));
    const reloadMs = timer(shape.fireballReloadMs, elapsedMs);
    return charges <= 0 && reloadMs <= 0
        ? { fireballCharges: maxCharges, fireballReloadMs: 0 }
        : { fireballCharges: charges, fireballReloadMs: reloadMs };
}

function tickBurn(shape, elapsedMs, applyDamage) {
    const previousRemainingMs = Math.max(0, Number(shape.burnRemainingMs ?? 0));
    const remainingMs = timer(previousRemainingMs, elapsedMs);
    let nextTickDueMs = Math.max(0, Number(shape.burnTickMs ?? 0));
    let hp = shape.hp;
    let damageTakenThisTick = Number(shape.damageTakenThisTick ?? 0);
    let hitStaggerMs = 0;
    const activeElapsedMs = Math.min(elapsedMs, previousRemainingMs);
    while (previousRemainingMs > 0 && nextTickDueMs <= activeElapsedMs) {
        const previousHp = Number(hp ?? 0);
        const damaged = applyDamage({ ...shape, hp, damageTakenThisTick }, ABILITY_STATS[5].burnDamage * (shape.burnDamageMultiplier ?? 1), statusSource(shape.burnSourceSlot));
        if (Number(damaged.hp ?? 0) < previousHp) hitStaggerMs = Math.max(hitStaggerMs, Number(damaged.hitStaggerMs ?? 0));
        hp = damaged.hp;
        damageTakenThisTick = Number(damaged.damageTakenThisTick ?? damageTakenThisTick);
        shape = damaged;
        nextTickDueMs += ABILITY_STATS[5].burnTickMs;
    }
    const tickMs = remainingMs > 0 ? Math.max(0, nextTickDueMs - elapsedMs) : 0;
    return {
        hp,
        damageTakenThisTick,
        hitStaggerMs,
        burnRemainingMs: remainingMs,
        burnTickMs: tickMs,
        burnDamageMultiplier: remainingMs > 0 ? shape.burnDamageMultiplier ?? 1 : 1,
        burnSourceSlot: remainingMs > 0 ? shape.burnSourceSlot ?? null : null,
    };
}

function tickBleed(shape, elapsedMs, applyDamage) {
    const previousRemainingMs = Math.max(0, Number(shape.bleedRemainingMs ?? 0));
    const remainingMs = timer(previousRemainingMs, elapsedMs);
    let nextTickDueMs = Math.max(0, Number(shape.bleedTickMs ?? 0));
    let hp = shape.hp;
    let damageTakenThisTick = Number(shape.damageTakenThisTick ?? 0);
    let hitStaggerMs = 0;
    const activeElapsedMs = Math.min(elapsedMs, previousRemainingMs);
    while (previousRemainingMs > 0 && nextTickDueMs <= activeElapsedMs) {
        const previousHp = Number(hp ?? 0);
        const damaged = applyDamage({ ...shape, hp, damageTakenThisTick }, Number(shape.bleedDamage ?? 2), statusSource(shape.bleedSourceSlot));
        if (Number(damaged.hp ?? 0) < previousHp) hitStaggerMs = Math.max(hitStaggerMs, Number(damaged.hitStaggerMs ?? 0));
        hp = damaged.hp;
        damageTakenThisTick = Number(damaged.damageTakenThisTick ?? damageTakenThisTick);
        shape = damaged;
        nextTickDueMs += Number(ABILITY_STATS[7].bleedTickMs ?? 1000);
    }
    const tickMs = remainingMs > 0 ? Math.max(0, nextTickDueMs - elapsedMs) : 0;
    return {
        hp,
        damageTakenThisTick,
        hitStaggerMs,
        bleedRemainingMs: remainingMs,
        bleedTickMs: tickMs,
        bleedDamage: remainingMs > 0 ? Number(shape.bleedDamage ?? 2) : 0,
        bleedSourceSlot: remainingMs > 0 ? shape.bleedSourceSlot ?? null : null,
    };
}

function statusSource(slot) {
    const sourceSlot = Number(slot);
    return Number.isFinite(sourceSlot) ? { ownerSlot: sourceSlot } : null;
}

function rechargeBlockCharges(shape, elapsedMs) {
    if (!hasAbility(shape, 2)) return { charges: 0, rechargeMs: 0 };
    const maxCharges = ABILITY_STATS[2].maxCharges;
    const rechargeIntervalMs = ABILITY_STATS[2].rechargeMs;
    let charges = Math.max(0, Math.min(maxCharges, Math.round(Number(shape.blockCharges ?? maxCharges))));
    let rechargeMs = Math.max(0, Number(shape.blockRechargeMs ?? shape.blockCooldownMs ?? 0));
    if (charges >= maxCharges) return { charges: maxCharges, rechargeMs: 0 };
    rechargeMs += elapsedMs;
    while (charges < maxCharges && rechargeMs >= rechargeIntervalMs) {
        charges += 1;
        rechargeMs -= rechargeIntervalMs;
    }
    return { charges, rechargeMs: charges >= maxCharges ? 0 : rechargeMs };
}

function rechargeMicroDash(shape, abilityCooldowns) {
    const current = { ...(shape.abilityCharges ?? {}) };
    if (hasAbility(shape, 19) && Number(abilityCooldowns[19] ?? 0) <= 0) current[19] = 1;
    return current;
}

function mapTimers(values, elapsedMs) {
    return Object.fromEntries(Object.entries(values ?? {}).map(([id, value]) => [id, timer(value, elapsedMs)]));
}

function timer(value, elapsedMs) {
    return Math.max(0, Number(value ?? 0) - elapsedMs);
}

function hasAbility(shape, ability) {
    return Array.isArray(shape?.abilities) && shape.abilities.includes(ability);
}
