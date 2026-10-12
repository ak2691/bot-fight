import { statusEffectsFor, statusIsActive, statusRemainingMs } from "../../../../../shared/engine/ecs/contracts/StatusContracts.js";
import { compassDegreesToRadians } from "../../../../../shared/engine/botlogic/planner/arenaAngles.js";
import { AUTO_STEP_MS } from "../../../../../shared/engine/modelPayloads/arenaConstants.js";
import { rotatePoint, seededRandom } from "./rendererHelpers.js";

const overchargeStatus = (shape) => statusEffectsFor(shape).find((status) => status.type === "overcharge") ?? null;

/** Overcharge's aura: the charges left as diamonds on an orbit, a crackle on the weapon, and a pip that flies off on a spend. */
function drawAura(g, { angle, elapsedMs, charges, pop }, s) {
    const turn = (elapsedMs / 1000) * s.orbitTurnsPerSecond * Math.PI * 2;
    const diamond = (cx, cy, size, a) => {
        const pts = [];
        for (let i = 0; i < 4; i += 1) {
            const [x, y] = rotatePoint(a + (Math.PI / 2) * i, i % 2 ? size * 0.6 : size, 0);
            pts.push(cx + x, cy + y);
        }
        return pts;
    };
    for (let i = 0; i < charges; i += 1) {
        const a = turn + (Math.PI * 2 * i) / 4;
        const [x, y] = rotatePoint(a, s.orbitRadius, 0);
        g.circle(x, y, s.pipSize * 1.6).fill({ color: s.glow, alpha: 0.18 });
        g.poly(diamond(x, y, s.pipSize, a)).fill({ color: s.color, alpha: 1 });
    }
    if (pop != null) {
        const a = turn + (Math.PI * 2 * charges) / 4;
        const [x, y] = rotatePoint(a, s.orbitRadius + 40 * pop, 0);
        g.poly(diamond(x, y, s.pipSize * (1 + pop), a)).stroke({ color: s.glow, alpha: 1 - pop, width: 2 });
    }
    if (charges === 0) return;
    const random = seededRandom(1 + Math.floor(elapsedMs / s.crackleEveryMs));
    for (let strand = 0; strand < 2; strand += 1) {
        const [startX, startY] = rotatePoint(angle, s.crackleFrom, (random() - 0.5) * s.crackleJitter);
        g.moveTo(startX, startY);
        for (let i = 1; i <= s.crackleSegments; i += 1) {
            const forward = s.crackleFrom + ((s.crackleTo - s.crackleFrom) * i) / s.crackleSegments;
            const [x, y] = rotatePoint(angle, forward, (random() - 0.5) * s.crackleJitter * 2);
            g.lineTo(x, y);
        }
        g.stroke({ color: strand ? s.arc : s.color, alpha: 0.85, width: strand ? 1 : 2, join: "round" });
    }
}

/**
 * Overcharge: drawn from the `overcharge` status, in the body pass. A spend shows as a pip flying off: the charges fall
 * between snapshots, or the last spend ends the status while it still had time left.
 */
export default Object.freeze({
    create: () => ({}),
    sync(ctx) {
        const { shape, state, now } = ctx;
        const status = overchargeStatus(shape);
        const charges = status ? Number(status.charges ?? 0) : null;
        const remaining = status ? status.remainingMs : 0;
        const spent = state.charges != null && (charges == null
            ? state.remainingMs > AUTO_STEP_MS
            : charges < state.charges);
        if (spent) state.popAt = now;
        state.charges = charges;
        state.remainingMs = remaining;
    },
    update(ctx) {
        if (ctx.pass !== "body" || ctx.dead) return;
        const { shape, graphics, presentation: s, state, now } = ctx;
        if (!statusIsActive(shape, "overcharge")) return;
        const remaining = statusRemainingMs(shape, "overcharge");
        const pop = state.popAt != null && now - state.popAt < s.popMs ? (now - state.popAt) / s.popMs : null;
        drawAura(graphics, {
            angle: compassDegreesToRadians(shape.rotation ?? 0),
            elapsedMs: Math.max(0, s.durationMs - remaining),
            charges: Number(overchargeStatus(shape)?.charges ?? 0),
            pop,
        }, s);
    },
    destroy() {},
});
