import { buildDeterministicLogicAction, idleAction } from "../botlogic/planner/ArenaActionPlanner.js";
import { isAbilityEntity, tickAbilityEntityWorld } from "../ecs/abilities/AbilityEntitySystem.js";
import { overlapsEntity } from "../gameconfig/hitboxGeometry.js";
import { applyBotAction } from "../ecs/bots/ActionExecutionSystem.js";
import {
    applyDamageFromShapes,
    applyDamageToShape,
    resolveTriggeredAbilityCombatForRoster,
    settlePendingHealing,
} from "../gameconfig/BotCombatSystem.js";
import { triggeredAbilityDamage } from "../ecs/abilities/AbilityEffectSystem.js";
import { abilityHitsTarget } from "../ecs/abilities/AbilityHitDetectionSystem.js";
import { isClosingZone, tickClosingZoneWorld } from "../ecs/entities/ClosingZoneSystem.js";
import { AUTO_STEP_MS, ARENA_HEIGHT_UNITS, ARENA_WIDTH_UNITS } from "./arenaConstants.js";
import { toCanonicalBotShape, toSimulationBotShape } from "./arenaShapes.js";

function finalizeTickMeasurements(shape, before) {
    if (!shape) return shape;
    return {
        ...shape,
        damageTakenLastTick: Number(shape.damageTakenThisTick ?? 0),
        damageTakenThisTick: 0,
        hpNetChangeLastTick: Number(shape.hp ?? 0) - Number(before?.hp ?? shape.hp ?? 0),
    };
}

export function isSimulationBotShape(shape) {
    return shape?.id === "main"
        || shape?.id === "opponent-model"
        || shape?.type === "circle"
        || shape?.type === "bot"
        || shape?.type === "botModel"
        || shape?.type === "opponentModel"
        || (shape?.slot != null && shape?.userId != null && shape?.abilityId == null);
}

/**
 * Advances one fixed 100 ms tick from a single start-of-tick snapshot.
 *
 * `brainFor(bot)` returns `{ configuration, loadout, stateSnapshot }` for a
 * bot that should act this tick, or null when it idles. `loadout` is informational:
 * the state snapshot already carries the bot's combat loadout.
 *
 * `closingZoneElapsedMs` is the match clock used by the closing zone. Pass a number,
 * or a function `(activeBots, botBefores) => ms` to read it after the actions resolve.
 */
export function advanceArenaTick(prevShapes, { brainFor, closingZoneElapsedMs } = {}) {
    const botBefores = prevShapes
        .filter(isSimulationBotShape)
        .map(toSimulationBotShape);
    const botsAfterActions = botBefores.map((bot) => {
        const brain = brainFor?.(bot) ?? null;
        const action = brain?.configuration
            ? buildDeterministicLogicAction(brain.configuration, brain.stateSnapshot)
            : idleAction();
        return {
            ...applyBotAction({ ...bot, lastPredictedAction: action }, action, AUTO_STEP_MS, applyDamageToShape),
            customVariables: action.customVariables,
        };
    });
    const spawnedEntities = botsAfterActions.map((bot) => bot.abilitySpawn).filter(Boolean);
    let abilityEntities = [...prevShapes.filter(isAbilityEntity)];
    const previousClosingZone = prevShapes.find(isClosingZone) ?? null;
    abilityEntities.push(...spawnedEntities.filter(isAbilityEntity));
    let activeBots = botsAfterActions.map((bot) => ({ ...bot, abilitySpawn: null }));
    activeBots = resolveTriggeredAbilityCombatForRoster(activeBots);
    const entityUpdate = tickAbilityEntityWorld({
        entities: abilityEntities,
        bots: activeBots,
        stepMs: AUTO_STEP_MS,
        width: ARENA_WIDTH_UNITS,
        height: ARENA_HEIGHT_UNITS,
    }, {
        applyDamageToShape,
        applyDamageFromShapes,
        abilityHitsTarget,
        triggeredAbilityDamage,
        overlapsShape: overlapsEntity,
    });
    activeBots = entityUpdate.bots;
    const clock = typeof closingZoneElapsedMs === "function"
        ? closingZoneElapsedMs(activeBots, botBefores)
        : closingZoneElapsedMs;
    const closingZoneUpdate = tickClosingZoneWorld({
        zone: previousClosingZone,
        bots: activeBots,
        elapsedMs: Number(clock ?? AUTO_STEP_MS),
        stepMs: AUTO_STEP_MS,
        width: ARENA_WIDTH_UNITS,
        height: ARENA_HEIGHT_UNITS,
    }, { applyDamageToShape });
    const settledBots = closingZoneUpdate.bots
        .map(settlePendingHealing)
        .map((bot) => finalizeTickMeasurements(
            bot,
            botBefores.find((before) => before.id === bot.id),
        ));
    abilityEntities = entityUpdate.entities;
    return [
        ...settledBots.map(toCanonicalBotShape),
        ...abilityEntities,
        ...(closingZoneUpdate.zone ? [closingZoneUpdate.zone] : []),
    ];
}
