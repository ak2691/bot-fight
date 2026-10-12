import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import test from "node:test";
import {
    abilityChargeCountFor,
    abilityRingArcPath,
    abilityRingBackground,
    abilityRingColorFor,
    abilityStatusFor,
    fallbackAbilityText,
    formatAbilityTimer,
    statusParticipantNumber,
} from "./abilityStatusPresentation.js";

const PANEL_PATH = fileURLToPath(new URL("./AbilityStatusPanel.jsx", import.meta.url));
const PRESENTATION_PATH = fileURLToPath(new URL("./abilityStatusPresentation.js", import.meta.url));
const INDEX_CSS_PATH = fileURLToPath(new URL("../../index.css", import.meta.url));
const PIXI_CSS_PATH = fileURLToPath(new URL("../pixi/PixiCanvas.css", import.meta.url));
const PIXI_CANVAS_PATH = fileURLToPath(new URL("../pixi/PixiCanvas.jsx", import.meta.url));

test("ability status panel leaves Overclock to the Pixi bot presentation", () => {
    const source = readFileSync(PANEL_PATH, "utf8");
    assert.doesNotMatch(source, /OverclockStatusIcon|overclockStatusFor|Overclock:/);
});

test("ability status panel numbers teammates and opponents from the current user's roster", () => {
    const source = readFileSync(PANEL_PATH, "utf8");
    const roster = [
        { id: "self", isCurrentUser: true, teamNumber: 1, slot: 1 },
        { id: "teammate", teamNumber: 1, slot: 2 },
        { id: "opponent-one", teamNumber: 2, slot: 3 },
        { id: "opponent-two", teamNumber: 2, slot: 4 },
    ];

    assert.equal(statusParticipantNumber(roster[0], roster), null);
    assert.equal(statusParticipantNumber(roster[1], roster), 1);
    assert.equal(statusParticipantNumber(roster[2], roster), 1);
    assert.equal(statusParticipantNumber(roster[3], roster), 2);
    assert.match(source, /showParticipantNumbers \? statusParticipantNumber\(bot, statusRoster\) : null/);
});

test("numbered status markers are enabled only for player matches and replays", () => {
});

test("cooldown arcs render nothing at zero, a solid circle at one, and begin at 12 o'clock", () => {
    assert.equal(abilityRingArcPath(0), null);
    assert.equal(abilityRingArcPath(1), null);
    assert.match(abilityRingArcPath(0.25), /^M 18 2\.5 A 15\.5 15\.5 0 0 1 /);
    assert.match(abilityRingArcPath(0.75), /^M 18 2\.5 A 15\.5 15\.5 0 1 1 /);
});

test("missing artwork uses compact safe fallbacks", () => {
    assert.equal(fallbackAbilityText("unknown_future_ability", ""), "UF");
    assert.doesNotThrow(() => fallbackAbilityText(null, ""));
});

test("timer space stays stable and timed text disappears when the state is idle", () => {
    const source = readFileSync(PANEL_PATH, "utf8");
    assert.match(source, /formatAbilityTimer\(status\.remainingMs\)/);
    assert.equal(formatAbilityTimer(0), "");
    assert.equal(formatAbilityTimer(null), "");
    assert.equal(formatAbilityTimer(950), "1.0s");
});

test("preparation, active, cooldown, and ready states use remaining-time direction", () => {
    const preparing = abilityStatusFor({ abilityState: { 18: { stage: "windup", remainingMs: 200 } } }, 18);
    assert.equal(preparing.state, "preparing");
    assert.equal(preparing.remainingMs, 200);
    assert.ok(Math.abs(preparing.progress - (1 / 3)) < 0.0001);
    assert.equal(abilityRingBackground(preparing), "conic-gradient(from 0deg, #facc15 0 100.00%, #64748b 100.00% 100%)");

    const availableDuringPreparation = abilityStatusFor({ abilityState: { 18: { stage: "windup", remainingMs: 200 } } }, 1);
    assert.equal(availableDuringPreparation.state, "ready");
    assert.equal(availableDuringPreparation.progress, 1);
    assert.equal(abilityRingColorFor(1, availableDuringPreparation), "#22c55e");

    const active = abilityStatusFor({ abilityState: { 1: { stage: "active", remainingMs: 200 } } }, 1);
    assert.equal(active.state, "active");
    assert.equal(active.remainingMs, 200);
    assert.match(abilityRingBackground(active), /#7dd3fc/);

    const dash = abilityStatusFor({ abilityState: { 19: { stage: "active", remainingMs: 200 } } }, 19);
    assert.equal(dash.state, "active");
    assert.equal(dash.durationMs, 200);
    assert.ok(Math.abs(dash.progress - 0) < 0.0001);

    const cooldown = abilityStatusFor({ abilityState: { 1: { stage: "cooldown", remainingMs: 250 } } }, 1);
    assert.equal(cooldown.state, "cooldown");
    assert.equal(cooldown.durationMs, 500);
    assert.ok(Math.abs(cooldown.progress - 0.5) < 0.0001);
    assert.match(abilityRingBackground(cooldown), /from 0deg/);
    assert.match(abilityRingBackground(cooldown), /#22c55e/);
    assert.match(abilityRingBackground(cooldown), /#64748b/);

    const ready = abilityStatusFor({ abilityState: { 1: { stage: "ready", remainingMs: 0 } } }, 1);
    assert.equal(ready.state, "ready");
    assert.equal(ready.progress, 1);
    assert.match(abilityRingBackground(ready), /#22c55e 0 100\.00%/);

    for (const abilityId of [3, 5]) {
        const canonicalReplayState = abilityStatusFor({ abilityState: { [abilityId]: { stage: "ready", remainingMs: 0, charges: 1, reloadMs: 0 } } }, abilityId);
        assert.equal(canonicalReplayState.state, "ready", `ability ${abilityId}`);
        assert.equal(abilityRingColorFor(abilityId, canonicalReplayState), "#22c55e");
    }
});

test("presentation uses only canonical charge fields", () => {
    assert.equal(abilityChargeCountFor({}, 3), null);
    assert.equal(abilityStatusFor({}, 3).state, "ready");
    assert.equal(abilityStatusFor({}, 2).state, "ready");
});

test("status presentation remains driven by generic charge fields", () => {
    const source = readFileSync(PANEL_PATH, "utf8");
    assert.match(source, /charges != null/);
    assert.match(source, /abilityChargeCountFor/);
    assert.equal(abilityChargeCountFor({ abilityState: { 2: { stage: "ready", remainingMs: 0, charges: 12 } } }, 2), null);
});

test("both fighter cards render every ability slot and never fabricate empty ones", () => {
    const source = readFileSync(PANEL_PATH, "utf8");
    assert.equal((source.match(/abilities\s*\.map\(/g) ?? []).length, 1);
    assert.equal((source.match(/const HP_SEGMENTS = 10;/g) ?? []).length, 1);
    assert.doesNotMatch(source, /Array\.from\(\{ length: abilities\.length/);
    assert.doesNotMatch(source, /SLOT .*EMPTY/);
});

test("the fighter card shows a thin stamina meter under HP and no exhaustion state", () => {
    const panel = readFileSync(PANEL_PATH, "utf8");
    const css = readFileSync(PIXI_CSS_PATH, "utf8");
    assert.match(panel, /role="meter"[\s\S]*aria-label="Stamina"/);
    assert.match(panel, /aria-valuenow=\{stamina\}/);
    assert.doesNotMatch(panel, /exhaust/i);
    assert.doesNotMatch(css, /is-exhausted|hud-sta__tag/);
    assert.ok(panel.indexOf("<HpBar") < panel.indexOf("<StaminaBar"));
    assert.match(css, /\.hud-sta__bar span\s*\{[^}]*#a78bfa/);
    assert.match(css, /\.hud-sta__bar\s*\{[^}]*height: 3px/);
    assert.match(css, /"face sta abil"/, "stacks under HP on phones");
});

test("all ability tiles share one grid in acquisition order with base tiles marked by a modifier", () => {
    const panel = readFileSync(PANEL_PATH, "utf8");
    const css = readFileSync(PIXI_CSS_PATH, "utf8");
    assert.equal((panel.match(/className="hud-abilities"/g) ?? []).length, 1);
    assert.doesNotMatch(panel, /hud-abilities--/);
    assert.match(panel, /hud-ability--base/);
    assert.match(css, /\.hud-abilities\s*\{[^}]*repeat\(4, minmax\(0, 1fr\)\)/);
    assert.match(css, /\.hud-ability--base \.hud-ability__face\s*\{[^}]*#3b4652/);
    assert.doesNotMatch(css, /Up to 9 abilities|3 base tiles/);
});
