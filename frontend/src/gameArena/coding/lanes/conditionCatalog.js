// The curated condition readings for lanes cards and switches: a short name, an icon, a group, and whether the value
// is a number or a yes/no. Pure (no JSX). A condition that matches no entry reads through laneSentence.js and gets
// the editor's fallback (Remove, plus comparator and number when it has a number).
//
// Every visible state variable (STATE_VARIABLES minus the picker's hidden ids) is the variable of at least one entry;
// the test in conditionCatalog.test.js checks that, and that every build() output is already normalized.
import { createExpressionCondition, normalizeConditions } from "../../../../../shared/engine/botlogic/code/BotCode.js";
import { BOT_CODE_SELECTABLES, SELECTABLE_TYPES, STATE_VARIABLE_BY_ID } from "../../../../../shared/engine/botlogic/code/contracts/BotLogicContracts.js";
import { ABILITY_TAGS, abilityDefinition } from "../../../../../shared/engine/loadout/BotLoadout.js";

export const BASE_RANGE_VARIABLE = "bot.selectedAbilityBaseRange";

/** Groups in the order the condition menu lists them. "variables" is filled by custom variables in the menu step. */
export const CONDITION_GROUPS = Object.freeze({
    me: Object.freeze({ id: "me", label: "Me", tone: "#3aa6c9" }),
    enemy: Object.freeze({ id: "enemy", label: "Enemy", tone: "#ff7166" }),
    ability: Object.freeze({ id: "ability", label: "Ability", tone: "#f0a03c" }),
    otherAbilities: Object.freeze({ id: "otherAbilities", label: "Other abilities", tone: "#d4a35a" }),
    objects: Object.freeze({ id: "objects", label: "Objects", tone: "#5dcaa5" }),
    match: Object.freeze({ id: "match", label: "Match", tone: "#8b98a5" }),
    variables: Object.freeze({ id: "variables", label: "Variables", tone: "#a78bfa" }),
});

export const COMPARATOR_SYMBOLS = Object.freeze({ lt: "<", lte: "≤", eq: "=", neq: "≠", gte: "≥", gt: ">" });

const TARGET_MODES_WITHOUT_BOT = new Set(["coordinates", "angle"]);
const MY = BOT_CODE_SELECTABLES.MY;
const OPPONENT = BOT_CODE_SELECTABLES.OPPONENT;

/**
 * One entry per curated reading. Fields: `key`, `group`, `icon` (a name from laneIcons.jsx), `name` (short, as the
 * tile shows it), `description` (one line, for the menu), `kind` ("number" or "boolean"), `variable` (the state
 * variable id), `selectable` (MY or OPPONENT for the left side; omitted when the variable has none), `pair`
 * ([from, to] for distance-like variables), `labels` ({ on, off } for booleans), `suffix` (after a number, e.g. "s"),
 * `scale` (stored value per shown unit; time in mode is stored in ms), `reading` (the right side may be the ability's
 * base range), `requiredTag` (only abilities with this tag can read it).
 */
const RAW_ENTRIES = Object.freeze([
    // Me
    { key: "me.hp", group: "me", icon: "heart", name: "HP", description: "my current HP", kind: "number", variable: "selectable.hp", selectable: MY },
    { key: "me.stamina", group: "me", icon: "bolt", name: "Stamina", description: "my stamina", kind: "number", variable: "bot.stamina", selectable: MY },
    { key: "me.moving", group: "me", icon: "run", name: "Moving", description: "I am moving", kind: "boolean", variable: "selectable.moving", selectable: MY, labels: { on: "moving", off: "still" } },
    { key: "me.sprinting", group: "me", icon: "run", name: "Sprinting", description: "I am sprinting", kind: "boolean", variable: "bot.sprinting", labels: { on: "sprinting", off: "not sprinting" } },
    { key: "me.turning", group: "me", icon: "turn", name: "Turning fast", description: "I am turning fast", kind: "boolean", variable: "bot.fastTurning", labels: { on: "turning fast", off: "not turning fast" } },
    { key: "me.edge", group: "me", icon: "edge", name: "Edge distance", description: "how close I am to the edge", kind: "number", variable: "selectable.edgeDistance", selectable: MY },
    { key: "me.timeInMode", group: "me", icon: "clock", name: "Time in mode", description: "seconds in this mode", kind: "number", variable: "bot.timeInModeMs", scale: 1000, suffix: "s" },
    // Enemy
    { key: "enemy.distance", group: "enemy", icon: "ruler", name: "Distance", description: "how far the enemy is", kind: "number", variable: "selectable.distance", pair: [MY, OPPONENT], reading: true },
    { key: "enemy.hp", group: "enemy", icon: "heartBroken", name: "Enemy HP", description: "the enemy's HP", kind: "number", variable: "selectable.hp", selectable: OPPONENT },
    { key: "enemy.hpChange", group: "enemy", icon: "trend", name: "HP change", description: "HP gained or lost in the last tick", kind: "number", variable: "selectable.hpNetChangeLastTick", selectable: OPPONENT },
    { key: "enemy.damage", group: "enemy", icon: "flame", name: "Damage taken", description: "damage taken in the last tick", kind: "number", variable: "selectable.damageTakenLastTick", selectable: OPPONENT },
    { key: "enemy.winding", group: "enemy", icon: "hourglass", name: "Winding up", description: "charging an ability", kind: "boolean", variable: "bot.anyAbilityPreparing", selectable: OPPONENT, labels: { on: "winding up", off: "not winding up" } },
    { key: "enemy.inView", group: "enemy", icon: "eye", name: "In view", description: "inside my facing arc", kind: "boolean", variable: "selectable.inView", pair: [MY, OPPONENT], labels: { on: "in view", off: "not in view" } },
    { key: "enemy.moving", group: "enemy", icon: "run", name: "Enemy moving", description: "the enemy moved last tick", kind: "boolean", variable: "selectable.moving", selectable: OPPONENT, labels: { on: "moving", off: "still" } },
    { key: "enemy.moveDirection", group: "enemy", icon: "compass", name: "Move direction", description: "heading of its last move, in degrees", kind: "number", variable: "selectable.movementDirection", selectable: OPPONENT, suffix: "°" },
    { key: "enemy.x", group: "enemy", icon: "crosshair", name: "Enemy X", description: "its horizontal position", kind: "number", variable: "selectable.x", selectable: OPPONENT },
    { key: "enemy.y", group: "enemy", icon: "crosshair", name: "Enemy Y", description: "its vertical position", kind: "number", variable: "selectable.y", selectable: OPPONENT },
    { key: "enemy.alive", group: "enemy", icon: "heart", name: "Enemy alive", description: "still in the fight", kind: "boolean", variable: "selectable.alive", selectable: OPPONENT, labels: { on: "alive", off: "dead" } },
    // Ability (the card's own ability; the menu names the group after it)
    { key: "ability.ready", group: "ability", icon: "clockPause", name: "Ready", description: "can be used now", kind: "boolean", variable: "bot.selectedAbilityReady", labels: { on: "ready", off: "not ready" } },
    { key: "ability.active", group: "ability", icon: "play", name: "Active", description: "its effect is running", kind: "boolean", variable: "bot.selectedAbilityActive", labels: { on: "active", off: "not active" } },
    { key: "ability.onCooldown", group: "ability", icon: "hourglass", name: "On cooldown", description: "can't be used yet", kind: "boolean", variable: "bot.selectedAbilityOnCooldown", labels: { on: "on cooldown", off: "not on cooldown" } },
    { key: "ability.activeMs", group: "ability", icon: "clock", name: "Active time", description: "seconds it has been active", kind: "number", variable: "bot.selectedAbilityActiveMs", suffix: "s" },
    { key: "ability.cooldownMs", group: "ability", icon: "clockPause", name: "Cooldown left", description: "seconds until it is ready", kind: "number", variable: "bot.selectedAbilityCooldownMs", suffix: "s" },
    { key: "ability.sinceHit", group: "ability", icon: "target", name: "Hit recently", description: "seconds since it hit", kind: "number", variable: "bot.selectedAbilitySinceHit", suffix: "s" },
    { key: "ability.charges", group: "ability", icon: "battery", name: "Charges", description: "charges stored", kind: "number", variable: "bot.selectedAbilityCharges", requiredTag: ABILITY_TAGS.CHARGES },
    { key: "ability.preparing", group: "ability", icon: "hourglass", name: "Winding up", description: "this ability is winding up", kind: "boolean", variable: "bot.selectedAbilityPreparing", labels: { on: "winding up", off: "not winding up" } },
    { key: "ability.prepMs", group: "ability", icon: "hourglass", name: "Wind-up left", description: "seconds left in the wind-up", kind: "number", variable: "bot.selectedAbilityPreparationMs", suffix: "s" },
    { key: "ability.range", group: "ability", icon: "ruler", name: "Ability range", description: "how far it reaches", kind: "number", variable: BASE_RANGE_VARIABLE },
    // Other abilities (status effects of the card's ability)
    { key: "other.statusActive", group: "otherAbilities", icon: "sparkle", name: "Has status", description: "its status effect is applied", kind: "boolean", variable: "bot.selectedStatusEffectActive", labels: { on: "has status", off: "no status" } },
    { key: "other.statusMs", group: "otherAbilities", icon: "clock", name: "Status time", description: "seconds left on the status effect", kind: "number", variable: "bot.selectedStatusEffectDurationMs", suffix: "s" },
    // Objects (ability entities such as traps and drones)
    { key: "object.count", group: "objects", icon: "hash", name: "Count", description: "how many of this object exist", kind: "number", variable: "selectable.count" },
    { key: "object.age", group: "objects", icon: "clock", name: "Age", description: "seconds since the object appeared", kind: "number", variable: "selectable.age", suffix: "s" },
    { key: "object.exists", group: "objects", icon: "check", name: "Exists", description: "at least one exists", kind: "boolean", variable: "selectable.exists", labels: { on: "exists", off: "none" } },
    // Match
    { key: "match.time", group: "match", icon: "clock", name: "Match time", description: "seconds since the match started", kind: "number", variable: "match.elapsedSeconds", suffix: "s" },
    { key: "match.zone", group: "match", icon: "zone", name: "Zone distance", description: "distance to the closing zone edge", kind: "number", variable: "selectable.dangerZoneEdgeDistance" },
]);

const CATALOG_BY_KEY = new Map(RAW_ENTRIES.map((entry) => [entry.key, entry]));

/**
 * The catalog. Each entry is its data plus two functions: `matches(condition)` (the condition reads as this entry)
 * and `build({ abilityId, loadout, selectableTypes })` (a normalized condition for it).
 */
export const CONDITION_CATALOG = Object.freeze(RAW_ENTRIES.map((entry) => Object.freeze({
    ...entry,
    matches: (condition) => entryMatches(entry, condition),
    build: (options) => buildCatalogCondition(entry.key, options),
})));

/** The entry with this key. Throws for an unknown key, which is a programming error, not player input. */
export function catalogEntry(key) {
    const entry = CATALOG_BY_KEY.get(key);
    if (!entry) throw new Error(`Unknown condition catalog key: ${key}`);
    return entry;
}

const baseId = (value) => String(value ?? "").split(":")[0];

function entryMatches(entry, condition) {
    if (condition.left !== entry.variable) return false;
    if (entry.pair) {
        return baseId(condition.selectable1) === entry.pair[0]
            && baseId(condition.selectable2) === entry.pair[1]
            && !TARGET_MODES_WITHOUT_BOT.has(condition.targetMode);
    }
    if (entry.selectable) return baseId(condition.leftSelectable) === entry.selectable;
    return true;
}

/** The catalog entry a condition reads as, or null when none of the curated entries describes it. */
export function catalogEntryFor(condition) {
    if (!condition || condition.type !== "expression") return null;
    return CONDITION_CATALOG.find((entry) => entry.matches(condition)) ?? null;
}

/**
 * A normalized condition for a catalog entry. `abilityId` is the card's ability (the ability readings and the range
 * reading use it); without one, `loadout` (the equipped ability ids) supplies the first. Output goes through the
 * engine's normalizer, so it is the same shape a saved brain holds.
 */
export function buildCatalogCondition(key, { abilityId = null, loadout = [], selectableTypes = SELECTABLE_TYPES } = {}) {
    const entry = catalogEntry(key);
    const variable = STATE_VARIABLE_BY_ID.get(entry.variable);
    const ability = abilityId ?? loadout?.[0] ?? null;
    let condition = createExpressionCondition(entry.variable, selectableTypes);
    if (entry.pair) condition = { ...condition, selectable1: entry.pair[0], selectable2: entry.pair[1] };
    if (entry.selectable) condition = { ...condition, leftSelectable: entry.selectable };
    if (entry.kind === "number") condition = { ...condition, comparator: "lte" };
    if (variable?.supportsAbility && ability != null) condition = { ...condition, ability };
    return normalizeConditions([condition], [], selectableTypes)[0];
}

/**
 * A normalized condition that reads a custom variable: "is yes" for a yes/no variable, "≤ its starting value" for a
 * number. The condition menu adds it; the inline editor changes it. Output goes through the engine's normalizer with
 * the brain's own variable list, so the variable's name and type resolve.
 */
export function buildVariableCondition(variable, { customVariables = [], selectableTypes = SELECTABLE_TYPES } = {}) {
    const raw = variable.valueType === "boolean"
        ? { type: "expression", left: variable.id, comparator: "eq", right: { type: "boolean", value: true } }
        : { type: "expression", left: variable.id, comparator: "lte", right: { type: "number", value: Number(variable.initialValue) || 0 } };
    return normalizeConditions([raw], customVariables, selectableTypes)[0];
}

/**
 * A custom variable as a catalog-shaped entry (key, group, icon, name, kind, labels), so the tile, the editor and the
 * menu read it the same way as a curated reading. Its key is the variable's id.
 */
export function customVariableEntry(variable) {
    const boolean = variable.valueType === "boolean";
    return Object.freeze({
        key: `var:${variable.id}`,
        group: "variables",
        icon: "braces",
        name: variable.name,
        description: boolean ? "yes or no" : "number",
        kind: boolean ? "boolean" : "number",
        variable: variable.id,
        labels: Object.freeze({ on: variable.name, off: `not ${variable.name}` }),
        custom: true,
    });
}

/** The custom-variable entry a condition reads as (its left side is one of the brain's variables), or null. */
export function customEntryFor(condition, customVariables = []) {
    if (!condition || condition.type !== "expression" || !String(condition.left ?? "").startsWith("custom.")) return null;
    const variable = customVariables.find((candidate) => candidate.id === condition.left);
    return variable ? customVariableEntry(variable) : null;
}

/** "Slash range" for the ability's base-range reading; "base range" when the card names no ability. */
export function readingLabel(right, abilityName = null) {
    if (right?.value === BASE_RANGE_VARIABLE) return abilityName ? `${abilityName} range` : "base range";
    return STATE_VARIABLE_BY_ID.get(right?.value)?.label ?? String(right?.value ?? "");
}

const capitalize = (text) => (text ? text[0].toUpperCase() + text.slice(1) : text);

/** A stored number as the editor and the tile show it: whole numbers plain, otherwise one decimal. */
export function formatShown(stored, entry) {
    const numeric = Number(stored) / (entry?.scale ?? 1);
    if (!Number.isFinite(numeric)) return "0";
    return Number.isInteger(numeric) ? String(numeric) : numeric.toFixed(1);
}

/** Typed text back to the stored number, or null when the text is not a number. */
export function storedFromShown(text, entry) {
    const shown = Number(String(text).trim());
    if (String(text).trim() === "" || !Number.isFinite(shown)) return null;
    return Math.round(shown * (entry?.scale ?? 1) * 10) / 10;
}

/**
 * What a condition tile shows: `{ entry, icon, name, value }`. Boolean readings name their state ("Ready", or "Not
 * ready" when off) and carry no value; number readings carry the comparator and the value in yellow ("≥ 120",
 * "≤ Slash range"). A condition with no entry gets `fallback` (its sentence) and no icon or value.
 */
export function conditionTile(condition, {
    fallback = "",
    abilityName = null,
    cardAbilityId = null,
    customVariables = [],
    abilityLabelOf = (id) => abilityDefinition(id)?.label ?? null,
} = {}) {
    const entry = catalogEntryFor(condition) ?? customEntryFor(condition, customVariables);
    if (!entry) return { entry: null, icon: null, name: fallback, value: null };
    // An ability reading for another ability in the loadout names that ability: "Fireball: Ready".
    const otherAbility = entry.group === "ability" && cardAbilityId != null && condition.ability != null && condition.ability !== cardAbilityId
        ? abilityLabelOf(condition.ability)
        : null;
    const named = (text) => (otherAbility ? `${otherAbility}: ${text}` : text);
    if (entry.kind === "boolean") {
        const on = condition.right?.value !== false;
        return { entry, icon: entry.icon, name: named(on ? entry.name : capitalize(entry.labels.off)), value: null };
    }
    const comparator = COMPARATOR_SYMBOLS[condition.comparator] ?? String(condition.comparator ?? "");
    const right = condition.right;
    const amount = right?.type === "variable"
        ? readingLabel(right, abilityName)
        : `${formatShown(right?.value, entry)}${entry.suffix ? ` ${entry.suffix}` : ""}`;
    return { entry, icon: entry.icon, name: named(entry.name), value: `${comparator} ${amount}` };
}

/**
 * The reading a number condition can switch to, for the editor's "Num | reading" toggle: the ability's base range,
 * on entries that take it and only for an ability card. Null when the toggle is not offered.
 */
export function readingOption(entry, abilityId, abilityName) {
    if (!entry?.reading || abilityId == null) return null;
    return { label: abilityName ? `${abilityName} range` : "base range", right: { type: "variable", value: BASE_RANGE_VARIABLE } };
}
