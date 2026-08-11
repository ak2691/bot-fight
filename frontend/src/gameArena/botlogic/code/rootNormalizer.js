export function normalizeRoot(root, rootIndex, remaining, customVariables, operations) {
    return {
        id: String(root?.id || `root-${rootIndex + 1}`),
        name: normalizeRootName(root?.name),
        createdOrder: finiteOrder(root?.createdOrder, rootIndex),
        branches: normalizeBranches(root?.branches, remaining, customVariables, operations),
    };
}

function normalizeRootName(value) {
    const name = String(value ?? "").trim().slice(0, 40);
    return name || "Root";
}

function normalizeBranches(branches, remaining, customVariables, operations) {
    if (!Array.isArray(branches) || remaining.conditions <= 0) return [];
    const normalized = [];
    for (let index = 0; index < branches.length && remaining.conditions > 0; index += 1) {
        const branch = branches[index];
        const normalizedBlock = operations.normalizeBlock(branch, index, customVariables);
        const actions = [];
        for (const entry of normalizedBlock.actions) {
            if (entry.action === "none") continue;
            if (remaining.actions <= 0) break;
            actions.push(entry);
            remaining.actions -= 1;
        }
        if (!actions.length) actions.push({ action: "none", actionTarget: "opponent" });
        const conditions = branch?.branchType === "else"
            ? []
            : operations.normalizeConditions(branch?.conditions, customVariables).slice(0, remaining.conditions);
        remaining.conditions -= conditions.length;
        const children = normalizeBranches(branch?.children, remaining, customVariables, operations);
        normalized.push({
            ...normalizedBlock,
            ...actions[0],
            actions,
            branchType: index === 0 ? "if" : branch?.branchType === "else" ? "else" : "if",
            createdOrder: finiteOrder(branch?.createdOrder, index),
            conditions,
            children,
        });
    }
    return normalized;
}

function finiteOrder(value, fallback) {
    return Number.isFinite(Number(value)) ? Number(value) : fallback;
}
