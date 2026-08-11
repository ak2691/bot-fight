import {
    BOT_LOGIC_TREE_VERSION,
    MAX_LOGIC_BLOCKS,
    MAX_ROOT_NODES,
    MAX_TOTAL_CONDITIONS,
} from "./constants.js";

export function normalizeConfiguration(configuration, operations) {
    const customVariables = operations.normalizeCustomVariables(operations.customVariablesWithReferencedActions(configuration));
    const derivedConditionCount = customVariables.reduce((total, variable) => total + (variable.conditions?.length ?? 0), 0);
    const remaining = { actions: MAX_LOGIC_BLOCKS, conditions: Math.max(0, MAX_TOTAL_CONDITIONS - derivedConditionCount) };
    const sourceRoots = Array.isArray(configuration?.roots) ? configuration.roots : operations.defaultConfiguration().roots;
    const roots = sourceRoots.slice(0, MAX_ROOT_NODES)
        .map((root, rootIndex) => operations.normalizeRoot(root, rootIndex, remaining, customVariables));
    return { version: BOT_LOGIC_TREE_VERSION, roots, customVariables };
}
