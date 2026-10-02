import {
    ARENA_HEIGHT_UNITS,
    ARENA_WIDTH_UNITS,
    PUBLIC_BOT_CENTER_MAX_X,
    PUBLIC_BOT_CENTER_MAX_Y,
    PUBLIC_BOT_CENTER_MIN_X,
    PUBLIC_BOT_CENTER_MIN_Y,
} from "../modelPayloads/arenaConstants.js";
import { PUZZLE_OPPONENT_TEAM, PUZZLE_PLAYER_TEAM } from "../../pages/puzzles/puzzleRoster.js";

const HALF_WIDTH = ARENA_WIDTH_UNITS / 2;
const HALF_HEIGHT = ARENA_HEIGHT_UNITS / 2;

export function arenaBotDisplayName(bot) {
    const teamNumber = Number(bot?.teamNumber);
    const slot = Number(bot?.slot) || 1;
    if (teamNumber === PUZZLE_PLAYER_TEAM && slot === 1) return "My Bot";
    return teamNumber === PUZZLE_PLAYER_TEAM ? `Teammate ${slot - 1}` : `Opponent ${slot}`;
}

export function teamOf(bot) {
    return Number(bot?.teamNumber) === PUZZLE_OPPONENT_TEAM ? PUZZLE_OPPONENT_TEAM : PUZZLE_PLAYER_TEAM;
}

/** Whole-unit position clamped to the same legal spawn bounds the practice and puzzle validation use. */
export function clampStartPoint(x, y) {
    return {
        x: Math.min(PUBLIC_BOT_CENTER_MAX_X, Math.max(PUBLIC_BOT_CENTER_MIN_X, Math.round(x))),
        y: Math.min(PUBLIC_BOT_CENTER_MAX_Y, Math.max(PUBLIC_BOT_CENTER_MIN_Y, Math.round(y))),
    };
}

/** Pointer position inside the map square -> public arena coordinates (centre origin, Y up). */
export function mapPointToArena(clientX, clientY, rect) {
    const x = ((clientX - rect.left) / rect.width) * ARENA_WIDTH_UNITS - HALF_WIDTH;
    const y = HALF_HEIGHT - ((clientY - rect.top) / rect.height) * ARENA_HEIGHT_UNITS;
    return clampStartPoint(x, y);
}

