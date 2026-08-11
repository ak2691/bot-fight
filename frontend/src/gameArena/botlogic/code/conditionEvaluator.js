export function evaluateConditionNode(condition, state, evaluateExpression) {
    if (condition?.type === "expression") return evaluateExpression(condition, state);
    return condition?.type === "always";
}

export function evaluateConditionNodes(conditions, state, evaluateExpression) {
    if (!conditions.length) return true;
    return conditions.reduce((matches, condition, index) => {
        const conditionMatches = evaluateConditionNode(condition, state, evaluateExpression);
        return index > 0 && condition.join === "or" ? matches || conditionMatches : matches && conditionMatches;
    }, true);
}

export function directionFallsInRange(value, start, end) {
    const rawSpan = end - start;
    if (![value, start, end].every(Number.isFinite) || Math.abs(rawSpan) > 360) return false;
    const span = Math.abs(rawSpan) === 360 ? 360 : rawSpan >= 0 ? rawSpan : 360 + rawSpan;
    const distance = ((value - start) % 360 + 360) % 360;
    return distance <= span + 1e-9;
}

export function compareValues(left, comparator, right, valueType) {
    if (valueType === "boolean") {
        const leftBoolean = Boolean(left);
        const rightBoolean = Boolean(right);
        return comparator === "neq" ? leftBoolean !== rightBoolean : leftBoolean === rightBoolean;
    }
    const leftNumber = Number(left);
    const rightNumber = Number(right);
    if (!Number.isFinite(leftNumber) || !Number.isFinite(rightNumber)) return false;
    switch (comparator) {
        case "lt": return leftNumber < rightNumber;
        case "lte": return leftNumber <= rightNumber;
        case "eq": return leftNumber === rightNumber;
        case "neq": return leftNumber !== rightNumber;
        case "gte": return leftNumber >= rightNumber;
        case "gt": return leftNumber > rightNumber;
        default: return false;
    }
}
