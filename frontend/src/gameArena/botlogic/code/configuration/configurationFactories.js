import {
    BOT_LOGIC_TREE_VERSION,
    MAX_ROOT_NAME_LENGTH,
} from "./constants.js";
import { createEditorNodeId, normalizePriority } from "./identifiers.js";

export function createDefaultAbilityStrategyConfiguration() {
    return {
        version: BOT_LOGIC_TREE_VERSION,
        roots: [],
        customVariables: [],
    };
}

export function createCodeRoot(priority = 1, name = "Root", id = null) {
    return {
        id: normalizeNodeId(id) ?? createEditorNodeId("root"),
        name: normalizeRootName(name),
        priority: normalizePriority(priority),
        branches: [],
    };
}

function normalizeRootName(value) {
    const normalized = String(value ?? "").trim().replace(/\s+/g, " ").slice(0, MAX_ROOT_NAME_LENGTH);
    return normalized || "Root";
}

function normalizeNodeId(value) {
    const id = String(value ?? "").trim();
    return id || null;
}
