export function countVariableSlots(configuration) {
    return (configuration?.customVariables ?? []).reduce((slots, variable) => (
        slots + 1 + (variable?.valueType === "boolean" && Array.isArray(variable.conditions) ? variable.conditions.length : 0)
    ), 0);
}

export function countConditionSlots(configuration) {
    const variableCosts = new Map((configuration?.customVariables ?? []).map((variable) => [
        variable.id,
        1 + (variable?.valueType === "boolean" && Array.isArray(variable.conditions) ? variable.conditions.length : 0),
    ]));
    const conditionCost = (condition) => {
        const referenced = new Set([condition?.left, condition?.right?.type === "variable" ? condition.right.value : null]
            .filter((id) => variableCosts.has(id)));
        return referenced.size ? [...referenced].reduce((total, id) => total + variableCosts.get(id), 0) : 1;
    };
    const countBranches = (branches = []) => branches.reduce((total, branch) => (
        total + (branch.conditions ?? []).reduce((sum, condition) => sum + conditionCost(condition), 0)
            + countBranches(branch.children)
    ), 0);
    const derivedConditions = (configuration?.customVariables ?? []).reduce((total, variable) => (
        total + (variable?.valueType === "boolean" ? variable.conditions?.length ?? 0 : 0)
    ), 0);
    return derivedConditions
        + (configuration?.roots ?? []).reduce((total, root) => total + countBranches(root.branches), 0);
}
