import { CODE_EDITOR_GRAPH_VERSION, sanitizeCodeEditorGraph } from "./botlogic/graph/CodeEditorGraph.js";
import { normalizeAbilityStrategyConfiguration } from "./botlogic/code/BotCode.js";
import {
    DEFAULT_BOT_LOADOUT,
    decodeBotLoadout,
    decodeSandboxLoadout,
    encodeBotLoadout,
    encodeSandboxLoadout,
} from "./loadout/BotLoadout.js";

export const PRACTICE_ROOM_STORAGE_KEY = "arena-practice-room-v1";
const PRACTICE_ROOM_STORAGE_VERSION = 1;
const MAX_PRACTICE_ROOM_BYTES = 750_000;

function browserStorage() {
    return typeof localStorage === "undefined" ? null : localStorage;
}

export function normalizePracticeLoadout(value) {
    if (typeof value === "string" && value.startsWith("sandbox:")) {
        return encodeSandboxLoadout(decodeSandboxLoadout(value));
    }
    if (typeof value === "string" && value.startsWith("custom:")) {
        return encodeBotLoadout(decodeBotLoadout(value));
    }
    return encodeBotLoadout(DEFAULT_BOT_LOADOUT);
}

function normalizeStoredConfiguration(value) {
    if (!value || typeof value !== "object") return null;
    const normalized = normalizeAbilityStrategyConfiguration(value);
    return value.editorGraph?.version === CODE_EDITOR_GRAPH_VERSION
        ? { ...normalized, editorGraph: sanitizeCodeEditorGraph(value.editorGraph) }
        : normalized;
}

function storedBotState(value) {
    return {
        loadout: normalizePracticeLoadout(value?.loadout),
        code: normalizeStoredConfiguration(value?.code),
    };
}

export function readPracticeRoomDraft(storage = browserStorage()) {
    if (!storage) return null;
    try {
        const raw = storage.getItem(PRACTICE_ROOM_STORAGE_KEY);
        if (!raw) return null;
        const parsed = JSON.parse(raw);
        if (!parsed || typeof parsed !== "object") return null;
        return {
            version: PRACTICE_ROOM_STORAGE_VERSION,
            player: storedBotState(parsed.player),
            opponent: storedBotState(parsed.opponent),
        };
    } catch {
        return null;
    }
}

export function savePracticeRoomDraft(draft, storage = browserStorage()) {
    if (!storage) return false;
    const current = readPracticeRoomDraft(storage);
    const player = draft?.player ?? {};
    const opponent = draft?.opponent ?? {};
    const payload = {
        version: PRACTICE_ROOM_STORAGE_VERSION,
        player: {
            loadout: normalizePracticeLoadout(player.loadout ?? current?.player?.loadout),
            code: normalizeStoredConfiguration(player.code ?? current?.player?.code),
        },
        opponent: {
            loadout: normalizePracticeLoadout(opponent.loadout ?? current?.opponent?.loadout),
            code: normalizeStoredConfiguration(opponent.code ?? current?.opponent?.code),
        },
    };
    const serialized = JSON.stringify(payload);
    if (serialized.length * 2 > MAX_PRACTICE_ROOM_BYTES) return false;
    try {
        storage.setItem(PRACTICE_ROOM_STORAGE_KEY, serialized);
        return true;
    } catch {
        return false;
    }
}
