import { activeVisualFrame, clamp, rotatePoint } from "./rendererHelpers.js";

/** Execute's strike: a long blade that flashes white, then fades, over the activation's visible window. */
function drawStrike(graphics, angle, progress, s, length, width, bonus) {
    const fade = 1 - progress;
    const [baseAX, baseAY] = rotatePoint(angle, 30, -width * 0.12);
    const [baseBX, baseBY] = rotatePoint(angle, 30, width * 0.12);
    const [tailAX, tailAY] = rotatePoint(angle, length, -width * 0.5);
    const [tipX, tipY] = rotatePoint(angle, length + 16, 0);
    const [tailBX, tailBY] = rotatePoint(angle, length, width * 0.5);
    const blade = [baseAX, baseAY, tailAX, tailAY, tipX, tipY, tailBX, tailBY, baseBX, baseBY];
    graphics.poly(blade).fill({ color: progress < 0.15 ? 0xffffff : s.color, alpha: fade * 0.85 });
    graphics.poly(blade).stroke({ color: s.light, alpha: fade, width: 2, join: "round" });
    if (!bonus) return;
    // The bonus X on the blade: the below-30% finisher landed (the hit reports it; the renderer does not decide it).
    const [cx, cy] = rotatePoint(angle, length * 0.75, 0);
    const size = 20 + 22 * progress;
    for (const a of [Math.PI / 4, -Math.PI / 4]) {
        const [x0, y0] = rotatePoint(a, -size, 0);
        const [x1, y1] = rotatePoint(a, size, 0);
        graphics.moveTo(cx + x0, cy + y0).lineTo(cx + x1, cy + y1).stroke({ color: 0x0d1117, alpha: fade, width: 11, cap: "round" });
        graphics.moveTo(cx + x0, cy + y0).lineTo(cx + x1, cy + y1).stroke({ color: s.color, alpha: fade, width: 7, cap: "round" });
        graphics.moveTo(cx + x0, cy + y0).lineTo(cx + x1, cy + y1).stroke({ color: 0xffffff, alpha: fade * 0.8, width: 2, cap: "round" });
    }
}

/** Execute: the strike on the bot. The hitbox sets the blade's length and width; the wind-up has no visual of its own. */
export default Object.freeze({
    create: () => ({}),
    update(ctx) {
        if (ctx.pass !== "world" || !ctx.active) return;
        const { graphics, presentation: s } = ctx;
        const { angle, duration, remaining, phaseHitbox } = activeVisualFrame(ctx);
        drawStrike(graphics, angle, clamp((duration - remaining) / duration, 0, 1), s,
            Number(phaseHitbox.length ?? 0), Number(phaseHitbox.width ?? 0), Boolean(ctx.shape.abilityVisual?.bonus));
    },
    destroy() {},
});
