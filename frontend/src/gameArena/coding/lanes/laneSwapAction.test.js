import assert from "node:assert/strict";
import test from "node:test";
import { ACTION_BY_ID } from "../../../../../shared/engine/botlogic/code/contracts/BotLogicContracts.js";
import { abilityRangeCondition, createLanesStarter, STARTER_MODE_ID } from "./laneStarter.js";
import { actionFitsCard, addFollowUp, changeCardAction, LaneEditError, locateCard, setAttachedAction } from "./laneEdits.js";

const starter = () => createLanesStarter([1, 3]);
const cardOf = (configuration, id) => locateCard(configuration.modes[0], id)?.card;

test("a top-level card keeps its section; a follow-up takes ability, dash or cancel; follow-ups stay only on ability and dash", () => {
    assert.equal(actionFitsCard(1, { topLevel: true, lane: "actions" }), true);
    assert.equal(actionFitsCard("move_walk", { topLevel: true, lane: "actions" }), false);
    assert.equal(actionFitsCard("move_walk", { topLevel: true, lane: "movement" }), true);
    assert.equal(actionFitsCard("move_walk", { topLevel: false, lane: "actions" }), false, "a follow-up holds no move");
    assert.equal(actionFitsCard(19, { topLevel: false, lane: "actions" }), true);
    assert.equal(actionFitsCard("cancel_windup", { topLevel: false, lane: "actions", hasFollowUps: true }), true, "a cancel drops follow-ups");
    assert.equal(actionFitsCard("move_walk", { topLevel: true, lane: "movement", hasFollowUps: true }), false);
    assert.equal(actionFitsCard(3, { topLevel: false, lane: "actions", hasFollowUps: true }), true);
    assert.equal(actionFitsCard("nope", { topLevel: false, lane: "actions" }), false);
});

test("swapping an ability for another ability keeps its conditions, and its own ability reading follows the new ability", () => {
    const configuration = starter();
    assert.equal(configuration.modes[0].actions.length, 2, "the starter has an ability card per ability with a base range");
    const { configuration: next, droppedConditions } = changeCardAction(configuration, STARTER_MODE_ID, "card-ability-1", 3);
    const card = cardOf(next, "card-ability-1");
    assert.equal(card.action.action, 3);
    assert.equal(card.conditions.length, 1, "the condition is kept");
    assert.equal(card.conditions[0].ability, 3, "it reads the new ability's range");
    assert.equal(droppedConditions, 0);
});

test("a top-level card cannot take an action from another section", () => {
    assert.throws(
        () => changeCardAction(starter(), STARTER_MODE_ID, "card-ability-1", "move_walk"),
        (error) => error instanceof LaneEditError && /another section/.test(error.message),
    );
});

test("a follow-up that has follow-ups of its own cannot become a plain action, and nothing is dropped silently", () => {
    const first = addFollowUp(starter(), STARTER_MODE_ID, "card-ability-1", 3, [], [abilityRangeCondition(3)]);
    const second = addFollowUp(first.configuration, STARTER_MODE_ID, first.cardId, 1);
    assert.throws(
        () => changeCardAction(second.configuration, STARTER_MODE_ID, first.cardId, "move_walk"),
        (error) => error instanceof LaneEditError && /ability, dash or cancel/.test(error.message),
    );
});

test("a follow-up can change to a cancel action; its own ability readings are dropped and counted", () => {
    const added = addFollowUp(starter(), STARTER_MODE_ID, "card-ability-1", 3, [], [abilityRangeCondition(3)]);
    const { configuration, droppedConditions } = changeCardAction(added.configuration, STARTER_MODE_ID, added.cardId, "cancel_windup");
    const follow = cardOf(configuration, added.cardId);
    assert.equal(follow.action.action, "cancel_windup");
    assert.deepEqual(follow.conditions, []);
    assert.equal(droppedConditions, 1);
});

test("a change to a cancel action deletes the card's follow-ups and its attached movement", () => {
    let configuration = setAttachedAction(starter(), STARTER_MODE_ID, "card-ability-1", "move", "move_walk");
    configuration = addFollowUp(configuration, STARTER_MODE_ID, "card-ability-1", 19).configuration;
    const { configuration: next } = changeCardAction(configuration, STARTER_MODE_ID, "card-ability-1", "cancel_windup");
    const card = cardOf(next, "card-ability-1");
    assert.equal(card.action.action, "cancel_windup");
    assert.equal("followUps" in card, false);
    assert.equal("move" in card, false);
});

test("a change to a dash action drops the card's attached movement; an ability swap keeps it", () => {
    const attached = setAttachedAction(starter(), STARTER_MODE_ID, "card-ability-1", "move", "move_walk");
    const toDash = changeCardAction(attached, STARTER_MODE_ID, "card-ability-1", 19).configuration;
    assert.equal("move" in cardOf(toDash, "card-ability-1"), false, "a dash card cannot carry a move");
    const toAbility = changeCardAction(attached, STARTER_MODE_ID, "card-ability-1", 3).configuration;
    assert.equal(cardOf(toAbility, "card-ability-1").move.action, "move_walk", "an ability card keeps its move");
});

test("a swap keeps the card's position and id", () => {
    const { configuration } = changeCardAction(starter(), STARTER_MODE_ID, "card-ability-3", 1);
    const section = configuration.modes[0].actions;
    assert.equal(section[1].id, "card-ability-3");
    assert.equal(section[1].action.action, 1);
});

test("a swap refuses an action that is not in the loadout's action list", () => {
    assert.equal(ACTION_BY_ID.get("bogus"), undefined);
    assert.throws(() => changeCardAction(starter(), STARTER_MODE_ID, "card-ability-1", "bogus"), LaneEditError);
});
