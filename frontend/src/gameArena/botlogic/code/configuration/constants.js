export const BOT_LOGIC_TREE_V1 = "bot-logic-tree-v1";
export const BOT_LOGIC_TREE_VERSION = "bot-logic-tree-v2";

export function coordinateVersionFor(configuration) {
    const version = configuration?.version;
    if (version === BOT_LOGIC_TREE_V1 || version === BOT_LOGIC_TREE_VERSION) return version;
    // A missing version can come from an older saved brain. New brains are
    // created explicitly with v2 by configurationFactories.js.
    return version == null ? BOT_LOGIC_TREE_V1 : String(version);
}

export function coordinateLimitsFor(version) {
    return version === BOT_LOGIC_TREE_V1
        ? { minimum: 0, maximum: 1200, offsetMagnitude: 1200 }
        : { minimum: -600, maximum: 600, offsetMagnitude: 600 };
}
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

/** Simulation tick length; chain loops and timed steps measure elapsed time in these. */
export const TICK_MS = 100;

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
export const LEAD_SECONDS_STEP = 0.1;

/** Action chains: bounds shared by normalization, validation and the runtime. */
export const MAX_CHAINS = 16;
export const MAX_CHAIN_STEPS = 32;
export const MAX_REPEAT_COUNT = 20;
export const CHAIN_MS_STEP = 100;
export const CHAIN_MS_MAX = 10_000;
export const MAX_LOOP_NESTING = 2;
export const MAX_CALL_DEPTH = 3;
export const MAX_CHAIN_NAME_LENGTH = 25;
export const CHAIN_ID_PATTERN = /^chain\.[a-z0-9_-]{1,40}$/;
export const CHAIN_STEP_TYPES = Object.freeze({
    ACTION: "action",
    WAIT: "wait",
    IF: "if",
    ELSE_IF: "elseIf",
    REPEAT: "repeat",
    RUN_CHAIN: "runChain",
    EXIT_LOOP: "exitLoop",
    END: "end",
});
