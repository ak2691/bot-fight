import { activeRenderer, drawSlashSweep } from "./rendererHelpers.js";

/** Heavy Slash: the red slash sprite sweeping across the hitbox arc. */
export default activeRenderer(drawSlashSweep);
