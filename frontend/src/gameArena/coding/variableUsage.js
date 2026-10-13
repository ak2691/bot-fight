// Where a custom variable is used, and how a type change or delete rewrites those places.
// Walks every part of a configuration that can hold a reference: the roots, their conditionals and
// the actions inside them. Pure and UI-free so the rules can be tested directly.
import { BOT_CODE_ACTIONS, BOT_CODE_SELECTABLES } from "../botlogic/code/contracts/BotLogicContracts.js";

const CONDITION_FIELDS = Object.freeze(["conditions"]);

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

const conditionNodeId = (branchId, rootId) => `condition:${branchId}:root:${rootId}`;
const actionNodeId = (branchId, index, rootId) => `action:${branchId}:${index}:root:${rootId}`;

/**
 * Every place the variable is used, in reading order. Each use is
 * `{ key, kind, where, text, target }`; `target` is `{ type: "node", nodeId }` for the canvas.
 * `describe` supplies the wording: `condition(condition)` and `action(entry)` return the summary text.
 */
export function collectVariableUses(configuration, variableId, describe = {}) {
    const describeCondition = describe.condition ?? ((condition) => String(condition?.left ?? ""));
    const describeAction = describe.action ?? ((entry) => String(entry?.variableId ?? ""));
    const uses = [];
    const push = (use) => uses.push({ ...use, key: `${use.target.nodeId}:${uses.length}` });

    const visitBranch = (branch, rootId, where) => {
        (branch?.conditions ?? []).forEach((condition) => {
            if (conditionUses(condition, variableId)) push({ kind: "IF", where, text: describeCondition(condition), target: { type: "node", nodeId: conditionNodeId(branch.id, rootId) } });
        });
        actionEntries(branch).forEach((entry, index) => {
            if (entryUses(entry, variableId)) push({ kind: "SET", where, text: describeAction(entry), target: { type: "node", nodeId: actionNodeId(branch.id, index, rootId) } });
        });
        (branch?.children ?? []).forEach((child) => visitBranch(child, rootId, where));
    };

    (configuration?.roots ?? []).forEach((root, rootIndex) => {
        const where = `Root "${String(root.name ?? "").trim() || `Root ${rootIndex + 1}`}"`;
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
 * Applies `rewrite(entry)` to each Variable action that writes `variableId`, across the roots.
 * Returning null removes the action. When `readsToo` is set, operands that read the variable are
 * reset to 0 on the actions that remain.
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
    return {
        ...configuration,
        roots: (configuration.roots ?? []).map((root) => ({ ...root, branches: (root.branches ?? []).map(mapBranch) })),
    };
}

function rewriteConditions(configuration, rewrite) {
    const mapBranch = (branch) => {
        const next = { ...branch, children: (branch.children ?? []).map(mapBranch) };
        CONDITION_FIELDS.forEach((field) => { if (Array.isArray(branch[field])) next[field] = rewrite(branch[field]); });
        return next;
    };
    return {
        ...configuration,
        roots: (configuration.roots ?? []).map((root) => ({ ...root, branches: (root.branches ?? []).map(mapBranch) })),
    };
}

/** The configuration without the variable: its actions and conditions are removed everywhere. */
export function removeVariableFromConfiguration(configuration, variableId) {
    const customVariables = (configuration?.customVariables ?? []).filter((variable) => variable.id !== variableId);
    const cleaned = rewriteVariableActions({ ...configuration, customVariables }, variableId, () => null, { readsToo: true });
    return rewriteConditions(cleaned, (conditions) => (conditions ?? []).filter((condition) => !conditionUses(condition, variableId)));
}
