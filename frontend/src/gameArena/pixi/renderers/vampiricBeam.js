import { activeRenderer, drawActiveProceduralRay } from "./rendererHelpers.js";

/** Vampiric Beam: a drawn red ray with a muzzle flash. */
export default activeRenderer(drawActiveProceduralRay);
