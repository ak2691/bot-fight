import { rechargeAbilityResources } from "../../gameconfig/AbilityResourceSystem.js";

const RESOURCE_COMPONENTS = Object.freeze([
    Object.freeze({ field: "abilityCooldowns", advanceWhenDead: false }),
    Object.freeze({ field: "abilityActiveMs", advanceWhenDead: true }),
]);

/** Advances bot-owned ability timing and resource components. */
export function tickBotResources(shape, elapsedMs) {
    const elapsed = Math.max(0, Number(elapsedMs) || 0);
    const alive = Number(shape?.hp ?? 0) > 0;
    const cooldownState = alive
        ? advanceCooldownState(
            shape?.abilityCooldowns,
            shape?.abilityPendingCooldownMs,
            shape?.abilityActiveMs,
            elapsed,
        )
        : {
            cooldowns: { ...(shape?.abilityCooldowns ?? {}) },
            pendingCooldowns: { ...(shape?.abilityPendingCooldownMs ?? {}) },
        };
    const timerUpdates = Object.fromEntries(
        RESOURCE_COMPONENTS
            .filter(({ advanceWhenDead }) => alive || advanceWhenDead)
            .map(({ field }) => [field, field === "abilityCooldowns"
                ? cooldownState.cooldowns
                : advanceTimerMap(shape?.[field], elapsed)]),
    );
    const timedShape = {
        ...shape,
        ...timerUpdates,
        abilityPendingCooldownMs: cooldownState.pendingCooldowns,
    };
    if (!alive) return timedShape;

    const resources = rechargeAbilityResources(timedShape, elapsed, shape?.abilityActiveMs);
    return {
        ...timedShape,
        abilityCharges: resources.charges,
        abilityRechargeMs: resources.rechargeMs,
    };
}

export function advanceTimerMap(values, elapsedMs) {
    const elapsed = Math.max(0, Number(elapsedMs) || 0);
    return Object.fromEntries(Object.entries(values ?? {}).map(([id, value]) => [
        id,
        Math.max(0, Number(value ?? 0) - elapsed),
    ]));
}

/** Advances cooldowns normally; Overclock is applied when a new cooldown is created. */
export function advanceCooldownMap(values, activeValues, elapsedMs) {
    return advanceCooldownState(values, {}, activeValues, elapsedMs).cooldowns;
}

export function advanceCooldownState(values, pendingValues, activeValues, elapsedMs) {
    const elapsed = Math.max(0, Number(elapsedMs) || 0);
    const cooldowns = { ...(values ?? {}) };
    const pendingCooldowns = { ...(pendingValues ?? {}) };
    const ids = new Set([
        ...Object.keys(cooldowns),
        ...Object.keys(pendingCooldowns),
        ...Object.keys(activeValues ?? {}),
    ]);
    for (const id of ids) {
        const activeRemaining = Math.max(0, Number(activeValues?.[id] ?? 0));
        const visible = Math.max(0, Number(cooldowns[id] ?? 0));
        const pending = Math.max(
            0,
            Number(pendingCooldowns[id] ?? 0),
            activeRemaining > 0 ? visible : 0,
        );
        if (activeRemaining > 0) {
            cooldowns[id] = 0;
            if (activeRemaining <= elapsed) {
                const recoveryElapsed = Math.max(0, elapsed - activeRemaining);
                cooldowns[id] = Math.max(0, pending - recoveryElapsed);
                delete pendingCooldowns[id];
            } else if (pending > 0) {
                pendingCooldowns[id] = pending;
            } else {
                delete pendingCooldowns[id];
            }
        } else {
            cooldowns[id] = Math.max(0, Math.max(visible, pending) - elapsed);
            delete pendingCooldowns[id];
        }
    }
    return { cooldowns, pendingCooldowns };
}
