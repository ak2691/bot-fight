import {
    BOT_CODE_COMPARATORS,
    BOT_CODE_CONDITIONS,
} from "../contracts/BotLogicContracts.js";

export function evaluateConditionNode(condition, state, evaluateExpression) {
    if (condition?.type === BOT_CODE_CONDITIONS.EXPRESSION) return evaluateExpression(condition, state);
    return condition?.type === BOT_CODE_CONDITIONS.ALWAYS;
}

// A pair variable (distance, bearings) carries its own entity/target configuration.
// When it is the compared-to side of a condition that configuration lives in the
// right* fields, so the two sides never share one target. Older brains without
// right* fields fall back to the left configuration, which keeps their behavior.
const RIGHT_PAIR_FIELDS = Object.freeze({
    selectable1: "rightSelectable1",
    selectable2: "rightSelectable2",
    targetMode: "rightTargetMode",
    targetX: "rightTargetX",
    targetY: "rightTargetY",
    targetAngle: "rightTargetAngle",
});

export function rightOperandView(condition) {
    if (!condition) return condition;
    const selectable2 = condition.rightSelectable2 ?? condition.selectable2 ?? condition.selectable;
    return {
        ...condition,
        selectable1: condition.rightSelectable1 ?? condition.selectable1,
        selectable2,
        selectable: selectable2,
        targetMode: condition.rightTargetMode ?? condition.targetMode,
        targetX: condition.rightTargetX ?? condition.targetX,
        targetY: condition.rightTargetY ?? condition.targetY,
        targetAngle: condition.rightTargetAngle ?? condition.targetAngle,
    };
}

// Maps pair-configuration updates ({ targetMode: "coordinates" }) onto the right* fields.
export function rightPairUpdates(updates) {
    return Object.fromEntries(Object.entries(updates).map(([key, value]) => [RIGHT_PAIR_FIELDS[key] ?? key, value]));
}

export function rightPairFieldValues(view) {
    return Object.fromEntries(Object.entries(RIGHT_PAIR_FIELDS)
        .filter(([key]) => view?.[key] !== undefined)
        .map(([key, field]) => [field, view[key]]));
}

export function evaluateConditionNodes(conditions, state, evaluateExpression) {
    // Conditions are AND-only; an empty list always matches.
    return conditions.every((condition) => evaluateConditionNode(condition, state, evaluateExpression));
}

export function compareValues(left, comparator, right, valueType) {
    if (valueType === "boolean") {
        const leftBoolean = Boolean(left);
        const rightBoolean = Boolean(right);
        return comparator === BOT_CODE_COMPARATORS.NEQ ? leftBoolean !== rightBoolean : leftBoolean === rightBoolean;
    }
    const leftNumber = Number(left);
    const rightNumber = Number(right);
    if (!Number.isFinite(leftNumber) || !Number.isFinite(rightNumber)) return false;
    const comparisons = {
        [BOT_CODE_COMPARATORS.LT]: leftNumber < rightNumber,
        [BOT_CODE_COMPARATORS.LTE]: leftNumber <= rightNumber,
        [BOT_CODE_COMPARATORS.EQ]: leftNumber === rightNumber,
        [BOT_CODE_COMPARATORS.NEQ]: leftNumber !== rightNumber,
        [BOT_CODE_COMPARATORS.GTE]: leftNumber >= rightNumber,
        [BOT_CODE_COMPARATORS.GT]: leftNumber > rightNumber,
    };
    return comparisons[comparator] ?? false;
}

export function compareAngleValues(left, comparator, right) {
    const leftNumber = Number(left);
    const rightNumber = Number(right);
    if (!Number.isFinite(leftNumber) || !Number.isFinite(rightNumber)) return false;
    if (comparator === BOT_CODE_COMPARATORS.EQ) return equivalentAngles(leftNumber, rightNumber);
    if (comparator === BOT_CODE_COMPARATORS.NEQ) return !equivalentAngles(leftNumber, rightNumber);
    return angleRepresentations(leftNumber)
        .some((candidate) => compareValues(candidate, comparator, rightNumber, "number"));
}

function angleRepresentations(value) {
    const positive = ((value % 360) + 360) % 360;
    const negative = positive - 360;
    return positive === negative ? [positive] : [positive, negative];
}

function equivalentAngles(left, right) {
    const normalizedLeft = ((left % 360) + 360) % 360;
    const normalizedRight = ((right % 360) + 360) % 360;
    return Math.abs(normalizedLeft - normalizedRight) <= 1e-9;
}
