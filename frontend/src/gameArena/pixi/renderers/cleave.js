import { weaponWindupAlpha } from "../pixiVisualState.js";
import { abilityHitbox, drawSlashSweep, sectorPoints, windupProgress } from "./rendererHelpers.js";

/** Cleave: a growing arc telegraph during the wind-up, then the heavy-slash sweep sized from the hitbox range. */
export default Object.freeze({
    create: () => ({}),
    update(ctx) {
        const { graphics, rotation, presentation, abilityId } = ctx;
        if (ctx.pass === "body") {
            if (ctx.dead) return;
            const progress = windupProgress(ctx);
            if (progress == null) return;
            const windup = presentation.windup;
            const hitbox = abilityHitbox(abilityId);
            const alpha = weaponWindupAlpha(progress, windup.alphaStart, windup.alphaEnd);
            const range = Number(hitbox.range ?? 0);
            const arc = Number(hitbox.arc ?? 0);
            graphics.poly(sectorPoints(rotation, 0, 0, range * progress, arc)).fill({ color: windup.color, alpha: alpha * 0.6 });
            graphics.poly(sectorPoints(rotation, 0, 0, range, arc)).stroke({ color: windup.color, alpha, width: windup.outlineWidth });
            return;
        }
        if (ctx.active) drawSlashSweep(ctx);
    },
    destroy() {},
});
