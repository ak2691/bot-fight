import { ACTION_TYPES, BOT_CODE_SELECTABLES, STATE_VARIABLES, VARIABLE_SELECTABLE_TYPES, actionSupportsTarget, canonicalBotSelectableId } from "../code/BotCode.js";

export const CODE_EDITOR_GRAPH_VERSION = "bot-editor-graph-v2";

const CONDITION_OPERAND_PATTERN = /^condition:(.+):row:(\d+):operand-(1|2)$/;
const ACTION_TARGET_PATTERN = /^action:(.+):(\d+):target$/;
const VARIABLE_TARGET_SUFFIX = ":target";

function clone(value) {
    if (value == null || typeof value !== "object") return value;
    if (Array.isArray(value)) return value.map(clone);
    return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, clone(entry)]));
}

function actionDefinition(actionId) {
    return ACTION_TYPES.find((action) => action.id === actionId) ?? null;
}

function walkBranches(branches, visitor) {
    (branches ?? []).forEach((branch) => {
        visitor(branch);
        walkBranches(branch.children, visitor);
    });
}

export function createCodeEditorGraph() {
    return {
        version: CODE_EDITOR_GRAPH_VERSION,
        variables: [],
        targets: [],
        connections: [],
    };
}

export function graphFromCodeConfiguration() {
    // Editor nodes are deliberately user-owned. The normalized configuration
    // remains the source of truth for payloads when no editor graph is present.
    return createCodeEditorGraph();
}

function editorEndpointIds(configuration) {
    const conditionTargets = new Set();
    const actionTargets = new Set();
    walkBranches(configuration?.roots?.flatMap((root) => root?.branches ?? []), (branch) => {
        const conditions = Array.isArray(branch.conditions) ? branch.conditions : [];
        conditions.forEach((condition, rowIndex) => {
            if (condition?.type !== "expression") return;
            conditionTargets.add(conditionOperandPortId(branch.id, rowIndex, 1));
            if (condition.right?.type === "variable") conditionTargets.add(conditionOperandPortId(branch.id, rowIndex, 2));
        });

        const actions = Array.isArray(branch.actions)
            ? branch.actions
            : branch.action && branch.action !== "none" ? [branch] : [];
        actions.forEach((entry, actionIndex) => {
            const action = actionDefinition(entry.action);
            const needsTarget = action && (action.movementConfig ? entry.movementMode !== "absolute" : actionSupportsTarget(action));
            if (needsTarget) actionTargets.add(actionTargetPortId(branch.id, actionIndex));
        });
    });
    return { conditionTargets, actionTargets };
}

function validNode(node, kind) {
    return node && typeof node === "object" && String(node.id ?? "") && node.kind === kind;
}

export function sanitizeCodeEditorGraph(graph) {
    const source = graph && typeof graph === "object" ? graph : createCodeEditorGraph();
    const variables = Array.isArray(source.variables)
        ? source.variables.filter((node) => validNode(node, "variable")).map((node) => ({
            id: String(node.id),
            kind: "variable",
            ...(String(node.name ?? "").trim() ? { name: String(node.name).slice(0, 40) } : {}),
            variableId: String(node.variableId ?? ""),
            ...(node.ability ? { ability: String(node.ability) } : {}),
            ...(node.statusEffect ? { statusEffect: String(node.statusEffect) } : {}),
        }))
        : [];
    const targets = Array.isArray(source.targets)
        ? source.targets.filter((node) => validNode(node, "target")).map((node) => ({
            id: String(node.id),
            kind: "target",
            ...(String(node.name ?? "").trim() ? { name: String(node.name).slice(0, 40) } : {}),
            targetKind: node.targetKind === "coordinates" ? "coordinates" : "entity",
            target: canonicalBotSelectableId(node.target ?? BOT_CODE_SELECTABLES.OPPONENT),
            targetOffsetX: Number(node.targetOffsetX ?? 0),
            targetOffsetY: Number(node.targetOffsetY ?? 0),
            targetX: Number(node.targetX ?? 500),
            targetY: Number(node.targetY ?? 400),
        }))
        : [];
    const nodeIds = new Set([...variables, ...targets].map((node) => node.id));
    const connectionTargets = new Set();
    const connections = Array.isArray(source.connections)
        ? source.connections.filter((connection) => {
            if (!connection || !nodeIds.has(String(connection.sourceId)) || !String(connection.targetId) || !String(connection.port)) return false;
            const key = `${connection.targetId}|${connection.port}`;
            if (connectionTargets.has(key)) return false;
            connectionTargets.add(key);
            return true;
        }).map((connection) => ({
            id: String(connection.id ?? `${connection.sourceId}->${connection.targetId}`),
            sourceId: String(connection.sourceId),
            targetId: String(connection.targetId),
            port: String(connection.port),
        }))
        : [];
    return { version: CODE_EDITOR_GRAPH_VERSION, variables, targets, connections };
}

function connectionForTarget(graph, targetId, port) {
    return graph.connections.find((connection) => connection.targetId === targetId && connection.port === port) ?? null;
}

export function editorGraphForConfiguration(configuration) {
    if (configuration?.editorGraph?.version === CODE_EDITOR_GRAPH_VERSION) {
        return sanitizeCodeEditorGraph(configuration.editorGraph);
    }
    return graphFromCodeConfiguration(configuration);
}

export function reconcileCodeEditorGraph(configuration, graph) {
    const current = sanitizeCodeEditorGraph(graph);
    const variables = [...current.variables];
    const targets = [...current.targets];
    const connections = [...current.connections];
    const knownVariables = new Set(variables.map((node) => node.id));
    const { conditionTargets, actionTargets } = editorEndpointIds(configuration);
    const validConnections = connections.filter((connection) => {
        const source = nodeById({ variables, targets }, connection.sourceId);
        if (!source) return false;
        if (connection.targetId.startsWith("condition:")) return conditionTargets.has(connection.targetId) && source.kind === "variable" && /^operand-[12]$/.test(connection.port);
        if (connection.targetId.startsWith("action:")) return actionTargets.has(connection.targetId) && source.kind === "target" && connection.port === "target";
        const variableId = variableNodeIdFromTargetPort(connection.targetId);
        if (variableId) return source.kind === "target" && knownVariables.has(variableId) && connection.port === "target";
        return false;
    });
    return { version: CODE_EDITOR_GRAPH_VERSION, variables, targets, connections: validConnections };
}

function nodeById(graph, nodeId) {
    return [...graph.variables, ...graph.targets].find((node) => node.id === nodeId) ?? null;
}

function variableNodeIdFromTargetPort(targetId) {
    if (!String(targetId).endsWith(VARIABLE_TARGET_SUFFIX)) return null;
    return String(targetId).slice(0, -VARIABLE_TARGET_SUFFIX.length);
}

function isVariableOperandTarget(targetId) {
    return CONDITION_OPERAND_PATTERN.test(targetId);
}

function isNumericVariable(node, stateVariables = STATE_VARIABLES) {
    const definition = stateVariables.find((candidate) => candidate.id === node.variableId);
    return definition?.valueType === "number" || String(node.variableId).startsWith("custom.");
}

export function canConnectCodeEditorPorts(graph, sourceId, targetId, port, stateVariables = STATE_VARIABLES) {
    const sanitized = sanitizeCodeEditorGraph(graph);
    const source = nodeById(sanitized, sourceId);
    if (!source) return false;
    if (source.kind === "variable" && isVariableOperandTarget(targetId)) {
        if (port === "operand-2" && !isNumericVariable(source, stateVariables)) return false;
        return true;
    }
    if (source.kind !== "target") return false;
    if (ACTION_TARGET_PATTERN.test(targetId)) return port === "target";
    const variableId = variableNodeIdFromTargetPort(targetId);
    const variable = variableId ? nodeById(sanitized, variableId) : null;
    if (variable?.kind === "variable") {
        const definition = stateVariables.find((candidate) => candidate.id === variable.variableId);
        return port === "target" && Boolean(definition?.supportsSelectable);
    }
    return false;
}

export function connectCodeEditorPorts(graph, sourceId, targetId, port, stateVariables = STATE_VARIABLES) {
    const sanitized = sanitizeCodeEditorGraph(graph);
    if (!canConnectCodeEditorPorts(sanitized, sourceId, targetId, port, stateVariables)) return null;
    const source = nodeById(sanitized, sourceId);
    const sameSource = sanitized.connections.find((connection) => connection.sourceId === sourceId && connection.targetId === targetId && connection.port === port);
    if (sameSource) return sanitized;
    const connections = sanitized.connections.filter((connection) => !(connection.targetId === targetId && connection.port === port));
    connections.push({ id: `${source.id}->${targetId}:${port}`, sourceId, targetId, port });
    return { ...sanitized, connections };
}

export function disconnectCodeEditorNode(graph, nodeId) {
    const sanitized = sanitizeCodeEditorGraph(graph);
    return {
        ...sanitized,
        variables: sanitized.variables.filter((node) => node.id !== nodeId),
        targets: sanitized.targets.filter((node) => node.id !== nodeId),
        connections: sanitized.connections.filter((connection) => connection.sourceId !== nodeId && connection.targetId !== nodeId),
    };
}

function updateBranches(roots, callback) {
    const nextRoots = clone(roots ?? []);
    nextRoots.forEach((root, rootIndex) => {
        const visit = (branches, path) => (branches ?? []).forEach((branch, branchIndex) => {
            const nextPath = [...path, branchIndex];
            callback(branch, rootIndex, nextPath);
            visit(branch.children, nextPath);
        });
        visit(root.branches, []);
    });
    return nextRoots;
}

function applyConditionOperand(condition, operand, variableNode) {
    const next = { ...condition, left: variableNode.variableId };
    if (variableNode.ability) next.ability = variableNode.ability;
    else delete next.ability;
    if (variableNode.statusEffect) next.statusEffect = variableNode.statusEffect;
    else delete next.statusEffect;
    if (operand === 2) {
        return { ...condition, right: { type: "variable", value: variableNode.variableId } };
    }
    return next;
}

export function compileCodeEditorGraph(configuration, graph) {
    const editorGraph = sanitizeCodeEditorGraph(graph);
    const roots = updateBranches(configuration?.roots, (branch) => {
        const conditions = Array.isArray(branch.conditions) ? branch.conditions : [];
        editorGraph.connections.forEach((connection) => {
            const operandMatch = CONDITION_OPERAND_PATTERN.exec(connection.targetId);
            if (!operandMatch || String(branch.id) !== operandMatch[1]) return;
            const rowIndex = Number(operandMatch[2]);
            const operand = Number(operandMatch[3]);
            if (!conditions[rowIndex]) return;
            const source = nodeById(editorGraph, connection.sourceId);
            if (!source || source.kind !== "variable") return;
            const nextCondition = applyConditionOperand(conditions[rowIndex], operand, source);
            if (operand === 2) {
                conditions[rowIndex] = { ...nextCondition, left: conditions[rowIndex].left };
            } else {
                conditions[rowIndex] = nextCondition;
            }
        });
        editorGraph.connections.forEach((connection) => {
            if (connection.port !== "target") return;
            const variableId = variableNodeIdFromTargetPort(connection.targetId);
            const variable = variableId ? nodeById(editorGraph, variableId) : null;
            const source = nodeById(editorGraph, connection.sourceId);
            if (!variable || variable.kind !== "variable" || !source || source.kind !== "target") return;
            editorGraph.connections.forEach((operandConnection) => {
                if (operandConnection.sourceId !== variable.id) return;
                const operandMatch = CONDITION_OPERAND_PATTERN.exec(operandConnection.targetId);
                if (!operandMatch || String(branch.id) !== operandMatch[1]) return;
                const rowIndex = Number(operandMatch[2]);
                const operand = Number(operandMatch[3]);
                if (!conditions[rowIndex]) return;
                const variableDefinition = STATE_VARIABLES.find((candidate) => candidate.id === variable.variableId);
                const field = variableDefinition?.selectableType === VARIABLE_SELECTABLE_TYPES.PAIR
                    ? operand === 1 ? "selectable1" : "selectable2"
                    : operand === 1 ? "leftSelectable" : "rightSelectable";
                conditions[rowIndex] = { ...conditions[rowIndex], [field]: source.target };
            });
        });
        branch.conditions = conditions;
        const actions = Array.isArray(branch.actions) ? branch.actions : branch.action && branch.action !== "none" ? [branch] : [];
        actions.forEach((entry, actionIndex) => {
            const actionConnection = editorGraph.connections.find((connection) => connection.targetId === actionTargetPortId(branch.id, actionIndex) && connection.port === "target");
            if (!actionConnection) return;
            const source = nodeById(editorGraph, actionConnection.sourceId);
            if (!source || source.kind !== "target") return;
            const nextEntry = { ...entry };
            if (source.targetKind === "coordinates") {
                if (actionDefinition(nextEntry.action)?.movementConfig) nextEntry.movementMode = "coordinates";
                else nextEntry.targetMode = "coordinates";
                nextEntry.targetX = source.targetX;
                nextEntry.targetY = source.targetY;
            } else {
                if (actionDefinition(nextEntry.action)?.movementConfig) nextEntry.movementMode = "target";
                else nextEntry.targetMode = "target";
                nextEntry.selectable = source.target;
                if (!actionDefinition(nextEntry.action)?.movementConfig) {
                    nextEntry.targetOffsetX = source.targetOffsetX;
                    nextEntry.targetOffsetY = source.targetOffsetY;
                }
            }
            actions[actionIndex] = nextEntry;
        });
        if (Array.isArray(branch.actions)) {
            branch.actions = actions;
            Object.assign(branch, actions[0] ?? { action: "none", selectable: BOT_CODE_SELECTABLES.OPPONENT });
        }
    });
    return { ...configuration, roots, editorGraph };
}

export function editorPortConnection(graph, targetId, port) {
    return connectionForTarget(sanitizeCodeEditorGraph(graph), targetId, port);
}

export function removeEditorGraphConnection(graph, targetId, port) {
    const sanitized = sanitizeCodeEditorGraph(graph);
    return {
        ...sanitized,
        connections: sanitized.connections.filter((connection) => !(connection.targetId === targetId && connection.port === port)),
    };
}

export function editorGraphNodeLabel(node, stateVariables = STATE_VARIABLES) {
    if (String(node?.name ?? "").trim()) return String(node.name).trim();
    if (node?.kind === "variable") return stateVariables.find((variable) => variable.id === node.variableId)?.label ?? node.variableId ?? "Unconfigured variable";
    if (node?.kind === "target") return node.targetKind === "coordinates" ? "Exact coordinates" : node.target ?? "Unconfigured target";
    return "";
}

export function conditionOperandPortId(branchId, rowIndex, operand) {
    return `condition:${branchId}:row:${rowIndex}:operand-${operand}`;
}

export function variableTargetPortId(variableNodeId) {
    return `${variableNodeId}${VARIABLE_TARGET_SUFFIX}`;
}

export function actionTargetPortId(branchId, actionIndex) {
    return `action:${branchId}:${actionIndex}:target`;
}
