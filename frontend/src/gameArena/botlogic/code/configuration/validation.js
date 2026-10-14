import { MAX_CUSTOM_VARIABLE_SLOTS, MAX_LOGIC_BLOCKS, MAX_TOTAL_CONDITIONS } from "./constants.js";
import { countActionSlots, countOrphanNodes } from "./configurationMetrics.js";

const ORPHAN_ID_PATTERN = /^[A-Za-z0-9_:. -]{1,160}$/;

export function validateConfiguration(configuration, {
    normalizeConfiguration,
    countVariableSlots,
    countConditionSlots,
}) {
    const normalized = normalizeConfiguration(configuration);
    const errors = [];
    const warnings = [];
    const rawVariables = Array.isArray(configuration?.customVariables) ? configuration.customVariables : [];
    const variableSlots = countVariableSlots(configuration);
    if (variableSlots > MAX_CUSTOM_VARIABLE_SLOTS) errors.push(`Custom variables use ${variableSlots}/${MAX_CUSTOM_VARIABLE_SLOTS} variable slots.`);
    const conditionSlots = countConditionSlots(configuration);
    if (conditionSlots > MAX_TOTAL_CONDITIONS) errors.push(`Conditions use ${conditionSlots}/${MAX_TOTAL_CONDITIONS} condition slots.`);
    const actionSlots = countActionSlots(configuration);
    if (actionSlots > MAX_LOGIC_BLOCKS) errors.push(`Actions use ${actionSlots}/${MAX_LOGIC_BLOCKS} action slots.`);
    if (configuration?.orphans != null && !Array.isArray(configuration.orphans)) errors.push("Unconnected nodes must be a list.");
    validateOrphans(configuration?.orphans, errors);
    const orphanCount = countOrphanNodes(configuration);
    if (orphanCount) warnings.push(`${orphanCount} ${orphanCount === 1 ? "node isn't" : "nodes aren't"} connected and won't run.`);
    const names = new Set();
    rawVariables.forEach((variable, index) => {
        const name = String(variable?.name ?? "").trim();
        if (!/^[A-Za-z][A-Za-z0-9 _-]{0,39}$/.test(name)) errors.push(`Custom variable ${index + 1} has an invalid name.`);
        const key = name.toLocaleLowerCase();
        if (names.has(key)) errors.push(`Custom variable name "${name}" is duplicated.`);
        names.add(key);
        if (Object.prototype.hasOwnProperty.call(variable ?? {}, "conditions")) {
            errors.push(`Custom variable "${name}" no longer supports conditions.`);
        }
    });
    return { configuration: normalized, errors, warnings };
}

// Unconnected nodes use the same node shapes as connected ones, so only their envelope is checked here: the kind, a
// unique ID, and no subtree on a bare action. Their contents are repaired by normalization like connected nodes.
function validateOrphans(orphans, errors) {
    if (!Array.isArray(orphans)) return;
    const ids = new Set();
    orphans.forEach((node, index) => {
        const label = `Unconnected node ${index + 1}`;
        if (!node || !["conditional", "action"].includes(node.kind)) {
            errors.push(`${label} has an invalid kind.`);
            return;
        }
        if (typeof node.id !== "string" || !ORPHAN_ID_PATTERN.test(node.id) || ids.has(node.id)) {
            errors.push(`${label} has an invalid or duplicate ID.`);
        }
        ids.add(node.id);
        if (node.kind === "action" && ["children", "conditions", "actions"].some((key) => Object.hasOwn(node, key))) {
            errors.push(`${label} is an action, so it cannot contain a subtree.`);
        }
    });
}
