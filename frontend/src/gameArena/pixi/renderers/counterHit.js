import { statusEffectsFor } from "../../../../../shared/engine/ecs/contracts/StatusContracts.js";
import { rotatePoint, seededRandom } from "./rendererHelpers.js";

/** The counter-hit's flash: a jagged ring round the target that flickers as it spreads, with sparks and a bright core. */
function drawCounterHit(g, { progress, elapsedMs }, s) {
    const fade = 1 - progress;
    const random = seededRandom(30 + Math.floor(elapsedMs / s.flickerMs));
    const points = [];
    const r = s.radius * (0.8 + 0.5 * progress);
    for (let i = 0; i < s.points; i += 1) {
        const a = (Math.PI * 2 * i) / s.points;
        const d = r + (i % 2 ? s.jitter : -s.jitter * 0.4) * random();
        points.push(Math.cos(a) * d, Math.sin(a) * d);
    }
    g.poly(points).stroke({ color: s.color, alpha: fade, width: 2.5, join: "round" });
    for (let i = 0; i < s.sparks; i += 1) {
        const a = (Math.PI * 2 * i) / s.sparks + 0.3;
        const [x0, y0] = rotatePoint(a, r + 4, 0);
        const [x1, y1] = rotatePoint(a, r + 4 + 20 * fade, 0);
        g.moveTo(x0, y0).lineTo(x1, y1).stroke({ color: s.core, alpha: fade, width: 2, cap: "round" });
    }
    g.circle(0, 0, 10 * fade).fill({ color: s.core, alpha: fade * 0.8 });
}

/**
 * Disruptive Beam's counter-hit, on the target. The only stun the beam applies is the one it lands on a bot winding up,
 * so a stun from ability 30 is the counter-hit. The flash runs for the first `windowMs` of that stun.
 */
export default Object.freeze({
    create: () => ({}),
    update(ctx) {
        if (ctx.pass !== "world" || ctx.dead) return;
        const { shape, graphics, presentation: s } = ctx;
        const stun = statusEffectsFor(shape).find((status) => status.type === "stun" && Number(status.abilityId) === s.sourceAbilityId);
        if (!stun) return;
        const elapsed = s.stunMs - stun.remainingMs;
        if (elapsed < 0 || elapsed >= s.windowMs) return;
        drawCounterHit(graphics, { progress: elapsed / s.windowMs, elapsedMs: elapsed }, s);
    },
    destroy() {},
});
