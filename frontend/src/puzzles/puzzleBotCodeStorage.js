import { CODE_EDITOR_GRAPH_VERSION, sanitizeCodeEditorGraph } from "../gameArena/botlogic/graph/CodeEditorGraph.js";
import {
    createDefaultAbilityStrategyConfiguration,
    normalizeAbilityStrategyConfiguration,
} from "../gameArena/botlogic/code/BotCode.js";

export const PUZZLE_BOT_CODE_STORAGE_PREFIX = "botfight-puzzle-bot-code-v1";
const MAX_PUZZLE_BOT_CODE_BYTES = 750_000;

function browserStorage() {
    if (typeof window === "undefined") return null;
    try {
        return window.localStorage;
    } catch {
        return null;
    }
}

export function puzzleBotCodeStorageKey(puzzleNumber) {
    const puzzle = String(puzzleNumber ?? "").trim();
    return puzzle ? `${PUZZLE_BOT_CODE_STORAGE_PREFIX}:${encodeURIComponent(puzzle)}` : null;
}

function normalizeStoredCode(value, fallback = null) {
    if (!value || typeof value !== "object") return fallback;
    const normalized = normalizeAbilityStrategyConfiguration(value);
    return value.editorGraph?.version === CODE_EDITOR_GRAPH_VERSION
        ? { ...normalized, editorGraph: sanitizeCodeEditorGraph(value.editorGraph) }
        : normalized;
}

export function readPuzzleBotCodeDraft(puzzleNumber, fallback = createDefaultAbilityStrategyConfiguration(), storage = browserStorage()) {
    const defaultCode = normalizeStoredCode(fallback, createDefaultAbilityStrategyConfiguration());
    const key = puzzleBotCodeStorageKey(puzzleNumber);
    if (!key || !storage) return defaultCode;
    try {
        const raw = storage.getItem(key);
        if (!raw) return defaultCode;
        return normalizeStoredCode(JSON.parse(raw), defaultCode);
    } catch {
        return defaultCode;
    }
}

export function savePuzzleBotCodeDraft(puzzleNumber, configuration, storage = browserStorage()) {
    const key = puzzleBotCodeStorageKey(puzzleNumber);
    const normalized = normalizeStoredCode(configuration);
    if (!key || !storage || !normalized) return false;
    const serialized = JSON.stringify(normalized);
    if (serialized.length * 2 > MAX_PUZZLE_BOT_CODE_BYTES) return false;
    try {
        storage.setItem(key, serialized);
        return true;
    } catch {
        return false;
    }
}
