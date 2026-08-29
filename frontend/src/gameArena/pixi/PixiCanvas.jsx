import { useEffect, useRef, useState } from "react";
import { Circle, Container, Graphics, Rectangle, Sprite, Text } from "pixi.js";
import ArenaLoadingScreen from "../../components/ArenaLoadingScreen.jsx";
import AbilityStatusPanel from "../status/AbilityStatusPanel.jsx";
import { ABILITY_STATS } from "../gameconfig/Abilities.js";
import { ABILITIES } from "../gameconfig/AbilityRegistry.js";
import { CLOSING_ZONE_TYPE } from "../gameconfig/ArenaHazardConfig.js";
import { abilityActiveOpacity, basicHealParticleSpec, combatVisualRemainingMs, healthBarPercent, abilityVisualOpacity, BASIC_HEAL_PARTICLE_COUNT, REPULSOR_BURST_VISUAL_MS, repulsorBurstDiameter, repulsorBurstFrameIndex, repulsorBurstProgress, sweepAngle, visualProgress } from "../gameconfig/visualState.js";
import { ARENA_HEIGHT_UNITS, ARENA_WIDTH_UNITS, BOT_SIZE } from "../modelPayloads/arenaConstants.js";
import { toSimulationBotShape } from "../modelPayloads/arenaShapes.js";
import { interpolatePosition } from "./snapshotInterpolation.js";
import { activeBotVisual, closingZoneDamageOccurred, entityCaption, botColorRole, botInteriorAlpha, botMovementRotation, botSpritesOverlap, botStatusLabels, grenadeDetonateProgress, heavySlashRotation, isBotShape, LOCK_ON_PRESENTATION, lockOnTargetPoint, pixiLayerForShape, presentationDefinitionForShape, projectileTrailStyle, shapeInterpolationMs } from "./pixiVisualState.js";
import { spriteFrame, spriteFrameAtProgress } from "./arenaSpriteAssets.js";
import { loadArenaPresentationAssets, retryArenaPresentationAssets } from "./arenaPresentationAssets.js";
import { textureMuzzleAnchor } from "./abilitySpriteAssets.js";
import { advanceParticle } from "./particleMotion.js";
import { createPresentationClock } from "./presentationClock.js";
import { compassDegreesToRadians, vectorToCompassDegrees } from "../botlogic/planner/arenaAngles.js";
import { acquirePixiApplication, attachPixiApplication, releasePixiApplication } from "./pixiApplication.js";
import { statusIsActive } from "../ecs/contracts/StatusContracts.js";
import "./PixiCanvas.css";

const MIN_ZOOM = 1;
const MAX_ZOOM = 2.5;
const COLORS = Object.freeze({
    arena: 0x0d1117,
    grid: 0x253442,
    gridMajor: 0x3b4c5e,
    closingZone: 0x8b5cf6,
    player: 0x57b8ff,
    opponent: 0xff7166,
    white: 0xf8fafc,
    hp: 0xdc2626,
});

export default function PixiCanvas({
    shapes,
    selectedId,
    onSelectShape,
    onUpdateShape,
    onDeselectAll,
    editable = true,
    placementSide = null,
    fillAvailable = false,
    abilityLayout = "split",
    showEmptyAbilitySlot = false,
    showMissingOpponentStatus = true,
    showParticipantNumbers = false,
    abilityInfoEnabled = false,
    arenaSize = null,
    fixedLayout = false,
    lockCamera = false,
    isPlaying = true,
    measurementEnabled = false,
    measurementPoints = [],
    onMeasurementPointsChange = () => { },
    allowBotRotation = false,
}) {
    const presentationShapes = shapes.map(toSimulationBotShape);
    const hostRef = useRef(null);
    const runtimeRef = useRef(null);
    const optionsRef = useRef({});
    const [assetError, setAssetError] = useState(null);
    const [arenaReady, setArenaReady] = useState(false);
    const [assetRetryToken, setAssetRetryToken] = useState(0);
    useEffect(() => {
        optionsRef.current = {
            shapes: presentationShapes,
            selectedId,
            onSelectShape,
            onUpdateShape,
            onDeselectAll,
            editable,
            placementSide,
            lockCamera,
            isPlaying,
            measurementEnabled,
            measurementPoints,
            onMeasurementPointsChange,
            allowBotRotation,
        };
        runtimeRef.current?.setPlaying(isPlaying);
        runtimeRef.current?.syncShapes(presentationShapes);
    }, [allowBotRotation, editable, isPlaying, lockCamera, measurementEnabled, measurementPoints, onDeselectAll, onMeasurementPointsChange, onSelectShape, onUpdateShape, placementSide, selectedId, presentationShapes]);

    useEffect(() => {
        let disposed = false;
        let app = null;
        let detachResizeObserver = () => { };

        async function mount() {
            const host = hostRef.current;
            if (!host) return;
            setArenaReady(false);
            try {
                const arenaSprites = await loadArenaPresentationAssets();
                if (disposed) return;
                app = await acquirePixiApplication();
                if (disposed) {
                    releasePixiApplication(app);
                    app = null;
                    return;
                }
                app.canvas.setAttribute("aria-label", "PixiJS bot-room arena");
                detachResizeObserver = attachPixiApplication(app, host);
                runtimeRef.current = createArenaRuntime(app, optionsRef, arenaSprites);
                runtimeRef.current.syncShapes(optionsRef.current.shapes ?? []);
                setAssetError(null);
                setArenaReady(true);
            } catch (error) {
                if (!disposed) {
                    setAssetError(error);
                    setArenaReady(false);
                }
            }
        }

        mount();
        return () => {
            disposed = true;
            runtimeRef.current?.destroy();
            runtimeRef.current = null;
            detachResizeObserver();
            if (app) releasePixiApplication(app);
        };
    }, [assetRetryToken]);

    const retryAssetLoad = () => {
        setAssetError(null);
        setArenaReady(false);
        void retryArenaPresentationAssets().catch(() => { });
        setAssetRetryToken((current) => current + 1);
    };

    const bots = presentationShapes.filter(isBotShape);
    const blueTeamBots = bots.filter((bot) => botColorRole(bot) === "blue");
    const redTeamBots = bots.filter((bot) => botColorRole(bot) === "red");
    const hasMultipleTeamMembers = blueTeamBots.length > 1 || redTeamBots.length > 1;
    const showTeamStatusPanels = hasMultipleTeamMembers
        || (!showMissingOpponentStatus && (blueTeamBots.length === 0 || redTeamBots.length === 0));
    const playerBot = bots.find((bot) => bot.id === "main")
        ?? bots.find((bot) => Number(bot.slot) === 1)
        ?? bots[0];
    const opponentBot = bots.find((bot) => bot.id === "opponent-model")
        ?? bots.find((bot) => bot.id !== playerBot?.id);
    const opponentStatusBot = opponentBot
        ?? (showMissingOpponentStatus ? { id: "opponent-model", slot: 2, teamNumber: 2, abilities: [], opponentUsername: "OPPONENT" } : null);
    const renderStatusPanels = (teamBots) => teamBots.map((bot) => (
        <AbilityStatusPanel key={bot.id ?? `slot-${bot.slot}`} bot={bot} compact={hasMultipleTeamMembers} statusRoster={bots} showParticipantNumbers={showParticipantNumbers} showEmptySlot={showEmptyAbilitySlot} abilityInfoEnabled={abilityInfoEnabled} />
    ));
    const layoutClass = fixedLayout
        ? abilityLayout === "right"
            ? "pixi-combat-layout--fixed pixi-combat-layout--right max-w-[1120px]"
            : "pixi-combat-layout--fixed pixi-combat-layout--split max-w-[1360px]"
        : abilityLayout === "right"
            ? "max-w-[1120px] grid-cols-1 lg:grid-cols-[minmax(0,880px)_220px]"
            : "max-w-[1360px] grid-cols-1 lg:grid-cols-[220px_minmax(0,860px)_220px]";

    return (
        <div className={`relative mx-auto grid w-full items-center justify-center gap-3 ${layoutClass}`}>
            {!arenaReady && !assetError && <ArenaLoadingScreen overlay label="Loading arena..." />}
            {abilityLayout !== "right" && (
                <div className={`pixi-player-status space-y-3 ${fixedLayout ? "order-1 min-w-0" : "order-2 min-w-0 lg:order-1"} ${fixedLayout ? "pixi-side-status" : ""}`}>
                    {showTeamStatusPanels ? renderStatusPanels(blueTeamBots) : playerBot && <AbilityStatusPanel bot={playerBot} statusRoster={bots} showParticipantNumbers={showParticipantNumbers} showEmptySlot={showEmptyAbilitySlot} abilityInfoEnabled={abilityInfoEnabled} />}
                </div>
            )}
            <div
                className={`pixi-arena-surface relative justify-self-center overflow-hidden rounded-xl border border-border-mid bg-[#0d1117] ${fixedLayout ? "order-2" : "order-1 lg:order-2"}`}
                style={{
                    width: arenaSize ?? (fillAvailable ? "min(100%, 860px, calc(100svh - 90px))" : "min(100%, 860px, calc(100svh - 140px))"),
                    minWidth: fixedLayout ? "400px" : undefined,
                    aspectRatio: `${ARENA_WIDTH_UNITS} / ${ARENA_HEIGHT_UNITS}`,
                }}
                onContextMenu={(event) => event.preventDefault()}
            >
                <div ref={hostRef} className="pixi-arena-host absolute inset-0" />
                {assetError && (
                    <div role="alert" className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-3 bg-[#0d1117] px-6 text-center text-slate-300">
                        <p className="font-mono text-[11px] font-bold tracking-[0.18em] text-red-300">ARENA ASSETS UNAVAILABLE</p>
                        <p className="max-w-md text-xs leading-5 text-slate-400">
                            {assetError.assetId ? `Failed asset: ${assetError.assetId}. ` : "The Pixi arena could not initialize. "}
                            {assetError.message}
                        </p>
                        <button type="button" onClick={retryAssetLoad} className="border border-cyan-500/70 bg-cyan-950/30 px-4 py-2 font-mono text-[10px] font-bold tracking-widest text-cyan-200 hover:bg-cyan-900/50">
                            RETRY ARENA ASSETS
                        </button>
                    </div>
                )}
                {!lockCamera && (
                    <div className="pixi-arena-help pointer-events-none absolute bottom-2 left-1/2 -translate-x-1/2 rounded border border-slate-700/70 bg-zinc-950/75 px-2 py-1 text-center font-mono text-[8px] tracking-widest text-slate-400">
                        WHEEL OR PINCH TO ZOOM · DRAG EMPTY SPACE TO PAN{allowBotRotation ? " · RIGHT-DRAG BOT TO ROTATE" : ""}
                    </div>
                )}
            </div>
            <div className={`pixi-opponent-status order-3 min-w-0 space-y-3 ${fixedLayout ? "pixi-side-status" : ""}`}>
                {abilityLayout === "right"
                        ? (showTeamStatusPanels
                            ? [...blueTeamBots, ...redTeamBots].map((bot) => (
                            <AbilityStatusPanel key={bot.id ?? `slot-${bot.slot}`} bot={bot} compact statusRoster={bots} showParticipantNumbers={showParticipantNumbers} showEmptySlot={showEmptyAbilitySlot} abilityInfoEnabled={abilityInfoEnabled} />
                        ))
                        : playerBot && <AbilityStatusPanel bot={playerBot} statusRoster={bots} showParticipantNumbers={showParticipantNumbers} showEmptySlot={showEmptyAbilitySlot} abilityInfoEnabled={abilityInfoEnabled} />)
                    : showTeamStatusPanels
                        ? renderStatusPanels(redTeamBots)
                        : opponentStatusBot && <AbilityStatusPanel bot={opponentStatusBot} statusRoster={bots} showParticipantNumbers={showParticipantNumbers} showEmptySlot={showEmptyAbilitySlot} abilityInfoEnabled={abilityInfoEnabled} />}
            </div>
        </div>
    );
}

function createArenaRuntime(app, optionsRef, arenaSprites) {
    const presentationClock = createPresentationClock({ isPaused: optionsRef.current.isPlaying === false });
    const camera = new Container();
    const background = new Graphics();
    const layers = {
        zones: new Container(),
        projectiles: new Container(),
        entities: new Container(),
        bots: new Container(),
        lockOn: new Container(),
    };
    const particleLayer = new Container();
    const measurementLayer = new Container();
    const overlay = new Graphics();
    background.eventMode = "none";
    layers.zones.eventMode = "none";
    layers.projectiles.eventMode = "none";
    layers.entities.eventMode = "none";
    layers.lockOn.eventMode = "none";
    particleLayer.eventMode = "none";
    measurementLayer.eventMode = "none";
    overlay.eventMode = "none";
    camera.addChild(background, layers.zones, layers.projectiles, layers.entities, layers.bots, layers.lockOn, particleLayer, measurementLayer, overlay);
    app.stage.addChild(camera);
    app.stage.eventMode = "static";
    drawArena(background);

    const views = new Map();
    const lockOnMarkers = new Map();
    const particles = [];
    let zoom = MIN_ZOOM;
    let viewCenter = { x: ARENA_WIDTH_UNITS / 2, y: ARENA_HEIGHT_UNITS / 2 };
    let drag = null;
    let rotationDrag = null;
    let pan = null;
    let measurementSignature = null;
    let measurementHoverPoint = null;
    const touchPoints = new Map();
    let pinch = null;

    function updateCamera() {
        if (optionsRef.current.lockCamera) {
            zoom = MIN_ZOOM;
            viewCenter = { x: ARENA_WIDTH_UNITS / 2, y: ARENA_HEIGHT_UNITS / 2 };
        }
        const baseScale = Math.min(app.screen.width / ARENA_WIDTH_UNITS, app.screen.height / ARENA_HEIGHT_UNITS);
        const scale = baseScale * zoom;
        const halfWidth = app.screen.width / scale / 2;
        const halfHeight = app.screen.height / scale / 2;
        viewCenter = {
            x: clamp(viewCenter.x, Math.min(500, halfWidth), Math.max(500, ARENA_WIDTH_UNITS - halfWidth)),
            y: clamp(viewCenter.y, Math.min(500, halfHeight), Math.max(500, ARENA_HEIGHT_UNITS - halfHeight)),
        };
        camera.scale.set(scale);
        camera.position.set(app.screen.width / 2 - viewCenter.x * scale, app.screen.height / 2 - viewCenter.y * scale);
        app.stage.hitArea = new Rectangle(0, 0, app.screen.width, app.screen.height);
    }

    function canvasPoint(event) {
        const bounds = app.canvas.getBoundingClientRect();
        return { x: event.clientX - bounds.left, y: event.clientY - bounds.top };
    }

    function touchPair() {
        return [...touchPoints.values()].slice(0, 2);
    }

    function touchDistance(first, second) {
        return Math.hypot(second.x - first.x, second.y - first.y);
    }

    function touchMidpoint(first, second) {
        return { x: (first.x + second.x) / 2, y: (first.y + second.y) / 2 };
    }

    function createView(shape, now = presentationClock.current()) {
        const container = new Container();
        const baseSprite = new Sprite();
        baseSprite.anchor.set(0.5);
        baseSprite.eventMode = "none";
        const cachedEffects = new Map();
        const graphics = new Graphics();
        graphics.eventMode = "none";
        const caption = new Text({ text: "", style: { fill: COLORS.white, fontFamily: "monospace", fontSize: 13, fontWeight: "bold", align: "center" } });
        caption.anchor.set(0.5);
        caption.eventMode = "none";
        container.addChild(baseSprite, graphics, caption);
        container.eventMode = isBotShape(shape) ? "static" : "none";
        container.cursor = isBotShape(shape) && !shape.locked && optionsRef.current.editable ? "grab" : "default";
        container.hitArea = new Circle(0, 0, Math.max(12, Number(shape.size ?? (isBotShape(shape) ? BOT_SIZE : 30)) / 2 + 6));
        const view = {
            container,
            baseSprite,
            cachedEffects,
            graphics,
            caption,
            shape,
            blockHeldStartedAt: null,
            dashSmokeOrigin: null,
            dashSmokeRotation: 0,
            dashSmokeStartedAt: null,
            repulsorBurstStartedAt: repulsorBurstStartTime(shape, now),
            entityAnimationStartedAt: entityAnimationStartTime(shape, now),
            motion: { from: { x: shape.x, y: shape.y }, to: { x: shape.x, y: shape.y }, startedAt: now, durationMs: 0 },
        };
        layers[pixiLayerForShape(shape)].addChild(container);
        container.on("pointerdown", (event) => beginDrag(event, view));
        return view;
    }

    function sampleViewPosition(view, now = presentationClock.current()) {
        const alpha = view.motion.durationMs <= 0 ? 1 : clamp((now - view.motion.startedAt) / view.motion.durationMs, 0, 1);
        return interpolatePosition(view.motion.from, view.motion.to, alpha);
    }

    function syncShapes(nextShapes) {
        const now = presentationClock.current();
        const nextIds = new Set(nextShapes.map((shape) => shape.id));
        for (const [id, view] of views) {
            if (nextIds.has(id)) continue;
            view.container.destroy({ children: true });
            views.delete(id);
        }
        for (const shape of nextShapes) {
            let view = views.get(shape.id);
            if (!view) {
                view = createView(shape, now);
                views.set(shape.id, view);
                if (["mineExplosion", "orbitalExplosion"].includes(shape.type)) {
                    spawnBurst(shape.x, shape.y, explosionColor(shape.type), shape.type === "orbitalExplosion" ? 30 : 18);
                }
            }
            const previousShape = view.shape;
            const current = sampleViewPosition(view, now);
            const wasDashing = Number(previousShape?.dashActiveMs ?? 0) > 0;
            const startsDashing = Number(shape.dashActiveMs ?? 0) > 0;
            if (startsDashing && !wasDashing) {
                view.dashSmokeOrigin = { ...current };
                // The supplied smoke frames face north before rotation.
                view.dashSmokeRotation = botMovementRotation(shape) + Math.PI / 2;
                view.dashSmokeStartedAt = now;
            }
            const previousReplayFrameIndex = Number(previousShape?.replayFrameIndex);
            const replayFrameIndex = Number(shape.replayFrameIndex);
            const hasReplayFrameIndices = Number.isFinite(previousReplayFrameIndex) && Number.isFinite(replayFrameIndex);
            const replayFrameGap = hasReplayFrameIndices ? replayFrameIndex - previousReplayFrameIndex : 0;
            const shouldSnapReplayTransition = hasReplayFrameIndices && (
                replayFrameGap > 1
                || replayFrameIndex <= 0
                || shape.replayPhase !== "playback"
                || previousShape?.replayPhase !== "playback"
            );
            const durationMs = drag?.id === shape.id || shouldSnapReplayTransition
                ? 0
                : shapeInterpolationMs(shape);
            view.shape = shape;
            const target = { x: Number(shape.x), y: Number(shape.y) };
            if (target.x !== view.motion.to.x || target.y !== view.motion.to.y) {
                view.motion = { from: current, to: target, startedAt: now, durationMs };
            }
            view.container.eventMode = isBotShape(shape) ? "static" : "none";
            view.container.cursor = isBotShape(shape) && !shape.locked && optionsRef.current.editable ? "grab" : "default";
            view.container.hitArea = new Circle(0, 0, Math.max(12, Number(shape.size ?? (isBotShape(shape) ? BOT_SIZE : 30)) / 2 + 6));
            const hitParticleEvent = shape.hitParticleEvent;
            const hasHitParticleEvent = hitParticleEvent != null
                && hitParticleEvent !== previousShape?.hitParticleEvent;
            const hasLegacyHitFlash = hitParticleEvent == null
                && Number(shape.hitFlashMs ?? 0) > 0
                && Number(previousShape?.hitFlashMs ?? 0) <= 0;
            if (hasHitParticleEvent || hasLegacyHitFlash) {
                spawnBurst(current.x, current.y, 0xfca5a5, 12);
            }
            if (isBotShape(shape) && closingZoneDamageOccurred(shape, previousShape)) {
                spawnBurst(current.x, current.y, 0xc084fc, 6);
            }
            const previousAbility = activeBotVisual(previousShape);
            const nextAbility = activeBotVisual(shape);
            if (nextAbility === 8) {
                if (previousAbility !== nextAbility || view.repulsorBurstStartedAt == null) {
                    view.repulsorBurstStartedAt = repulsorBurstStartTime(shape, now);
                }
            } else {
                view.repulsorBurstStartedAt = null;
            }
            if (isBotShape(shape) && nextAbility === 25 && previousAbility !== nextAbility) {
                spawnBurst(shape.x, shape.y, 0xc4b5fd, 12);
            }
            if (isBotShape(shape) && nextAbility === 10 && previousAbility !== nextAbility) {
                spawnRepairPulseParticles(current.x, current.y);
            }
        }
    }

    function beginDrag(event, view) {
        if (!isBotShape(view.shape)) return;
        if (event.button === 2) {
            if (!optionsRef.current.allowBotRotation
                || !optionsRef.current.editable
                || !isBotShape(view.shape)
                || view.shape.locked) return;
            event.stopPropagation();
            optionsRef.current.onSelectShape?.(view.shape.id);
            rotationDrag = { id: view.shape.id };
            view.container.cursor = "crosshair";
            updateBotRotation(event, view);
            return;
        }
        if (event.button !== 0) return;
        event.stopPropagation();
        optionsRef.current.onSelectShape?.(view.shape.id);
        if (view.shape.locked || !optionsRef.current.editable) return;
        const point = camera.toLocal(event.global);
        const position = sampleViewPosition(view);
        drag = { id: view.shape.id, offsetX: point.x - position.x, offsetY: point.y - position.y };
        view.container.cursor = "grabbing";
    }

    function updateBotRotation(event, view) {
        const point = camera.toLocal(event.global);
        const position = sampleViewPosition(view);
        const deltaX = point.x - position.x;
        const deltaY = point.y - position.y;
        if (Math.hypot(deltaX, deltaY) < 1) return;
        const rotation = vectorToCompassDegrees(deltaX, deltaY);
        view.shape = { ...view.shape, rotation };
        optionsRef.current.onUpdateShape?.(view.shape.id, { rotation });
    }

    function spawnBurst(x, y, color, count) {
        for (let index = 0; index < count; index += 1) {
            const angle = Math.PI * 2 * index / count + (index % 3) * 0.11;
            const speed = 55 + (index % 6) * 18;
            const radius = 2 + index % 3;
            const display = new Graphics();
            display.eventMode = "none";
            display.circle(0, 0, radius * 2.5).fill(color);
            display.position.set(x, y);
            particleLayer.addChild(display);
            particles.push({ display, x, y, vx: Math.cos(angle) * speed, vy: Math.sin(angle) * speed, lifeMs: 480 + (index % 4) * 70, totalMs: 690 });
        }
    }

    function spawnRepairPulseParticles(x, y) {
        for (let index = 0; index < BASIC_HEAL_PARTICLE_COUNT; index += 1) {
            const spec = basicHealParticleSpec(index);
            const display = new Text({
                text: "+",
                style: { fill: 0x6ee7b7, fontFamily: "monospace", fontSize: spec.fontSize, fontWeight: "bold", align: "center" },
            });
            display.anchor.set(0.5);
            display.eventMode = "none";
            display.position.set(x + spec.offsetX, y + spec.offsetY);
            particleLayer.addChild(display);
            particles.push({
                display,
                x: x + spec.offsetX,
                y: y + spec.offsetY,
                vx: spec.vx,
                vy: spec.vy,
                lifeMs: spec.lifetimeMs,
                totalMs: spec.lifetimeMs,
            });
        }
    }

    function render(now) {
        updateCamera();
        overlay.clear();
        const botViews = [...views.values()]
            .filter((view) => isBotShape(view.shape))
            .map((view) => ({ view, position: sampleViewPosition(view, now) }));
        const overlappingBotIds = new Set();
        for (let leftIndex = 0; leftIndex < botViews.length; leftIndex += 1) {
            for (let rightIndex = leftIndex + 1; rightIndex < botViews.length; rightIndex += 1) {
                const left = botViews[leftIndex];
                const right = botViews[rightIndex];
                if (!botSpritesOverlap(left.view.shape, right.view.shape, left.position, right.position)) continue;
                overlappingBotIds.add(left.view.shape.id);
                overlappingBotIds.add(right.view.shape.id);
            }
        }
        for (const view of views.values()) {
            const position = sampleViewPosition(view, now);
            view.container.position.set(position.x, position.y);
            if (isBotShape(view.shape)) drawBot(view, position, optionsRef.current.selectedId === view.shape.id, now, arenaSprites, overlappingBotIds.has(view.shape.id));
            else drawEntity(view, optionsRef.current.selectedId === view.shape.id, now, arenaSprites);
        }
        drawLockOnMarkers(layers.lockOn, lockOnMarkers, botViews, arenaSprites);
        drawPlacementOverlay(overlay, optionsRef.current.placementSide);
        const points = optionsRef.current.measurementPoints ?? [];
        if (!optionsRef.current.measurementEnabled) measurementHoverPoint = null;
        const hoverPoint = measurementHoverPoint;
        const nextMeasurementSignature = JSON.stringify({ points, hoverPoint });
        if (nextMeasurementSignature !== measurementSignature) {
            measurementSignature = nextMeasurementSignature;
            drawMeasurements(measurementLayer, points, hoverPoint);
        }
    }

    function tick() {
        const { timeMs, deltaMs } = presentationClock.advance();
        render(timeMs);
        for (let index = particles.length - 1; index >= 0; index -= 1) {
            const particle = particles[index];
            Object.assign(particle, advanceParticle(particle, deltaMs));
            particle.display.position.set(particle.x, particle.y);
            particle.display.alpha = clamp(particle.lifeMs / particle.totalMs, 0, 1);
            if (particle.lifeMs <= 0) {
                particle.display.destroy();
                particles.splice(index, 1);
            }
        }
    }

    const handleStagePointerDown = (event) => {
        if (event.target !== app.stage) return;
        const isTouch = event.pointerType === "touch";
        if (event.button === 2 || event.button === 1 || (isTouch && !optionsRef.current.measurementEnabled)) {
            if (optionsRef.current.lockCamera) return;
            if (isTouch) event.preventDefault();
            pan = { x: event.global.x, y: event.global.y, center: { ...viewCenter } };
            return;
        }
        if (event.button !== 0) return;
        if (optionsRef.current.measurementEnabled) {
            const point = camera.toLocal(event.global);
            const rounded = { x: Math.round(clamp(point.x, 0, ARENA_WIDTH_UNITS)), y: Math.round(clamp(point.y, 0, ARENA_HEIGHT_UNITS)) };
            const current = optionsRef.current.measurementPoints ?? [];
            optionsRef.current.onMeasurementPointsChange?.(current.length >= 2 ? [rounded] : [...current, rounded]);
        } else {
            optionsRef.current.onDeselectAll?.();
        }
    };
    const handleGlobalPointerMove = (event) => {
        if (rotationDrag) {
            const view = views.get(rotationDrag.id);
            if (!view) {
                rotationDrag = null;
                return;
            }
            updateBotRotation(event, view);
        } else if (drag) {
            const view = views.get(drag.id);
            if (!view) return;
            const point = camera.toLocal(event.global);
            const radius = Number(view.shape.size ?? BOT_SIZE) / 2;
            const position = {
                x: clamp(point.x - drag.offsetX, radius, ARENA_WIDTH_UNITS - radius),
                y: clamp(point.y - drag.offsetY, radius, ARENA_HEIGHT_UNITS - radius),
            };
            view.motion = { from: position, to: position, startedAt: presentationClock.current(), durationMs: 0 };
            optionsRef.current.onUpdateShape?.(drag.id, position);
        } else if (pan) {
            const scale = camera.scale.x || 1;
            viewCenter = { x: pan.center.x - (event.global.x - pan.x) / scale, y: pan.center.y - (event.global.y - pan.y) / scale };
            updateCamera();
        } else if (optionsRef.current.measurementEnabled) {
            const point = camera.toLocal(event.global);
            measurementHoverPoint = {
                x: Math.round(clamp(point.x, 0, ARENA_WIDTH_UNITS)),
                y: Math.round(clamp(point.y, 0, ARENA_HEIGHT_UNITS)),
            };
        }
    };
    const endPointer = () => {
        if (rotationDrag) {
            const view = views.get(rotationDrag.id);
            if (view) view.container.cursor = "grab";
        }
        if (drag) {
            const view = views.get(drag.id);
            if (view) view.container.cursor = "grab";
        }
        rotationDrag = null;
        drag = null;
        pan = null;
    };

    const handleTouchPointerDown = (event) => {
        if (event.pointerType !== "touch") return;
        touchPoints.set(event.pointerId, canvasPoint(event));
        if (touchPoints.size !== 2 || optionsRef.current.lockCamera) return;
        const [first, second] = touchPair();
        const midpoint = touchMidpoint(first, second);
        pinch = {
            startDistance: Math.max(1, touchDistance(first, second)),
            previousMidpoint: midpoint,
            zoom,
        };
        // A second finger turns an in-progress bot drag into a camera gesture.
        // This keeps touch selection/dragging intact for one finger without
        // letting the bot continue moving while the user pinches.
        drag = null;
        rotationDrag = null;
        pan = null;
    };

    const handleTouchPointerMove = (event) => {
        if (event.pointerType !== "touch" || !touchPoints.has(event.pointerId)) return;
        touchPoints.set(event.pointerId, canvasPoint(event));
        event.preventDefault();
        if (!pinch || touchPoints.size < 2 || optionsRef.current.lockCamera) return;
        const [first, second] = touchPair();
        const midpoint = touchMidpoint(first, second);
        const distance = touchDistance(first, second);
        if (distance < 1) return;

        const anchor = camera.toLocal(pinch.previousMidpoint);
        zoom = clamp(pinch.zoom * distance / pinch.startDistance, MIN_ZOOM, MAX_ZOOM);
        updateCamera();
        const afterZoom = camera.toLocal(pinch.previousMidpoint);
        viewCenter.x += anchor.x - afterZoom.x;
        viewCenter.y += anchor.y - afterZoom.y;
        const scale = camera.scale.x || 1;
        viewCenter.x -= (midpoint.x - pinch.previousMidpoint.x) / scale;
        viewCenter.y -= (midpoint.y - pinch.previousMidpoint.y) / scale;
        updateCamera();
        pinch.previousMidpoint = midpoint;
    };

    const handleTouchPointerEnd = (event) => {
        if (event.pointerType !== "touch") return;
        touchPoints.delete(event.pointerId);
        if (touchPoints.size < 2) pinch = null;
    };

    app.stage.on("pointerdown", handleStagePointerDown);
    app.stage.on("globalpointermove", handleGlobalPointerMove);
    app.stage.on("pointerup", endPointer);
    app.stage.on("pointerupoutside", endPointer);

    const handleWheel = (event) => {
        event.preventDefault();
        if (optionsRef.current.lockCamera) return;
        const cursor = canvasPoint(event);
        const before = camera.toLocal(cursor);
        zoom = clamp(zoom * (event.deltaY < 0 ? 1.1 : 0.9), MIN_ZOOM, MAX_ZOOM);
        updateCamera();
        const after = camera.toLocal(cursor);
        viewCenter.x += before.x - after.x;
        viewCenter.y += before.y - after.y;
        updateCamera();
    };
    const preventContextMenu = (event) => event.preventDefault();
    const clearMeasurementHover = () => {
        measurementHoverPoint = null;
    };
    app.canvas.addEventListener("wheel", handleWheel, { passive: false });
    app.canvas.addEventListener("pointerdown", handleTouchPointerDown, { passive: false });
    app.canvas.addEventListener("pointermove", handleTouchPointerMove, { passive: false });
    app.canvas.addEventListener("pointerup", handleTouchPointerEnd);
    app.canvas.addEventListener("pointercancel", handleTouchPointerEnd);
    app.canvas.addEventListener("contextmenu", preventContextMenu);
    app.canvas.addEventListener("pointerleave", clearMeasurementHover);
    app.ticker.add(tick);

    return {
        syncShapes,
        setPlaying(isPlaying) {
            presentationClock.setPaused(!isPlaying);
        },
        destroy() {
            app.ticker.remove(tick);
            app.stage.off("pointerdown", handleStagePointerDown);
            app.stage.off("globalpointermove", handleGlobalPointerMove);
            app.stage.off("pointerup", endPointer);
            app.stage.off("pointerupoutside", endPointer);
            app.canvas.removeEventListener("wheel", handleWheel);
            app.canvas.removeEventListener("pointerdown", handleTouchPointerDown);
            app.canvas.removeEventListener("pointermove", handleTouchPointerMove);
            app.canvas.removeEventListener("pointerup", handleTouchPointerEnd);
            app.canvas.removeEventListener("pointercancel", handleTouchPointerEnd);
            app.canvas.removeEventListener("contextmenu", preventContextMenu);
            app.canvas.removeEventListener("pointerleave", clearMeasurementHover);
        },
    };
}

function drawArena(graphics) {
    graphics.rect(0, 0, ARENA_WIDTH_UNITS, ARENA_HEIGHT_UNITS).fill(COLORS.arena);
    for (let coordinate = 0; coordinate <= ARENA_WIDTH_UNITS; coordinate += 50) {
        const major = coordinate % 250 === 0;
        const stroke = { color: major ? COLORS.gridMajor : COLORS.grid, alpha: major ? 0.5 : 0.28, width: major ? 2 : 1 };
        graphics.moveTo(coordinate, 0).lineTo(coordinate, ARENA_HEIGHT_UNITS).stroke(stroke);
        graphics.moveTo(0, coordinate).lineTo(ARENA_WIDTH_UNITS, coordinate).stroke(stroke);
    }
    graphics.moveTo(500, 0).lineTo(500, 1000).stroke({ color: 0x64748b, alpha: 0.55, width: 2 });
    graphics.moveTo(0, 500).lineTo(1000, 500).stroke({ color: 0x64748b, alpha: 0.55, width: 2 });
    graphics.rect(2, 2, 996, 996).stroke({ color: 0x475569, width: 4 });
}

function drawBot(view, position, selected, now, arenaSprites, overlapping = false) {
    const { shape, baseSprite, graphics, caption } = view;
    const colorRole = botColorRole(shape);
    const tone = colorRole === "red" ? COLORS.opponent : COLORS.player;
    const radius = Number(shape.size ?? BOT_SIZE) / 2;
    const rotation = compassDegreesToRadians(shape.rotation);
    const hitFlash = Number(shape.hitFlashMs ?? 0) > 0;
    hideCachedEffects(view);
    graphics.clear();

    const dead = Number(shape.hp ?? 0) <= 0;
    baseSprite.visible = true;
    baseSprite.texture = arenaSprites.abilities.bot;
    // Source art faces down; arena angle zero faces right. Dash direction may
    // differ from combat facing, so it must not rotate the bot's eyes.
    baseSprite.rotation = rotation - Math.PI / 2;
    baseSprite.tint = hitFlash ? 0xef4444 : tone;
    baseSprite.width = radius * 3;
    baseSprite.height = radius * 3;
    baseSprite.alpha = botInteriorAlpha(shape, overlapping);
    if (selected) graphics.circle(0, 0, radius + 9).stroke({ color: COLORS.white, alpha: 0.72, width: 2 });
    drawFacingArrow(graphics, rotation, radius, tone);

    if (shape.hp != null) {
        const width = 80;
        graphics.roundRect(-width / 2, -radius - 16, width, 8, 2).fill(0x09090b).stroke({ color: 0x3f3f46, width: 1 });
        graphics.rect(-width / 2 + 1, -radius - 15, (width - 2) * healthBarPercent(shape.hp, shape.maxHp) / 100, 6).fill(COLORS.hp);
    }
    if (!dead && shape.preparingAbility) {
        const pulse = 0.55 + Math.sin(now / 85) * 0.25;
        graphics.circle(0, 0, radius + 12).stroke({ color: 0xfde68a, alpha: pulse, width: 3 });
    }
    if (hitFlash) graphics.circle(0, 0, radius + 2).fill({ color: 0xef4444, alpha: 0.5 }).stroke({ color: 0xfca5a5, width: 3 });
    if (!dead) drawDashSmoke(view, position, radius, now, arenaSprites);
    const swingActiveMs = Number(shape.abilityActiveMs?.[1] ?? 0);
    if (swingActiveMs > 0) {
        const halfArc = Number(ABILITY_STATS[1].arcDegrees) / 2;
        const angle = rotation + radians(sweepAngle(swingActiveMs, ABILITY_STATS[1].activeMs, -halfArc, halfArc));
        const progress = visualProgress(swingActiveMs, ABILITY_STATS[1].activeMs);
        const forwardOffset = radius / 2;
        showCachedEffect(view, "swing", spriteFrameAtProgress(arenaSprites.abilities.meleeSlash, progress), {
            x: Math.cos(rotation) * forwardOffset,
            y: Math.sin(rotation) * forwardOffset,
            rotation: angle,
            width: ABILITY_STATS[1].range * 2.25,
            height: ABILITY_STATS[1].range * 2.25,
        });
    }
    drawStatusIcons(graphics, shape, radius);
    drawStatusAnimations(graphics, shape, radius, now);
    if (dead) drawDeadMarker(graphics);

    caption.text = botDisplayName(shape);
    caption.style.fill = tone;
    caption.position.set(0, -radius - 29);
    caption.visible = true;
    drawBotWorldEffects(shape, position, view, now, arenaSprites);
}

function drawLockOnMarkers(layer, markers, botViews, arenaSprites) {
    for (const marker of markers.values()) marker.container.visible = false;

    for (const source of botViews) {
        const shape = source.view.shape;
        if (Number(shape.hp ?? 1) <= 0 || Number(shape.abilityActiveMs?.[20] ?? 0) <= 0) continue;
        const targetPoint = lockOnTargetPoint(shape);
        if (!targetPoint) continue;

        const targetView = botViews
            .filter((candidate) => candidate.view !== source.view && Number(candidate.view.shape.hp ?? 1) > 0)
            .sort((left, right) => distanceSquared(left.position, targetPoint) - distanceSquared(right.position, targetPoint))[0];
        const targetPosition = targetView?.position ?? targetPoint;
        const markerId = shape.id ?? `slot-${shape.slot}`;
        let marker = markers.get(markerId);
        if (!marker) {
            marker = createLockOnMarker(layer, arenaSprites.abilities.lockOnCrosshair);
            markers.set(markerId, marker);
        }

        marker.container.position.set(targetPosition.x, targetPosition.y);
        const targetDiameter = Math.max(1, Number(targetView?.view.shape.size ?? BOT_SIZE) || BOT_SIZE);
        const activeDurationMs = Number(ABILITY_STATS[20].activeMs ?? 300);
        const activeScale = 1 + Math.max(0, Math.min(1, Number(shape.abilityActiveMs[20]) / activeDurationMs)) * 0.08;
        const containedScale = Math.min(1, (targetDiameter * 0.72) / LOCK_ON_PRESENTATION.markerSize);
        marker.container.scale.set(containedScale * activeScale);
        marker.container.visible = true;
    }
}

function createLockOnMarker(layer, texture) {
    const container = new Container();
    const crosshair = new Sprite(texture);
    crosshair.anchor.set(0.5);
    crosshair.width = LOCK_ON_PRESENTATION.markerSize;
    crosshair.height = LOCK_ON_PRESENTATION.markerSize;
    crosshair.tint = 0xffffff;
    crosshair.eventMode = "none";
    container.eventMode = "none";
    container.addChild(crosshair);
    layer.addChild(container);
    return { container };
}

function distanceSquared(left, right) {
    const dx = Number(left?.x ?? 0) - Number(right?.x ?? 0);
    const dy = Number(left?.y ?? 0) - Number(right?.y ?? 0);
    return dx * dx + dy * dy;
}

function drawFacingArrow(graphics, rotation, radius, color) {
    const forwardX = Math.cos(rotation);
    const forwardY = Math.sin(rotation);
    const sideX = -forwardY;
    const sideY = forwardX;
    const renderedBotRadius = radius * 1.5;
    const baseDistance = renderedBotRadius + 3;
    const tipDistance = baseDistance + 11;
    graphics.poly([
        forwardX * tipDistance, forwardY * tipDistance,
        forwardX * baseDistance + sideX * 7, forwardY * baseDistance + sideY * 7,
        forwardX * baseDistance - sideX * 7, forwardY * baseDistance - sideY * 7,
    ]).fill(color);
}

function botDisplayName(shape) {
    return String(shape.username ?? shape.opponentUsername ?? (shape.id === "main" ? "Player" : "Opponent"));
}

function drawDeadMarker(graphics) {
    const color = 0xf8fafc;
    graphics.circle(0, -3, 15).fill({ color: 0x09090b, alpha: 0.9 }).stroke({ color, width: 2 });
    graphics.circle(-5, -5, 3).fill(color);
    graphics.circle(5, -5, 3).fill(color);
    graphics.poly([-4, 2, 0, 6, 4, 2]).fill(color);
    graphics.roundRect(-10, 8, 20, 8, 2).fill(color);
    graphics.moveTo(-5, 9).lineTo(-5, 15).stroke({ color: 0x09090b, width: 2 });
    graphics.moveTo(0, 9).lineTo(0, 15).stroke({ color: 0x09090b, width: 2 });
    graphics.moveTo(5, 9).lineTo(5, 15).stroke({ color: 0x09090b, width: 2 });
}

function hideCachedEffects(view) {
    for (const sprite of view.cachedEffects.values()) sprite.visible = false;
}

function showCachedEffect(view, slot, texture, { x = 0, y = 0, rotation = 0, alpha = 1, width = null, height = null, tint = 0xffffff, anchorX = 0.5, anchorY = 0.5, blendMode = null } = {}) {
    let sprite = view.cachedEffects.get(slot);
    if (!sprite) {
        sprite = new Sprite({ anchor: 0.5 });
        sprite.eventMode = "none";
        view.cachedEffects.set(slot, sprite);
        view.container.addChildAt(sprite, 1);
    }
    sprite.texture = texture;
    sprite.anchor.set(anchorX, anchorY);
    sprite.position.set(x, y);
    sprite.rotation = rotation;
    sprite.alpha = alpha;
    sprite.tint = tint;
    sprite.blendMode = blendMode ?? "normal";
    if (width != null) sprite.width = width;
    if (height != null) sprite.height = height;
    sprite.visible = true;
    return sprite;
}

function drawDashSmoke(view, position, radius, now, arenaSprites) {
    const frames = arenaSprites.abilities.dashSmoke;
    if (!frames?.length || view.dashSmokeStartedAt == null) return;
    const elapsedMs = now - view.dashSmokeStartedAt;
    if (elapsedMs >= 500) {
        view.dashSmokeOrigin = null;
        view.dashSmokeStartedAt = null;
        return;
    }
    const origin = view.dashSmokeOrigin ?? position;
    showCachedEffect(view, "dash-smoke", spriteFrame(frames, elapsedMs, 100, false), {
        x: origin.x - position.x,
        y: origin.y - position.y,
        rotation: view.dashSmokeRotation,
        alpha: 0.92,
        width: radius * 3.8,
        height: radius * 1.9,
        anchorX: 0.5,
        blendMode: "screen",
    });
}

const STATUS_ICON_STYLE = Object.freeze({
    RA: { foreground: 0xfbbf24, background: 0x78350f, border: 0x92400e },
    AG: { foreground: 0xe2e8f0, background: 0x475569, border: 0x334155 },
    BURN: { foreground: 0xfdba74, background: 0x9a3412, border: 0x7c2d12 },
    BLEED: { foreground: 0xfca5a5, background: 0x991b1b, border: 0x7f1d1d },
    SLOW: { foreground: 0x93c5fd, background: 0x1e3a8a, border: 0x1e40af },
    SIL: { foreground: 0xbfdbfe, background: 0x1e40af, border: 0x1e3a8a },
    SHOCK: { foreground: 0xfef08a, background: 0x155e75, border: 0x164e63 },
    STUN: { foreground: 0xfef9c3, background: 0x854d0e, border: 0x713f12 },
    OVERCLOCK: { foreground: 0xa7f3d0, background: 0x022c22, border: 0x34d399 },
});

function drawStatusIcons(graphics, shape, radius) {
    const statuses = botStatusLabels(shape);
    if (!statuses.length) return;
    const tileSize = 22;
    const gap = 4;
    const totalWidth = statuses.length * tileSize + (statuses.length - 1) * gap;
    const startX = -totalWidth / 2;
    const y = -radius - 64;
    statuses.forEach((status, index) => {
        const x = startX + index * (tileSize + gap);
        const style = STATUS_ICON_STYLE[status];
        graphics.roundRect(x, y, tileSize, tileSize, 3).fill(style.background).stroke({ color: style.border, width: 2 });
        drawStatusSymbol(graphics, status, x + tileSize / 2, y + tileSize / 2, style.foreground);
    });
}

function drawStatusSymbol(graphics, status, x, y, color) {
    if (status === "BURN") {
        graphics.poly([x, y - 8, x + 6, y, x + 3, y + 7, x - 4, y + 7, x - 7, y + 1, x - 2, y - 4]).fill(color);
        graphics.circle(x, y + 3, 2.5).fill(0xfff7ed);
    } else if (status === "BLEED") {
        drawDroplet(graphics, x - 4, y + 1, 4, color);
        drawDroplet(graphics, x + 4, y - 2, 3.5, color);
    } else if (status === "SIL") {
        graphics.moveTo(x - 6, y - 6).lineTo(x + 6, y + 6).moveTo(x + 6, y - 6).lineTo(x - 6, y + 6).stroke({ color, width: 3 });
    } else if (status === "SHOCK") {
        graphics.poly([x + 2, y - 9, x - 5, y + 1, x, y + 1, x - 2, y + 9, x + 7, y - 3, x + 2, y - 3]).fill(color);
    } else if (status === "SLOW") {
        graphics.moveTo(x - 7, y - 5).lineTo(x - 1, y - 5).lineTo(x + 1, y + 1).lineTo(x + 7, y + 3).lineTo(x + 7, y + 6).lineTo(x - 7, y + 6).closePath().fill(color);
        graphics.moveTo(x + 5, y - 8).lineTo(x + 5, y - 1).moveTo(x + 2, y - 3).lineTo(x + 5, y).lineTo(x + 8, y - 3).stroke({ color: 0xdbeafe, width: 2 });
    } else if (status === "RA") {
        graphics.poly([x, y - 7, x + 6, y - 4, x + 5, y + 4, x, y + 8, x - 5, y + 4, x - 6, y - 4]).stroke({ color, width: 2 });
        for (const offset of [-6, 0, 6]) graphics.moveTo(x + offset, y - 5).lineTo(x + offset, y - 9).stroke({ color, width: 2 });
    } else if (status === "AG") {
        graphics.circle(x - 4, y, 4.5).stroke({ color, width: 2 }).circle(x + 4, y, 4.5).stroke({ color, width: 2 });
        graphics.moveTo(x - 1, y - 3).lineTo(x + 1, y + 3).moveTo(x - 1, y + 3).lineTo(x + 1, y - 3).stroke({ color, width: 2 });
    } else if (status === "STUN") {
        graphics.poly([x, y - 8, x + 2, y - 2, x + 8, y, x + 2, y + 2, x, y + 8, x - 2, y + 2, x - 8, y, x - 2, y - 2]).fill(color);
    } else if (status === "OVERCLOCK") {
        graphics.circle(x, y, 8.5).stroke({ color, width: 1.8 });
        graphics.moveTo(x, y - 5).lineTo(x, y).lineTo(x + 3.5, y + 2).stroke({ color, width: 1.8 });
        graphics.moveTo(x, y - 9.5).lineTo(x, y - 7.5)
            .moveTo(x, y + 7.5).lineTo(x, y + 9.5)
            .moveTo(x - 9.5, y).lineTo(x - 7.5, y)
            .moveTo(x + 7.5, y).lineTo(x + 9.5, y)
            .stroke({ color, width: 1.4 });
    }
}

function repulsorBurstStartTime(shape, now) {
    if (activeBotVisual(shape) !== 8) return null;
    const elapsed = REPULSOR_BURST_VISUAL_MS - combatVisualRemainingMs(shape, 8);
    return now - clamp(elapsed, 0, REPULSOR_BURST_VISUAL_MS);
}

function drawStatusAnimations(graphics, shape, radius, now) {
    const frame = Math.floor(now / 120) % 4;
    if (statusIsActive(shape, "burn")) {
        const heights = [[7, 11, 8], [10, 7, 12], [8, 12, 6], [11, 8, 10]][frame];
        [-13, 0, 13].forEach((x, index) => {
            const baseY = radius + 4;
            graphics.poly([x, baseY - heights[index], x + 5, baseY - 2, x + 2, baseY + 5, x - 4, baseY + 4, x - 5, baseY - 1]).fill(index === 1 ? 0xfde047 : 0xfb923c);
        });
    }
    if (statusIsActive(shape, "bleed")) {
        const drops = [[-18, 5], [-6, 11], [8, 2], [18, 8]];
        drops.forEach(([x, offset], index) => {
            const fall = (frame + index) % 4 * 4;
            drawDroplet(graphics, x, radius - 3 + offset + fall, 3, 0xef4444);
        });
    }
    if (statusIsActive(shape, "shock")) {
        const angles = [0.2, 1.8, 3.3, 4.8];
        angles.forEach((angle, index) => {
            const activeAngle = angle + frame * 0.28 + index * 0.04;
            const x = Math.cos(activeAngle) * (radius + 6);
            const y = Math.sin(activeAngle) * (radius + 6);
            graphics.moveTo(x - 4, y - 6).lineTo(x + 2, y - 1).lineTo(x - 2, y + 2).lineTo(x + 5, y + 7).stroke({ color: index % 2 ? 0x67e8f9 : 0xfef08a, width: 2 });
        });
    }
}

function drawDroplet(graphics, x, y, size, color) {
    graphics.poly([x, y - size * 1.6, x + size, y, x + size * 0.65, y + size, x, y + size * 1.35, x - size * 0.65, y + size, x - size, y]).fill(color);
}

function drawBotWorldEffects(shape, position, view, now, arenaSprites) {
    const { graphics } = view;
    const rotation = compassDegreesToRadians(shape.rotation);
    if (Number(shape.abilityActiveMs?.[3] ?? 0) > 0) {
        const alpha = abilityActiveOpacity(shape, 3);
        const originX = Number(shape.gunRayOriginX ?? shape.x);
        const originY = Number(shape.gunRayOriginY ?? shape.y);
        const originRotation = Number(shape.gunRayRotation ?? shape.rotation);
        showAbilityRayEffect(view, "gun", arenaSprites, position, originX, originY, originRotation, 3, ABILITY_STATS[3].range, alpha, 16);
        showMuzzleFlash(view, arenaSprites, position, originX, originY, originRotation, alpha, Number(shape.size ?? 60));
    }
    const stunActiveMs = Number(shape.abilityActiveMs?.[6] ?? 0);
    if (stunActiveMs > 0) {
        const opacity = clamp(stunActiveMs / Number(ABILITY_STATS[6].windupMs), 0, 1);
        const progress = visualProgress(stunActiveMs, ABILITY_STATS[6].windupMs);
        const botRadius = Number(shape.size ?? BOT_SIZE) / 2;
        showCachedEffect(view, "stun", spriteFrameAtProgress(arenaSprites.abilities.stun, progress), {
            // The supplied frame is vertically elongated; keep that long axis
            // aligned with the bot's facing direction and project it from
            // the forward edge instead of centering it over the bot.
            x: Math.cos(rotation) * botRadius,
            y: Math.sin(rotation) * botRadius,
            rotation: rotation - Math.PI / 2,
            alpha: opacity,
            width: Number(shape.size ?? 60) * 1.8,
            height: Number(shape.size ?? 60) * 3.6,
            anchorY: 0,
            blendMode: "screen",
        });
    }
    if (Number(shape.temporalRewindPulseMs ?? 0) > 0) {
        const progress = visualProgress(shape.temporalRewindPulseMs, 400);
        const x = Number(shape.temporalRewindVisualX ?? shape.temporalRewindX ?? position.x);
        const y = Number(shape.temporalRewindVisualY ?? shape.temporalRewindY ?? position.y);
        showCachedEffect(view, "rewind-pulse", spriteFrameAtProgress(arenaSprites.abilities.temporalRewind, progress), {
            x: x - position.x,
            y: y - position.y,
            alpha: 1 - progress,
            tint: 0xcffafe,
            width: 110,
            height: 110,
        });
    }

    const visual = activeBotVisual(shape);
    if (!visual) return;
    if (visual === 20) return;
    const stats = ABILITY_STATS[visual] ?? {};
    const selfGuardFlash = visual === 16 || visual === 23;
    const duration = Number(stats.visualMs ?? 300);
    const activeRemainingMs = Number(shape.abilityActiveMs?.[visual] ?? 0);
    const configuredActiveMs = Number(stats.statusDurationMs ?? stats.durationMs ?? stats.activeMs ?? duration);
    const replayActivationRemainingMs = Math.max(0, duration - Math.max(0, configuredActiveMs - activeRemainingMs));
    const remaining = selfGuardFlash
        ? Math.max(Number(shape.abilityVisual?.ms ?? 0), replayActivationRemainingMs)
        : combatVisualRemainingMs(shape, visual);
    const opacity = abilityVisualOpacity(shape, visual, duration);
    const originX = Number(shape.abilityVisual?.x ?? shape.visualOriginX ?? position.x);
    const originY = Number(shape.abilityVisual?.y ?? shape.visualOriginY ?? position.y);
    const originRotation = Number(shape.abilityVisual?.rotation ?? shape.visualOriginRotation ?? shape.rotation);
    const angle = compassDegreesToRadians(originRotation);
    if (visual === 10) {
        return;
    } else if (visual === 8) {
        const frames = arenaSprites.abilities.repulsorBlast;
        if (!frames?.length) return;
        // Fill the 100 ms snapshot gaps with a cosmetic renderer clock; it
        // never feeds collision, damage, knockback, cooldown, or authority.
        const elapsed = view.repulsorBurstStartedAt == null
            ? duration - remaining
            : now - view.repulsorBurstStartedAt;
        const progress = repulsorBurstProgress(elapsed, duration);
        const frameIndex = repulsorBurstFrameIndex(progress, frames.length);
        const diameter = repulsorBurstDiameter(progress, Number(stats.radius ?? 110) * 2, frames.length);
        showCachedEffect(view, "ability", frames[frameIndex], {
            x: originX - position.x,
            y: originY - position.y,
            alpha: 1,
            tint: 0xffffff,
            width: diameter,
            height: diameter,
        });
    } else if (visual === 7) {
        const halfArc = Number(stats.arcDegrees) / 2;
        const sweep = heavySlashRotation(originRotation, sweepAngle(remaining, duration, -halfArc, halfArc));
        showSlashEffect(view, arenaSprites.abilities.heavySlash, remaining, duration, sweep, ABILITY_STATS[1].range * 2.4, 0xffffff, opacity);
    } else if ([3, 12, 9, 13].includes(visual)) {
        const height = visual === 13 ? 100 : visual === 9 ? 76 : 14;
        showAbilityRayEffect(view, "ability", arenaSprites, position, originX, originY, originRotation, visual, Number(stats.range ?? 500), opacity, height);
        showMuzzleFlash(view, arenaSprites, position, originX, originY, originRotation, opacity, Number(shape.size ?? 60));
    } else if ([30, 32].includes(visual)) {
        drawProceduralAbilityRay(graphics, position, originX, originY, originRotation,
            Number(stats.range ?? 500), visual === 30 ? 0x22d3ee : 0xa78bfa, opacity,
            visual === 30 ? 8 : 10);
        showMuzzleFlash(view, arenaSprites, position, originX, originY, originRotation, opacity, Number(shape.size ?? 60));
    } else if (visual === 34) {
        drawProceduralAbilityRay(graphics, position, originX, originY, originRotation,
            Number(stats.range ?? 80), 0xf8fafc, opacity, 6);
    } else if (visual === 33) {
        const radius = Number(shape.size ?? BOT_SIZE) / 2;
        const pulse = 0.55 + Math.sin(now / 100) * 0.18;
        graphics.circle(0, 0, radius + 12).stroke({ color: 0xfbbf24, alpha: pulse, width: 3 });
        graphics.circle(0, 0, radius + 20).stroke({ color: 0xfef3c7, alpha: pulse * 0.45, width: 2 });
    } else if (visual === 25) {
        const progress = visualProgress(remaining, duration);
        showCachedEffect(view, "ability", spriteFrameAtProgress(arenaSprites.abilities.phaseStrike, progress), {
            rotation: angle,
            alpha: opacity,
            tint: 0xf0abfc,
            width: Number(stats.range ?? 100) * 2.25,
            height: Number(stats.range ?? 100) * 1.35,
            anchorX: 0.05,
            blendMode: "screen",
        });
    } else if (visual === 26) {
        const progress = visualProgress(remaining, duration);
        const centerX = originX - position.x;
        const centerY = originY - position.y;
        const ringRadius = Number(stats.radius ?? 120) * (0.34 + progress * 0.66);
        graphics.circle(centerX, centerY, ringRadius)
            .stroke({ color: 0x93c5fd, alpha: opacity, width: 5 });
        graphics.circle(centerX, centerY, ringRadius * 0.72)
            .stroke({ color: 0x67e8f9, alpha: opacity * 0.5, width: 2 });
        for (let index = 0; index < 8; index += 1) {
            const shardAngle = index * Math.PI / 4 + progress * Math.PI * 0.5;
            const inner = ringRadius * 0.72;
            const outer = ringRadius * (0.9 + (index % 2) * 0.08);
            graphics.moveTo(centerX + Math.cos(shardAngle) * inner, centerY + Math.sin(shardAngle) * inner)
                .lineTo(centerX + Math.cos(shardAngle) * outer, centerY + Math.sin(shardAngle) * outer)
                .stroke({ color: 0xe0f2fe, alpha: opacity * 0.8, width: 3 });
        }
    } else if (visual === 16 || visual === 23) {
        const progress = visualProgress(remaining, duration);
        const radius = 40 + progress * 16;
        const color = visual === 16 ? 0xfbbf24 : 0xe2e8f0;
        showCachedEffect(view, "ability", spriteFrameAtProgress(arenaSprites.abilities.shield, progress), { rotation: angle + Math.PI, alpha: 1 - progress, tint: color, width: radius * 2, height: radius * 2 });
    }
}

function drawProceduralAbilityRay(graphics, position, originX, originY, rotation, range, color, alpha, width) {
    const startX = Number(originX) - Number(position.x);
    const startY = Number(originY) - Number(position.y);
    const angle = compassDegreesToRadians(rotation);
    const endX = startX + Math.cos(angle) * range;
    const endY = startY + Math.sin(angle) * range;
    graphics.moveTo(startX, startY).lineTo(endX, endY).stroke({ color, alpha: alpha * 0.26, width: width * 2.6 });
    graphics.moveTo(startX, startY).lineTo(endX, endY).stroke({ color, alpha, width });
    graphics.circle(endX, endY, width * 1.8).fill({ color, alpha: alpha * 0.65 });
}

function showSlashEffect(view, frames, remaining, duration, rotation, size, tint, alpha) {
    const texture = spriteFrameAtProgress(frames, visualProgress(remaining, duration));
    showCachedEffect(view, "ability", texture, { rotation, width: size, height: size, tint, alpha });
}

function showAbilityRayEffect(view, slot, arenaSprites, position, originX, originY, rotation, abilityId, length, alpha, height, tint = 0xffffff) {
    const frames = arenaSprites.abilities.rays[ABILITIES[abilityId]?.name];
    const x = Number.isFinite(originX) ? originX : position.x;
    const y = Number.isFinite(originY) ? originY : position.y;
    const texture = spriteFrameAtProgress(frames, 1 - alpha);
    showCachedEffect(view, slot, texture, {
        x: x - position.x,
        y: y - position.y,
        rotation: compassDegreesToRadians(rotation),
        alpha,
        tint,
        width: length,
        height,
        anchorX: textureMuzzleAnchor(texture),
        blendMode: "screen",
    });
}

function showMuzzleFlash(view, arenaSprites, position, originX, originY, rotation, alpha, botSize) {
    const frames = arenaSprites.abilities.muzzleFlash;
    if (!frames?.length) return;
    const x = Number.isFinite(originX) ? originX : position.x;
    const y = Number.isFinite(originY) ? originY : position.y;
    const size = Math.max(42, Number(botSize ?? 60) * 1.25);
    showCachedEffect(view, "muzzle-flash", spriteFrameAtProgress(frames, 1 - alpha), {
        x: x - position.x,
        y: y - position.y,
        rotation: compassDegreesToRadians(rotation),
        alpha,
        width: size,
        height: size * 0.58,
        anchorX: 0.08,
        blendMode: "screen",
    });
}

function drawEntity(view, selected, now, arenaSprites) {
    const { shape, baseSprite, graphics, caption } = view;
    if (shape.type === CLOSING_ZONE_TYPE) {
        drawClosingZone(graphics, shape);
        baseSprite.visible = false;
        caption.text = "";
        caption.visible = false;
        return;
    }
    const size = Math.max(2, Number(shape.size ?? 30));
    const radius = size / 2;
    const rotation = compassDegreesToRadians(shape.rotation);
    hideCachedEffects(view);
    graphics.clear();
    if (["singularityZone", "singularityExplosion"].includes(shape.type)) {
        baseSprite.visible = false;
        caption.text = "";
        caption.visible = false;
        drawGeneratedSingularity(graphics, shape, now);
        if (selected) graphics.circle(0, 0, radius + 6).stroke({ color: COLORS.white, alpha: 0.8, width: 2 });
        if (Number(shape.hitFlashMs ?? 0) > 0) graphics.circle(0, 0, radius + 2).fill({ color: 0xef4444, alpha: 0.5 });
        return;
    }
    if (["tetherBolt", "staticSnare", "staticSnareBurst"].includes(shape.type)) {
        baseSprite.visible = false;
        drawGeneratedAbilityEntity(graphics, shape, now);
        caption.text = entityCaption(shape);
        caption.visible = Boolean(caption.text);
        caption.position.set(0, -radius - 10);
        if (selected) graphics.circle(0, 0, radius + 6).stroke({ color: COLORS.white, alpha: 0.8, width: 2 });
        if (Number(shape.hitFlashMs ?? 0) > 0) graphics.circle(0, 0, radius + 2).fill({ color: 0xef4444, alpha: 0.5 });
        return;
    }
    const orbitalRemaining = Number(shape.visibleMs ?? shape.remainingMs ?? shape.timerMs ?? 400);
    const texture = entityTexture(shape, arenaSprites, orbitalRemaining, now, view.entityAnimationStartedAt);
    baseSprite.visible = texture != null;
    if (texture) baseSprite.texture = texture;
    baseSprite.rotation = entityRotation(shape, rotation);
    baseSprite.alpha = 1;
    baseSprite.tint = 0xffffff;
    const spriteSize = entitySpriteSize(shape, size);
    baseSprite.width = spriteSize.width;
    baseSprite.height = spriteSize.height;
    caption.text = entityCaption(shape);
    caption.visible = Boolean(caption.text);
    caption.position.set(0, shape.type === "nullZone" ? 0 : -radius - 10);

    const trailStyle = projectileTrailStyle(shape);
    if (trailStyle) drawVelocityTrail(graphics, shape, trailStyle.color, trailStyle.length, trailStyle.width, now);

    if (shape.type === "orbitalExplosion") {
        baseSprite.alpha = clamp(orbitalRemaining / 400, 0, 1);
    } else if (shape.type === "gravityZone") {
        if (shape.armed) baseSprite.alpha = 0.72 + Math.sin(now / 100) * 0.12;
    } else if (["hunterDrone", "repellerDrone"].includes(shape.type)) {
        if (Number(shape.shotVisualMs ?? 0) > 0) {
            const alpha = clamp(Number(shape.shotVisualMs) / 300, 0.2, 1);
                showAbilityRayEffect(view, "drone-shot", arenaSprites, { x: shape.x, y: shape.y }, shape.x, shape.y, shape.rotation, 3, 200, alpha, 16, 0x6ee7b7);
        }
    }
    if (selected) graphics.circle(0, 0, radius + 6).stroke({ color: COLORS.white, alpha: 0.8, width: 2 });
    if (Number(shape.hitFlashMs ?? 0) > 0) graphics.circle(0, 0, radius + 2).fill({ color: 0xef4444, alpha: 0.5 });
}

function drawClosingZone(graphics, shape) {
    const safeRadius = Math.max(0, Number(shape.safeRadius ?? Number(shape.size ?? 0) / 2));
    const arenaRadius = Math.hypot(ARENA_WIDTH_UNITS, ARENA_HEIGHT_UNITS) / 2;
    graphics.clear();
    if (safeRadius <= 0.5) {
        graphics.rect(-ARENA_WIDTH_UNITS / 2, -ARENA_HEIGHT_UNITS / 2, ARENA_WIDTH_UNITS, ARENA_HEIGHT_UNITS)
            .fill({ color: COLORS.closingZone, alpha: 0.28 });
        return;
    }
    if (safeRadius >= arenaRadius) {
        graphics.circle(0, 0, safeRadius).stroke({ color: COLORS.closingZone, alpha: 0.55, width: 3 });
        return;
    }
    const segmentCount = 96;
    for (let index = 0; index < segmentCount; index += 1) {
        const start = index / segmentCount * Math.PI * 2;
        const end = (index + 1) / segmentCount * Math.PI * 2;
        graphics
            .moveTo(Math.cos(start) * safeRadius, Math.sin(start) * safeRadius)
            .lineTo(Math.cos(start) * arenaRadius, Math.sin(start) * arenaRadius)
            .lineTo(Math.cos(end) * arenaRadius, Math.sin(end) * arenaRadius)
            .lineTo(Math.cos(end) * safeRadius, Math.sin(end) * safeRadius)
            .fill({ color: COLORS.closingZone, alpha: 0.28 });
    }
    graphics.circle(0, 0, safeRadius).stroke({ color: COLORS.closingZone, alpha: 0.86, width: 3 });
}

function drawGeneratedSingularity(graphics, shape, now) {
    const radius = Math.max(12, Number(shape.size ?? 280) / 2);
    const explosion = shape.type === "singularityExplosion";
    const remaining = Number(shape.visibleMs ?? 0);
    const visibleMs = Number(ABILITY_STATS[27]?.explosionVisibleMs ?? 400);
    const progress = explosion ? 1 - clamp(remaining / visibleMs, 0, 1) : 0;
    const pulse = 0.62 + Math.sin(now / 90) * 0.14;
    if (explosion) {
        const waveRadius = radius * (0.35 + progress * 0.9);
        graphics.circle(0, 0, waveRadius).stroke({ color: 0xc4b5fd, alpha: 0.9 - progress * 0.45, width: 8 });
        graphics.circle(0, 0, waveRadius * 0.5).fill({ color: 0x7c3aed, alpha: 0.24 * (1 - progress) });
        return;
    }
    const armed = Boolean(shape.armed) || Number(shape.fuseMs ?? 0) <= 0;
    graphics.circle(0, 0, radius).stroke({ color: 0xa78bfa, alpha: armed ? 0.84 : pulse, width: 3 });
    graphics.circle(0, 0, radius * 0.72).stroke({ color: 0x67e8f9, alpha: armed ? 0.5 : 0.3, width: 2 });
    graphics.circle(0, 0, radius * 0.14).fill({ color: 0x312e81, alpha: 0.92 });
    for (let index = 0; index < 8; index += 1) {
        const angle = now / 700 + index * Math.PI / 4;
        const inner = radius * 0.2;
        const outer = radius * (0.55 + (index % 2) * 0.12);
        graphics.moveTo(Math.cos(angle) * inner, Math.sin(angle) * inner)
            .lineTo(Math.cos(angle) * outer, Math.sin(angle) * outer)
            .stroke({ color: 0x67e8f9, alpha: armed ? 0.48 : 0.24, width: 2 });
    }
}

function drawGeneratedAbilityEntity(graphics, shape, now) {
    const type = shape.type;
    if (type === "tetherBolt") {
        const speed = Math.max(0.001, Math.hypot(Number(shape.velocityX ?? 0), Number(shape.velocityY ?? 0)));
        const ux = Number(shape.velocityX ?? 0) / speed;
        const uy = Number(shape.velocityY ?? 0) / speed;
        const length = Math.max(28, speed * 1.45);
        graphics.moveTo(-ux * length * 0.55, -uy * length * 0.55)
            .lineTo(ux * length * 0.55, uy * length * 0.55)
            .stroke({ color: 0x67e8f9, alpha: 0.28, width: 10 });
        graphics.moveTo(-ux * length * 0.5, -uy * length * 0.5)
            .lineTo(ux * length * 0.5, uy * length * 0.5)
            .stroke({ color: 0xe0f2fe, alpha: 0.95, width: 3 });
        graphics.circle(ux * length * 0.54, uy * length * 0.54, 5).fill({ color: 0x22d3ee, alpha: 0.95 });
        return;
    }
    if (type === "staticSnare") {
        const triggerRadius = Number(ABILITY_STATS[29]?.triggerRadius ?? 75);
        const pulse = 0.62 + Math.sin(now / 180) * 0.14;
        graphics.circle(0, 0, triggerRadius).stroke({ color: 0xfacc15, alpha: 0.22, width: 2 });
        graphics.circle(0, 0, Math.max(8, Number(shape.size ?? 24) / 2)).fill({ color: 0x713f12, alpha: 0.9 })
            .stroke({ color: 0xfde047, alpha: pulse, width: 3 });
        graphics.moveTo(-8, 0).lineTo(8, 0).moveTo(0, -8).lineTo(0, 8).stroke({ color: 0xfef08a, alpha: 0.9, width: 2 });
        return;
    }
    if (type === "staticSnareBurst") {
        const radius = Math.max(12, Number(shape.size ?? 150) / 2);
        const remaining = Math.max(0, Number(shape.visibleMs ?? 300));
        const progress = 1 - clamp(remaining / Number(ABILITY_STATS[29]?.explosionVisibleMs ?? 300), 0, 1);
        graphics.circle(0, 0, radius * (0.35 + progress * 0.7))
            .stroke({ color: 0xfacc15, alpha: 0.9 - progress * 0.5, width: 6 });
        graphics.circle(0, 0, radius * 0.35).fill({ color: 0xf59e0b, alpha: 0.28 * (1 - progress) });
        return;
    }
    const radius = Math.max(10, Number(shape.size ?? 28) / 2);
    const pulse = 0.72 + Math.sin(now / 120) * 0.14;
    graphics.circle(0, 0, radius).fill({ color: 0x164e63, alpha: 0.95 }).stroke({ color: 0x67e8f9, alpha: pulse, width: 3 });
    graphics.circle(0, 0, radius * 0.45).fill({ color: 0x0e7490, alpha: 0.85 });
    graphics.moveTo(-radius - 5, 0).lineTo(radius + 5, 0).moveTo(0, -radius - 5).lineTo(0, radius + 5)
        .stroke({ color: 0xa5f3fc, alpha: 0.8, width: 2 });
    graphics.circle(0, 0, radius + 7).stroke({ color: 0x22d3ee, alpha: 0.24, width: 2 });
}

function entityTexture(shape, arenaSprites, orbitalRemaining, now, animationStartedAt) {
    const abilities = arenaSprites.abilities;
    const definition = presentationDefinitionForShape(shape);
    if (definition.fallback) return null;
    const frames = definition.texturePath.reduce((current, key) => current?.[key], abilities);
    if (!frames) return null;
    if (definition.animation === "static") return Array.isArray(frames) ? frames[0] : frames;
    if (definition.animation === "time") return spriteFrame(frames, now, definition.frameMs);
    if (definition.animation !== "progress") return null;

    const duration = Number(definition.durationMs ?? 0);
    const progress = definition.remaining === "grenadeDetonate"
        ? grenadeDetonateProgress(shape)
        : definition.remaining === "orbital"
            ? 1 - clamp(orbitalRemaining / duration, 0, 1)
            : Number.isFinite(animationStartedAt)
                ? clamp((now - animationStartedAt) / duration, 0, 1)
                : 1 - clamp(Number(shape.visibleMs ?? shape.remainingMs ?? duration) / duration, 0, 1);
    return spriteFrameAtProgress(frames, progress);
}

function entityAnimationStartTime(shape, now) {
    const definition = presentationDefinitionForShape(shape);
    if (definition.animation !== "progress" || definition.remaining === "grenadeDetonate" || definition.remaining === "orbital") return null;
    const duration = Number(definition.durationMs ?? 0);
    if (duration <= 0) return null;
    const remaining = Number(shape.visibleMs ?? shape.remainingMs ?? duration);
    return now - (duration - clamp(remaining, 0, duration));
}

function entityRotation(shape, fallbackRotation) {
    const velocityX = Number(shape.velocityX ?? 0);
    const velocityY = Number(shape.velocityY ?? 0);
    if (["grenade", "proximityMine", "fireball", "windburstProjectile"].includes(shape.type)
        && Math.hypot(velocityX, velocityY) > 0.01) return Math.atan2(velocityY, velocityX);
    if (shape.type === "silenceWave") return fallbackRotation - Math.PI / 2;
    return shape.type === "windburstProjectile" ? fallbackRotation : 0;
}

function entitySpriteSize(shape, size) {
    if (shape.type === "orbitalMarker") return { width: size, height: size };
    if (shape.type === "grenade") return { width: size * 10, height: size * 10 };
    if (shape.type === "proximityMine") return { width: size * 4, height: size * 4 };
    if (shape.type === "fireball") return { width: size * 1.6, height: size * 1.6 };
    if (["grenadeExplosion", "mineExplosion", "gravityExplosion", "orbitalExplosion"].includes(shape.type)) return { width: size, height: size };
    // Each Null Zone frame is roughly 1.25:1 and includes some visual padding.
    // Scale it slightly past the collider diameter so its visible edge better
    // communicates the full gameplay range.
    if (shape.type === "nullZone") return { width: size * 1.1, height: size * 0.88 };
    if (shape.type === "temporalRewindZone") return { width: size * 1.7, height: size * 1.7 };
    if (shape.type === "silenceWave" || shape.type === "gravityZone") return { width: size, height: size };
    if (shape.type === "windburstProjectile") return { width: size * 6, height: size * 4 };
    return { width: size * 1.5, height: size * 1.5 };
}

function drawVelocityTrail(graphics, shape, color, length = 28, width = 5, now) {
    const speed = Math.hypot(Number(shape.velocityX ?? 0), Number(shape.velocityY ?? 0));
    if (speed <= 0.01) return;
    const backwardX = -Number(shape.velocityX) / speed;
    const backwardY = -Number(shape.velocityY) / speed;
    const perpendicularX = -backwardY;
    const perpendicularY = backwardX;
    const phase = now / 115;
    const segmentCount = 8;
    let previous = { x: 0, y: 0 };

    for (let index = 1; index <= segmentCount; index += 1) {
        const progress = index / segmentCount;
        const taper = 1 - progress;
        const flutter = Math.sin(phase - index * 0.82) * width * 0.3 * progress;
        const current = {
            x: backwardX * length * progress + perpendicularX * flutter,
            y: backwardY * length * progress + perpendicularY * flutter,
        };
        graphics.moveTo(previous.x, previous.y).lineTo(current.x, current.y).stroke({
            color,
            alpha: 0.12 + taper * 0.52,
            width: Math.max(0.8, width * taper),
            cap: "round",
        });
        previous = current;
    }

    const pulse = 0.12 + ((now / 420) % 1) * 0.68;
    const pulseFlutter = Math.sin(phase - pulse * segmentCount * 0.82) * width * 0.3 * pulse;
    graphics.circle(
        backwardX * length * pulse + perpendicularX * pulseFlutter,
        backwardY * length * pulse + perpendicularY * pulseFlutter,
        Math.max(1, width * (1 - pulse) * 0.24),
    ).fill({ color, alpha: 0.65 * (1 - pulse) });
}

function drawPlacementOverlay(graphics, side) {
    if (!side) return;
    const top = ARENA_HEIGHT_UNITS / 3;
    const bottom = ARENA_HEIGHT_UNITS * 2 / 3;
    if (side === "top") {
        graphics.rect(0, 0, ARENA_WIDTH_UNITS, top).fill({ color: COLORS.player, alpha: 0.06 });
        graphics.moveTo(0, top).lineTo(ARENA_WIDTH_UNITS, top).stroke({ color: COLORS.player, alpha: 0.9, width: 3 });
    } else {
        graphics.rect(0, bottom, ARENA_WIDTH_UNITS, ARENA_HEIGHT_UNITS - bottom).fill({ color: COLORS.opponent, alpha: 0.06 });
        graphics.moveTo(0, bottom).lineTo(ARENA_WIDTH_UNITS, bottom).stroke({ color: COLORS.opponent, alpha: 0.9, width: 3 });
    }
}

function drawMeasurements(layer, points, hoverPoint = null) {
    layer.removeChildren().forEach((child) => child.destroy());
    const graphics = new Graphics();
    graphics.eventMode = "none";
    if (points.length === 2) graphics.moveTo(points[0].x, points[0].y).lineTo(points[1].x, points[1].y).stroke({ color: 0x67e8f9, width: 3 });
    points.forEach((point) => graphics.circle(point.x, point.y, 7).fill(0x22d3ee).stroke({ color: COLORS.white, width: 2 }));
    if (points.length || hoverPoint) layer.addChild(graphics);
    if (points.length === 2) {
        const distance = Math.hypot(points[1].x - points[0].x, points[1].y - points[0].y);
        const label = new Text({ text: `${distance.toFixed(1)} units`, style: { fill: COLORS.white, fontFamily: "monospace", fontSize: 12, fontWeight: "bold" } });
        label.anchor.set(0.5);
        label.eventMode = "none";
        label.position.set((points[0].x + points[1].x) / 2, (points[0].y + points[1].y) / 2 - 12);
        layer.addChild(label);
    }
    if (hoverPoint) {
        graphics.moveTo(hoverPoint.x - 5, hoverPoint.y).lineTo(hoverPoint.x + 5, hoverPoint.y)
            .moveTo(hoverPoint.x, hoverPoint.y - 5).lineTo(hoverPoint.x, hoverPoint.y + 5)
            .stroke({ color: 0xf8fafc, alpha: 0.8, width: 1 });
        const coordinateLabel = new Text({
            text: `x: ${hoverPoint.x}, y: ${hoverPoint.y}`,
            style: { fill: COLORS.white, fontFamily: "monospace", fontSize: 12, fontWeight: "bold" },
        });
        coordinateLabel.anchor.set(hoverPoint.x > ARENA_WIDTH_UNITS - 150 ? 1 : 0, hoverPoint.y < 30 ? 0 : 1);
        coordinateLabel.eventMode = "none";
        coordinateLabel.position.set(hoverPoint.x + (hoverPoint.x > ARENA_WIDTH_UNITS - 150 ? -8 : 8), hoverPoint.y + (hoverPoint.y < 30 ? 8 : -8));
        layer.addChild(coordinateLabel);
    }
}

function explosionColor(type) {
    if (type === "orbitalExplosion") return 0xfef08a;
    if (type === "mineExplosion") return 0xfca5a5;
    return 0xfdba74;
}

function radians(degrees) {
    return Number(degrees ?? 0) * Math.PI / 180;
}

function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
}
