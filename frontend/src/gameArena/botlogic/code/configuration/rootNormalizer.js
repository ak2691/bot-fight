import { actionEntryCost } from "./configurationMetrics.js";
import {
    conditionalIdFor,
    priorityForNode,
    rootIdForIndex,
} from "./identifiers.js";
import { BOT_LOGIC_TREE_VERSION, MAX_LOGIC_BLOCKS, MAX_ROOT_NAME_LENGTH, MAX_TOTAL_CONDITIONS } from "./constants.js";
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
            const cost = actionEntryCost(entry);
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
            id: conditionalIdFor(rootId, depth, index + 1, index + 1),
            ...actions[0],
            actions,
            branchType: index === 0 ? "if" : branch?.branchType === "else" ? "else" : "if",
            priority,
            conditions,
            children,
        });
    }
    return normalized;
}

/**
 * Unconnected nodes (`orphans`): a conditional keeps its subtree, a bare action is one entry. They draw from the same
 * budgets as connected nodes (they are normalized after the roots) and are never selected at runtime.
 */
export function normalizeOrphans(source, remaining, customVariables, operations, coordinateVersion = BOT_LOGIC_TREE_VERSION) {
    if (!Array.isArray(source)) return [];
    const seen = new Set();
    const normalized = [];
    for (let index = 0; index < source.length && index < MAX_LOGIC_BLOCKS + MAX_TOTAL_CONDITIONS; index += 1) {
        const node = source[index];
        let id = stableNodeId(node?.id, `orphan-${index + 1}`);
        for (let suffix = 2; seen.has(id); suffix += 1) id = `${stableNodeId(node?.id, `orphan-${index + 1}`)}-${suffix}`;
        seen.add(id);
        if (node?.kind === "action") {
            const block = operations.normalizeBlock({ actions: [node] }, index, customVariables, coordinateVersion);
            const entry = block.actions.find((candidate) => candidate.action !== "none");
            if (!entry) continue;
            const cost = actionEntryCost(entry);
            if (remaining.actions < cost) continue;
            remaining.actions -= cost;
            normalized.push({ ...entry, id, kind: "action" });
        } else if (node?.kind === "conditional") {
            const [branch] = normalizeBranches([node], remaining, customVariables, operations, id, 1, coordinateVersion);
            if (branch) normalized.push({ ...branch, id, kind: "conditional" });
        }
    }
    return normalized;
}

function stableNodeId(value, fallback) {
    const id = String(value ?? "").trim();
    return id || fallback;
}

