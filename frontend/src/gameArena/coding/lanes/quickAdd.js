// Quick add for lanes cards. Templates are generated, not stored: every action the loadout allows, with default
// settings, once with no condition and once with each common condition (distance within the ability's base range,
// my HP below 30%, an enemy winding up, the ability ready). Search matches each typed word as a prefix of a word in
// the card's sentence, so "slash range" finds "When distance to Opponent 1 ≤ Slash range → Use Slash".
import { createExpressionCondition } from "../../../../../shared/engine/botlogic/code/BotCode.js";
import { BOT_CODE_SELECTABLES, SELECTABLE_TYPES } from "../../../../../shared/engine/botlogic/code/contracts/BotLogicContracts.js";
import { BASE_BOT_HP } from "../../../../../shared/engine/modelPayloads/arenaConstants.js";
import { abilityBaseRange } from "../../../../../shared/engine/loadout/abilityBaseRange.js";
import { defaultActionEntry, sectionOfHead } from "./laneEdits.js";
import { laneActionSentence, laneConditionSentence, sentenceNames } from "./laneSentence.js";
import { abilityRangeCondition } from "./laneStarter.js";

export const QUICK_ADD_HP_SHARE = 0.3;

/** Extra words a template answers to, for the names players reach for that a sentence does not use. */
const KEYWORDS = Object.freeze({
    none: [],
    range: ["range", "distance", "close", "near", "reach"],
    ready: ["ready", "available", "cooldown"],
    hp: ["hp", "health", "low", "hurt"],
    "enemy-prep": ["enemy", "opponent", "casting", "prepare", "preparing"],
});

/**
 * Every template for the given action types (the loadout's, as actionTypesForLoadout returns them). `customVariables`
 * names the variables a variable card can set; without any, variable cards have no template. Returns the templates
 * in a stable order: per action, no condition first, then the conditions in KEYWORDS order.
 */
export function buildQuickAddTemplates(actionTypes, { customVariables = [], selectableTypes = SELECTABLE_TYPES } = {}) {
    const names = sentenceNames({
        customVariable: (id) => customVariables.find((variable) => variable.id === id)?.name ?? null,
    });
    const templates = [];
    for (const action of actionTypes) {
        if (!action || action.id === "none") continue;
        let entry;
        try {
            entry = defaultActionEntry(action.id, customVariables);
        } catch {
            continue; // a variable card needs a variable first
        }
        const sets = [{ key: "none", conditions: [] }];
        if (action.abilityId != null) {
            if (abilityBaseRange(action.abilityId) != null) {
                sets.push({ key: "range", conditions: [abilityRangeCondition(action.abilityId)] });
            }
            sets.push({ key: "ready", conditions: [readyCondition(action.abilityId, selectableTypes)] });
        }
        sets.push({ key: "hp", conditions: [hpCondition(selectableTypes)] });
        sets.push({ key: "enemy-prep", conditions: [enemyPreparingCondition(selectableTypes)] });
        for (const set of sets) {
            templates.push(templateFor(action, entry, set, names));
        }
    }
    return templates;
}

function templateFor(action, entry, set, names) {
    // Inside a sentence the condition reads in lower case ("When distance to Opponent 1"), but "HP" keeps its capitals.
    const parts = set.conditions.map((condition) => lowerLeadingWord(laneConditionSentence(condition, names)));
    const act = laneActionSentence(entry, names);
    const sentence = parts.length ? `When ${parts.join(" and ")} → ${act}` : `Always → ${act}`;
    const keywords = KEYWORDS[set.key] ?? [];
    return Object.freeze({
        id: `${action.id}:${set.key}`,
        actionId: action.id,
        lane: sectionOfHead(action.head),
        conditions: Object.freeze(set.conditions),
        sentence,
        words: Object.freeze(wordsOf(`${sentence} ${keywords.join(" ")}`)),
    });
}

/** "Distance to X" becomes "distance to X"; "HP (Opponent 1)" and "My HP" keep their capitals (a second capital or a title word). */
function lowerLeadingWord(text) {
    const [first = "", second = ""] = String(text);
    return first && /[a-z]/.test(second) ? first.toLowerCase() + text.slice(1) : text;
}

function wordsOf(text) {
    return String(text).toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
}

/** The ability's readiness, as a fresh condition (the picker's own defaults: My Bot, ready = true). */
function readyCondition(abilityId, selectableTypes) {
    return { ...createExpressionCondition("bot.selectedAbilityReady", selectableTypes), ability: abilityId };
}

/** My HP below 30% of full health. */
function hpCondition(selectableTypes) {
    return {
        ...createExpressionCondition("selectable.hp", selectableTypes),
        leftSelectable: BOT_CODE_SELECTABLES.MY,
        comparator: "lt",
        right: { type: "number", value: Math.round(BASE_BOT_HP * QUICK_ADD_HP_SHARE) },
    };
}

/** The opponent has an ability winding up. */
function enemyPreparingCondition(selectableTypes) {
    return {
        ...createExpressionCondition("bot.anyAbilityPreparing", selectableTypes),
        leftSelectable: BOT_CODE_SELECTABLES.OPPONENT,
        comparator: "eq",
        right: { type: "boolean", value: true },
    };
}

/**
 * The templates that match `query`. Every typed word must start a word of the sentence (or of its keywords). An
 * optional lane keeps only that lane's templates. The first `limit` matches come back, in template order.
 */
export function searchQuickAdd(templates, query, { lane = null, limit = 40 } = {}) {
    const tokens = wordsOf(query ?? "");
    const matches = [];
    for (const template of templates) {
        if (lane && template.lane !== lane) continue;
        if (tokens.every((token) => template.words.some((word) => word.startsWith(token)))) matches.push(template);
        if (matches.length >= limit) break;
    }
    return matches;
}
