import { ACTION_TYPES, actionExecutionHead } from "../botlogic/code/BotCode.js";
import { CHAIN_ACTION_TYPES } from "../botlogic/code/contracts/BotLogicContracts.js";

// Editor adapters expose root actions and disconnected subtrees through the same
// branch editing paths. These wrappers never enter the submitted brain.
export function editorRootsFor(configuration) {
    const roots = (configuration.roots ?? []).map((root) => ({ ...root,
        branches: [...(root.branches ?? []), ...(root.actions?.length ? [{ id: `${root.id}-actions`, _rootActions: true, conditions: [], actions: root.actions, children: [] }] : [])],
    }));
    for (const orphan of configuration.orphans ?? []) roots.push({ id: `orphan-wrapper:${orphan.id}`, _orphan: true, priority: roots.length + 1,
        branches: [orphan.kind === "action" ? { id: `${orphan.id}-wrapper`, _actionOrphan: true, conditions: [], actions: [orphan], children: [] } : orphan],
    });
    return roots;
}

export function brainFromEditorRoots(configuration, roots) {
    const orphans = [];
    const connected = [];
    for (const root of roots) {
        if (root._orphan) {
            for (const node of root.branches ?? []) {
                if (node._actionOrphan) orphans.push(...node.actions.map((entry) => ({ ...entry, kind: "action" })));
                else orphans.push({ ...node, kind: "conditional" });
            }
        } else {
            const clean = { ...root };
            delete clean._orphan;
            const actionBranch = root.branches?.find((node) => node._rootActions);
            connected.push({ ...clean, branches: (root.branches ?? []).filter((node) => !node._rootActions),
                ...(actionBranch || root.actions ? { actions: actionBranch?.actions ?? [] } : {}),
            });
        }
    }
    return { ...configuration, roots: connected, orphans };
}

function at(roots, node) {
    if (!node.path) return roots[node.rootIndex];
    let branch = roots[node.rootIndex]?.branches?.[node.path[0]];
    for (const index of node.path.slice(1)) branch = branch?.children?.[index];
    return branch;
}

function detach(roots, node) {
    const owner = at(roots, node);
    if (!owner) return null;
    if (node.actionIndex != null) {
        owner.actions = (owner.actions ?? []).filter((entry) => entry.action && entry.action !== "none");
        owner.actions.forEach((entry, i) => { entry.id ??= `action:${owner.id}:${i}:root:${node.rootId}`; });
        const entry = owner.actions.splice(node.actionIndex, 1)[0];
        // Branches mirror their first entry in the legacy action field. Clear
        // it too, otherwise normalization resurrects the disconnected action.
        owner.action = owner.actions[0]?.action ?? "none";
        entry.id = node.id;
        return entry;
    }
    const parent = node.path.length === 1 ? roots[node.rootIndex] : at(roots, { ...node, path: node.path.slice(0, -1) });
    const list = node.path.length === 1 ? parent.branches : parent.children;
    const item = list.splice(node.path.at(-1), 1)[0];
    const preserveIds = (branch) => {
        const originalId = branch.id;
        (branch.actions ?? []).forEach((entry, i) => { entry.id ??= `action:${originalId}:${i}:root:${node.rootId}`; });
        (branch.children ?? []).forEach(preserveIds);
    };
    preserveIds(item);
    item.id ??= node.id;
    list.forEach((branch, i) => { branch.priority = i + 1; if (!i && !branch._rootActions) branch.branchType = "if"; });
    return item;
}

const HEAD_LABELS = { movement: "Move", rotation: "Rotate", ability: "Ability", dash: "Dash", cancel: "Cancel" };
const isTail = (branch) => branch.branchType === "else" || branch._rootActions;

// Why `child` cannot be wired under `parent`, or null when it can. Every input takes one wire, so wiring a
// connected node moves it (the same as lifting its input first); only loops, self wires and a second
// action of the same category on one conditional are refused.
export function wireBlockReason(roots, parent, child) {
    if (!parent || !child) return "Pick a node to connect";
    if (parent.actionIndex != null) return "Actions have no output";
    if (!child.path) return "A root can't be connected under another node";
    if (parent.id === child.id) return "A node can't connect to itself";
    if (parent.rootIndex === child.rootIndex && child.actionIndex == null && parent.path
        && child.path.every((index, i) => parent.path[i] === index)) return "That would create a loop";
    const owner = at(roots, parent);
    const current = at(roots, child);
    if (!owner || !current) return "That node is no longer available";
    if (child.actionIndex != null) {
        const action = current.actions?.filter((entry) => entry.action && entry.action !== "none")[child.actionIndex];
        const definition = [...ACTION_TYPES, ...CHAIN_ACTION_TYPES].find((entry) => entry.id === action?.action);
        // An action whose ability is not equipped has no category to clash with, and can still be moved.
        const head = definition ? actionExecutionHead(definition) : null;
        const target = parent.path ? owner : owner.branches?.find((branch) => branch._rootActions);
        if (head && !["variable", "chain"].includes(head) && (target?.actions ?? []).some((entry) => entry !== action
            && [...ACTION_TYPES, ...CHAIN_ACTION_TYPES].some((candidate) => candidate.id === entry.action && actionExecutionHead(candidate) === head))) {
            return `This ${parent.path ? "conditional" : "root"} already has a ${HEAD_LABELS[head] ?? "matching"} action`;
        }
    }
    return null;
}

export function canWireNodes(roots, parent, child) {
    return wireBlockReason(roots, parent, child) === null;
}

// `xOf(branch)` returns a conditional's canvas X (or undefined). When given, a wired conditional is inserted
// among its siblings by X instead of appended, so the order badges match the left-to-right rule at once.
export function wireNodes(roots, parent, child, { xOf } = {}) {
    if (!canWireNodes(roots, parent, child)) return null;
    const next = structuredClone(roots);
    // Retain references before splicing shifts sibling paths.
    const owner = at(next, parent);
    const item = detach(next, child);
    if (!item) return null;
    delete item.kind;
    if (child.actionIndex != null) {
        let target = owner;
        if (!parent.path) {
            target = owner.branches.find((branch) => branch._rootActions);
            if (!target) { target = { id: `${owner.id}-actions`, _rootActions: true, conditions: [], actions: [], children: [] }; owner.branches.push(target); }
        }
        target.actions = (target.actions ?? []).filter((entry) => entry.action && entry.action !== "none");
        target.actions.push(item);
        target.action = target.actions[0]?.action ?? "none";
    } else {
        const key = parent.path ? "children" : "branches";
        owner[key] ??= [];
        const list = owner[key];
        const itemX = xOf?.(item);
        let index = list.length;
        if (Number.isFinite(itemX) && !isTail(item)) {
            const later = list.findIndex((branch) => !isTail(branch) && xOf(branch) > itemX);
            index = later >= 0 ? later : list.findIndex(isTail) >= 0 ? list.findIndex(isTail) : list.length;
        }
        list.splice(index, 0, item);
        list.sort((a, b) => Number(isTail(a)) - Number(isTail(b)));
        list.forEach((branch, i) => { branch.priority = i + 1; if (!i && !branch._rootActions) branch.branchType = "if"; });
    }
    return next.filter((root) => !root._orphan || root.branches.some((branch) => !branch._actionOrphan || branch.actions.length));
}

export function disconnectNode(roots, child) {
    const next = structuredClone(roots);
    const item = detach(next, child);
    if (!item) return null;
    // Use the graph identity as the orphan identity, preserving the frame's position.
    item.id ??= child.id;
    next.push({ id: `orphan-wrapper:${item.id}`, _orphan: true, branches: [child.actionIndex != null
        ? { id: `${item.id}-wrapper`, _actionOrphan: true, conditions: [], actions: [{ ...item, id: child.id }], children: [] }
        : item], priority: next.length + 1 });
    return next;
}

// Deleting a root removes only the root: its conditionals and root actions become orphans, subtrees intact.
export function removeRootKeepingChildren(roots, rootIndex) {
    const root = roots[rootIndex];
    if (!root) return roots;
    const next = roots.filter((_, index) => index !== rootIndex);
    if (root._orphan) return next;
    const preserveIds = (branch) => {
        (branch.actions ?? []).forEach((entry, i) => { entry.id ??= `action:${branch.id}:${i}:root:${root.id}`; });
        (branch.children ?? []).forEach(preserveIds);
    };
    const wrap = (id, branch) => ({ id: `orphan-wrapper:${id}`, _orphan: true, branches: [branch], priority: 0 });
    for (const original of structuredClone(root.branches ?? [])) {
        if (original._rootActions) {
            original.actions.forEach((entry, i) => {
                const id = entry.id ?? `action:${original.id}:${i}:root:${root.id}`;
                next.push(wrap(id, { id: `${id}-wrapper`, _actionOrphan: true, conditions: [], actions: [{ ...entry, id }], children: [] }));
            });
            continue;
        }
        preserveIds(original);
        original.branchType = "if";
        next.push(wrap(original.id, original));
    }
    next.forEach((entry, index) => { entry.priority = entry.priority || index + 1; });
    return next;
}
