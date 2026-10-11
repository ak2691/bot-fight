import { botMovementRotation, lingerFade, sprintSpawnPlan } from "../pixiVisualState.js";
import { seededRandom } from "./rendererHelpers.js";

/** Per-bot seed so each bot's trail has its own, repeatable pattern. */
const botSeed = (shape, seed) => seed + Number(shape?.slot ?? 0) * 7919;

function spawn(state, settings, shape, position, radius, heading, now) {
    const { line, dust } = settings;
    const random = state.random;
    const dirX = Math.cos(heading);
    const dirY = Math.sin(heading);
    const normalX = -dirY;
    const normalY = dirX;
    const side = (random() - 0.5) * 2 * radius * line.sideRadii;
    state.particles.push({
        kind: "line", bornAt: now, dirX, dirY,
        x: position.x - dirX * radius * line.behindRadii + normalX * side,
        y: position.y - dirY * radius * line.behindRadii + normalY * side,
        length: line.lengthMin + random() * line.lengthSpan,
    });
    if (random() < dust.chance) {
        const dustSide = (random() - 0.5) * 2 * radius * dust.sideRadii;
        state.particles.push({
            kind: "dust", bornAt: now, dirX, dirY,
            x: position.x - dirX * radius * dust.behindRadii + normalX * dustSide,
            y: position.y - dirY * radius * dust.behindRadii + normalY * dustSide,
        });
    }
}

function drawParticle(graphics, particle, position, age, settings) {
    const px = particle.x - position.x;
    const py = particle.y - position.y;
    if (particle.kind === "line") {
        const { line } = settings;
        const progress = age / line.lifeMs;
        const baseX = px - particle.dirX * progress * line.driftUnits;
        const baseY = py - particle.dirY * progress * line.driftUnits;
        graphics.moveTo(baseX, baseY)
            .lineTo(baseX - particle.dirX * particle.length, baseY - particle.dirY * particle.length)
            .stroke({ color: line.color, alpha: line.alpha * (1 - progress), width: line.width });
        return;
    }
    const { dust } = settings;
    const progress = age / dust.lifeMs;
    graphics.circle(px, py, dust.radiusStart + dust.radiusGrow * progress)
        .fill({ color: dust.color, alpha: dust.alpha * lingerFade(age, dust.lifeMs) });
}

/**
 * Sprint trail: while the bot's `sprinting` flag is set, a speed line (and now and then a dust puff)
 * spawns behind it every ~50 ms of presentation-clock time. Spawning stops with the sprint; what is
 * already in the air finishes fading. Offsets come from a seeded generator.
 */
export default Object.freeze({
    create: ({ shape, presentation }) => ({ particles: [], nextSpawnAt: null, random: seededRandom(botSeed(shape, presentation.seed)) }),
    sync(ctx) {
        // A reset or replay seek must not leave a trail from movement the viewer never saw.
        if (!ctx.suppressTransient) return;
        ctx.state.particles.length = 0;
        ctx.state.nextSpawnAt = null;
    },
    update(ctx) {
        if (ctx.pass !== "body") return;
        const { graphics, underGraphics = graphics, shape, position, radius, now, presentation, state } = ctx;
        const sprinting = shape.sprinting === true && !ctx.dead;
        if (sprinting) {
            const plan = sprintSpawnPlan(state.nextSpawnAt, now, presentation.spawnIntervalMs, presentation.maxCatchUp);
            state.nextSpawnAt = plan.nextSpawnAt;
            for (let index = 0; index < plan.count; index += 1) spawn(state, presentation, shape, position, radius, botMovementRotation(shape), now);
        } else {
            state.nextSpawnAt = null;
        }
        // Drop what has expired, or was born "in the future" because the presentation clock was rewound.
        state.particles = state.particles.filter((particle) => {
            const age = now - particle.bornAt;
            return age >= 0 && age < (particle.kind === "line" ? presentation.line.lifeMs : presentation.dust.lifeMs);
        });
        for (const particle of state.particles) drawParticle(underGraphics, particle, position, now - particle.bornAt, presentation);
    },
    destroy() {},
});
