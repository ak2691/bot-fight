import {
    BOT_LOGIC_TREE_VERSION,
} from "./constants.js";

export function createDefaultAbilityStrategyConfiguration() {
    return {
        version: BOT_LOGIC_TREE_VERSION,
        roots: [],
        customVariables: [],
    };
}

export function createCodeRoot(createdOrder = 0, name = "Root") {
    const rootIndex = Math.max(0, Math.trunc(Number(createdOrder) || 0));
    return {
        id: `root-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        name: normalizeRootName(name),
        createdOrder: rootIndex,
        branches: [],
    };
}

function normalizeRootName(value) {
    const normalized = String(value ?? "").trim().replace(/\s+/g, " ").slice(0, 40);
    return normalized || "Root";
}
