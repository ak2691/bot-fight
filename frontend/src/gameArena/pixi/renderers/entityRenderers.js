import { phaseForEntity } from "../../../../../shared/engine/ecs/contracts/AbilityContracts.js";
import { compassDegreesToRadians } from "../../../../../shared/engine/botlogic/planner/arenaAngles.js";
import { arcPath, clamp, rectanglePoints, rotatePoint, seededRandom } from "./rendererHelpers.js";

/**
 * Procedural arena entity renderers, keyed by the phase `visual.type` in shared/gameplay/abilities.json. A renderer is
 * `{ create, update, destroy }` with the same shape as BOT_ABILITY_RENDERERS:
 *   create(init)                 -> per-entity state, built on first use (`init`: view, shape)
 *   update(ctx)                  -> every frame: `ctx.graphics` (cleared by the caller), `ctx.shape`, `ctx.settings`,
 *                                   `ctx.state`, `ctx.progress` (0 to 1 across the current phase's durationMs)
 *   destroy(view, state)         -> when the entity view is removed
 * Ground visuals are drawn in the zones layer. Settings come from botAbilityPresentationDefinitions.js.
 */

const clamp01 = (value) => Math.max(0, Math.min(1, value));

function drawOrbitalMarker(g, { progress, elapsedMs }, s) {
    // The closing ring reaches the centre when the blast lands.
    g.circle(0, 0, s.radius).fill({ color: s.warn, alpha: 0.06 + 0.1 * progress });
    g.circle(0, 0, s.radius).stroke({ color: s.color, alpha: 0.5 + 0.4 * progress, width: 2 });
    g.circle(0, 0, s.radius * (1 - progress)).stroke({ color: s.core, alpha: 0.8, width: 2 });
    const spin = elapsedMs / 400;
    for (let i = 0; i < s.brackets; i += 1) {
        const a = spin + (Math.PI * 2 * i) / s.brackets;
        arcPath(g, 0, 0, s.radius + 10, a - 0.22, a + 0.22).stroke({ color: s.color, alpha: 0.9, width: 3, cap: "round" });
    }
    for (const a of [0, Math.PI / 2]) {
        const [x0, y0] = rotatePoint(a, -16, 0);
        const [x1, y1] = rotatePoint(a, 16, 0);
        g.moveTo(x0, y0).lineTo(x1, y1).stroke({ color: s.core, alpha: 0.5 + 0.5 * progress, width: 2 });
    }
}

function drawOrbitalBlast(g, { progress }, s) {
    const fade = 1 - progress;
    g.circle(0, 0, s.radius * (0.55 + 0.45 * progress)).fill({ color: s.core, alpha: 0.75 * fade * fade });
    g.circle(0, 0, s.radius * (1 + 0.35 * progress)).stroke({ color: s.color, alpha: fade, width: 6 * fade + 1 });
    const random = seededRandom(s.seed);
    for (let i = 0; i < s.spikes; i += 1) {
        const a = (Math.PI * 2 * i) / s.spikes + random() * 0.2;
        const reach = s.radius * (0.9 + random() * 0.5);
        const [x0, y0] = rotatePoint(a, s.radius * 0.3, 0);
        const [x1, y1] = rotatePoint(a, reach * (0.5 + 0.5 * progress), 0);
        g.moveTo(x0, y0).lineTo(x1, y1).stroke({ color: s.color, alpha: fade, width: 2, cap: "round" });
    }
}

/** Shot Blast pellet (a flying entity): a fading tracer behind a bright head. `angle` is the pellet's heading. */
function drawPellet(g, { progress, angle }, s) {
    const [tailX, tailY] = rotatePoint(angle, -s.tracer, 0);
    g.moveTo(tailX, tailY).lineTo(0, 0).stroke({ color: s.color, alpha: 0.55 * (1 - progress * 0.5), width: 2, cap: "round" });
    g.circle(0, 0, s.pelletRadius).fill({ color: s.flash, alpha: 1 });
}

/** Lunge's stab (attached to the bot): the blade extends along the hitbox, holds, then fades, with blood where it lands. */
function drawLungeStab(g, { progress, angle }, s, hitbox) {
    const length = Number(hitbox.length ?? 0);
    const width = Number(hitbox.width ?? 0);
    const extend = clamp(progress / s.extendFraction, 0, 1);
    const fade = progress < s.holdFraction ? 1 : 1 - (progress - s.holdFraction) / (1 - s.holdFraction);
    const reach = length * extend;
    g.poly(rectanglePoints(angle, 0, 0, length, width)).stroke({ color: s.color, alpha: 0.18 * fade, width: 1.5 });
    const [baseAX, baseAY] = rotatePoint(angle, s.botRadius, -width * 0.14);
    const [baseBX, baseBY] = rotatePoint(angle, s.botRadius, width * 0.14);
    const [tipX, tipY] = rotatePoint(angle, Math.max(s.botRadius, reach) + 14, 0);
    g.poly([baseAX, baseAY, tipX, tipY, baseBX, baseBY]).fill({ color: 0xffffff, alpha: 0.9 * fade });
    g.poly([baseAX, baseAY, tipX, tipY, baseBX, baseBY]).stroke({ color: s.color, alpha: fade, width: 2 });
    const random = seededRandom(s.seed);
    for (let i = 0; i < s.droplets; i += 1) {
        const spread = (random() - 0.5) * 1.6;
        const drop = 14 + random() * 26;
        const [dx, dy] = rotatePoint(angle + spread, drop * clamp(progress * 1.6, 0, 1), 0);
        g.circle(tipX + dx, tipY + dy, 2 + random() * 2.5).fill({ color: s.blood, alpha: fade * (extend >= 1 ? 1 : 0) });
    }
}

/** Boomerang (out and back): a spinning crescent that trails behind its heading, lighter once it is coming back. */
function drawBoomerang(g, { ageMs, angle, returning }, s) {
    const spin = (ageMs / 1000) * s.spinTurnsPerSecond * Math.PI * 2;
    const color = returning ? s.returnColor : s.color;
    for (let i = 1; i <= s.trailDots; i += 1) {
        const [x, y] = rotatePoint(angle, -i * s.trailSpacing, 0);
        g.circle(x, y, s.armWidth / 2 * (1 - i / (s.trailDots + 1))).fill({ color, alpha: 0.35 * (1 - i / (s.trailDots + 1)) });
    }
    const [armAX, armAY] = rotatePoint(spin, s.armLength, -s.armLength * 0.55);
    const [armBX, armBY] = rotatePoint(spin, s.armLength, s.armLength * 0.55);
    const [bendX, bendY] = rotatePoint(spin, -s.armLength * 0.35, 0);
    g.moveTo(armAX, armAY).quadraticCurveTo(bendX, bendY, armBX, armBY).stroke({ color, width: s.armWidth, cap: "round", alpha: 1 });
    g.moveTo(armAX, armAY).quadraticCurveTo(bendX, bendY, armBX, armBY).stroke({ color: 0xffffff, width: 1.5, cap: "round", alpha: 0.6 });
}

/** Fan of Blades: a spinning three-point blade with a ghost trail behind its heading. */
function drawBlade(g, { ageMs, angle }, s) {
    const spin = (ageMs / 1000) * s.spinTurnsPerSecond * Math.PI * 2;
    const star = (ox, oy) => {
        const points = [];
        for (let i = 0; i < s.points * 2; i += 1) {
            const [x, y] = rotatePoint(spin + (Math.PI * i) / s.points, i % 2 ? s.inner : s.outer, 0);
            points.push(ox + x, oy + y);
        }
        return points;
    };
    for (let i = s.ghosts; i >= 1; i -= 1) {
        const [gx, gy] = rotatePoint(angle, -i * s.ghostSpacing, 0);
        g.poly(star(gx, gy)).fill({ color: s.edge, alpha: 0.18 / i });
    }
    g.poly(star(0, 0)).fill({ color: s.fill, alpha: 1 });
    g.poly(star(0, 0)).stroke({ color: s.edge, alpha: 1, width: 1.5, join: "round" });
}

/** Tar Pit's glob, thrown onto the spot: it falls from above and lands with a shadow under it. */
function drawTarGlob(g, { progress }, s) {
    const lift = (1 - progress) * (1 - progress) * s.arcHeight;
    g.ellipse(0, 0, s.globRadius * (1 - lift / s.arcHeight * 0.4), s.globRadius * 0.45).fill({ color: 0x000000, alpha: 0.35 });
    g.circle(0, -lift, s.globRadius).fill({ color: s.pool, alpha: 1 });
    g.circle(0, -lift, s.globRadius).stroke({ color: s.edge, alpha: 0.9, width: 2 });
    g.circle(-4, -lift - 4, 3).fill({ color: s.bubble, alpha: 0.9 });
}

/** Tar Pit's pool: spreads over the first moments, bubbles while it lasts and fades out at the end. `radius` is the hitbox's. */
function drawTarPool(g, { progress, elapsedMs }, s, hitbox) {
    const radius = Number(hitbox.radius ?? 0);
    const grow = clamp(progress / 0.06, 0, 1);
    const fadeOut = progress > 0.92 ? 1 - (progress - 0.92) / 0.08 : 1;
    const random = seededRandom(s.seed);
    const points = [];
    for (let i = 0; i < s.lobes; i += 1) {
        const a = (Math.PI * 2 * i) / s.lobes;
        const r = radius * grow * (0.88 + random() * 0.18) + Math.sin(elapsedMs / 500 + i * 1.7) * s.wobble;
        points.push(Math.cos(a) * r, Math.sin(a) * r);
    }
    g.poly(points).fill({ color: s.pool, alpha: 0.82 * fadeOut });
    g.poly(points).stroke({ color: s.edge, alpha: 0.85 * fadeOut, width: 3, join: "round" });
    for (let i = 0; i < s.bubbles; i += 1) {
        const a = random() * Math.PI * 2;
        const d = random() * radius * 0.7 * grow;
        const period = s.bubbleMinMs + random() * s.bubbleSpanMs;
        const t = ((elapsedMs + random() * period) % period) / period;
        const x = Math.cos(a) * d;
        const y = Math.sin(a) * d;
        if (t < 0.8) g.circle(x, y, 2 + 6 * (t / 0.8)).fill({ color: s.bubble, alpha: 0.9 * fadeOut });
        else g.circle(x, y, 8 + 10 * ((t - 0.8) / 0.2)).stroke({ color: s.bubble, alpha: (1 - (t - 0.8) / 0.2) * fadeOut, width: 1.5 });
    }
    if (progress < 0.12) {
        const splash = progress / 0.12;
        g.circle(0, 0, radius * (0.4 + 0.75 * splash)).stroke({ color: s.edge, alpha: 1 - splash, width: 3 });
    }
}

/** Backstab (attached to the caster): a sweep behind the caster's facing in the wait phase, then, in the strike phase, a flash when the from-behind bonus landed. */
function drawBackstab(g, { progress, angle, phaseId, bonus }, s) {
    if (phaseId === "strike") {
        if (!bonus) return;
        const fade = 1 - progress;
        const [cx, cy] = rotatePoint(angle, s.radius + 20, 0);
        g.circle(cx, cy, 8 + 26 * progress).stroke({ color: s.bonus, alpha: fade, width: 2.5 });
        const random = seededRandom(s.seed);
        for (let i = 0; i < s.sparks; i += 1) {
            const a = random() * Math.PI * 2;
            const [x0, y0] = rotatePoint(a, 6 + 20 * progress, 0);
            const [x1, y1] = rotatePoint(a, 16 + 28 * progress, 0);
            g.moveTo(cx + x0, cy + y0).lineTo(cx + x1, cy + y1).stroke({ color: s.bonus, alpha: fade, width: 2, cap: "round" });
        }
        return;
    }
    const fade = 1 - progress;
    const half = (s.sweep * Math.PI / 180) / 2;
    const head = angle - half + half * 2 * clamp01(progress * 2.2);
    arcPath(g, 0, 0, s.radius, angle - half, head).stroke({ color: s.color, alpha: fade, width: s.width, cap: "round" });
    arcPath(g, 0, 0, s.radius, Math.max(angle - half, head - 0.35), head).stroke({ color: 0xffffff, alpha: fade, width: 2, cap: "round" });
}

/** Tether Link's bolt (flying): a three-point head with a slack trail behind its heading. */
function drawTetherBolt(g, { angle }, s) {
    const [tailX, tailY] = rotatePoint(angle, -s.trail, 0);
    g.moveTo(tailX, tailY).lineTo(0, 0).stroke({ color: s.slack, alpha: 0.5, width: 1.5 });
    const [tx, ty] = rotatePoint(angle, 12, 0);
    const [lx, ly] = rotatePoint(angle, -6, -7);
    const [rx, ry] = rotatePoint(angle, -6, 7);
    g.poly([tx, ty, lx, ly, rx, ry]).fill({ color: s.head, alpha: 1 });
    const [kx, ky] = rotatePoint(angle, -12, 0);
    g.circle(kx, ky, s.linkRadius).stroke({ color: s.head, alpha: 1, width: 2 });
}

/**
 * Draws the entity's ground visual, clocked by its phase timer (`phaseTimerMs`) over the current phase's durationMs.
 * `draw` also gets the entity's heading (`angle`), its age (`ageMs`, for spins that run across phases), whether it is in
 * its `back` phase (`returning`) and its current phase's hitbox, for visuals that need any of them.
 */
function updateWith(draw) {
    return ({ graphics, shape, settings }) => {
        const phase = phaseForEntity(shape);
        const elapsedMs = Math.max(0, Number(shape?.phaseTimerMs ?? 0));
        const durationMs = Number(phase?.durationMs ?? 0);
        const progress = durationMs > 0 ? clamp01(elapsedMs / durationMs) : 1;
        draw(graphics, {
            progress,
            elapsedMs,
            ageMs: Math.max(0, Number(shape?.ageMs ?? elapsedMs)),
            angle: compassDegreesToRadians(shape?.rotation ?? 0),
            returning: phase?.id === "back",
            phaseId: phase?.id,
            bonus: Boolean(shape?.bonusLanded),
        }, settings, phase?.hitbox ?? {});
    };
}

export const ENTITY_VISUAL_RENDERERS = Object.freeze({
    orbitalMarker: {
        create: () => ({}),
        update: updateWith(drawOrbitalMarker),
        destroy: () => {},
    },
    orbitalBlast: {
        create: () => ({}),
        update: updateWith(drawOrbitalBlast),
        destroy: () => {},
    },
    pellet: {
        create: () => ({}),
        update: updateWith(drawPellet),
        destroy: () => {},
    },
    lungeStab: {
        create: () => ({}),
        update: updateWith(drawLungeStab),
        destroy: () => {},
    },
    tarGlob: {
        create: () => ({}),
        update: updateWith(drawTarGlob),
        destroy: () => {},
    },
    tarPit: {
        create: () => ({}),
        update: updateWith(drawTarPool),
        destroy: () => {},
    },
    boomerang: {
        create: () => ({}),
        update: updateWith(drawBoomerang),
        destroy: () => {},
    },
    blade: {
        create: () => ({}),
        update: updateWith(drawBlade),
        destroy: () => {},
    },
    backstab: {
        create: () => ({}),
        update: updateWith(drawBackstab),
        destroy: () => {},
    },
    tetherLink: {
        create: () => ({}),
        update: updateWith(drawTetherBolt),
        destroy: () => {},
    },
});

/** The renderer for a phase visual type, or null: PixiCanvas routes a type here only when this returns one. */
export function entityRendererForVisualType(type) {
    return type && Object.hasOwn(ENTITY_VISUAL_RENDERERS, type) ? ENTITY_VISUAL_RENDERERS[type] : null;
}

/** Runs the entity renderer for a phase visual type on one view, creating its state on first use. */
export function updateEntityVisual(view, type, ctx) {
    const renderer = entityRendererForVisualType(type);
    if (!renderer) return;
    if (!view.entityVisuals) view.entityVisuals = new Map();
    let state = view.entityVisuals.get(type);
    if (!state) {
        state = renderer.create({ view, shape: ctx.shape }) ?? {};
        view.entityVisuals.set(type, state);
    }
    renderer.update({ ...ctx, state });
}

/** Called when the entity view is removed: destroys every renderer state the view created. */
export function destroyEntityVisuals(view) {
    if (!view.entityVisuals) return;
    for (const [type, state] of view.entityVisuals) entityRendererForVisualType(type)?.destroy(view, state);
    view.entityVisuals.clear();
}
