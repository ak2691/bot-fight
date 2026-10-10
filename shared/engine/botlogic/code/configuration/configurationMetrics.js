import { stepConditionLists, walkChainStepsWithLoose } from "./chainSteps.js";

export function actionEntryCost(entry) {
    if (!entry || entry.action === "none") return 0;
    if (entry.action === "variable" && Array.isArray(entry.terms) && entry.terms.length) return entry.terms.length;
    return 1;
}

/** Every step of every chain, nested steps included. */
function chainSteps(configuration) {
    return (Array.isArray(configuration?.chains) ? configuration.chains : []).flatMap((chain) => [...walkChainStepsWithLoose(chain)]);
}

export function countActionSlots(configuration) {
    const countBranches = (branches = []) => (Array.isArray(branches) ? branches : []).reduce((total, branch) => {
        const actions = Array.isArray(branch?.actions) && branch.actions.length ? branch.actions : [branch];
        return total + actions.reduce((sum, entry) => sum + actionEntryCost(entry), 0) + countBranches(branch?.children);
    }, 0);
    // A chain step costs like an action; steps that are not actions cost one slot each.
    const chainCost = chainSteps(configuration)
        .reduce((total, step) => total + (step?.type === "action" ? actionEntryCost(step) : 1), 0);
    return (configuration?.roots ?? []).reduce((total, root) => total + countBranches(root?.branches)
        + (root?.actions ?? []).reduce((sum, entry) => sum + actionEntryCost(entry), 0), 0)
        + (Array.isArray(configuration?.orphans) ? configuration.orphans : []).reduce((total, node) => total + (node?.kind === "action" ? actionEntryCost(node) : countBranches([node])), 0) + chainCost;
}

export function countVariableSlots(configuration) {
    return (configuration?.customVariables ?? []).length;
}

export function countOrphanNodes(configuration) {
    const branchNodes = (branch) => 1 + (Array.isArray(branch?.actions) ? branch.actions.filter((entry) => entry?.action && entry.action !== "none").length : branch?.action && branch.action !== "none" ? 1 : 0)
        + (Array.isArray(branch?.children) ? branch.children.reduce((sum, child) => sum + branchNodes(child), 0) : 0);
    return (Array.isArray(configuration?.orphans) ? configuration.orphans : []).reduce((sum, node) => sum + (node?.kind === "conditional" ? branchNodes(node) : node?.kind === "action" ? 1 : 0), 0);
}

export function countConditionSlots(configuration) {
    const customVariables = configuration?.customVariables ?? [];
    const variableCosts = new Map(customVariables.map((variable) => [
        variable.id,
        1,
    ]));
    const conditionCost = (condition) => {
        const referenced = new Set([condition?.left, condition?.right?.type === "variable" ? condition.right.value : null]
            .filter((id) => variableCosts.has(id)));
        return referenced.size ? [...referenced].reduce((total, id) => total + variableCosts.get(id), 0) : 1;
    };
    const countBranches = (branches = []) => (Array.isArray(branches) ? branches : []).reduce((total, branch) => (
        total + (Array.isArray(branch?.conditions) ? branch.conditions : []).reduce((sum, condition) => sum + conditionCost(condition), 0)
            + countBranches(branch?.children)
    ), 0);
    const chainConditions = chainSteps(configuration).reduce((total, step) => total
        + stepConditionLists(step).reduce((sum, list) => sum + list.reduce((inner, condition) => inner + conditionCost(condition), 0), 0), 0);
    return (configuration?.roots ?? []).reduce((total, root) => total + countBranches(root?.branches), 0)
        + countBranches((Array.isArray(configuration?.orphans) ? configuration.orphans : []).filter((node) => node?.kind === "conditional")) + chainConditions;
}
