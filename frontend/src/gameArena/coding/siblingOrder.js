// Unreal-style ordering: among siblings (roots, or conditionals sharing a
// parent), the node further left runs first. The stored `priority` fields stay
// the runtime contract; these helpers derive them from editor positions.
// ELSE branches always stay last because they match unconditionally.

const ROOTS_GROUP = "roots";

export function branchGroupKey(rootIndex, parentPath = []) {
    return `branches:${rootIndex}:${parentPath.join(".")}`;
}

export function groupKeyForNode(node) {
    if (!Array.isArray(node?.path)) return ROOTS_GROUP;
    return branchGroupKey(node.rootIndex, node.path.slice(0, -1));
}

function treeBranchAt(branches, path) {
    let branch = branches?.[path[0]];
    for (let index = 1; branch && index < path.length; index += 1) branch = branch.children?.[path[index]];
    return branch ?? null;
}

/** Sibling groups of a built logic graph: all roots, plus each parent's conditionals. */
export function siblingGroups(graph) {
    const groups = new Map([[ROOTS_GROUP, { key: ROOTS_GROUP, rootIndex: null, parentPath: null, nodes: [...(graph?.roots ?? [])] }]]);
    (graph?.conditions ?? []).forEach((node) => {
        if (!Array.isArray(node.path) || !node.path.length) return;
        const key = groupKeyForNode(node);
        if (!groups.has(key)) groups.set(key, { key, rootIndex: node.rootIndex, parentPath: node.path.slice(0, -1), nodes: [] });
        groups.get(key).nodes.push(node);
    });
    return groups;
}

function centerX(node, offsets) {
    return Number(node.x ?? 0) + Number(offsets?.[node.id]?.x ?? 0) + Number(node.width ?? 0) / 2;
}

function isElseNode(node, roots) {
    if (!Array.isArray(node?.path)) return false;
    return treeBranchAt(roots?.[node.rootIndex]?.branches, node.path)?.branchType === "else";
}

function storedPriority(node, roots) {
    if (!Array.isArray(node?.path)) return Number(roots?.[node.rootIndex]?.priority ?? node.rootIndex + 1);
    return Number(treeBranchAt(roots?.[node.rootIndex]?.branches, node.path)?.priority ?? node.path.at(-1) + 1);
}

/** Group nodes in execution order implied by their horizontal positions. */
export function orderGroupByPosition(nodes, offsets, roots) {
    const compare = (first, second) => (centerX(first, offsets) - centerX(second, offsets))
        || (storedPriority(first, roots) - storedPriority(second, roots));
    const regular = nodes.filter((node) => !isElseNode(node, roots)).sort(compare);
    const elseNodes = nodes.filter((node) => isElseNode(node, roots)).sort(compare);
    return [...regular, ...elseNodes];
}

/** Group nodes in their stored priority order. */
export function orderGroupByPriority(nodes, roots) {
    return [...nodes].sort((first, second) => storedPriority(first, roots) - storedPriority(second, roots));
}

/** Node id -> 1-based rank, from positions (for live badges while dragging). */
export function positionRanks(graph, offsets, roots, groupKeys = null) {
    const ranks = new Map();
    siblingGroups(graph).forEach((group) => {
        if (groupKeys && !groupKeys.has(group.key)) return;
        orderGroupByPosition(group.nodes, offsets, roots).forEach((node, index) => ranks.set(node.id, index + 1));
    });
    return ranks;
}

/** Node id -> 1-based rank from stored priorities. */
export function priorityRanks(graph, roots) {
    const ranks = new Map();
    siblingGroups(graph).forEach((group) => {
        orderGroupByPriority(group.nodes, roots).forEach((node, index) => ranks.set(node.id, index + 1));
    });
    return ranks;
}

/** Group keys whose left-to-right layout disagrees with the stored order. */
export function mismatchedGroups(graph, offsets, roots) {
    const mismatched = new Set();
    siblingGroups(graph).forEach((group) => {
        const byPosition = orderGroupByPosition(group.nodes, offsets, roots).map((node) => node.id);
        const byPriority = orderGroupByPriority(group.nodes, roots).map((node) => node.id);
        if (byPosition.some((id, index) => id !== byPriority[index])) mismatched.add(group.key);
    });
    return mismatched;
}

function setBranchPriorities(branches, parentPath, priorityByIndex) {
    if (!parentPath.length) {
        return (branches ?? []).map((branch, index) => priorityByIndex.has(index) ? { ...branch, priority: priorityByIndex.get(index) } : branch);
    }
    const [head, ...tail] = parentPath;
    return (branches ?? []).map((branch, index) => index === head
        ? { ...branch, children: setBranchPriorities(branch.children, tail, priorityByIndex) }
        : branch);
}

/** Applies an explicit node order (graph nodes of one group) as priorities 1..n. */
export function applyGroupOrder(roots, group, orderedNodes) {
    if (group.key === ROOTS_GROUP) {
        const priorityByRoot = new Map(orderedNodes.map((node, index) => [node.rootIndex, index + 1]));
        return roots.map((root, index) => priorityByRoot.has(index) ? { ...root, priority: priorityByRoot.get(index) } : root);
    }
    const priorityByIndex = new Map(orderedNodes.map((node, index) => [node.path.at(-1), index + 1]));
    return roots.map((root, index) => index === group.rootIndex
        ? { ...root, branches: setBranchPriorities(root.branches, group.parentPath, priorityByIndex) }
        : root);
}

/** Rewrites priorities of the given groups from left-to-right positions. */
export function applyPositionOrder(roots, graph, offsets, groupKeys) {
    let next = roots;
    siblingGroups(graph).forEach((group) => {
        if (!groupKeys.has(group.key)) return;
        next = applyGroupOrder(next, group, orderGroupByPosition(group.nodes, offsets, roots));
    });
    return next;
}

/** All graph nodes that belong to a root or conditional's subtree (including itself). */
export function subtreeNodes(graph, node) {
    const all = [...(graph?.roots ?? []), ...(graph?.conditions ?? []), ...(graph?.actions ?? [])];
    if (!Array.isArray(node?.path)) return all.filter((candidate) => candidate.rootIndex === node.rootIndex);
    return all.filter((candidate) => candidate.rootIndex === node.rootIndex
        && Array.isArray(candidate.path)
        && candidate.path.length >= node.path.length
        && node.path.every((value, index) => candidate.path[index] === value));
}

/**
 * Swaps a node with its neighbour in execution order (delta -1 = earlier).
 * Returns { roots, offsets } with the two subtrees exchanging horizontal
 * places, or null when there is no neighbour (or an ELSE would move).
 */
export function nudgeNode(roots, graph, offsets, node, delta) {
    const group = siblingGroups(graph).get(groupKeyForNode(node));
    if (!group) return null;
    const ordered = orderGroupByPriority(group.nodes, roots);
    const index = ordered.findIndex((candidate) => candidate.id === node.id);
    const target = index + delta;
    if (index < 0 || target < 0 || target >= ordered.length) return null;
    return swapNodePlaces(roots, graph, offsets, node, ordered[target]);
}

/**
 * Exchanges two siblings' execution order and their horizontal places (each
 * subtree travels with its node). Returns null for ELSE branches, which stay last.
 */
export function swapNodePlaces(roots, graph, offsets, node, neighbour) {
    const group = siblingGroups(graph).get(groupKeyForNode(node));
    if (!group || groupKeyForNode(neighbour) !== group.key || node.id === neighbour.id) return null;
    if (isElseNode(node, roots) || isElseNode(neighbour, roots)) return null;
    const ordered = orderGroupByPriority(group.nodes, roots);
    const index = ordered.findIndex((candidate) => candidate.id === node.id);
    const target = ordered.findIndex((candidate) => candidate.id === neighbour.id);
    const reordered = [...ordered];
    reordered[index] = neighbour;
    reordered[target] = node;
    const nodeShift = centerX(neighbour, offsets) - centerX(node, offsets);
    const nextOffsets = { ...offsets };
    const shift = (subject, dx) => subtreeNodes(graph, subject).forEach((candidate) => {
        const current = nextOffsets[candidate.id] ?? { x: 0, y: 0 };
        nextOffsets[candidate.id] = { x: current.x + dx, y: current.y };
    });
    shift(node, nodeShift);
    shift(neighbour, -nodeShift);
    return { roots: applyGroupOrder(roots, group, reordered), offsets: nextOffsets };
}

/**
 * Sorts roots and every branch list by priority so the default layout follows
 * execution order. Behavior is unchanged: an ELSE that does not end up last is
 * rewritten as an IF with no conditions, which also always matches.
 */
export function sortTreeByPriority(roots) {
    const sortBranches = (branches) => {
        const sorted = [...(branches ?? [])].sort((first, second) => Number(first?.priority ?? 0) - Number(second?.priority ?? 0));
        return sorted.map((branch, index) => {
            const keepsElse = branch.branchType === "else" && index > 0 && index === sorted.length - 1;
            return {
                ...branch,
                priority: index + 1,
                branchType: keepsElse ? "else" : "if",
                ...(branch.branchType === "else" && !keepsElse ? { conditions: [] } : {}),
                children: sortBranches(branch.children),
            };
        });
    };
    return [...roots]
        .sort((first, second) => Number(first?.priority ?? 0) - Number(second?.priority ?? 0))
        .map((root, index) => ({ ...root, priority: index + 1, branches: sortBranches(root.branches) }));
}

export const SIBLING_ROOTS_GROUP = ROOTS_GROUP;
