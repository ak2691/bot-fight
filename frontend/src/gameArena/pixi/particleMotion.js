export function advanceParticle(particle, elapsedMs) {
    const deltaMs = Math.max(0, Number(elapsedMs) || 0);
    if (deltaMs === 0) return particle;
    const seconds = Math.min(0.05, deltaMs / 1000);
    return {
        ...particle,
        lifeMs: particle.lifeMs - deltaMs,
        x: particle.x + particle.vx * seconds,
        y: particle.y + particle.vy * seconds,
        vx: particle.vx * 0.97,
        vy: particle.vy * 0.97,
    };
}
