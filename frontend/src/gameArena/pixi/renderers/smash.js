import { botAbilityActiveMs } from "../botAbilityPresentationDefinitions.js";
import { smashFlashAlpha, weaponActiveProgress, weaponWindupAlpha } from "../pixiVisualState.js";
import { abilityHitbox, abilityStats, activeVisualFrame, rectanglePoints, rotatePoint, windupProgress } from "./rendererHelpers.js";

/** Smash: the hitbox rectangle outlined during the wind-up, then a flash with an impact line and dust at the far edge. */
export default Object.freeze({
    create: () => ({}),
    update(ctx) {
        const { graphics, shape, position, rotation, presentation, abilityId } = ctx;
        if (ctx.pass === "body") {
            if (ctx.dead) return;
            const progress = windupProgress(ctx);
            if (progress == null) return;
            const windup = presentation.windup;
            const hitbox = abilityHitbox(abilityId);
            const alpha = weaponWindupAlpha(progress, windup.alphaStart, windup.alphaEnd);
            graphics.poly(rectanglePoints(rotation, 0, 0, Number(hitbox.length ?? 0), Number(hitbox.width ?? 0)))
                .stroke({ color: windup.color, alpha, width: windup.outlineWidth });
            return;
        }
        if (!ctx.active || botAbilityActiveMs(shape, presentation) <= 0) return;
        const effect = presentation.active;
        const { phaseHitbox, originX, originY, angle } = activeVisualFrame(ctx);
        const progress = weaponActiveProgress(botAbilityActiveMs(shape, presentation), abilityStats(abilityId).activeMs);
        const ox = originX - position.x;
        const oy = originY - position.y;
        const length = Number(phaseHitbox.length ?? 0);
        const width = Number(phaseHitbox.width ?? 0);
        graphics.poly(rectanglePoints(angle, ox, oy, length, width))
            .fill({ color: effect.color, alpha: smashFlashAlpha(progress, effect.fillAlpha) });
        const [ax, ay] = rotatePoint(angle, length, -width / 2 + 8);
        const [bx, by] = rotatePoint(angle, length, width / 2 - 8);
        graphics.moveTo(ox + ax, oy + ay).lineTo(ox + bx, oy + by)
            .stroke({ color: effect.impactColor, alpha: 1 - progress, width: effect.impactWidth });
        // Dust puffs drift outward from the far edge along fixed lanes, fading with progress.
        for (let puff = 0; puff < effect.dustPuffs; puff += 1) {
            const lane = puff - (effect.dustPuffs - 1) / 2;
            const [x, y] = rotatePoint(angle, length + 10 + progress * 30, lane * (width * 0.4 + progress * 25));
            graphics.circle(ox + x, oy + y, 8 + progress * 8).fill({ color: effect.dustColor, alpha: (1 - progress) * 0.8 });
        }
    },
    destroy() {},
});
