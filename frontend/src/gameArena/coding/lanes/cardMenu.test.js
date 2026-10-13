import assert from "node:assert/strict";
import test from "node:test";
import { ACTION_TYPES } from "../../../../../shared/engine/botlogic/code/contracts/BotLogicContracts.js";
import { buildQuickAddTemplates } from "./quickAdd.js";
import { cardMenuContent, defaultLane, laneActionItems, laneRail, readyMadeItems } from "./cardMenu.js";

// Every action type (the plain ones and each ability), as a full loadout would list them.
const types = ACTION_TYPES;
const templates = buildQuickAddTemplates(types, { customVariables: [] });

test("a section lists its own actions: ability, dash and cancel for Actions; Walk and Face for Movement", () => {
    const abilities = laneActionItems(types, "actions");
    assert.ok(abilities.length > 0, "the loadout has ability cards");
    assert.ok(abilities.every((item) => item.lane === "actions"));
    assert.ok(abilities.some((item) => item.abilityId != null));
    assert.ok(abilities.some((item) => item.head === "cancel"), "a cancel card sits in Actions");
    assert.deepEqual(laneActionItems(types, "movement").map((item) => item.name), ["Walk", "Face"]);
    assert.deepEqual(laneActionItems(types, "movement").map((item) => item.head), ["movement", "rotation"]);
});

test("ready-made cards are the lane's templates, named by their action and described by their conditions", () => {
    const moves = readyMadeItems(templates, types, ["movement"]);
    assert.ok(moves.length >= 2);
    assert.ok(moves.every((item) => item.kind === "template" && item.lane === "movement"));
    assert.equal(moves[0].name, "Walk");
    assert.equal(moves[0].description, "Always", "a template with no condition reads Always");
    const withCondition = moves.find((item) => item.description !== "Always");
    assert.match(withCondition.description, /^[A-Z]/, "the description starts with a capital");
});

test("the lane rail counts what matches the query and fits; a search with no match fades every lane", () => {
    const rail = laneRail(types, "walk");
    assert.equal(rail.find((entry) => entry.lane === "movement").count, 1);
    assert.equal(laneRail(types, "face").find((entry) => entry.lane === "movement").count, 1, "Face is a movement card too");
    assert.equal(rail.find((entry) => entry.lane === "actions").count, 0);
    assert.equal(laneRail(types, "zzzz").every((entry) => entry.count === 0), true);
    const noWalk = laneRail(types, "", (actionId) => actionId !== "move_walk");
    assert.equal(noWalk.find((entry) => entry.lane === "movement").count, 1, "Walk is not counted; Face still is");
});

test("the card menu's content is the chosen lanes' actions that fit, plus their ready-made cards when asked", () => {
    const moveOnly = cardMenuContent({ actionTypes: types, templates, lanes: ["movement"], query: "", withTemplates: true });
    assert.deepEqual(moveOnly.actions.map((item) => item.name), ["Walk", "Face"]);
    assert.ok(moveOnly.ready.length > 0);
    const swap = cardMenuContent({ actionTypes: types, templates, lanes: ["movement"], query: "", fits: () => false, withTemplates: false });
    assert.deepEqual(swap.actions, []);
    assert.deepEqual(swap.ready, []);
});

test("searching across every lane finds a card in another lane, by its name", () => {
    const every = ["movement", "actions", "variables"];
    const found = cardMenuContent({ actionTypes: types, templates: [], lanes: every, query: "face", withTemplates: false });
    assert.deepEqual(found.actions.map((item) => item.name), ["Face"]);
});

test("the default section is the given one, else the card's own section, else Movement", () => {
    assert.equal(defaultLane("variables", null), "variables");
    assert.equal(defaultLane(null, "dash"), "actions");
    assert.equal(defaultLane(null, "rotation"), "movement");
    assert.equal(defaultLane(null, "nope"), "movement");
});

test("Add movement while casting lists the move and face actions only, so a pick can attach either", () => {
    const content = cardMenuContent({ actionTypes: types, templates: [], lanes: ["movement"], withTemplates: false });
    const heads = new Set(content.actions.map((item) => item.head));
    assert.ok(heads.has("movement") && heads.has("rotation"), "both attachable kinds are offered");
    assert.deepEqual([...heads].sort(), ["movement", "rotation"], "no ability, dash or cancel in the attach menu");
    assert.equal(content.ready.length, 0, "no ready-made cards in the attach menu");
});
