import { MAX_CUSTOM_VARIABLE_SLOTS, MAX_TOTAL_CONDITIONS } from "./constants.js";

export function validateConfiguration(configuration, {
    normalizeConfiguration,
    countVariableSlots,
    countConditionSlots,
    normalizedBlockEntries,
    isTrainableBlock,
}) {
    const normalized = normalizeConfiguration(configuration);
    const errors = [];
    const warnings = [];
    const rawVariables = Array.isArray(configuration?.customVariables) ? configuration.customVariables : [];
    const variableSlots = countVariableSlots(configuration);
    if (variableSlots > MAX_CUSTOM_VARIABLE_SLOTS) errors.push(`Custom variables use ${variableSlots}/${MAX_CUSTOM_VARIABLE_SLOTS} variable slots.`);
    const conditionSlots = countConditionSlots(configuration);
    if (conditionSlots > MAX_TOTAL_CONDITIONS) errors.push(`Conditions use ${conditionSlots}/${MAX_TOTAL_CONDITIONS} condition slots.`);
    const names = new Set();
    rawVariables.forEach((variable, index) => {
        const name = String(variable?.name ?? "").trim();
        if (!/^[A-Za-z][A-Za-z0-9 _-]{0,39}$/.test(name)) errors.push(`Custom variable ${index + 1} has an invalid name.`);
        const key = name.toLocaleLowerCase();
        if (names.has(key)) errors.push(`Custom variable name "${name}" is duplicated.`);
        names.add(key);
        if (variable?.valueType === "boolean" && Array.isArray(variable.conditions)) {
            variable.conditions.forEach((condition) => {
                if (condition?.type === "expression" && String(condition.left ?? "").startsWith("custom.")) {
                    const referenced = rawVariables.find((candidate) => candidate.id === condition.left);
                    if (!referenced) errors.push(`Custom variable "${name}" references a missing variable.`);
                }
            });
        }
    });
    const entries = normalizedBlockEntries(normalized);
    if (entries.length > 0 && !entries.some((entry) => isTrainableBlock(entry.block))) errors.push("Add at least one bot code action before submitting.");
    return { configuration: normalized, errors, warnings };
}
