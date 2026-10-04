// Where a custom variable is used, and how a type change or delete rewrites those places.
// Walks every part of a configuration that can hold a reference: connected roots (their
// conditionals and root actions), unconnected nodes, and chains (steps, nested If / Repeat bodies
// and loose blocks). Pure and UI-free so the rules can be tested directly.
import { BOT_CODE_ACTIONS, BOT_CODE_SELECTABLES } from "../botlogic/code/contracts/BotLogicContracts.js";
import { CHAIN_STEP_TYPES } from "../botlogic/code/configuration/constants.js";
import { editorRootsFor } from "./treeWiring.js";
import { LOOSE, BODY, BRANCH, isConditional, numberChainSteps, pathKey } from "./chains/chainEditing.js";

const CONDITION_FIELDS = Object.freeze(["conditions", "whileConditions", "untilConditions"]);

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
 * `{ key, kind, where, text, target }`; `target` is `{ type: "node", nodeId }` for the main canvas
 * or `{ type: "step", chainId, path }` for a chain step. `describe` supplies the wording:
 * `condition(condition)` and `action(entry)` return the use's summary text.
 */
export function collectVariableUses(configuration, variableId, describe = {}) {
    const describeCondition = describe.condition ?? ((condition) => String(condition?.left ?? ""));
    const describeAction = describe.action ?? ((entry) => String(entry?.variableId ?? ""));
    const uses = [];
    const push = (use) => uses.push({ ...use, key: `${use.target.type}:${use.target.nodeId ?? `${use.target.chainId}:${pathKey(use.target.path)}`}:${uses.length}` });

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

    (Array.isArray(configuration?.chains) ? configuration.chains : []).forEach((chain) => {
        const where = `Chain "${chain.name ?? chain.id}"`;
        const visitList = (steps, listPath, numbers, prefix) => (steps ?? []).forEach((step, index) => {
            const path = [...listPath, index];
            const label = numbers.get(pathKey(path));
            // A loose block never runs, so it has no step number.
            const kind = prefix.length ? "LOOSE" : step.type === CHAIN_STEP_TYPES.REPEAT ? "REPEAT" : label != null ? `STEP ${label}` : "STEP";
            const target = { type: "step", chainId: chain.id, path: [...prefix, ...path] };
            CONDITION_FIELDS.forEach((field) => (step[field] ?? []).forEach((condition) => {
                if (conditionUses(condition, variableId)) push({ kind, where, text: describeCondition(condition), target });
            }));
            if (step.type === CHAIN_STEP_TYPES.ACTION && entryUses(step, variableId)) push({ kind, where, text: describeAction(step), target });
            if (isConditional(step)) visitList(step.steps, [...path, BRANCH], numbers, prefix);
            else if (step.type === CHAIN_STEP_TYPES.REPEAT) visitList(step.steps, [...path, BODY], numbers, prefix);
        });
        visitList(chain.steps, [], numberChainSteps(chain.steps ?? []), []);
        (Array.isArray(chain.loose) ? chain.loose : []).forEach((entry, looseIndex) => {
            if (!entry?.step) return;
            // A loose block is a one-step stack; its path is [LOOSE, index, ...path within the block].
            visitList([entry.step], [], numberChainSteps([entry.step]), [LOOSE, looseIndex]);
        });
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
 * Applies `rewrite(entry)` to each Variable action that writes `variableId`, across roots, unconnected
 * nodes and chains. Returning null removes the action. When `readsToo` is set, operands that read the
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
    const mapSteps = (steps) => (steps ?? []).flatMap((step) => {
        const mapped = step.type === CHAIN_STEP_TYPES.ACTION ? mapEntry(step) : step;
        if (!mapped) return [];
        return [Array.isArray(mapped.steps) ? { ...mapped, steps: mapSteps(mapped.steps) } : mapped];
    });
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
            ...(Array.isArray(root.actions) ? { actions: root.actions.map(mapEntry).filter(Boolean) } : {}),
            branches: (root.branches ?? []).map(mapBranch),
        })),
        ...(Array.isArray(configuration.orphans) ? { orphans: configuration.orphans.flatMap(orphanEntry) } : {}),
        ...(Array.isArray(configuration.chains) ? {
            chains: configuration.chains.map((chain) => ({
                ...chain,
                steps: mapSteps(chain.steps),
                ...(Array.isArray(chain.loose) ? { loose: chain.loose.flatMap((entry) => {
                    const [step] = mapSteps([entry.step]);
                    return step ? [{ ...entry, step }] : [];
                }) } : {}),
            })),
        } : {}),
    };
}

function rewriteConditions(configuration, rewrite) {
    const mapBranch = (branch) => ({ ...branch, conditions: rewrite(branch.conditions), children: (branch.children ?? []).map(mapBranch) });
    const mapSteps = (steps) => (steps ?? []).map((step) => {
        const next = { ...step };
        CONDITION_FIELDS.forEach((field) => { if (Array.isArray(step[field])) next[field] = rewrite(step[field]); });
        if (Array.isArray(step.steps)) next.steps = mapSteps(step.steps);
        return next;
    });
    return {
        ...configuration,
        roots: (configuration.roots ?? []).map((root) => ({ ...root, branches: (root.branches ?? []).map(mapBranch) })),
        ...(Array.isArray(configuration.orphans) ? { orphans: configuration.orphans.map((orphan) => (orphan.kind === "action" ? orphan : mapBranch(orphan))) } : {}),
        ...(Array.isArray(configuration.chains) ? {
            chains: configuration.chains.map((chain) => ({
                ...chain,
                steps: mapSteps(chain.steps),
                ...(Array.isArray(chain.loose) ? { loose: chain.loose.map((entry) => ({ ...entry, step: mapSteps([entry.step])[0] })) } : {}),
            })),
        } : {}),
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
