import {
    CHAIN_ID_PATTERN,
    CHAIN_MS_MAX,
    CHAIN_MS_STEP,
    CHAIN_STEP_TYPES,
    MAX_CHAINS,
    MAX_CHAIN_NAME_LENGTH,
    MAX_CHAIN_STEPS,
    MAX_LOOP_NESTING,
    MAX_REPEAT_COUNT,
} from "./constants.js";
import { actionEntryCost } from "./configurationMetrics.js";
import { ACTION_HEADS, BOT_CODE_ACTIONS } from "../contracts/BotLogicContracts.js";
import { MAX_NODE_COORDINATE } from "./nodePositions.js";

const STEP_TYPES = new Set(Object.values(CHAIN_STEP_TYPES));

/** Rounds a duration to a whole tick and keeps it within the chain bounds. */
export function chainMs(value, fallback = CHAIN_MS_STEP) {
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) return fallback;
    return Math.max(CHAIN_MS_STEP, Math.min(CHAIN_MS_MAX, Math.round(numeric / CHAIN_MS_STEP) * CHAIN_MS_STEP));
}

/** Root `run_chain` fields: just the chain to start. A running chain is never replaced. */
export function normalizeChainActionFields(entry) {
    return entry.action === BOT_CODE_ACTIONS.RUN_CHAIN
        ? { chainId: String(entry.chainId ?? "") }
        : {};
}

/**
 * Sanitizes the brain's `chains`. Unknown step types and steps that cannot run are dropped,
 * durations snap to whole ticks, and `runChain` steps that point nowhere are removed.
 * `remaining` is the brain-wide action and condition budget shared with the roots.
 */
export function normalizeChains(source, remaining, customVariables, operations, coordinateVersion) {
    if (!Array.isArray(source)) return [];
    const used = new Set();
    const chains = [];
    for (const raw of source.slice(0, MAX_CHAINS)) {
        let id = String(raw?.id ?? "").trim();
        if (!CHAIN_ID_PATTERN.test(id) || used.has(id)) id = `chain.chain_${chains.length + 1}`;
        while (used.has(id)) id = `${id}_x`;
        used.add(id);
        const name = String(raw?.name ?? "").trim().replace(/\s+/g, " ").slice(0, MAX_CHAIN_NAME_LENGTH) || "Chain";
        const context = { remaining, customVariables, operations, coordinateVersion, steps: { count: 0 } };
        const steps = normalizeSteps(raw?.steps, context, 0);
        const loose = normalizeLooseBlocks(raw?.loose, context);
        chains.push({ id, name, steps, ...(loose.length ? { loose } : {}) });
    }
    return removeDanglingCalls(chains);
}

const looseCoordinate = (value) => {
    const numeric = Number(value);
    return Number.isFinite(numeric) ? Math.round(Math.max(0, Math.min(MAX_NODE_COORDINATE, numeric)) * 100) / 100 : 0;
};

/**
 * Loose blocks are `{ step, x, y }` leftovers of the editor: never run, but normalized like steps and
 * counted against the chain's step limit and the brain's budgets. A loose Else if is allowed.
 */
function normalizeLooseBlocks(rawLoose, context) {
    if (!Array.isArray(rawLoose)) return [];
    const loose = [];
    for (const raw of rawLoose.slice(0, MAX_CHAIN_STEPS)) {
        if (context.steps.count >= MAX_CHAIN_STEPS) break;
        const step = normalizeStep(raw?.step, context, 0);
        if (step) loose.push({ step, x: looseCoordinate(raw.x), y: looseCoordinate(raw.y) });
    }
    return loose;
}

function normalizeSteps(rawSteps, context, loopDepth) {
    if (!Array.isArray(rawSteps)) return [];
    const steps = [];
    for (const raw of upgradeLegacyChainSteps(rawSteps)) {
        if (context.steps.count >= MAX_CHAIN_STEPS) break;
        if (raw?.type === CHAIN_STEP_TYPES.ELSE_IF && ![CHAIN_STEP_TYPES.IF, CHAIN_STEP_TYPES.ELSE_IF].includes(steps.at(-1)?.type)) continue;
        const step = normalizeStep(raw, context, loopDepth);
        if (step) steps.push(step);
    }
    return steps;
}

/** Saved Yes/No branches become adjacent conditional bodies without losing their steps. */
export function upgradeLegacyChainSteps(steps) {
    return steps.flatMap((step) => {
        if (step?.type !== CHAIN_STEP_TYPES.IF || Array.isArray(step.steps)) return [step];
        const { then: yes, else: no, ...rest } = step;
        return [{ ...rest, steps: yes ?? [] }, ...(no?.length
            ? [{ type: CHAIN_STEP_TYPES.ELSE_IF, conditions: [], steps: no }] : [])];
    });
}

function charge(context, cost) {
    if (context.remaining.actions < cost) return false;
    context.remaining.actions -= cost;
    return true;
}

function conditionsFor(raw, context) {
    const conditions = Array.isArray(raw) && raw.length
        ? context.operations.normalizeConditions(raw, context.customVariables, undefined, context.coordinateVersion)
            .slice(0, Math.max(0, context.remaining.conditions))
        : [];
    context.remaining.conditions -= conditions.length;
    return conditions;
}

function normalizeStep(raw, context, loopDepth) {
    const type = raw?.type;
    if (!STEP_TYPES.has(type)) return null;
    if (type === CHAIN_STEP_TYPES.ACTION) return normalizeActionStep(raw, context);
    // Reserve the step before its children so nested steps count toward the chain's limit.
    if (!charge(context, 1)) return null;
    context.steps.count += 1;
    if (type === CHAIN_STEP_TYPES.WAIT) {
        const untilConditions = conditionsFor(raw.untilConditions, context);
        return untilConditions.length
            ? { type, untilConditions, maxMs: chainMs(raw.maxMs) }
            : { type, forMs: chainMs(raw.forMs) };
    }
    if (type === CHAIN_STEP_TYPES.IF || type === CHAIN_STEP_TYPES.ELSE_IF) {
        const conditions = conditionsFor(raw.conditions, context);
        return {
            type,
            conditions,
            steps: normalizeSteps(raw.steps, context, loopDepth),
        };
    }
    if (type === CHAIN_STEP_TYPES.REPEAT) {
        // Loops nest at most twice; a deeper loop is flattened to its body.
        const whileConditions = conditionsFor(raw.whileConditions, context);
        const header = whileConditions.length
            ? { type, whileConditions, maxMs: chainMs(raw.maxMs) }
            : { type, count: Math.max(1, Math.min(MAX_REPEAT_COUNT, Math.round(Number(raw.count)) || 1)) };
        return { ...header, steps: loopDepth >= MAX_LOOP_NESTING ? [] : normalizeSteps(raw.steps, context, loopDepth + 1) };
    }
    if (type === CHAIN_STEP_TYPES.RUN_CHAIN) return { type, chainId: String(raw.chainId ?? "") };
    return { type };
}

function normalizeActionStep(raw, context) {
    const entry = context.operations.normalizeActionEntry(raw, context.customVariables, context.coordinateVersion);
    if (!entry) return null;
    const head = context.operations.actionHead(entry.action);
    const stepOnly = head === ACTION_HEADS.MOVEMENT || head === ACTION_HEADS.ROTATION;
    const cost = actionEntryCost(entry);
    if (!charge(context, cost)) return null;
    context.steps.count += 1;
    const step = { type: CHAIN_STEP_TYPES.ACTION, ...entry };
    if (head === ACTION_HEADS.ABILITY || head === ACTION_HEADS.DASH) step.continue = raw.continue === "now" ? "now" : "end";
    // Walk and Rotate run for a fixed time; waiting for a condition is what Repeat while is for.
    if (stepOnly) step.forMs = chainMs(raw.forMs);
    return step;
}

function removeDanglingCalls(chains) {
    const ids = new Set(chains.map((chain) => chain.id));
    const prune = (steps) => steps
        .filter((step) => step.type !== CHAIN_STEP_TYPES.RUN_CHAIN || ids.has(step.chainId))
        .map((step) => ({
            ...step,
            ...(step.then ? { then: prune(step.then) } : {}),
            ...(step.else ? { else: prune(step.else) } : {}),
            ...(step.steps ? { steps: prune(step.steps) } : {}),
        }));
    return chains.map((chain) => {
        const loose = (chain.loose ?? []).flatMap((entry) => {
            const [step] = prune([entry.step]);
            return step ? [{ ...entry, step }] : [];
        });
        return { ...chain, steps: prune(chain.steps), ...(loose.length ? { loose } : {}) };
    });
}
