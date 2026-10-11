import { abilityChannel } from "./AbilityChannels.js";

/**
 * The per-bot ability record: `abilityState[abilityId] = { stage, remainingMs, charges, reloadMs, target }`.
 *
 *   stage        "windup" | "active" | "cooldown" | "ready"
 *   remainingMs  time left in the current stage (0 when ready)
 *   cooldownMs   only while active: the cooldown that starts when the active stage ends
 *   charges      only for charge-bearing abilities; absent means full
 *   reloadMs     only for charge-bearing abilities: the reload time left once empty
 *   target       only while winding up: the activation target { x, y } the wind-up was started with
 *   steps        only while active, for an ability with delayed trigger verbs: the timeline of the activation
 *                { next, activeMs, serial, targetX, targetY, pose, hit }: `next` is the index of the next
 *                pending verb, `activeMs` the active time the activation was given, `pose` the captured pose
 *                (or null), `hit` the slots its activation-scoped hits already touched
 *
 * A missing record is a ready ability. The old loose fields (preparingAbility, abilityActiveMs, ...) no
 * longer exist on a bot; `abilityStateFromLegacy` reads them back from a replay frame.
 */
export const ABILITY_STAGES = Object.freeze({
    WINDUP: "windup",
    ACTIVE: "active",
    COOLDOWN: "cooldown",
    READY: "ready",
});

function positive(value) {
    return Math.max(0, Number(value) || 0);
}

export function abilityRecord(shape, abilityId) {
    return shape?.abilityState?.[abilityId] ?? null;
}

export function abilityStage(shape, abilityId) {
    return abilityRecord(shape, abilityId)?.stage ?? ABILITY_STAGES.READY;
}

function remainingIn(shape, abilityId, stage) {
    const record = abilityRecord(shape, abilityId);
    return record?.stage === stage ? positive(record.remainingMs) : 0;
}

/** Wind-up time left, 0 when the ability is not winding up. */
export function windupRemainingMs(shape, abilityId) {
    return remainingIn(shape, abilityId, ABILITY_STAGES.WINDUP);
}

/** Active time left, 0 when the ability is not active. */
export function activeRemainingMs(shape, abilityId) {
    return remainingIn(shape, abilityId, ABILITY_STAGES.ACTIVE);
}

/** The visible cooldown left (after the active stage), 0 otherwise. */
export function cooldownRemainingMs(shape, abilityId) {
    return remainingIn(shape, abilityId, ABILITY_STAGES.COOLDOWN);
}

/** The cooldown reserved while the ability is active; it starts when the active stage ends. */
export function pendingCooldownMs(shape, abilityId) {
    const record = abilityRecord(shape, abilityId);
    return record?.stage === ABILITY_STAGES.ACTIVE ? positive(record.cooldownMs) : 0;
}

/** Ids of the abilities in a stage, in ascending id order. */
export function abilityIdsInStage(shape, stage) {
    return Object.entries(shape?.abilityState ?? {})
        .filter(([, record]) => record?.stage === stage && positive(record.remainingMs) > 0)
        .map(([id]) => Number(id));
}

/** The ability currently winding up (one at a time per channel; the dash channel never winds up). */
export function preparingAbilityId(shape) {
    return abilityIdsInStage(shape, ABILITY_STAGES.WINDUP)[0] ?? null;
}

export function preparingRemainingMs(shape) {
    const id = preparingAbilityId(shape);
    return id == null ? 0 : windupRemainingMs(shape, id);
}

export function isWindingUp(shape) {
    return preparingAbilityId(shape) != null;
}

/** True while an ability of `channel` other than `exceptAbilityId` is winding up or active. */
export function channelBusy(shape, channel, exceptAbilityId = null) {
    const except = exceptAbilityId == null ? null : Number(exceptAbilityId);
    return Object.entries(shape?.abilityState ?? {}).some(([id, record]) => {
        if (except != null && Number(id) === except) return false;
        return (record?.stage === ABILITY_STAGES.WINDUP || record?.stage === ABILITY_STAGES.ACTIVE)
            && positive(record.remainingMs) > 0
            && abilityChannel(Number(id)) === channel;
    });
}

/** True while any ability of `channel` (including the one asking) is winding up. */
export function channelWindingUp(shape, channel) {
    return Object.entries(shape?.abilityState ?? {}).some(([id, record]) =>
        record?.stage === ABILITY_STAGES.WINDUP
        && positive(record.remainingMs) > 0
        && abilityChannel(Number(id)) === channel);
}

/** True while any ability of `channel` is winding up or active. */
export function channelActive(shape, channel) {
    return channelBusy(shape, channel, null);
}

/**
 * Merges `changes` into one ability's record in place; `undefined` values remove a key. The bot's record map
 * and the record are replaced, not edited, so a snapshot or a frame that holds the old ones stays valid.
 */
export function patchAbilityRecord(shape, abilityId, changes) {
    const merged = { stage: ABILITY_STAGES.READY, remainingMs: 0, ...(abilityRecord(shape, abilityId) ?? {}), ...changes };
    for (const key of Object.keys(merged)) {
        if (merged[key] === undefined) delete merged[key];
    }
    shape.abilityState = { ...(shape.abilityState ?? {}), [abilityId]: merged };
    return shape;
}

/** Puts an ability back to ready, keeping its charges and reload. */
export function readyAbilityRecord(shape, abilityId) {
    return patchAbilityRecord(shape, abilityId, {
        stage: ABILITY_STAGES.READY, remainingMs: 0, cooldownMs: undefined, target: undefined, steps: undefined,
    });
}

/** Ends an ability's active stage: any reserved cooldown starts in full. */
export function endActiveStage(shape, abilityId) {
    const record = abilityRecord(shape, abilityId);
    if (record?.stage !== ABILITY_STAGES.ACTIVE) return shape;
    const cooldown = positive(record.cooldownMs);
    return patchAbilityRecord(shape, abilityId, {
        stage: cooldown > 0 ? ABILITY_STAGES.COOLDOWN : ABILITY_STAGES.READY,
        remainingMs: cooldown,
        cooldownMs: undefined,
        steps: undefined,
    });
}

/** Drops every active stage with no cooldown following it (a bot's effects are cleared at death). */
export function clearActiveStages(shape) {
    for (const abilityId of abilityIdsInStage(shape, ABILITY_STAGES.ACTIVE)) readyAbilityRecord(shape, abilityId);
    return shape;
}

/** Clears the one wind-up in progress (no cooldown, no charge used). */
export function clearWindup(shape) {
    const id = preparingAbilityId(shape);
    return id == null ? shape : readyAbilityRecord(shape, id);
}

export function cloneAbilityState(abilityState) {
    return Object.fromEntries(Object.entries(abilityState ?? {}).map(([id, record]) => [id, {
        ...record,
        ...(record?.target ? { target: { ...record.target } } : {}),
    }]));
}

export const LEGACY_ABILITY_FIELDS = Object.freeze([
    "preparingAbility", "preparingMs", "preparingTargetX", "preparingTargetY", "abilityActiveMs",
    "abilityCooldowns", "abilityPendingCooldownMs", "abilityCharges", "abilityRechargeMs",
]);

/** A copy of a replay frame bot without the old loose ability fields (the records replace them). */
export function withoutLegacyAbilityFields(source) {
    return Object.fromEntries(Object.entries(source ?? {}).filter(([key]) => !LEGACY_ABILITY_FIELDS.includes(key)));
}

/**
 * Builds records from the old loose fields (a server replay frame, or a stored fixture). The inverse of
 */
export function abilityStateFromLegacy(source = {}) {
    const state = {};
    // Keys stay as given (ids, or names a payload boundary maps to ids later).
    const ids = new Set([
        ...Object.keys(source.abilityCooldowns ?? {}),
        ...Object.keys(source.abilityPendingCooldownMs ?? {}),
        ...Object.keys(source.abilityActiveMs ?? {}),
        ...Object.keys(source.abilityCharges ?? {}),
        ...Object.keys(source.abilityRechargeMs ?? {}),
        ...(source.preparingAbility == null ? [] : [String(source.preparingAbility)]),
    ]);
    for (const id of ids) {
        const windup = source.preparingAbility != null && String(source.preparingAbility) === id
            ? positive(source.preparingMs) : 0;
        const active = positive(source.abilityActiveMs?.[id]);
        const cooldown = Math.max(positive(source.abilityCooldowns?.[id]), positive(source.abilityPendingCooldownMs?.[id]));
        const record = { stage: ABILITY_STAGES.READY, remainingMs: 0 };
        if (windup > 0) {
            record.stage = ABILITY_STAGES.WINDUP;
            record.remainingMs = windup;
            record.target = { x: source.preparingTargetX ?? undefined, y: source.preparingTargetY ?? undefined };
        } else if (active > 0) {
            record.stage = ABILITY_STAGES.ACTIVE;
            record.remainingMs = active;
            if (cooldown > 0) record.cooldownMs = cooldown;
        } else if (cooldown > 0) {
            record.stage = ABILITY_STAGES.COOLDOWN;
            record.remainingMs = cooldown;
        }
        if (source.abilityCharges?.[id] != null) record.charges = Number(source.abilityCharges[id]);
        if (source.abilityRechargeMs?.[id] != null) record.reloadMs = positive(source.abilityRechargeMs[id]);
        state[id] = record;
    }
    return state;
}
