export const BOT_LOGIC_TREE_VERSION = "bot-logic-tree-v1";
export const MAX_LOGIC_BLOCKS = 100;
export const MAX_ROOT_NODES = 100;
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
