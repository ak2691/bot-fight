import { buildDeterministicLogicAction, idleAction } from "../botlogic/planner/ArenaActionPlanner.js";
import { hasAbilityStrategyActions } from "../botlogic/code/BotCode.js";
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
import { createStatePayloadFactory } from "./strategyStatePayload.js";
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

/** Advance one browser-only preview tick from a single shared start-of-tick snapshot. */
export function advanceArenaPreviewTick(prevShapes, {
    selectedLoadout,
    opponentLoadout,
    testingConfiguration,
    opponentTestingConfiguration,
}) {
    const statePayloads = createStatePayloadFactory(prevShapes);
    const stateSnapshot = statePayloads.forActor(selectedLoadout);
    const botBefores = prevShapes
        .filter(isSimulationBotShape)
        .map(toSimulationBotShape);
    const mainBefore = botBefores.find((bot) => bot.id === "main") ?? null;
    const botsAfterActions = botBefores.map((bot) => {
        const configuration = bot.id === "main"
            ? testingConfiguration
            : bot.id === "opponent-model"
                ? opponentTestingConfiguration
                : bot.strategyConfiguration;
        const botLoadout = bot.id === "main"
            ? selectedLoadout
            : bot.id === "opponent-model"
                ? opponentLoadout
                : bot.combatLoadout;
        const action = configuration
            && (bot.id === "main" || hasAbilityStrategyActions(configuration))
            ? buildDeterministicLogicAction(
                configuration,
                bot.id === "main" ? stateSnapshot : statePayloads.forActor(botLoadout, bot.id),
            )
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
    const closingZoneUpdate = tickClosingZoneWorld({
        zone: previousClosingZone,
        bots: activeBots,
        elapsedMs: Number(activeBots.find((bot) => bot.id === "main")?.matchElapsedMs
            ?? mainBefore?.matchElapsedMs ?? AUTO_STEP_MS),
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
