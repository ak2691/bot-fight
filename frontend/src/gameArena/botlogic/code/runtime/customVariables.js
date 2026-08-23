import {
    MAX_CUSTOM_VARIABLE_SLOTS,
    CUSTOM_NUMBER_MAX,
    CUSTOM_NUMBER_MIN,
    truncateToNumberPrecision,
} from "../configuration/constants.js";
import {
    BOT_CODE_ACTIONS,
    BOT_CODE_CONDITIONS,
    CUSTOM_VARIABLE_CONTRACT,
    CUSTOM_VARIABLE_OPERATIONS,
} from "../contracts/BotLogicContracts.js";

export function customVariablesWithReferencedActions(configuration) {
    const variables = Array.isArray(configuration?.customVariables)
        ? [...configuration.customVariables]
        : [];
    const knownIds = new Set(variables.map((variable) => String(variable?.id ?? "")));
    const knownNames = new Set(variables.map((variable) => String(variable?.name ?? "").trim().toLocaleLowerCase()));

    const addVariable = (id, valueType) => {
        if (!new RegExp(`^${CUSTOM_VARIABLE_CONTRACT.PREFIX}[A-Za-z0-9_.-]{1,52}$`).test(id) || knownIds.has(id)) return;
        knownIds.add(id);
        let nameIndex = variables.length + 1;
        while (knownNames.has(`${CUSTOM_VARIABLE_CONTRACT.DEFAULT_NAME} ${nameIndex}`.toLocaleLowerCase())) nameIndex += 1;
        const name = `${CUSTOM_VARIABLE_CONTRACT.DEFAULT_NAME} ${nameIndex}`;
        knownNames.add(name.toLocaleLowerCase());
        variables.push({ id, name, valueType, initialValue: valueType === "boolean" ? false : 0 });
    };

    const visit = (node) => {
        if (Array.isArray(node)) {
            node.forEach(visit);
            return;
        }
        if (!node || typeof node !== "object") return;
        if (node.action === BOT_CODE_ACTIONS.VARIABLE) {
            addVariable(String(node.variableId ?? ""), typeof node.value === "boolean" ? "boolean" : "number");
        }
        if (node.type === BOT_CODE_CONDITIONS.EXPRESSION || node.left) {
            addVariable(String(node.left ?? ""), node?.right?.type === "boolean" ? "boolean" : "number");
            if (node?.right?.type === "variable") addVariable(String(node.right.value ?? ""), "number");
        }
        if (node?.operand?.type === "variable") addVariable(String(node.operand.value ?? ""), "number");
        Object.values(node).forEach(visit);
    };

    visit(configuration?.roots);
    return variables;
}

export function normalizeCustomVariables(source, operations) {
    if (!Array.isArray(source)) return [];
    const used = new Set();
    const result = [];
    for (let index = 0; index < source.length && result.length < MAX_CUSTOM_VARIABLE_SLOTS; index += 1) {
        const candidate = source[index] ?? {};
        const valueType = candidate.valueType === "boolean" ? "boolean" : "number";
        const defaultName = `${CUSTOM_VARIABLE_CONTRACT.DEFAULT_NAME} ${index + 1}`;
        const name = String(candidate.name ?? defaultName).trim().slice(0, 40) || defaultName;
        let id = String(candidate.id ?? `${CUSTOM_VARIABLE_CONTRACT.PREFIX}${name.toLocaleLowerCase().replace(/[^a-z0-9]+/g, "_")}`).slice(0, 60);
        if (!id.startsWith(CUSTOM_VARIABLE_CONTRACT.PREFIX) || used.has(id)) id = `${CUSTOM_VARIABLE_CONTRACT.PREFIX}variable_${index + 1}`;
        used.add(id);
        result.push({
            id,
            name,
            valueType,
            initialValue: valueType === "boolean"
                ? operations.normalizeBoolean(candidate.initialValue, false)
                : operations.clamp(truncateToNumberPrecision(Number(candidate.initialValue) || 0), CUSTOM_NUMBER_MIN, CUSTOM_NUMBER_MAX),
        });
    }
    return result;
}

export function prepareCustomVariables(state, definitions) {
    if (!state.player.customVariables || typeof state.player.customVariables !== "object") state.player.customVariables = {};
    state.customVariableDefinitions = definitions;
    definitions.forEach((definition) => {
        if (!(definition.id in state.player.customVariables)) {
            state.player.customVariables[definition.id] = definition.initialValue;
            return;
        }
        if (definition.valueType === "number") {
            state.player.customVariables[definition.id] = Math.max(CUSTOM_NUMBER_MIN, Math.min(
                CUSTOM_NUMBER_MAX,
                truncateToNumberPrecision(Number(state.player.customVariables[definition.id]) || 0),
            ));
        }
    });
}

export function resolveCustomVariable(state, id) {
    const definition = state.customVariableDefinitions?.find((candidate) => candidate.id === id);
    if (!definition) return undefined;
    return state.player.customVariables?.[id] ?? definition.initialValue;
}

export function applyVariableAction(block, state, definitions, operations) {
    const definition = definitions.find((candidate) => candidate.id === block.variableId)
        ?? (!block.variableId ? definitions[0] : null);
    if (!definition) return;
    if (definition.valueType === "boolean") {
        state.player.customVariables[definition.id] = Boolean(block.value);
        return;
    }
    const current = Number(state.player.customVariables[definition.id] ?? definition.initialValue);
    const terms = Array.isArray(block.terms) && block.terms.length
        ? block.terms
        : [{ operator: block.operation ?? CUSTOM_VARIABLE_OPERATIONS.ADD, operand: block.operand ?? { type: "number", value: block.value ?? 0 } }];
    let next = terms[0]?.operator === CUSTOM_VARIABLE_OPERATIONS.SET ? 0 : current;
    for (const term of terms) {
        const amount = term.operand?.type === "variable"
            ? Number(operations.resolveVariable(state, { target: term.operand.target }, term.operand.value, term.operand.target)) || 0
            : Number(term.operand?.value) || 0;
        if (term.operator === CUSTOM_VARIABLE_OPERATIONS.MODULO) {
            const divisor = Number.isFinite(amount) ? Math.trunc(amount) : 0;
            if (divisor !== 0 && Number.isFinite(next)) next = Math.trunc(next) % divisor;
            continue;
        }
        const normalizedAmount = truncateToNumberPrecision(amount);
        next += term.operator === CUSTOM_VARIABLE_OPERATIONS.SUBTRACT ? -normalizedAmount : normalizedAmount;
    }
    state.player.customVariables[definition.id] = operations.clamp(truncateToNumberPrecision(next), CUSTOM_NUMBER_MIN, CUSTOM_NUMBER_MAX);
}
