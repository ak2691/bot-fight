import { ACTION_TO_ABILITY, STANDARD_ABILITY_IDS } from "../../../loadout/BotLoadout.js";
import { ACTION_BY_ID, ACTION_HEADS, CUSTOM_VARIABLE_CONTRACT, STATE_VARIABLE_BY_ID } from "../contracts/BotLogicContracts.js";
import { countActionSlots, countConditionSlots } from "./configurationMetrics.js";
import { validateChains } from "./chainValidation.js";
import { MAX_LOGIC_BLOCKS, MAX_TOTAL_CONDITIONS, MAX_CUSTOM_VARIABLE_SLOTS } from "./constants.js";

/** Deepest branch nesting. With the server's JSON nesting cap this also bounds every recursion below. */
export const MAX_TREE_DEPTH = 40;
const MAX_TREE_NODES = MAX_LOGIC_BLOCKS + MAX_TOTAL_CONDITIONS;
const STANDARD_ABILITIES = new Set(STANDARD_ABILITY_IDS);
const isCustom = (id) => typeof id === "string" && id.startsWith(CUSTOM_VARIABLE_CONTRACT.PREFIX);
const list = (value) => (Array.isArray(value) ? value : []);
const actionHead = (action) => ACTION_BY_ID.get(action)?.head ?? null;

/**
 * The brain rules a JSON Schema cannot express: references (variables, chains, equipped abilities),
 * sibling order, one action per head, nesting depth and totals across the whole brain. Run them on a brain
 * that already passed shared/schemas/brain.schema.json. The sim-worker runs them for every submission and
 * puzzle (POST /validate), so this is the one implementation. `puzzleRules: true` checks outcome
 * roots; `puzzleConstraints` applies the authored budgets and reserved namespace to a puzzle bot. Returns readable errors; empty means valid.
 */
export function brainRuleErrors(brain, { puzzleRules = false, requireActions = !puzzleRules, puzzleConstraints = null } = {}) {
    const errors = [];
    if (treeDepth(brain) > MAX_TREE_DEPTH) return [`Conditions nest deeper than ${MAX_TREE_DEPTH} levels.`];
    if (puzzleRules) checkPuzzleRules(brain, errors);
    if (puzzleConstraints) checkPuzzleConstraints(brain, puzzleConstraints, errors);
    const types = customVariableTypes(brain, errors);
    checkReferences(brain, "brain", types, errors);
    if (countConditionSlots(brain) > MAX_TOTAL_CONDITIONS) errors.push(`Conditions exceed the ${MAX_TOTAL_CONDITIONS} condition slots.`);
    if (countActionSlots(puzzleRules ? puzzleRulesAsBrain(brain) : brain) > MAX_LOGIC_BLOCKS) errors.push(`Actions exceed the ${MAX_LOGIC_BLOCKS} action limit.`);
    checkTree(brain, true, errors);
    if (requireActions) checkLoadout(brain, errors);
    errors.push(...validateChains(brain, { actionHead }));
    return errors;
}

function treeDepth(brain) {
    const depth = (branches, level) => list(branches).reduce((deepest, branch) => Math.max(deepest,
        level > MAX_TREE_DEPTH ? level : depth(branch?.children, level + 1)), level - 1);
    return Math.max(depth(brain.orphans, 1), ...list(brain.roots).map((root) => depth(root?.branches, 1)));
}

function customVariableTypes(brain, errors) {
    const types = new Map();
    const names = new Set();
    list(brain.customVariables).forEach((variable, index) => {
        if (types.has(variable.id)) errors.push(`Custom variable ${index + 1} repeats the ID ${variable.id}.`);
        const name = String(variable.name ?? "").trim().toLowerCase();
        if (names.has(name)) errors.push(`Custom variable name "${variable.name}" is duplicated.`);
        names.add(name);
        if (!types.has(variable.id)) types.set(variable.id, variable.valueType);
    });
    return types;
}

/** Conditions and variable actions may only name declared custom variables, with matching types. */
function checkReferences(node, path, types, errors) {
    if (Array.isArray(node)) {
        node.forEach((child, index) => checkReferences(child, `${path}[${index}]`, types, errors));
        return;
    }
    if (!node || typeof node !== "object") return;
    if (node.type === "expression") checkCondition(node, path, types, errors);
    if (node.action === "variable") checkVariableAction(node, path, types, errors);
    for (const [key, child] of Object.entries(node)) {
        if (key !== "customVariables" && key !== "nodePositions") checkReferences(child, `${path}.${key}`, types, errors);
    }
}

function checkCondition(condition, path, types, errors) {
    if (isCustom(condition.left)) {
        if (!types.has(condition.left)) errors.push(`${path}.left reads an unknown custom variable.`);
        else if ((condition.right?.type === "boolean") !== (types.get(condition.left) === "boolean")) {
            errors.push(`${path}.left is compared with a value of the wrong type.`);
        }
    }
    const right = condition.right?.type === "variable" ? condition.right.value : null;
    if (isCustom(right) && types.get(right) !== "number") errors.push(`${path}.right must read a number custom variable.`);
}

function checkVariableAction(action, path, types, errors) {
    const type = types.get(action.variableId);
    if (type == null) {
        errors.push(`${path}.variableId names an unknown custom variable.`);
        return;
    }
    const { operand, terms, value } = action;
    const operation = action.operation ?? "set";
    if (type === "boolean") {
        const valid = typeof value === "boolean" || operand?.type === "boolean"
            || (operand?.type === "variable" && types.get(operand.value) === "boolean");
        if (!valid || terms != null || operation !== "set") errors.push(`${path} must set a boolean value or variable.`);
        return;
    }
    const numericOperand = (entry, here) => {
        if (entry?.type === "boolean") errors.push(`${here} must be a number or a number variable.`);
        else if (entry?.type === "variable" && STATE_VARIABLE_BY_ID.get(entry.value)?.valueType !== "number"
            && types.get(entry.value) !== "number") errors.push(`${here} must read a number variable.`);
    };
    if (terms != null) list(terms).forEach((term, index) => numericOperand(term?.operand, `${path}.terms[${index}].operand`));
    else if (operand != null) numericOperand(operand, `${path}.operand`);
    else if (typeof value !== "number") errors.push(`${path} needs a number value.`);
    const divisor = operand?.type === "number" ? operand.value : operand == null ? value : null;
    if (operation === "modulo" && typeof divisor === "number" && Math.trunc(divisor) === 0) errors.push(`${path} cannot take a modulo by 0.`);
}

/** Sibling order, one action per head per block, unique orphan IDs and the conditional-node budget. */
function checkTree(brain, requireActions, errors) {
    let nodes = 0;
    const checkActions = (actions, path) => {
        if (!requireActions || !Array.isArray(actions)) return;
        const heads = new Set();
        actions.forEach((entry, index) => {
            const head = actionHead(entry?.action) ?? ACTION_HEADS.ABILITY;
            const key = head === ACTION_HEADS.VARIABLE || head === ACTION_HEADS.CHAIN ? `${head}:${index}` : head;
            if (heads.has(key)) errors.push(`${path} has more than one ${head} action.`);
            heads.add(key);
        });
        if (heads.has(ACTION_HEADS.NONE) && heads.size > 1) errors.push(`${path} combines N/A with other actions.`);
    };
    const checkBranches = (branches, path) => list(branches).forEach((branch, index, siblings) => {
        const here = `${path}[${index}]`;
        nodes += 1;
        const type = branch?.branchType ?? "if";
        if (index === 0 && type !== "if") errors.push(`${here} must be an If: it is the first sibling.`);
        if (type === "else" && index !== siblings.length - 1) errors.push(`${here} is an Else, so it must be the last sibling.`);
        checkActions(branch?.actions, here);
        checkBranches(branch?.children, `${here}.children`);
    });
    list(brain.roots).forEach((root, index) => {
        checkActions(root?.actions, `brain.roots[${index}]`);
        checkBranches(root?.branches, `brain.roots[${index}].branches`);
    });
    const orphanIds = new Set();
    list(brain.orphans).forEach((node, index) => {
        const here = `brain.orphans[${index}]`;
        if (orphanIds.has(node?.id)) errors.push(`${here} repeats the ID ${node.id}.`);
        orphanIds.add(node?.id);
        if (node?.kind !== "conditional") return;
        nodes += 1;
        checkActions(node.actions, here);
        checkBranches(node.children, `${here}.children`);
    });
    if (nodes > MAX_TREE_NODES) errors.push(`The brain has more than ${MAX_TREE_NODES} conditional nodes.`);
}

/** Actions and selected-ability conditions may only use equipped (or standard) abilities. */
function checkLoadout(brain, errors) {
    // A brain without a loadout (puzzle opponents) claims no ability set to check against.
    if (!Array.isArray(brain.loadout?.abilities)) return;
    const usable = new Set([...STANDARD_ABILITIES, ...brain.loadout.abilities]);
    const reads = (variable, selectable) => typeof variable === "string" && variable.startsWith("bot.selectedAbility") && selectable !== "opponent";
    const visit = (node, path) => {
        if (Array.isArray(node)) return node.forEach((child, index) => visit(child, `${path}[${index}]`));
        if (!node || typeof node !== "object") return;
        const ability = Number.isInteger(node.action) ? ACTION_TO_ABILITY[node.action] : null;
        if (ability != null && !usable.has(ability)) errors.push(`${path}.action uses ability ${ability}, which is not equipped.`);
        const readsAbility = reads(node.left, node.leftSelectable)
            || (node.right?.type === "variable" && reads(node.right.value, node.rightSelectable));
        if (readsAbility && Number.isInteger(node.ability) && !usable.has(node.ability)) {
            errors.push(`${path}.ability ${node.ability} is not equipped.`);
        }
        for (const [key, child] of Object.entries(node)) if (key !== "loadout") visit(child, `${path}.${key}`);
    };
    visit(brain, "brain");
}

/** Adapt puzzle-only root metadata for the ordinary brain schema without hiding invalid fields. */
export function puzzleRulesAsBrain(rules) {
    const roots = Array.isArray(rules?.roots) ? rules.roots.map((root) => {
        if (!root || typeof root !== "object" || Array.isArray(root)) return root;
        const { kind: _kind, ...fields } = root;
        return {
            ...fields,
            branches: Array.isArray(root.branches) ? root.branches.map((branch) => (
                branch && typeof branch === "object" && !Array.isArray(branch)
                    && !("action" in branch) && !("actions" in branch)
                    ? { ...branch, action: "none" } : branch
            )) : root.branches,
        };
    }) : rules?.roots;
    return { ...rules, roots };
}

function checkPuzzleRules(brain, errors) {
    if (new TextEncoder().encode(JSON.stringify(brain)).length > 250_000) errors.push("Puzzle logic configuration is too large.");
    if (!Array.isArray(brain.customVariables)) errors.push("Puzzle rules must declare customVariables as an array.");
    for (const [index, variable] of list(brain.customVariables).entries()) {
        if (!variable.id.startsWith("custom.puzzle.")) errors.push(`Puzzle variable ${index + 1} must use the puzzle namespace.`);
    }
    if (!list(brain.roots).some((root) => root.kind === "win")) errors.push("Puzzle rules must contain at least one win condition.");
    for (const [index, root] of list(brain.roots).entries()) {
        const path = `brain.roots[${index}]`;
        if (!["win", "lose", "modify"].includes(root.kind)) errors.push(`${path}.kind must be win, lose, or modify.`);
        if (!list(root.branches).length) errors.push(`${path}.branches must contain at least one conditional.`);
        for (const [branchIndex, branch] of list(root.branches).entries()) {
            const here = `${path}.branches[${branchIndex}]`;
            if (!list(branch.conditions).length) errors.push(`${here}.conditions must contain at least one condition.`);
            if (list(branch.children).length) errors.push(`${here}.children are not supported in puzzle rules.`);
            const actions = list(branch.actions);
            if (root.kind === "modify") {
                if (actions.length !== 1 || actions[0].action !== "variable") errors.push(`${here} must contain exactly one modify custom variable action.`);
            } else if (actions.length || (branch.action != null && branch.action !== "none")) {
                errors.push(`${here} cannot contain actions for a win or lose condition.`);
            }
        }
    }
}

/** Authored puzzle limits use the same slot metrics as submissions and the editor. */
function checkPuzzleConstraints(brain, constraints, errors) {
    const limits = [
        ["maxActionNodes", MAX_LOGIC_BLOCKS, countActionSlots(brain), "action nodes"],
        ["maxConditionNodes", MAX_TOTAL_CONDITIONS, countConditionSlots(brain), "condition nodes"],
        ["maxCustomVariables", MAX_CUSTOM_VARIABLE_SLOTS, list(brain.customVariables).length, "custom variables"],
        ["maxLoadoutAbilities", 6, list(brain.loadout?.abilities).length, "loadout abilities"],
    ];
    for (const [key, maximum, count, label] of limits) {
        const limit = constraints[key] ?? maximum;
        if (!Number.isInteger(limit) || limit < 0 || limit > maximum) errors.push(`Invalid puzzle ${key}.`);
        else if (count > limit) errors.push(`Brain uses ${count} ${label}; puzzle allows ${limit}.`);
    }
    if (constraints.reservePuzzleNamespace) {
        list(brain.customVariables).forEach((variable, index) => {
            if (variable.id.startsWith("custom.puzzle.")) errors.push(`Custom variable ${index + 1} uses a reserved puzzle variable namespace.`);
        });
    }
}
