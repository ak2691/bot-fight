import { ACTION_TYPES, actionExecutionHead, createCodeRoot } from "../botlogic/code/BotCode.js";
import { BOT_CODE_SELECTABLES } from "../botlogic/code/contracts/BotLogicContracts.js";

// Wiring rules for the behaviour tree. The saved brain is roots -> conditionals -> children / actions, so every
// node has exactly one parent: a root or conditional takes one wire, and an action sits in one conditional.
// Wiring a connected conditional moves it. A connected action is never given a second parent: wiring it from a
// new output is refused, and only its input bar lifts it to move it. Pure functions: they return new roots.

const HEAD_LABELS = { movement: "Move", rotation: "Rotate", ability: "Ability", dash: "Dash", cancel: "Cancel" };
const isTail = (branch) => branch.branchType === "else";

const validEntries = (branch) => (branch?.actions ?? []).filter((entry) => entry.action && entry.action !== "none");

function at(roots, node) {
    if (!node.path) return roots[node.rootIndex];
    let branch = roots[node.rootIndex]?.branches?.[node.path[0]];
    for (const index of node.path.slice(1)) branch = branch?.children?.[index];
    return branch;
}

const actionHead = (entry) => {
    const definition = ACTION_TYPES.find((candidate) => candidate.id === entry?.action);
    return definition ? actionExecutionHead(definition) : null;
};
const sharesCategory = (head, other) => Boolean(head) && head !== "variable" && actionHead(other) === head;

// Takes a node out of the tree copy `next` (mutated). Returns the removed item, or null.
function detach(next, node) {
    const owner = at(next, node);
    if (!owner) return null;
    if (node.actionIndex != null) {
        owner.actions = validEntries(owner);
        const [entry] = owner.actions.splice(node.actionIndex, 1);
        if (!entry) return null;
        owner.action = owner.actions[0]?.action ?? "none";
        return entry;
    }
    const parent = node.path.length === 1 ? next[node.rootIndex] : at(next, { ...node, path: node.path.slice(0, -1) });
    const list = node.path.length === 1 ? parent.branches : parent.children;
    const [item] = list.splice(node.path.at(-1), 1);
    if (!item) return null;
    list.forEach((branch, i) => { branch.priority = i + 1; if (!i) branch.branchType = "if"; });
    return item;
}

// Why `child` cannot be wired under `parent`, or null when it can. `move` is set when the child is lifted from
// its input bar, which moves it; otherwise an action that already has a parent is refused.
export function wireBlockReason(roots, parent, child, { move = false } = {}) {
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
        if (!move) return "Already connected to a node. Lift its input bar to move it.";
        // Moving an action onto the conditional it already hangs from changes nothing.
        if (current === owner) return "Already connected to this node";
        const action = validEntries(current)[child.actionIndex];
        const head = actionHead(action);
        if (head && head !== "variable" && validEntries(owner).some((entry) => sharesCategory(head, entry))) {
            return `This conditional already has a ${HEAD_LABELS[head] ?? "matching"} action`;
        }
    }
    return null;
}

export function canWireNodes(roots, parent, child, options = {}) {
    return wireBlockReason(roots, parent, child, options) === null;
}

// `xOf(branch)` returns a conditional's canvas X (or undefined). When given, a wired conditional is inserted
// among its siblings by X instead of appended, so the order badges match the left-to-right rule at once.
export function wireNodes(roots, parent, child, { xOf, move = false } = {}) {
    if (!canWireNodes(roots, parent, child, { move })) return null;
    const next = structuredClone(roots);
    // The target is resolved before the detach: removing an earlier sibling shifts the parent's path.
    const target = at(next, parent);
    const item = detach(next, child);
    if (!target || !item) return null;
    if (child.actionIndex != null) {
        target.actions = validEntries(target);
        target.actions.push(item);
        target.action = target.actions[0]?.action ?? "none";
        return next;
    }
    const key = parent.path ? "children" : "branches";
    target[key] ??= [];
    const list = target[key];
    const itemX = xOf?.(item);
    let index = list.length;
    if (Number.isFinite(itemX) && !isTail(item)) {
        const later = list.findIndex((branch) => !isTail(branch) && xOf(branch) > itemX);
        index = later >= 0 ? later : list.findIndex(isTail) >= 0 ? list.findIndex(isTail) : list.length;
    }
    list.splice(index, 0, item);
    list.sort((a, b) => Number(isTail(a)) - Number(isTail(b)));
    list.forEach((branch, i) => { branch.priority = i + 1; if (!i) branch.branchType = "if"; });
    return next;
}

// Where a node added with "+ Node", F, a double-click or a released wire attaches. `selected` is the chosen root
// (path null) or conditional/action (path of its conditional), or null. Nothing selected means the last root;
// no roots at all means a new root is added first (`newRoot`).
export function attachTargetFor(roots, selected = null) {
    if (!roots.length) return { rootIndex: 0, path: null, newRoot: true };
    if (selected && roots[selected.rootIndex]) return { rootIndex: selected.rootIndex, path: selected.path ?? null };
    return { rootIndex: roots.length - 1, path: null };
}

// The entry an action picked from the picker starts with. Variable actions start on the first custom variable.
export function newActionEntry(action, customVariables = []) {
    return {
        action: action.id,
        selectable: BOT_CODE_SELECTABLES.OPPONENT,
        ...(action.variableAction ? {
            variableId: customVariables[0]?.id ?? "",
            operation: "set",
            ...(customVariables[0]?.valueType === "boolean"
                ? { value: false }
                : { terms: [{ operator: "set", operand: { type: "number", value: 0 } }] }),
        } : {}),
    };
}

// Adds `list` a branch before any ELSE, and renumbers the siblings (the first one is IF).
function insertBranch(list, branch) {
    const tail = list.findIndex(isTail);
    const index = tail >= 0 ? tail : list.length;
    list.splice(index, 0, branch);
    list.forEach((item, i) => { item.priority = i + 1; if (!i) item.branchType = "if"; });
    return index;
}

// Attaches a new node under `target`. `pick` is { kind: "conditional", branch } or { kind: "action", entry }.
// Conditionals go last among their siblings, before an ELSE. An action under a conditional follows the one-per-
// category rule. Roots hold conditionals only, so an action added under a root goes into an Always conditional of
// its own. Returns { roots, select } where `select` names the new node, or { reason } when it is refused.
export function attachNewNode(roots, target, pick) {
    if (!target) return { reason: "Add a root first" };
    const next = structuredClone(roots);
    if (target.newRoot) next.push(createCodeRoot(1, "Root"));
    const root = next[target.rootIndex];
    if (!root) return { reason: "That node is no longer available" };
    root.branches ??= [];
    if (!target.path) {
        if (pick.kind === "conditional") {
            const index = insertBranch(root.branches, pick.branch);
            return { roots: next, select: { rootIndex: target.rootIndex, path: [index] } };
        }
        const wrapper = { branchType: "if", conditions: [{ type: "always" }], actions: [pick.entry], children: [] };
        const index = insertBranch(root.branches, wrapper);
        return { roots: next, select: { rootIndex: target.rootIndex, path: [index], actionIndex: 0 } };
    }
    const owner = at(next, target);
    if (!owner) return { reason: "That node is no longer available" };
    if (pick.kind === "conditional") {
        owner.children ??= [];
        const index = insertBranch(owner.children, pick.branch);
        return { roots: next, select: { rootIndex: target.rootIndex, path: [...target.path, index] } };
    }
    const head = actionHead(pick.entry);
    if (head && head !== "variable" && validEntries(owner).some((entry) => sharesCategory(head, entry))) {
        return { reason: `This conditional already has a ${HEAD_LABELS[head] ?? "matching"} action` };
    }
    owner.actions = validEntries(owner);
    owner.actions.push(pick.entry);
    owner.action = owner.actions[0]?.action ?? "none";
    return { roots: next, select: { rootIndex: target.rootIndex, path: target.path, actionIndex: owner.actions.length - 1 } };
}
