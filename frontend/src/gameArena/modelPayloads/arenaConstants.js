// Gameplay geometry is expressed in virtual arena units. CSS pixels are only
// used by the responsive viewport that renders this coordinate space.
export const ARENA_WIDTH_UNITS = 1000;
export const ARENA_HEIGHT_UNITS = 1000;
export const DISPLAY_ARENA_MAX_SIZE = 1000;
export const AUTO_STEP_MS = 100;
export const ROTATION_STEP_DEG = 12;
export const BASE_BOT_HP = 100;
export const DUEL_SLOT_ONE_X = ARENA_WIDTH_UNITS / 2;
export const DUEL_SLOT_ONE_Y = ARENA_HEIGHT_UNITS * 0.15;
export const DUEL_SLOT_TWO_X = ARENA_WIDTH_UNITS / 2;
export const DUEL_SLOT_TWO_Y = ARENA_HEIGHT_UNITS * 0.85;
// Replay compatibility for authoritative frames created before arena objects
// were removed from the live frontend flow.
export const DEFENSE_WALL_TYPE = "defenseWall";
export const SESSION_KEY = "arena-building-session-id";
