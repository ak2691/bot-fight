import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { MAIN_SHAPE, resetBotShapeToStartingConfiguration, toSimulationBotShape } from "../modelPayloads/arenaShapes.js";
import { createPreviewBaseline, restorePreviewBaseline } from "../modelPayloads/previewBaseline.js";
import { createPresentationClock } from "./presentationClock.js";
import { clearPresentationArtifacts, initialPresentationViewState } from "./presentationReset.js";

function fakeDisplay() {
    const parent = {
        children: [],
        removeChild(display) {
            this.children = this.children.filter((child) => child !== display);
            display.parent = null;
        },
    };
    const display = {
        parent,
        destroyed: false,
        destroy() {
            this.destroyed = true;
        },
    };
    parent.children.push(display);
    return { display, parent };
}

test("reset view state snaps visual bot position and rotation to the practice setup source", () => {
    const resetBot = resetBotShapeToStartingConfiguration(MAIN_SHAPE, {
        startX: 235,
        startY: 415,
        rotation: 127,
    });
    const [restoredBot] = restorePreviewBaseline(createPreviewBaseline([resetBot]));
    const visualBot = toSimulationBotShape(restoredBot);
    const viewState = initialPresentationViewState(visualBot, 900);

    assert.equal(viewState.shape, visualBot);
    assert.equal(viewState.authoritativeShape, visualBot);
    assert.deepEqual(viewState.motion, {
        from: { x: visualBot.x, y: visualBot.y },
        to: { x: visualBot.x, y: visualBot.y },
        startedAt: 900,
        durationMs: 0,
    });
    assert.equal(viewState.shape.rotation, visualBot.rotation);
    assert.equal(viewState.shape.rotation, 127);
});

test("reset clears entity views, standalone effects, particles, and lock-on markers", () => {
    const botDisplay = fakeDisplay();
    const entityDisplay = fakeDisplay();
    const standaloneDisplay = fakeDisplay();
    const markerDisplay = fakeDisplay();
    const particleDisplay = fakeDisplay();
    const views = new Map([["main", { container: botDisplay.display }], ["grenade", { container: entityDisplay.display }]]);
    const visualViews = new Map([["event:main:1", { container: standaloneDisplay.display }]]);
    const lockOnMarkers = new Map([["main", { container: markerDisplay.display }]]);
    const particles = [{ display: particleDisplay.display, lifeMs: 300 }];

    clearPresentationArtifacts({ views, visualViews, lockOnMarkers, particles });

    assert.equal(views.size, 0);
    assert.equal(visualViews.size, 0);
    assert.equal(lockOnMarkers.size, 0);
    assert.deepEqual(particles, []);
    for (const { display, parent } of [botDisplay, entityDisplay, standaloneDisplay, markerDisplay, particleDisplay]) {
        assert.equal(display.destroyed, true);
        assert.deepEqual(parent.children, []);
    }
});

test("a paused reset resumes from its reset snapshot without counting paused time", () => {
    let wallMs = 1000;
    const clock = createPresentationClock({ now: () => wallMs });
    const resetShape = { id: "main", x: 240, y: 390, rotation: 127 };
    wallMs += 80;
    assert.deepEqual(clock.advance(), { timeMs: 80, deltaMs: 80 });
    clock.setPaused(true);
    const resetState = initialPresentationViewState(resetShape, clock.current());

    wallMs += 5000;
    assert.deepEqual(clock.advance(), { timeMs: 80, deltaMs: 0 });
    assert.equal(resetState.motion.startedAt, 80);
    assert.equal(resetState.motion.durationMs, 0);

    clock.setPaused(false);
    wallMs += 25;
    assert.deepEqual(clock.advance(), { timeMs: 105, deltaMs: 25 });
    assert.deepEqual(resetState.motion.from, { x: 240, y: 390 });
    assert.deepEqual(resetState.motion.to, { x: 240, y: 390 });
    assert.equal(resetState.shape.rotation, 127);
});

test("Reset Stats keeps autoplay state and requests an immediate Pixi presentation reset", () => {
    const arenaSource = readFileSync(fileURLToPath(new URL("../Arena.jsx", import.meta.url)), "utf8");
    const pixiSource = readFileSync(fileURLToPath(new URL("./PixiCanvas.jsx", import.meta.url)), "utf8");
    const autoPlaySource = readFileSync(fileURLToPath(new URL("../hooks/useArenaAutoPlay.js", import.meta.url)), "utf8");
    const resetActionStart = arenaSource.indexOf("const resetArenaStats = () => {");
    const resetActionEnd = arenaSource.indexOf("const handleAutoPlayToggle =", resetActionStart);
    const resetAction = arenaSource.slice(resetActionStart, resetActionEnd);

    assert.match(resetAction, /setPresentationResetVersion\(\(version\) => version \+ 1\)/);
    assert.match(resetAction, /setShapes\(restorePreviewBaseline\(previewBaseline\)\)/);
    assert.doesNotMatch(resetAction, /stopAutoPlay\(/);
    assert.doesNotMatch(autoPlaySource, /buildTutorialArenaShapes|buildAutoPlayStartShapes/);
    assert.match(arenaSource, /presentationResetVersion=\{presentationResetVersion\}/);
    assert.match(pixiSource, /useLayoutEffect\(\(\) => \{[\s\S]*runtimeRef\.current\?\.setPlaying\(isPlaying\);[\s\S]*if \(resetPresentation\) runtimeRef\.current\?\.resetPresentation\(presentationShapes\)/);
    assert.match(pixiSource, /function resetPresentation\(nextShapes\) \{[\s\S]*clearPresentationArtifacts\([\s\S]*syncShapes\(nextShapes, \{ snapPositions: true, suppressTransientPresentation: true \}\);[\s\S]*render\(presentationClock\.current\(\)\)/);
});
