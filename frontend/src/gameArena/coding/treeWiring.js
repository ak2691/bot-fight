import { ACTION_TYPES, actionExecutionHead } from "../../../../shared/engine/botlogic/code/BotCode.js";
import { CHAIN_ACTION_TYPES } from "../../../../shared/engine/botlogic/code/contracts/BotLogicContracts.js";
import { isLinkId, linkContentKey } from "../../../../shared/engine/botlogic/code/configuration/linkedActions.js";
import { createEditorNodeId } from "../../../../shared/engine/botlogic/code/configuration/identifiers.js";

/** A fresh link id for a newly shared action. Editor-only: the engine never creates ids (it is deterministic). */
export function createLinkId() {
    const cryptoApi = globalThis.crypto;
    const random = typeof cryptoApi?.randomUUID === "function"
        ? cryptoApi.randomUUID().replace(/-/g, "").slice(0, 12)
        : Math.random().toString(36).slice(2, 14).padEnd(12, "0");
    return `link-${random}`;
}

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

const validEntries = (branch) => (branch?.actions ?? []).filter((entry) => entry.action && entry.action !== "none");

// Every conditional and root-action holder of the editor roots with where it sits, in tree order. Bare orphan
// actions have no parent, so they never take part in a link.
function branchLocations(roots) {
    const found = [];
    const visit = (rootIndex, branch, path) => {
        if (!branch || branch._actionOrphan) return;
        found.push({ rootIndex, path, branch });
        (branch.children ?? []).forEach((child, index) => visit(rootIndex, child, [...path, index]));
    };
    roots.forEach((root, rootIndex) => (root.branches ?? []).forEach((branch, index) => visit(rootIndex, branch, [index])));
    return found;
}

// The copies of one linked action, in tree order. `actionIndex` indexes the holder's real (non-N/A) actions.
export function linkedCopies(roots, linkId) {
    if (!isLinkId(linkId)) return [];
    return branchLocations(roots).flatMap(({ rootIndex, path, branch }) => validEntries(branch)
        .map((entry, actionIndex) => ({ rootIndex, path, branch, entry, actionIndex }))
        .filter((copy) => copy.entry.linkId === linkId));
}

const actionHead = (entry) => {
    const definition = [...ACTION_TYPES, ...CHAIN_ACTION_TYPES].find((candidate) => candidate.id === entry?.action);
    return definition ? actionExecutionHead(definition) : null;
};
const sharesCategory = (head, other) => head && !["variable", "chain"].includes(head) && actionHead(other) === head;

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

// A loose action with no parent at all (a bare orphan), as opposed to one inside a disconnected subtree.
function isBareOrphanAction(roots, node) {
    return Boolean(roots[node.rootIndex]?._orphan && at(roots, node)?._actionOrphan);
}

// Why `child` cannot be wired under `parent`, or null when it can. Roots and conditionals take one wire, so
// wiring a connected one moves it (the same as lifting its input first). An action that already has a parent
// gains this one as another parent instead (it is saved as a linked copy under each). Loops, self wires, a
// parent the action already hangs from, and a second action of the same category on one conditional are refused.
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
        // An action whose ability is not equipped has no category to clash with, and can still be moved.
        const head = action ? actionHead(action) : null;
        const target = parent.path ? owner : owner.branches?.find((branch) => branch._rootActions);
        // A connected action gains this parent (it does not move), so it must not already hang from it.
        if (!isBareOrphanAction(roots, child) && target
            && (target === current || (isLinkId(action?.linkId) && validEntries(target).some((entry) => entry.linkId === action.linkId)))) {
            return "Already connected to this node";
        }
        if (head && !["variable", "chain"].includes(head) && validEntries(target).some((entry) => entry !== action && sharesCategory(head, entry))) {
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
    const item = child.actionIndex != null && !isBareOrphanAction(next, child) ? copyForNewParent(next, child) : detach(next, child);
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

// Wiring a connected action under another parent: the original becomes a linked action and the new parent
// gets a copy with its own id and the same linkId.
function copyForNewParent(roots, child) {
    const source = validEntries(at(roots, child))[child.actionIndex];
    if (!source) return null;
    source.id ??= child.id;
    if (!isLinkId(source.linkId)) source.linkId = createLinkId();
    const { kind: _kind, ...content } = structuredClone(source);
    return { ...content, id: createEditorNodeId("node") };
}

// A lone surviving copy stops being linked.
function unlinkLoneCopy(roots, linkId) {
    const left = linkedCopies(roots, linkId);
    if (left.length === 1) delete left[0].entry.linkId;
}

// Removes one copy of a linked action; nothing becomes an orphan because the others still run it.
function removeLinkedCopy(roots, copy) {
    const next = structuredClone(roots);
    const holder = at(next, copy);
    const entries = validEntries(holder);
    const [removed] = entries.splice(copy.actionIndex, 1);
    if (!removed) return null;
    holder.actions = entries;
    holder.action = entries[0]?.action ?? "none";
    unlinkLoneCopy(next, removed.linkId);
    return next;
}

// How many parents an action node has: one per copy of its link, otherwise one.
export function parentCount(roots, node) {
    const linkId = linkIdOf(roots, node);
    return linkId ? Math.max(1, linkedCopies(roots, linkId).length) : 1;
}

// The link an action node belongs to, or null.
export function linkIdOf(roots, node) {
    const entry = node?.actionIndex != null ? validEntries(at(roots, node))[node.actionIndex] : null;
    return isLinkId(entry?.linkId) ? entry.linkId : null;
}

// Removes every copy of a link. Deleting a shared action removes all its wires and copies.
export function removeLinkedCopies(roots, linkId) {
    const next = structuredClone(roots);
    for (const copy of linkedCopies(next, linkId)) {
        const holder = at(next, copy);
        holder.actions = validEntries(holder).filter((candidate) => candidate !== copy.entry);
        holder.action = holder.actions[0]?.action ?? "none";
    }
    return next;
}

// Editing any copy of a linked action edits them all: the copy that changed since `previous` is written onto
// its siblings (each keeps its own id). Configurations without links come back untouched.
export function syncLinkedActions(previous, roots) {
    const before = new Map();
    for (const { branch } of branchLocations(previous)) {
        for (const entry of validEntries(branch)) if (entry.id && isLinkId(entry.linkId)) before.set(entry.id, linkContentKey(entry));
    }
    const mismatched = (list) => {
        const groups = new Map();
        for (const { branch } of branchLocations(list)) {
            for (const entry of validEntries(branch)) {
                if (!isLinkId(entry.linkId)) continue;
                if (!groups.has(entry.linkId)) groups.set(entry.linkId, []);
                groups.get(entry.linkId).push({ branch, entry });
            }
        }
        return [...groups.values()].filter((copies) => new Set(copies.map(({ entry }) => linkContentKey(entry))).size > 1);
    };
    if (!mismatched(roots).length) return roots;
    const next = structuredClone(roots);
    for (const copies of mismatched(next)) {
        const source = copies.find(({ entry }) => before.has(entry.id) && before.get(entry.id) !== linkContentKey(entry));
        if (!source) continue;
        const { id: _id, ...content } = source.entry;
        for (const copy of copies) {
            if (copy === source) continue;
            const id = copy.entry.id;
            for (const key of Object.keys(copy.entry)) delete copy.entry[key];
            Object.assign(copy.entry, structuredClone(content), id ? { id } : {});
            copy.branch.action = validEntries(copy.branch)[0]?.action ?? copy.branch.action;
        }
    }
    return next;
}

// Why changing the action in `copy` to `replacement` would break one of its other parents, or null when it can.
export function linkedChangeBlockReason(roots, copy, replacement) {
    const head = actionHead(replacement);
    if (!isLinkId(copy?.linkId) || !head || ["variable", "chain"].includes(head)) return null;
    for (const other of linkedCopies(roots, copy.linkId)) {
        if (other.entry.id === copy.id) continue;
        if (validEntries(other.branch).some((entry) => entry.id !== copy.id && entry !== other.entry && sharesCategory(head, entry))) {
            return `Another branch that uses this action already has a ${HEAD_LABELS[head] ?? "matching"} action`;
        }
    }
    return null;
}

// `copy` names which parent's wire to cut for a linked action (default: the node's own). A plain action or a
// conditional becomes an orphan as always.
export function disconnectNode(roots, child, copy = null) {
    if (child.actionIndex != null) {
        const entry = validEntries(at(roots, child))[child.actionIndex];
        if (isLinkId(entry?.linkId) && linkedCopies(roots, entry.linkId).length > 1) {
            return removeLinkedCopy(roots, { rootIndex: copy?.rootIndex ?? child.rootIndex, path: copy?.path ?? child.path, actionIndex: copy?.actionIndex ?? child.actionIndex });
        }
    }
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

// What a click on an action's input bar does. One parent: lift the wire, as always. Several: lifting would
// have to pick one wire, so nothing lifts and the wires are cut one at a time instead.
export function inputBarBehavior(parents) {
    return parents > 1
        ? { lift: false, message: `Connected to ${parents} nodes. Select a wire to disconnect it.` }
        : { lift: true, message: null };
}

// The confirmation before deleting an action that hangs from several parents, or null when it hangs from one.
export function sharedDeletePrompt(roots, node) {
    const parents = parentCount(roots, node);
    return parents > 1 ? `This action is used by ${parents} branches.` : null;
}
