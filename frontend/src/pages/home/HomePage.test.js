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
const authLayoutSource = readFileSync(
    fileURLToPath(new URL("../auth/AuthLayout.jsx", import.meta.url)),
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

test("the bottom tutorial link emphasizes its onboarding copy", () => {
    assert.match(source, /aria-label="Open tutorial"/);
    assert.match(source, /font-bold text-slate-200">New to Bot Fight\?<\/span>/);
    assert.match(source, /font-extrabold tracking-wide text-cyan-200">Tutorial<\/span>/);
    assert.doesNotMatch(source, /home-tutorial-callout/);
});

test("home nodes use the tutorial-style root, conditional, and action visuals", () => {
    assert.match(floatingSource, /type="root"/);
    assert.match(floatingSource, /type="conditional"/);
    assert.match(floatingSource, /type="action"/);
    assert.match(floatingSource, /tutorial-node-abstract__node--\$\{type\}/);
    assert.doesNotMatch(floatingSource, /GraphConditionNode|GraphActionNode|selectable\.relativeBearing/);
});

test("home trees show the requested action labels and catalogue icons", () => {
    for (const label of ["Heavy Slash", "Dash In", "Walk Away", "Face Target", "Fireball", "Stun", "Dash Away", "Slash"]) {
        assert.match(floatingSource, new RegExp(`label: "${label}"`));
    }
    assert.match(floatingSource, /getAbilityCatalogueIcon\(abilityId\)/);
    assert.match(floatingSource, /code-config-ability home-floating-action-icon/);
    assert.match(floatingSource, /abilityId: 7/);
    assert.match(floatingSource, /abilityId: 19/);
    assert.match(floatingSource, /abilityId: 20/);
});

test("home and authentication share the workspace node background", () => {
    assert.match(source, /<FloatingLogicBackground \/>/);
    assert.match(authLayoutSource, /<FloatingLogicBackground \/>/);
    assert.match(floatingSource, /home-float-pair-1/);
    assert.match(floatingSource, /home-float-pair-2/);
    assert.match(floatingSource, /home-float-pair-3/);
    assert.match(floatingSource, /home-float-pair-4/);
});

test("home tutorial-style trees stay compact in their four corners", () => {
    assert.match(stylesSource, /\.home-floating-pair \{[\s\S]*?width: 340px;[\s\S]*?height: 180px;/);
    assert.match(stylesSource, /\.home-floating-tree \{[\s\S]*?width: 340px;[\s\S]*?height: 180px;/);
    assert.match(stylesSource, /\.home-float-pair-1 \{ top: 7%; left: 3%;[\s\S]*?\}/);
    assert.match(stylesSource, /\.home-float-pair-2 \{ bottom: 6%; left: 1%;[\s\S]*?\}/);
    assert.match(stylesSource, /\.home-float-pair-3 \{ top: 10%; right: 1%;[\s\S]*?\}/);
    assert.match(stylesSource, /\.home-float-pair-4 \{ right: 3%; bottom: 5%;[\s\S]*?\}/);
    assert.match(stylesSource, /\.home-float-pair-1 \{[\s\S]*?transform: rotate\(-2\.5deg\)/);
    assert.match(stylesSource, /\.home-float-pair-4 \{[\s\S]*?transform: rotate\(-1\.7deg\)/);
});

test("home tree floating avoids transformed outline resampling", () => {
    const animationBlock = stylesSource.slice(
        stylesSource.indexOf("@keyframes home-node-float"),
        stylesSource.indexOf("@media (max-width: 1100px)", stylesSource.indexOf("@keyframes home-node-float")),
    );
    assert.match(animationBlock, /from \{ top: -4px; \}[\s\S]*?to \{ top: 8px; \}/);
    assert.doesNotMatch(animationBlock, /transform:/);
});

test("admin puzzle starting stats give your bot the cyan panel treatment", () => {
    assert.match(puzzleBuilderSource, /border-cyan-400\/65 bg-cyan-950\/30/);
});
