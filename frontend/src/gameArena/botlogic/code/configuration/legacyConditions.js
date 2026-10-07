/**
 * Stamina exhaustion was removed. A saved brain that tests "Exhausted" now tests the equivalent
 * stamina threshold: Exhausted is true means Stamina < 1, Exhausted is false means Stamina >= 1.
 * The server's ConditionResolutionService applies the same rewrite.
 */
export const LEGACY_EXHAUSTED_VARIABLE = "bot.exhausted";

export function migrateExhaustedCondition(condition) {
    if (condition?.left !== LEGACY_EXHAUSTED_VARIABLE) return condition;
    const right = condition.right;
    // Only a plain true/false comparison has an exact stamina equivalent; anything else stays and is rejected.
    if (right?.type !== "boolean") return condition;
    const comparator = condition.comparator === "neq" ? "neq" : condition.comparator === "eq" ? "eq" : null;
    if (comparator == null) return condition;
    const exhausted = comparator === "eq" ? right.value === true : right.value !== true;
    return {
        ...condition,
        left: "bot.stamina",
        comparator: exhausted ? "lt" : "gte",
        right: { type: "number", value: 1 },
    };
}
