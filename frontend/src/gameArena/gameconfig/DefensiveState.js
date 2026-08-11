/** Central bot interaction policy. Target selection is intentionally separate. */
export function isAliveBot(shape) {
    return Number(shape?.hp ?? 0) > 0;
}

export function isProjectileHittable(shape) {
    return isAliveBot(shape) && shape?.projectileHittable !== false;
}

/** Incoming systems must consult this before mutating hostile state. */
export function ignoresHostileEffects(shape) {
    return !isAliveBot(shape) || Number(shape?.abilityActiveMs?.[23] ?? 0) > 0;
}

/** Clears gameplay effects when HP crosses to zero while preserving cooldowns and preparation state. */
export function withoutBotStatuses(shape) {
    return {
        ...shape,
        shieldHp: 0,
        slowedMs: 0,
        hitStaggerMs: 0,
        silencedMs: 0,
        nullZoneSilenced: false,
        stunnedMs: 0,
        movementLockMs: 0,
        shockRemainingMs: 0,
        shockTickElapsedMs: 0,
        shockSourceSlot: null,
        burnRemainingMs: 0,
        burnTickMs: 0,
        burnDamageMultiplier: 1,
        burnSourceSlot: null,
        bleedRemainingMs: 0,
        bleedTickMs: 0,
        bleedDamage: 0,
        bleedSourceSlot: null,
        abilityActiveMs: {},
        quickJabComboCount: 0,
        quickJabComboMs: 0,
        temporalRewindMs: 0,
        temporalRewindPulseMs: 0,
        temporalRewindX: null,
        temporalRewindY: null,
        temporalRewindHp: null,
        temporalRewindVisualX: null,
        temporalRewindVisualY: null,
        abilityVisual: null,
        pendingHealing: 0,
    };
}
