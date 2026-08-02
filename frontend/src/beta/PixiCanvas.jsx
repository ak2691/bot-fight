import { useEffect, useRef, useState } from "react";
import { Application, Circle, Container, Graphics, Rectangle, Sprite, Text } from "pixi.js";
import AbilityStatusPanel from "./AbilityStatusPanel.jsx";
import { ABILITY_STATS } from "./combat/Abilities.js";
import { MOVE_STATS } from "./combat/Moves.js";
import { combatVisualRemainingMs, gunRayOpacity, healthBarPercent, prototypeVisualOpacity, swordSweepAngle, visualProgress } from "./combat/visualState.js";
import { ARENA_HEIGHT_UNITS, ARENA_WIDTH_UNITS } from "./modelPayloads/arenaConstants.js";
import { interpolatePosition } from "./pixi/snapshotInterpolation.js";
import { activeFighterVisual, entityCaption, fighterColorRole, fighterDashRotation, fighterStatusLabels, isFighterShape, pixiLayerForShape, projectileTrailStyle, shapeInterpolationMs } from "./pixi/pixiVisualState.js";
import { centeredTextureFrame, createArenaTextureCache } from "./pixi/arenaTextureCache.js";
import { compassDegreesToRadians } from "../logic/arenaAngles.js";
import "./PixiCanvas.css";

const FIGHTER_SIZE = 60;
const MIN_ZOOM = 1;
const MAX_ZOOM = 2.5;
const COLORS = Object.freeze({
    arena: 0x0d1117,
    grid: 0x253442,
    gridMajor: 0x3b4c5e,
    player: 0x22d3ee,
    opponent: 0xe879f9,
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
    arenaSize = null,
    fixedLayout = false,
    lockCamera = false,
    measurementEnabled = false,
    measurementPoints = [],
    onMeasurementPointsChange = () => { },
}) {
    const hostRef = useRef(null);
    const runtimeRef = useRef(null);
    const optionsRef = useRef({});
    const [isRendererReady, setIsRendererReady] = useState(false);
    useEffect(() => {
        optionsRef.current = {
            shapes,
            selectedId,
            onSelectShape,
            onUpdateShape,
            onDeselectAll,
            editable,
            placementSide,
            lockCamera,
            measurementEnabled,
            measurementPoints,
            onMeasurementPointsChange,
        };
        runtimeRef.current?.syncShapes(shapes);
    }, [editable, lockCamera, measurementEnabled, measurementPoints, onDeselectAll, onMeasurementPointsChange, onSelectShape, onUpdateShape, placementSide, selectedId, shapes]);

    useEffect(() => {
        let disposed = false;
        let app = null;

        async function mount() {
            const host = hostRef.current;
            if (!host) return;
            app = new Application();
            await app.init({
                preference: "webgl",
                resizeTo: host,
                autoDensity: true,
                antialias: true,
                backgroundAlpha: 0,
            });
            if (disposed) {
                app.destroy({ removeView: true }, { children: true });
                return;
            }
            app.canvas.setAttribute("aria-label", "PixiJS bot-room arena");
            host.appendChild(app.canvas);
            runtimeRef.current = createArenaRuntime(app, optionsRef);
            runtimeRef.current.syncShapes(optionsRef.current.shapes ?? []);
            setIsRendererReady(true);
        }

        mount();
        return () => {
            disposed = true;
            runtimeRef.current?.destroy();
            runtimeRef.current = null;
            if (app?.renderer) app.destroy({ removeView: true }, { children: true });
        };
    }, []);

    const fighters = shapes.filter(isFighterShape);
    const playerFighter = fighters.find((fighter) => fighter.id === "main")
        ?? fighters.find((fighter) => Number(fighter.slot) === 1)
        ?? fighters[0];
    const opponentFighter = fighters.find((fighter) => fighter.id === "opponent-model")
        ?? fighters.find((fighter) => Number(fighter.slot) === 2 && fighter.id !== playerFighter?.id)
        ?? fighters.find((fighter) => fighter.id !== playerFighter?.id);
    const opponentStatusFighter = opponentFighter
        ?? (showMissingOpponentStatus ? { id: "opponent-model", slot: 2, abilities: [], opponentUsername: "OPPONENT" } : null);
    const layoutClass = fixedLayout
        ? abilityLayout === "right"
            ? "pixi-combat-layout--fixed pixi-combat-layout--right max-w-[1120px]"
            : "pixi-combat-layout--fixed pixi-combat-layout--split max-w-[1360px]"
        : abilityLayout === "right"
            ? "max-w-[1120px] grid-cols-1 lg:grid-cols-[minmax(0,880px)_220px]"
            : "max-w-[1360px] grid-cols-1 lg:grid-cols-[220px_minmax(0,860px)_220px]";

    return (
        <div className={`mx-auto grid w-full items-center justify-center gap-3 ${layoutClass}`}>
            {abilityLayout !== "right" && (
                <div className={`${fixedLayout ? "order-1 min-w-0" : "order-2 min-w-0 lg:order-1"} ${fixedLayout ? "pixi-side-status" : ""}`}>
                    {playerFighter && <AbilityStatusPanel fighter={playerFighter} showEmptySlot={showEmptyAbilitySlot} />}
                </div>
            )}
            <div
                className={`relative justify-self-center overflow-hidden rounded-xl border border-border-mid bg-[#0d1117] ${fixedLayout ? "order-2" : "order-1 lg:order-2"}`}
                style={{
                    width: arenaSize ?? (fillAvailable ? "min(100%, 860px, calc(100svh - 90px))" : "min(100%, 860px, calc(100svh - 140px))"),
                    minWidth: fixedLayout ? "400px" : undefined,
                    aspectRatio: `${ARENA_WIDTH_UNITS} / ${ARENA_HEIGHT_UNITS}`,
                }}
                onContextMenu={(event) => event.preventDefault()}
            >
                <div ref={hostRef} className="pixi-arena-host absolute inset-0" />
                {!isRendererReady && (
                    <div className="pointer-events-none absolute inset-0 z-10 flex flex-col items-center justify-center gap-3 bg-[#0d1117] text-slate-400">
                        <div className="h-9 w-9 animate-spin rounded-full border-2 border-slate-700 border-t-cyan-300" aria-hidden="true" />
                        <p role="status" className="font-mono text-[10px] tracking-[0.22em]">INITIALIZING PIXI ARENA...</p>
                    </div>
                )}
                {!lockCamera && (
                    <div className="pointer-events-none absolute bottom-2 left-1/2 -translate-x-1/2 whitespace-nowrap rounded border border-slate-700/70 bg-zinc-950/75 px-2 py-1 font-mono text-[8px] tracking-widest text-slate-400">
                        WHEEL TO ZOOM · RIGHT-DRAG TO PAN
                    </div>
                )}
            </div>
            <div className={`order-3 min-w-0 space-y-3 ${fixedLayout ? "pixi-side-status" : ""}`}>
                {abilityLayout === "right" && playerFighter && <AbilityStatusPanel fighter={playerFighter} showEmptySlot={showEmptyAbilitySlot} />}
                {opponentStatusFighter && <AbilityStatusPanel fighter={opponentStatusFighter} showEmptySlot={showEmptyAbilitySlot} />}
            </div>
        </div>
    );
}

function createArenaRuntime(app, optionsRef) {
    const textureCache = createArenaTextureCache(app.renderer);
    const camera = new Container();
    const background = new Graphics();
    const layers = {
        zones: new Container(),
        projectiles: new Container(),
        entities: new Container(),
        fighters: new Container(),
    };
    const abilityEffects = new Graphics();
    const particleLayer = new Container();
    const measurementLayer = new Container();
    const overlay = new Graphics();
    camera.addChild(background, layers.zones, layers.projectiles, layers.entities, layers.fighters, abilityEffects, particleLayer, measurementLayer, overlay);
    app.stage.addChild(camera);
    app.stage.eventMode = "static";
    drawArena(background);

    const views = new Map();
    const particles = [];
    let zoom = MIN_ZOOM;
    let viewCenter = { x: ARENA_WIDTH_UNITS / 2, y: ARENA_HEIGHT_UNITS / 2 };
    let drag = null;
    let pan = null;
    let measurementSignature = null;
    let measurementHoverPoint = null;

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

    function createView(shape) {
        const container = new Container();
        const baseSprite = new Sprite();
        baseSprite.anchor.set(0.5);
        baseSprite.eventMode = "none";
        const cachedEffects = new Map();
        const graphics = new Graphics();
        const caption = new Text({ text: "", style: { fill: COLORS.white, fontFamily: "monospace", fontSize: 13, fontWeight: "bold", align: "center" } });
        caption.anchor.set(0.5);
        caption.eventMode = "none";
        container.addChild(baseSprite, graphics, caption);
        container.eventMode = "static";
        container.cursor = shape.locked || !optionsRef.current.editable ? "default" : "grab";
        container.hitArea = new Circle(0, 0, Math.max(12, Number(shape.size ?? (isFighterShape(shape) ? FIGHTER_SIZE : 30)) / 2 + 6));
        const view = {
            container,
            baseSprite,
            cachedEffects,
            graphics,
            caption,
            shape,
            motion: { from: { x: shape.x, y: shape.y }, to: { x: shape.x, y: shape.y }, startedAt: performance.now(), durationMs: 0 },
        };
        layers[pixiLayerForShape(shape)].addChild(container);
        container.on("pointerdown", (event) => beginDrag(event, view));
        return view;
    }

    function sampleViewPosition(view, now = performance.now()) {
        const alpha = view.motion.durationMs <= 0 ? 1 : clamp((now - view.motion.startedAt) / view.motion.durationMs, 0, 1);
        return interpolatePosition(view.motion.from, view.motion.to, alpha);
    }

    function syncShapes(nextShapes) {
        const now = performance.now();
        const nextIds = new Set(nextShapes.map((shape) => shape.id));
        for (const [id, view] of views) {
            if (nextIds.has(id)) continue;
            view.container.destroy({ children: true });
            views.delete(id);
        }
        for (const shape of nextShapes) {
            prewarmShapeTextures(textureCache, shape);
            let view = views.get(shape.id);
            if (!view) {
                view = createView(shape);
                views.set(shape.id, view);
                if (["grenadeExplosion", "mineExplosion", "gravityExplosion", "orbitalExplosion"].includes(shape.type)) {
                    spawnBurst(shape.x, shape.y, explosionColor(shape.type), shape.type === "orbitalExplosion" ? 30 : 18);
                }
            }
            const previousShape = view.shape;
            const current = sampleViewPosition(view, now);
            const durationMs = drag?.id === shape.id ? 0 : shapeInterpolationMs(shape);
            view.shape = shape;
            const target = { x: Number(shape.x), y: Number(shape.y) };
            if (target.x !== view.motion.to.x || target.y !== view.motion.to.y || durationMs !== view.motion.durationMs) {
                view.motion = { from: current, to: target, startedAt: now, durationMs };
            }
            view.container.cursor = shape.locked || !optionsRef.current.editable ? "default" : "grab";
            view.container.hitArea = new Circle(0, 0, Math.max(12, Number(shape.size ?? (isFighterShape(shape) ? FIGHTER_SIZE : 30)) / 2 + 6));
            if (Number(shape.hitFlashMs ?? 0) > 0 && Number(previousShape?.hitFlashMs ?? 0) <= 0) {
                spawnBurst(shape.x, shape.y, 0xfca5a5, 8);
            }
            const previousAbility = activeFighterVisual(previousShape);
            const nextAbility = activeFighterVisual(shape);
            if (isFighterShape(shape) && nextAbility && previousAbility !== nextAbility && ["repair_pulse", "phase_strike", "repulsor_burst"].includes(nextAbility)) {
                spawnBurst(shape.x, shape.y, nextAbility === "repair_pulse" ? 0x6ee7b7 : 0xc4b5fd, 12);
            }
        }
    }

    function beginDrag(event, view) {
        if (event.button !== 0) return;
        event.stopPropagation();
        optionsRef.current.onSelectShape?.(view.shape.id);
        if (view.shape.locked || !optionsRef.current.editable) return;
        const point = camera.toLocal(event.global);
        const position = sampleViewPosition(view);
        drag = { id: view.shape.id, offsetX: point.x - position.x, offsetY: point.y - position.y };
        view.container.cursor = "grabbing";
    }

    function spawnBurst(x, y, color, count) {
        for (let index = 0; index < count; index += 1) {
            const angle = Math.PI * 2 * index / count + (index % 3) * 0.11;
            const speed = 55 + (index % 6) * 18;
            const radius = 2 + index % 3;
            const texture = textureCache.get(
                `particle:${color}:${radius}`,
                centeredTextureFrame(radius + 1),
                (graphics) => graphics.circle(0, 0, radius).fill({ color, alpha: 0.95 }),
            );
            const display = new Sprite({ texture, anchor: 0.5 });
            display.position.set(x, y);
            particleLayer.addChild(display);
            particles.push({ display, x, y, vx: Math.cos(angle) * speed, vy: Math.sin(angle) * speed, lifeMs: 480 + (index % 4) * 70, totalMs: 690 });
        }
    }

    function render() {
        updateCamera();
        abilityEffects.clear();
        overlay.clear();
        const now = performance.now();
        for (const view of views.values()) {
            const position = sampleViewPosition(view, now);
            view.container.position.set(position.x, position.y);
            if (isFighterShape(view.shape)) drawFighter(view, position, optionsRef.current.selectedId === view.shape.id, abilityEffects, textureCache);
            else drawEntity(view, optionsRef.current.selectedId === view.shape.id, abilityEffects, textureCache);
        }
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

    function tick(ticker) {
        render();
        const seconds = Math.min(0.05, ticker.deltaMS / 1000);
        for (let index = particles.length - 1; index >= 0; index -= 1) {
            const particle = particles[index];
            particle.lifeMs -= ticker.deltaMS;
            particle.x += particle.vx * seconds;
            particle.y += particle.vy * seconds;
            particle.vx *= 0.97;
            particle.vy *= 0.97;
            particle.display.position.set(particle.x, particle.y);
            particle.display.alpha = clamp(particle.lifeMs / particle.totalMs, 0, 1);
            if (particle.lifeMs <= 0) {
                particle.display.destroy();
                particles.splice(index, 1);
            }
        }
    }

    app.stage.on("pointerdown", (event) => {
        if (event.target !== app.stage) return;
        if (event.button === 2 || event.button === 1) {
            if (optionsRef.current.lockCamera) return;
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
    });
    app.stage.on("globalpointermove", (event) => {
        if (drag) {
            const view = views.get(drag.id);
            if (!view) return;
            const point = camera.toLocal(event.global);
            const radius = Number(view.shape.size ?? FIGHTER_SIZE) / 2;
            const position = {
                x: clamp(point.x - drag.offsetX, radius, ARENA_WIDTH_UNITS - radius),
                y: clamp(point.y - drag.offsetY, radius, ARENA_HEIGHT_UNITS - radius),
            };
            view.motion = { from: position, to: position, startedAt: performance.now(), durationMs: 0 };
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
    });
    const endPointer = () => {
        if (drag) {
            const view = views.get(drag.id);
            if (view) view.container.cursor = "grab";
        }
        drag = null;
        pan = null;
    };
    app.stage.on("pointerup", endPointer);
    app.stage.on("pointerupoutside", endPointer);

    const handleWheel = (event) => {
        event.preventDefault();
        if (optionsRef.current.lockCamera) return;
        const bounds = app.canvas.getBoundingClientRect();
        const cursor = { x: event.clientX - bounds.left, y: event.clientY - bounds.top };
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
    app.canvas.addEventListener("contextmenu", preventContextMenu);
    app.canvas.addEventListener("pointerleave", clearMeasurementHover);
    app.ticker.add(tick);

    return {
        syncShapes,
        destroy() {
            app.ticker.remove(tick);
            app.canvas.removeEventListener("wheel", handleWheel);
            app.canvas.removeEventListener("contextmenu", preventContextMenu);
            app.canvas.removeEventListener("pointerleave", clearMeasurementHover);
            textureCache.destroy();
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

function drawFighter(view, position, selected, effects, textureCache) {
    const { shape, baseSprite, graphics, caption } = view;
    const colorRole = fighterColorRole(shape);
    const tone = colorRole === "pink" ? COLORS.opponent : COLORS.player;
    const radius = Number(shape.size ?? FIGHTER_SIZE) / 2;
    const rotation = compassDegreesToRadians(shape.rotation);
    const slowed = Number(shape.slowedMs ?? 0) > 0;
    const dashing = Number(shape.dashActiveMs ?? 0) > 0 || Number(shape.microDashActiveMs ?? 0) > 0;
    hideCachedEffects(view);
    graphics.clear();

    baseSprite.texture = fighterTexture(textureCache, colorRole, radius, tone);
    baseSprite.rotation = rotation;
    const dead = Number(shape.hp ?? 0) <= 0;
    baseSprite.alpha = dead ? 0.45 : slowed ? 0.7 : 1;
    if (dashing) showCachedEffect(view, "dash", dashTexture(textureCache, radius, tone), { rotation: fighterDashRotation(shape) });
    if (selected) graphics.circle(0, 0, radius + 7).stroke({ color: COLORS.white, alpha: 0.72, width: 2 });

    if (shape.hp != null) {
        const width = 80;
        graphics.roundRect(-width / 2, -radius - 16, width, 8, 2).fill(0x09090b).stroke({ color: 0x3f3f46, width: 1 });
        graphics.rect(-width / 2 + 1, -radius - 15, (width - 2) * healthBarPercent(shape.hp, shape.maxHp) / 100, 6).fill(COLORS.hp);
    }
    if (!dead && shape.preparingAbility) {
        const pulse = 0.55 + Math.sin(performance.now() / 85) * 0.25;
        graphics.circle(0, 0, radius + 12).stroke({ color: 0xfde68a, alpha: pulse, width: 3 });
    }
    if (Number(shape.hitFlashMs ?? 0) > 0) graphics.circle(0, 0, radius + 2).fill({ color: 0xef4444, alpha: 0.5 }).stroke({ color: 0xfca5a5, width: 3 });
    if (Number(shape.blockActiveMs ?? 0) > 0) {
        showCachedEffect(view, "block", shieldTexture(textureCache, radius), { rotation });
    }
    if (Number(shape.swingActiveMs ?? 0) > 0) {
        const halfArc = Number(MOVE_STATS.swing.arcDegrees) / 2;
        const angle = rotation + radians(swordSweepAngle(shape.swingActiveMs, MOVE_STATS.swing.activeMs, -halfArc, halfArc));
        showCachedEffect(view, "swing", meleeTexture(textureCache, "swing", MOVE_STATS.swing.range, 0xfca5a5, 12), { rotation: angle });
    }
    drawStatusIcons(graphics, shape, radius);
    drawStatusAnimations(graphics, shape, radius);
    if (dead) drawDeadMarker(graphics);

    caption.text = fighterDisplayName(shape);
    caption.style.fill = tone;
    caption.position.set(0, -radius - 29);
    caption.visible = true;
    drawFighterWorldEffects(shape, position, effects, view, textureCache);
}

function fighterDisplayName(shape) {
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

function fighterTexture(textureCache, colorRole, radius, tone) {
    return textureCache.get(
        `fighter:${colorRole}:${radius}`,
        centeredTextureFrame(radius + 18),
        (graphics) => {
            graphics.circle(0, 0, radius).fill({ color: colorRole === "pink" ? 0x2b122f : 0x0b2730, alpha: 0.9 }).stroke({ color: tone, width: 4 });
            graphics.poly([radius + 15, 0, radius + 4, 7, radius + 4, -7]).fill(tone);
        },
    );
}

function prewarmShapeTextures(textureCache, shape) {
    if (!isFighterShape(shape)) {
        const size = Math.max(2, Number(shape.size ?? 30));
        entityTexture(textureCache, shape, size, size / 2);
        return;
    }

    const colorRole = fighterColorRole(shape);
    const tone = colorRole === "pink" ? COLORS.opponent : COLORS.player;
    const radius = Number(shape.size ?? FIGHTER_SIZE) / 2;
    const abilities = new Set(shape.abilities ?? []);
    fighterTexture(textureCache, colorRole, radius, tone);
    if (abilities.has("dash") || abilities.has("micro_dash")) dashTexture(textureCache, radius, tone);
    if (abilities.has("block")) shieldTexture(textureCache, radius);
    if (abilities.has("swing")) meleeTexture(textureCache, "swing", MOVE_STATS.swing.range, 0xfca5a5, 12);
    if (abilities.has("heavy_slash")) meleeTexture(textureCache, "heavy_slash", MOVE_STATS.swing.range, 0xfee2e2, 13);
    if (abilities.has("quick_jab")) meleeTexture(textureCache, "quick_jab", 52, 0xffe4e6, 8);
    if (abilities.has("thrust")) meleeTexture(textureCache, "thrust", 100, 0xfee2e2, 8);
    if (abilities.has("stun")) stunFanTexture(textureCache);
    if (abilities.has("repair_pulse")) prewarmRingAnimation(textureCache, "repair_pulse", 43, 0x6ee7b7, 5, 0.12, 1);
    if (abilities.has("repulsor_burst")) prewarmRingAnimation(textureCache, "repulsor_burst", Number(ABILITY_STATS.repulsor_burst.radius ?? 110), 0xddd6fe, 5, 0.12, 1);
    if (abilities.has("phase_strike")) prewarmRingAnimation(textureCache, "phase_strike", 70, 0xf0abfc, 4, 0.6, 1);
    if (abilities.has("reactive_armor")) prewarmRingAnimation(textureCache, "reactive_armor", 56, 0xfbbf24, 5, 40 / 56, 1);
    if (abilities.has("absolute_guard")) prewarmRingAnimation(textureCache, "absolute_guard", 56, 0xe2e8f0, 7, 40 / 56, 1);
}

function prewarmRingAnimation(textureCache, id, maxRadius, color, width, minScale, maxScale, frames = 8) {
    for (let frame = 0; frame < frames; frame += 1) {
        const progress = frame / (frames - 1);
        ringTexture(textureCache, id, maxRadius * (minScale + progress * (maxScale - minScale)), color, width);
    }
}

function dashTexture(textureCache, radius, tone) {
    return textureCache.get(
        `effect:dash:${tone}:${radius}`,
        { x: -130, y: -radius - 16, width: 260, height: (radius + 16) * 2 },
        (graphics) => {
            graphics.moveTo(-115, 0).lineTo(-30, 0).stroke({ color: tone, alpha: 0.32, width: 24 });
            graphics.circle(0, 0, radius + 10).stroke({ color: tone, alpha: 0.5, width: 5 });
        },
    );
}

function shieldTexture(textureCache, radius) {
    return textureCache.get(
        `effect:shield:${radius}`,
        centeredTextureFrame(radius + 22),
        (graphics) => graphics.arc(0, 0, radius + 13, -Math.PI / 2, Math.PI / 2).stroke({ color: 0xbfdbfe, alpha: 0.95, width: 11 }),
    );
}

function meleeTexture(textureCache, id, length, color, width) {
    const extent = Math.ceil(length + width);
    return textureCache.get(
        `effect:melee:${id}:${length}:${color}:${width}`,
        centeredTextureFrame(extent),
        (graphics) => drawMeleeLine(graphics, 0, length, color, width),
    );
}

function hideCachedEffects(view) {
    for (const sprite of view.cachedEffects.values()) sprite.visible = false;
}

function showCachedEffect(view, slot, texture, { x = 0, y = 0, rotation = 0, alpha = 1 } = {}) {
    let sprite = view.cachedEffects.get(slot);
    if (!sprite) {
        sprite = new Sprite({ anchor: 0.5 });
        sprite.eventMode = "none";
        view.cachedEffects.set(slot, sprite);
        view.container.addChildAt(sprite, 1);
    }
    sprite.texture = texture;
    sprite.position.set(x, y);
    sprite.rotation = rotation;
    sprite.alpha = alpha;
    sprite.visible = true;
    return sprite;
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
});

function drawStatusIcons(graphics, shape, radius) {
    const statuses = fighterStatusLabels(shape);
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
    }
}

function drawStatusAnimations(graphics, shape, radius) {
    const frame = Math.floor(performance.now() / 120) % 4;
    if (Number(shape.burnRemainingMs ?? 0) > 0) {
        const heights = [[7, 11, 8], [10, 7, 12], [8, 12, 6], [11, 8, 10]][frame];
        [-13, 0, 13].forEach((x, index) => {
            const baseY = radius + 4;
            graphics.poly([x, baseY - heights[index], x + 5, baseY - 2, x + 2, baseY + 5, x - 4, baseY + 4, x - 5, baseY - 1]).fill(index === 1 ? 0xfde047 : 0xfb923c);
        });
    }
    if (Number(shape.bleedRemainingMs ?? 0) > 0) {
        const drops = [[-18, 5], [-6, 11], [8, 2], [18, 8]];
        drops.forEach(([x, offset], index) => {
            const fall = (frame + index) % 4 * 4;
            drawDroplet(graphics, x, radius - 3 + offset + fall, 3, 0xef4444);
        });
    }
    if (Number(shape.shockRemainingMs ?? 0) > 0) {
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

function drawFighterWorldEffects(shape, position, effects, view, textureCache) {
    const rotation = compassDegreesToRadians(shape.rotation);
    if (Number(shape.gunActiveMs ?? 0) > 0) {
        drawAnchoredRay(effects, shape, position, Number(shape.gunRayOriginX ?? shape.x), Number(shape.gunRayOriginY ?? shape.y), Number(shape.gunRayRotation ?? shape.rotation), MOVE_STATS.fire_gun.range, 0xfde68a, gunRayOpacity(shape), 3);
    }
    if (Number(shape.stunActiveMs ?? 0) > 0) {
        const opacity = clamp(Number(shape.stunActiveMs) / Number(ABILITY_STATS.stun.windupMs), 0, 1);
        showCachedEffect(view, "stun", stunFanTexture(textureCache), { rotation, alpha: opacity });
    }
    if (Number(shape.temporalRewindPulseMs ?? 0) > 0) {
        const progress = quantizedProgress(visualProgress(shape.temporalRewindPulseMs, 400));
        const x = Number(shape.temporalRewindVisualX ?? shape.temporalRewindX ?? position.x);
        const y = Number(shape.temporalRewindVisualY ?? shape.temporalRewindY ?? position.y);
        showCachedEffect(view, "rewind-pulse", ringTexture(textureCache, "rewind", 10 + progress * 42, 0xcffafe, 3), {
            x: x - position.x,
            y: y - position.y,
            alpha: 1 - progress,
        });
    }

    const visual = activeFighterVisual(shape);
    if (!visual) return;
    const stats = ABILITY_STATS[visual] ?? MOVE_STATS[visual] ?? {};
    const selfGuardFlash = visual === "reactive_armor" || visual === "absolute_guard";
    const remaining = selfGuardFlash ? Number(shape.prototypeVisual?.ms ?? 0) : combatVisualRemainingMs(shape, visual);
    const duration = Number(stats.visualMs ?? 300);
    const opacity = prototypeVisualOpacity(shape, visual, duration);
    const originX = Number(shape.prototypeVisual?.x ?? shape.visualOriginX ?? position.x);
    const originY = Number(shape.prototypeVisual?.y ?? shape.visualOriginY ?? position.y);
    const originRotation = Number(shape.prototypeVisual?.rotation ?? shape.visualOriginRotation ?? shape.rotation);
    const angle = compassDegreesToRadians(originRotation);
    if (visual === "repair_pulse" || visual === "repulsor_burst") {
        const progress = quantizedProgress(visualProgress(remaining, duration));
        const maxRadius = visual === "repair_pulse" ? 43 : Number(stats.radius ?? 110);
        const color = visual === "repair_pulse" ? 0x6ee7b7 : 0xddd6fe;
        showCachedEffect(view, "ability", ringTexture(textureCache, visual, maxRadius * (0.12 + progress * 0.88), color, 5), { alpha: 1 - progress });
    } else if (visual === "heavy_slash") {
        const sweep = angle + radians(swordSweepAngle(remaining, duration, -50, 50));
        showCachedEffect(view, "ability", meleeTexture(textureCache, visual, MOVE_STATS.swing.range, 0xfee2e2, 13), { rotation: sweep, alpha: opacity });
    } else if (visual === "quick_jab") {
        showCachedEffect(view, "ability", meleeTexture(textureCache, visual, 52, 0xffe4e6, 8), { rotation: angle, alpha: opacity });
    } else if (visual === "thrust") {
        showCachedEffect(view, "ability", meleeTexture(textureCache, visual, 100, 0xfee2e2, 8), { rotation: angle, alpha: opacity });
    } else if (["pistol_shot", "concussive_shot", "rail_shot"].includes(visual)) {
        const tone = visual === "rail_shot" ? 0xcffafe : visual === "concussive_shot" ? 0xbfdbfe : 0xfef3c7;
        drawAnchoredRay(effects, shape, position, originX, originY, originRotation, Number(stats.range ?? 500), tone, opacity, visual === "rail_shot" ? 7 : 3);
    } else if (visual === "phase_strike") {
        const progress = quantizedProgress(visualProgress(remaining, duration));
        showCachedEffect(view, "ability", ringTexture(textureCache, visual, 42 + progress * 28, 0xf0abfc, 4), { alpha: opacity });
    } else if (visual === "reactive_armor" || visual === "absolute_guard") {
        const progress = quantizedProgress(visualProgress(remaining, duration));
        const radius = 40 + progress * 16;
        const color = visual === "reactive_armor" ? 0xfbbf24 : 0xe2e8f0;
        const width = visual === "reactive_armor" ? 5 : 7;
        showCachedEffect(view, "ability", ringTexture(textureCache, visual, radius, color, width), { alpha: 1 - progress });
    }
}

function quantizedProgress(progress, frames = 8) {
    return Math.round(clamp(progress, 0, 1) * (frames - 1)) / (frames - 1);
}

function ringTexture(textureCache, id, radius, color, width) {
    const roundedRadius = Math.round(radius * 2) / 2;
    return textureCache.get(
        `effect:ring:${id}:${roundedRadius}:${color}:${width}`,
        centeredTextureFrame(roundedRadius + width + 2),
        (graphics) => graphics.circle(0, 0, roundedRadius).stroke({ color, width }),
    );
}

function stunFanTexture(textureCache) {
    return textureCache.get(
        "effect:stun-fan",
        centeredTextureFrame(306),
        (graphics) => {
            for (const offset of [-50, -17, 17, 50]) drawRay(graphics, 0, 0, radians(offset), 300, 0xfef08a, 1, 4);
        },
    );
}

function drawAnchoredRay(graphics, shape, position, originX, originY, rotation, length, color, alpha, width) {
    const x = Number.isFinite(originX) ? originX : position.x;
    const y = Number.isFinite(originY) ? originY : position.y;
    drawRay(graphics, x, y, compassDegreesToRadians(rotation ?? shape.rotation), length, color, alpha, width);
}

function drawRay(graphics, x, y, angle, length, color, alpha = 1, width = 3) {
    graphics.moveTo(x, y).lineTo(x + Math.cos(angle) * length, y + Math.sin(angle) * length).stroke({ color, alpha, width });
}

function drawMeleeLine(graphics, angle, length, color, width) {
    graphics.moveTo(Math.cos(angle) * 15, Math.sin(angle) * 15).lineTo(Math.cos(angle) * length, Math.sin(angle) * length).stroke({ color, width, cap: "round" });
}

function drawEntity(view, selected, effects, textureCache) {
    const { shape, baseSprite, graphics, caption } = view;
    const size = Math.max(2, Number(shape.size ?? 30));
    const radius = size / 2;
    const rotation = compassDegreesToRadians(shape.rotation);
    hideCachedEffects(view);
    graphics.clear();
    baseSprite.texture = entityTexture(textureCache, shape, size, radius);
    baseSprite.rotation = shape.type === "silenceWave" ? rotation : 0;
    baseSprite.alpha = 1;
    caption.text = entityCaption(shape);
    caption.visible = Boolean(caption.text);
    caption.position.set(0, shape.type === "nullZone" ? 0 : -radius - 10);

    const trailStyle = projectileTrailStyle(shape);
    if (trailStyle) drawVelocityTrail(graphics, shape, trailStyle.color, trailStyle.length, trailStyle.width);

    if (shape.type === "orbitalExplosion") {
        effects.moveTo(shape.x, shape.y - radius * 1.8).lineTo(shape.x, shape.y + radius * 1.8).stroke({ color: 0xffffff, alpha: 0.92, width: 24 });
    } else if (shape.type === "gravityField") {
        if (shape.armed) graphics.circle(0, 0, radius * (0.72 + Math.sin(performance.now() / 100) * 0.08)).stroke({ color: 0xddd6fe, alpha: 0.5, width: 3 });
    } else if (shape.type === "hunterDrone") {
        if (Number(shape.shotVisualMs ?? 0) > 0) {
            const alpha = clamp(Number(shape.shotVisualMs) / 300, 0.2, 1);
            drawRay(effects, shape.x, shape.y, rotation, 200, 0x10b981, alpha * 0.4, 10);
            drawRay(effects, shape.x, shape.y, rotation, 200, 0xecfdf5, alpha, 4);
        }
    } else if (shape.type === "temporalRewindZone") {
        const remaining = Number(shape.remainingMs ?? 0);
        const winding = remaining > 0 && remaining <= 1000;
        const hand = winding ? radians(-(1000 - remaining) * 0.72) : 0;
        graphics.moveTo(0, 0).lineTo(Math.cos(hand) * radius * 0.7, Math.sin(hand) * radius * 0.7).stroke({ color: 0xcffafe, width: 3 });
        graphics.moveTo(0, 0).lineTo(Math.cos(hand * 1.8 + Math.PI / 2) * radius * 0.5, Math.sin(hand * 1.8 + Math.PI / 2) * radius * 0.5).stroke({ color: COLORS.white, width: 2 });
    }
    if (selected) graphics.circle(0, 0, radius + 6).stroke({ color: COLORS.white, alpha: 0.8, width: 2 });
    if (Number(shape.hitFlashMs ?? 0) > 0) graphics.circle(0, 0, radius + 2).fill({ color: 0xef4444, alpha: 0.5 });
}

function entityTexture(textureCache, shape, size, radius) {
    const state = shape.type === "proximityMine" ? (shape.armed ? "armed" : "idle")
        : shape.type === "temporalRewindZone" && Number(shape.remainingMs ?? 0) > 0 && Number(shape.remainingMs ?? 0) <= 1000 ? "winding"
            : "default";
    return textureCache.get(
        `entity:${shape.type}:${size}:${state}`,
        centeredTextureFrame(radius + 16),
        (graphics) => drawStaticEntity(graphics, shape.type, size, radius, state),
    );
}

function drawStaticEntity(graphics, type, size, radius, state) {
    if (type === "grenade") {
        graphics.circle(0, 0, radius).fill(0xa3e635).stroke({ color: 0xecfccb, width: 2 });
    } else if (type === "grenadeExplosion") {
        graphics.circle(0, 0, radius).fill({ color: 0xfb923c, alpha: 0.28 }).stroke({ color: 0xfed7aa, width: 5 });
    } else if (type === "fireball") {
        graphics.circle(0, 0, radius + 5).fill({ color: 0xfb923c, alpha: 0.18 }).circle(0, 0, radius).fill(0xf97316).circle(-3, -3, radius * 0.45).fill(0xfef08a);
    } else if (type === "proximityMine") {
        const armed = state === "armed";
        graphics.circle(0, 0, radius).fill({ color: armed ? 0xef4444 : 0x06b6d4, alpha: 0.34 }).stroke({ color: armed ? 0xfecaca : 0xcffafe, width: 3 }).circle(0, 0, 4).fill(COLORS.white);
    } else if (type === "mineExplosion") {
        graphics.circle(0, 0, radius).fill({ color: 0xef4444, alpha: 0.32 }).stroke({ color: 0xfee2e2, width: 7 });
    } else if (type === "orbitalMarker") {
        graphics.circle(0, 0, radius).fill({ color: 0xf43f5e, alpha: 0.08 }).stroke({ color: 0xfda4af, alpha: 0.85, width: 5 });
        graphics.moveTo(-radius, 0).lineTo(radius, 0).moveTo(0, -radius).lineTo(0, radius).stroke({ color: 0xfecdd3, alpha: 0.65, width: 2 });
    } else if (type === "orbitalExplosion") {
        graphics.circle(0, 0, radius).fill({ color: 0xffffff, alpha: 0.7 }).stroke({ color: 0xfef08a, width: 10 });
    } else if (type === "gravityField") {
        graphics.circle(0, 0, radius).fill({ color: 0x7c3aed, alpha: 0.12 }).stroke({ color: 0xc4b5fd, alpha: 0.6, width: 4 }).circle(0, 0, 16).fill(0x5b21b6).stroke({ color: 0xede9fe, width: 3 });
    } else if (type === "gravityExplosion") {
        graphics.circle(0, 0, radius).fill({ color: 0xa78bfa, alpha: 0.3 }).stroke({ color: 0xede9fe, width: 9 });
    } else if (type === "nullZone") {
        graphics.circle(0, 0, radius).fill({ color: 0x3b82f6, alpha: 0.1 }).stroke({ color: 0x93c5fd, alpha: 0.85, width: 6 }).circle(0, 0, radius * 0.7).stroke({ color: 0xdbeafe, alpha: 0.6, width: 3 });
    } else if (type === "hunterDrone") {
        graphics.roundRect(-radius, -radius, size, size, 5).fill({ color: 0x10b981, alpha: 0.35 }).stroke({ color: 0xa7f3d0, width: 3 });
        graphics.circle(-radius - 6, 0, 5).fill(0xd1fae5).circle(radius + 6, 0, 5).fill(0xd1fae5).circle(0, 0, 4).fill(COLORS.white);
    } else if (type === "silenceWave") {
        graphics.arc(0, 0, radius, -Math.PI / 2, Math.PI / 2).stroke({ color: 0x93c5fd, alpha: 0.8, width: 8 });
        graphics.arc(0, 0, radius * 0.72, -Math.PI / 2, Math.PI / 2).stroke({ color: 0xbfdbfe, alpha: 0.38, width: 3 });
    } else if (type === "temporalRewindZone") {
        const winding = state === "winding";
        graphics.circle(0, 0, radius).fill({ color: 0x020617, alpha: 0.5 }).stroke({ color: winding ? 0xcffafe : 0x94a3b8, alpha: winding ? 0.95 : 0.5, width: 3 });
    } else {
        graphics.circle(0, 0, radius).fill({ color: 0x64748b, alpha: 0.4 }).stroke({ color: 0xcbd5e1, width: 2 });
    }
}

function drawVelocityTrail(graphics, shape, color, length = 28, width = 5) {
    const speed = Math.hypot(Number(shape.velocityX ?? 0), Number(shape.velocityY ?? 0));
    if (speed <= 0.01) return;
    const backwardX = -Number(shape.velocityX) / speed;
    const backwardY = -Number(shape.velocityY) / speed;
    const perpendicularX = -backwardY;
    const perpendicularY = backwardX;
    const phase = performance.now() / 115;
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

    const pulse = 0.12 + ((performance.now() / 420) % 1) * 0.68;
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
        graphics.moveTo(0, top).lineTo(ARENA_WIDTH_UNITS, top).stroke({ color: 0x67e8f9, alpha: 0.8, width: 3 });
    } else {
        graphics.rect(0, bottom, ARENA_WIDTH_UNITS, ARENA_HEIGHT_UNITS - bottom).fill({ color: COLORS.opponent, alpha: 0.06 });
        graphics.moveTo(0, bottom).lineTo(ARENA_WIDTH_UNITS, bottom).stroke({ color: 0xf0abfc, alpha: 0.8, width: 3 });
    }
}

function drawMeasurements(layer, points, hoverPoint = null) {
    layer.removeChildren().forEach((child) => child.destroy());
    const graphics = new Graphics();
    if (points.length === 2) graphics.moveTo(points[0].x, points[0].y).lineTo(points[1].x, points[1].y).stroke({ color: 0x67e8f9, width: 3 });
    points.forEach((point) => graphics.circle(point.x, point.y, 7).fill(0x22d3ee).stroke({ color: COLORS.white, width: 2 }));
    if (points.length || hoverPoint) layer.addChild(graphics);
    if (points.length === 2) {
        const distance = Math.hypot(points[1].x - points[0].x, points[1].y - points[0].y);
        const label = new Text({ text: `${distance.toFixed(1)} units`, style: { fill: COLORS.white, fontFamily: "monospace", fontSize: 12, fontWeight: "bold" } });
        label.anchor.set(0.5);
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
        coordinateLabel.position.set(hoverPoint.x + (hoverPoint.x > ARENA_WIDTH_UNITS - 150 ? -8 : 8), hoverPoint.y + (hoverPoint.y < 30 ? 8 : -8));
        layer.addChild(coordinateLabel);
    }
}

function explosionColor(type) {
    if (type === "gravityExplosion") return 0xc4b5fd;
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
