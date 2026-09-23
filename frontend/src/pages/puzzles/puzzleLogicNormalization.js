import {
    BOT_LOGIC_TREE_VERSION,
    normalizeAbilityStrategyConfiguration,
} from "../../gameArena/botlogic/code/BotCode.js";

export function normalizePuzzleCustomVariables(configuration) {
    const source = Array.isArray(configuration?.customVariables)
        ? configuration.customVariables.map((variable) => ({
            ...variable,
            name: variable?.name ?? variable?.label,
            initialValue: Object.prototype.hasOwnProperty.call(variable ?? {}, "initialValue")
                ? variable.initialValue
                : variable?.defaultValue,
        }))
        : [];
    return normalizeAbilityStrategyConfiguration({
        version: BOT_LOGIC_TREE_VERSION,
        customVariables: source,
        roots: [],
    }).customVariables;
}
