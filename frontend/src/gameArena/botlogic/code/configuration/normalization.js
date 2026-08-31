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
            ? { [NODE_POSITIONS_FIELD]: remapNodePositions(configuration?.[NODE_POSITIONS_FIELD], sourceRoots, roots) }
            : {}),
    };
}

function remapNodePositions(source, sourceRoots, normalizedRoots) {
    // Editor positions stay attached to their source root/branch while
    // priorities change execution order. Translate metadata keys for legacy
    // or normalized IDs so positions remain associated with the same node.
    const sourcePositions = normalizeNodePositions(source);
    const remapped = { ...sourcePositions };
    const movedSourceIds = new Set();
    const targetIds = new Set();
    (sourceRoots ?? []).slice(0, normalizedRoots.length).forEach((sourceRoot, rootIndex) => {
        const normalizedRoot = normalizedRoots[rootIndex];
        if (!normalizedRoot) return;
        const sourceRootId = stableNodeId(sourceRoot?.id, `root-${rootIndex + 1}`);
        movePosition(remapped, `rootNode:${sourceRootId}`, `rootNode:${normalizedRoot.id}`, sourcePositions, movedSourceIds, targetIds);
        remapBranchPositions(sourceRoot?.branches, normalizedRoot.branches, sourceRootId, normalizedRoot.id, 1, remapped, sourcePositions, movedSourceIds, targetIds);
    });
    movedSourceIds.forEach((sourceId) => {
        if (!targetIds.has(sourceId)) delete remapped[sourceId];
    });
    return remapped;
}

function remapBranchPositions(sourceBranches, normalizedBranches, sourceRootId, normalizedRootId, depth, positions, sourcePositions, movedSourceIds, targetIds) {
    if (!Array.isArray(sourceBranches) || !Array.isArray(normalizedBranches)) return;
    normalizedBranches.forEach((normalizedBranch, branchIndex) => {
        const sourceBranch = sourceBranches[branchIndex];
        if (!sourceBranch) return;
        const sourceBranchId = stableNodeId(sourceBranch.id, `${sourceRootId}-${depth}-${branchIndex + 1}`);
        movePosition(
            positions,
            `condition:${sourceBranchId}:root:${sourceRootId}`,
            `condition:${normalizedBranch.id}:root:${normalizedRootId}`,
            sourcePositions,
            movedSourceIds,
            targetIds,
        );
        const sourceActions = graphActions(sourceBranch);
        const normalizedActions = graphActions(normalizedBranch);
        normalizedActions.forEach((_, actionIndex) => {
            if (!sourceActions[actionIndex]) return;
            movePosition(
                positions,
                `action:${sourceBranchId}:${actionIndex}:root:${sourceRootId}`,
                `action:${normalizedBranch.id}:${actionIndex}:root:${normalizedRootId}`,
                sourcePositions,
                movedSourceIds,
                targetIds,
            );
        });
        remapBranchPositions(sourceBranch.children, normalizedBranch.children, sourceRootId, normalizedRootId, depth + 1, positions, sourcePositions, movedSourceIds, targetIds);
    });
}

function graphActions(branch) {
    if (Array.isArray(branch?.actions)) return branch.actions.filter((entry) => entry?.action && entry.action !== "none");
    return branch?.action && branch.action !== "none" ? [branch] : [];
}

function movePosition(positions, sourceId, targetId, sourcePositions, movedSourceIds, targetIds) {
    if (sourceId === targetId || !Object.prototype.hasOwnProperty.call(sourcePositions, sourceId)) return;
    positions[targetId] = sourcePositions[sourceId];
    movedSourceIds.add(sourceId);
    targetIds.add(targetId);
}

function stableNodeId(value, fallback) {
    const id = String(value ?? "").trim();
    return id || fallback;
}
