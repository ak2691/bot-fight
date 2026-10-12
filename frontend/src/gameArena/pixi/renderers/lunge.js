import { activeVisualFrame, clamp, rotatePoint } from "./rendererHelpers.js";

/** Lunge's crouch: rings and chevrons pressed round the bot, shrinking as the crouch fills. */
function drawCrouch(graphics, angle, progress, s) {
    graphics.circle(0, 0, s.ringRadius - s.ringSquash * progress)
        .stroke({ color: s.color, alpha: 0.2 + 0.55 * progress, width: 2 });
    for (let i = 0; i < s.chevrons; i += 1) {
        const lit = clamp(progress * s.chevrons - i, 0, 1);
        const forward = s.chevronStart + i * s.chevronSpacing;
        const [tipX, tipY] = rotatePoint(angle, forward + s.chevronDepth, 0);
        const [leftX, leftY] = rotatePoint(angle, forward, -s.chevronHalf);
        const [rightX, rightY] = rotatePoint(angle, forward, s.chevronHalf);
        graphics.moveTo(leftX, leftY).lineTo(tipX, tipY).lineTo(rightX, rightY)
            .stroke({ color: s.color, alpha: 0.12 + 0.8 * lit, width: s.chevronWidth, cap: "round", join: "round" });
    }
}

/** The leap's afterimages, trailing behind the bot where its 150-unit leap began. The bot has already moved. */
function drawLeap(graphics, angle, progress, s) {
    const fade = 1 - progress;
    for (let i = 0; i < s.afterimages; i += 1) {
        const back = (s.leapUnits * (i + 1)) / (s.afterimages + 1);
        const [x, y] = rotatePoint(angle, -back, 0);
        graphics.circle(x, y, s.botRadius * (1 - i * 0.12))
            .fill({ color: s.color, alpha: fade * 0.28 * (1 - i / s.afterimages) });
    }
    for (const lateral of [-s.botRadius * 0.6, 0, s.botRadius * 0.6]) {
        const [x0, y0] = rotatePoint(angle, -s.leapUnits, lateral);
        const [x1, y1] = rotatePoint(angle, -s.botRadius, lateral);
        graphics.moveTo(x0, y0).lineTo(x1, y1).stroke({ color: 0xffffff, alpha: fade * 0.5, width: 2, cap: "round" });
    }
}

/** Lunge: the crouch on the bot, then the leap's trail. The stab is the attached entity's visual, not this renderer's. */
export default Object.freeze({
    create: () => ({}),
    update(ctx) {
        if (ctx.pass !== "world" || !ctx.active) return;
        const { graphics, presentation: s } = ctx;
        const { angle, duration, remaining } = activeVisualFrame(ctx);
        const elapsed = clamp(duration - remaining, 0, duration);
        if (elapsed < s.crouchMs) {
            drawCrouch(graphics, angle, elapsed / s.crouchMs, s);
            return;
        }
        drawLeap(graphics, angle, clamp((elapsed - s.crouchMs) / s.leapMs, 0, 1), s);
    },
    destroy() {},
});

