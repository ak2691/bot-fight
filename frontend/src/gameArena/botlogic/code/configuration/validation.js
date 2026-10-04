import { MAX_CONDITIONS_PER_BRANCH } from "./constants.js";
import { countActionSlots, countOrphanNodes } from "./configurationMetrics.js";
import { MAX_CUSTOM_VARIABLE_SLOTS, MAX_TOTAL_CONDITIONS, MAX_LOGIC_BLOCKS } from "./constants.js";

export function validateConfiguration(configuration, {
    normalizeConfiguration,
    countVariableSlots,
    countConditionSlots,
    validateChains = () => [],
}) {
    const normalized = normalizeConfiguration(configuration);
    const errors = [];
    const warnings = [];
    const rawVariables = Array.isArray(configuration?.customVariables) ? configuration.customVariables : [];
    const variableSlots = countVariableSlots(configuration);
    if (variableSlots > MAX_CUSTOM_VARIABLE_SLOTS) errors.push(`Custom variables use ${variableSlots}/${MAX_CUSTOM_VARIABLE_SLOTS} variable slots.`);
    const conditionSlots = countConditionSlots(configuration);
    if (conditionSlots > MAX_TOTAL_CONDITIONS) errors.push(`Conditions use ${conditionSlots}/${MAX_TOTAL_CONDITIONS} condition slots.`);
    if (countActionSlots(configuration) > MAX_LOGIC_BLOCKS) errors.push(`Actions exceed the ${MAX_LOGIC_BLOCKS} action limit.`);
    if (configuration?.orphans != null && !Array.isArray(configuration.orphans)) errors.push("Orphans must be a list.");
    const ids = new Set();
    (Array.isArray(configuration?.orphans) ? configuration.orphans : []).forEach((node, index) => {
        const label = `Orphan ${index + 1}`;
        if (!node || !["conditional", "action"].includes(node.kind)) { errors.push(`${label} has an invalid kind.`); return; }
        if (typeof node.id !== "string" || !/^[A-Za-z0-9_:. -]{1,160}$/.test(node.id) || ids.has(node.id)) errors.push(`${label} has an invalid or duplicate ID.`);
        ids.add(node.id);
        if (node.kind === "action" && ["children", "conditions", "actions"].some((key) => Object.hasOwn(node, key))) errors.push(`${label} action cannot contain a subtree.`);
        const normalizedNode = normalized.orphans?.find((entry) => entry.id === node.id);
        const visit = (raw, clean) => {
            if (!raw || !clean) { errors.push(`${label} contains invalid content.`); return; }
            const entries = raw.kind === "action" ? [raw] : Array.isArray(raw.actions) ? raw.actions : raw.action ? [raw] : [];
            const cleanEntries = clean.kind === "action" ? [clean] : clean.actions ?? [];
            entries.forEach((entry) => {
                const match = cleanEntries.find((candidate) => candidate.action === entry.action);
                if (!match) errors.push(`${label} contains an invalid action.`);
                else for (const key of Object.keys(entry)) {
                    if (["id", "kind", "action", "conditions", "children", "priority", "branchType", "actions"].includes(key)) continue;
                    if (JSON.stringify(entry[key]) !== JSON.stringify(match[key])) errors.push(`${label} has invalid ${key}.`);
                }
            });
            if (raw.kind !== "action") {
                if (!Array.isArray(raw.conditions) || raw.conditions.length > MAX_CONDITIONS_PER_BRANCH) errors.push(`${label} needs valid conditions.`);
                else raw.conditions.forEach((condition, i) => {
                    if (!clean.conditions?.[i] || Object.keys(condition).some((key) => JSON.stringify(condition[key]) !== JSON.stringify(clean.conditions[i][key]))) errors.push(`${label} contains an invalid condition.`);
                });
                if (raw.children != null && !Array.isArray(raw.children)) errors.push(`${label} children must be a list.`);
                else (raw.children ?? []).forEach((child, i) => visit(child, clean.children?.[i]));
            }
        };
        visit(node, normalizedNode);
    });
    const orphanCount = countOrphanNodes(configuration);
    if (orphanCount) warnings.push(`${orphanCount} ${orphanCount === 1 ? "node isn't" : "nodes aren't"} connected and won't run`);
    errors.push(...validateChains(configuration));
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
