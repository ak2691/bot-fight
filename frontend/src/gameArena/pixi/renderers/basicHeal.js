import { abilityVisual } from "./rendererHelpers.js";

/** Basic Heal: rising "+" particles when the heal starts (the particles live in the scene). */
export default Object.freeze({
    create: () => ({}),
    sync(ctx) {
        if (ctx.suppressTransient || ctx.activeAbilityId !== ctx.abilityId || ctx.previousActiveAbilityId === ctx.abilityId) return;
        ctx.effects.spawnRepairPulse(ctx.current.x, ctx.current.y, abilityVisual(ctx.abilityId).visualSize ?? 12);
    },
    update() {},
    destroy() {},
});
