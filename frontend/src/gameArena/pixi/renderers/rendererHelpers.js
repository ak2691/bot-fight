import { ABILITY_STATS } from "../../gameconfig/Abilities.js";
import { ABILITIES } from "../../gameconfig/AbilityRegistry.js";
import { preparingAbilityId } from "../../gameconfig/AbilityState.js";
import { abilityVisualOpacity, combatVisualRemainingMs, sweepAngle, visualProgress } from "../../gameconfig/visualState.js";
import { triggerView } from "../../ecs/contracts/AbilityContracts.js";
import { compassDegreesToRadians } from "../../botlogic/planner/arenaAngles.js";
import { botAbilityActiveMs } from "../botAbilityPresentationDefinitions.js";
import { heavySlashRotation, weaponWindupProgress } from "../pixiVisualState.js";
import { visualRayLength } from "../rayPresentationGeometry.js";

/**
 * Pure helpers shared by the bot ability renderers. Nothing here touches Pixi:
 * sprites go through the `kit` the canvas passes in, so renderers stay testable
 * and every number comes from state and contract values (no randomness).
 */

export const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
export const radians = (degrees) => degrees * Math.PI / 180;

export function abilityHitbox(abilityId) {
    return triggerView(abilityId)?.hitbox ?? {};
}

export function abilityVisual(abilityId) {
    return triggerView(abilityId)?.visual ?? {};
}

export function abilityStats(abilityId) {
    return ABILITY_STATS[abilityId] ?? {};
}

/** A renderer that only draws the bot's active effect, in the world pass. */
export function activeRenderer(draw) {
    return Object.freeze({
        create: () => ({}),
        update(ctx) {
            if (ctx.pass === "world" && ctx.active) draw(ctx);
        },
        destroy() {},
    });
}

/** Wind-up progress (0..1) while the bot is preparing this renderer's ability, else null. */
export function windupProgress(ctx) {
    const { shape, abilityId } = ctx;
    if (preparingAbilityId(shape) !== abilityId) return null;
    return weaponWindupProgress(shape, abilityId, abilityStats(abilityId).windupMs);
}

/** Remaining/total time, opacity and origin of the activation visual the bot is showing. */
export function activeVisualFrame(ctx) {
    const { shape, position, abilityId, presentation } = ctx;
    const phase = triggerView(abilityId);
    const phaseHitbox = phase?.hitbox ?? {};
    const phaseVisual = phase?.visual ?? {};
    const duration = Number(phaseVisual.visibleMs ?? 300);
    const activeMs = botAbilityActiveMs(shape, presentation);
    const configuredActiveMs = Number(phaseVisual.visibleMs ?? abilityStats(abilityId).activeMs ?? duration);
    const replayActivationRemainingMs = Math.max(0, duration - Math.max(0, configuredActiveMs - activeMs));
    const remaining = presentation.selfGuardFlash === true
        ? Math.max(Number(shape.abilityVisual?.ms ?? 0), replayActivationRemainingMs)
        : combatVisualRemainingMs(shape, abilityId);
    const originX = Number(shape.abilityVisual?.x ?? shape.visualOriginX ?? position.x);
    const originY = Number(shape.abilityVisual?.y ?? shape.visualOriginY ?? position.y);
    const originRotation = Number(shape.abilityVisual?.rotation ?? shape.visualOriginRotation ?? shape.rotation);
    return {
        phaseHitbox,
        phaseVisual,
        duration,
        remaining,
        opacity: abilityVisualOpacity(shape, abilityId, duration),
        originX,
        originY,
        originRotation,
        angle: compassDegreesToRadians(originRotation),
    };
}

export function rotatePoint(angle, forward, lateral) {
    const cos = Math.cos(angle);
    const sin = Math.sin(angle);
    return [forward * cos - lateral * sin, forward * sin + lateral * cos];
}

export function rectanglePoints(angle, ox, oy, length, width) {
    return [[0, -width / 2], [length, -width / 2], [length, width / 2], [0, width / 2]]
        .flatMap(([forward, lateral]) => {
            const [x, y] = rotatePoint(angle, forward, lateral);
            return [ox + x, oy + y];
        });
}

export function sectorPoints(angle, ox, oy, range, arcDegrees) {
    const half = radians(arcDegrees) / 2;
    const steps = Math.max(4, Math.ceil(arcDegrees / 10));
    const points = [ox, oy];
    for (let step = 0; step <= steps; step += 1) {
        const [x, y] = rotatePoint(angle - half + (half * 2 * step) / steps, range, 0);
        points.push(ox + x, oy + y);
    }
    return points;
}

export function drawProceduralRay(graphics, position, originX, originY, rotation, range, color, alpha, width) {
    const startX = Number(originX) - Number(position.x);
    const startY = Number(originY) - Number(position.y);
    const angle = compassDegreesToRadians(rotation);
    const endX = startX + Math.cos(angle) * range;
    const endY = startY + Math.sin(angle) * range;
    graphics.moveTo(startX, startY).lineTo(endX, endY).stroke({ color, alpha: alpha * 0.26, width: width * 2.6 });
    graphics.moveTo(startX, startY).lineTo(endX, endY).stroke({ color, alpha, width });
    graphics.circle(endX, endY, width * 1.8).fill({ color, alpha: alpha * 0.65 });
}

export function showSlash(kit, view, frames, remaining, duration, rotation, size, tint, alpha) {
    const texture = kit.frameAtProgress(frames, visualProgress(remaining, duration));
    kit.showEffect(view, "ability", texture, { rotation, width: size, height: size, tint, alpha });
}

export function showRay(kit, view, slot, arenaSprites, position, originX, originY, rotation, abilityId, length, alpha, height, tint = 0xffffff, framesKey = null) {
    const frames = arenaSprites.abilities.rays[framesKey ?? ABILITIES[abilityId]?.name];
    const x = Number.isFinite(originX) ? originX : position.x;
    const y = Number.isFinite(originY) ? originY : position.y;
    const texture = kit.frameAtProgress(frames, 1 - alpha);
    const muzzleAnchor = kit.muzzleAnchor(texture);
    kit.showEffect(view, slot, texture, {
        x: x - position.x,
        y: y - position.y,
        rotation: compassDegreesToRadians(rotation),
        alpha,
        tint,
        width: visualRayLength(length, muzzleAnchor),
        height,
        anchorX: muzzleAnchor,
        blendMode: "screen",
    });
}

export function showMuzzleFlash(kit, view, arenaSprites, position, originX, originY, rotation, alpha, botSize) {
    const frames = arenaSprites.abilities.muzzleFlash;
    if (!frames?.length) return;
    const x = Number.isFinite(originX) ? originX : position.x;
    const y = Number.isFinite(originY) ? originY : position.y;
    const size = Math.max(42, Number(botSize ?? 60) * 1.25);
    kit.showEffect(view, "muzzle-flash", kit.frameAtProgress(frames, 1 - alpha), {
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

/** The activation ray of a sprite-ray ability (Pistol, Concussive Shot, Rail Shot, Sniper). */
export function drawActiveRay(ctx) {
    const { kit, view, shape, position, arenaSprites, abilityId, presentation } = ctx;
    const { phaseHitbox, phaseVisual, opacity, originX, originY, originRotation } = activeVisualFrame(ctx);
    const settings = presentation.activeRay;
    showRay(kit, view, "ability", arenaSprites, position, originX, originY, originRotation, abilityId,
        Number(phaseHitbox.range ?? 500), opacity, Number(phaseVisual.visualSize ?? settings.height), 0xffffff, settings.rayFrames);
    if (settings.muzzleFlash) showMuzzleFlash(kit, view, arenaSprites, position, originX, originY, originRotation, opacity, Number(shape.size ?? 60));
}

/** The activation ray of a drawn (no sprite) ray ability. */
export function drawActiveProceduralRay(ctx) {
    const { kit, view, shape, graphics, position, arenaSprites, presentation } = ctx;
    const { phaseHitbox, opacity, originX, originY, originRotation } = activeVisualFrame(ctx);
    const settings = presentation.ray;
    const rayWidth = Number(phaseHitbox.width ?? settings.fallbackWidth);
    drawProceduralRay(graphics, position, originX, originY, originRotation,
        Number(phaseHitbox.range ?? settings.fallbackRange), settings.color, opacity,
        Number.isFinite(rayWidth) && rayWidth > 0 ? rayWidth : settings.fallbackWidth);
    if (settings.muzzleFlash) showMuzzleFlash(kit, view, arenaSprites, position, originX, originY, originRotation, opacity, Number(shape.size ?? 60));
}

/** Heavy-slash style sweep, also used by Cleave. A `hitboxSizeScale` sizes the sprite from the real hitbox range so retuning the weapon resizes it. */
export function drawSlashSweep(ctx) {
    const { kit, view, arenaSprites, presentation } = ctx;
    const { phaseHitbox, phaseVisual, remaining, duration, opacity, originRotation } = activeVisualFrame(ctx);
    const halfArc = Number(phaseHitbox.arc ?? 0) / 2;
    const sweep = heavySlashRotation(originRotation, sweepAngle(remaining, duration, -halfArc, halfArc));
    const sizingRange = Number(abilityHitbox(presentation.sizingHitboxAbilityId).range ?? 92);
    showSlash(kit, view, arenaSprites.abilities.heavySlash, remaining, duration, sweep,
        presentation.hitboxSizeScale ? sizingRange * presentation.hitboxSizeScale : Number(phaseVisual.visualSize ?? sizingRange * 2.4),
        presentation.tint ?? 0xffffff, opacity);
}

/** Fading shield sprite used by the guard abilities; `selfGuardFlash` keeps it visible through replay activation. */
export function drawGuardFlash(ctx) {
    const { kit, view, arenaSprites, presentation } = ctx;
    const { phaseVisual, remaining, duration, angle } = activeVisualFrame(ctx);
    const progress = visualProgress(remaining, duration);
    const radius = Number(phaseVisual.visualSize ?? 80) / 2 + progress * 16;
    kit.showEffect(view, "ability", kit.frameAtProgress(arenaSprites.abilities.shield, progress), {
        rotation: angle + Math.PI, alpha: 1 - progress, tint: presentation.tint, width: radius * 2, height: radius * 2,
    });
}

/** Small seeded generator (Lehmer) so effect shapes are identical every run (renderers take no unseeded randomness). */
export function seededRandom(seed) {
    let state = Math.max(1, Math.floor(Number(seed) || 1)) % 2147483647 || 1;
    return () => {
        state = (state * 16807) % 2147483647;
        return (state - 1) / 2147483646;
    };
}

/** Polygon points of an ellipse whose `rx` axis points along `angle`, centred at (cx, cy). */
export function ellipsePoints(angle, cx, cy, rx, ry, steps = 24) {
    const points = [];
    for (let step = 0; step < steps; step += 1) {
        const theta = (step / steps) * Math.PI * 2;
        const [x, y] = rotatePoint(angle, Math.cos(theta) * rx, Math.sin(theta) * ry);
        points.push(cx + x, cy + y);
    }
    return points;
}

/** Axis-aligned-then-rotated square of side `size` centred at (cx, cy). */
export function squarePoints(angle, cx, cy, size) {
    const half = size / 2;
    return [[-half, -half], [half, -half], [half, half], [-half, half]].flatMap(([x, y]) => {
        const [rx, ry] = rotatePoint(angle, x, y);
        return [cx + rx, cy + ry];
    });
}

/**
 * Smash cracks in the hitbox frame (x forward, y sideways) relative to the impact point:
 * each crack is a polyline of `segments` steps, fanned around the point, from a fixed seed.
 */
export function smashCrackPaths({ seed, count, segments, lengthMin, lengthSpan }) {
    const random = seededRandom(seed);
    return Array.from({ length: count }, (_, index) => {
        let heading = index * 2 * Math.PI / count + random() * 0.5;
        const path = [[0, 0]];
        let x = 0;
        let y = 0;
        for (let segment = 0; segment < segments; segment += 1) {
            heading += (random() - 0.5) * 0.8;
            const length = lengthMin + random() * lengthSpan;
            x += Math.cos(heading) * length;
            y += Math.sin(heading) * length;
            path.push([x, y]);
        }
        return path;
    });
}

/** Smash debris in the hitbox frame: launch angle (mostly forward), reach, size and spin, from a fixed seed. */
export function smashDebrisPieces({ seed, count, spread, reachMin, reachSpan, sizeMin, sizeSpan }) {
    const random = seededRandom(seed);
    return Array.from({ length: count }, () => ({
        angle: (random() - 0.5) * spread,
        reach: reachMin + random() * reachSpan,
        size: sizeMin + random() * sizeSpan,
        spin: random() * 6,
    }));
}

/**
 * Dash segments `[x0, y0, x1, y1]` around the outline of a rectangle (x along 0..length, y across
 * -width/2..width/2), with the dash pattern running unbroken through the corners. Pixi has no dashed strokes.
 */
export function dashedRectSegments(length, width, dashUnits, gapUnits) {
    const half = width / 2;
    const corners = [[0, -half], [length, -half], [length, half], [0, half], [0, -half]];
    const period = dashUnits + gapUnits;
    if (!(dashUnits > 0) || !(period > 0)) return [];
    const segments = [];
    let phase = 0;
    for (let edge = 0; edge < 4; edge += 1) {
        const [ax, ay] = corners[edge];
        const [bx, by] = corners[edge + 1];
        const edgeLength = Math.hypot(bx - ax, by - ay);
        if (edgeLength <= 0) continue;
        const dx = (bx - ax) / edgeLength;
        const dy = (by - ay) / edgeLength;
        let position = 0;
        while (position < edgeLength - 1e-9) {
            const dashing = phase < dashUnits;
            const step = Math.min(edgeLength - position, dashing ? dashUnits - phase : period - phase);
            if (dashing) segments.push([ax + dx * position, ay + dy * position, ax + dx * (position + step), ay + dy * (position + step)]);
            position += step;
            phase = (phase + step) % period;
            if (period - phase < 1e-9) phase = 0;
        }
    }
    return segments;
}
