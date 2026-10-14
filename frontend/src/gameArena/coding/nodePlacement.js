// Pure placement rules for the logic board. Conditional ids follow sibling order, so a structure change (attach,
// cut, delete, undo) renames the nodes after the change. Surviving nodes are therefore matched by what they are
// (their conditions or their action), and each keeps the position it had. Only new nodes take a spawn position.

function branchAt(roots, rootIndex, path) {
    let branch = roots?.[rootIndex]?.branches?.[path[0]];
    for (const index of path.slice(1)) branch = branch?.children?.[index];
    return branch ?? null;
}

function activeActions(branch) {
    return (branch?.actions ?? []).filter((entry) => entry?.action && entry.action !== "none");
}

const isRootNode = (node) => node.path === undefined && node.actionIndex === undefined;
const isActionNode = (node) => node.actionIndex !== undefined && node.actionIndex !== null;

// What a node is, independent of its place in the tree and of its editor id.
export function nodeIdentitySignature(node, roots) {
    if (isActionNode(node)) {
        const entry = activeActions(branchAt(roots, node.rootIndex, node.path))[node.actionIndex];
        const { id: _id, priority: _priority, linkId: _linkId, ...content } = entry ?? {};
        return `action:${JSON.stringify(content)}`;
    }
    return `condition:${JSON.stringify(branchAt(roots, node.rootIndex, node.path)?.conditions ?? [])}`;
}

/**
 * Matches the nodes of two states. `previous` and `next` are `{ nodes, roots }`, where `nodes` are graph nodes
 * with `id`, `rootIndex`, `path` and `actionIndex`. Returns a Map from next node id to previous node id.
 */
export function matchNodes(previous, next) {
    const matches = new Map();
    const usedPrevious = new Set();
    const previousById = new Map(previous.nodes.map((node) => [node.id, node]));
    // Roots keep their id (it does not follow sibling order).
    for (const node of next.nodes) {
        if (!isRootNode(node)) continue;
        const old = previousById.get(node.id);
        if (old && isRootNode(old) && !usedPrevious.has(old.id)) {
            matches.set(node.id, old.id);
            usedPrevious.add(old.id);
        }
    }
    const previousBySignature = new Map();
    for (const node of previous.nodes) {
        if (isRootNode(node)) continue;
        const signature = nodeIdentitySignature(node, previous.roots);
        if (!previousBySignature.has(signature)) previousBySignature.set(signature, []);
        previousBySignature.get(signature).push(node);
    }
    // Same content: prefer the same id, then the same place, then the first in tree order.
    for (const node of next.nodes) {
        if (isRootNode(node) || matches.has(node.id)) continue;
        const candidates = (previousBySignature.get(nodeIdentitySignature(node, next.roots)) ?? [])
            .filter((candidate) => !usedPrevious.has(candidate.id));
        if (!candidates.length) continue;
        const pick = candidates.find((candidate) => candidate.id === node.id)
            ?? candidates.find((candidate) => candidate.rootIndex === node.rootIndex && String(candidate.path) === String(node.path) && candidate.actionIndex === node.actionIndex)
            ?? candidates[0];
        matches.set(node.id, pick.id);
        usedPrevious.add(pick.id);
    }
    // Changed content: the node keeps its id when that id is still free.
    for (const node of next.nodes) {
        if (matches.has(node.id)) continue;
        const old = previousById.get(node.id);
        if (old && !isRootNode(old) && !usedPrevious.has(old.id)) {
            matches.set(node.id, old.id);
            usedPrevious.add(old.id);
        }
    }
    return matches;
}

/**
 * Absolute positions for the next state: a surviving node keeps its previous position, a spawned node takes its
 * spawn position. Nodes missing from the result are placed by the layout.
 */
export function carryPositions(previous, next, spawned = {}) {
    const matches = matchNodes(previous, next);
    const positions = {};
    for (const node of next.nodes) {
        if (spawned[node.id]) {
            positions[node.id] = spawned[node.id];
            continue;
        }
        const previousId = matches.get(node.id);
        if (previousId != null && previous.positions?.[previousId]) positions[node.id] = previous.positions[previousId];
    }
    return positions;
}

/** Centre-based spawn: the top-left corner that puts a node of `size` with its centre on `center`. */
export function topLeftForCenter(center, size) {
    return { x: center.x - size.width / 2, y: center.y - size.height / 2 };
}
