// Helpers for the add-action and add-variable pickers. UI only: nothing here
// changes which actions or variables exist, only how they are grouped and shown.

export const RECENT_VARIABLES_KEY = "botfight:recent-variable-picks";
export const RECENT_VARIABLES_LIMIT = 3;

export function readRecentVariableIds() {
    try {
        const stored = JSON.parse(window.localStorage.getItem(RECENT_VARIABLES_KEY));
        return Array.isArray(stored)
            ? stored.filter((id) => typeof id === "string").slice(0, RECENT_VARIABLES_LIMIT)
            : [];
    } catch {
        return [];
    }
}

export function rememberVariableId(id) {
    if (typeof id !== "string" || !id || id === "always") return;
    try {
        const next = [id, ...readRecentVariableIds().filter((existing) => existing !== id)].slice(0, RECENT_VARIABLES_LIMIT);
        window.localStorage.setItem(RECENT_VARIABLES_KEY, JSON.stringify(next));
    } catch {
        // Storage can be unavailable or full; recents are a convenience only.
    }
}

// Splits text around the first case-insensitive match of the query so the match can be highlighted.
export function splitMatch(text, query) {
    const value = String(text ?? "");
    const needle = String(query ?? "").trim().toLocaleLowerCase();
    if (!needle) return [{ text: value, match: false }];
    const start = value.toLocaleLowerCase().indexOf(needle);
    if (start < 0) return [{ text: value, match: false }];
    return [
        { text: value.slice(0, start), match: false },
        { text: value.slice(start, start + needle.length), match: true },
        { text: value.slice(start + needle.length), match: false },
    ].filter((part) => part.text);
}

// Short chip names and sentence-case group headings for the variable picker categories.
export const VARIABLE_CATEGORY_LABELS = Object.freeze({
    "Health & Combat": { chip: "Combat", title: "Health and combat" },
    "Abilities & Status": { chip: "Abilities", title: "Abilities and status" },
    "Position & Movement": { chip: "Position", title: "Position and movement" },
    Rotation: { chip: "Rotation", title: "Rotation" },
    "Ability Entity": { chip: "Entities", title: "Ability entities" },
    Match: { chip: "Match", title: "Match" },
    "Custom Variables": { chip: "Custom", title: "Custom variables" },
    Basic: { chip: "Basic", title: "Basic" },
    Other: { chip: "Other", title: "Other" },
});

// Category colours live in index.css as --pk-<tone>-* variables shared by both pickers.
export const VARIABLE_CATEGORY_TONES = Object.freeze({
    "Health & Combat": "red",
    "Abilities & Status": "purple",
    "Position & Movement": "cyan",
    Rotation: "blue",
    "Ability Entity": "purple",
    "Custom Variables": "amber",
    Match: "neutral",
    Basic: "neutral",
    Other: "neutral",
});

export const ACTION_HEAD_TONES = Object.freeze({
    movement: "green",
    rotation: "blue",
    ability: "purple",
    variable: "amber",
});

export function variableCategoryTone(category) {
    return VARIABLE_CATEGORY_TONES[category] ?? "neutral";
}

export function variableCategoryLabel(category) {
    return VARIABLE_CATEGORY_LABELS[category] ?? { chip: category, title: category };
}

export function matchCountLabel(count) {
    return `${count} ${count === 1 ? "match" : "matches"}`;
}

const ACTION_HEAD_GROUPS = Object.freeze([
    { head: "movement", title: "Movement" },
    { head: "rotation", title: "Rotation" },
    { head: "ability", title: "Abilities", hint: "your loadout" },
    { head: "variable", title: "Variables" },
]);

const ACTION_DESCRIPTIONS = Object.freeze({
    movement: "Move toward a target or point",
    rotation: "Turn toward a target or angle",
    variable: "Set, add or subtract",
});

// Rows are named by their group now, so the "Ability: / Movement: / Rotate: / Variable:" prefixes go.
export function actionPickerLabel(action) {
    return String(action?.label ?? "")
        .replace(/^(Ability|Movement|Rotate|Variable):\s*/i, "")
        .replace(/^Modify Custom Variable$/i, "Modify custom variable")
        .replace(/^Face Target$/i, "Face target");
}

export function actionPickerDescription(action) {
    return ACTION_DESCRIPTIONS[action?.head] ?? "";
}

// Groups actions in display order; the flat order is what keyboard navigation walks.
export function groupedActionPickerOptions(actions) {
    return ACTION_HEAD_GROUPS
        .map((group) => ({ ...group, options: actions.filter((action) => action.head === group.head) }))
        .filter((group) => group.options.length > 0);
}
