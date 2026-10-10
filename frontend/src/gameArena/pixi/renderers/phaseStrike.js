import { visualProgress } from "../../../../../shared/engine/gameconfig/visualState.js";
import { activeVisualFrame } from "./rendererHelpers.js";

/** Phase Strike: a violet burst when it starts, then the strike sprite along the dash path. */
export default Object.freeze({
    create: () => ({}),
    sync(ctx) {
        const { startBurst } = ctx.presentation;
        if (ctx.suppressTransient || ctx.activeAbilityId !== ctx.abilityId || ctx.previousActiveAbilityId === ctx.abilityId) return;
        ctx.effects.spawnBurst(ctx.phaseShape.x, ctx.phaseShape.y, startBurst.color, startBurst.count);
    },
    update(ctx) {
        if (ctx.pass !== "world" || !ctx.active) return;
        const { kit, view, position, arenaSprites } = ctx;
        const { phaseHitbox, phaseVisual, remaining, duration, opacity, originX, originY, angle } = activeVisualFrame(ctx);
        const progress = visualProgress(remaining, duration);
        kit.showEffect(view, "ability", kit.frameAtProgress(arenaSprites.abilities.phaseStrike, progress), {
            x: originX - position.x,
            y: originY - position.y,
            rotation: angle,
            alpha: opacity,
            tint: 0xf0abfc,
            width: Number(phaseVisual.visualSize ?? phaseHitbox.length ?? 100),
            height: Number(phaseHitbox.width ?? 60),
            anchorX: 0,
            blendMode: "screen",
        });
    },
    destroy() {},
});
