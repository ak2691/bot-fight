// Plain-language sentences for lanes cards. A condition reads "Distance to Opponent 1 ≤ Slash range", an action
// reads "Use Slash". Pure (no JSX), so the editor, quick add and the tests share one wording. Conditions without a
// sentence of their own fall back to the tree's summary (nodes/conditionSummary.js), which stays unchanged.
import {
    ACTION_BY_ID,
    BOT_CODE_SELECTABLES,
    SELECTABLE_TYPES,
    STATE_VARIABLE_BY_ID,
} from "../../../../../shared/engine/botlogic/code/contracts/BotLogicContracts.js";
import { abilityDefinition } from "../../../../../shared/engine/loadout/BotLoadout.js";
import { comparatorSymbol, describeCondition } from "../nodes/conditionSummary.js";
import { resolveSelectableTarget } from "../nodes/actionNodePresentation.js";

const MY = BOT_CODE_SELECTABLES.MY;
const OPPONENT = BOT_CODE_SELECTABLES.OPPONENT;
const BASE_RANGE_VARIABLE = "bot.selectedAbilityBaseRange";

/**
 * The names a sentence needs: `variable(id)`, `selectable(id)`, `ability(id)`, `customVariable(id)`. Defaults come
 * from the catalogue; a caller may pass its own lookups for any of them (the editor passes its condition lookups).
 */
export function sentenceNames(lookups = {}) {
    return {
        variable: lookups.variable ?? ((id) => STATE_VARIABLE_BY_ID.get(id) ?? null),
        selectable: lookups.selectable ?? ((id) => resolveSelectableTarget(id, SELECTABLE_TYPES).description),
        // The ability's own name first: a lookup that only knows the picker's labels can read "1" for an ability id.
        ability: (id) => abilityDefinition(id)?.label ?? lookups.ability?.(id) ?? `Ability ${id}`,
        customVariable: lookups.customVariable ?? (() => null),
    };
}

/** "When [sentence] and [sentence]", one sentence per condition. Empty lists read "Always". */
export function laneConditionSentence(condition, lookups = {}) {
    const names = sentenceNames(lookups);
    if (!condition || condition.type !== "expression") return describeCondition(condition, names);
    const special = specialSentence(condition, names);
    if (special) return special;
    // "My Bot" on the left is implied, so the fallback drops it: "HP < 40", not "HP (My Bot) < 40".
    const stripped = { ...condition };
    if (stripped.leftSelectable === MY) delete stripped.leftSelectable;
    if (stripped.rightSelectable === MY) delete stripped.rightSelectable;
    return describeCondition(stripped, names);
}

function specialSentence(condition, names) {
    const right = condition.right;
    switch (condition.left) {
        case "selectable.distance":
            return distanceSentence(condition, names);
        case "bot.selectedAbilityReady":
            return booleanSentence(condition, `${abilityLabel(condition, names)} ready`, `${abilityLabel(condition, names)} not ready`);
        case "bot.selectedAbilityPreparing":
            return booleanSentence(condition, `${abilityLabel(condition, names)} winding up`, `${abilityLabel(condition, names)} not winding up`);
        case "bot.anyAbilityPreparing": {
            const who = names.selectable(condition.leftSelectable ?? OPPONENT);
            return booleanSentence(condition, `${who} winding up`, `${who} not winding up`);
        }
        case "selectable.hp": {
            const comparator = comparatorSymbol(condition.comparator);
            if (condition.leftSelectable !== MY || !comparator || right?.type !== "number") return null;
            // HP reads as the stored number, the value the card really checks: "My HP < 68".
            return `My HP ${comparator} ${formatNumber(right.value)}`;
        }
        default:
            return null;
    }
}

function abilityLabel(condition, names) {
    return condition.ability != null ? names.ability(condition.ability) : "Ability";
}

function booleanSentence(condition, whenTrue, whenFalse) {
    if (condition.right?.type !== "boolean") return null;
    return condition.right.value ? whenTrue : whenFalse;
}

function distanceSentence(condition, names) {
    if (condition.targetMode === "coordinates" || condition.targetMode === "angle") return null;
    const comparator = comparatorSymbol(condition.comparator);
    const from = condition.selectable1;
    const to = condition.selectable2;
    if (!comparator || !to) return null;
    const subject = !from || from === MY
        ? `Distance to ${names.selectable(to)}`
        : `Distance from ${names.selectable(from)} to ${names.selectable(to)}`;
    const right = condition.right;
    let value = null;
    if (right?.type === "variable" && right.value === BASE_RANGE_VARIABLE) {
        value = condition.ability != null ? `${names.ability(condition.ability)} range` : "base range";
    } else if (right?.type === "number") {
        value = formatNumber(right.value);
    }
    return value == null ? null : `${subject} ${comparator} ${value}`;
}

function formatNumber(value) {
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) return "0";
    return Number.isInteger(numeric) ? String(numeric) : numeric.toFixed(1);
}

/** "Use Slash", "Walk", "Face Target", "Cancel wind-up", "Set Rage" (a variable card), from the action's catalogue entry. */
export function laneActionSentence(action, lookups = {}) {
    const names = sentenceNames(lookups);
    const definition = ACTION_BY_ID.get(action?.action);
    if (!definition) return "Pick an action";
    if (definition.abilityId != null) return `Use ${names.ability(definition.abilityId)}`;
    if (definition.variableAction) {
        const name = names.customVariable(action.variableId);
        return name ? `Set ${name}` : "Set a variable";
    }
    const plain = String(definition.label).replace(/^[^:]+:\s*/, "");
    return definition.head === "cancel" ? `Cancel ${plain.toLowerCase()}` : plain;
}
