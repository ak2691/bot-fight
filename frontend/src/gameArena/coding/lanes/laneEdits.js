// Pure editing operations for lanes brains (docs/LANES.md). Each op returns the next brain, normalized by the engine's
// lanes normalizer, or throws LaneEditError. A refused edit leaves the brain as it was, so the caller keeps its undo state.
// The UI calls these and hands the result to the workspace's existing history (updateActiveConfiguration).
// Cards and follow-ups are addressed by id at any depth: a follow-up lives in its parent's `followUps` list.
// A "lane" in this file is a section of a mode (Movement, Actions, Variables); the name is kept from the list's first version.
import {
    createExpressionCondition,
    defaultSelectableForVariable,
    normalizeAbilityStrategyConfiguration,
} from "../../../../../shared/engine/botlogic/code/BotCode.js";
import { ACTION_BY_ID, ACTION_HEADS, BOT_CODE_SELECTABLES } from "../../../../../shared/engine/botlogic/code/contracts/BotLogicContracts.js";
import {
    BOT_LOGIC_LANES_VERSION,
    LANE_SECTIONS,
    MAX_FOLLOW_UP_DEPTH,
    MAX_LANE_CARDS_AND_SWITCHES,
    MAX_LANE_CONDITIONS_PER_ENTRY,
    MAX_LANE_MODE_NAME_LENGTH,
    MAX_LANE_MODES,
    MAX_TOTAL_CONDITIONS,
} from "../../../../../shared/engine/botlogic/code/configuration/constants.js";
import { createEditorNodeId } from "../../../../../shared/engine/botlogic/code/configuration/identifiers.js";
import { countLaneEntries } from "../../../../../shared/engine/botlogic/code/configuration/configurationMetrics.js";
import { validateAbilityStrategyConfiguration } from "../../botlogic/code/validateBrain.js";

import { attachedFaceAimFields, defaultAimFields } from "./aimDefaults.js";

export const SHARED_SCOPE = "shared";
export const TIME_IN_MODE_VARIABLE = "bot.timeInModeMs";
const MAX_AFTER_SECONDS = 99;
/** Attached movement: the card key and the action category each kind must hold. */
export const ATTACHED_KINDS = Object.freeze({
    move: ACTION_HEADS.MOVEMENT,
    face: ACTION_HEADS.ROTATION,
});
/** Heads a follow-up may hold: ability, dash or cancel (a cancel follow-up holds no follow-ups of its own). */
const FOLLOW_UP_ACTION_HEADS = Object.freeze([ACTION_HEADS.ABILITY, ACTION_HEADS.DASH, ACTION_HEADS.CANCEL]);
/** Heads that may hold follow-ups (and so may only be the action of a card that holds them, never a plain one). */
export const FOLLOW_UP_HEADS = Object.freeze([ACTION_HEADS.ABILITY, ACTION_HEADS.DASH]);

export class LaneEditError extends Error {
    constructor(message) {
        super(message);
        this.name = "LaneEditError";
    }
}

export const isLanesBrain = (configuration) => configuration?.version === BOT_LOGIC_LANES_VERSION;

/** The section an action's category belongs to: Movement (move, rotation), Actions (ability, dash, cancel), Variables. */
export function sectionOfHead(head) {
    if (head === ACTION_HEADS.MOVEMENT || head === ACTION_HEADS.ROTATION) return "movement";
    if (head === ACTION_HEADS.ABILITY || head === ACTION_HEADS.DASH || head === ACTION_HEADS.CANCEL) return "actions";
    if (head === ACTION_HEADS.VARIABLE) return "variables";
    return null;
}

/** The section a card's action belongs to, or a LaneEditError when it has none. */
export function laneForAction(actionId) {
    const section = sectionOfHead(ACTION_BY_ID.get(actionId)?.head);
    if (!LANE_SECTIONS.includes(section)) throw new LaneEditError("Pick an action for the card.");
    return section;
}

/** A new action entry with the defaults a fresh action gets in the tree editor. */
export function defaultActionEntry(actionId, customVariables = []) {
    const definition = ACTION_BY_ID.get(actionId);
    if (!definition) throw new LaneEditError("Pick an action for the card.");
    // A projectile ability that aims at an entity starts on Auto (aimDefaults.js); everything else has no aim fields.
    if (!definition.variableAction) return { action: actionId, selectable: BOT_CODE_SELECTABLES.OPPONENT, ...defaultAimFields(definition) };
    const variable = customVariables[0];
    if (!variable) throw new LaneEditError("Add a variable first, then add a variable card.");
    return {
        action: actionId,
        selectable: BOT_CODE_SELECTABLES.OPPONENT,
        variableId: variable.id,
        operation: "set",
        ...(variable.valueType === "boolean"
            ? { value: false }
            : { terms: [{ operator: "set", operand: { type: "number", value: 0 } }] }),
    };
}

/** Where a card or a switch sits, by id: `{ kind: "card", id }` (at any follow-up depth) or `{ kind: "switch", id }`. */
export const cardLocator = (id) => ({ kind: "card", id });
export const switchLocator = (id) => ({ kind: "switch", id });

// ---- Plumbing ----------------------------------------------------------------------------------

/** The set (a mode, or the shared set) a scope names. Throws when a mode no longer exists. */
export function scopeSet(configuration, scope) {
    if (scope === SHARED_SCOPE) return configuration.shared ?? {};
    const mode = (configuration.modes ?? []).find((candidate) => candidate.id === scope);
    if (!mode) throw new LaneEditError("That mode no longer exists.");
    return mode;
}

function withSet(configuration, scope, update) {
    if (scope === SHARED_SCOPE) return { ...configuration, shared: update(configuration.shared ?? {}) };
    scopeSet(configuration, scope);
    return { ...configuration, modes: configuration.modes.map((mode) => (mode.id === scope ? update(mode) : mode)) };
}

function errorsOf(configuration) {
    return validateAbilityStrategyConfiguration(configuration).errors;
}

/**
 * Normalizes the edited brain, enforces the lanes limits, and refuses an edit that adds a validation error the
 * brain did not already have.
 */
function commit(before, after) {
    const next = normalizeAbilityStrategyConfiguration(after);
    const counts = countLaneEntries(next);
    if (counts.modes > MAX_LANE_MODES) throw new LaneEditError(`A bot has at most ${MAX_LANE_MODES} modes.`);
    if (counts.cards + counts.switches > MAX_LANE_CARDS_AND_SWITCHES) {
        throw new LaneEditError(`A bot has at most ${MAX_LANE_CARDS_AND_SWITCHES} cards and switches.`);
    }
    if (counts.conditions > MAX_TOTAL_CONDITIONS) throw new LaneEditError(`A bot has at most ${MAX_TOTAL_CONDITIONS} conditions.`);
    const known = new Set(errorsOf(before));
    const fresh = errorsOf(next).filter((error) => !known.has(error));
    if (fresh.length) throw new LaneEditError(fresh[0]);
    return next;
}

/** Finds a card by id in one list, descending into follow-ups. Returns where it sits, or null. */
function locateInList(cards, cardId, lane, parentId, depth) {
    for (let index = 0; index < cards.length; index += 1) {
        const card = cards[index];
        if (card.id === cardId) return { card, lane, parentId, depth, index, siblings: cards };
        const found = locateInList(Array.isArray(card.followUps) ? card.followUps : [], cardId, lane, card.id, depth + 1);
        if (found) return found;
    }
    return null;
}

/**
 * Where a card sits in one set: `{ card, lane, parentId, depth, index, siblings, top }`. `lane` is the card's section,
 * `parentId` the id of the card it follows (null at the top of a section), `depth` 0 for a top-level card, and
 * `siblings` the list holding it.
 */
export function locateCard(set, cardId) {
    for (const lane of LANE_SECTIONS) {
        const found = locateInList(Array.isArray(set?.[lane]) ? set[lane] : [], cardId, lane, null, 0);
        if (found) return { ...found, top: found.parentId === null };
    }
    return null;
}

/** Applies `edit(siblings, index)` to the list that holds a card (a section, or a parent's follow-ups). */
function editCardList(cards, cardId, edit) {
    const index = cards.findIndex((card) => card.id === cardId);
    if (index >= 0) return { cards: edit(cards, index), found: true };
    for (let position = 0; position < cards.length; position += 1) {
        const followUps = cards[position].followUps;
        if (!Array.isArray(followUps) || followUps.length === 0) continue;
        const result = editCardList(followUps, cardId, edit);
        if (result.found) {
            const next = [...cards];
            next[position] = { ...cards[position], followUps: result.cards };
            return { cards: next, found: true };
        }
    }
    return { cards, found: false };
}

/** The set with the card's list rebuilt by `edit`. A card that is not there is refused, not guessed. */
function editSetCards(set, cardId, edit) {
    for (const lane of LANE_SECTIONS) {
        const cards = set?.[lane];
        if (!Array.isArray(cards)) continue;
        const result = editCardList(cards, cardId, edit);
        if (result.found) return { ...set, [lane]: result.cards };
    }
    throw new LaneEditError("That card was removed.");
}

/** Applies `update(entry)` to one card (any depth) or switch. `update` returns the new entry, or null to remove it. */
function updateEntry(configuration, scope, locator, update) {
    return withSet(configuration, scope, (set) => {
        if (locator.kind === "switch") {
            const switches = set.switches ?? [];
            if (!switches.some((entry) => entry.id === locator.id)) throw new LaneEditError("That switch was removed.");
            return {
                ...set,
                switches: switches.flatMap((entry) => {
                    if (entry.id !== locator.id) return [entry];
                    const next = update(entry);
                    return next ? [next] : [];
                }),
            };
        }
        return editSetCards(set, locator.id, (cards, index) => {
            const next = update(cards[index]);
            const copy = [...cards];
            if (next) copy.splice(index, 1, next);
            else copy.splice(index, 1);
            return copy;
        });
    });
}

// ---- Cards -------------------------------------------------------------------------------------

function newCard(actionId, customVariables, conditions) {
    return {
        id: createEditorNodeId("card"),
        conditions: conditions.slice(0, MAX_LANE_CONDITIONS_PER_ENTRY),
        action: defaultActionEntry(actionId, customVariables),
    };
}

/** Adds a card to the scope's section for the action, after the section's last card. Returns the brain and the card id. */
export function addCard(configuration, scope, actionId, customVariables = [], conditions = []) {
    const section = laneForAction(actionId);
    const card = newCard(actionId, customVariables, conditions);
    const after = withSet(configuration, scope, (set) => ({
        ...set,
        [section]: [...(set[section] ?? []), card],
    }));
    return { configuration: commit(configuration, after), cardId: card.id };
}

/**
 * Adds a follow-up under a card: an ability or dash card, at most MAX_FOLLOW_UP_DEPTH levels below its top-level card.
 * The follow-up is an ability, dash or cancel action. Returns the brain and the follow-up's id.
 */
export function addFollowUp(configuration, scope, parentId, actionId, customVariables = [], conditions = []) {
    const located = locateCard(scopeSet(configuration, scope), parentId);
    if (!located) throw new LaneEditError("That card was removed.");
    const head = ACTION_BY_ID.get(located.card.action?.action)?.head;
    if (!FOLLOW_UP_HEADS.includes(head)) {
        throw new LaneEditError("Only ability and dash cards can have follow-ups.");
    }
    if (!FOLLOW_UP_ACTION_HEADS.includes(ACTION_BY_ID.get(actionId)?.head)) {
        throw new LaneEditError("A follow-up is an ability, dash or cancel action.");
    }
    if (located.depth + 1 > MAX_FOLLOW_UP_DEPTH) {
        throw new LaneEditError(`Follow-ups go at most ${MAX_FOLLOW_UP_DEPTH} levels deep.`);
    }
    const follow = newCard(actionId, customVariables, conditions);
    const after = withSet(configuration, scope, (set) => editSetCards(set, parentId, (cards, index) => {
        const copy = [...cards];
        copy[index] = { ...cards[index], followUps: [...(cards[index].followUps ?? []), follow] };
        return copy;
    }));
    return { configuration: commit(configuration, after), cardId: follow.id };
}

/** Moves a card to a new position among its siblings (0 is the top of its list). The id does not change. */
export function moveCard(configuration, scope, cardId, toIndex) {
    const after = withSet(configuration, scope, (set) => editSetCards(set, cardId, (cards, from) => {
        const target = Math.max(0, Math.min(cards.length - 1, toIndex));
        if (target === from) return cards;
        const moved = [...cards];
        const [card] = moved.splice(from, 1);
        moved.splice(target, 0, card);
        return moved;
    }));
    return commit(configuration, after);
}

/** A copy of a card with fresh ids for it and every follow-up under it. */
function copyWithFreshIds(card) {
    const copy = structuredClone(card);
    const renew = (item) => {
        item.id = createEditorNodeId("card");
        (item.followUps ?? []).forEach(renew);
        return item;
    };
    return renew(copy);
}

/** A copy of the card (and its follow-ups, with new ids), placed right after the original. Returns the brain and the copy's id. */
export function duplicateCard(configuration, scope, cardId) {
    let copyId = null;
    const after = withSet(configuration, scope, (set) => editSetCards(set, cardId, (cards, index) => {
        const copy = copyWithFreshIds(cards[index]);
        copyId = copy.id;
        const next = [...cards];
        next.splice(index + 1, 0, copy);
        return next;
    }));
    return { configuration: commit(configuration, after), cardId: copyId };
}

/**
 * Deletes a card. A top-level card goes with its follow-ups. A follow-up goes alone: its own follow-ups move up into
 * its place, in the same order, under the same parent.
 */
export function deleteCard(configuration, scope, cardId) {
    const located = locateCard(scopeSet(configuration, scope), cardId);
    if (!located) throw new LaneEditError("That card was removed.");
    const after = withSet(configuration, scope, (set) => editSetCards(set, cardId, (cards, index) => {
        const kept = located.top ? [] : (cards[index].followUps ?? []);
        return [...cards.slice(0, index), ...kept, ...cards.slice(index + 1)];
    }));
    return commit(configuration, after);
}

/** Switches a card off (`enabled: false`: it stays in place and never runs) or back on (the key is removed). */
export function toggleCard(configuration, scope, cardId) {
    return commit(configuration, updateEntry(configuration, scope, cardLocator(cardId), (card) => {
        if (card.enabled !== false) return { ...card, enabled: false };
        const { enabled: _enabled, ...rest } = card;
        return rest;
    }));
}

/**
 * Replaces a card's action. A top-level card keeps its section, so its new action must belong to that section. A
 * follow-up takes an ability, dash or cancel action. Changing to a cancel action deletes the card's follow-ups and its
 * attached movement; changing to a dash action drops the attached movement (only an ability card carries it).
 */
export function setCardAction(configuration, scope, cardId, action) {
    laneForAction(action?.action);
    return replaceCardAction(configuration, scope, cardId, action.action, action, (card) => ({
        conditions: card.conditions ?? [],
        dropped: 0,
    })).configuration;
}

/** The card with a new action, keeping only the follow-ups and attached movement that still apply (see changeCardAction). */
function cardWithAction(card, head, action) {
    const { followUps: _followUps, move: _move, face: _face, ...rest } = card;
    const keptFollowUps = head === ACTION_HEADS.CANCEL ? [] : (card.followUps ?? []);
    const attached = head === ACTION_HEADS.ABILITY
        ? { ...(card.move ? { move: card.move } : {}), ...(card.face ? { face: card.face } : {}) }
        : {};
    return {
        ...rest,
        action,
        ...(keptFollowUps.length ? { followUps: keptFollowUps } : {}),
        ...attached,
    };
}

/**
 * Shared by setCardAction and changeCardAction: the same refusals and the same follow-up and attached-movement rules.
 * `conditionsOf(card)` gives the card's conditions after the change; `dropped` counts the readings it could not keep.
 */
function replaceCardAction(configuration, scope, cardId, actionId, action, conditionsOf) {
    const located = locateCard(scopeSet(configuration, scope), cardId);
    if (!located) throw new LaneEditError("That card was removed.");
    const hasFollowUps = (located.card.followUps ?? []).length > 0;
    if (!actionFitsCard(actionId, { topLevel: located.top, lane: located.lane, hasFollowUps })) {
        if (located.top && sectionOfHead(ACTION_BY_ID.get(actionId)?.head) !== located.lane) throw new LaneEditError("That action belongs to another section.");
        if (!located.top && !FOLLOW_UP_ACTION_HEADS.includes(ACTION_BY_ID.get(actionId)?.head)) throw new LaneEditError("A follow-up is an ability, dash or cancel action.");
        throw new LaneEditError("Only ability and dash actions can keep follow-ups. Remove the follow-ups first.");
    }
    const head = ACTION_BY_ID.get(actionId)?.head;
    const { conditions, dropped } = conditionsOf(located.card);
    const after = updateEntry(configuration, scope, cardLocator(cardId), (card) => ({
        ...cardWithAction(card, head, action),
        conditions,
    }));
    return { configuration: commit(configuration, after), droppedConditions: dropped };
}

/**
 * Whether an action can take the place of a card's action. A top-level card keeps its section, so the new action must
 * share it. A follow-up holds only ability, dash or cancel actions. A card with follow-ups keeps them only for an
 * ability or dash action; a cancel action drops them (replaceCardAction does that).
 */
export function actionFitsCard(actionId, { topLevel, lane, hasFollowUps = false }) {
    const definition = ACTION_BY_ID.get(actionId);
    if (!definition) return false;
    if (topLevel && sectionOfHead(definition.head) !== lane) return false;
    if (!topLevel && !FOLLOW_UP_ACTION_HEADS.includes(definition.head)) return false;
    if (hasFollowUps && !FOLLOW_UP_HEADS.includes(definition.head) && definition.head !== ACTION_HEADS.CANCEL) return false;
    return true;
}

/**
 * Replaces a card's action and keeps its conditions and follow-ups where they still apply. A condition that reads the
 * card's old ability (its ability readings) follows the new ability when the new action is an ability, and is dropped
 * otherwise; readings of the other loadout abilities stay. Attached movement stays only on an ability card. A cancel
 * action drops the follow-ups and the attached movement. Returns `{ configuration, droppedConditions }`.
 */
export function changeCardAction(configuration, scope, cardId, actionId, customVariables = []) {
    const oldAbility = (located) => ACTION_BY_ID.get(located.card.action?.action)?.abilityId ?? null;
    const newAbility = ACTION_BY_ID.get(actionId)?.abilityId ?? null;
    return replaceCardAction(configuration, scope, cardId, actionId, defaultActionEntry(actionId, customVariables), (card) => {
        // A condition that reads the old ability follows the new one when there is one, and is dropped otherwise.
        const previous = oldAbility({ card });
        let dropped = 0;
        const conditions = (card.conditions ?? []).flatMap((condition) => {
            if (condition.ability == null || condition.ability !== previous) return [condition];
            if (newAbility != null) return [{ ...condition, ability: newAbility }];
            dropped += 1;
            return [];
        });
        return { conditions, dropped };
    });
}

/**
 * Attaches a move (kind "move") or a rotation (kind "face") to an ability card: it runs while the ability winds up or
 * is active, in place of the Movement section's choice for that kind. Only ability cards carry it.
 */
export function setAttachedAction(configuration, scope, cardId, kind, actionId) {
    const wanted = ATTACHED_KINDS[kind];
    if (!wanted) throw new LaneEditError("Attached movement is a move or a face.");
    if (ACTION_BY_ID.get(actionId)?.head !== wanted) {
        throw new LaneEditError(kind === "move" ? "Pick a move action." : "Pick a face action.");
    }
    const located = locateCard(scopeSet(configuration, scope), cardId);
    if (!located) throw new LaneEditError("That card was removed.");
    if (ACTION_BY_ID.get(located.card.action?.action)?.head !== ACTION_HEADS.ABILITY) {
        throw new LaneEditError("Only ability cards can move or face while they run.");
    }
    // A Face attached to a projectile ability starts on Auto, leading with that ability (attachedFaceAimFields).
    const cardAbility = ACTION_BY_ID.get(located.card.action?.action)?.abilityId;
    const action = { ...defaultActionEntry(actionId), ...(kind === "face" ? attachedFaceAimFields(cardAbility) : {}) };
    return commit(configuration, updateEntry(configuration, scope, cardLocator(cardId), (card) => ({ ...card, [kind]: action })));
}

/**
 * Replaces an attached move's or face's action entry (the editor's fields and the Change menu). The kind must match
 * the entry's category, and the card must already carry that attached action.
 */
export function setAttachedEntry(configuration, scope, cardId, kind, entry) {
    const wanted = ATTACHED_KINDS[kind];
    if (!wanted) throw new LaneEditError("Attached movement is a move or a face.");
    if (ACTION_BY_ID.get(entry?.action)?.head !== wanted) {
        throw new LaneEditError(kind === "move" ? "Pick a move action." : "Pick a face action.");
    }
    const located = locateCard(scopeSet(configuration, scope), cardId);
    if (!located) throw new LaneEditError("That card was removed.");
    if (!located.card[kind]) throw new LaneEditError("That card has no attached movement.");
    return commit(configuration, updateEntry(configuration, scope, cardLocator(cardId), (card) => ({ ...card, [kind]: entry })));
}

/** Removes a card's attached move or face, so Movement decides that kind again. */
export function removeAttachedAction(configuration, scope, cardId, kind) {
    if (!ATTACHED_KINDS[kind]) throw new LaneEditError("Attached movement is a move or a face.");
    return commit(configuration, updateEntry(configuration, scope, cardLocator(cardId), (card) => {
        const { [kind]: _removed, ...rest } = card;
        return rest;
    }));
}

/**
 * Moves a top-level card between a mode and All modes (or between two scopes), to the end of its section. Same id.
 * Follow-ups stay with their parent, so they are refused here.
 */
export function moveCardToScope(configuration, fromScope, cardId, toScope) {
    if (fromScope === toScope) return configuration;
    const located = locateCard(scopeSet(configuration, fromScope), cardId);
    if (!located || !located.top) throw new LaneEditError("That card was removed.");
    const removed = updateEntry(configuration, fromScope, cardLocator(cardId), () => null);
    const after = withSet(removed, toScope, (set) => ({
        ...set,
        [located.lane]: [...(set[located.lane] ?? []), located.card],
    }));
    return commit(configuration, after);
}

// ---- Conditions (cards and switches) -----------------------------------------------------------

export function addCondition(configuration, scope, locator, condition) {
    return commit(configuration, updateEntry(configuration, scope, locator, (entry) => {
        if ((entry.conditions ?? []).length >= MAX_LANE_CONDITIONS_PER_ENTRY) {
            throw new LaneEditError(`A card or switch holds at most ${MAX_LANE_CONDITIONS_PER_ENTRY} conditions.`);
        }
        return { ...entry, conditions: [...(entry.conditions ?? []), condition] };
    }));
}

export function updateCondition(configuration, scope, locator, index, update) {
    return commit(configuration, updateEntry(configuration, scope, locator, (entry) => {
        if (!(entry.conditions ?? [])[index]) throw new LaneEditError("That condition was removed.");
        return {
            ...entry,
            conditions: entry.conditions.map((condition, position) => (position === index ? update(condition) : condition)),
        };
    }));
}

export function removeCondition(configuration, scope, locator, index) {
    return commit(configuration, updateEntry(configuration, scope, locator, (entry) => ({
        ...entry,
        conditions: (entry.conditions ?? []).filter((_, position) => position !== index),
    })));
}

/** The condition with a variable chosen for one side. Mirrors the tree editor's variable picks. */
export function conditionWithVariable(condition, operand, definition, selectableTypes) {
    if (!definition) return condition;
    if (operand === 2) {
        if (definition.valueType !== "number") return condition;
        return {
            ...condition,
            right: { type: "variable", value: definition.id },
            ...(definition.supportsSelectable ? { rightSelectable: defaultSelectableForVariable(definition, selectableTypes) } : {}),
        };
    }
    const replacement = createExpressionCondition(definition, selectableTypes);
    const keepRight = definition.valueType === "number" && ["number", "variable"].includes(condition.right?.type)
        ? condition.right
        : definition.valueType === "boolean" && condition.right?.type === "boolean" ? condition.right : replacement.right;
    return { ...replacement, right: keepRight };
}

// ---- Switches ----------------------------------------------------------------------------------

/** A new switch from the scope to `toModeId`. Returns the brain and the switch id. */
export function addSwitch(configuration, scope, toModeId, conditions = []) {
    const switchEntry = { id: createEditorNodeId("switch"), to: toModeId, conditions };
    const after = withSet(configuration, scope, (set) => ({ ...set, switches: [...(set.switches ?? []), switchEntry] }));
    return { configuration: commit(configuration, after), switchId: switchEntry.id };
}

export function setSwitchTarget(configuration, scope, switchId, toModeId) {
    return commit(configuration, updateEntry(configuration, scope, switchLocator(switchId), (entry) => ({ ...entry, to: toModeId })));
}

export function deleteSwitch(configuration, scope, switchId) {
    return commit(configuration, updateEntry(configuration, scope, switchLocator(switchId), () => null));
}

/**
 * The "after N s" shortcut: writes Time in mode >= N seconds (bot.timeInModeMs, in ms) into the switch, replacing
 * an earlier time condition of the same switch or adding one.
 */
export function setSwitchAfterSeconds(configuration, scope, switchId, seconds) {
    const whole = Math.round(Number(seconds));
    if (!Number.isFinite(whole) || whole < 1 || whole > MAX_AFTER_SECONDS) throw new LaneEditError(`Enter 1 to ${MAX_AFTER_SECONDS} seconds.`);
    const timeCondition = {
        ...createExpressionCondition(TIME_IN_MODE_VARIABLE),
        comparator: "gte",
        right: { type: "number", value: whole * 1000 },
    };
    return commit(configuration, updateEntry(configuration, scope, switchLocator(switchId), (entry) => {
        const conditions = entry.conditions ?? [];
        const index = conditions.findIndex((condition) => condition.left === TIME_IN_MODE_VARIABLE);
        if (index >= 0) return { ...entry, conditions: conditions.map((condition, position) => (position === index ? timeCondition : condition)) };
        if (conditions.length >= MAX_LANE_CONDITIONS_PER_ENTRY) throw new LaneEditError(`A switch holds at most ${MAX_LANE_CONDITIONS_PER_ENTRY} conditions.`);
        return { ...entry, conditions: [...conditions, timeCondition] };
    }));
}

// ---- Modes -------------------------------------------------------------------------------------

function cleanModeName(name, modes, exceptId = null) {
    const text = String(name ?? "").trim().replace(/\s+/g, " ");
    if (text.length < 1 || text.length > MAX_LANE_MODE_NAME_LENGTH) {
        throw new LaneEditError(`Mode names need 1 to ${MAX_LANE_MODE_NAME_LENGTH} characters.`);
    }
    if (modes.some((mode) => mode.id !== exceptId && mode.name.toLowerCase() === text.toLowerCase())) {
        throw new LaneEditError(`A mode named "${text}" already exists.`);
    }
    return text;
}

/** A new mode at the end, with no cards or switches. Returns the brain and the new mode id. */
export function addMode(configuration, name) {
    const modes = configuration.modes ?? [];
    if (modes.length >= MAX_LANE_MODES) throw new LaneEditError(`A bot has at most ${MAX_LANE_MODES} modes.`);
    const mode = { id: createEditorNodeId("mode"), name: cleanModeName(name, modes) };
    return { configuration: commit(configuration, { ...configuration, modes: [...modes, mode] }), modeId: mode.id };
}

export function renameMode(configuration, modeId, name) {
    const modes = configuration.modes ?? [];
    scopeSet(configuration, modeId);
    const clean = cleanModeName(name, modes, modeId);
    return commit(configuration, { ...configuration, modes: modes.map((mode) => (mode.id === modeId ? { ...mode, name: clean } : mode)) });
}

/** Moves a mode to a new position. The first mode is where a fight starts. */
export function moveMode(configuration, modeId, toIndex) {
    const modes = [...(configuration.modes ?? [])];
    const from = modes.findIndex((mode) => mode.id === modeId);
    if (from < 0) throw new LaneEditError("That mode no longer exists.");
    const target = Math.max(0, Math.min(modes.length - 1, toIndex));
    if (target === from) return configuration;
    const [mode] = modes.splice(from, 1);
    modes.splice(target, 0, mode);
    return commit(configuration, { ...configuration, modes });
}

/** Removes a mode with its cards and switches, and every switch (in any scope) that leads to it. */
export function deleteMode(configuration, modeId) {
    const modes = configuration.modes ?? [];
    if (!modes.some((mode) => mode.id === modeId)) throw new LaneEditError("That mode no longer exists.");
    if (modes.length <= 1) throw new LaneEditError("A bot needs at least one mode.");
    const dropSwitches = (set) => ({ ...set, switches: (set.switches ?? []).filter((entry) => entry.to !== modeId) });
    return commit(configuration, {
        ...configuration,
        modes: modes.filter((mode) => mode.id !== modeId).map(dropSwitches),
        shared: dropSwitches(configuration.shared ?? {}),
    });
}
