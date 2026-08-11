import { hasAbilityStrategyActions } from "../botlogic/code/BotCode.js";
import { buildDeterministicLogicAction, idleAction } from "../botlogic/planner/ArenaActionPlanner.js";
import { applyBotAction } from "../ecs/ActionExecutionSystem.js";
import { isAbilityEntity, tickAbilityEntityWorld } from "../ecs/AbilityEntitySystem.js";
import { grenadeDamageToEntity, overlapsEntity, tickProjectileWorld } from "../ecs/ProjectileSystem.js";
import {
    applyDamageFromShapes,
    applyDamageToShape,
    resolveTriggeredAbilityCombat,
    settlePendingHealing,
} from "../gameconfig/BotCombatSystem.js";
import { abilityHitsTarget, triggeredAbilityDamage } from "../ecs/AbilityEffectSystem.js";
import { AUTO_STEP_MS, ARENA_HEIGHT_UNITS, ARENA_WIDTH_UNITS } from "../modelPayloads/arenaConstants.js";
import { buildAbilityTestingArenaShapes } from "./AbilityTestingPresets.js";
import { buildStatePayload } from "../modelPayloads/strategyStatePayload.js";

function finalizeTickMeasurements(shape, before) {
    if (!shape) return shape;
    return {
        ...shape,
        damageTakenLastTick: Number(shape.damageTakenThisTick ?? 0),
        damageTakenThisTick: 0,
        hpNetChangeLastTick: Number(shape.hp ?? 0) - Number(before?.hp ?? shape.hp ?? 0),
    };
}

function applyActionToShape(shape, action, elapsedMs) {
    return applyBotAction(shape, action, elapsedMs, applyDamageToShape);
}

/**
 * Advance the same deterministic client-side preview systems used by the
 * ability lab's autoplay. The payload is intentionally supplied by the
 * caller so the lab replay can test the current client code/loadout draft.
 */
export function stepAbilityTestingSimulation(previousShapes, {
    playerCode,
    opponentCode,
    playerLoadout,
    opponentLoadout,
    stepMs = AUTO_STEP_MS,
} = {}) {
    const stateSnapshot = buildStatePayload(previousShapes, playerLoadout);
    const mainBefore = previousShapes.find((shape) => shape.id === "main");
    const opponentBefore = previousShapes.find((shape) => shape.id === "opponent-model");
    if (!mainBefore) return previousShapes;

    const playerPredictedAction = buildDeterministicLogicAction(playerCode, stateSnapshot);
    const opponentPredictedAction = opponentBefore && hasAbilityStrategyActions(opponentCode)
        ? buildDeterministicLogicAction(opponentCode, buildStatePayload(previousShapes, opponentLoadout, "opponent-model"))
        : idleAction();

    let mainAfter = {
        ...applyActionToShape({ ...mainBefore, lastPredictedAction: playerPredictedAction }, playerPredictedAction, stepMs),
        customVariables: playerPredictedAction.customVariables,
    };
    let opponentAfter = opponentBefore
        ? {
            ...applyActionToShape({ ...opponentBefore, lastPredictedAction: opponentPredictedAction }, opponentPredictedAction, stepMs),
            customVariables: opponentPredictedAction.customVariables,
        }
        : null;

    let grenadeShapes = previousShapes.filter((shape) => shape.type === "grenade" || shape.type === "grenadeExplosion");
    grenadeShapes.push(...[mainAfter.thrownGrenade, opponentAfter?.thrownGrenade].filter(Boolean));
    let fireballShapes = previousShapes.filter((shape) => shape.type === "fireball");
    fireballShapes.push(...[mainAfter.thrownFireball, opponentAfter?.thrownFireball].filter(Boolean));
    let abilityEntities = previousShapes.filter(isAbilityEntity);
    for (const spawn of [mainAfter.abilitySpawn, opponentAfter?.abilitySpawn].filter(Boolean)) {
        abilityEntities.push(spawn);
    }

    mainAfter = { ...mainAfter, thrownGrenade: null, thrownFireball: null, abilitySpawn: null };
    if (opponentAfter) {
        opponentAfter = { ...opponentAfter, thrownGrenade: null, thrownFireball: null, abilitySpawn: null };
    }

    if (opponentAfter) {
        [mainAfter, opponentAfter] = resolveTriggeredAbilityCombat(mainAfter, opponentAfter);
    } else {
        [mainAfter, opponentAfter] = resolveTriggeredAbilityCombat(mainAfter, opponentAfter);
    }

    const projectileUpdate = tickProjectileWorld({
        bots: opponentAfter ? [mainAfter, opponentAfter] : [mainAfter],
        grenades: grenadeShapes,
        fireballs: fireballShapes,
        stepMs,
        width: ARENA_WIDTH_UNITS,
        height: ARENA_HEIGHT_UNITS,
    }, { applyDamageToShape, applyDamageFromShapes });
    [mainAfter] = projectileUpdate.bots;
    if (opponentAfter) opponentAfter = projectileUpdate.bots[1];
    grenadeShapes = projectileUpdate.grenades;
    fireballShapes = projectileUpdate.fireballs;

    const entityUpdate = tickAbilityEntityWorld({
        entities: abilityEntities,
        bots: opponentAfter ? [mainAfter, opponentAfter] : [mainAfter],
        grenades: grenadeShapes,
        fireballs: fireballShapes,
        stepMs,
        width: ARENA_WIDTH_UNITS,
        height: ARENA_HEIGHT_UNITS,
    }, {
        applyDamageToShape,
        applyDamageFromShapes,
        abilityHitsTarget,
        triggeredAbilityDamage,
        grenadeDamageToBot: grenadeDamageToEntity,
        overlapsShape: overlapsEntity,
    });
    [mainAfter] = entityUpdate.bots;
    if (opponentAfter) opponentAfter = entityUpdate.bots[1];
    mainAfter = settlePendingHealing(mainAfter);
    if (opponentAfter) opponentAfter = settlePendingHealing(opponentAfter);
    mainAfter = finalizeTickMeasurements(mainAfter, mainBefore);
    if (opponentAfter) opponentAfter = finalizeTickMeasurements(opponentAfter, opponentBefore);

    return [
        mainAfter,
        ...(opponentAfter ? [opponentAfter] : []),
        ...grenadeShapes,
        ...fireballShapes,
        ...entityUpdate.entities,
    ];
}

function replayState(shapes) {
    return {
        bots: shapes.filter((shape) => shape.id === "main" || shape.id === "opponent-model"),
        obstacles: shapes.filter((shape) => shape.id !== "main" && shape.id !== "opponent-model"),
    };
}

function participant({ userId, username, slot, selectedLoadout }) {
    return { userId, username, slot, roundWins: 0, selectedLoadout };
}

export function buildAbilityTestingPlayback({
    preset,
    playerCode = preset?.playerCode,
    opponentCode = preset?.opponentCode,
    playerLoadout = preset?.playerLoadout,
    opponentLoadout = preset?.opponentLoadout,
    durationMs = preset?.replayDurationMs ?? 12_000,
    stepMs = AUTO_STEP_MS,
    playbackStartsAtMs = null,
} = {}) {
    if (!preset) throw new Error("An ability testing preset is required to build a replay.");

    const payloadPreset = { ...preset, playerLoadout, opponentLoadout };
    let shapes = buildAbilityTestingArenaShapes(payloadPreset);
    const frames = [];
    const initialState = replayState(shapes);
    const resolvedPlayerCode = { ...(playerCode ?? {}), loadout: playerLoadout };
    const resolvedOpponentCode = { ...(opponentCode ?? {}), loadout: opponentLoadout };
    const maxDuration = Math.max(0, Number(durationMs) || 0);
    const safeStepMs = Math.max(1, Number(stepMs) || AUTO_STEP_MS);

    for (let elapsedMs = safeStepMs; elapsedMs <= maxDuration; elapsedMs += safeStepMs) {
        shapes = stepAbilityTestingSimulation(shapes, {
            playerCode: resolvedPlayerCode,
            opponentCode: resolvedOpponentCode,
            playerLoadout,
            opponentLoadout,
            stepMs: safeStepMs,
        });
        const state = replayState(shapes);
        frames.push({ elapsedMs, bots: state.bots, obstacles: state.obstacles });
        const player = state.bots.find((bot) => bot.id === "main");
        const opponent = state.bots.find((bot) => bot.id === "opponent-model");
        if (Number(player?.hp ?? 0) <= 0 || Number(opponent?.hp ?? 0) <= 0) break;
    }

    const finalBots = (frames.at(-1)?.bots ?? initialState.bots);
    const finalPlayer = finalBots.find((bot) => bot.id === "main");
    const finalOpponent = finalBots.find((bot) => bot.id === "opponent-model");
    const playerAlive = Number(finalPlayer?.hp ?? 0) > 0;
    const opponentAlive = Number(finalOpponent?.hp ?? 0) > 0;
    const result = playerAlive === opponentAlive ? "DRAW" : "BOT_WIN";
    const winnerUserId = result === "BOT_WIN"
        ? playerAlive ? "ability-test-player" : "ability-test-opponent"
        : null;
    const player = participant({
        userId: "ability-test-player",
        username: "Test Bot",
        slot: 1,
        selectedLoadout: playerLoadout,
    });
    const opponent = participant({
        userId: "ability-test-opponent",
        username: "Practice Bot",
        slot: 2,
        selectedLoadout: opponentLoadout,
    });

    return {
        source: "ability-lab",
        local: true,
        rulesetVersion: "local-ability-test-v1",
        frames,
        initialState,
        player,
        opponent,
        players: [player, opponent],
        roundNumber: 1,
        playbackStartsAtMs,
        finalBatchSequence: 1,
        result,
        winnerUserId,
        message: result === "DRAW"
            ? "Local ability test replay complete."
            : `${winnerUserId === "ability-test-player" ? player.username : opponent.username} won the local ability test.`,
        roundWinsBeforeResult: { player: 0, opponent: 0 },
    };
}
