import { visualProgress } from "../../gameconfig/visualState.js";

/** Rewind: a pulse at the point the bot will return to, driven by the bot's rewind timer fields. */
export default Object.freeze({
    create: () => ({}),
    update(ctx) {
        if (ctx.pass !== "world") return;
        const { kit, view, shape, position, arenaSprites } = ctx;
        const pulse = ctx.presentation.pulse;
        const activeMs = Number(shape[pulse.timerField] ?? 0);
        if (activeMs <= 0) return;
        const progress = visualProgress(activeMs, pulse.durationMs);
        const x = Number(shape[pulse.xField] ?? shape[pulse.fallbackXField] ?? position.x);
        const y = Number(shape[pulse.yField] ?? shape[pulse.fallbackYField] ?? position.y);
        kit.showEffect(view, pulse.slot, kit.frameAtProgress(arenaSprites.abilities[pulse.asset], progress), {
            x: x - position.x,
            y: y - position.y,
            alpha: 1 - progress,
            tint: pulse.tint,
            width: pulse.width,
            height: pulse.height,
        });
    },
    destroy() {},
});
