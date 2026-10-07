// Pure editing helpers for action chains: step addressing, numbering, add/remove/move, limits,
// call-graph checks and chain bookkeeping. UI-free so the rules can be tested directly.
import {
    ACTION_HEADS,
    BOT_CODE_ACTIONS,
    BOT_CODE_SELECTABLES,
} from "../../botlogic/code/contracts/BotLogicContracts.js";
import { createExpressionCondition, defaultSelectableForVariable } from "../../botlogic/code/BotCode.js";
import {
    CHAIN_ID_PATTERN,
    CHAIN_MS_MAX,
    CHAIN_MS_STEP,
    CHAIN_STEP_TYPES,
    MAX_CALL_DEPTH,
    MAX_CHAINS,
    MAX_CHAIN_NAME_LENGTH,
    MAX_CHAIN_STEPS,
    MAX_LOOP_NESTING,
    MAX_REPEAT_COUNT,
} from "../../botlogic/code/configuration/constants.js";
import { walkChainSteps, walkChainStepsWithLoose } from "../../botlogic/code/configuration/chainSteps.js";

export const BRANCH = "branch";
export const BODY = "body";
const LIST_FIELD = Object.freeze({ [BRANCH]: "steps", [BODY]: "steps" });

export const DEFAULT_STEP_MS = 500;
/** The step meter turns amber at 75% of the limit and red with two steps to spare. */
export const STEP_METER_AMBER_AT = Math.ceil(MAX_CHAIN_STEPS * 0.75);
export const STEP_METER_RED_AT = MAX_CHAIN_STEPS - 2;

// ---- Chains in a configuration -------------------------------------------------------------

export function chainsOf(configuration) {
    return Array.isArray(configuration?.chains) ? configuration.chains : [];
}

export function findChain(configuration, chainId) {
    return chainsOf(configuration).find((chain) => chain.id === chainId) ?? null;
}

/** Every step of the chain, nested and loose steps included: the number the 32-step limit counts. */
export function countChainSteps(chain) {
    return [...walkChainStepsWithLoose(chain)].length;
}

/** "" while there is room, "is-near" (amber) close to the limit, "is-full" (red) next to it. */
export function stepMeterState(count) {
    if (count >= STEP_METER_RED_AT) return "is-full";
    return count >= STEP_METER_AMBER_AT ? "is-near" : "";
}

function actionList(branch) {
    return Array.isArray(branch?.actions) && branch.actions.length ? branch.actions : branch?.action ? [branch] : [];
}

function* walkRootBranches(branches) {
    for (const branch of Array.isArray(branches) ? branches : []) {
        yield branch;
        yield* walkRootBranches(branch.children);
    }
}

/** How many roots run this chain, and how many other chains call it. */
export function chainUsage(configuration, chainId) {
    const roots = (Array.isArray(configuration?.roots) ? configuration.roots : []).filter((root) => (
        [root, ...walkRootBranches(root?.branches)].some((branch) => actionList(branch)
            .some((entry) => entry?.action === BOT_CODE_ACTIONS.RUN_CHAIN && entry.chainId === chainId))
    )).length;
    const chains = chainsOf(configuration).filter((chain) => chain.id !== chainId && callTargets(chain).has(chainId)).length;
    return { roots, chains };
}

export function callTargets(chain) {
    const targets = new Set();
    for (const step of walkChainSteps(chain?.steps)) {
        if (step.type === CHAIN_STEP_TYPES.RUN_CHAIN && step.chainId) targets.add(step.chainId);
    }
    return targets;
}

function chainSlug(name, fallback) {
    const slug = String(name ?? "").toLowerCase().replace(/[^a-z0-9_-]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 30);
    return slug || fallback;
}

export function cleanChainName(value, fallback = "") {
    return String(value ?? "").trim().replace(/\s+/g, " ").slice(0, MAX_CHAIN_NAME_LENGTH) || fallback;
}

/** A new empty chain with an unused name and ID. Returns null at the chain limit. */
export function createChain(configuration, requestedName = "") {
    const chains = chainsOf(configuration);
    if (chains.length >= MAX_CHAINS) return null;
    const names = new Set(chains.map((chain) => chain.name));
    let number = chains.length + 1;
    while (names.has(`Chain ${number}`)) number += 1;
    const name = cleanChainName(requestedName, `Chain ${number}`);
    const ids = new Set(chains.map((chain) => chain.id));
    const base = `chain.${chainSlug(name, `chain_${number}`)}`;
    let id = base;
    for (let suffix = 2; ids.has(id) || !CHAIN_ID_PATTERN.test(id); suffix += 1) id = `${base}_${suffix}`.slice(0, 46);
    return { id, name, steps: [] };
}

export function chainLimitReason(configuration) {
    return chainsOf(configuration).length >= MAX_CHAINS ? `A brain can have at most ${MAX_CHAINS} chains.` : null;
}

/** Renames without touching the ID, so existing Run chain references keep working. */
export function renameChain(configuration, chainId, name) {
    const chains = chainsOf(configuration);
    const target = chains.find((chain) => chain.id === chainId);
    const cleaned = cleanChainName(name, target?.name ?? "");
    if (!target || target.name === cleaned) return configuration;
    return { ...configuration, chains: chains.map((chain) => chain.id === chainId ? { ...chain, name: cleaned } : chain) };
}

export function updateChain(configuration, chainId, updater) {
    return {
        ...configuration,
        chains: chainsOf(configuration).map((chain) => chain.id === chainId ? updater(chain) : chain),
    };
}

function pruneCalls(steps, chainId) {
    return steps
        .filter((step) => !(step.type === CHAIN_STEP_TYPES.RUN_CHAIN && step.chainId === chainId))
        .map((step) => ({
            ...step,
            ...(step.then ? { then: pruneCalls(step.then, chainId) } : {}),
            ...(step.else ? { else: pruneCalls(step.else, chainId) } : {}),
            ...(step.steps ? { steps: pruneCalls(step.steps, chainId) } : {}),
        }));
}

function pruneRootRuns(branches, chainId) {
    return branches.map((branch) => {
        const next = { ...branch };
        if (Array.isArray(branch.children)) next.children = pruneRootRuns(branch.children, chainId);
        const isRun = (entry) => entry?.action === BOT_CODE_ACTIONS.RUN_CHAIN && entry.chainId === chainId;
        if (Array.isArray(branch.actions) ? branch.actions.some(isRun) : isRun(branch)) {
            const actions = actionList(branch).filter((entry) => !isRun(entry));
            const first = actions[0] ?? { action: BOT_CODE_ACTIONS.NONE, selectable: BOT_CODE_SELECTABLES.OPPONENT };
            Object.assign(next, { actions }, first);
        }
        return next;
    });
}

/** Deletes a chain and every Run chain step or root action that pointed at it. */
export function removeChain(configuration, chainId) {
    return {
        ...configuration,
        ...(Array.isArray(configuration.orphans) ? { orphans: pruneRootRuns(configuration.orphans.filter((node) => !(node.kind === "action" && node.action === BOT_CODE_ACTIONS.RUN_CHAIN && node.chainId === chainId)), chainId) } : {}),
        chains: chainsOf(configuration)
            .filter((chain) => chain.id !== chainId)
            .map((chain) => ({
                ...chain,
                steps: pruneCalls(chain.steps ?? [], chainId),
                ...(Array.isArray(chain.loose) ? { loose: chain.loose.flatMap((entry) => {
                    const [step] = pruneCalls([entry.step], chainId);
                    return step ? [{ ...entry, step }] : [];
                }) } : {}),
            })),
        ...(Array.isArray(configuration?.roots)
            ? { roots: configuration.roots.map((root) => ({ ...root, ...(root.actions ? { actions: root.actions.filter((entry) => !(entry.action === BOT_CODE_ACTIONS.RUN_CHAIN && entry.chainId === chainId)) } : {}), branches: pruneRootRuns(root.branches ?? [], chainId) })) }
            : {}),
    };
}

// ---- Call graph ----------------------------------------------------------------------------

function callGraph(chains) {
    return new Map(chains.map((chain) => [chain.id, [...callTargets(chain)].filter((id) => chains.some((other) => other.id === id))]));
}

function longestPath(edges, start, seen = new Set()) {
    if (seen.has(start)) return 0;
    seen.add(start);
    const longest = 1 + Math.max(0, ...(edges.get(start) ?? []).map((next) => longestPath(edges, next, new Set(seen))));
    return longest;
}

/** Why `callerId` cannot run `targetId`, or null when it can. */
export function callBlockReason(chains, callerId, targetId) {
    const nameOf = (id) => chains.find((chain) => chain.id === id)?.name ?? id;
    if (callerId === targetId) return "A chain cannot run itself.";
    const down = callGraph(chains);
    const reaches = (from, goal, seen = new Set()) => {
        if (from === goal) return true;
        if (seen.has(from)) return false;
        seen.add(from);
        return (down.get(from) ?? []).some((next) => reaches(next, goal, seen));
    };
    if (reaches(targetId, callerId)) return `${nameOf(targetId)} already runs this chain, which would loop.`;
    const up = new Map(chains.map((chain) => [chain.id, []]));
    for (const [from, targets] of down) for (const target of targets) up.get(target)?.push(from);
    if (longestPath(up, callerId) + longestPath(down, targetId) > MAX_CALL_DEPTH) {
        return `Chains can run other chains at most ${MAX_CALL_DEPTH} levels deep.`;
    }
    return null;
}

/** The first chain `callerId` may run, for a freshly added Run chain step. */
export function firstCallableChain(chains, callerId) {
    return chains.find((chain) => !callBlockReason(chains, callerId, chain.id)) ?? null;
}

// ---- Step addressing -----------------------------------------------------------------------
// A step path is `[index, label, index, ..., index]`; a list path is the same without the last
// index. Labels are "branch" and "body", matching the runtime's chain frame paths.

export const pathKey = (path) => path.join("/");
export const samePath = (first, second) => Array.isArray(first) && Array.isArray(second) && pathKey(first) === pathKey(second);
export const listPathOf = (path) => path.slice(0, -1);
export const indexOf = (path) => path.at(-1);
export const loopDepthAt = (listPath) => listPath.filter((part) => part === BODY).length;

export function listAt(steps, listPath = []) {
    let list = steps ?? [];
    for (let index = 0; index < listPath.length; index += 2) {
        const parent = list[listPath[index]];
        list = parent?.[LIST_FIELD[listPath[index + 1]]] ?? [];
    }
    return list;
}

export function stepAt(steps, path) {
    return listAt(steps, listPathOf(path))[indexOf(path)] ?? null;
}

/** Rebuilds the list at `listPath` with `updater(list)`, copying every step on the way down. */
export function updateListAt(steps, listPath, updater) {
    if (!listPath.length) return updater(steps ?? []);
    const [index, label, ...rest] = listPath;
    const field = LIST_FIELD[label];
    return (steps ?? []).map((step, position) => position === index
        ? { ...step, [field]: updateListAt(step[field] ?? [], rest, updater) }
        : step);
}

export function updateStepAt(steps, path, updater) {
    return updateListAt(steps, listPathOf(path), (list) => list.map((step, index) => index === indexOf(path) ? updater(step) : step));
}

export const isConditional = (step) => [CHAIN_STEP_TYPES.IF, CHAIN_STEP_TYPES.ELSE_IF].includes(step?.type);

export function appendStepAt(steps, listPath, step) {
    if (step.type === CHAIN_STEP_TYPES.ELSE_IF && !isConditional(listAt(steps, listPath).at(-1))) return steps;
    return updateListAt(steps, listPath, (list) => [...list, step]);
}

/** Insert at a pin's position, keeping Else if adjacent to a conditional. */
export function insertStepAt(steps, listPath, index, step) {
    const list = listAt(steps, listPath);
    if (!Number.isInteger(index) || index < 0 || index > list.length) return steps;
    const next = [...list.slice(0, index), step, ...list.slice(index)];
    if (next.some((entry, i) => entry.type === CHAIN_STEP_TYPES.ELSE_IF && !isConditional(next[i - 1]))) return steps;
    return updateListAt(steps, listPath, () => next);
}

export function removeStepAt(steps, path) {
    return updateListAt(steps, listPathOf(path), (list) => {
        const next = list.filter((_, index) => index !== indexOf(path));
        if (list[indexOf(path)]?.type === CHAIN_STEP_TYPES.IF && next[indexOf(path)]?.type === CHAIN_STEP_TYPES.ELSE_IF) {
            next[indexOf(path)] = { ...next[indexOf(path)], type: CHAIN_STEP_TYPES.IF };
        }
        return next;
    });
}

/** Swaps the step with its neighbour in the same list. Returns null at either end. */
export function moveStepAt(steps, path, delta) {
    const list = listAt(steps, listPathOf(path));
    const from = indexOf(path);
    const to = from + delta;
    if (to < 0 || to >= list.length) return null;
    const reordered = [...list];
    [reordered[from], reordered[to]] = [reordered[to], reordered[from]];
    if (reordered.some((step, index) => step.type === CHAIN_STEP_TYPES.ELSE_IF && !isConditional(reordered[index - 1]))) return null;
    const nextPath = [...listPathOf(path), to];
    return {
        path: nextPath,
        steps: updateListAt(steps, listPathOf(path), (current) => {
            const next = [...current];
            [next[from], next[to]] = [next[to], next[from]];
            return next;
        }),
    };
}

/** Whether `path` is `ancestor` or sits somewhere inside it. */
export function isWithin(path, ancestor) {
    return ancestor.length <= path.length && ancestor.every((part, index) => path[index] === part);
}

/** Step path -> number in reading order: the step, its conditional body, then what follows. Repeat is a bracket, not a numbered step. */
export function numberChainSteps(steps) {
    const numbers = new Map();
    let next = 1;
    const visit = (list, listPath) => list.forEach((step, index) => {
        const path = [...listPath, index];
        if (step.type !== CHAIN_STEP_TYPES.REPEAT) numbers.set(pathKey(path), next++);
        if (isConditional(step)) {
            visit(step.steps ?? [], [...path, BRANCH]);
        } else if (step.type === CHAIN_STEP_TYPES.REPEAT) {
            visit(step.steps ?? [], [...path, BODY]);
        }
    });
    visit(steps ?? [], []);
    return numbers;
}

// Every step of the stack as a path, top to bottom, the way the blocks are laid out.
export function stepPathsInOrder(steps) {
    const paths = [];
    const visit = (list, listPath) => list.forEach((step, index) => {
        const path = [...listPath, index];
        paths.push(path);
        if (isConditional(step)) visit(step.steps ?? [], [...path, BRANCH]);
        else if (step.type === CHAIN_STEP_TYPES.REPEAT) visit(step.steps ?? [], [...path, BODY]);
    });
    visit(steps ?? [], []);
    return paths;
}

// ---- Creating steps and blocking over-limit edits ------------------------------------------

export const FLOW_STEP_TYPES = Object.freeze([
    { id: CHAIN_STEP_TYPES.IF, label: "If", description: "Run these steps when the conditions hold" },
    { id: CHAIN_STEP_TYPES.ELSE_IF, label: "Else if", description: "Try these conditions if the preceding If did not match" },
    { id: CHAIN_STEP_TYPES.REPEAT, label: "Repeat", description: "Run steps several times or while something holds" },
    { id: CHAIN_STEP_TYPES.WAIT, label: "Wait", description: "Pause for a time or until something holds" },
    { id: CHAIN_STEP_TYPES.RUN_CHAIN, label: "Run chain", description: "Run another chain, then come back" },
    { id: CHAIN_STEP_TYPES.EXIT_LOOP, label: "Exit loop", description: "Leave the nearest Repeat" },
    { id: CHAIN_STEP_TYPES.END, label: "End", description: "Stop here and return to the caller" },
]);

/**
 * Why a step of `stepType` cannot be added at `listPath`, or null. `budget` carries the
 * brain-wide action and condition slots left, which chain steps share with the roots.
 */
export function addStepBlockReason({ chains, chain, listPath, stepType, budget, insertionIndex = listAt(chain.steps, listPath).length }) {
    if (countChainSteps(chain) >= MAX_CHAIN_STEPS) return `This chain is full (${MAX_CHAIN_STEPS} steps).`;
    if (budget && budget.actions <= 0) return "The brain is out of action slots.";
    if (stepType === CHAIN_STEP_TYPES.REPEAT && loopDepthAt(listPath) >= MAX_LOOP_NESTING) {
        return `Repeats can nest at most ${MAX_LOOP_NESTING} deep.`;
    }
    if (stepType === CHAIN_STEP_TYPES.EXIT_LOOP && loopDepthAt(listPath) === 0) return "Exit loop only works inside a Repeat.";
    if ([CHAIN_STEP_TYPES.IF, CHAIN_STEP_TYPES.ELSE_IF].includes(stepType) && budget && budget.conditions <= 0) return "The brain is out of condition slots.";
    if (stepType === CHAIN_STEP_TYPES.ELSE_IF && !isConditional(listAt(chain.steps, listPath)[insertionIndex - 1])) return "Else if must directly follow If or Else if.";
    if (listAt(chain.steps, listPath)[insertionIndex]?.type === CHAIN_STEP_TYPES.ELSE_IF && ![CHAIN_STEP_TYPES.IF, CHAIN_STEP_TYPES.ELSE_IF].includes(stepType)) return "An Else if must stay next to If or Else if.";
    if (stepType === CHAIN_STEP_TYPES.RUN_CHAIN && !firstCallableChain(chains, chain.id)) {
        return chains.length < 2 ? "Create another chain to run from here." : "No other chain can be run from here without a loop.";
    }
    return null;
}

/** A new entry for an action picked from the action picker, with the same defaults as a root action. */
export function newActionEntry(action, { customVariables = [], chains = [] } = {}) {
    return {
        action: action.id,
        selectable: BOT_CODE_SELECTABLES.OPPONENT,
        ...(action.variableAction ? {
            variableId: customVariables[0]?.id ?? "",
            operation: "set",
            ...(customVariables[0]?.valueType === "boolean"
                ? { value: false }
                : { terms: [{ operator: "set", operand: { type: "number", value: 0 } }] }),
        } : {}),
        ...(action.id === BOT_CODE_ACTIONS.RUN_CHAIN ? { chainId: chains[0]?.id ?? "" } : {}),
    };
}

function actionStepFields(action) {
    // An ability step moves straight on to the next step on the next tick; use Wait to hold for something.
    if (action.head === ACTION_HEADS.ABILITY || action.head === ACTION_HEADS.DASH) return { continue: "now" };
    if (action.head === ACTION_HEADS.MOVEMENT || action.head === ACTION_HEADS.ROTATION) return { forMs: DEFAULT_STEP_MS };
    return {};
}

/** An action step: the entry plus the fields only chains use. */
export function newActionStep(action, options) {
    return { type: CHAIN_STEP_TYPES.ACTION, ...newActionEntry(action, options), ...actionStepFields(action) };
}

/** Swaps the action of a step, keeping the target and the timing fields that still apply. */
export function changeStepAction(step, action, options) {
    const next = { ...newActionStep(action, options), selectable: step.selectable ?? BOT_CODE_SELECTABLES.OPPONENT };
    if (next.continue && step.continue) next.continue = step.continue;
    // Only Walk and Rotate are timed; keep how long the old step ran.
    if (next.forMs != null && step.forMs != null) next.forMs = step.forMs;
    return next;
}

export function newFlowStep(type, { defaultCondition = null, chainId = "" } = {}) {
    switch (type) {
        case CHAIN_STEP_TYPES.IF:
        case CHAIN_STEP_TYPES.ELSE_IF: return { type, conditions: defaultCondition ? [defaultCondition] : [], steps: [] };
        case CHAIN_STEP_TYPES.REPEAT: return { type, count: 2, steps: [] };
        case CHAIN_STEP_TYPES.WAIT: return { type, forMs: DEFAULT_STEP_MS };
        case CHAIN_STEP_TYPES.RUN_CHAIN: return { type, chainId };
        default: return { type };
    }
}

// ---- Durations and condition lists ---------------------------------------------------------

export const msToSeconds = (ms) => Number((Number(ms) / 1000).toFixed(1));

/** Seconds typed by the user, snapped to whole 0.1 s ticks inside the chain bounds. */
export function secondsToMs(seconds) {
    const numeric = Number(seconds);
    if (!Number.isFinite(numeric)) return DEFAULT_STEP_MS;
    return Math.max(CHAIN_MS_STEP, Math.min(CHAIN_MS_MAX, Math.round(numeric * 10) * CHAIN_MS_STEP));
}

export const clampRepeatCount = (value) => Math.max(1, Math.min(MAX_REPEAT_COUNT, Math.round(Number(value)) || 1));

/** The step's own condition list field, whichever kind of step it is. */
export function conditionFieldOf(step) {
    if (isConditional(step)) return "conditions";
    if (step?.type === CHAIN_STEP_TYPES.REPEAT) return "whileConditions";
    return "untilConditions";
}

/** Whether the step runs for a fixed time/count, or is governed by conditions. */
export function stepUsesConditions(step) {
    return Array.isArray(step?.[conditionFieldOf(step)]) && !isConditional(step);
}

/** Switches a timed step between "For N s" / "Times N" and "Until / While conditions + max". */
export function setTimedMode(step, useConditions, defaultCondition) {
    const field = conditionFieldOf(step);
    const next = { ...step };
    if (useConditions) {
        delete next.forMs;
        delete next.count;
        next[field] = defaultCondition ? [defaultCondition] : [];
        next.maxMs = step.maxMs ?? DEFAULT_STEP_MS * 2;
    } else {
        delete next[field];
        delete next.maxMs;
        if (step.type === CHAIN_STEP_TYPES.REPEAT) next.count = 2;
        else next.forMs = DEFAULT_STEP_MS;
    }
    return next;
}

/**
 * The condition list after the user picks a variable for one side of a row. Choosing "always"
 * turns the row into an always-true condition; a variable that does not fit leaves it alone.
 */
export function withConditionOperand(conditions, rowIndex, operand, variableId, definition, selectableTypes) {
    if (operand === 1 && variableId === "always") {
        return conditions.map((condition, index) => index === rowIndex ? { type: "always" } : condition);
    }
    if (!definition || (operand === 2 && definition.valueType !== "number")) return conditions;
    return conditions.map((condition, index) => {
        if (index !== rowIndex) return condition;
        if (operand === 2) {
            return {
                ...condition,
                right: { type: "variable", value: definition.id },
                ...(definition.supportsSelectable ? { rightSelectable: defaultSelectableForVariable(definition, selectableTypes) } : {}),
            };
        }
        const replacement = createExpressionCondition(definition, selectableTypes);
        const keepRight = definition.valueType === "number" && ["number", "variable"].includes(condition.right?.type)
            ? condition.right
            : definition.valueType === "boolean" && condition.right?.type === "boolean" ? condition.right : replacement.right;
        return { ...replacement, right: keepRight };
    });
}

// ---- Stacked blocks: loose blocks, block paths and the drop rule ---------------------------------
// Loose blocks are `chain.loose = [{ step, x, y }]`: dragged out of the stack (or freshly added), never run.
// A block path is a step path, or `["loose", i, ...rest]` for a block (or a step inside one) that is loose.

export const LOOSE = "loose";
export const looseOf = (chain) => (Array.isArray(chain?.loose) ? chain.loose : []);
export const isLoosePath = (path) => Array.isArray(path) && path[0] === LOOSE;
/** The `steps` list and path to use with the step helpers for a loose path (the block is a one-step list). */
function looseView(chain, path) {
    const entry = looseOf(chain)[path[1]];
    return entry ? { steps: [entry.step], path: [0, ...path.slice(2)], entry } : null;
}

export function stepAtPath(chain, path) {
    if (!isLoosePath(path)) return stepAt(chain?.steps ?? [], path);
    const view = looseView(chain, path);
    return view ? stepAt(view.steps, view.path) : null;
}

/** The chain with the step at `path` replaced by `updater(step)`. */
export function updateStepPath(chain, path, updater) {
    if (!isLoosePath(path)) return { ...chain, steps: updateStepAt(chain.steps ?? [], path, updater) };
    const view = looseView(chain, path);
    if (!view) return chain;
    const [step] = updateStepAt(view.steps, view.path, updater);
    return { ...chain, loose: looseOf(chain).map((entry, index) => (index === path[1] ? { ...entry, step } : entry)) };
}

function withLoose(chain, loose) {
    const { loose: _previous, ...rest } = chain;
    return loose.length ? { ...rest, loose } : rest;
}

/** The chain without the block at `path` (closing the gap; a following Else if becomes the If). */
export function removeStepPath(chain, path) {
    if (!isLoosePath(path)) return { ...chain, steps: removeStepAt(chain.steps ?? [], path) };
    if (path.length === 2) return withLoose(chain, looseOf(chain).filter((_, index) => index !== path[1]));
    const view = looseView(chain, path);
    if (!view) return chain;
    const [step] = removeStepAt(view.steps, view.path);
    return withLoose(chain, looseOf(chain).map((entry, index) => (index === path[1] ? { ...entry, step } : entry)));
}

export function addLooseBlock(chain, step, x, y) {
    return withLoose(chain, [...looseOf(chain), { step, x: Math.max(0, Math.round(x)), y: Math.max(0, Math.round(y)) }]);
}

/** Puts a block into a list of the stack at `index`; null when the position does not exist. */
export function placeBlockInStack(chain, listPath, index, step) {
    const steps = insertStepAt(chain.steps ?? [], listPath, index, step);
    return steps === chain.steps ? null : { ...chain, steps };
}

/** How deep Repeats nest inside `step` (a Repeat itself counts one). */
export function repeatDepthOf(step) {
    const inner = Math.max(0, ...(step?.steps ?? []).map(repeatDepthOf));
    return step?.type === CHAIN_STEP_TYPES.REPEAT ? 1 + inner : inner;
}

/** Whether `step` holds an Exit loop that is not inside a Repeat of its own (so it needs one around it). */
export function hasUnboundExit(step) {
    if (step?.type === CHAIN_STEP_TYPES.EXIT_LOOP) return true;
    if (step?.type === CHAIN_STEP_TYPES.REPEAT) return false;
    return (step?.steps ?? []).some(hasUnboundExit);
}

function* runTargetsIn(step) {
    if (step?.type === CHAIN_STEP_TYPES.RUN_CHAIN && step.chainId) yield step.chainId;
    for (const child of step?.steps ?? []) yield* runTargetsIn(child);
}

/**
 * Why the block cannot be dropped at `index` of the list at `listPath`, or null. `chain` is the chain as it
 * would be without the block (so a moved block is not counted against itself); `chains` lists every chain.
 */
export function dropBlockReason({ chains, chain, listPath, index, step }) {
    const list = listAt(chain.steps, listPath);
    if (step.type === CHAIN_STEP_TYPES.ELSE_IF && !isConditional(list[index - 1])) return "Else if must directly follow If or Else if.";
    if (list[index]?.type === CHAIN_STEP_TYPES.ELSE_IF && !isConditional(step)) return "An Else if must stay next to If or Else if.";
    if (loopDepthAt(listPath) + repeatDepthOf(step) > MAX_LOOP_NESTING) return `Repeats can nest at most ${MAX_LOOP_NESTING} deep.`;
    if (hasUnboundExit(step) && loopDepthAt(listPath) === 0) return "Exit loop only works inside a Repeat.";
    for (const target of runTargetsIn(step)) {
        const reason = callBlockReason(chains.map((candidate) => (candidate.id === chain.id ? chain : candidate)), chain.id, target);
        if (reason) return reason;
    }
    return null;
}

/** How far (px) a dragged block's top edge may be from a gap for the gap to count. */
export const DROP_TOLERANCE_PX = 28;

/**
 * The gap a dragged block would drop into: the one nearest to its top edge, within the tolerance, whose list
 * column overlaps the block horizontally. On a tie the later gap wins (the block goes under the one above).
 * `gaps` are `{ listPath, index, y, left, right }` in the same coordinate space as `block` (`{ top, left, right }`).
 */
export function chooseDropGap(gaps, block, tolerance = DROP_TOLERANCE_PX) {
    let best = null;
    for (const gap of gaps) {
        if (block.right < gap.left || block.left > gap.right) continue;
        const distance = Math.abs(block.top - gap.y);
        if (distance > tolerance) continue;
        if (!best || distance < best.distance || (distance === best.distance && gap.y > best.gap.y)) best = { gap, distance };
    }
    return best?.gap ?? null;
}

/** Why a freshly added loose block of `stepType` cannot be added (limits only: its place is decided at the drop). */
export function addLooseBlockReason({ chains, chain, stepType, budget }) {
    if (countChainSteps(chain) >= MAX_CHAIN_STEPS) return `This chain is full (${MAX_CHAIN_STEPS} steps).`;
    if (budget && budget.actions <= 0) return "The brain is out of action slots.";
    if ([CHAIN_STEP_TYPES.IF, CHAIN_STEP_TYPES.ELSE_IF].includes(stepType) && budget && budget.conditions <= 0) return "The brain is out of condition slots.";
    if (stepType === CHAIN_STEP_TYPES.RUN_CHAIN && !firstCallableChain(chains, chain.id)) {
        return chains.length < 2 ? "Create another chain to run from here." : "No other chain can be run from here without a loop.";
    }
    return null;
}
