import { statusIsActive, statusRemainingMs } from "../../../../../shared/engine/ecs/contracts/StatusContracts.js";
import { arcPath, clamp } from "./rendererHelpers.js";

/** Overdrive's aura: a ring of spinning segments round the bot, with a bright arc that shrinks as the status runs out. */
function drawAura(graphics, { progress, elapsedMs }, s) {
    const turn = (elapsedMs / 1000) * s.ringTurnsPerSecond * Math.PI * 2;
    const span = (Math.PI * 2) / s.segments;
    for (let i = 0; i < s.segments; i += 1) {
        const start = turn + i * span;
        arcPath(graphics, 0, 0, s.ringRadius, start, start + span * 0.55).stroke({ color: s.color, alpha: 0.75, width: 3, cap: "round" });
    }
    arcPath(graphics, 0, 0, s.ringRadius + 7, -Math.PI / 2, -Math.PI / 2 + (1 - progress) * Math.PI * 2)
        .stroke({ color: s.bright, alpha: 0.55, width: 1.5 });
}

/** Overdrive: drawn from the `overdrive` status, under the status icons (body pass). It has no activation visual. */
export default Object.freeze({
    create: () => ({}),
    update(ctx) {
        if (ctx.pass !== "body" || ctx.dead) return;
        const { shape, graphics, presentation: s } = ctx;
        if (!statusIsActive(shape, "overdrive")) return;
        const progress = clamp(1 - statusRemainingMs(shape, "overdrive") / s.durationMs, 0, 1);
        drawAura(graphics, { progress, elapsedMs: s.durationMs * progress }, s);
    },
    destroy() {},
});
