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
