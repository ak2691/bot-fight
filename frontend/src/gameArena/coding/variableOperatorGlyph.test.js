import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { after, before, test } from "node:test";
import React, { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createServer } from "vite";
import { CUSTOM_VARIABLE_OPERATIONS, SELECTABLE_TYPES } from "../botlogic/code/BotCode.js";
import {
    VARIABLE_OPERATOR_OPTIONS,
    nextVariableOperatorMenuIndex,
    variableOperatorMenuKeyAction,
} from "./controls/variableOperatorPresentation.js";

const FRONTEND_ROOT = fileURLToPath(new URL("../../..", import.meta.url));
const GRAPH_NODES_PATH = fileURLToPath(new URL("./nodes/GraphNodes.jsx", import.meta.url));
const CSS_PATH = fileURLToPath(new URL("../../index.css", import.meta.url));
const OPERATOR_GLYPH_PATH = fileURLToPath(new URL("./controls/VariableOperatorGlyph.jsx", import.meta.url));

let vite;
let VariableOperatorGlyph;
let VariableOperatorPicker;
let VariableActionControls;
let VariableActionExpression;

before(async () => {
    vite = await createServer({
        root: FRONTEND_ROOT,
        configFile: path.join(FRONTEND_ROOT, "vite.config.js"),
        server: { middlewareMode: true, hmr: false },
        appType: "custom",
        logLevel: "error",
    });
    ({ VariableOperatorGlyph, VariableOperatorPicker } = await vite.ssrLoadModule("/src/gameArena/coding/controls/VariableOperatorGlyph.jsx"));
    ({ VariableActionControls, VariableActionExpression } = await vite.ssrLoadModule("/src/gameArena/coding/nodes/GraphNodes.jsx"));
});

after(async () => {
    await vite?.close();
});

function render(Component, props) {
    return renderToStaticMarkup(createElement(Component, props));
}


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

