import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import { BOT_CODE_SELECTABLES } from "../../../../../shared/engine/botlogic/code/contracts/BotLogicContracts.js";
import { laneActionSentence, laneConditionSentence } from "./laneSentence.js";
import { laneToneOf, LANE_SPECS } from "./laneView.js";

const read = (name) => fs.readFileSync(new URL(name, import.meta.url), "utf8");

test("an HP reading shows the stored value, not a percentage", () => {
    const hpBelow = (value) => ({
        type: "expression", left: "selectable.hp", leftSelectable: BOT_CODE_SELECTABLES.MY, comparator: "lt",
        right: { type: "number", value },
    });
    assert.equal(laneConditionSentence(hpBelow(100)), "My HP < 100");
    assert.equal(laneConditionSentence(hpBelow(68)), "My HP < 68");
});

test("an ability action reads with the quick-add verb, and other actions keep their labels", () => {
    assert.equal(laneActionSentence({ action: 1, selectable: "opponent_1" }), "Use Slash");
    assert.match(laneActionSentence({ action: "move_walk" }), /^Walk/);
});

test("the sections are listed in order, with their colours; an unknown section takes Movement's colour", () => {
    assert.deepEqual(LANE_SPECS.map((spec) => spec.title), ["Movement", "Actions", "Variables"]);
    assert.equal(laneToneOf("actions"), "#f0a03c");
    assert.equal(laneToneOf("variables"), "#e58fc0");
    assert.equal(laneToneOf("nope"), "#3aa6c9");
});

test("every lane is shown, an empty one as its label with a small +, and + Card is a ghost line under a lane with cards", () => {
    const board = read("./LanesBoard.jsx");
    assert.match(board, /className="lane-plus"/);
    assert.match(board, /\{!empty && !disabled && \(\s*<button type="button" className="lane-add-card"/);
    assert.doesNotMatch(board, /isOpen|laneOpen|lane__toggle|ALWAYS_OPEN_LANES/);
});

test("read-only cards have no ⋯ menu and no + Condition, and their tiles are inert", () => {
    const row = read("./LaneCardRow.jsx");
    assert.match(row, /\{!disabled && <LaneMenu label="Card options"/);
    assert.match(row, /const canAddCondition = !disabled && /);
    assert.match(row, /disabled=\{disabled\}/);
});

test("the old side panel and the tree's pickers are gone from the lanes editor", () => {
    const board = read("./LanesBoard.jsx");
    assert.equal(fs.existsSync(new URL("./LaneInspector.jsx", import.meta.url)), false);
    assert.doesNotMatch(board, /LaneInspector|NodeKindPicker|ConditionalInspectorRow|VariableOperandPicker/);
    const row = read("./LaneCardRow.jsx");
    assert.doesNotMatch(row, /NodeKindPicker|ConditionalInspectorRow|GraphNodes/);
});
