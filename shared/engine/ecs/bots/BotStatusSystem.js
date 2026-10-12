import { withoutBotStatuses } from "../../gameconfig/DefensiveState.js";
import { isEntityShape } from "../entities/EntityCombat.js";
import {
    normalizeStatusEffect,
    statusEffectsFor,
} from "../contracts/StatusContracts.js";
import { runStatusEffects } from "../abilities/effects.js";
import { PHASE_EVENT_TYPES } from "../../gameconfig/vocabulary.js";

/**
 * Advances every timed status of a bot or an HP entity, in place. A status's `schedule` event runs its effects
 * every tick it is held, and its `lifetimeEnd` event runs once when its clock counts down to 0 (not when the
 * statuses are cleared by a death). Effects go through the effect registry, as a phase's effects do.
 */
export function tickStatuses(shape, elapsedMs, bots = []) {
    const entity = isEntityShape(shape);
    if (!entity && (shape.hp ?? 0) <= 0) return shape;
    if (statusEffectsFor(shape).length === 0) return shape;

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
                runStatusEvent(shape, status, PHASE_EVENT_TYPES.SCHEDULE, bots);
                if (!entity && Number(shape.hp ?? 0) <= 0) return withoutBotStatuses(shape);
                for (const changed of statusEffectsFor(shape)) {
                    statuses.set(`${changed.type}:${changed.mode}`, changed);
                }
                tickElapsedMs -= tickMs;
            }
            const current = statuses.get(key);
            if (current && current.remainingMs > 0) current.tickElapsedMs = tickElapsedMs;
        }
        if (remainingMs <= 0) {
            runStatusEvent(shape, status, PHASE_EVENT_TYPES.LIFETIME_END, bots);
            if (!entity && Number(shape.hp ?? 0) <= 0) return withoutBotStatuses(shape);
            for (const changed of statusEffectsFor(shape)) {
                statuses.set(`${changed.type}:${changed.mode}`, changed);
            }
        }
        shape.statusEffects = [...statuses.values()];
    }
    return !entity && Number(shape.hp ?? 0) <= 0 ? withoutBotStatuses(shape) : shape;
}

/**
 * Runs the effects of one schedule or lifetimeEnd event on the holder. The effects' source is the status's source bot
 * (its sourceSlot), as far as that bot is alive: its position is known then, and a source that is dead has none.
 */
function runStatusEvent(holder, status, eventType, bots) {
    const event = status.on?.[eventType];
    if (!event) return;
    runStatusEffects(holder, status, event.effects ?? [], { source: statusSourceOf(status, bots) });
}

/**
 * The source of a status's effects. It keeps the damage attribution it always had (a status source names its slot and
 * type, so bleed's exclusion and hit-stagger are unchanged), and adds the position of the living bot in sourceSlot.
 */
function statusSourceOf(status, bots) {
    const base = statusSource(status.sourceSlot, status.type);
    if (status.sourceSlot == null) return base;
    const sourceBot = bots.find((bot) => Number(bot.slot) === Number(status.sourceSlot) && Number(bot.hp ?? 0) > 0);
    return sourceBot ? { ...base, x: sourceBot.x, y: sourceBot.y } : base;
}

function statusSource(slot, statusType) {
    const sourceSlot = Number(slot);
    return {
        damageSourceKind: "status",
        damageSourceType: String(statusType ?? "").toLowerCase(),
        ownerSlot: Number.isFinite(sourceSlot) ? sourceSlot : undefined,
    };
}
