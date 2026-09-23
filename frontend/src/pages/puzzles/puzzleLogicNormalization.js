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
    const normalized = normalizeAbilityStrategyConfiguration({
        version: BOT_LOGIC_TREE_VERSION,
        customVariables: source,
        roots: [],
    }).customVariables;
    const usedNames = new Set();
    return normalized.map((variable, index) => ({
        ...variable,
        name: uniquePuzzleVariableName(variable.name, index, usedNames),
    }));
}

function uniquePuzzleVariableName(value, index, usedNames) {
    const fallback = `Variable ${index + 1}`;
    let base = String(value ?? "").trim().replace(/[^A-Za-z0-9 _-]+/g, "").replace(/\s+/g, " ");
    if (!/^[A-Za-z]/.test(base)) base = base ? `Variable ${base}` : fallback;
    base = base.slice(0, 40).trim() || fallback;
    let name = base;
    let suffix = 2;
    while (usedNames.has(name.toLocaleLowerCase())) {
        const addition = ` ${suffix++}`;
        name = `${base.slice(0, 40 - addition.length).trim()}${addition}`;
    }
    usedNames.add(name.toLocaleLowerCase());
    return name;
}
