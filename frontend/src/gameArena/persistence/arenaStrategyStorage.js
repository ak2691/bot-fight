import { BOT_CODE_SELECTABLES, createDefaultAbilityStrategyConfiguration, normalizeAbilityStrategyConfiguration } from "../botlogic/code/BotCode.js";
import { CODE_EDITOR_GRAPH_VERSION, sanitizeCodeEditorGraph } from "../botlogic/graph/CodeEditorGraph.js";
import { actionIdsForLoadoutConfiguration } from "../gameconfig/CombatLoadouts.js";

const STRATEGY_STORAGE_PREFIXES = Object.freeze([
    "arena-testing-strategy-v1-",
    "arena-testing-opponent-strategy-v1-",
    "arena-match-strategy-v1-",
    "arena-match-opponent-strategy-v1-",
]);
const MAX_STORED_STRATEGY_BYTES = 750_000;

export function matchStrategyConfigurationKey(matchId, userId, loadoutId) {
    return matchId && userId
        ? `arena-match-strategy-v1-${loadoutId}-${matchId}-${userId}`
        : `arena-testing-strategy-v1-${loadoutId}`;
}

export function opponentStrategyConfigurationKey(matchId, userId, loadoutId) {
    return matchId && userId
        ? `arena-match-opponent-strategy-v1-${loadoutId}-${matchId}-${userId}`
        : `arena-testing-opponent-strategy-v1-${loadoutId}`;
}

export function loadStoredStrategyConfiguration(key) {
    if (!key) return createDefaultAbilityStrategyConfiguration();
    try {
        const stored = localStorage.getItem(key);
        if (!stored) return createDefaultAbilityStrategyConfiguration();
        const parsed = JSON.parse(stored);
        const normalized = normalizeAbilityStrategyConfiguration(parsed);
        return parsed?.editorGraph?.version === CODE_EDITOR_GRAPH_VERSION
            ? { ...normalized, editorGraph: sanitizeCodeEditorGraph(parsed.editorGraph) }
            : normalized;
    } catch {
        return createDefaultAbilityStrategyConfiguration();
    }
}

export function sanitizeStrategyConfigurationForLoadout(configuration, loadoutId) {
    const sourceConfiguration = configuration && typeof configuration === "object"
        ? configuration
        : createDefaultAbilityStrategyConfiguration();
    const source = normalizeAbilityStrategyConfiguration(sourceConfiguration);
    const allowedActionIds = new Set(actionIdsForLoadoutConfiguration(loadoutId));
    const sanitizeAction = (action) => {
        if (!action || typeof action !== "object") return action;
        const actionId = allowedActionIds.has(action.action) ? action.action : "none";
        return {
            ...action,
            action: actionId,
            selectable: actionId === "none" ? BOT_CODE_SELECTABLES.OPPONENT : action.selectable,
        };
    };
    const sanitizeBlock = (block) => {
        if (!block || typeof block !== "object") return block;
        return {
            ...block,
            ...sanitizeAction(block),
            ...(Array.isArray(block.actions) ? { actions: block.actions.map(sanitizeAction) } : {}),
            ...(Array.isArray(block.children) ? { children: block.children.map(sanitizeBlock) } : {}),
        };
    };
    return {
        ...source,
        roots: Array.isArray(source.roots) ? source.roots.map((root) => ({
            ...root,
            branches: Array.isArray(root?.branches) ? root.branches.map(sanitizeBlock) : [],
        })) : [],
    };
}

export function saveStoredStrategyConfiguration(key, configuration) {
    if (!key) return false;
    const serialized = JSON.stringify(configuration);
    if (serialized.length * 2 > MAX_STORED_STRATEGY_BYTES) {
        console.warn("[arena-logic] Strategy draft is too large to persist safely.");
        return false;
    }
    try {
        localStorage.setItem(key, serialized);
        return true;
    } catch (error) {
        if (!isStorageQuotaError(error)) throw error;
    }

    removeStaleStrategyDrafts(key);
    try {
        localStorage.setItem(key, serialized);
        return true;
    } catch (error) {
        if (!isStorageQuotaError(error)) throw error;
        console.warn("[arena-logic] Browser storage is full; the current code remains available in memory but was not persisted.");
        return false;
    }
}

function removeStaleStrategyDrafts(activeKey) {
    const staleKeys = [];
    const counterpartKey = activeKey.includes("-opponent-strategy-")
        ? activeKey.replace("-opponent-strategy-", "-strategy-")
        : activeKey.replace("-strategy-", "-opponent-strategy-");
    for (let index = 0; index < localStorage.length; index += 1) {
        const candidate = localStorage.key(index);
        if (candidate && candidate !== activeKey && candidate !== counterpartKey
            && STRATEGY_STORAGE_PREFIXES.some((prefix) => candidate.startsWith(prefix))) {
            staleKeys.push(candidate);
        }
    }
    staleKeys.forEach((key) => localStorage.removeItem(key));
}

function isStorageQuotaError(error) {
    return error?.name === "QuotaExceededError"
        || error?.name === "NS_ERROR_DOM_QUOTA_REACHED"
        || error?.code === 22
        || error?.code === 1014;
}
