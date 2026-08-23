export function normalizedBlockEntries(normalized) {
    return normalized.roots.flatMap((root, rootIndex) => treeEntries(root.branches, rootIndex));
}

function treeEntries(branches, rootIndex, depth = 0) {
    return branches.flatMap((block, blockIndex) => [{
        block,
        blockIndex,
        clusterIndex: rootIndex,
        clusterPriority: rootIndex,
        clusterConditions: [],
        label: `Root ${rootIndex + 1} ${depth ? `nested ${depth}.` : ""}${blockIndex + 1}`,
    }, ...treeEntries(block.children ?? [], rootIndex, depth + 1)]);
}

export function selectPriorityCandidates(normalized, state, operations) {
    return [...normalized.roots]
        .sort((first, second) => first.createdOrder - second.createdOrder)
        .flatMap((root, rootIndex) => selectTreeBranches(root.branches, state, operations)
            .map((block, blockIndex) => ({ block, blockIndex, rootIndex })));
}

function selectTreeBranches(branches, state, operations) {
    const ordered = [...(branches ?? [])].sort((first, second) => first.createdOrder - second.createdOrder);
    const selected = [];
    for (const branch of ordered) {
        const matches = branch.branchType === "else" || operations.evaluateConditions(branch.conditions, state);
        if (!matches) continue;
        selected.push(...selectTreeBranches(branch.children, state, operations));
        if (operations.blockHasExecutableAction(branch, state)) selected.push(branch);
    }
    return selected;
}
