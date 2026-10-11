import { botAbilityActiveMs } from "../botAbilityPresentationDefinitions.js";
import { lingerFade, smashCrackGrowth, weaponActiveProgress, weaponWindupAlpha } from "../pixiVisualState.js";
import {
    abilityHitbox, abilityStats, activeVisualFrame, clamp, dashedRectSegments, ellipsePoints, rectanglePoints, rotatePoint,
    smashCrackPaths, smashDebrisPieces, squarePoints, windupProgress,
} from "./rendererHelpers.js";

const easeOut = (value) => 1 - (1 - clamp(value, 0, 1)) ** 3;

/** Frame of the hitbox the slam landed in, kept (in world coordinates) so cracks and dust can linger after the active stage. */
function activeFrame(ctx) {
    const { phaseHitbox, originX, originY, angle } = activeVisualFrame(ctx);
    return { originX, originY, angle, length: Number(phaseHitbox.length ?? 0), width: Number(phaseHitbox.width ?? 0) };
}

/** Maps a point in the hitbox frame (x along the swing, y sideways) to bot-local coordinates. */
function framePoint(frame, position, forward, lateral) {
    const [x, y] = rotatePoint(frame.angle, forward, lateral);
    return [frame.originX - position.x + x, frame.originY - position.y + y];
}

function drawCracks(graphics, ctx, frame, growth, alpha) {
    const { cracks } = ctx.presentation.active;
    const impact = frame.length * ctx.presentation.impactFraction;
    const strokeAll = (offset, color, strokeAlpha, width) => {
        for (const path of ctx.state.cracks) {
            const steps = Math.ceil(growth * (path.length - 1));
            if (steps <= 0) continue;
            graphics.moveTo(...framePoint(frame, ctx.position, impact, 0));
            for (let step = 1; step <= steps; step += 1) {
                graphics.lineTo(...framePoint(frame, ctx.position, impact + path[step][0] + offset, path[step][1] + offset));
            }
            graphics.stroke({ color, alpha: strokeAlpha, width });
        }
    };
    strokeAll(0, cracks.color, alpha, cracks.width);
    strokeAll(cracks.highlightOffset, cracks.highlightColor, alpha * cracks.highlightAlphaScale, cracks.highlightWidth);
}

function drawWindup(ctx, graphics) {
    const progress = windupProgress(ctx);
    if (progress == null) return;
    const { fill, outline, shadow } = ctx.presentation.windup;
    const hitbox = abilityHitbox(ctx.abilityId);
    const length = Number(hitbox.length ?? 0);
    const width = Number(hitbox.width ?? 0);
    const angle = ctx.rotation;
    graphics.poly(rectanglePoints(angle, 0, 0, length, width))
        .fill({ color: fill.color, alpha: weaponWindupAlpha(progress, fill.alphaStart, fill.alphaEnd) });
    for (const [x0, y0, x1, y1] of dashedRectSegments(length, width, outline.dashUnits, outline.gapUnits)) {
        const [ax, ay] = rotatePoint(angle, x0, y0);
        const [bx, by] = rotatePoint(angle, x1, y1);
        graphics.moveTo(ax, ay).lineTo(bx, by);
    }
    graphics.stroke({ color: outline.color, alpha: weaponWindupAlpha(progress, outline.alphaStart, outline.alphaEnd), width: outline.width });
    const [sx, sy] = rotatePoint(angle, length * ctx.presentation.impactFraction, 0);
    const along = shadow.radiusAlongStart + (shadow.radiusAlongEnd - shadow.radiusAlongStart) * progress;
    const across = shadow.radiusAcrossStart + (shadow.radiusAcrossEnd - shadow.radiusAcrossStart) * progress;
    graphics.poly(ellipsePoints(angle, sx, sy, along, across))
        .fill({ color: shadow.color, alpha: weaponWindupAlpha(progress, shadow.alphaStart, shadow.alphaEnd) });
}

function drawActiveOver(ctx, frame, progress) {
    const { graphics, position, presentation, state } = ctx;
    const { flash, burst, ring, debris, chevrons } = presentation.active;
    const u = progress;
    const impact = frame.length * presentation.impactFraction;
    const [ix, iy] = framePoint(frame, position, impact, 0);
    const [ox, oy] = framePoint(frame, position, 0, 0);
    graphics.poly(rectanglePoints(frame.angle, ox, oy, frame.length, frame.width))
        .fill({ color: flash.color, alpha: flash.alpha * (1 - u) ** flash.falloff });
    graphics.circle(ix, iy, burst.radiusStart + burst.radiusGrow * easeOut(u * 2))
        .fill({ color: burst.color, alpha: burst.alpha * (1 - u) ** burst.falloff });
    const ringRadius = ring.radiusStart + ring.radiusGrow * u;
    graphics.poly(ellipsePoints(frame.angle, ix, iy, ringRadius * ring.alongScale, ringRadius, 32))
        .stroke({ color: ring.color, alpha: 1 - u, width: ring.widthMin + (ring.widthMax - ring.widthMin) * (1 - u) });
    state.debris.forEach((piece) => {
        const distance = piece.reach * easeOut(u);
        const [cx, cy] = framePoint(frame, position, impact + Math.cos(piece.angle) * distance, Math.sin(piece.angle) * distance);
        graphics.poly(squarePoints(frame.angle + piece.spin + u * debris.spin, cx, cy, piece.size))
            .fill({ color: debris.color, alpha: 1 - u });
    });
    // Amber chevrons slide past the far edge of the hitbox.
    for (let index = 0; index < chevrons.count; index += 1) {
        const x = frame.length + chevrons.offset + index * chevrons.spacing + u * chevrons.travel;
        graphics.moveTo(...framePoint(frame, position, x, -chevrons.halfHeight))
            .lineTo(...framePoint(frame, position, x + chevrons.depth, 0))
            .lineTo(...framePoint(frame, position, x, chevrons.halfHeight))
            .stroke({ color: chevrons.color, alpha: (1 - u) * (1 - index * chevrons.fadePerChevron), width: chevrons.width });
    }
}

function drawLingerDust(ctx, frame, elapsedMs) {
    const { graphics, position, presentation } = ctx;
    const { linger } = presentation;
    const { dust } = linger;
    const alpha = dust.alpha * lingerFade(elapsedMs, linger.ms);
    const impact = frame.length * presentation.impactFraction;
    for (let index = 0; index < dust.count; index += 1) {
        const [x, y] = framePoint(frame, position,
            impact + (index - (dust.count - 1) / 2) * dust.spacing,
            (index % 2 ? 1 : -1) * dust.offsetAcross - elapsedMs * dust.riseUnitsPerMs);
        graphics.circle(x, y, dust.radiusStart + elapsedMs * dust.radiusGrowPerMs).fill({ color: dust.color, alpha });
    }
}

/**
 * Smash: a faint dashed telegraph with a shadow at the impact point, then a flash, shockwave, debris and
 * chevrons over cracks that stay on the ground for `linger.ms` of presentation-clock time (like Dash smoke).
 */
export default Object.freeze({
    create: ({ presentation }) => ({
        cracks: smashCrackPaths(presentation.active.cracks),
        debris: smashDebrisPieces(presentation.active.debris),
        frame: null,
        endedAt: null,
        skipLinger: false,
    }),
    sync(ctx) {
        const { state, shape, presentation } = ctx;
        if (ctx.suppressTransient) {
            // A reset or replay seek must not leave cracks from a slam the viewer never saw.
            state.frame = null;
            state.endedAt = null;
            state.skipLinger = botAbilityActiveMs(shape, presentation) > 0;
        } else if (botAbilityActiveMs(shape, presentation) <= 0) {
            state.skipLinger = false;
        }
    },
    update(ctx) {
        const { graphics, underGraphics = graphics, shape, now, presentation, abilityId, state } = ctx;
        const activeMs = botAbilityActiveMs(shape, presentation);
        const active = ctx.active && activeMs > 0;
        if (ctx.pass === "body") {
            if (active) {
                if (!state.skipLinger) state.frame = activeFrame(ctx);
                state.endedAt = null;
            } else if (state.frame && state.endedAt == null) {
                state.endedAt = now;
            }
            if (state.endedAt != null && now - state.endedAt >= presentation.linger.ms) {
                state.frame = null;
                state.endedAt = null;
            }
            if (!active && !ctx.dead) drawWindup(ctx, underGraphics);
            if (active) {
                const progress = weaponActiveProgress(activeMs, abilityStats(abilityId).activeMs);
                drawCracks(underGraphics, ctx, activeFrame(ctx), smashCrackGrowth(progress, presentation.active.cracks.growFraction), presentation.active.cracks.alpha);
            } else if (state.frame) {
                const elapsed = now - state.endedAt;
                drawCracks(underGraphics, ctx, state.frame, 1, presentation.linger.crackAlpha * lingerFade(elapsed, presentation.linger.ms));
            }
            return;
        }
        if (active) {
            drawActiveOver(ctx, activeFrame(ctx), weaponActiveProgress(activeMs, abilityStats(abilityId).activeMs));
        } else if (state.frame && state.endedAt != null) {
            drawLingerDust(ctx, state.frame, now - state.endedAt);
        }
    },
    destroy() {},
});
