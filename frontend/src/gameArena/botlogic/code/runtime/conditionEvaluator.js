import {
    BOT_CODE_COMPARATORS,
    BOT_CODE_CONDITIONS,
    CONDITION_JOINS,
} from "../contracts/BotLogicContracts.js";

export function evaluateConditionNode(condition, state, evaluateExpression) {
    if (condition?.type === BOT_CODE_CONDITIONS.EXPRESSION) return evaluateExpression(condition, state);
    return condition?.type === BOT_CODE_CONDITIONS.ALWAYS;
}

export function evaluateConditionNodes(conditions, state, evaluateExpression) {
    if (!conditions.length) return true;
    return conditions.reduce((matches, condition, index) => {
        const conditionMatches = evaluateConditionNode(condition, state, evaluateExpression);
        return index > 0 && condition.join === CONDITION_JOINS.OR ? matches || conditionMatches : matches && conditionMatches;
    }, true);
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
