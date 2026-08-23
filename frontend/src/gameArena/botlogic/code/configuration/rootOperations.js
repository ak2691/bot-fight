import {
    conditionalIdFor,
    normalizeCreatedOrder,
    rootIdForCreatedOrder,
} from "./identifiers.js";

export function normalizeRoots(roots) {
    if (!Array.isArray(roots)) return [];
    return roots.map((root, rootIndex) => {
        const createdOrder = normalizeCreatedOrder(root?.createdOrder, rootIndex);
        const id = rootIdForCreatedOrder(createdOrder, rootIndex);
        return {
            ...(root ?? {}),
            id,
            name: normalizeRootName(root?.name),
            createdOrder,
            branches: normalizeBranchIds(root?.branches, id, 1),
        };
    });
}

function normalizeBranchIds(branches, rootId, depth) {
    if (!Array.isArray(branches)) return branches;
    return branches.map((branch, branchIndex) => {
        const createdOrder = normalizeCreatedOrder(branch?.createdOrder, branchIndex);
        return {
            ...(branch ?? {}),
            id: conditionalIdFor(rootId, depth, createdOrder, branchIndex),
            createdOrder,
            children: normalizeBranchIds(branch?.children, rootId, depth + 1),
        };
    });
}

export function insertParentLogicBranch(roots, rootIndex, path, parentBranch) {
    if (!Array.isArray(roots) || !Array.isArray(path) || path.length === 0 || !parentBranch) return roots;
    const wrapBranchAt = (branches, remainingPath) => {
        const [head, ...tail] = remainingPath;
        return (branches ?? []).map((branch, index) => {
            if (index !== head) return branch;
            if (!tail.length) return { ...parentBranch, branchType: branch.branchType === "else" ? "else" : "if", createdOrder: branch.createdOrder ?? head, children: [branch] };
            return { ...branch, children: wrapBranchAt(branch.children, tail) };
        });
    };
    return normalizeRoots(roots.map((root, index) => index === rootIndex ? { ...root, branches: wrapBranchAt(root.branches, path) } : root));
}

export function removeLogicBranch(roots, rootIndex, path) {
    if (!Array.isArray(roots) || !Array.isArray(path) || path.length === 0) return roots;
    let target = roots[rootIndex]?.branches?.[path[0]];
    for (let index = 1; target && index < path.length; index += 1) target = target.children?.[path[index]];
    if (!target) return roots;
    const removeAt = (branches, remainingPath) => {
        const [head, ...tail] = remainingPath;
        if (!tail.length) return normalizeLogicBranchSiblings((branches ?? []).flatMap((branch, index) => index === head ? (Array.isArray(branch.children) ? branch.children : []) : [branch]));
        return (branches ?? []).map((branch, index) => index === head ? { ...branch, children: removeAt(branch.children, tail) } : branch);
    };
    return normalizeRoots(roots.map((root, index) => index === rootIndex ? { ...root, branches: removeAt(root.branches, path) } : root));
}

export function moveLogicRootPriority(roots, rootIndex, delta) {
    const currentPriority = Number(roots?.[rootIndex]?.createdOrder) + 1;
    return setLogicRootPriority(roots, rootIndex, currentPriority + Number(delta || 0));
}

export function setLogicRootPriority(roots, rootIndex, priority) {
    if (!Array.isArray(roots)) return [];
    const targetPriority = Math.max(1, Math.trunc(Number(priority) || 1));
    if (rootIndex < 0 || rootIndex >= roots.length) return roots;
    const targetOrder = targetPriority - 1;
    const currentOrder = finiteOrder(roots[rootIndex]?.createdOrder, rootIndex);
    if (targetOrder === currentOrder) return roots;
    const updated = roots.map((root, index) => ({ ...root, createdOrder: index === rootIndex ? targetOrder : finiteOrder(root?.createdOrder, index) }));
    const swappedIndex = updated.findIndex((root, index) => index !== rootIndex && root.createdOrder === targetOrder);
    if (swappedIndex >= 0) updated[swappedIndex] = { ...updated[swappedIndex], createdOrder: currentOrder };
    return normalizeRoots(updated);
}

export function setLogicBranchPriority(roots, rootIndex, path, priority) {
    if (!Array.isArray(roots) || !Array.isArray(path) || path.length === 0) return roots;
    const targetOrder = Math.max(0, Math.trunc(Number(priority) || 1) - 1);
    const updateAt = (branches, remainingPath) => {
        const [head, ...tail] = remainingPath;
        if (!Array.isArray(branches) || !branches[head]) return branches;
        if (tail.length) return branches.map((branch, index) => index === head ? { ...branch, children: updateAt(branch.children, tail) } : branch);
        const currentOrder = finiteOrder(branches[head].createdOrder, head);
        if (currentOrder === targetOrder) return branches;
        const updated = branches.map((branch, index) => ({ ...branch, createdOrder: index === head ? targetOrder : finiteOrder(branch?.createdOrder, index) }));
        const swappedIndex = updated.findIndex((branch, index) => index !== head && branch.createdOrder === targetOrder);
        if (swappedIndex >= 0) updated[swappedIndex] = { ...updated[swappedIndex], createdOrder: currentOrder };
        return updated.sort((first, second) => first.createdOrder - second.createdOrder);
    };
    return normalizeRoots(roots.map((root, index) => index === rootIndex ? { ...root, branches: updateAt(root.branches, path) } : root));
}

function normalizeLogicBranchSiblings(branches) {
    return branches.map((branch, index) => ({ ...branch, branchType: index === 0 ? "if" : branch.branchType === "else" ? "else" : "if" }));
}

function normalizeRootName(value) {
    const normalized = String(value ?? "").trim().replace(/\s+/g, " ").slice(0, 40);
    return normalized || "Root";
}

function finiteOrder(value, fallback) {
    return normalizeCreatedOrder(value, fallback);
}
