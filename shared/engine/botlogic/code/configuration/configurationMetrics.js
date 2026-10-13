import { linkedActionDiscount } from "./linkedActions.js";
import { BOT_LOGIC_LANES_VERSION } from "./constants.js";
import { laneCards } from "./laneCardTree.js";

export function actionEntryCost(entry) {
    if (!entry || entry.action === "none") return 0;
    if (entry.action === "variable" && Array.isArray(entry.terms) && entry.terms.length) return entry.terms.length;
    return 1;
}

export function countActionSlots(configuration) {
    if (isLanesConfiguration(configuration)) return laneCards(configuration).reduce((total, card) => total + actionEntryCost(card.action), 0);
    const countBranches = (branches = []) => (Array.isArray(branches) ? branches : []).reduce((total, branch) => {
        const actions = Array.isArray(branch?.actions) && branch.actions.length ? branch.actions : [branch];
        return total + actions.reduce((sum, entry) => sum + actionEntryCost(entry), 0) + countBranches(branch?.children);
    }, 0);
    return (configuration?.roots ?? []).reduce((total, root) => total + countBranches(root?.branches)
        + (root?.actions ?? []).reduce((sum, entry) => sum + actionEntryCost(entry), 0), 0)
        + (Array.isArray(configuration?.orphans) ? configuration.orphans : []).reduce((total, node) => total + (node?.kind === "action" ? actionEntryCost(node) : countBranches([node])), 0)
        - linkedActionDiscount(configuration, actionEntryCost);
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
    if (isLanesConfiguration(configuration)) {
        return laneCards(configuration).reduce((total, card) => total + (Array.isArray(card.conditions) ? card.conditions : [])
            .reduce((sum, condition) => sum + conditionCost(condition), 0), 0);
    }
    const countBranches = (branches = []) => (Array.isArray(branches) ? branches : []).reduce((total, branch) => (
        total + (Array.isArray(branch?.conditions) ? branch.conditions : []).reduce((sum, condition) => sum + conditionCost(condition), 0)
            + countBranches(branch?.children)
    ), 0);
    return (configuration?.roots ?? []).reduce((total, root) => total + countBranches(root?.branches), 0)
        + countBranches((Array.isArray(configuration?.orphans) ? configuration.orphans : []).filter((node) => node?.kind === "conditional"));
}

/**
 * Lanes totals for the editor meters and brain rules. Cards count every one, disabled included.
 * Tree brains have no such counts (they report 0 for each).
 */
export function countLaneTotals(configuration) {
    if (!isLanesConfiguration(configuration)) return { cards: 0, conditions: 0 };
    const cards = laneCards(configuration);
    return {
        cards: cards.length,
        conditions: cards.reduce((total, card) => total + (Array.isArray(card.conditions) ? card.conditions.length : 0), 0),
    };
}

function isLanesConfiguration(configuration) {
    return configuration?.version === BOT_LOGIC_LANES_VERSION;
}
