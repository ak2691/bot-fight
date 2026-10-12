import { ABILITY_STATS, abilityTiming } from "./Abilities.js";
import { activeRemainingMs } from "./AbilityState.js";

export const COMBAT_VISUAL_MS = 300;
/**
 * Direct ability activations that create the short-lived bot-room visual.
 * Replay uses the trigger marker for these same abilities because the
 * transient `abilityVisual` object is intentionally not part of simulation
 * state.
 */
export const COMBAT_VISUAL_ABILITY_IDS = Object.freeze([
    1, 3, 6, 7, 8, 9, 10, 12, 13, 16, 23, 25, 26, 30, 32, 33, 35, 36, 37,
]);
export const REPULSOR_BURST_VISUAL_MS = 500;
export const REPULSOR_BURST_FRAME_COUNT = 10;
export const REPULSOR_BURST_FRAME_MS = REPULSOR_BURST_VISUAL_MS / REPULSOR_BURST_FRAME_COUNT;
export const REPULSOR_BURST_MAX_DIAMETER = 220;

const REPULSOR_BURST_DIAMETER_SCALE = Object.freeze([0.33, 0.7, 0.93, 1, 1, 1, 1, 1, 1, 1]);

export function healthBarPercent(hp, maxHp) {
    const safeMaxHp = Math.max(1, Number(maxHp) || 1);
    return clamp01((Number(hp) || 0) / safeMaxHp) * 100;
}

export function formatHp(hp, fallback = 0) {
    return Math.max(0, Number(hp ?? fallback)).toFixed(1);
}

export function abilityActiveOpacity(shape, abilityId) {
    const activeMs = activeRemainingMs(shape, abilityId);
    return clamp01(activeMs / Math.max(1, Number(abilityTiming(abilityId).activeMs ?? 1)));
}

export function abilityVisualOpacity(shape, ability, durationMs = COMBAT_VISUAL_MS) {
    return clamp01(combatVisualRemainingMs(shape, ability) / durationMs);
}

/** Keeps bot-room and replay activation visuals on the same duration contract. */
export function combatVisualDurationMs(abilityId, phaseVisual = null) {
    const legacyStats = ABILITY_STATS[abilityId] ?? {};
    const configuredMs = Number(phaseVisual?.visibleMs
        ?? phaseVisual?.durationMs
        ?? legacyStats.visualDurationMs
        ?? legacyStats.visualMs
        ?? legacyStats.durationMs
        ?? 0);
    return Math.max(COMBAT_VISUAL_MS, Number.isFinite(configuredMs) ? configuredMs : 0);
}

/**
 * Bot-room fights carry the transient effect in abilityVisual while
 * authoritative replay frames carry the same timer as the ability's active stage.
 */
export function combatVisualRemainingMs(shape, ability) {
    if (!ability) return 0;
    const abilityMs = shape?.abilityVisual?.ability === ability
        ? Number(shape.abilityVisual.ms ?? 0)
        : 0;
    return Math.max(0, abilityMs, activeRemainingMs(shape, ability));
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
