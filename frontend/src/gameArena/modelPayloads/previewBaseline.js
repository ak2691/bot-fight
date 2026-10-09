import { resetBotShapeToStartingConfiguration } from "./arenaShapes.js";
import { isBotState } from "./botState.js";

function botAtStartingState(shape, startingState = null) {
    const start = startingState ?? {
        startX: shape.x,
        startY: shape.y,
        rotation: shape.rotation,
        startHp: shape.hp,
    };
    const clean = {
        ...shape,
        damageTakenLastTick: 0,
        damageTakenThisTick: 0,
        hpNetChangeLastTick: 0,
        pendingHealing: 0,
        lastPredictedAction: null,
        abilitySpawn: [],
        triggeredAbility: null,
        abilityVisual: null,
        temporalRewindMs: 0,
        temporalRewindPulseMs: 0,
        temporalRewindX: null,
        temporalRewindY: null,
        temporalRewindHp: null,
        temporalRewindVisualX: null,
        temporalRewindVisualY: null,
    };
    return resetBotShapeToStartingConfiguration(clean, start);
}

/**
 * Capture a reset baseline separately from the live preview shapes.
 * The baseline owns the configured roster and starting bot state; transient
 * entities are deliberately excluded.
 */
export function createPreviewBaseline(shapes, { initialElapsedMs = null } = {}) {
    const configuredBots = (Array.isArray(shapes) ? shapes : []).filter(isBotState);
    const bots = configuredBots.map((shape) => botAtStartingState(shape));
    const suppliedElapsedMs = Number(initialElapsedMs);
    const shapeElapsedMs = configuredBots.length > 0
        ? Number(configuredBots[0].matchElapsedMs ?? 0)
        : 0;
    return {
        bots,
        initialElapsedMs: Math.max(0, Number.isFinite(suppliedElapsedMs) && initialElapsedMs != null
            ? suppliedElapsedMs
            : shapeElapsedMs),
    };
}

/** Restore only the saved roster, snapping every bot to its saved state. */
export function restorePreviewBaseline(baseline) {
    const elapsedMs = Math.max(0, Number(baseline?.initialElapsedMs) || 0);
    return (Array.isArray(baseline?.bots) ? baseline.bots : []).map((bot) => {
        const reset = botAtStartingState(bot, {
            startX: bot.startX ?? bot.x,
            startY: bot.startY ?? bot.y,
            rotation: bot.startRotation ?? bot.rotation,
            startHp: bot.startHp ?? bot.hp,
        });
        return elapsedMs > 0
            ? { ...reset, matchElapsedMs: elapsedMs }
            : reset;
    });
}
