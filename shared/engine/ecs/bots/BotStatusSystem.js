import { withoutBotStatuses } from "../../gameconfig/DefensiveState.js";
import {
    STATUS_EFFECT_APPLICATIONS,
    normalizeStatusEffect,
    statusEffectsFor,
    upsertStatusEffect,
} from "../contracts/StatusContracts.js";

/** Advances every timed status and applies its declarative tick effects. */
export function tickBotStatus(shape, elapsedMs, applyDamage) {
    if ((shape.hp ?? 0) <= 0) return shape;

    const elapsed = Math.max(0, Number(elapsedMs) || 0);
    const statuses = new Map();
    for (const rawStatus of statusEffectsFor(shape)) {
        const normalized = normalizeStatusEffect(rawStatus);
        const key = `${normalized.type}:${normalized.mode}`;
        const existing = statuses.get(key);
        statuses.set(key, existing && existing.remainingMs > normalized.remainingMs ? existing : normalized);
    }

    // Keep every active status visible while any one status applies a tick.
    // Incoming modifiers must see sibling statuses regardless of map order.
    let next = { ...shape, statusEffects: [...statuses.values()] };
    // Only statuses that existed at the start of this elapsed interval are
    // advanced. Tick effects may create or refresh statuses for the next
    // interval, but those statuses must not lose the same elapsed time twice.
    for (const [key, initialStatus] of [...statuses.entries()]) {
        const status = statuses.get(key) ?? initialStatus;
        if (status.mode === "presence") continue;

        const previousRemainingMs = status.remainingMs;
        if (previousRemainingMs <= 0) {
            statuses.delete(key);
            next = { ...next, statusEffects: [...statuses.values()] };
            continue;
        }
        let tickElapsedMs = Number(status.tickElapsedMs ?? 0);
        const activeElapsedMs = Math.min(elapsed, previousRemainingMs);
        const tickMs = Math.max(0, Number(status.tickMs ?? 0));
        const remainingMs = Math.max(0, previousRemainingMs - elapsed);
        const tickedStatus = { ...status, remainingMs, ...(tickMs > 0 ? { tickElapsedMs } : {}) };
        if (remainingMs > 0) statuses.set(key, tickedStatus);
        else statuses.delete(key);
        next = { ...next, statusEffects: [...statuses.values()] };
        if (tickMs > 0) {
            tickElapsedMs += activeElapsedMs;
            while (tickElapsedMs >= tickMs) {
                for (const effect of status.effects.filter(({ mode }) => mode === "tick")) {
                    next = applyTickEffect(next, status, effect, applyDamage);
                    if (Number(next.hp ?? 0) <= 0) return withoutBotStatuses(next);
                    for (const changed of statusEffectsFor(next)) {
                        statuses.set(`${changed.type}:${changed.mode}`, changed);
                    }
                }
                tickElapsedMs -= tickMs;
            }
            const current = statuses.get(key);
            if (current && current.remainingMs > 0) current.tickElapsedMs = tickElapsedMs;
        }
        next = { ...next, statusEffects: [...statuses.values()] };
    }
    return Number(next.hp ?? 0) <= 0 ? withoutBotStatuses(next) : next;
}

function applyTickEffect(shape, status, effect, applyDamage) {
    if (effect.type === STATUS_EFFECT_APPLICATIONS.DAMAGE) {
        const amount = Math.max(0, Number(effect.amount ?? 0) * Number(effect.multiplier ?? 1));
        if (amount <= 0) return shape;
        return applyDamage(
            { ...shape, damageTakenThisTick: Number(shape.damageTakenThisTick ?? 0) },
            amount,
            statusSource(status.sourceSlot, status.type),
        );
    }
    if (effect.type === STATUS_EFFECT_APPLICATIONS.MOVEMENT_LOCK) {
        const durationMs = Math.max(0, Number(effect.durationMs ?? 0));
        if (durationMs <= 0) return shape;
        return upsertStatusEffect(shape, {
            type: "movement-lock",
            remainingMs: durationMs,
            effects: [],
        });
    }
    return shape;
}

function statusSource(slot, statusType) {
    const sourceSlot = Number(slot);
    return {
        damageSourceKind: "status",
        damageSourceType: String(statusType ?? "").toLowerCase(),
        ...(Number.isFinite(sourceSlot) ? { ownerSlot: sourceSlot } : {}),
    };
}
