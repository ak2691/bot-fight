import { CUSTOM_VARIABLE_OPERATIONS } from "../../botlogic/code/contracts/BotLogicContracts.js";

export const VARIABLE_OPERATOR_OPTIONS = Object.freeze([
    Object.freeze({ id: CUSTOM_VARIABLE_OPERATIONS.SET, label: "Set", glyph: "set", compactSymbol: "=" }),
    Object.freeze({ id: CUSTOM_VARIABLE_OPERATIONS.ADD, label: "Add", glyph: "add", compactSymbol: "+" }),
    Object.freeze({ id: CUSTOM_VARIABLE_OPERATIONS.SUBTRACT, label: "Subtract", glyph: "subtract", compactSymbol: "-" }),
    Object.freeze({ id: CUSTOM_VARIABLE_OPERATIONS.MODULO, label: "Modulo", glyph: "modulo", compactSymbol: "%" }),
]);

export function variableOperatorPresentation(operation) {
    return VARIABLE_OPERATOR_OPTIONS.find((candidate) => candidate.id === operation)
        ?? VARIABLE_OPERATOR_OPTIONS[0];
}

export function variableOperatorMenuKeyAction(key) {
    if (key === "ArrowDown" || key === "ArrowUp" || key === "Home" || key === "End") return key;
    if (key === "Escape") return "close-and-return-focus";
    if (key === "Tab") return "close-and-continue-focus";
    return null;
}

export function nextVariableOperatorMenuIndex(key, index, optionCount, disabledIndices = []) {
    if (optionCount < 1) return -1;
    const isEnabled = (candidate) => !disabledIndices.includes(candidate);
    if (key === "Home") return Array.from({ length: optionCount }, (_, candidate) => candidate).find(isEnabled) ?? index;
    if (key === "End") return Array.from({ length: optionCount }, (_, candidate) => optionCount - candidate - 1).find(isEnabled) ?? index;
    if (key === "ArrowDown" || key === "ArrowUp") {
        const direction = key === "ArrowDown" ? 1 : -1;
        for (let offset = 1; offset <= optionCount; offset += 1) {
            const candidate = (index + direction * offset + optionCount) % optionCount;
            if (isEnabled(candidate)) return candidate;
        }
    }
    return index;
}
