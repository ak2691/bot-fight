import { botAbilityActiveMs } from "../botAbilityPresentationDefinitions.js";
import { BOT_SIZE } from "../../../../../shared/engine/modelPayloads/arenaConstants.js";
import { thrustLengthFraction, weaponActiveProgress } from "../pixiVisualState.js";
import { abilityStats, activeVisualFrame, rotatePoint, windupProgress } from "./rendererHelpers.js";

/** Thrust: a shaft pulled back during the wind-up, then a spear that extends, holds and retracts along the hitbox length. */
export default Object.freeze({
    create: () => ({}),
    update(ctx) {
        const { graphics, shape, position, rotation, radius, presentation, abilityId } = ctx;
        if (ctx.pass === "body") {
            if (ctx.dead) return;
            const progress = windupProgress(ctx);
            if (progress == null) return;
            const windup = presentation.windup;
            const front = radius - windup.pullbackUnits * progress;
            const [x1, y1] = rotatePoint(rotation, front - windup.lengthUnits, 0);
            const [x2, y2] = rotatePoint(rotation, front, 0);
            graphics.moveTo(x1, y1).lineTo(x2, y2).stroke({ color: windup.color, alpha: 0.9, width: windup.width });
            return;
        }
        if (!ctx.active || botAbilityActiveMs(shape, presentation) <= 0) return;
        const effect = presentation.active;
        const { phaseHitbox, originX, originY, angle } = activeVisualFrame(ctx);
        const progress = weaponActiveProgress(botAbilityActiveMs(shape, presentation), abilityStats(abilityId).activeMs);
        const ox = originX - position.x;
        const oy = originY - position.y;
        const botRadius = Number(shape.size ?? BOT_SIZE) / 2;
        const fraction = thrustLengthFraction(progress, effect.extendFraction, effect.holdFraction);
        // The shaft emerges from the bot's front edge and never draws inside the body.
        const end = Math.max(botRadius, Number(phaseHitbox.length ?? 0) * fraction);
        const [sx, sy] = rotatePoint(angle, botRadius * 0.6, 0);
        const [bx, by] = rotatePoint(angle, end - effect.tipLength, 0);
        graphics.moveTo(ox + sx, oy + sy).lineTo(ox + bx, oy + by).stroke({ color: effect.color, alpha: 1, width: effect.width });
        const tip = [[end, 0], [end - effect.tipLength, -effect.tipHalfWidth], [end - effect.tipLength, effect.tipHalfWidth]]
            .flatMap(([forward, lateral]) => {
                const [x, y] = rotatePoint(angle, forward, lateral);
                return [ox + x, oy + y];
            });
        graphics.poly(tip).fill({ color: effect.color, alpha: 1 });
    },
    destroy() {},
});
