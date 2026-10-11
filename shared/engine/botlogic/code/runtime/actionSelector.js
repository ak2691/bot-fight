import { runningChainSnapshot } from "./chainPresentation.js";
import { ACTION_HEADS, BOT_CODE_ACTIONS } from "../contracts/BotLogicContracts.js";
import { applyChainControl, cloneChainStack, resumeChain } from "./chainRuntime.js";

/** The execution category an action competes in. */
function executionHeadFor(action) {
    return action.head === ACTION_HEADS.MOVEMENT ? ACTION_HEADS.MOVEMENT
        : action.head === ACTION_HEADS.ROTATION ? ACTION_HEADS.ROTATION
            : action.head === ACTION_HEADS.CANCEL ? ACTION_HEADS.CANCEL
                : action.head === ACTION_HEADS.DASH ? ACTION_HEADS.DASH : ACTION_HEADS.ABILITY;
}

function placeInPlan(plan, block, action) {
    const executionHead = executionHeadFor(action);
    plan[executionHead] = block;
    if (executionHead === "ability") {
        plan.ability = block;
        plan[action.head] = block;
    }
}

/**
 * One tick of decisions: roots are checked against start-of-tick state, then chain control from
 * the roots, then the running chain, then roots fill the categories the chain did not use.
 */
export function selectStrategyActionPlan(normalized, payload, runtime) {
    const state = runtime.stateFromPayload(payload, normalized.version);
    runtime.prepareCustomVariables(state, normalized.customVariables);
    const selected = runtime.selectPriorityCandidates(normalized, state);
    const rootEntries = selected.flatMap(({ block }) => runtime.normalizedBlockActions(block).map((entry) => ({ ...block, ...entry })));
    const isChainControl = (block) => runtime.actionById.get(block.action)?.head === ACTION_HEADS.CHAIN;
    const primary = rootEntries
        .find((block) => block.action !== BOT_CODE_ACTIONS.VARIABLE && !isChainControl(block)
            && runtime.isTrainableBlock(block) && runtime.actionExecutableNow(block, state)) ?? null;
    const plan = { primary };

    const chains = new Map((normalized.chains ?? []).map((chain) => [chain.id, chain]));
    const chainStack = cloneChainStack(state.player.chainStack);
    // A root can act when it is executable now and its target resolves.
    const rootCanAct = (block) => {
        if (!runtime.actionExecutableNow(block, state)) return false;
        const action = runtime.actionById.get(block.action) ?? runtime.actionTypes[0];
        return !(runtime.actionSupportsTarget(action)
            && !(action.coordinateTarget && ["coordinates", "angle"].includes(block.targetMode))
            && !runtime.resolveTarget(state, block.selectable));
    };
    const started = applyChainControl(chainStack, rootEntries.filter(isChainControl), chains);
    let start = null;
    if (started) {
        // Roots left of the Run chain take their categories before the chain's first action.
        const claimed = new Set();
        for (const block of rootEntries.slice(0, rootEntries.findIndex((entry) => entry.action === BOT_CODE_ACTIONS.RUN_CHAIN))) {
            if (block.action === BOT_CODE_ACTIONS.VARIABLE || isChainControl(block) || !rootCanAct(block)) continue;
            claimed.add(executionHeadFor(runtime.actionById.get(block.action) ?? runtime.actionTypes[0]));
        }
        start = { claimed, canAct: rootCanAct };
    }
    const claims = resumeChain(chainStack, { state, chains, definitions: normalized.customVariables, runtime, start });
    for (const { block } of claims) placeInPlan(plan, block, runtime.actionById.get(block.action));

    for (const block of rootEntries) {
        if (!runtime.actionExecutableNow(block, state)) continue;
        if (block.action === BOT_CODE_ACTIONS.VARIABLE) {
            runtime.applyVariableAction(block, state, normalized.customVariables);
            continue;
        }
        if (isChainControl(block)) continue;
        const action = runtime.actionById.get(block.action) ?? runtime.actionTypes[0];
        if (!rootCanAct(block)) continue;
        if (plan[executionHeadFor(action)]) continue;
        placeInPlan(plan, block, action);
    }
    plan.customVariables = { ...state.player.customVariables };
    plan.chainStack = chainStack;
    plan.runningChain = runningChainSnapshot(chainStack, chains);
    return plan;
}

export function hasStrategyActions(normalized) {
    return normalized.roots.some((root) => root.branches.length > 0 || root.actions?.length > 0);
}
