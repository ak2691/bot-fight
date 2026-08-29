import { CODE_EDITOR_GRAPH_VERSION, sanitizeCodeEditorGraph } from "./botlogic/graph/CodeEditorGraph.js";
import { normalizeAbilityStrategyConfiguration } from "./botlogic/code/BotCode.js";
import {
    DEFAULT_BOT_LOADOUT,
    decodeBotLoadout,
    decodeSandboxLoadout,
    encodeBotLoadout,
    encodeSandboxLoadout,
} from "./loadout/BotLoadout.js";
import {
    BASE_BOT_HP,
    BOT_CENTER_MAX_X,
    BOT_CENTER_MAX_Y,
    BOT_CENTER_MIN_X,
    BOT_CENTER_MIN_Y,
    PRACTICE_OPPONENT_START,
    PRACTICE_PLAYER_START,
} from "./modelPayloads/arenaConstants.js";
import {
    PUZZLE_OPPONENT_TEAM,
    PUZZLE_PLAYER_TEAM,
    normalizePuzzleRoster,
    normalizePuzzleTeamSize,
    puzzleBotRole,
} from "../pages/puzzles/puzzleRoster.js";

export const PRACTICE_ROOM_STORAGE_KEY = "arena-practice-room-v1";
export const PRACTICE_ROOM_STORAGE_VERSION = 2;
const MAX_PRACTICE_ROOM_BYTES = 750_000;

function defaultPracticeBot(teamNumber, slot) {
    const isPlayer = Number(teamNumber) === PUZZLE_PLAYER_TEAM;
    const start = isPlayer ? PRACTICE_PLAYER_START : PRACTICE_OPPONENT_START;
    return {
        role: puzzleBotRole(teamNumber),
        teamNumber,
        slot,
        loadout: encodeBotLoadout(DEFAULT_BOT_LOADOUT),
        startX: start.x,
        startY: start.y,
        rotation: start.rotation,
        startHp: BASE_BOT_HP,
    };
}

export const DEFAULT_PRACTICE_CONFIG = Object.freeze({
    playerTeamSize: 1,
    opponentTeamSize: 1,
    initialElapsedMs: 0,
    bots: Object.freeze([
        Object.freeze(defaultPracticeBot(PUZZLE_PLAYER_TEAM, 1)),
        Object.freeze(defaultPracticeBot(PUZZLE_OPPONENT_TEAM, 1)),
    ]),
});

function browserStorage() {
    return typeof localStorage === "undefined" ? null : localStorage;
}

export function normalizePracticeLoadout(value) {
    if (value && typeof value === "object") {
        return encodeSandboxLoadout(value);
    }
    if (typeof value === "string" && value.startsWith("sandbox:")) {
        return encodeSandboxLoadout(decodeSandboxLoadout(value));
    }
    if (typeof value === "string" && value.startsWith("custom:")) {
        return encodeBotLoadout(decodeBotLoadout(value));
    }
    return encodeBotLoadout(DEFAULT_BOT_LOADOUT);
}

function boundedNumber(value, fallback, min, max) {
    const numeric = Number(value);
    const safeFallback = Number.isFinite(Number(fallback)) ? Number(fallback) : min;
    return Number.isFinite(numeric) ? Math.max(min, Math.min(max, numeric)) : safeFallback;
}

function teamNumberForPracticeBot(bot) {
    return Number(bot?.teamNumber) === PUZZLE_OPPONENT_TEAM
        || String(bot?.role ?? "").trim().toUpperCase() === "OPPONENT"
        ? PUZZLE_OPPONENT_TEAM
        : PUZZLE_PLAYER_TEAM;
}

function normalizedPracticeBot(bot, fallback) {
    const teamNumber = teamNumberForPracticeBot(bot);
    const slot = Math.max(1, Math.floor(Number(bot?.slot) || Number(fallback?.slot) || 1));
    return {
        role: puzzleBotRole(teamNumber),
        teamNumber,
        slot,
        loadout: normalizePracticeLoadout(bot?.loadout ?? fallback?.loadout),
        startX: boundedNumber(bot?.startX, fallback?.startX, BOT_CENTER_MIN_X, BOT_CENTER_MAX_X),
        startY: boundedNumber(bot?.startY, fallback?.startY, BOT_CENTER_MIN_Y, BOT_CENTER_MAX_Y),
        rotation: boundedNumber(bot?.rotation, fallback?.rotation, -360, 360),
        startHp: boundedNumber(bot?.startHp, fallback?.startHp ?? BASE_BOT_HP, 1, BASE_BOT_HP),
    };
}

export function normalizePracticeConfig(source) {
    const value = source && typeof source === "object" ? source : {};
    const legacyBots = [
        value.playerBot ? { ...value.playerBot, role: "PLAYER", teamNumber: PUZZLE_PLAYER_TEAM, slot: 1 } : null,
        value.opponentBot ? { ...value.opponentBot, role: "OPPONENT", teamNumber: PUZZLE_OPPONENT_TEAM, slot: 1 } : null,
    ].filter(Boolean);
    const sourceBots = Array.isArray(value.bots) ? value.bots : legacyBots;
    const playerCount = sourceBots.filter((bot) => teamNumberForPracticeBot(bot) === PUZZLE_PLAYER_TEAM).length;
    const opponentCount = sourceBots.filter((bot) => teamNumberForPracticeBot(bot) === PUZZLE_OPPONENT_TEAM).length;
    const playerTeamSize = normalizePuzzleTeamSize(value.playerTeamSize, playerCount || 1);
    const opponentTeamSize = normalizePuzzleTeamSize(value.opponentTeamSize, opponentCount || 1);
    const bots = normalizePuzzleRoster(
        sourceBots,
        playerTeamSize,
        opponentTeamSize,
        (teamNumber, slot) => defaultPracticeBot(teamNumber, slot),
    ).map((bot) => normalizedPracticeBot(
        bot,
        defaultPracticeBot(bot.teamNumber, bot.slot),
    ));
    const rawElapsedMs = value.initialElapsedMs ?? (
        value.timeSeconds == null ? 0 : Number(value.timeSeconds) * 1000
    );
    return {
        playerTeamSize,
        opponentTeamSize,
        initialElapsedMs: Math.round(boundedNumber(rawElapsedMs, 0, 0, 60_000)),
        bots,
    };
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
            config: normalizePracticeConfig(parsed.config),
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
    const config = normalizePracticeConfig(draft?.config ?? current?.config);
    const payload = {
        version: PRACTICE_ROOM_STORAGE_VERSION,
        config,
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
