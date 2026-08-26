export function selectStrategyBlock(configuration, payload, runtime) {
    const normalized = runtime.normalizeConfiguration(configuration);
    const state = runtime.stateFromPayload(payload);
    return runtime.selectPriorityCandidates(normalized, state).find((entry) => runtime.isTrainableBlock(entry.block))?.block ?? null;
}

export function selectStrategyActionPlan(configuration, payload, runtime) {
    const normalized = runtime.normalizeConfiguration(configuration);
    const state = runtime.stateFromPayload(payload);
    runtime.prepareCustomVariables(state, normalized.customVariables);
    const selected = runtime.selectPriorityCandidates(normalized, state);
    const primary = selected
        .flatMap(({ block }) => runtime.normalizedBlockActions(block).map((entry) => ({ ...block, ...entry })))
        .find((block) => block.action !== BOT_CODE_ACTIONS.VARIABLE && runtime.isTrainableBlock(block) && runtime.actionExecutableNow(block, state)) ?? null;
    const plan = { primary };
    for (const { block: selectedBlock } of selected) {
        for (const block of runtime.normalizedBlockActions(selectedBlock).map((entry) => ({ ...selectedBlock, ...entry }))) {
            if (!runtime.actionExecutableNow(block, state)) continue;
            if (block.action === BOT_CODE_ACTIONS.VARIABLE) {
                runtime.applyVariableAction(block, state, normalized.customVariables);
                continue;
            }
            const action = runtime.actionById.get(block.action) ?? runtime.actionTypes[0];
            if (runtime.actionSupportsTarget(action)
                && !(action.coordinateTarget && ["coordinates", "angle"].includes(block.targetMode))
                && !runtime.resolveTarget(state, block.selectable)) continue;
            const executionHead = action.head === ACTION_HEADS.MOVEMENT ? ACTION_HEADS.MOVEMENT
                : action.head === ACTION_HEADS.ROTATION ? ACTION_HEADS.ROTATION : ACTION_HEADS.ABILITY;
            if (plan[executionHead]) continue;
            plan[executionHead] = block;
            if (executionHead === "ability") {
                plan.ability = block;
                plan[action.head] = block;
            }
        }
    }
    plan.customVariables = { ...state.player.customVariables };
    return plan;
}

export function hasStrategyActions(configuration, normalizeConfiguration) {
    const normalized = normalizeConfiguration(configuration);
    return normalized.roots.some((root) => root.branches.length > 0);
}
import { ACTION_HEADS, BOT_CODE_ACTIONS } from "../contracts/BotLogicContracts.js";
