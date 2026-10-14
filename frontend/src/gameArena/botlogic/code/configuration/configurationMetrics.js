export function actionEntryCost(entry) {
    if (!entry || entry.action === "none") return 0;
    if (entry.action === "variable" && Array.isArray(entry.terms) && entry.terms.length) return entry.terms.length;
    return 1;
}

// Every tree the brain holds: connected roots, then unconnected nodes (a bare action is a branch with no children).
function brainTrees(configuration) {
    return [
        ...(configuration?.roots ?? []).map((root) => root?.branches),
        ...(Array.isArray(configuration?.orphans) ? configuration.orphans.map((node) => [node]) : []),
    ];
}

export function countActionSlots(configuration) {
    const countBranches = (branches = []) => branches.reduce((total, branch) => {
        const actions = Array.isArray(branch?.actions) && branch.actions.length ? branch.actions : [branch];
        return total + actions.reduce((sum, entry) => sum + actionEntryCost(entry), 0) + countBranches(branch?.children);
    }, 0);
    return brainTrees(configuration).reduce((total, branches) => total + countBranches(branches), 0);
}

/** Unconnected nodes: a conditional counts itself and its subtree, an action counts once. */
export function countOrphanNodes(configuration) {
    return (Array.isArray(configuration?.orphans) ? configuration.orphans : []).reduce((sum, node) => {
        if (node?.kind === "action") return sum + 1;
        if (node?.kind !== "conditional") return sum;
        const count = (branch) => 1 + (Array.isArray(branch?.children) ? branch.children.reduce((total, child) => total + count(child), 0) : 0);
        return sum + count(node);
    }, 0);
}

export function countVariableSlots(configuration) {
    return (configuration?.customVariables ?? []).length;
}

export function referencedCustomVariableIds(configuration) {
    const customVariableIds = new Set((configuration?.customVariables ?? []).map((variable) => variable?.id));
    const referenced = new Set();
    const visitCondition = (condition) => {
        if (condition?.type !== "expression") return;
        if (customVariableIds.has(condition.left)) referenced.add(condition.left);
        const rightId = condition.right?.type === "variable" ? condition.right.value : null;
        if (customVariableIds.has(rightId)) referenced.add(rightId);
    };
    const visitBranches = (branches) => {
        if (!Array.isArray(branches)) return;
        branches.forEach((branch) => {
            (branch?.conditions ?? []).forEach(visitCondition);
            visitBranches(branch?.children);
        });
    };
    (configuration?.roots ?? []).forEach((root) => visitBranches(root?.branches));
    return referenced;
}

export function countConditionSlots(configuration) {
    const customVariables = configuration?.customVariables ?? [];
    const variableCosts = new Map(customVariables.map((variable) => [
        variable.id,
        1,
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
    return brainTrees(configuration).reduce((total, branches) => total + countBranches(branches ?? []), 0);
}
