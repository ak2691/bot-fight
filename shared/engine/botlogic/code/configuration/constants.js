/** The only brain format. Coordinates are public: centered, Y-up, -600..600. */
export const BOT_LOGIC_TREE_VERSION = "bot-logic-tree-v2";
export const COORDINATE_LIMITS = Object.freeze({ minimum: -600, maximum: 600, offsetMagnitude: 600 });
export const MAX_LOGIC_BLOCKS = 100;
export const MAX_ROOT_NODES = 100;
export const MAX_ROOT_NAME_LENGTH = 25;
export const MAX_TOTAL_CONDITIONS = 300;
export const MAX_CUSTOM_VARIABLE_SLOTS = 100;
export const MAX_VARIABLE_ACTION_TERMS = 20;
export const NUMBER_DECIMAL_PLACES = 1;
export const NUMBER_STEP = 0.1;
export const CUSTOM_NUMBER_MIN = -99_999;
export const CUSTOM_NUMBER_MAX = 99_999;

/** Truncates a finite user-facing number toward zero to one decimal place. */
export function truncateToNumberPrecision(value) {
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) return 0;
    const scale = 10 ** NUMBER_DECIMAL_PLACES;
    return Number((Math.trunc(numeric * scale) / scale).toFixed(NUMBER_DECIMAL_PLACES));
}
export const MAX_CONDITIONS_PER_BRANCH = MAX_TOTAL_CONDITIONS;
export const MIN_PRIORITY = 1;
export const MAX_PRIORITY = 10;
export const STRATEGY_TIME_LIMIT_MS = 15_000;

/** Lead aim: `current` (default) aims at the target where it is now. */
export const AIM_MODES = Object.freeze({ CURRENT: "current", LEAD: "lead", AUTO: "auto" });
export const MAX_LEAD_SECONDS = 2;

/** The lanes brain format: sections of cards (movement, actions, variables) plus custom variables. Tree brains stay unchanged. */
export const BOT_LOGIC_LANES_VERSION = "bot-logic-lanes-v1";
/**
 * The sections of a lanes brain. Movement holds move and rotation actions, Actions holds ability, dash and cancel
 * actions (one at a time), Variables holds variable actions. Empty sections are omitted when normalized.
 */
export const LANE_SECTIONS = Object.freeze(["movement", "actions", "variables"]);
/** Cards in the whole brain, follow-ups included; disabled cards count too. */
export const MAX_LANE_CARDS = 100;
export const MAX_LANE_CONDITIONS_PER_ENTRY = 6;
/** Follow-up levels below a top-level card (a follow-up of a follow-up counts as one more level). */
export const MAX_FOLLOW_UP_DEPTH = 3;
