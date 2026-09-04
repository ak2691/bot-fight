import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { ABILITY_STATS } from "../gameconfig/Abilities.js";
import { sweepAngle } from "../gameconfig/visualState.js";
import { animationFrameAt, FIREBALL_FRAME_INTERVAL_MS, FIREBALL_FRAME_NAMES, orderedAnimationFrames } from "./abilityAnimationFrames.js";
import { HEAVY_SLASH_ART_ROTATION_OFFSET, heavySlashRotation } from "./pixiVisualState.js";
import { visualRayLength } from "./rayPresentationGeometry.js";
import { compassDegreesToRadians } from "../botlogic/planner/arenaAngles.js";

const CROSSHAIR_PATH = fileURLToPath(new URL("../../assets/arena/abilities/support/crosshair.png", import.meta.url));
const PIXI_CANVAS_PATH = fileURLToPath(new URL("./PixiCanvas.jsx", import.meta.url));
const PIXI_APPLICATION_PATH = fileURLToPath(new URL("./pixiApplication.js", import.meta.url));
const PRESENTATION_ASSET_HOOK_PATH = fileURLToPath(new URL("./useArenaPresentationAssets.js", import.meta.url));
const PRESENTATION_ASSET_PROVIDER_PATH = fileURLToPath(new URL("./ArenaPresentationAssetsProvider.jsx", import.meta.url));
const PROTECTED_ROUTE_PATH = fileURLToPath(new URL("../../auth/ProtectedRoute.jsx", import.meta.url));

function closeTo(actual, expected) {
    assert.ok(Math.abs(actual - expected) < 1e-9, `${actual} !== ${expected}`);
}

test("Heavy Slash presentation alignment preserves all four cardinal facings", () => {
    for (const facing of [0, 90, 180, 270]) {
        closeTo(heavySlashRotation(facing), compassDegreesToRadians(facing) + HEAVY_SLASH_ART_ROTATION_OFFSET);
    }
    // The reported regression case: west must use the corrected west-facing
    // reference rotation instead of the old south-facing result.
    closeTo(heavySlashRotation(270), Math.PI * 3 / 2);
});

test("Heavy Slash alignment preserves the existing 150-degree sweep and bot state", () => {
    const bot = { rotation: 270, x: 400, y: 500 };
    const startSweep = sweepAngle(ABILITY_STATS[7].visualMs, ABILITY_STATS[7].visualMs, -75, 75);
    const endSweep = sweepAngle(100, ABILITY_STATS[7].visualMs, -75, 75);
    const start = heavySlashRotation(bot.rotation, startSweep);
    const end = heavySlashRotation(bot.rotation, endSweep);
    closeTo(end - start, Math.PI * 150 / 180);
    assert.deepEqual(bot, { rotation: 270, x: 400, y: 500 });
});

test("Fireball explicitly loads five ordered frames and loops frame five to frame one", () => {
    assert.deepEqual(FIREBALL_FRAME_NAMES, ["001.png", "002.png", "003.png", "004.png", "005.png"]);
    const frames = orderedAnimationFrames(Object.fromEntries(FIREBALL_FRAME_NAMES.map((name) => [name, name])), FIREBALL_FRAME_NAMES);
    assert.deepEqual(frames, FIREBALL_FRAME_NAMES);
    assert.equal(frames.length, 5);
    assert.equal(FIREBALL_FRAME_INTERVAL_MS, 65);
    assert.equal(animationFrameAt(frames, 0, FIREBALL_FRAME_INTERVAL_MS), "001.png");
    assert.equal(animationFrameAt(frames, 260, FIREBALL_FRAME_INTERVAL_MS), "005.png");
    assert.equal(animationFrameAt(frames, 325, FIREBALL_FRAME_INTERVAL_MS), "001.png");
});

test("Fireball obsolete frames are not referenced or present", () => {
    const fireballDir = fileURLToPath(new URL("../../assets/arena/abilities/projectiles/fireball/", import.meta.url));
    for (const frameNumber of [6, 7, 8, 9, 10]) {
        assert.equal(existsSync(`${fireballDir}${String(frameNumber).padStart(3, "0")}.png`), false);
    }
});

test("generic animation frame selection still loops unrelated projectile frames", () => {
    const grenadeFrames = ["moving-001", "moving-002", "moving-003"];
    assert.equal(animationFrameAt(grenadeFrames, 65, 65), "moving-002");
    assert.equal(animationFrameAt(grenadeFrames, 195, 65), "moving-001");
});

test("entity visuals use a renderer-clock animation instance without the fallback particle burst", () => {
    const source = readFileSync(fileURLToPath(new URL("./PixiCanvas.jsx", import.meta.url)), "utf8");
    assert.match(source, /visualAnimationStartedAt: visualAnimation.startedAt/);
    assert.match(source, /visualAnimationElapsedMs\(view, now\)/);
    assert.match(source, /visualAnimationIsActive\(view, now\)/);
    assert.doesNotMatch(source, /\["grenadeExplosion", "mineExplosion", "orbitalExplosion"\]/);
});

test("Lock On uses the supplied white crosshair and hides the marker when its active timer ends", () => {
    assert.equal(existsSync(CROSSHAIR_PATH), true);
    const source = readFileSync(PIXI_CANVAS_PATH, "utf8");
    assert.match(source, /lockOnCrosshair/);
    assert.match(source, /Number\(shape\.abilityActiveMs\?\.\[20\] \?\? 0\) <= 0/);
    assert.match(source, /marker\.container\.visible = false/);
    assert.match(source, /crosshair\.tint = 0xffffff/);
    assert.doesNotMatch(source, /halo\.circle/);
    assert.doesNotMatch(source, /LOCK_ON_PRESENTATION\.accentColor/);
});

test("ray sprite widths compensate for the presentation muzzle anchor", () => {
    closeTo(visualRayLength(700), 700 / 0.96);
    closeTo(visualRayLength(500), 500 / 0.96);
    closeTo(visualRayLength(900, 0), 900);
});

test("Overclock uses the emerald clock status icon above the bot name", () => {
    const source = readFileSync(PIXI_CANVAS_PATH, "utf8");
    assert.match(source, /OVERCLOCK: \{ foreground: 0xa7f3d0, background: 0x022c22, border: 0x34d399 \}/);
    assert.match(source, /status === "OVERCLOCK"/);
    assert.match(source, /graphics\.circle\(x, y, 8\.5\)\.stroke\(\{ color, width: 1\.8 \}\)/);
    assert.match(source, /graphics\.moveTo\(x, y - 5\)\.lineTo\(x, y\)\.lineTo\(x \+ 3\.5, y \+ 2\)/);
});

test("PixiCanvas consumes the shared application instead of owning a second asset loader", () => {
    const source = readFileSync(PIXI_CANVAS_PATH, "utf8");
    assert.match(source, /import ArenaLoadingScreen from ["']\.\.\/\.\.\/components\/ArenaLoadingScreen\.jsx["']/);
    assert.match(source, /acquirePixiApplication/);
    assert.match(source, /attachPixiApplication/);
    assert.match(source, /releasePixiApplication/);
    assert.match(source, /const \[arenaReady, setArenaReady\] = useState\(false\)/);
    assert.match(source, /!arenaReady && !assetError && <ArenaLoadingScreen overlay label="Loading arena\.\.\." \/>/);
    assert.doesNotMatch(source, /Loading assets\.\.\./);
});

test("setup can move protected participant bots without making them deletable", () => {
    const pixiSource = readFileSync(PIXI_CANVAS_PATH, "utf8");
    const arenaSource = readFileSync(fileURLToPath(new URL("../Arena.jsx", import.meta.url)), "utf8");

    assert.match(pixiSource, /allowLockedBotEditing = false/);
    assert.match(pixiSource, /!shape\.locked \|\| optionsRef\.current\.allowLockedBotEditing/);
    assert.match(pixiSource, /if \(!canEditBot\(view\.shape\)\) return;/);
    assert.match(arenaSource, /const allowLockedBotEditing = isPuzzleMode \|\| isTutorialArenaIntro \|\| \(isMatchTesting && finishStatus === "BUILDING"\)/);
    assert.match(arenaSource, /shape\.id === id && \(!shape\.locked \|\| allowLockedBotEditing\)/);
    assert.match(arenaSource, /allowLockedBotEditing=\{allowLockedBotEditing\}/);
    assert.match(arenaSource, /if \(!isEditingArena \|\| !selected \|\| selected\.id === "main" \|\| selected\.locked\) return prev;/);
});

test("Pixi warmup renders into a disposable target instead of the visible canvas", () => {
    const source = readFileSync(PIXI_APPLICATION_PATH, "utf8");
    assert.match(source, /RenderTexture\.create\(\{ width: 1, height: 1 \}\)/);
    assert.match(source, /target: warmupTexture/);
    assert.match(source, /warmupTexture\.destroy\(true\)/);
});

test("small responsive arenas keep a high-enough backing resolution", () => {
    const source = readFileSync(PIXI_APPLICATION_PATH, "utf8");

    assert.match(source, /const MIN_ARENA_RENDERER_RESOLUTION = 1\.5/);
    assert.match(source, /Math\.max\(MIN_ARENA_RENDERER_RESOLUTION, ratio\)/);
});

test("Pixi modules stay out of login until the authenticated asset gate starts", () => {
    const hookSource = readFileSync(PRESENTATION_ASSET_HOOK_PATH, "utf8");
    const providerSource = readFileSync(PRESENTATION_ASSET_PROVIDER_PATH, "utf8");
    const protectedRouteSource = readFileSync(PROTECTED_ROUTE_PATH, "utf8");
    assert.doesNotMatch(hookSource, /from ["']\.\/arenaPresentationAssets\.js["']/);
    assert.doesNotMatch(hookSource, /from ["']\.\/pixiApplication\.js["']/);
    assert.match(hookSource, /import\("\.\/arenaPresentationAssets\.js"\)/);
    assert.match(hookSource, /import\("\.\/pixiApplication\.js"\)/);
    assert.match(providerSource, /useArenaPresentationAssets\(\{ enabled: isAuthenticated && !isLoading \}\)/);
    assert.doesNotMatch(providerSource, /showDetailedProgress/);
    assert.match(protectedRouteSource, /useArenaPresentationAssetsContext/);
    assert.doesNotMatch(protectedRouteSource, /AssetsLoadingScreen/);
    assert.doesNotMatch(protectedRouteSource, /assets\.showDetailedProgress/);
    assert.match(protectedRouteSource, /isArenaPresentationGateReady/);
    assert.match(protectedRouteSource, /Initializing game renderer\.\.\./);
    assert.doesNotMatch(protectedRouteSource, /Preparing ability icons\.\.\./);
    assert.match(protectedRouteSource, /onRetry=\{assets\.error \? assets\.retry : null\}/);
});

test("asset preload completion keeps the owner state instead of storing the texture catalogue", () => {
    const hookSource = readFileSync(PRESENTATION_ASSET_HOOK_PATH, "utf8");
    assert.doesNotMatch(hookSource, /assetsPromise\.then\(update,\s*update\)/);
    assert.match(hookSource, /update\(assetsApi\.getArenaPresentationAssetsState\(\)\)/);
});

test("asset decoding, Pixi initialization, and route preloading start concurrently", () => {
    const hookSource = readFileSync(PRESENTATION_ASSET_HOOK_PATH, "utf8");
    assert.match(hookSource, /startPixiPreload\(assetsPromise, active,/);
    assert.match(hookSource, /Promise\.all\(\[cataloguePromise, pixiPromise\]\)/);
    assert.match(hookSource, /rendererReady/);
    assert.match(hookSource, /gpuWarmupReady/);
    assert.match(hookSource, /backgroundError/);
    assert.doesNotMatch(hookSource, /preloadAbilityCatalogueIcons|iconsReady|iconsError/);
    assert.doesNotMatch(hookSource, /assetsPromise\.then\(async \(catalogue\)/);
});
