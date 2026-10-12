import { visualProgress } from "../../../../../shared/engine/gameconfig/visualState.js";

/** Rewind: a pulse where the bot snapped back to, driven by the bot's rewindPulseMs (set by the snap-back). */
export default Object.freeze({
    create: () => ({}),
    update(ctx) {
        if (ctx.pass !== "world") return;
        const { kit, view, shape, arenaSprites } = ctx;
        const pulse = ctx.presentation.pulse;
        const activeMs = Number(shape[pulse.timerField] ?? 0);
        if (activeMs <= 0) return;
        const progress = visualProgress(activeMs, pulse.durationMs);
        // The pulse sits on the bot: the snap-back has just put it at the point it returned to.
        kit.showEffect(view, pulse.slot, kit.frameAtProgress(arenaSprites.abilities[pulse.asset], progress), {
            x: 0,
            y: 0,
            alpha: 1 - progress,
            tint: pulse.tint,
            width: pulse.width,
            height: pulse.height,
        });
    },
    destroy() {},
});
