import { actionEntryCost } from "./configurationMetrics.js";
import {
    conditionalIdFor,
    normalizeCreatedOrder,
    rootIdForCreatedOrder,
} from "./identifiers.js";
import { MAX_ROOT_NAME_LENGTH } from "./constants.js";

export function normalizeRoot(root, rootIndex, remaining, customVariables, operations) {
    const createdOrder = normalizeCreatedOrder(root?.createdOrder, rootIndex);
    const rootId = rootIdForCreatedOrder(createdOrder, rootIndex);
    return {
        id: rootId,
        name: normalizeRootName(root?.name),
        createdOrder,
        branches: normalizeBranches(root?.branches, remaining, customVariables, operations, rootId, 1),
    };
}

function normalizeRootName(value) {
    const name = String(value ?? "").trim().replace(/\s+/g, " ").slice(0, MAX_ROOT_NAME_LENGTH);
    return name || "Root";
}

function normalizeBranches(branches, remaining, customVariables, operations, rootId, depth) {
    if (!Array.isArray(branches) || remaining.conditions <= 0) return [];
    const normalized = [];
    for (let index = 0; index < branches.length && remaining.conditions > 0; index += 1) {
        const branch = branches[index];
        const normalizedBlock = operations.normalizeBlock(branch, index, customVariables);
        const createdOrder = normalizeCreatedOrder(branch?.createdOrder, index);
        const actions = [];
        for (const entry of normalizedBlock.actions) {
            if (entry.action === "none") continue;
            const cost = actionEntryCost(entry);
            if (remaining.actions < cost) break;
            actions.push(entry);
            remaining.actions -= cost;
        }
        if (!actions.length) actions.push({ action: "none", actionTarget: "opponent" });
        const conditions = branch?.branchType === "else"
            ? []
            : operations.normalizeConditions(branch?.conditions, customVariables).slice(0, remaining.conditions);
        remaining.conditions -= conditions.length;
        const children = normalizeBranches(branch?.children, remaining, customVariables, operations, rootId, depth + 1);
        normalized.push({
            ...normalizedBlock,
            id: conditionalIdFor(rootId, depth, createdOrder, index),
            ...actions[0],
            actions,
            branchType: index === 0 ? "if" : branch?.branchType === "else" ? "else" : "if",
            createdOrder,
            conditions,
            children,
        });
    }
    return normalized;
}

