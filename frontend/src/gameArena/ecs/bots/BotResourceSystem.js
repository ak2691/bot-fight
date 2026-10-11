import { ABILITY_STATS } from "../../gameconfig/Abilities.js";
import { abilityResourceFor, rechargeAbility } from "../../gameconfig/AbilityResourceSystem.js";
import { ABILITY_STAGES } from "../../gameconfig/AbilityState.js";

/**
 * Advances every ability record of the bot by one step, in place, leaving the active stage (and any cooldown) of an ability that
 * activated this step untouched. `justActivatedAbilityIds` is one id, a list of ids (an ability and a dash can
 * both start in one step) or null. Cooldown-after-active timing: when an active stage ends, only the part of the step left over counts
 * toward the cooldown that starts then. Overclock and attack speed were applied when the cooldown or reload
 * was created, so running timers just count down. A dead bot only runs out its active stages.
 */
export function tickBotResources(shape, elapsedMs, justActivatedAbilityIds = null) {
    const elapsed = Math.max(0, Number(elapsedMs) || 0);
    const alive = Number(shape?.hp ?? 0) > 0;
    const justActivated = new Set([justActivatedAbilityIds].flat().filter((id) => id != null).map(Number));
    const records = shape?.abilityState ?? {};
    const ids = new Set([
        ...Object.keys(records),
        ...(alive && Array.isArray(shape?.abilities) ? shape.abilities.map(String) : []),
    ]);
    const abilityState = {};
    for (const rawId of ids) {
        const id = Number(rawId);
        const record = records[rawId] ?? { stage: ABILITY_STAGES.READY, remainingMs: 0 };
        const activeBefore = record.stage === ABILITY_STAGES.ACTIVE ? Math.max(0, Number(record.remainingMs) || 0) : 0;
        const skipped = justActivated.has(id);
        const advanced = alive ? advanceRecord(record, elapsed, skipped) : advanceActiveOnly(record, elapsed, skipped);
        abilityState[rawId] = alive ? recharge(advanced, id, elapsed, skipped ? 0 : activeBefore, skipped) : advanced;
    }
    shape.abilityState = abilityState;
    return shape;
}

function advanceRecord(record, elapsed, skipped) {
    if (skipped) return record;
    const remaining = Math.max(0, Number(record.remainingMs) || 0);
    if (record.stage === ABILITY_STAGES.ACTIVE) {
        if (remaining > elapsed) return { ...record, remainingMs: remaining - elapsed };
        const cooldown = Math.max(0, (Number(record.cooldownMs) || 0) - Math.max(0, elapsed - remaining));
        return recovery(record, cooldown);
    }
    if (record.stage === ABILITY_STAGES.COOLDOWN) {
        const cooldown = Math.max(0, remaining - elapsed);
        return recovery(record, cooldown);
    }
    return record;
}

function advanceActiveOnly(record, elapsed, skipped) {
    if (skipped || record.stage !== ABILITY_STAGES.ACTIVE) return record;
    const remaining = Math.max(0, (Number(record.remainingMs) || 0) - elapsed);
    return remaining > 0 ? { ...record, remainingMs: remaining } : recovery(record, 0);
}

/** The record after an active/cooldown stage: a cooldown of `cooldownMs` or ready. */
function recovery(record, cooldownMs) {
    const { cooldownMs: _reserved, target: _target, steps: _steps, ...kept } = record;
    return cooldownMs > 0
        ? { ...kept, stage: ABILITY_STAGES.COOLDOWN, remainingMs: cooldownMs }
        : { ...kept, stage: ABILITY_STAGES.READY, remainingMs: 0 };
}

/** Counts a charge-bearing ability's reload down; the time the active stage used does not count. */
function recharge(record, id, elapsed, activeBefore, skipped) {
    const stats = ABILITY_STATS[id];
    if (stats?.maxCharges == null) {
        // Only charge-bearing abilities carry charges; drop anything stale.
        const { charges: _charges, reloadMs: _reloadMs, ...uncharged } = record;
        return uncharged;
    }
    const recoveryElapsed = skipped ? 0 : Math.max(0, elapsed - Math.min(elapsed, activeBefore));
    const resource = rechargeAbility({
        ...abilityResourceFor({ abilityState: { [id]: record } }, id, stats),
        stats,
    }, recoveryElapsed);
    return { ...record, charges: resource.charges, reloadMs: resource.rechargeMs };
}
