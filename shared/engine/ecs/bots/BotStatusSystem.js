import { withoutBotStatuses } from "../../gameconfig/DefensiveState.js";
import { withCombatAbility } from "../combatLog.js";
import {
    STATUS_EFFECT_APPLICATIONS,
    normalizeStatusEffect,
    statusEffectsFor,
} from "../contracts/StatusContracts.js";
import { applyStatus, dealDamage } from "../abilities/effects.js";

/**
 * Advances every timed status of the bot, in place, and applies its declarative tick effects (damage and
 * movement locks go through the combat mutators).
 */
export function tickBotStatus(shape, elapsedMs) {
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
    shape.statusEffects = [...statuses.values()];
    // Only statuses that existed at the start of this elapsed interval are
    // advanced. Tick effects may create or refresh statuses for the next
    // interval, but those statuses must not lose the same elapsed time twice.
    for (const [key, initialStatus] of [...statuses.entries()]) {
        const status = statuses.get(key) ?? initialStatus;
        if (status.mode === "presence") continue;
        // A sibling's tick effect refreshed this status during this interval (burn re-applying hit-stagger):
        // the refresh starts at full duration, whatever order the statuses are visited in.
        if (status.remainingMs !== initialStatus.remainingMs) continue;

        const previousRemainingMs = status.remainingMs;
        if (previousRemainingMs <= 0) {
            statuses.delete(key);
            shape.statusEffects = [...statuses.values()];
            continue;
        }
        let tickElapsedMs = Number(status.tickElapsedMs ?? 0);
        const activeElapsedMs = Math.min(elapsed, previousRemainingMs);
        const tickMs = Math.max(0, Number(status.tickMs ?? 0));
        const remainingMs = Math.max(0, previousRemainingMs - elapsed);
        const tickedStatus = { ...status, remainingMs, tickElapsedMs: tickMs > 0 ? tickElapsedMs : status.tickElapsedMs };
        if (remainingMs > 0) statuses.set(key, tickedStatus);
        else statuses.delete(key);
        shape.statusEffects = [...statuses.values()];
        if (tickMs > 0) {
            tickElapsedMs += activeElapsedMs;
            while (tickElapsedMs >= tickMs) {
                for (const effect of status.effects.filter(({ mode }) => mode === "tick")) {
                    withCombatAbility(status.abilityId, () => applyTickEffect(shape, status, effect));
                    if (Number(shape.hp ?? 0) <= 0) return withoutBotStatuses(shape);
                    for (const changed of statusEffectsFor(shape)) {
                        statuses.set(`${changed.type}:${changed.mode}`, changed);
                    }
                }
                tickElapsedMs -= tickMs;
            }
            const current = statuses.get(key);
            if (current && current.remainingMs > 0) current.tickElapsedMs = tickElapsedMs;
        }
        shape.statusEffects = [...statuses.values()];
    }
    return Number(shape.hp ?? 0) <= 0 ? withoutBotStatuses(shape) : shape;
}

function applyTickEffect(shape, status, effect) {
    if (effect.type === STATUS_EFFECT_APPLICATIONS.DAMAGE) {
        const amount = Math.max(0, Number(effect.amount ?? 0) * Number(effect.multiplier ?? 1));
        if (amount > 0) dealDamage(shape, amount, statusSource(status.sourceSlot, status.type));
    } else if (effect.type === STATUS_EFFECT_APPLICATIONS.MOVEMENT_LOCK) {
        const durationMs = Math.max(0, Number(effect.durationMs ?? 0));
        if (durationMs > 0) applyStatus(shape, { type: "movement-lock", remainingMs: durationMs, effects: [] });
    }
}

function statusSource(slot, statusType) {
    const sourceSlot = Number(slot);
    return {
        damageSourceKind: "status",
        damageSourceType: String(statusType ?? "").toLowerCase(),
        ownerSlot: Number.isFinite(sourceSlot) ? sourceSlot : undefined,
    };
}
