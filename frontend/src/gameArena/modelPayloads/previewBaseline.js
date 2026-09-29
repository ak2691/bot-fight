import { isSimulationBotShape } from "./arenaPreviewSimulation.js";
import {
    mergeBotShapeUpdates,
    resetBotShapeToStartingConfiguration,
    toSimulationBotShape,
} from "./arenaShapes.js";

function botAtStartingState(shape, startingState = null) {
    const current = toSimulationBotShape(shape);
    const start = startingState ?? {
        startX: current.x,
        startY: current.y,
        rotation: current.rotation,
        startHp: current.hp,
    };
    const clean = {
        ...shape,
        damageTakenLastTick: 0,
        damageTakenThisTick: 0,
        hpNetChangeLastTick: 0,
        pendingHealing: 0,
        lastPredictedAction: null,
        abilitySpawn: null,
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
    const configuredBots = (Array.isArray(shapes) ? shapes : []).filter(isSimulationBotShape);
    const bots = configuredBots.map((shape) => botAtStartingState(shape));
    const suppliedElapsedMs = Number(initialElapsedMs);
    const shapeElapsedMs = configuredBots.length > 0
        ? Number(toSimulationBotShape(configuredBots[0]).matchElapsedMs ?? 0)
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
        const current = toSimulationBotShape(bot);
        const reset = botAtStartingState(bot, {
            startX: bot.startX ?? current.x,
            startY: bot.startY ?? current.y,
            rotation: bot.startRotation ?? current.rotation,
            startHp: bot.startHp ?? current.hp,
        });
        return elapsedMs > 0
            ? mergeBotShapeUpdates(reset, { matchElapsedMs: elapsedMs })
            : reset;
    });
}
