// Pure edits to a custom-variable action entry's operands. Shared by the main canvas and the
// chain editor so a Variable action behaves the same wherever it lives.
import { CUSTOM_VARIABLE_OPERATIONS, defaultSelectableForVariable } from "../../../../../shared/engine/botlogic/code/BotCode.js";

/** The terms of a number variable action; older single-operand entries read as one term. */
export function variableActionTerms(entry) {
    if (Array.isArray(entry?.terms) && entry.terms.length) return entry.terms;
    return [{
        operator: entry?.operation ?? CUSTOM_VARIABLE_OPERATIONS.SET,
        operand: entry?.operand ?? { type: "number", value: entry?.value ?? 0 },
    }];
}

/** The value type a state variable must have to feed this entry's target variable. */
export function actionOperandValueType(entry, customVariables = []) {
    return customVariables.find((variable) => variable.id === entry?.variableId)?.valueType ?? "number";
}

function variableOperand(definition, selectableTypes) {
    return {
        type: "variable",
        value: definition.id,
        ...(definition.supportsSelectable ? { selectable: defaultSelectableForVariable(definition, selectableTypes) } : {}),
    };
}

/** Sets one operand of the entry (a boolean, or term `termIndex` of a number). */
export function withActionOperand(entry, customVariables, termIndex, operand) {
    const target = customVariables.find((variable) => variable.id === entry.variableId);
    if (target?.valueType === "boolean") {
        const next = { ...entry, operation: CUSTOM_VARIABLE_OPERATIONS.SET, operand };
        delete next.value;
        delete next.terms;
        return next;
    }
    const terms = variableActionTerms(entry);
    const next = { ...entry, terms: terms.map((term, index) => index === termIndex ? { ...term, operand } : term) };
    delete next.operation;
    delete next.operand;
    delete next.value;
    return next;
}

/**
 * Points an operand at a state variable. Returns null when the variable's type does not match
 * the target, so the caller leaves the entry as it was.
 */
export function withActionOperandVariable(entry, customVariables, termIndex, definition, selectableTypes) {
    const target = customVariables.find((variable) => variable.id === entry?.variableId);
    if (!definition || !target || definition.valueType !== actionOperandValueType(entry, customVariables)) return null;
    return withActionOperand(entry, customVariables, termIndex, variableOperand(definition, selectableTypes));
}

/** The operand a term currently holds, for opening its settings panel. */
export function actionOperandAt(entry, termIndex) {
    return variableActionTerms(entry)[termIndex]?.operand ?? null;
}
