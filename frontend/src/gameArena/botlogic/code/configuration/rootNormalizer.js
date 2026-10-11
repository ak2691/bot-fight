import { actionEntryCost } from "./configurationMetrics.js";
import { linkBudgetKey } from "./linkedActions.js";
import {
    conditionalIdFor,
    priorityForNode,
    rootIdForIndex,
} from "./identifiers.js";
import { BOT_LOGIC_TREE_VERSION, MAX_ROOT_NAME_LENGTH, MAX_LOGIC_BLOCKS, MAX_TOTAL_CONDITIONS } from "./constants.js";
import { BOT_CODE_SELECTABLES } from "../contracts/BotLogicContracts.js";

export function normalizeRoot(
    root,
    rootIndex,
    remaining,
    customVariables,
    operations,
    normalizedPriority = priorityForNode(root, rootIndex + 1),
    coordinateVersion = BOT_LOGIC_TREE_VERSION,
) {
    const priority = normalizedPriority;
    // Root IDs identify the editor node, not its current execution priority.
    // Keeping an existing ID attached to the same array entry preserves graph
    // positions when a priority edit swaps priority values.
    const rootId = stableNodeId(root?.id, rootIdForIndex(rootIndex));
    return {
        id: rootId,
        name: normalizeRootName(root?.name),
        priority,
        branches: normalizeBranches(root?.branches, remaining, customVariables, operations, rootId, 1, coordinateVersion),
        ...(Array.isArray(root?.actions) ? { actions: normalizeNodeActions(root, remaining, customVariables, operations, coordinateVersion) } : {}),
    };
}

function normalizeRootName(value) {
    const name = String(value ?? "").trim().replace(/\s+/g, " ").slice(0, MAX_ROOT_NAME_LENGTH);
    return name || "Root";
}

function normalizeBranches(branches, remaining, customVariables, operations, rootId, depth, coordinateVersion) {
    if (!Array.isArray(branches) || remaining.conditions <= 0) return [];
    const normalized = [];
    for (let index = 0; index < branches.length && remaining.conditions > 0; index += 1) {
        const branch = branches[index];
        const normalizedBlock = operations.normalizeBlock(branch, index, customVariables, coordinateVersion);
        const priority = priorityForNode(branch, index + 1);
        const actions = [];
        for (const entry of normalizedBlock.actions) {
            if (entry.action === "none") continue;
            const cost = chargedCost(entry, remaining);
            if (remaining.actions < cost) break;
            actions.push(entry);
            remaining.actions -= cost;
        }
        if (!actions.length) actions.push({ action: "none", selectable: BOT_CODE_SELECTABLES.OPPONENT });
        const conditions = branch?.branchType === "else"
            ? []
            : operations.normalizeConditions(branch?.conditions, customVariables, undefined, coordinateVersion).slice(0, remaining.conditions);
        remaining.conditions -= conditions.length;
        const children = normalizeBranches(branch?.children, remaining, customVariables, operations, rootId, depth + 1, coordinateVersion);
        normalized.push({
            ...normalizedBlock,
            id: stableNodeId(branch?.id, conditionalIdFor(rootId, depth, index + 1, index + 1)),
            ...withoutEntryIdentity(actions[0]),
            actions,
            branchType: index === 0 ? "if" : branch?.branchType === "else" ? "else" : "if",
            priority,
            conditions,
            children,
        });
    }
    return normalized;
}

// Identical copies of a linked action cost once; `remaining.links` remembers the copies already paid for.
function chargedCost(entry, remaining) {
    const cost = actionEntryCost(entry);
    const key = linkBudgetKey(entry);
    if (key == null || !remaining.links) return cost;
    if (remaining.links.has(key)) return 0;
    remaining.links.add(key);
    return cost;
}

export function normalizeNodeActions(node, remaining, customVariables, operations, coordinateVersion) {
    const entries = operations.normalizeBlock(node, 0, customVariables, coordinateVersion).actions;
    const actions = [];
    for (const entry of entries) {
        if (!actionEntryCost(entry)) continue;
        const cost = chargedCost(entry, remaining);
        if (cost > remaining.actions) break;
        actions.push({ ...entry, ...(entry.id ? { id: entry.id } : {}) });
        remaining.actions -= cost;
    }
    return actions;
}

export function normalizeOrphans(source, remaining, customVariables, operations, coordinateVersion) {
    if (!Array.isArray(source)) return [];
    return source.slice(0, MAX_LOGIC_BLOCKS + MAX_TOTAL_CONDITIONS).flatMap((node, index) => {
        const id = stableNodeId(node?.id, `orphan-${index + 1}`);
        if (node?.kind === "action") {
            const actions = normalizeNodeActions({ actions: [node] }, remaining, customVariables, operations, coordinateVersion);
            return actions.length ? [{ ...actions[0], id, kind: "action" }] : [];
        }
        if (node?.kind !== "conditional") return [];
        const branches = normalizeBranches([node], remaining, customVariables, operations, id, 1, coordinateVersion);
        return branches.map((branch) => ({ ...branch, id, kind: "conditional", branchType: node.branchType === "else" ? "else" : "if" }));
    });
}

function stableNodeId(value, fallback) {
    const id = String(value ?? "").trim();
    return id || fallback;
}

function withoutEntryIdentity(entry) {
    // `id` and `kind` identify the action entry, never the branch that mirrors it.
    const { id: _id, kind: _kind, linkId: _linkId, ...rest } = entry;
    return rest;
}
