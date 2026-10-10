import { botAbilityActiveMs } from "../botAbilityPresentationDefinitions.js";
import { abilityActiveOpacity } from "../../../../../shared/engine/gameconfig/visualState.js";
import { sniperSightAlpha, sniperSightLength } from "../pixiVisualState.js";
import { abilityHitbox, abilityVisual, drawActiveRay, rotatePoint, showMuzzleFlash, showRay, windupProgress } from "./rendererHelpers.js";

/** Sniper: a sight line during the wind-up, the fired ray from the ray origin, and the activation ray. */
export default Object.freeze({
    create: () => ({}),
    update(ctx) {
        const { kit, view, shape, graphics, position, arenaSprites, abilityId, presentation } = ctx;
        if (ctx.pass === "body") {
            if (ctx.dead) return;
            const progress = windupProgress(ctx);
            if (progress == null) return;
            const sight = presentation.sight;
            // The aim follows the bot's current facing every frame, since the bot may keep turning during the wind-up.
            const targets = ctx.otherBots
                .filter(({ view: other }) => other.shape !== shape && Number(other.shape.hp ?? 1) > 0)
                .map(({ position: otherPosition, view: other }) => ({ x: otherPosition.x, y: otherPosition.y, size: other.shape.size }));
            const hitbox = abilityHitbox(abilityId);
            const length = sniperSightLength(position, shape.rotation, Number(hitbox.range ?? 0), Number(hitbox.width ?? 0), targets);
            const [ex, ey] = rotatePoint(ctx.rotation, length, 0);
            graphics.moveTo(0, 0).lineTo(ex, ey).stroke({
                color: sight.color, alpha: sniperSightAlpha(progress, sight.alphaMin, sight.alphaMax, sight.pulses), width: sight.width,
            });
            return;
        }
        if (botAbilityActiveMs(shape, presentation) > 0) {
            const direct = presentation.directRay;
            const alpha = abilityActiveOpacity(shape, abilityId);
            const originX = Number(shape.gunRayOriginX ?? shape.x);
            const originY = Number(shape.gunRayOriginY ?? shape.y);
            const originRotation = Number(shape.gunRayRotation ?? shape.rotation);
            showRay(kit, view, "gun", arenaSprites, position, originX, originY, originRotation, abilityId,
                Number(abilityHitbox(abilityId).range ?? direct.fallbackRange), alpha,
                Number(abilityVisual(abilityId).visualSize ?? direct.fallbackHeight), 0xffffff, direct.rayFrames);
            showMuzzleFlash(kit, view, arenaSprites, position, originX, originY, originRotation, alpha, Number(shape.size ?? 60));
        }
        if (ctx.active) drawActiveRay(ctx);
    },
    destroy() {},
});
