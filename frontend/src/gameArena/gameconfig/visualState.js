import { ABILITY_STATS } from "./Abilities.js";

export const COMBAT_VISUAL_MS = 300;
export const REPULSOR_BURST_VISUAL_MS = 500;
export const REPULSOR_BURST_FRAME_COUNT = 10;
export const REPULSOR_BURST_FRAME_MS = REPULSOR_BURST_VISUAL_MS / REPULSOR_BURST_FRAME_COUNT;
export const REPULSOR_BURST_MAX_DIAMETER = 220;
export const BASIC_HEAL_PARTICLE_COUNT = 6;
export const BASIC_HEAL_PARTICLE_LIFETIME_MS = 1000;

const REPULSOR_BURST_DIAMETER_SCALE = Object.freeze([0.33, 0.7, 0.93, 1, 1, 1, 1, 1, 1, 1]);
const BASIC_HEAL_PARTICLE_SPECS = Object.freeze([
    Object.freeze({ offsetX: -22, offsetY: -18, vx: -4, vy: -23, fontSize: 10, lifetimeMs: 900 }),
    Object.freeze({ offsetX: -13, offsetY: -27, vx: 1, vy: -27, fontSize: 12, lifetimeMs: 950 }),
    Object.freeze({ offsetX: -4, offsetY: -21, vx: 3, vy: -21, fontSize: 11, lifetimeMs: 1000 }),
    Object.freeze({ offsetX: 6, offsetY: -33, vx: -2, vy: -29, fontSize: 13, lifetimeMs: 1050 }),
    Object.freeze({ offsetX: 15, offsetY: -24, vx: 2, vy: -25, fontSize: 11, lifetimeMs: 950 }),
    Object.freeze({ offsetX: 24, offsetY: -17, vx: 4, vy: -22, fontSize: 12, lifetimeMs: 1000 }),
]);

export function healthBarPercent(hp, maxHp) {
    const safeMaxHp = Math.max(1, Number(maxHp) || 1);
    return clamp01((Number(hp) || 0) / safeMaxHp) * 100;
}

export function abilityActiveOpacity(shape, abilityId) {
    const activeMs = Math.max(0, Number(shape?.abilityActiveMs?.[abilityId] ?? 0));
    return clamp01(activeMs / Math.max(1, Number(ABILITY_STATS[abilityId]?.activeMs ?? 1)));
}

export function abilityVisualOpacity(shape, ability, durationMs = COMBAT_VISUAL_MS) {
    return clamp01(combatVisualRemainingMs(shape, ability) / durationMs);
}

/**
 * Bot-room fights carry the transient effect in abilityVisual while
 * authoritative replay frames carry the same timer in abilityActiveMs.
 */
export function combatVisualRemainingMs(shape, ability) {
    if (!ability) return 0;
    const abilityMs = shape?.abilityVisual?.ability === ability
        ? Number(shape.abilityVisual.ms ?? 0)
        : 0;
    return Math.max(0, abilityMs, Number(shape?.abilityActiveMs?.[ability] ?? 0));
}

export function visualProgress(remainingMs, durationMs = COMBAT_VISUAL_MS) {
    return 1 - clamp01(Number(remainingMs ?? 0) / durationMs);
}

export function repulsorBurstProgress(elapsedMs, durationMs = REPULSOR_BURST_VISUAL_MS) {
    const duration = Math.max(1, Number(durationMs) || REPULSOR_BURST_VISUAL_MS);
    return clamp01(Math.max(0, Number(elapsedMs) || 0) / duration);
}

export function repulsorBurstFrameIndex(progress, frameCount = REPULSOR_BURST_FRAME_COUNT) {
    const count = Math.max(1, Math.floor(Number(frameCount) || REPULSOR_BURST_FRAME_COUNT));
    return Math.min(count - 1, Math.floor(clamp01(progress) * count));
}

export function repulsorBurstDiameter(progress, maxDiameter = REPULSOR_BURST_MAX_DIAMETER, frameCount = REPULSOR_BURST_FRAME_COUNT) {
    const max = Number.isFinite(Number(maxDiameter)) ? Math.max(0, Number(maxDiameter)) : REPULSOR_BURST_MAX_DIAMETER;
    const frame = Math.min(REPULSOR_BURST_DIAMETER_SCALE.length - 1, repulsorBurstFrameIndex(progress, frameCount));
    return max * REPULSOR_BURST_DIAMETER_SCALE[frame];
}

export function basicHealParticleSpec(index) {
    const safeIndex = Math.max(0, Math.min(BASIC_HEAL_PARTICLE_SPECS.length - 1, Math.floor(Number(index) || 0)));
    return BASIC_HEAL_PARTICLE_SPECS[safeIndex];
}

export function sweepAngle(remainingMs, durationMs, startAngle, endAngle, frameStepMs = 100) {
    // A zero timer is no longer rendered. Map the last visible simulation
    // frame to the positive edge so the cosmetic sweep reaches both sides.
    const visibleDurationMs = Math.max(1, Number(durationMs) - Number(frameStepMs));
    const progress = Math.max(0, Math.min(1, (Number(durationMs) - Number(remainingMs ?? 0)) / visibleDurationMs));
    return startAngle + (endAngle - startAngle) * progress;
}

function clamp01(value) {
    return Math.max(0, Math.min(1, value));
}
