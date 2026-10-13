import assert from "node:assert/strict";
import test from "node:test";
import { normalizeAbilityStrategyConfiguration } from "../../../../../shared/engine/botlogic/code/BotCode.js";
import { collectVariableUses, removeVariableFromConfiguration, rewriteVariableActions } from "../variableUsage.js";
import { addCard, addSwitch, addCondition, SHARED_SCOPE } from "./laneEdits.js";
import { createLanesStarter, STARTER_MODE_ID } from "./laneStarter.js";
import { buildCatalogCondition } from "./conditionCatalog.js";

const newCondition = (selectableTypes) => buildCatalogCondition("enemy.distance", { selectableTypes });


const VARIABLE = "custom.hits";
// Every card of a mode or the shared set, in its sections (switches are not cards).
const allCards = (set) => [...(set.movement ?? []), ...(set.actions ?? []), ...(set.variables ?? [])];

// A lanes brain with one number variable, a variable card in the mode, and a shared card whose condition reads it.
function brainWithVariable() {
    const starter = createLanesStarter([]);
    const withVariable = normalizeAbilityStrategyConfiguration({
        ...starter,
        customVariables: [{ id: VARIABLE, name: "Hits", valueType: "number", defaultValue: 0 }],
    });
    const { configuration: written, cardId: writerId } = addCard(withVariable, STARTER_MODE_ID, "variable", withVariable.customVariables);
    const { configuration: reading, cardId: readerId } = addCard(written, SHARED_SCOPE, 1, withVariable.customVariables, [{
        ...newCondition(),
        left: VARIABLE,
    }]);
    return { configuration: reading, writerId, readerId };
}

test("a card that writes or reads a variable is listed as a use, with its place", () => {
    const { configuration, writerId, readerId } = brainWithVariable();
    const uses = collectVariableUses(configuration, VARIABLE, {
        condition: () => "reads",
        action: () => "writes",
    });
    const targets = uses.map((use) => use.target.nodeId);
    assert.ok(targets.includes(writerId), "writer listed");
    assert.ok(targets.includes(readerId), "reader listed");
    assert.ok(uses.some((use) => use.where === 'Mode "Main"' && use.kind === "SET"));
    assert.ok(uses.some((use) => use.where === "All modes" && use.kind === "IF"));
});

test("removing a variable deletes the variable cards and clears conditions that read it", () => {
    const { configuration, writerId, readerId } = brainWithVariable();
    const next = removeVariableFromConfiguration(configuration, VARIABLE);
    const ids = [...next.modes.flatMap(allCards), ...allCards(next.shared)].map((card) => card.id);
    assert.equal(ids.includes(writerId), false, "variable card removed");
    assert.equal(ids.includes(readerId), true, "reader card kept");
    const reader = allCards(next.shared).find((card) => card.id === readerId);
    assert.deepEqual(reader.conditions, []);
    assert.deepEqual(next.customVariables, []);
});

test("rewriting a variable's writes walks lanes cards and switches too", () => {
    const { configuration, writerId } = brainWithVariable();
    let calls = 0;
    const next = rewriteVariableActions(configuration, VARIABLE, (entry) => {
        calls += 1;
        return entry;
    });
    assert.equal(calls, 1, "the one variable card is rewritten");
    assert.ok(next.modes[0].variables.some((card) => card.id === writerId), "and kept");
});

test("a switch that reads the variable is a use and is dropped by removal", () => {
    const { configuration } = brainWithVariable();
    const { configuration: withSwitch, switchId } = addSwitch(configuration, STARTER_MODE_ID, STARTER_MODE_ID, []);
    const timed = addCondition(withSwitch, STARTER_MODE_ID, { kind: "switch", id: switchId }, { ...newCondition(), left: VARIABLE });
    assert.equal(collectVariableUses(timed, VARIABLE).some((use) => use.target.nodeId === switchId), true);
    const next = removeVariableFromConfiguration(timed, VARIABLE);
    assert.deepEqual(next.modes[0].switches[0].conditions, []);
});

test("a follow-up card that reads the variable is a use too: it is listed, and removing the variable clears its condition", () => {
    const configuration = normalizeAbilityStrategyConfiguration({
        version: "bot-logic-lanes-v1",
        customVariables: [{ id: VARIABLE, name: "Hits", valueType: "number", defaultValue: 0 }],
        modes: [{
            id: "neutral", name: "Neutral",
            actions: [{
                id: "slash",
                conditions: [{ type: "always" }],
                action: { action: 1, selectable: "opponent_1" },
                followUps: [
                    { id: "reader", conditions: [{ ...newCondition(), left: VARIABLE }], action: { action: 1, selectable: "opponent_1" } },
                ],
            }],
        }],
        shared: {},
    });
    const uses = collectVariableUses(configuration, VARIABLE, { action: () => "writes", condition: () => "reads" });
    assert.ok(uses.some((use) => use.target.nodeId === "reader" && use.kind === "IF"), "the reading follow-up is listed");

    const next = removeVariableFromConfiguration(configuration, VARIABLE);
    const [slash] = next.modes[0].actions;
    assert.deepEqual(slash.followUps.map((card) => card.id), ["reader"], "the follow-up is kept");
    assert.deepEqual(slash.followUps[0].conditions, [], "its condition on the variable is cleared");
});
