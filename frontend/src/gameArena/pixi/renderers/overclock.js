import { BOT_SIZE } from "../../modelPayloads/arenaConstants.js";
import { activeRenderer, activeVisualFrame } from "./rendererHelpers.js";

/** Overclock: two pulsing rings around the bot. */
export default activeRenderer((ctx) => {
    const { graphics, shape, now, presentation } = ctx;
    const { phaseVisual } = activeVisualFrame(ctx);
    const radius = Number(phaseVisual.visualSize ?? shape.size ?? BOT_SIZE) / 2;
    const pulse = 0.55 + Math.sin(now / presentation.periodMs) * presentation.pulse;
    graphics.circle(0, 0, radius + 12).stroke({ color: 0xfbbf24, alpha: pulse, width: 3 });
    graphics.circle(0, 0, radius + 20).stroke({ color: 0xfef3c7, alpha: pulse * 0.45, width: 2 });
});
