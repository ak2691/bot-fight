import { visualProgress } from "../../gameconfig/visualState.js";
import { activeRenderer, activeVisualFrame } from "./rendererHelpers.js";

/** Frost Ring: the expanding ring sprite centred on the activation origin. */
export default activeRenderer((ctx) => {
    const { kit, view, position, arenaSprites } = ctx;
    const frames = arenaSprites.abilities.frostRing;
    if (!frames?.length) return;
    const { phaseHitbox, phaseVisual, remaining, duration, opacity, originX, originY } = activeVisualFrame(ctx);
    const size = Number(phaseVisual.visualSize ?? Number(phaseHitbox.radius ?? 120) * 2);
    kit.showEffect(view, "frost-ring", kit.frameAtProgress(frames, visualProgress(remaining, duration)), {
        x: originX - position.x,
        y: originY - position.y,
        alpha: opacity,
        tint: 0xffffff,
        width: size,
        height: size,
        blendMode: "screen",
    });
});
