// Gameplay geometry is expressed in virtual arena units. CSS pixels are only
// used by the responsive viewport that renders this coordinate space.
export const ARENA_WIDTH_UNITS = 1200;
export const ARENA_HEIGHT_UNITS = 1200;
// Keep the same 150-unit inset from the top/bottom arena edges at the larger
// world size: team one starts at 150 and team two starts at 1050.
export const SPAWN_EDGE_MARGIN_UNITS = 150;
export const BOT_SIZE = 60;
export const BOT_RADIUS = BOT_SIZE / 2;
export const BOT_CENTER_MIN_X = BOT_RADIUS;
export const BOT_CENTER_MAX_X = ARENA_WIDTH_UNITS - BOT_RADIUS;
export const BOT_CENTER_MIN_Y = BOT_RADIUS;
export const BOT_CENTER_MAX_Y = ARENA_HEIGHT_UNITS - BOT_RADIUS;
export const DISPLAY_ARENA_MAX_SIZE = 1000;
export const AUTO_STEP_MS = 100;
export const ROTATION_STEP_DEG = 12;
export const BASE_BOT_HP = 150;
export const DUEL_SLOT_ONE_X = ARENA_WIDTH_UNITS / 2;
export const DUEL_SLOT_ONE_Y = SPAWN_EDGE_MARGIN_UNITS;
export const DUEL_SLOT_TWO_X = ARENA_WIDTH_UNITS / 2;
export const DUEL_SLOT_TWO_Y = ARENA_HEIGHT_UNITS - SPAWN_EDGE_MARGIN_UNITS;
export const PRACTICE_PLAYER_START = Object.freeze({
    x: DUEL_SLOT_TWO_X,
    y: DUEL_SLOT_TWO_Y,
    rotation: 0,
});
export const PRACTICE_OPPONENT_START = Object.freeze({
    x: DUEL_SLOT_ONE_X,
    y: DUEL_SLOT_ONE_Y,
    rotation: 180,
});
// Replay compatibility for authoritative frames created before arena objects
// were removed from the live frontend flow.
export const DEFENSE_WALL_TYPE = "defenseWall";
export const SESSION_KEY = "arena-building-session-id";
