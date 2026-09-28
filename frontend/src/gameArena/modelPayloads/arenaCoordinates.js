import { ARENA_HEIGHT_UNITS, ARENA_WIDTH_UNITS } from "./arenaConstants.js";

export const ARENA_CENTER_X = ARENA_WIDTH_UNITS / 2;
export const ARENA_CENTER_Y = ARENA_HEIGHT_UNITS / 2;
export const PUBLIC_ARENA_MIN = -600;
export const PUBLIC_ARENA_MAX = 600;
export const PUBLIC_BOT_CENTER_MIN = -570;
export const PUBLIC_BOT_CENTER_MAX = 570;

/** Converts centered/Y-up player coordinates to internal top-left/Y-down coordinates. */
export function publicPointToInternal(point) {
    return {
        x: Number(point?.x) + ARENA_CENTER_X,
        y: ARENA_CENTER_Y - Number(point?.y),
    };
}

/** Converts internal top-left/Y-down coordinates to centered/Y-up player coordinates. */
export function internalPointToPublic(point) {
    return {
        x: Number(point?.x) - ARENA_CENTER_X,
        y: ARENA_CENTER_Y - Number(point?.y),
    };
}

/** Converts a centered/Y-up vector or offset to internal coordinates. */
export function publicOffsetToInternal(offset) {
    return { x: Number(offset?.x), y: -Number(offset?.y) };
}

/** Converts an internal vector or offset to centered/Y-up coordinates. */
export function internalOffsetToPublic(offset) {
    return { x: Number(offset?.x), y: -Number(offset?.y) };
}

export function isPublicCoordinate(value) {
    const numeric = Number(value);
    return Number.isFinite(numeric) && numeric >= PUBLIC_ARENA_MIN && numeric <= PUBLIC_ARENA_MAX;
}

export function isPublicBotCenterCoordinate(value) {
    const numeric = Number(value);
    return Number.isFinite(numeric) && numeric >= PUBLIC_BOT_CENTER_MIN && numeric <= PUBLIC_BOT_CENTER_MAX;
}

