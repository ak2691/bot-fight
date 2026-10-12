import { statusIsActive, statusRemainingMs } from "../../../../../shared/engine/ecs/contracts/StatusContracts.js";
import { compassDegreesToRadians } from "../../../../../shared/engine/botlogic/planner/arenaAngles.js";
import { AUTO_STEP_MS } from "../../../../../shared/engine/modelPayloads/arenaConstants.js";
import { arcPath, clamp, radians, rotatePoint } from "./rendererHelpers.js";

/** The stance: an arc in front of the bot that flickers, with the time left as a bright inner arc. */
function drawStance(g, { angle, progress, elapsedMs }, s) {
    const half = radians(s.arc) / 2;
    const flicker = 0.75 + 0.25 * Math.sin((elapsedMs / s.flickerPeriodMs) * Math.PI * 2);
    arcPath(g, 0, 0, s.radius, angle - half, angle + half).stroke({ color: s.edge, alpha: 0.25 * flicker, width: s.width * 2.4 });
    arcPath(g, 0, 0, s.radius, angle - half, angle + half).stroke({ color: s.color, alpha: flicker, width: s.width, cap: "round" });
    const left = (1 - progress) * half;
    arcPath(g, 0, 0, s.radius - 9, angle - left, angle + left).stroke({ color: s.edge, alpha: 0.85, width: 2, cap: "round" });
    for (const side of [-1, 1]) {
        const [x0, y0] = rotatePoint(angle + side * half, s.radius - 7, 0);
        const [x1, y1] = rotatePoint(angle + side * half, s.radius + 7, 0);
        g.moveTo(x0, y0).lineTo(x1, y1).stroke({ color: s.color, alpha: flicker, width: 2.5, cap: "round" });
    }
}

/** The burst where the stance blocked an attack, anchored at the front of the shield. */
function drawBurst(g, { angle, progress }, s) {
    const [ox, oy] = rotatePoint(angle, s.radius, 0);
    const fade = 1 - progress;
    g.circle(ox, oy, 10 + 40 * progress).stroke({ color: s.color, alpha: fade, width: 3 * fade + 1 });
    for (let i = 0; i < s.burstSpikes; i += 1) {
        const a = angle + (Math.PI * 2 * i) / s.burstSpikes;
        const [x0, y0] = rotatePoint(a, 6 + 16 * progress, 0);
        const [x1, y1] = rotatePoint(a, 6 + 16 * progress + s.burstLength * (i % 2 ? 0.6 : 1) * fade, 0);
        g.moveTo(ox + x0, oy + y0).lineTo(ox + x1, oy + y1).stroke({ color: i % 2 ? s.edge : s.color, alpha: fade, width: 2.5, cap: "round" });
    }
    g.circle(ox, oy, 9 * fade).fill({ color: 0xffffff, alpha: fade });
}

/**
 * Parry: the stance from the `parry` status, and a burst where an attack was blocked. A block spends the only charge
 * and ends the status early, so a status that ends with more than one tick left was used up by an attack.
 */
export default Object.freeze({
    create: () => ({}),
    sync(ctx) {
        const { shape, state, now } = ctx;
        const remaining = statusIsActive(shape, "parry") ? statusRemainingMs(shape, "parry") : 0;
        if (state.remainingMs > AUTO_STEP_MS && remaining === 0) state.blockedAt = now;
        state.remainingMs = remaining;
    },
    update(ctx) {
        if (ctx.pass !== "world" || ctx.dead) return;
        const { shape, graphics, presentation: s, state, now } = ctx;
        const angle = compassDegreesToRadians(shape.rotation ?? 0);
        if (statusIsActive(shape, "parry")) {
            const elapsed = clamp(s.durationMs - statusRemainingMs(shape, "parry"), 0, s.durationMs);
            drawStance(graphics, { angle, progress: elapsed / s.durationMs, elapsedMs: elapsed }, s);
        }
        if (state.blockedAt != null && now - state.blockedAt < s.burstMs) {
            drawBurst(graphics, { angle, progress: (now - state.blockedAt) / s.burstMs }, s);
        }
    },
    destroy() {},
});
