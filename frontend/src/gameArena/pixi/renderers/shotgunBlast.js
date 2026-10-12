import { activeVisualFrame, clamp, rotatePoint, sectorPoints } from "./rendererHelpers.js";

/** Shotgun Blast's muzzle: a flash cone and a star burst at the muzzle, both fading over the visible window. */
function drawMuzzleBlast(graphics, angle, progress, s) {
    const fade = 1 - progress;
    graphics.poly(sectorPoints(angle, 0, 0, s.muzzle + 70 * (0.6 + 0.4 * progress), s.arc + 10))
        .fill({ color: s.flash, alpha: 0.35 * fade });
    const [muzzleX, muzzleY] = rotatePoint(angle, s.muzzle, 0);
    const spikes = 6;
    const points = [];
    for (let i = 0; i < spikes * 2; i += 1) {
        const r = i % 2 === 0 ? 18 * fade + 6 : 6;
        const [x, y] = rotatePoint(angle + (Math.PI * i) / spikes, r, 0);
        points.push(muzzleX + x, muzzleY + y);
    }
    graphics.poly(points).fill({ color: s.flash, alpha: fade });
}

/** Shotgun Blast: the muzzle blast on the bot. The pellets are the `pellet` entity visual. No wind-up visual (SOLVED_MATCHUPS). */
export default Object.freeze({
    create: () => ({}),
    update(ctx) {
        if (ctx.pass !== "world" || !ctx.active) return;
        const { graphics, presentation: s } = ctx;
        const { angle, duration, remaining } = activeVisualFrame(ctx);
        drawMuzzleBlast(graphics, angle, clamp((duration - remaining) / duration, 0, 1), s);
    },
    destroy() {},
});
