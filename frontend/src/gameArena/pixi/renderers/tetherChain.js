import { statusEffectsFor } from "../../../../../shared/engine/ecs/contracts/StatusContracts.js";

/**
 * The chain from the caster to the tethered bot. The bot's graphics are drawn about the bot, so the chain is drawn from
 * the caster's offset (`fromX`, `fromY`) to the origin. Taut (red, straight) past the leash, slack (grey, sagging) inside it.
 */
function drawChain(g, { fromX, fromY, elapsedMs }, s) {
    // The chain in the caster's frame runs from (0, 0) to (toX, toY); `at` moves a point into the bot's frame.
    const toX = -fromX;
    const toY = -fromY;
    const at = (x, y) => [x + fromX, y + fromY];
    const distance = Math.hypot(toX, toY);
    const taut = distance > s.leash;
    const sag = taut ? 0 : s.sag * (1 - distance / s.leash);
    const cx = toX / 2 - (toY / Math.max(1, distance)) * sag * 0.3;
    const cy = toY / 2 + sag;
    const count = Math.max(2, Math.floor(distance / s.linkSpacing));
    const color = taut ? s.taut : s.slack;
    const pulse = taut ? 0.7 + 0.3 * Math.sin(elapsedMs / 60) : 1;
    for (let i = 1; i < count; i += 1) {
        const t = i / count;
        const [x, y] = at(2 * (1 - t) * t * cx + t * t * toX, 2 * (1 - t) * t * cy + t * t * toY);
        if (i % 2) g.circle(x, y, s.linkRadius).stroke({ color, alpha: pulse, width: 2 });
        else g.ellipse(x, y, s.linkRadius * 1.3, s.linkRadius * 0.6).stroke({ color, alpha: pulse, width: 2 });
    }
    if (!taut) return;
    // Pull chevrons on the tethered bot's side, pointing back at the caster.
    const back = Math.atan2(-toY, -toX);
    for (let i = 0; i < s.pullChevrons; i += 1) {
        const [ox, oy] = at(toX + Math.cos(back) * (40 + i * 14), toY + Math.sin(back) * (40 + i * 14));
        const [tx, ty] = [ox + Math.cos(back) * 8, oy + Math.sin(back) * 8];
        const [lx, ly] = [ox + Math.cos(back + Math.PI / 2) * 9, oy + Math.sin(back + Math.PI / 2) * 9];
        const [rx, ry] = [ox - Math.cos(back + Math.PI / 2) * 9, oy - Math.sin(back + Math.PI / 2) * 9];
        g.moveTo(lx, ly).lineTo(tx, ty).lineTo(rx, ry).stroke({ color: s.taut, alpha: pulse, width: 2.5, cap: "round", join: "round" });
    }
}

/** Tether Link: the chain on the tethered bot, from the caster's current position (read from the bots on screen). */
export default Object.freeze({
    create: () => ({}),
    update(ctx) {
        if (ctx.pass !== "body" || ctx.dead) return;
        const { shape, graphics, presentation: s, now } = ctx;
        const tether = statusEffectsFor(shape).find((status) => status.type === "tethered");
        if (!tether || tether.sourceSlot == null) return;
        const caster = (ctx.otherBots ?? []).find(({ view }) => Number(view?.shape?.slot) === Number(tether.sourceSlot));
        if (!caster?.position) return;
        drawChain(graphics, { fromX: caster.position.x - ctx.position.x, fromY: caster.position.y - ctx.position.y, elapsedMs: now }, s);
    },
    destroy() {},
});
