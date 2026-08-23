import {
    BOT_LOGIC_TREE_VERSION,
    MAX_LOGIC_BLOCKS,
    MAX_ROOT_NODES,
    MAX_TOTAL_CONDITIONS,
} from "./constants.js";
import { NODE_POSITIONS_FIELD, normalizeNodePositions } from "./nodePositions.js";

export function normalizeConfiguration(configuration, operations) {
    const customVariables = operations.normalizeCustomVariables(operations.customVariablesWithReferencedActions(configuration));
    const remaining = { actions: MAX_LOGIC_BLOCKS, conditions: MAX_TOTAL_CONDITIONS };
    const sourceRoots = Array.isArray(configuration?.roots) ? configuration.roots : operations.defaultConfiguration().roots;
    const roots = sourceRoots.slice(0, MAX_ROOT_NODES)
        .map((root, rootIndex) => operations.normalizeRoot(root, rootIndex, remaining, customVariables));
    return {
        version: BOT_LOGIC_TREE_VERSION,
        roots,
        customVariables,
        ...(Object.prototype.hasOwnProperty.call(configuration ?? {}, NODE_POSITIONS_FIELD)
            ? { [NODE_POSITIONS_FIELD]: normalizeNodePositions(configuration?.[NODE_POSITIONS_FIELD]) }
            : {}),
    };
}
