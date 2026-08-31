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
const stylesSource = readFileSync(
    fileURLToPath(new URL("../../index.css", import.meta.url)),
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

test("the home match action opens the queue without cancelling an active queue", () => {
    assert.match(source, /const \{ isQueueing, queueElapsed \} = useMatchmaking\(\);/);
    assert.match(source, /if \(activeMatch\) \{[\s\S]*?return;\s*\}\s*navigate\("\/queue"\);/);
    assert.doesNotMatch(source, /cancelQueue/);
});

test("the home practice-room action uses the stable practice route", () => {
    assert.match(source, /if \(id === "room"\) navigate\("\/practice"\)/);
});

test("home action rows keep the ability stack at the standard action height", () => {
    assert.match(stylesSource, /\.home-action-icon\s*\{[\s\S]*?height: 54px;/);
    assert.match(stylesSource, /\.home-action-ability-icons\s*\{[\s\S]*?height: 54px;/);
    assert.match(stylesSource, /\.home-action-ability-card\s*\{[\s\S]*?top: 50%;/);
    assert.match(stylesSource, /\.home-action-ability-card-1\s*\{[\s\S]*?transform: translateY\(-50%\) rotate\(-16deg\);/);
    assert.match(stylesSource, /\.home-action-ability-card-2\s*\{[\s\S]*?transform: translateY\(-50%\) rotate\(0deg\);/);
    assert.match(stylesSource, /\.home-action-ability-card-3\s*\{[\s\S]*?transform: translateY\(-50%\) rotate\(16deg\);/);
});

test("floating action nodes use the current movement label and targeting description", () => {
    assert.match(floatingSource, /label: "Walk", target: "180 deg from Opponent"/);
    assert.match(floatingSource, /label: "Walk", target: "0 deg from Opponent"/);
    assert.doesNotMatch(floatingSource, /label: "Movement: Walk"/);
    assert.doesNotMatch(floatingSource, /Away From Opponent|Toward Opponent/);
});

test("home bearing nodes use the compact display label", () => {
    assert.match(floatingSource, /"Relative Bearing of Target From Entity"/);
    assert.doesNotMatch(floatingSource, /"Relative Bearing of Target From Entity \(Shortest\)"/);
});

test("admin puzzle starting stats give your bot the cyan panel treatment", () => {
    assert.match(puzzleBuilderSource, /border-cyan-400\/65 bg-cyan-950\/30/);
});
