import {
    CHAIN_ID_PATTERN,
    CHAIN_MS_MAX,
    CHAIN_MS_STEP,
    CHAIN_STEP_TYPES,
    MAX_CALL_DEPTH,
    MAX_CHAINS,
    MAX_CHAIN_STEPS,
    MAX_LOOP_NESTING,
    MAX_REPEAT_COUNT,
} from "./constants.js";
import { ACTION_HEADS, BOT_CODE_ACTIONS } from "../contracts/BotLogicContracts.js";

const STEP_TYPES = new Set(Object.values(CHAIN_STEP_TYPES));
const isMs = (value) => Number.isInteger(value) && value >= CHAIN_MS_STEP && value <= CHAIN_MS_MAX && value % CHAIN_MS_STEP === 0;
const present = (value) => value != null;

/**
 * Structural validation of a raw brain's chains and of the root actions that call them.
 * `actionHead(action)` returns the head of an action ID or name, or null when unknown.
 * Returns human-readable errors; an empty list means the chains are valid.
 */
export function validateChains(configuration, { actionHead }) {
    const errors = [];
    const chains = configuration?.chains;
    if (present(chains) && !Array.isArray(chains)) return ["Chains must be a list."];
    const list = chains ?? [];
    if (list.length > MAX_CHAINS) errors.push(`A brain can have at most ${MAX_CHAINS} chains.`);
    const ids = new Set();
    list.forEach((chain, index) => {
        const label = `Chain ${index + 1}`;
        if (!chain || typeof chain !== "object") {
            errors.push(`${label} must be an object.`);
            return;
        }
        if (!CHAIN_ID_PATTERN.test(String(chain.id ?? ""))) errors.push(`${label} has an invalid ID.`);
        else if (ids.has(chain.id)) errors.push(`${label} repeats the ID ${chain.id}.`);
        else ids.add(chain.id);
    });
    list.forEach((chain, index) => {
        if (!chain || typeof chain !== "object") return;
        const context = { errors, ids, label: `Chain ${index + 1}`, actionHead, steps: 0 };
        if (!Array.isArray(chain.steps)) errors.push(`${context.label} needs a list of steps.`);
        else validateSteps(chain.steps, context, 0);
        validateLooseBlocks(chain.loose, context);
        if (context.steps > MAX_CHAIN_STEPS) errors.push(`${context.label} has ${context.steps} steps; the limit is ${MAX_CHAIN_STEPS}.`);
    });
    validateCallGraph(list, ids, errors);
    validateRootChainActions(configuration?.roots, ids, errors);
    validateRootChainActions([{ actions: [], branches: (Array.isArray(configuration?.orphans) ? configuration.orphans : []).map((node) => node?.kind === "action" ? { actions: [node] } : node) }], ids, errors);
    return errors;
}

const MAX_LOOSE_COORDINATE = 1_000_000;

/** Loose blocks: bounded `{ step, x, y }` entries, validated like steps, counted with the chain's steps. */
function validateLooseBlocks(loose, context) {
    if (!present(loose)) return;
    const { errors, label } = context;
    if (!Array.isArray(loose)) {
        errors.push(`${label} loose blocks must be a list.`);
        return;
    }
    if (loose.length > MAX_CHAIN_STEPS) {
        errors.push(`${label} has more than ${MAX_CHAIN_STEPS} loose blocks.`);
        return;
    }
    loose.forEach((entry, index) => {
        const entryLabel = `${label} loose block ${index + 1}`;
        if (!entry || typeof entry !== "object") {
            errors.push(`${entryLabel} must be an object.`);
            return;
        }
        for (const axis of ["x", "y"]) {
            if (typeof entry[axis] !== "number" || !Number.isFinite(entry[axis]) || entry[axis] < 0 || entry[axis] > MAX_LOOSE_COORDINATE) {
                errors.push(`${entryLabel} ${axis} must be a number from 0 to ${MAX_LOOSE_COORDINATE}.`);
            }
        }
        validateStep(entry.step, entryLabel, context, 0);
    });
}

function validateSteps(steps, context, loopDepth) {
    steps.forEach((step, index) => {
        if (step?.type === CHAIN_STEP_TYPES.ELSE_IF && ![CHAIN_STEP_TYPES.IF, CHAIN_STEP_TYPES.ELSE_IF].includes(steps[index - 1]?.type)) {
            context.errors.push(`${context.label} step ${index + 1}: Else if must directly follow If or Else if.`);
        }
        validateStep(step, `${context.label} step ${index + 1}`, context, loopDepth);
    });
}

function validateStep(step, label, context, loopDepth) {
    context.steps += 1;
    const { errors } = context;
    if (!step || typeof step !== "object" || !STEP_TYPES.has(step.type)) {
        errors.push(`${label} has an unknown step type.`);
        return;
    }
    if (step.type === CHAIN_STEP_TYPES.ACTION) {
        validateActionStep(step, label, context);
    } else if (step.type === CHAIN_STEP_TYPES.WAIT) {
        validateTimed(step, label, errors, true);
    } else if (step.type === CHAIN_STEP_TYPES.IF || step.type === CHAIN_STEP_TYPES.ELSE_IF) {
        if (!Array.isArray(step.conditions)) errors.push(`${label} needs conditions.`);
        const fields = step.type === CHAIN_STEP_TYPES.IF && !present(step.steps) && (present(step.then) || present(step.else))
            ? ["then", "else"] : ["steps"];
        if (fields.includes("else") && step.else?.length) context.steps += 1;
        for (const branch of fields) {
            if (!present(step[branch]) && branch === "steps") errors.push(`${label} needs a list of steps.`);
            if (present(step[branch]) && !Array.isArray(step[branch])) errors.push(`${label} ${branch} must be a list of steps.`);
            else validateSteps(step[branch] ?? [], context, loopDepth);
        }
    } else if (step.type === CHAIN_STEP_TYPES.REPEAT) {
        validateRepeat(step, label, context, loopDepth);
    } else if (step.type === CHAIN_STEP_TYPES.RUN_CHAIN && !context.ids.has(step.chainId)) {
        errors.push(`${label} runs a chain that does not exist.`);
    }
}

function validateRepeat(step, label, context, loopDepth) {
    const { errors } = context;
    if (loopDepth >= MAX_LOOP_NESTING) errors.push(`${label} nests loops deeper than ${MAX_LOOP_NESTING}.`);
    const hasWhile = present(step.whileConditions);
    if (hasWhile === present(step.count)) {
        errors.push(`${label} needs either a count or while conditions.`);
    } else if (hasWhile) {
        validateTimed({ untilConditions: step.whileConditions, maxMs: step.maxMs }, label, errors, false);
    } else if (!Number.isInteger(step.count) || step.count < 1 || step.count > MAX_REPEAT_COUNT) {
        errors.push(`${label} repeat count must be a whole number from 1 to ${MAX_REPEAT_COUNT}.`);
    }
    if (!Array.isArray(step.steps)) errors.push(`${label} needs a list of steps.`);
    else validateSteps(step.steps, context, loopDepth + 1);
}

function validateActionStep(step, label, context) {
    const { errors } = context;
    const head = context.actionHead(step.action);
    if (!head || head === ACTION_HEADS.NONE || head === ACTION_HEADS.CHAIN) {
        errors.push(`${label} uses an action that chains cannot run.`);
        return;
    }
    if ((head === ACTION_HEADS.ABILITY || head === ACTION_HEADS.DASH) && present(step.continue) && !["end", "now"].includes(step.continue)) {
        errors.push(`${label} continue must be end or now.`);
    }
    if (head === ACTION_HEADS.MOVEMENT || head === ACTION_HEADS.ROTATION) validateTimed(step, label, errors, true);
    else if (present(step.forMs) || present(step.untilConditions) || present(step.maxMs)) {
        errors.push(`${label} cannot have a duration.`);
    }
}

/** A step runs for `forMs`, or until conditions hold (or while they do) with a `maxMs` cap. */
function validateTimed(step, label, errors, allowFixed) {
    if (present(step.untilConditions)) {
        if (!Array.isArray(step.untilConditions)) errors.push(`${label} conditions must be a list.`);
        if (present(step.forMs)) errors.push(`${label} needs either a duration or conditions, not both.`);
        if (!isMs(step.maxMs)) errors.push(`${label} max time must be a multiple of 100 ms from 100 to ${CHAIN_MS_MAX}.`);
    } else if (!allowFixed || !isMs(step.forMs)) {
        errors.push(`${label} duration must be a multiple of 100 ms from 100 to ${CHAIN_MS_MAX}.`);
    }
}

function callTargets(steps, targets = []) {
    for (const step of Array.isArray(steps) ? steps : []) {
        if (step?.type === CHAIN_STEP_TYPES.RUN_CHAIN && typeof step.chainId === "string") targets.push(step.chainId);
        callTargets(step?.then, targets);
        callTargets(step?.else, targets);
        callTargets(step?.steps, targets);
    }
    return targets;
}

/** Rejects call cycles, and calls nested deeper than the 3-frame chain stack. */
function validateCallGraph(chains, ids, errors) {
    const edges = new Map(chains.filter((chain) => ids.has(chain?.id))
        .map((chain) => [chain.id, [...new Set(callTargets(chain.steps).filter((id) => ids.has(id)))]]));
    const state = new Map();
    const depth = new Map();
    let cyclic = false;
    const visit = (id) => {
        if (state.get(id) === "done") return depth.get(id);
        if (state.get(id) === "active") {
            cyclic = true;
            return 0;
        }
        state.set(id, "active");
        const longest = 1 + Math.max(0, ...edges.get(id).map(visit));
        state.set(id, "done");
        depth.set(id, longest);
        return longest;
    };
    for (const id of edges.keys()) visit(id);
    if (cyclic) errors.push("Chains cannot call each other in a cycle.");
    else if (Math.max(0, ...depth.values()) > MAX_CALL_DEPTH) errors.push(`Chains can call other chains at most ${MAX_CALL_DEPTH} levels deep.`);
}

function validateRootChainActions(roots, ids, errors) {
    const visitBranches = (branches, label) => (Array.isArray(branches) ? branches : []).forEach((branch, index) => {
        const here = `${label} block ${index + 1}`;
        const entries = Array.isArray(branch?.actions) && branch.actions.length ? branch.actions : [branch];
        for (const entry of entries) {
            if (entry?.action !== BOT_CODE_ACTIONS.RUN_CHAIN) continue;
            if (!ids.has(entry.chainId)) errors.push(`${here} runs a chain that does not exist.`);
        }
        visitBranches(branch?.children, here);
    });
    (Array.isArray(roots) ? roots : []).forEach((root, index) => {
        visitBranches([{ actions: root?.actions ?? [] }], `Root ${index + 1}`);
        visitBranches(root?.branches, `Root ${index + 1}`);
    });
}
