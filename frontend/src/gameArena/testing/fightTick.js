import { createFight } from "../../../../shared/engine/fight.js";

/**
 * Test helper: one tick of a fresh fight over `shapes`, returned as the render frame. The input shapes are not
 * touched. The engine itself never works this way (a fight keeps its own state across ticks); tests that only
 * need "state in, state out" use this instead of holding a fight.
 */
export function advanceShapes(shapes, options) {
    const fight = createFight(shapes, options);
    fight.step();
    return fight.frame();
}
