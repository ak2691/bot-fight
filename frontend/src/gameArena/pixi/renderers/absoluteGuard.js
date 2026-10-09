import { activeRenderer, drawGuardFlash } from "./rendererHelpers.js";

/** Absolute Guard: a fading white shield flash around the bot. */
export default activeRenderer(drawGuardFlash);
