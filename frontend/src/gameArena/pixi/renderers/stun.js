import { botAbilityActiveMs } from "../botAbilityPresentationDefinitions.js";
import { visualProgress } from "../../../../../shared/engine/gameconfig/visualState.js";
import { BOT_SIZE } from "../../../../../shared/engine/modelPayloads/arenaConstants.js";
import { compassDegreesToRadians } from "../../../../../shared/engine/botlogic/planner/arenaAngles.js";
import { abilityStats, abilityVisual, clamp } from "./rendererHelpers.js";

/** Stun: the shock sprite projected from the bot's forward edge while the ability is active. */
export default Object.freeze({
    create: () => ({}),
    update(ctx) {
        if (ctx.pass !== "world") return;
        const { kit, view, shape, arenaSprites, abilityId, presentation } = ctx;
        const activeMs = botAbilityActiveMs(shape, presentation);
        if (activeMs <= 0) return;
        const rotation = compassDegreesToRadians(shape.rotation);
        const activeDurationMs = Math.max(1, Number(abilityStats(abilityId).activeMs ?? 100));
        const progress = visualProgress(activeMs, activeDurationMs);
        const botRadius = Number(shape.size ?? BOT_SIZE) / 2;
        const stunVisualSize = Number(abilityVisual(abilityId).visualSize ?? shape.size ?? 60);
        kit.showEffect(view, "stun", kit.frameAtProgress(arenaSprites.abilities.stun, progress), {
            // The supplied frame is vertically elongated; keep that long axis
            // aligned with the bot's facing direction and project it from
            // the forward edge instead of centering it over the bot.
            x: Math.cos(rotation) * botRadius,
            y: Math.sin(rotation) * botRadius,
            rotation: rotation - Math.PI / 2,
            alpha: clamp(activeMs / activeDurationMs, 0, 1),
            width: stunVisualSize * 1.8,
            height: stunVisualSize * 3.6,
            anchorY: 0,
            blendMode: "screen",
        });
    },
    destroy() {},
});
