import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { after, before, test } from "node:test";
import React, { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createServer } from "vite";
import { CUSTOM_VARIABLE_OPERATIONS, SELECTABLE_TYPES } from "../botlogic/code/BotCode.js";
import { encodeSandboxLoadout } from "../loadout/BotLoadout.js";
import {
    VARIABLE_OPERATOR_OPTIONS,
    nextVariableOperatorMenuIndex,
    variableOperatorMenuKeyAction,
} from "./controls/variableOperatorPresentation.js";
import { measureActionNodeWidth, resolveSelectableTarget } from "./nodes/actionNodePresentation.js";

const FRONTEND_ROOT = fileURLToPath(new URL("../../..", import.meta.url));
const GRAPH_NODES_PATH = fileURLToPath(new URL("./nodes/GraphNodes.jsx", import.meta.url));
const CSS_PATH = fileURLToPath(new URL("../../index.css", import.meta.url));
const OPERATOR_GLYPH_PATH = fileURLToPath(new URL("./controls/VariableOperatorGlyph.jsx", import.meta.url));

let vite;
let VariableOperatorGlyph;
let VariableOperatorPicker;
let VariableActionControls;
let VariableActionExpression;
let buildLogicGraph;

before(async () => {
    vite = await createServer({
        root: FRONTEND_ROOT,
        configFile: path.join(FRONTEND_ROOT, "vite.config.js"),
        server: { middlewareMode: true, hmr: false },
        appType: "custom",
        logLevel: "error",
    });
    ({ VariableOperatorGlyph, VariableOperatorPicker } = await vite.ssrLoadModule("/src/gameArena/coding/controls/VariableOperatorGlyph.jsx"));
    ({ VariableActionControls, VariableActionExpression, buildLogicGraph } = await vite.ssrLoadModule("/src/gameArena/coding/nodes/GraphNodes.jsx"));
});

after(async () => {
    await vite?.close();
});

function render(Component, props) {
    return renderToStaticMarkup(createElement(Component, props));
}

const variableAction = {
    variableId: "custom.rounds",
    terms: [
        { operator: CUSTOM_VARIABLE_OPERATIONS.SET, operand: { type: "number", value: 20 } },
        { operator: CUSTOM_VARIABLE_OPERATIONS.ADD, operand: { type: "number", value: 12 } },
        { operator: CUSTOM_VARIABLE_OPERATIONS.SUBTRACT, operand: { type: "number", value: 3 } },
        { operator: CUSTOM_VARIABLE_OPERATIONS.MODULO, operand: { type: "number", value: 5 } },
    ],
};
const variables = [{ id: "custom.rounds", name: "Rounds", valueType: "number" }];

test("the custom-variable inspector and action node share font symbols for every operation", () => {
    const inspector = render(VariableActionControls, {
        entry: variableAction,
        variables,
        stateVariables: [],
        disabled: false,
        canAddAction: true,
        onChange: () => {},
        onPickOperand: () => {},
        onInspectOperand: () => {},
        onRemoveAction: () => {},
    });
    const actionNode = render(VariableActionExpression, {
        entry: variableAction,
        customVariables: variables,
        stateVariables: [],
        selectableTypes: SELECTABLE_TYPES,
    });

    for (const markup of [inspector, actionNode]) {
        for (const glyph of ["set", "add", "subtract", "modulo"]) {
            assert.match(markup, new RegExp(`code-variable-operator-glyph--${glyph}`));
        }
        for (const symbol of ["=", "+", "-", "%"]) assert.match(markup, new RegExp(`>${symbol.replace(/[+]/g, "\\+")}<`));
        assert.doesNotMatch(markup, /<span>(?:Set|Add|Subtract|Modulo)<\/span>/);
    }
    assert.match(actionNode, /role="img" aria-label="Set"/);
    assert.equal(VARIABLE_OPERATOR_OPTIONS.find((option) => option.id === CUSTOM_VARIABLE_OPERATIONS.ADD).label, "Add");
    assert.equal(VARIABLE_OPERATOR_OPTIONS.find((option) => option.id === CUSTOM_VARIABLE_OPERATIONS.MODULO).label, "Modulo");
});

test("each operator renders as its normal font character", () => {
    const symbols = VARIABLE_OPERATOR_OPTIONS.map((option) => render(VariableOperatorGlyph, { operation: option.id }));
    assert.deepEqual(symbols.map((markup) => markup.match(/aria-hidden="true">([^<]+)<\/span>/)?.[1]), ["=", "+", "-", "%"]);
    assert.equal(symbols.some((markup) => /<svg|<path|<circle/.test(markup)), false);
});

test("operator menu shows symbols only and keeps accessible keyboard behavior", () => {
    const markup = render(VariableOperatorPicker, {
        value: CUSTOM_VARIABLE_OPERATIONS.ADD,
        ariaLabel: "Variable action operator 1",
        onChange: () => {},
    });
    const disabledMarkup = render(VariableOperatorPicker, {
        value: CUSTOM_VARIABLE_OPERATIONS.ADD,
        disabled: true,
        ariaLabel: "Variable action operator 1",
        onChange: () => {},
    });

    assert.match(markup, /aria-label="Variable action operator 1: Add"/);
    assert.match(markup, /aria-haspopup="menu"/);
    assert.match(markup, /aria-expanded="false"/);
    assert.match(markup, /role="menu"[^>]*hidden/);
    assert.match(markup, /role="menuitemradio"[^>]*aria-checked="true"/);
    const moduloMenuItem = markup.match(/<button type="button" role="menuitemradio"[^>]*aria-label="Modulo"[\s\S]*?<\/button>/)?.[0];
    assert.ok(moduloMenuItem);
    assert.match(moduloMenuItem, /code-variable-operator-glyph--modulo/);
    assert.doesNotMatch(moduloMenuItem, />Modulo</);
    assert.match(disabledMarkup, /<button[^>]*disabled=""[^>]*aria-haspopup="menu"/);
    assert.equal(nextVariableOperatorMenuIndex("ArrowDown", 3, 4), 0);
    assert.equal(nextVariableOperatorMenuIndex("ArrowUp", 0, 4), 3);
    assert.equal(nextVariableOperatorMenuIndex("Home", 2, 4), 0);
    assert.equal(nextVariableOperatorMenuIndex("End", 1, 4), 3);
    assert.equal(nextVariableOperatorMenuIndex("ArrowDown", 0, 4, [1]), 2);
    assert.equal(variableOperatorMenuKeyAction("Escape"), "close-and-return-focus");
    assert.equal(variableOperatorMenuKeyAction("Tab"), "close-and-continue-focus");
});

test("operator dropdown escapes clipped rows and node sizing reserves visible glyph space", () => {
    const operatorSource = readFileSync(OPERATOR_GLYPH_PATH, "utf8");
    const css = readFileSync(CSS_PATH, "utf8");
    const graphSource = readFileSync(GRAPH_NODES_PATH, "utf8");

    assert.match(operatorSource, /createPortal\(menu, document\.body\)/);
    assert.match(css, /\.code-variable-operator-menu \{\s*position: fixed;/);
    assert.match(css, /\.code-variable-expression-operator \{\s*display: inline-flex;\s*width: 13px;/);
    assert.match(css, /\.code-variable-operator-glyph \{[\s\S]*?font: 700 14px\/1 "DM Sans"/);
    assert.match(css, /\.code-variable-expression-operator \.code-variable-operator-glyph[\s\S]*?width: 13px; height: 13px; font-size: 13px;/);
    assert.match(graphSource, /operatorWidth: 13/);
});

test("coding workspace numbers and default zoom retain their previous presentation", () => {
    const panelSource = readFileSync(fileURLToPath(new URL("./CodingPanel.jsx", import.meta.url)), "utf8");
    const puzzleSource = readFileSync(fileURLToPath(new URL("../../pages/puzzles/PuzzleLogicWorkspace.jsx", import.meta.url)), "utf8");
    const graphSource = readFileSync(GRAPH_NODES_PATH, "utf8");
    const css = readFileSync(CSS_PATH, "utf8");

    assert.match(panelSource, /useState\(0\.85\)/);
    assert.match(puzzleSource, /const INITIAL_ZOOM = 0\.85/);
    assert.doesNotMatch(graphSource, /font-interface-numeric code-node-numeric-input|code-node-numeric-value/);
    assert.doesNotMatch(css, /\.code-node-numeric-value|\.code-node-numeric-input/);
});

test("compact entity action graph measurement and variable-expression layout remain intact", () => {
    const singularity = SELECTABLE_TYPES.find((selectable) => selectable.id === "opponent_1_singularity_zone");
    const action = {
        action: 27,
        selectable: `${singularity.id}:closest:1`,
    };
    const roots = [{
        id: "compact-width-root",
        branches: [{
            id: "compact-width-branch",
            conditions: [{ type: "always" }],
            actions: [action],
        }],
    }];
    const graph = buildLogicGraph(roots, undefined, encodeSandboxLoadout({ abilities: [27] }));
    const actionNode = graph.actions[0];
    const presentation = resolveSelectableTarget(action.selectable, SELECTABLE_TYPES);
    const independentlyMeasuredWidth = measureActionNodeWidth({
        actionLabel: "Singularity",
        hasAbilityIcon: true,
        targetMode: "target",
        targetPresentation: presentation,
    });
    const css = readFileSync(CSS_PATH, "utf8");
    const graphSource = readFileSync(GRAPH_NODES_PATH, "utf8");

    assert.equal(actionNode.width, independentlyMeasuredWidth);
    assert.ok(actionNode.width <= 260, `expected a compact graph action node, got ${actionNode.width}px`);
    assert.ok(actionNode.x > graph.conditions[0].x);
    assert.match(css, /\.code-variable-action-expression \{[\s\S]*flex-wrap: wrap;/);
    assert.match(graphSource, /const expressionLines = Math\.max\(1, Math\.ceil\(expressionWidth/);
});

test("compact selectable order badges do not space their letter and ordinal apart", () => {
    const css = readFileSync(CSS_PATH, "utf8");

    assert.match(css, /\.code-config-token--order \{ gap: 0;[\s\S]*letter-spacing: 0;/);
    assert.match(css, /\.code-config-token-order \{ display: inline-flex; gap: 0;[\s\S]*letter-spacing: 0;/);
});
