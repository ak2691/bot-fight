import { botAbilityActiveMs } from "../botAbilityPresentationDefinitions.js";
import { abilityHitbox, abilityStats, abilityVisual, radians } from "./rendererHelpers.js";
import { sweepAngle, visualProgress } from "../../gameconfig/visualState.js";

/** Slash: the body swing sprite, drawn while the ability's active stage runs. */
export default Object.freeze({
    create: () => ({}),
    update(ctx) {
        if (ctx.pass !== "body") return;
        const { kit, view, shape, arenaSprites, radius, rotation, presentation, abilityId } = ctx;
        const swingActiveMs = botAbilityActiveMs(shape, presentation);
        if (swingActiveMs <= 0) return;
        const hitbox = abilityHitbox(abilityId);
        const visual = abilityVisual(abilityId);
        const activeMs = Number(abilityStats(abilityId).activeMs ?? presentation.activeMsFallback);
        const halfArc = Number(hitbox.arc ?? 0) / 2;
        const angle = rotation + radians(sweepAngle(swingActiveMs, activeMs, -halfArc, halfArc));
        const progress = visualProgress(swingActiveMs, activeMs);
        const forwardOffset = radius / 2;
        const size = Number(visual.visualSize ?? Number(hitbox.range ?? 92) * 2.25);
        kit.showEffect(view, "swing", kit.frameAtProgress(arenaSprites.abilities.meleeSlash, progress), {
            x: Math.cos(rotation) * forwardOffset,
            y: Math.sin(rotation) * forwardOffset,
            rotation: angle,
            width: size,
            height: size,
        });
    },
    destroy() {},
});
