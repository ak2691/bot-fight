import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import test from "node:test";

const source = readFileSync(
    fileURLToPath(new URL("./HomePage.jsx", import.meta.url)),
    "utf8",
);
const floatingSource = readFileSync(
    fileURLToPath(new URL("../../components/FloatingLogicBackground.jsx", import.meta.url)),
    "utf8",
);
const puzzleBuilderSource = readFileSync(
    fileURLToPath(new URL("../puzzles/PuzzleBuilderPage.jsx", import.meta.url)),
    "utf8",
);

test("the home match action returns to an active match instead of queueing", () => {
    assert.match(source, /function HomePage\(\{ activeMatch = false, activeMatchId = null \}\)/);
    assert.match(source, /activeMatch\s*\?\s*"Return to match"/);
    assert.match(source, /if \(activeMatch\) \{\s*navigate\("\/match", \{\s*state:/s);
});

test("the home practice-room action uses the stable practice route", () => {
    assert.match(source, /if \(id === "room"\) navigate\("\/practice"\)/);
});

test("floating action nodes use the current movement action label", () => {
    assert.match(floatingSource, /label: "Movement: Walk"/);
    assert.doesNotMatch(floatingSource, /label: "Walk"/);
});

test("admin puzzle starting stats give your bot the cyan panel treatment", () => {
    assert.match(puzzleBuilderSource, /border-cyan-400\/65 bg-cyan-950\/30/);
});
