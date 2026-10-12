import { CONDITION_MEASURES, CONDITION_OPS } from "../../gameconfig/vocabulary.js";
import { isWindingUp } from "../../gameconfig/AbilityState.js";
import { angleDelta, normalizeAngle } from "../../gameconfig/geometry.js";
import { vectorToCompassDegrees } from "../../botlogic/planner/arenaAngles.js";
import { statusIsActive } from "../contracts/StatusContracts.js";

/** A source more than this many degrees off the target's facing is behind it. */
const BEHIND_ARC_DEGREES = 90;

/**
 * Whether every `when` check of an effect passes (AND only; an effect with no `when` always applies). Reads the live
 * state, so a check sees the effects before it in the same list. `ctx` has the effect's `source` (or `owner`, when
 * there is no source), `owner`, `target`, and `damageConfirmed` (an earlier damage in the list landed).
 */
export function effectConditionsHold(effect, ctx) {
    return (effect?.when ?? []).every((check) => conditionHolds(check, ctx));
}

function conditionHolds(check, ctx) {
    const subject = check.of === "owner" ? ctx.owner : ctx.target;
    switch (check.measure) {
        case CONDITION_MEASURES.HP_RATIO:
            return subject != null && compare(check.op, hpRatio(subject), check.value);
        case CONDITION_MEASURES.DISTANCE:
            return compare(check.op, distanceBetween(ctx.source ?? ctx.owner, ctx.target), check.value);
        case CONDITION_MEASURES.HAS_STATUS:
            return subject != null && statusIsActive(subject, check.value);
        case CONDITION_MEASURES.WINDING_UP:
            return subject != null && isWindingUp(subject);
        case CONDITION_MEASURES.FROM_BEHIND:
            return isBehind(ctx.target, ctx.source ?? ctx.owner);
        case CONDITION_MEASURES.DAMAGE_CONFIRMED:
            return ctx.damageConfirmed === true;
        default:
            return false;
    }
}

/** Health over maximum health (NaN when the shape has no maximum, so every comparison fails). */
function hpRatio(shape) {
    const maxHp = Number(shape.maxHp);
    return maxHp > 0 ? Math.max(0, Number(shape.hp ?? 0)) / maxHp : Number.NaN;
}

function distanceBetween(from, to) {
    if (!from || !to) return Number.NaN;
    return Math.hypot(Number(to.x) - Number(from.x), Number(to.y) - Number(from.y));
}

/** True when `from` is more than 90 degrees off `target`'s facing: the bearing from the target to it is behind. */
function isBehind(target, from) {
    if (!target || !from) return false;
    const bearing = vectorToCompassDegrees(Number(from.x) - Number(target.x), Number(from.y) - Number(target.y));
    return Math.abs(angleDelta(normalizeAngle(Number(target.rotation ?? 0)), bearing)) > BEHIND_ARC_DEGREES;
}

function compare(op, actual, value) {
    switch (op) {
        case CONDITION_OPS.LESS: return actual < value;
        case CONDITION_OPS.LESS_OR_EQUAL: return actual <= value;
        case CONDITION_OPS.GREATER: return actual > value;
        case CONDITION_OPS.GREATER_OR_EQUAL: return actual >= value;
        default: return false;
    }
}
