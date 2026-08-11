import {
    CUSTOM_INTEGER_MAX,
    CUSTOM_INTEGER_MIN,
    MAX_CUSTOM_VARIABLE_SLOTS,
} from "./constants.js";

export function customVariablesWithReferencedActions(configuration) {
    const variables = Array.isArray(configuration?.customVariables)
        ? [...configuration.customVariables]
        : [];
    const knownIds = new Set(variables.map((variable) => String(variable?.id ?? "")));
    const knownNames = new Set(variables.map((variable) => String(variable?.name ?? "").trim().toLocaleLowerCase()));

    const addVariable = (id, valueType) => {
        if (!/^custom\.[A-Za-z0-9_.-]{1,52}$/.test(id) || knownIds.has(id)) return;
        knownIds.add(id);
        let nameIndex = variables.length + 1;
        while (knownNames.has(`variable ${nameIndex}`)) nameIndex += 1;
        const name = `Variable ${nameIndex}`;
        knownNames.add(name.toLocaleLowerCase());
        variables.push({ id, name, valueType, initialValue: valueType === "boolean" ? false : 0 });
    };

    const visit = (node) => {
        if (Array.isArray(node)) {
            node.forEach(visit);
            return;
        }
        if (!node || typeof node !== "object") return;
        if (node.action === "variable") {
            addVariable(String(node.variableId ?? ""), typeof node.value === "boolean" ? "boolean" : "number");
        }
        if (node.type === "expression" || node.left) {
            addVariable(String(node.left ?? ""), node?.right?.type === "boolean" ? "boolean" : "number");
            if (node?.right?.type === "variable") addVariable(String(node.right.value ?? ""), "number");
        }
        if (node?.operand?.type === "variable") addVariable(String(node.operand.value ?? ""), "number");
        Object.values(node).forEach(visit);
    };

    visit(configuration?.roots);
    (configuration?.customVariables ?? []).forEach((variable) => visit(variable?.conditions));
    return variables;
}

export function normalizeCustomVariables(source, operations) {
    if (!Array.isArray(source)) return [];
    const used = new Set();
    let slots = 0;
    const result = [];
    for (let index = 0; index < source.length && slots < MAX_CUSTOM_VARIABLE_SLOTS; index += 1) {
        const candidate = source[index] ?? {};
        const valueType = candidate.valueType === "boolean" ? "boolean" : "number";
        const name = String(candidate.name ?? `Variable ${index + 1}`).trim().slice(0, 40) || `Variable ${index + 1}`;
        let id = String(candidate.id ?? `custom.${name.toLocaleLowerCase().replace(/[^a-z0-9]+/g, "_")}`).slice(0, 60);
        if (!id.startsWith("custom.") || used.has(id)) id = `custom.variable_${index + 1}`;
        used.add(id);
        const availableConditions = Math.max(0, MAX_CUSTOM_VARIABLE_SLOTS - slots - 1);
        const conditions = valueType === "boolean" && Array.isArray(candidate.conditions)
            ? operations.normalizeConditions(candidate.conditions, source).slice(0, availableConditions)
            : [];
        slots += 1 + conditions.length;
        result.push({
            id,
            name,
            valueType,
            initialValue: valueType === "boolean"
                ? operations.normalizeBoolean(candidate.initialValue, false)
                : operations.clamp(Math.trunc(Number(candidate.initialValue) || 0), CUSTOM_INTEGER_MIN, CUSTOM_INTEGER_MAX),
            ...(conditions.length ? { conditions } : {}),
        });
    }
    return result;
}

export function prepareCustomVariables(state, definitions, operations) {
    if (!state.player.customVariables || typeof state.player.customVariables !== "object") state.player.customVariables = {};
    state.customVariableDefinitions = definitions;
    definitions.forEach((definition) => {
        if (!(definition.id in state.player.customVariables)) state.player.customVariables[definition.id] = definition.initialValue;
    });
    definitions.forEach((definition) => {
        if (definition.valueType === "boolean" && definition.conditions?.length) {
            state.player.customVariables[definition.id] = resolveCustomVariable(state, definition.id, operations);
        }
    });
}

export function resolveCustomVariable(state, id, operations, resolving = state.resolvingCustomVariables ?? new Set()) {
    const definition = state.customVariableDefinitions?.find((candidate) => candidate.id === id);
    if (!definition) return undefined;
    if (definition.valueType === "boolean" && definition.conditions?.length) {
        if (resolving.has(id)) return false;
        resolving.add(id);
        const result = operations.evaluateConditions(definition.conditions, { ...state, resolvingCustomVariables: resolving });
        resolving.delete(id);
        return result;
    }
    return state.player.customVariables?.[id] ?? definition.initialValue;
}

export function applyVariableAction(block, state, definitions, operations) {
    const definition = definitions.find((candidate) => candidate.id === block.variableId)
        ?? (!block.variableId ? definitions[0] : null);
    if (!definition || definition.conditions?.length) return;
    if (definition.valueType === "boolean") {
        state.player.customVariables[definition.id] = Boolean(block.value);
        return;
    }
    const current = Number(state.player.customVariables[definition.id] ?? definition.initialValue);
    const terms = Array.isArray(block.terms) && block.terms.length ? block.terms : operations.normalizeTerms(block);
    let next = terms[0]?.operator === "set" ? 0 : current;
    for (const term of terms) {
        const amount = term.operand?.type === "variable"
            ? Number(operations.resolveVariable(state, { target: term.operand.target }, term.operand.value, term.operand.target)) || 0
            : Number(term.operand?.value) || 0;
        next += term.operator === "subtract" ? -amount : amount;
    }
    state.player.customVariables[definition.id] = operations.clamp(Math.trunc(next), CUSTOM_INTEGER_MIN, CUSTOM_INTEGER_MAX);
}
