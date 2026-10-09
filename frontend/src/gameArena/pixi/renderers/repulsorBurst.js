import { activeBotVisual } from "../pixiVisualState.js";
import {
    combatVisualRemainingMs,
    REPULSOR_BURST_VISUAL_MS,
    repulsorBurstDiameter,
    repulsorBurstFrameIndex,
    repulsorBurstProgress,
} from "../../gameconfig/visualState.js";
import { activeVisualFrame, clamp } from "./rendererHelpers.js";

function burstStartTime(shape, abilityId, now) {
    if (activeBotVisual(shape) !== abilityId) return null;
    const elapsed = REPULSOR_BURST_VISUAL_MS - combatVisualRemainingMs(shape, abilityId);
    return now - clamp(elapsed, 0, REPULSOR_BURST_VISUAL_MS);
}

/**
 * Repulsor: the burst frames. A cosmetic renderer clock fills the 100 ms snapshot
 * gaps; it never feeds collision, damage, knockback, cooldown, or authority.
 */
export default Object.freeze({
    create: ({ shape, now, abilityId }) => ({ startedAt: burstStartTime(shape, abilityId, now) }),
    sync(ctx) {
        const { state, abilityId } = ctx;
        if (ctx.activeAbilityId !== abilityId) {
            state.startedAt = null;
        } else if (ctx.previousActiveAbilityId !== abilityId || state.startedAt == null) {
            state.startedAt = burstStartTime(ctx.shape, abilityId, ctx.now);
        }
    },
    update(ctx) {
        if (ctx.pass !== "world" || !ctx.active) return;
        const { kit, view, state, position, now, arenaSprites } = ctx;
        const frames = arenaSprites.abilities.repulsorBlast;
        if (!frames?.length) return;
        const { phaseHitbox, phaseVisual, remaining, duration, originX, originY } = activeVisualFrame(ctx);
        const elapsed = state.startedAt == null ? duration - remaining : now - state.startedAt;
        const progress = repulsorBurstProgress(elapsed, duration);
        const frameIndex = repulsorBurstFrameIndex(progress, frames.length);
        const diameter = repulsorBurstDiameter(progress, Number(phaseVisual.visualSize ?? Number(phaseHitbox.radius ?? 110) * 2), frames.length);
        kit.showEffect(view, "ability", frames[frameIndex], {
            x: originX - position.x,
            y: originY - position.y,
            alpha: 1,
            tint: 0xffffff,
            width: diameter,
            height: diameter,
        });
    },
    destroy() {},
});
