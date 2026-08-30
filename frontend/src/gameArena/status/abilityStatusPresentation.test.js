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

test("ability status panel marks only the current user with a white Me tag", () => {
    const source = readFileSync(PANEL_PATH, "utf8");
    assert.match(source, /bot\?\.isCurrentUser === true/);
    assert.match(source, /text-white">\(Me\)<\/span>/);
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
    assert.match(source, /\{participantNumber != null && <span className="ml-1 text-slate-400">\(\{participantNumber\}\)<\/span>\}/);
});

test("numbered status markers are enabled only for player matches and replays", () => {
    const arenaSource = readFileSync(fileURLToPath(new URL("../Arena.jsx", import.meta.url)), "utf8");
    const replaySource = readFileSync(fileURLToPath(new URL("../../replay/SimulationReplay.jsx", import.meta.url)), "utf8");
    assert.match(arenaSource, /showParticipantNumbers=\{isMatchTesting\}/);
    assert.match(arenaSource, /const abilityInfoEnabled = isPracticeRoom \|\| isPuzzleMode \|\| isPuzzleBuilder \|\|/);
    assert.match(replaySource, /showParticipantNumbers lockCamera/);
});

test("ability status panels use a fixed three-column circular grid without slot or glow presentation", () => {
    const source = readFileSync(PANEL_PATH, "utf8");
    const presentationSource = readFileSync(PRESENTATION_PATH, "utf8");
    const globalStyles = readFileSync(INDEX_CSS_PATH, "utf8");

    assert.match(source, /grid-cols-3/);
    assert.match(source, /auto-rows-\[3\.5rem\]/);
    assert.match(source, /h-\[11rem\]/);
    assert.match(source, /rounded-full/);
    assert.match(source, /object-contain/);
    assert.match(source, /getAbilityCatalogueIcon/);
    assert.match(source, /!iconPath \|\| imageFailed/);
    assert.doesNotMatch(source, /useInterpolatedProgress|animateProgress|requestAnimationFrame/);
    assert.match(source, /viewBox="0 0 36 36"/);
    assert.match(source, /const ABILITY_RING_RADIUS = 15\.5;/);
    assert.match(source, /const ABILITY_RING_STROKE_WIDTH = 3;/);
    assert.match(source, /className="absolute inset-\[4px\]/);
    assert.match(source, /ringProgress === 1/);
    assert.match(source, /partialRingPath &&/);
    assert.match(source, /<path d=\{partialRingPath\}/);
    assert.doesNotMatch(source, /strokeDasharray|strokeDashoffset|pathLength=/);
    assert.doesNotMatch(source, /ABILITY_RING_CIRCUMFERENCE/);
    assert.match(source, /\["active", "preparing", "ready"\]\.includes\(status\.state\) \? 1 : statusProgress/);
    assert.doesNotMatch(source, /key=\{status\.state\}/);
    assert.equal(source.match(/vectorEffect="non-scaling-stroke"/g)?.length, 3);
    assert.match(source, /strokeLinecap="butt"/);
    assert.doesNotMatch(source, /className="mt-1 h-3 w-full truncate/);
    assert.doesNotMatch(source, /showEmptySlot|EMPTY|border-dashed|shadow-|glow|neon/i);
    assert.match(presentationSource, /abilityChargeCountFor/);
    assert.doesNotMatch(globalStyles, /\.ability-status-panel[^\n]*box-shadow|\.opponent-status-panel/);
});

test("responsive top status panels stay compact without shrinking their icons", () => {
    const pixiStyles = readFileSync(PIXI_CSS_PATH, "utf8");
    const pixiSource = readFileSync(PIXI_CANVAS_PATH, "utf8");
    const globalStyles = readFileSync(INDEX_CSS_PATH, "utf8");
    const panelSource = readFileSync(PANEL_PATH, "utf8");

    assert.match(pixiStyles, /grid-template-columns: minmax\(170px, 190px\) minmax\(0, 1fr\) minmax\(170px, 190px\)/);
    assert.match(pixiStyles, /\.pixi-combat-layout--fixed \.ability-status-panel[\s\S]*height: 11\.5rem;/);
    assert.match(pixiStyles, /@media \(min-width: 1181px\)[\s\S]*\.pixi-combat-layout--fixed \.ability-status-panel[\s\S]*height: 14rem;/);
    assert.match(pixiStyles, /\.pixi-combat-layout--fixed \.ability-status-panel \.ability-status-panel__header[\s\S]*margin-bottom: 0[;\s\S]*line-height: \.875rem;/);
    assert.match(pixiStyles, /\.pixi-combat-layout--fixed \.ability-status-panel \.ability-status-panel__timer[\s\S]*height: \.75rem[\s\S]*line-height: \.75rem;/);
    assert.match(pixiStyles, /\.pixi-combat-layout--fixed \.ability-status-panel \.ability-status-panel__abilities[\s\S]*max-height: 10\.25rem[\s\S]*grid-auto-rows: 3\.25rem;/);
    assert.match(pixiStyles, /\.pixi-combat-layout--fixed \.ability-status-panel__abilities[\s\S]*max-height: 8\.75rem;/);
    assert.match(pixiStyles, /grid-auto-rows: 2\.75rem;/);
    assert.match(pixiStyles, /column-gap: \.25rem;/);
    assert.match(pixiStyles, /row-gap: \.25rem;/);
    assert.match(pixiStyles, /overflow-y: auto;/);
    assert.match(pixiStyles, /\.pixi-combat-layout--fixed \.pixi-side-status \{[\s\S]*display: flex;[\s\S]*flex-direction: column-reverse;/);
    assert.match(pixiStyles, /\.pixi-combat-layout--fixed \.pixi-side-status > \* \{[\s\S]*margin-block-start: 0 !important;/);
    assert.match(pixiStyles, /\.ability-status-icon-button[\s\S]*width: 36px;[\s\S]*height: 36px;/);
    assert.match(pixiStyles, /\.ability-status-panel__abilities \.ability-status-icon-button,[\s\S]*width: 32px;[\s\S]*height: 32px;/);
    assert.doesNotMatch(pixiStyles, /overflow: visible/);
    assert.match(panelSource, /ability-status-panel__name/);
    assert.match(panelSource, /ability-status-panel__hp/);
    assert.match(panelSource, /ability-status-panel__timer/);
    assert.match(panelSource, /ability-status-ring/);
    assert.doesNotMatch(panelSource, /ability-status-panel--compact|compact =/);
    assert.doesNotMatch(pixiSource, /\bcompact\b/);
    assert.match(panelSource, /flex min-w-0 shrink-0 flex-col/);
    assert.match(globalStyles, /\.arena-stage-info \{[\s\S]*position: static;[\s\S]*height: auto;[\s\S]*flex: 0 0 auto;/);
    assert.match(globalStyles, /\.arena-stage-info > \.info-popup-panel,[\s\S]*position: static;/);
    assert.match(pixiSource, /const blueTeamBots = bots\.filter/);
    assert.match(pixiSource, /const redTeamBots = bots\.filter/);
    assert.match(pixiSource, /const showTeamStatusPanels = hasMultipleTeamMembers/);
    assert.match(pixiSource, /statusRoster=\{bots\}/);
    assert.match(pixiSource, /showParticipantNumbers=\{showParticipantNumbers\}/);
});

test("cooldown arcs render nothing at zero, a solid circle at one, and begin at 12 o'clock", () => {
    assert.equal(abilityRingArcPath(0), null);
    assert.equal(abilityRingArcPath(1), null);
    assert.match(abilityRingArcPath(0.25), /^M 18 2\.5 A 15\.5 15\.5 0 0 1 /);
    assert.match(abilityRingArcPath(0.75), /^M 18 2\.5 A 15\.5 15\.5 0 1 1 /);
});

test("Lock On keeps its white crosshair readable with a high-contrast amber accent", () => {
    assert.equal(abilityRingColorFor(20, { state: "active" }), "#facc15");
    assert.equal(abilityRingColorFor(20, { state: "preparing" }), "#facc15");
    assert.equal(abilityRingColorFor(20, { state: "cooldown" }), "#22c55e");
    assert.equal(abilityRingColorFor(20, { state: "ready" }), "#22c55e");
});

test("Lock On and missing artwork use compact safe fallbacks", () => {
    assert.equal(fallbackAbilityText(20, "Lock On"), "LO");
    assert.equal(fallbackAbilityText("unknown_future_ability", ""), "UF");
    assert.doesNotThrow(() => fallbackAbilityText(null, ""));
});

test("timer space stays stable and timed text disappears when the state is idle", () => {
    const source = readFileSync(PANEL_PATH, "utf8");
    assert.match(source, /className="ability-status-panel__timer flex h-4 w-full/);
    assert.match(source, /formatAbilityTimer\(status\.remainingMs\)/);
    assert.equal(formatAbilityTimer(0), "");
    assert.equal(formatAbilityTimer(null), "");
    assert.equal(formatAbilityTimer(950), "1.0s");
});

test("preparation, active, cooldown, and ready states use remaining-time direction", () => {
    const preparing = abilityStatusFor({
        preparingAbility: 18,
        preparingMs: 200,
    }, 18);
    assert.equal(preparing.state, "preparing");
    assert.equal(preparing.remainingMs, 200);
    assert.ok(Math.abs(preparing.progress - (1 / 3)) < 0.0001);
    assert.equal(abilityRingBackground(preparing), "conic-gradient(from 0deg, #facc15 0 100.00%, #64748b 100.00% 100%)");

    const active = abilityStatusFor({ abilityActiveMs: { 7: 200 } }, 7);
    assert.equal(active.state, "active");
    assert.equal(active.remainingMs, 200);
    assert.match(abilityRingBackground(active), /#7dd3fc/);

    const lockOn = abilityStatusFor({ abilityActiveMs: { 20: 200 } }, 20);
    assert.equal(lockOn.state, "active");
    assert.equal(lockOn.durationMs, 200);

    const dash = abilityStatusFor({
        abilityActiveMs: { 19: 200 },
        dashActiveMs: 200,
    }, 19);
    assert.equal(dash.state, "active");
    assert.equal(dash.durationMs, 200);
    assert.ok(Math.abs(dash.progress - 0) < 0.0001);

    const cooldown = abilityStatusFor({ abilityCooldowns: { 7: 2500 } }, 7);
    assert.equal(cooldown.state, "cooldown");
    assert.equal(cooldown.durationMs, 4600);
    assert.ok(Math.abs(cooldown.progress - (1 - 2500 / 4600)) < 0.0001);
    assert.match(abilityRingBackground(cooldown), /from 0deg/);
    assert.match(abilityRingBackground(cooldown), /#22c55e/);
    assert.match(abilityRingBackground(cooldown), /#64748b/);

    const reactiveArmorCooldown = abilityStatusFor({ abilityCooldowns: { 16: 9000 } }, 16);
    assert.equal(reactiveArmorCooldown.state, "cooldown");
    assert.equal(reactiveArmorCooldown.durationMs, 9000);
    assert.equal(reactiveArmorCooldown.progress, 0);

    const ready = abilityStatusFor({ abilityCooldowns: { 7: 0 } }, 7);
    assert.equal(ready.state, "ready");
    assert.equal(ready.progress, 1);
    assert.match(abilityRingBackground(ready), /#22c55e 0 100\.00%/);

    for (const abilityId of [3, 5]) {
        const canonicalReplayState = abilityStatusFor({
            abilityCooldowns: { [abilityId]: 0 },
            abilityCharges: { [abilityId]: 1 },
            abilityRechargeMs: { [abilityId]: 0 },
        }, abilityId);
        assert.equal(canonicalReplayState.state, "ready", `ability ${abilityId}`);
        assert.equal(abilityRingColorFor(abilityId, canonicalReplayState), "#22c55e");
    }
});

test("all ability resources use the canonical charge and recharge maps", () => {
    assert.equal(abilityChargeCountFor({ abilityCharges: { 19: 1 } }, 19), null);

    const gunReload = abilityStatusFor({
        abilityCooldowns: { 3: 0 },
        abilityCharges: { 3: 0 },
        abilityRechargeMs: { 3: 1500 },
    }, 3);
    assert.equal(gunReload.state, "cooldown");
    assert.equal(gunReload.durationMs, 5000);
    assert.equal(gunReload.progress, 0.7);
    assert.equal(abilityChargeCountFor({ abilityCharges: { 3: 7 } }, 3), 6);

    const fireballReload = abilityStatusFor({
        abilityCooldowns: { 5: 0 },
        abilityCharges: { 5: 0 },
        abilityRechargeMs: { 5: 2250 },
    }, 5);
    assert.equal(fireballReload.state, "cooldown");
    assert.equal(fireballReload.progress, 0.55);
    assert.equal(abilityChargeCountFor({ abilityCharges: { 5: 3 } }, 5), 3);

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
    assert.equal(abilityChargeCountFor({ abilityCharges: { 2: 12 } }, 2), null);
});

test("both panels share the same stable dimensions and empty positions remain open", () => {
    const source = readFileSync(PANEL_PATH, "utf8");
    assert.equal((source.match(/h-\[17\.5rem\]/g) ?? []).length, 1);
    assert.equal((source.match(/grid-cols-3/g) ?? []).length, 1);
    assert.doesNotMatch(source, /Array\.from\(\{ length: abilities\.length/);
    assert.doesNotMatch(source, /SLOT .*EMPTY/);
});
