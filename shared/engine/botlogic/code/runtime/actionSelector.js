import { ACTION_HEADS, BOT_CODE_ACTIONS } from "../contracts/BotLogicContracts.js";

/** The execution category an action competes in. */
function executionHeadFor(action) {
    return action.head === ACTION_HEADS.MOVEMENT ? ACTION_HEADS.MOVEMENT
        : action.head === ACTION_HEADS.ROTATION ? ACTION_HEADS.ROTATION
            : action.head === ACTION_HEADS.CANCEL ? ACTION_HEADS.CANCEL
                : action.head === ACTION_HEADS.DASH ? ACTION_HEADS.DASH : ACTION_HEADS.ABILITY;
}

/** A block can act when it is executable now and its target resolves. Shared by tree roots and lanes cards. */
export function blockCanAct(block, state, runtime) {
    if (!runtime.actionExecutableNow(block, state)) return false;
    const action = runtime.actionById.get(block.action) ?? runtime.actionTypes[0];
    return !(runtime.actionSupportsTarget(action)
        && !(action.coordinateTarget && ["coordinates", "angle"].includes(block.targetMode))
        && !runtime.resolveTarget(state, block.selectable));
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
 * One tick of decisions: roots are checked against start-of-tick state, in priority order. Each
 * executable root takes its category unless a higher-priority root already holds it.
 */
export function selectStrategyActionPlan(normalized, payload, runtime) {
    const state = runtime.stateFromPayload(payload, normalized.version);
    runtime.prepareCustomVariables(state, normalized.customVariables);
    const selected = runtime.selectPriorityCandidates(normalized, state);
    const rootEntries = selected.flatMap(({ block }) => runtime.normalizedBlockActions(block).map((entry) => ({ ...block, ...entry })));
    const primary = rootEntries
        .find((block) => block.action !== BOT_CODE_ACTIONS.VARIABLE
            && runtime.isTrainableBlock(block) && runtime.actionExecutableNow(block, state)) ?? null;
    const plan = { primary };

    for (const block of rootEntries) {
        if (!runtime.actionExecutableNow(block, state)) continue;
        if (block.action === BOT_CODE_ACTIONS.VARIABLE) {
            runtime.applyVariableAction(block, state, normalized.customVariables);
            continue;
        }
        const action = runtime.actionById.get(block.action) ?? runtime.actionTypes[0];
        if (!blockCanAct(block, state, runtime)) continue;
        if (plan[executionHeadFor(action)]) continue;
        placeInPlan(plan, block, action);
    }
    plan.customVariables = { ...state.player.customVariables };
    return plan;
}

export function hasStrategyActions(normalized) {
    return normalized.roots.some((root) => root.branches.length > 0 || root.actions?.length > 0);
}
