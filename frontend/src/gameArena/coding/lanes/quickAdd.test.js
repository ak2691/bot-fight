import assert from "node:assert/strict";
import test from "node:test";
import { actionTypesForLoadout } from "../../gameconfig/CombatLoadouts.js";
import { ACTION_TYPES } from "../../../../../shared/engine/botlogic/code/contracts/BotLogicContracts.js";
import { abilityBaseRange } from "../../../../../shared/engine/loadout/abilityBaseRange.js";
import { addCard, LaneEditError, SHARED_SCOPE } from "./laneEdits.js";
import { buildQuickAddTemplates, searchQuickAdd } from "./quickAdd.js";
import { createLanesStarter, STARTER_MODE_ID } from "./laneStarter.js";
import { laneConditionSentence, laneActionSentence } from "./laneSentence.js";
import { abilityRangeCondition } from "./laneStarter.js";

// Standard dash (19) and Slash (1), Sniper (3), Grenade (4): the loadout the editor passes for "custom:sgr".
const LOADOUT = "custom:sgr";
const actions = () => actionTypesForLoadout(ACTION_TYPES, LOADOUT);
const templates = () => buildQuickAddTemplates(actions());

test("every loadout action gets a no-condition template, and abilities get the range, ready, HP and enemy templates", () => {
    const all = templates();
    const slash = all.filter((template) => template.actionId === 1).map((template) => template.id);
    assert.deepEqual(slash, ["1:none", "1:range", "1:ready", "1:hp", "1:enemy-prep"]);
    // Dash has no base range, so no range template; it still gets the other four.
    const dash = all.filter((template) => template.actionId === 19).map((template) => template.id);
    assert.deepEqual(dash, ["19:none", "19:ready", "19:hp", "19:enemy-prep"]);
    assert.ok(abilityBaseRange(1) != null);
    assert.equal(all.some((template) => template.id === "move_walk:range"), false);
    assert.ok(all.some((template) => template.id === "move_walk:hp"));
});

test("variable cards get no template until the bot has a variable", () => {
    assert.equal(templates().some((template) => template.actionId === "variable"), false);
    const withVariable = buildQuickAddTemplates(actions(), {
        customVariables: [{ id: "var-rage", name: "Rage", valueType: "number" }],
    });
    const variable = withVariable.find((template) => template.actionId === "variable");
    assert.ok(variable);
    assert.equal(variable.sentence, "Always → Set Rage");
});

test("sentences read as the editor reads them: My Bot is implied, abilities are named", () => {
    const byId = new Map(templates().map((template) => [template.id, template.sentence]));
    assert.equal(byId.get("1:none"), "Always → Use Slash");
    assert.equal(byId.get("1:range"), "When distance to Opponent 1 ≤ Slash range → Use Slash");
    assert.equal(byId.get("1:ready"), "When slash ready → Use Slash");
    assert.equal(byId.get("move_walk:hp"), "When my HP < 68 → Walk");
    assert.equal(byId.get("move_walk:enemy-prep"), "When opponent 1 winding up → Walk");
    assert.equal(byId.get("cancel_windup:none"), "Always → Cancel wind-up");
});

test("search matches each typed word as a word prefix, and finds the range template for 'slash range'", () => {
    const all = templates();
    const top = searchQuickAdd(all, "slash range")[0];
    assert.equal(top.sentence, "When distance to Opponent 1 ≤ Slash range → Use Slash");
    assert.equal(searchQuickAdd(all, "sla")[0].id, "1:none");
    assert.deepEqual(searchQuickAdd(all, "slashy"), []);
    // Keywords answer to the words players reach for.
    assert.ok(searchQuickAdd(all, "enemy")[0].id.endsWith(":enemy-prep"));
    assert.ok(searchQuickAdd(all, "health")[0].id.endsWith(":hp"));
    assert.equal(searchQuickAdd(all, "walk", { lane: "ability" }).length, 0);
    assert.ok(searchQuickAdd(all, "", { lane: "movement" }).every((template) => template.lane === "movement"));
});

test("every template is an accepted card: adding each one to the starter brain passes the lanes checks", () => {
    const starter = createLanesStarter([19, 1, 3, 4]);
    for (const template of templates()) {
        const result = addCard(starter, STARTER_MODE_ID, template.actionId, [], structuredClone(template.conditions));
        assert.ok(result.cardId, template.id);
    }
});

test("a template added to the shared scope keeps its lane", () => {
    const starter = createLanesStarter([19, 1, 3, 4]);
    const range = templates().find((template) => template.id === "1:range");
    const result = addCard(starter, SHARED_SCOPE, range.actionId, [], range.conditions);
    assert.equal(result.configuration.shared.actions.length, 1);
    assert.throws(() => addCard(starter, "missing-mode", 1, []), LaneEditError);
});

test("condition sentences fall back to the tree summary for conditions they do not own", () => {
    const text = laneConditionSentence({
        type: "expression",
        left: "selectable.hp",
        leftSelectable: "opponent_1",
        comparator: "lt",
        right: { type: "number", value: 80 },
    });
    assert.equal(text, "HP (Opponent 1) < 80");
    assert.equal(laneActionSentence({ action: "not_an_action" }), "Pick an action");
    assert.deepEqual(abilityRangeCondition(1).ability, 1);
});
