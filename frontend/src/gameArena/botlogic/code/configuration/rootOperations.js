import {
    conditionalIdFor,
    normalizePriority,
    priorityForNode,
    rootIdForIndex,
} from "./identifiers.js";
import { MAX_ROOT_NAME_LENGTH } from "./constants.js";

export function normalizeRoots(roots) {
    if (!Array.isArray(roots)) return [];
    return roots.map((root, rootIndex) => {
        const priority = priorityForNode(root, rootIndex + 1);
        // IDs identify the editor node, not its current execution priority. Keep
        // an existing ID attached to the same node so priority edits cannot make
        // saved graph positions follow a different root.
        const id = stableNodeId(root?.id, rootIdForIndex(rootIndex));
        const rootData = { ...(root ?? {}) };
        delete rootData.createdOrder;
        return {
            ...rootData,
            id,
            name: normalizeRootName(root?.name),
            priority,
            branches: normalizeBranchIds(root?.branches, id, 1),
        };
    });
}

function normalizeBranchIds(branches, rootId, depth) {
    if (!Array.isArray(branches)) return branches;
    return branches.map((branch, branchIndex) => {
        const priority = priorityForNode(branch, branchIndex + 1);
        const id = stableNodeId(branch?.id, conditionalIdFor(rootId, depth, priority, branchIndex + 1));
        const branchData = { ...(branch ?? {}) };
        delete branchData.createdOrder;
        return {
            ...branchData,
            id,
            priority,
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
            if (!tail.length) return {
                ...parentBranch,
                branchType: branch.branchType === "else" ? "else" : "if",
                priority: priorityForNode(parentBranch, priorityForNode(branch, head + 1)),
                children: [branch],
            };
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
    const currentPriority = priorityForNode(roots?.[rootIndex], rootIndex + 1);
    return setLogicRootPriority(roots, rootIndex, currentPriority + Number(delta || 0));
}

export function setLogicRootPriority(roots, rootIndex, priority) {
    if (!Array.isArray(roots)) return [];
    const targetPriority = normalizePriority(priority);
    if (rootIndex < 0 || rootIndex >= roots.length) return roots;
    const currentPriority = priorityForNode(roots[rootIndex], rootIndex + 1);
    if (targetPriority === currentPriority) return roots;
    const updated = roots.map((root, index) => {
        const rootData = { ...root };
        delete rootData.createdOrder;
        return {
            ...rootData,
            priority: index === rootIndex ? targetPriority : priorityForNode(root, index + 1),
        };
    });
    const swappedIndex = updated.findIndex((root, index) => index !== rootIndex && root.priority === targetPriority);
    if (swappedIndex >= 0) updated[swappedIndex] = { ...updated[swappedIndex], priority: currentPriority };
    return normalizeRoots(updated);
}

export function setLogicBranchPriority(roots, rootIndex, path, priority) {
    if (!Array.isArray(roots) || !Array.isArray(path) || path.length === 0) return roots;
    const targetPriority = normalizePriority(priority);
    const updateAt = (branches, remainingPath) => {
        const [head, ...tail] = remainingPath;
        if (!Array.isArray(branches) || !branches[head]) return branches;
        if (tail.length) return branches.map((branch, index) => index === head ? { ...branch, children: updateAt(branch.children, tail) } : branch);
        const currentPriority = priorityForNode(branches[head], head + 1);
        if (currentPriority === targetPriority) return branches;
        const updated = branches.map((branch, index) => {
            const branchData = { ...branch };
            delete branchData.createdOrder;
            return {
                ...branchData,
                priority: index === head ? targetPriority : priorityForNode(branch, index + 1),
            };
        });
        const swappedIndex = updated.findIndex((branch, index) => index !== head && branch.priority === targetPriority);
        if (swappedIndex >= 0) updated[swappedIndex] = { ...updated[swappedIndex], priority: currentPriority };
        return updated;
    };
    return normalizeRoots(roots.map((root, index) => index === rootIndex ? { ...root, branches: updateAt(root.branches, path) } : root));
}

function normalizeLogicBranchSiblings(branches) {
    return branches.map((branch, index) => ({ ...branch, branchType: index === 0 ? "if" : branch.branchType === "else" ? "else" : "if" }));
}

function normalizeRootName(value) {
    const normalized = String(value ?? "").trim().replace(/\s+/g, " ").slice(0, MAX_ROOT_NAME_LENGTH);
    return normalized || "Root";
}

function stableNodeId(value, fallback) {
    const id = String(value ?? "").trim();
    return id || fallback;
}
