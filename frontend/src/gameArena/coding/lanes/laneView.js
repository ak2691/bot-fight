// Presentation helpers for the lanes list: lane names and colours, lookups by id (cards at any follow-up depth), and
// the sentences a switch and its conditions read as. Wording comes from laneSentence.js; the caller passes the lookups
// (conditionSummaryLookups), so this module stays free of JSX and easy to test.
import { ACTION_HEADS } from "../../../../../shared/engine/botlogic/code/contracts/BotLogicContracts.js";
import { SHARED_SCOPE, locateCard } from "./laneEdits.js";
import { laneConditionSentence } from "./laneSentence.js";

/** The set (a mode, or the shared set) a scope names. */
export function scopeSetOf(configuration, scope) {
    return scope === SHARED_SCOPE ? configuration.shared : (configuration.modes ?? []).find((mode) => mode.id === scope);
}

/** A card by id, at any follow-up depth, in one scope. Null when it is not there. */
export function findCard(configuration, scope, cardId) {
    const set = scopeSetOf(configuration, scope);
    return set ? locateCard(set, cardId)?.card ?? null : null;
}

export function findSwitch(configuration, scope, switchId) {
    return (scopeSetOf(configuration, scope)?.switches ?? []).find((entry) => entry.id === switchId) ?? null;
}

/** Where a card or switch id lives: its scope, and its lane for a card. Null when no such entry exists. */
export function locateEntry(configuration, id) {
    const scopes = [...(configuration.modes ?? []).map((mode) => mode.id), SHARED_SCOPE];
    for (const scope of scopes) {
        const set = scopeSetOf(configuration, scope);
        if ((set?.switches ?? []).some((entry) => entry.id === id)) return { scope, kind: "switch" };
        const located = set ? locateCard(set, id) : null;
        if (located) return { scope, kind: "card", lane: located.lane };
    }
    return null;
}

/**
 * The sections in the order the list shows them (`lane` is the section key; the data keys stay as they are). `rule` is
 * the one muted line under the label, and `tone` the label's colour. Movement holds Move and Face cards, Actions one
 * action at a time (combos indented under their parent), Variables every card that applies.
 */
export const LANE_SPECS = Object.freeze([
    { lane: "movement", title: "Movement", rule: "the top Move and the top Face card run", tone: "#3aa6c9" },
    { lane: "actions", title: "Actions", rule: "one at a time: the top card that can act", tone: "#f0a03c" },
    { lane: "variables", title: "Variables", rule: "every card that applies runs", tone: "#e58fc0" },
]);

/** The colour of a section, or the first section's when the key is unknown. */
export const laneToneOf = (lane) => LANE_SPECS.find((spec) => spec.lane === lane)?.tone ?? LANE_SPECS[0].tone;

/** The colour of an action kind: its tile, its live bar and its menu accent (not the section's colour). */
export const KIND_TONES = Object.freeze({
    [ACTION_HEADS.MOVEMENT]: "#3aa6c9",
    [ACTION_HEADS.ROTATION]: "#a78bfa",
    [ACTION_HEADS.ABILITY]: "#f0a03c",
    [ACTION_HEADS.DASH]: "#5dcaa5",
    [ACTION_HEADS.CANCEL]: "#e46a6a",
    [ACTION_HEADS.VARIABLE]: "#e58fc0",
});

/** The colour of an action head (see KIND_TONES), or the Movement colour when the head is unknown. */
export const kindToneOf = (head) => KIND_TONES[head] ?? LANE_SPECS[0].tone;

export const modeNameOf = (configuration, modeId) => (configuration.modes ?? []).find((mode) => mode.id === modeId)?.name ?? "Unknown mode";

/** One line per condition, read as a lanes sentence (laneSentence.js). Empty lists read "Always". */
export function conditionTexts(conditions, lookups) {
    return (conditions ?? []).map((condition) => laneConditionSentence(condition, lookups));
}
