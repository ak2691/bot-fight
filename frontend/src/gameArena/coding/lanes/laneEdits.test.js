import assert from "node:assert/strict";
import test from "node:test";
import { STATE_VARIABLE_BY_ID } from "../../../../../shared/engine/botlogic/code/contracts/BotLogicContracts.js";
import { validateAbilityStrategyConfiguration } from "../../botlogic/code/validateBrain.js";
import { createLanesStarter, STARTER_MODE_ID } from "./laneStarter.js";
import {
    addCard,
    addCondition,
    addFollowUp,
    addMode,
    addSwitch,
    cardLocator,
    conditionWithVariable,
    deleteCard,
    deleteMode,
    deleteSwitch,
    duplicateCard,
    LaneEditError,
    locateCard,
    moveCard,
    moveCardToScope,
    moveMode,
    removeCondition,
    renameMode,
    SHARED_SCOPE,
    setCardAction,
    setSwitchAfterSeconds,
    setSwitchTarget,
    toggleCard,
    updateCondition,
} from "./laneEdits.js";
import { buildCatalogCondition } from "./conditionCatalog.js";

const newCondition = (selectableTypes) => buildCatalogCondition("enemy.distance", { selectableTypes });


const base = () => createLanesStarter([1, 3]);
const cardIds = (configuration, scope, lane) => {
    const set = scope === SHARED_SCOPE ? configuration.shared : configuration.modes.find((mode) => mode.id === scope);
    return (set[lane] ?? []).map((card) => card.id);
};
const expectValid = (configuration) => assert.deepEqual(validateAbilityStrategyConfiguration(configuration).errors, []);

test("adding a card puts it in the lane of its action, at the end, with a fresh id", () => {
    const before = base();
    const { configuration, cardId } = addCard(before, STARTER_MODE_ID, 4, []);
    assert.deepEqual(cardIds(configuration, STARTER_MODE_ID, "actions").at(-1), cardId);
    assert.equal(configuration.modes[0].actions.at(-1).action.action, 4);
    assert.deepEqual(before, base(), "the brain passed in is not changed");
    expectValid(configuration);
});

test("a card with no lane (the none action) is refused", () => {
    assert.throws(() => addCard(base(), STARTER_MODE_ID, "none"), LaneEditError);
});

test("a variable card needs a variable first", () => {
    assert.throws(() => addCard(base(), STARTER_MODE_ID, "variable", []), /Add a variable first/);
});

test("moving a card changes its order but keeps its id", () => {
    const { configuration, cardId } = addCard(base(), STARTER_MODE_ID, 4);
    const ids = cardIds(configuration, STARTER_MODE_ID, "actions");
    const moved = moveCard(configuration, STARTER_MODE_ID, cardId, 0);
    assert.equal(cardIds(moved, STARTER_MODE_ID, "actions")[0], cardId);
    assert.deepEqual(cardIds(moved, STARTER_MODE_ID, "actions").slice(1), ids.filter((id) => id !== cardId));
    expectValid(moved);
});

test("duplicating a card gives a new id and places the copy after the original", () => {
    const starter = base();
    const original = starter.modes[0].actions[0].id;
    const { configuration, cardId } = duplicateCard(starter, STARTER_MODE_ID, original);
    const ids = cardIds(configuration, STARTER_MODE_ID, "actions");
    assert.equal(ids[0], original);
    assert.equal(ids[1], cardId);
    assert.notEqual(cardId, original);
    const copy = configuration.modes[0].actions[1];
    assert.deepEqual({ ...copy, id: original }, starter.modes[0].actions[0]);
    expectValid(configuration);
});

test("a switched-off card keeps its place and gets enabled false; switching it on removes the key", () => {
    const starter = base();
    const id = starter.modes[0].movement[0].id;
    const off = toggleCard(starter, STARTER_MODE_ID, id);
    assert.equal(off.modes[0].movement[0].enabled, false);
    assert.equal(off.modes[0].movement[0].id, id);
    const on = toggleCard(off, STARTER_MODE_ID, id);
    assert.equal("enabled" in on.modes[0].movement[0], false);
});

test("deleting a card removes only that card", () => {
    const starter = base();
    const id = starter.modes[0].actions[0].id;
    const next = deleteCard(starter, STARTER_MODE_ID, id);
    assert.deepEqual(cardIds(next, STARTER_MODE_ID, "actions"), ["card-ability-3"]);
});

test("a card moves between a mode and All modes with the same id", () => {
    const starter = base();
    const id = starter.modes[0].movement[0].id;
    const shared = moveCardToScope(starter, STARTER_MODE_ID, id, SHARED_SCOPE);
    assert.equal(cardIds(shared, STARTER_MODE_ID, "movement").includes(id), false);
    assert.deepEqual(cardIds(shared, SHARED_SCOPE, "movement"), [id]);
    const back = moveCardToScope(shared, SHARED_SCOPE, id, STARTER_MODE_ID);
    assert.ok(cardIds(back, STARTER_MODE_ID, "movement").includes(id));
    assert.deepEqual(cardIds(back, SHARED_SCOPE, "movement"), []);
    expectValid(shared);
});

test("a card action can only change within its section", () => {
    const starter = base();
    const id = starter.modes[0].actions[0].id;
    assert.throws(() => setCardAction(starter, STARTER_MODE_ID, id, { action: "move_walk", selectable: "opponent_1" }), /another section/);
    const next = setCardAction(starter, STARTER_MODE_ID, id, { action: 3, selectable: "opponent_1" });
    assert.equal(next.modes[0].actions[0].action.action, 3);
});

test("conditions can be added, changed and removed; a card holds at most six", () => {
    const starter = base();
    const id = starter.modes[0].actions[0].id;
    const locator = cardLocator(id);
    const withTwo = addCondition(starter, STARTER_MODE_ID, locator, newCondition());
    assert.equal(withTwo.modes[0].actions[0].conditions.length, 2);
    const changed = updateCondition(withTwo, STARTER_MODE_ID, locator, 1, (condition) => ({ ...condition, comparator: "gt" }));
    assert.equal(changed.modes[0].actions[0].conditions[1].comparator, "gt");
    const removed = removeCondition(changed, STARTER_MODE_ID, locator, 1);
    assert.equal(removed.modes[0].actions[0].conditions.length, 1);

    let full = starter;
    for (let index = 0; index < 5; index += 1) full = addCondition(full, STARTER_MODE_ID, locator, newCondition());
    assert.equal(full.modes[0].actions[0].conditions.length, 6);
    assert.throws(() => addCondition(full, STARTER_MODE_ID, locator, newCondition()), /at most 6 conditions/);
});

test("adding a mode appends it, and names must be 1 to 25 characters and unique", () => {
    const { configuration, modeId } = addMode(base(), "Punish");
    assert.equal(configuration.modes.at(-1).id, modeId);
    assert.equal(configuration.modes.at(-1).name, "Punish");
    assert.throws(() => addMode(configuration, "punish"), /already exists/);
    assert.throws(() => addMode(configuration, "   "), /1 to 25/);
    assert.throws(() => addMode(configuration, "x".repeat(26)), /1 to 25/);
    expectValid(configuration);
});

test("no more than eight modes", () => {
    let configuration = base();
    for (let index = 1; index < 8; index += 1) configuration = addMode(configuration, `Mode ${index}`).configuration;
    assert.equal(configuration.modes.length, 8);
    assert.throws(() => addMode(configuration, "Ninth"), /at most 8 modes/);
});

test("a mode can be renamed, reordered (the first mode starts the fight), and deleted", () => {
    const { configuration: two, modeId } = addMode(base(), "Punish");
    const renamed = renameMode(two, modeId, "Chase");
    assert.equal(renamed.modes[1].name, "Chase");
    const reordered = moveMode(renamed, modeId, 0);
    assert.equal(reordered.modes[0].id, modeId);
    const gone = deleteMode(reordered, modeId);
    assert.deepEqual(gone.modes.map((mode) => mode.id), [STARTER_MODE_ID]);
});

test("deleting a mode also removes the switches that lead to it, in every scope", () => {
    let configuration = base();
    const { configuration: withPunish, modeId } = addMode(configuration, "Punish");
    configuration = addSwitch(withPunish, STARTER_MODE_ID, modeId, []).configuration;
    configuration = addSwitch(configuration, SHARED_SCOPE, modeId, []).configuration;
    const next = deleteMode(configuration, modeId);
    assert.equal(next.modes[0].switches, undefined, "an empty switch list is left out");
    assert.equal(next.shared.switches, undefined);
    expectValid(next);
});

test("the last mode cannot be deleted", () => {
    assert.throws(() => deleteMode(base(), STARTER_MODE_ID), /at least one mode/);
});

test("switches: add, retarget, delete", () => {
    const { configuration: twoModes, modeId } = addMode(base(), "Punish");
    const { configuration, switchId } = addSwitch(twoModes, STARTER_MODE_ID, modeId, []);
    assert.equal(configuration.modes[0].switches[0].to, modeId);
    const { configuration: sharedSwitch } = addSwitch(configuration, SHARED_SCOPE, STARTER_MODE_ID, []);
    const retargeted = setSwitchTarget(configuration, STARTER_MODE_ID, switchId, STARTER_MODE_ID);
    assert.equal(retargeted.modes[0].switches[0].to, STARTER_MODE_ID);
    assert.equal(deleteSwitch(configuration, STARTER_MODE_ID, switchId).modes[0].switches, undefined);
    expectValid(sharedSwitch);
});

test("the after-N-seconds shortcut writes Time in mode, and replaces its earlier value", () => {
    const { configuration: twoModes, modeId } = addMode(base(), "Punish");
    const { configuration, switchId } = addSwitch(twoModes, STARTER_MODE_ID, modeId, []);
    const timed = setSwitchAfterSeconds(configuration, STARTER_MODE_ID, switchId, 5);
    const [condition] = timed.modes[0].switches[0].conditions;
    assert.equal(condition.left, "bot.timeInModeMs");
    assert.equal(condition.comparator, "gte");
    assert.deepEqual(condition.right, { type: "number", value: 5000 });
    const again = setSwitchAfterSeconds(timed, STARTER_MODE_ID, switchId, 2);
    assert.equal(again.modes[0].switches[0].conditions.length, 1);
    assert.equal(again.modes[0].switches[0].conditions[0].right.value, 2000);
    expectValid(again);
});

test("the after-N-seconds shortcut accepts 1 to 99 seconds only", () => {
    const { configuration: twoModes, modeId } = addMode(base(), "Punish");
    const { configuration, switchId } = addSwitch(twoModes, STARTER_MODE_ID, modeId, []);
    assert.throws(() => setSwitchAfterSeconds(configuration, STARTER_MODE_ID, switchId, 0), /1 to 99/);
    assert.throws(() => setSwitchAfterSeconds(configuration, STARTER_MODE_ID, switchId, 100), /1 to 99/);
});

test("a stale id (a card someone already removed) is refused, not guessed", () => {
    assert.throws(() => deleteCard(base(), STARTER_MODE_ID, "card-gone"), /was removed/);
});

test("a chosen variable replaces the left side and keeps a compatible right side", () => {
    const distance = STATE_VARIABLE_BY_ID.get("selectable.distance");
    const condition = conditionWithVariable(newCondition(), 1, distance, undefined);
    assert.equal(condition.type, "expression");
    assert.equal(condition.left, "selectable.distance");
    const number = STATE_VARIABLE_BY_ID.get("bot.selectedAbilityBaseRange");
    assert.equal(conditionWithVariable(condition, 2, number, undefined).right.type, "variable");
    assert.equal(conditionWithVariable(condition, 1, undefined, undefined), condition);
});

// ---- Editing an existing condition --------------------------------------------------------------

test("an existing condition's comparator and value can be edited, and it can be removed", () => {
    const starter = base();
    const id = starter.modes[0].actions[0].id;
    const locator = cardLocator(id);
    const edited = updateCondition(starter, STARTER_MODE_ID, locator, 0, (condition) => ({
        ...condition,
        comparator: "gte",
        right: { type: "number", value: 30 },
    }));
    const [changed] = edited.modes[0].actions[0].conditions;
    assert.equal(changed.comparator, "gte");
    assert.deepEqual(changed.right, { type: "number", value: 30 });
    expectValid(edited);
    const removed = removeCondition(edited, STARTER_MODE_ID, locator, 0);
    assert.deepEqual(removed.modes[0].actions[0].conditions, []);
});

test("editing a condition that is no longer there is refused", () => {
    const starter = base();
    const locator = cardLocator(starter.modes[0].actions[0].id);
    assert.throws(() => updateCondition(starter, STARTER_MODE_ID, locator, 5, (condition) => condition), /was removed/);
});

// ---- Follow-ups (combos) ----------------------------------------------------------------------

const cardAt = (configuration, cardId) => locateCard(configuration.modes[0], cardId)?.card ?? null;

test("a follow-up goes under an ability card, is an ability, dash or cancel action, and is one level below", () => {
    const starter = base();
    const parent = starter.modes[0].actions[0].id;
    const { configuration, cardId } = addFollowUp(starter, STARTER_MODE_ID, parent, 19);
    const located = locateCard(configuration.modes[0], cardId);
    assert.equal(located.parentId, parent);
    assert.equal(located.depth, 1);
    assert.equal(located.lane, "actions");
    assert.equal(configuration.modes[0].actions[0].followUps[0].action.action, 19);
    expectValid(configuration);
});

test("only ability and dash cards can take follow-ups, and a follow-up is never a move or a face", () => {
    const starter = base();
    const movement = starter.modes[0].movement[0].id;
    assert.throws(() => addFollowUp(starter, STARTER_MODE_ID, movement, 19), /Only ability and dash cards/);
    const parent = starter.modes[0].actions[0].id;
    assert.throws(() => addFollowUp(starter, STARTER_MODE_ID, parent, "move_walk"), /ability, dash or cancel/);
    const withCancel = addFollowUp(starter, STARTER_MODE_ID, parent, "cancel_windup").configuration;
    assert.equal(cardAt(withCancel, parent).followUps[0].action.action, "cancel_windup");
    expectValid(withCancel);
});

test("follow-ups stop at three levels below their top-level card", () => {
    let configuration = base();
    let parent = configuration.modes[0].actions[0].id;
    for (let level = 1; level <= 3; level += 1) {
        ({ configuration, cardId: parent } = addFollowUp(configuration, STARTER_MODE_ID, parent, 1));
    }
    assert.equal(locateCard(configuration.modes[0], parent).depth, 3);
    assert.throws(() => addFollowUp(configuration, STARTER_MODE_ID, parent, 1), /at most 3 levels/);
    expectValid(configuration);
});

test("deleting a follow-up moves its own follow-ups up into its place, under the same parent", () => {
    const starter = base();
    const parent = starter.modes[0].actions[0].id;
    const first = addFollowUp(starter, STARTER_MODE_ID, parent, 1);
    const second = addFollowUp(first.configuration, STARTER_MODE_ID, first.cardId, 1);
    const third = addFollowUp(second.configuration, STARTER_MODE_ID, parent, 19);
    const removed = deleteCard(third.configuration, STARTER_MODE_ID, first.cardId);
    assert.deepEqual(cardAt(removed, parent).followUps.map((follow) => follow.id), [second.cardId, third.cardId]);
    assert.equal(locateCard(removed.modes[0], second.cardId).depth, 1, "the moved follow-up is one level down, as before");
    expectValid(removed);
});

test("deleting a top-level card removes it and its follow-ups", () => {
    const starter = base();
    const parent = starter.modes[0].actions[0].id;
    const first = addFollowUp(starter, STARTER_MODE_ID, parent, 19);
    const removed = deleteCard(first.configuration, STARTER_MODE_ID, parent);
    assert.equal(locateCard(removed.modes[0], first.cardId), null);
    expectValid(removed);
});

test("follow-ups reorder among their siblings, and a follow-up can be switched off in place", () => {
    const starter = base();
    const parent = starter.modes[0].actions[0].id;
    const first = addFollowUp(starter, STARTER_MODE_ID, parent, 19);
    const second = addFollowUp(first.configuration, STARTER_MODE_ID, parent, 19);
    const moved = moveCard(second.configuration, STARTER_MODE_ID, second.cardId, 0);
    assert.deepEqual(cardAt(moved, parent).followUps.map((follow) => follow.id), [second.cardId, first.cardId]);
    const off = toggleCard(moved, STARTER_MODE_ID, first.cardId);
    assert.equal(cardAt(off, first.cardId).enabled, false);
    assert.equal(cardAt(off, first.cardId).id, first.cardId);
    expectValid(off);
});

test("a follow-up's conditions can be added, edited and removed like any card's", () => {
    const starter = base();
    const parent = starter.modes[0].actions[0].id;
    const { configuration, cardId } = addFollowUp(starter, STARTER_MODE_ID, parent, 19);
    const locator = cardLocator(cardId);
    const added = addCondition(configuration, STARTER_MODE_ID, locator, newCondition());
    const edited = updateCondition(added, STARTER_MODE_ID, locator, 0, (condition) => ({ ...condition, comparator: "lte", right: { type: "number", value: 80 } }));
    assert.deepEqual(cardAt(edited, cardId).conditions[0].right, { type: "number", value: 80 });
    assert.equal(cardAt(removeCondition(edited, STARTER_MODE_ID, locator, 0), cardId).conditions.length, 0);
    expectValid(edited);
});

test("duplicating a card copies its follow-ups with fresh ids at every depth", () => {
    const starter = base();
    const parent = starter.modes[0].actions[0].id;
    const first = addFollowUp(starter, STARTER_MODE_ID, parent, 1);
    const second = addFollowUp(first.configuration, STARTER_MODE_ID, first.cardId, 19);
    const { configuration, cardId } = duplicateCard(second.configuration, STARTER_MODE_ID, parent);
    const original = cardAt(configuration, parent);
    const copy = cardAt(configuration, cardId);
    assert.notEqual(cardId, parent);
    assert.equal(copy.followUps.length, 1);
    assert.notEqual(copy.followUps[0].id, first.cardId);
    assert.notEqual(copy.followUps[0].followUps[0].id, second.cardId);
    assert.deepEqual(copy.followUps[0].followUps[0].action, original.followUps[0].followUps[0].action);
    const ids = [...configuration.modes[0].actions, ...configuration.modes[0].movement]
        .flatMap(function collect(card) { return [card.id, ...(card.followUps ?? []).flatMap(collect)]; });
    assert.equal(new Set(ids).size, ids.length);
    expectValid(configuration);
});
