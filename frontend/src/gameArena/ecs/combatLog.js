/**
 * Optional combat log for one browser tick. Mirrors the server's CombatLog.java: same entry fields,
 * same kinds, same stage names, so the two logs can be diffed.
 *
 * The log is off unless a caller passes one to the tick (`advanceArenaPreviewTick(..., { combatLog })`).
 * While a tick runs, the pipeline binds the log here so the effect, status and stamina funnels can append
 * to it without every function in the call chain carrying a parameter. Ticks are synchronous, so one
 * module-level binding is enough.
 *
 * Entry: { tick, stage, kind, source, target, abilityId, effect, amount }
 *   kind: trigger | effect | status | spawn | phase | removal | stamina
 *   source/target: "bot<slot>" for a bot, "<type>:<ownerSlot>:<serial>" for an entity (its id differs per
 *   runtime, this form does not), null when there is none.
 */
export const COMBAT_STAGES = Object.freeze([
    "decide", "act", "resolveHits", "spawn", "entities", "hazards", "settle",
]);

let active = null;

export function createCombatLog() {
    return { entries: [], tick: 0, stage: null, abilityId: null };
}

/** Runs `fn` with `log` bound as the active log (or with logging off when `log` is null). */
export function withCombatLog(log, fn) {
    const previous = active;
    active = log ?? null;
    try {
        return fn();
    } finally {
        active = previous;
    }
}

export function combatLogActive() {
    return active !== null;
}

export function beginCombatTick(tick = null) {
    if (!active) return;
    active.tick = tick ?? active.tick + 1;
    active.stage = null;
    active.abilityId = null;
}

export function setCombatStage(stage) {
    if (active) active.stage = stage;
}

/** Runs `fn` with `abilityId` as the ability that entries without their own ability are attributed to. */
export function withCombatAbility(abilityId, fn) {
    if (!active) return fn();
    const previous = active.abilityId;
    active.abilityId = abilityId ?? null;
    try {
        return fn();
    } finally {
        active.abilityId = previous;
    }
}

/** "bot<slot>" for a bot-like shape or a bare slot number; null when there is no slot. */
export function botRef(value) {
    const slot = typeof value === "object" && value !== null
        ? Number(value.slot ?? value.ownerSlot)
        : Number(value);
    return value == null || !Number.isFinite(slot) ? null : `bot${slot}`;
}

/** "<type>:<ownerSlot>:<serial>": the entity id minus the owner naming that differs between runtimes. */
export function entityRef(entity) {
    if (!entity) return null;
    const serial = /(\d+)$/.exec(String(entity.id ?? ""))?.[1] ?? "0";
    return `${entity.type}:${entity.ownerSlot}:${serial}`;
}

/** A bot shape is "bot<slot>"; an entity (which has no slot of its own) is its entityRef. */
export function targetRef(value) {
    return Number.isFinite(Number(value?.slot)) ? botRef(value) : entityRef(value);
}

function rounded(value) {
    if (value == null) return null;
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) return null;
    const result = Math.round(numeric * 1000) / 1000;
    return result === 0 ? 0 : result;
}

export function logCombat(kind, { source = null, target = null, abilityId, effect = null, amount = null } = {}) {
    if (!active) return;
    active.entries.push({
        tick: active.tick,
        stage: active.stage,
        kind,
        source,
        target,
        abilityId: abilityId ?? active.abilityId ?? null,
        effect,
        amount: rounded(amount),
    });
}
