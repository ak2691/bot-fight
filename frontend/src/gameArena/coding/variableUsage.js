// Where a custom variable is used, and how a type change or delete rewrites those places.
// Walks every part of a configuration that can hold a reference: connected roots (their
// conditionals) and unconnected nodes. Pure and UI-free so the rules can be tested directly.
import { BOT_CODE_ACTIONS, BOT_CODE_SELECTABLES } from "../../../../shared/engine/botlogic/code/contracts/BotLogicContracts.js";
import { editorRootsFor } from "./treeWiring.js";

const operandUses = (operand, variableId) => operand?.type === "variable" && operand.value === variableId;
const conditionUses = (condition, variableId) => condition?.left === variableId || operandUses(condition?.right, variableId);

function actionEntries(branch) {
    if (Array.isArray(branch?.actions)) return branch.actions;
    return branch?.action && branch.action !== "none" ? [branch] : [];
}

function entryOperands(entry) {
    const terms = Array.isArray(entry?.terms) ? entry.terms.map((term) => term?.operand) : [];
    return [entry?.operand, ...terms];
}

/** Whether a Variable action writes the variable or reads it in an operand. */
function entryUses(entry, variableId) {
    if (entry?.action !== BOT_CODE_ACTIONS.VARIABLE) return false;
    return entry.variableId === variableId || entryOperands(entry).some((operand) => operandUses(operand, variableId));
}

// ---- Node ids (kept in step with GraphNodes' conditionGraphNodeId / actionGraphNodeId) -------

const conditionNodeId = (branchId, rootId) => (/^(condition:|node-)/.test(branchId) ? branchId : `condition:${branchId}:root:${rootId}`);
const actionNodeId = (entry, branchId, index, rootId) => entry.id ?? `action:${branchId}:${index}:root:${rootId}`;

/**
 * Every place the variable is used, in reading order. Each use is
 * `{ key, kind, where, text, target }`; `target` is `{ type: "node", nodeId }` for the board. `describe` supplies the wording:
 * `condition(condition)` and `action(entry)` return the use's summary text.
 */
export function collectVariableUses(configuration, variableId, describe = {}) {
    const describeCondition = describe.condition ?? ((condition) => String(condition?.left ?? ""));
    const describeAction = describe.action ?? ((entry) => String(entry?.variableId ?? ""));
    const uses = [];
    const push = (use) => uses.push({ ...use, key: `${use.target.type}:${use.target.nodeId}:${uses.length}` });

    const visitBranch = (branch, rootId, where) => {
        (branch?.conditions ?? []).forEach((condition) => {
            if (conditionUses(condition, variableId)) push({ kind: "IF", where, text: describeCondition(condition), target: { type: "node", nodeId: conditionNodeId(branch.id, rootId) } });
        });
        actionEntries(branch).forEach((entry, index) => {
            if (entryUses(entry, variableId)) push({ kind: "SET", where, text: describeAction(entry), target: { type: "node", nodeId: actionNodeId(entry, branch.id, index, rootId) } });
        });
        (branch?.children ?? []).forEach((child) => visitBranch(child, rootId, where));
    };

    editorRootsFor(configuration ?? {}).forEach((root, rootIndex) => {
        const where = root._orphan ? "Unconnected" : `Root "${String(root.name ?? "").trim() || `Root ${rootIndex + 1}`}"`;
        (root.branches ?? []).forEach((branch) => visitBranch(branch, root.id, where));
    });

    return uses;
}

// ---- Rewrites ---------------------------------------------------------------------------------

const zeroOperand = () => ({ type: "number", value: 0 });

/** The entry with every operand that reads the variable replaced by 0, so nothing dangles. */
function withoutOperandReads(entry, variableId) {
    if (!entryOperands(entry).some((operand) => operandUses(operand, variableId))) return entry;
    const next = { ...entry };
    if (operandUses(entry.operand, variableId)) next.operand = entry.operand.type === "boolean" ? { type: "boolean", value: false } : zeroOperand();
    if (Array.isArray(entry.terms)) next.terms = entry.terms.map((term) => (operandUses(term?.operand, variableId) ? { ...term, operand: zeroOperand() } : term));
    return next;
}

/**
 * Applies `rewrite(entry)` to each Variable action that writes `variableId`, across roots and unconnected
 * nodes. Returning null removes the action. When `readsToo` is set, operands that read the
 * variable are reset to 0 on the actions that remain.
 */
export function rewriteVariableActions(configuration, variableId, rewrite, { readsToo = false } = {}) {
    const mapEntry = (entry) => {
        if (entry?.action !== BOT_CODE_ACTIONS.VARIABLE) return entry;
        if (entry.variableId === variableId) return rewrite(entry);
        return readsToo ? withoutOperandReads(entry, variableId) : entry;
    };
    const mapBranch = (branch) => {
        const mapped = actionEntries(branch).map(mapEntry).filter(Boolean);
        const legacyRemoved = !Array.isArray(branch.actions) && branch.action === BOT_CODE_ACTIONS.VARIABLE && mapped.length === 0;
        const first = mapped[0] ?? (legacyRemoved ? { action: "none", selectable: BOT_CODE_SELECTABLES.OPPONENT } : null);
        return { ...branch, ...(first ? { ...first, actions: mapped } : { actions: mapped }), children: (branch.children ?? []).map(mapBranch) };
    };
    const orphanEntry = (orphan) => {
        if (orphan.kind === "action") {
            const mapped = mapEntry(orphan);
            return mapped ? [{ ...mapped, kind: "action" }] : [];
        }
        return [mapBranch(orphan)];
    };
    return {
        ...configuration,
        roots: (configuration.roots ?? []).map((root) => ({
            ...root,
            branches: (root.branches ?? []).map(mapBranch),
        })),
        ...(Array.isArray(configuration.orphans) ? { orphans: configuration.orphans.flatMap(orphanEntry) } : {}),
    };
}

function rewriteConditions(configuration, rewrite) {
    const mapBranch = (branch) => ({ ...branch, conditions: rewrite(branch.conditions), children: (branch.children ?? []).map(mapBranch) });
    return {
        ...configuration,
        roots: (configuration.roots ?? []).map((root) => ({ ...root, branches: (root.branches ?? []).map(mapBranch) })),
        ...(Array.isArray(configuration.orphans) ? { orphans: configuration.orphans.map((orphan) => (orphan.kind === "action" ? orphan : mapBranch(orphan))) } : {}),
    };
}

function pruneModifyBranches(branches) {
    return (branches ?? []).map((branch) => ({
        ...branch,
        children: pruneModifyBranches(branch?.children),
    })).filter((branch) => actionEntries(branch).some((entry) => entry?.action && entry.action !== "none") || branch.children.length > 0);
}

function pruneEmptyModifyRoots(configuration) {
    const roots = (configuration?.roots ?? []).flatMap((root) => {
        if (root?.kind !== "modify") return [root];
        const branches = pruneModifyBranches(root.branches);
        return branches.length ? [{ ...root, branches }] : [];
    });
    return { ...configuration, roots };
}

/** The configuration without the variable: its actions and conditions are removed everywhere. */
export function removeVariableFromConfiguration(configuration, variableId) {
    const customVariables = (configuration?.customVariables ?? []).filter((variable) => variable.id !== variableId).map((variable) => {
        const next = { ...variable };
        delete next.conditions;
        return next;
    });
    const cleaned = pruneEmptyModifyRoots(rewriteVariableActions({ ...configuration, customVariables }, variableId, () => null, { readsToo: true }));
    return rewriteConditions(cleaned, (conditions) => (conditions ?? []).filter((condition) => !conditionUses(condition, variableId)));
}
