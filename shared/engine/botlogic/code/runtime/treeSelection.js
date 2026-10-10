export function selectPriorityCandidates(normalized, state, operations) {
    return [...normalized.roots]
        .sort((first, second) => first.priority - second.priority)
        .flatMap((root, rootIndex) => [...selectTreeBranches(root.branches, state, operations),
            ...(root.actions?.length && operations.blockHasExecutableAction(root, state) ? [root] : [])]
            .map((block, blockIndex) => ({ block, blockIndex, rootIndex })));
}

function selectTreeBranches(branches, state, operations) {
    const ordered = [...(branches ?? [])].sort((first, second) => first.priority - second.priority);
    const selected = [];
    for (const branch of ordered) {
        const matches = branch.branchType === "else" || operations.evaluateConditions(branch.conditions, state);
        if (!matches) continue;
        const selectedCount = selected.length;
        selected.push(...selectTreeBranches(branch.children, state, operations));
        if (operations.blockHasExecutableAction(branch, state)) selected.push(branch);
        if (selected.length > selectedCount) break;
    }
    return selected;
}
