import { hasAbilityStrategyActions } from "../botlogic/code/BotCode.js";
import { AUTO_STEP_MS } from "./arenaConstants.js";
import { advanceArenaTick, isSimulationBotShape } from "./arenaTick.js";
import { createStatePayloadFactory } from "./strategyStatePayload.js";

export { isSimulationBotShape };

/**
 * Advance one browser-only preview tick from a single shared start-of-tick snapshot.
 * "main" always runs its testing brain; other bots run only when they have ability actions.
 */
export function advanceArenaPreviewTick(prevShapes, {
    selectedLoadout,
    opponentLoadout,
    testingConfiguration,
    opponentTestingConfiguration,
}) {
    const statePayloads = createStatePayloadFactory(prevShapes);
    const stateSnapshot = statePayloads.forActor(selectedLoadout);
    return advanceArenaTick(prevShapes, {
        brainFor(bot) {
            const isMain = bot.id === "main";
            const isOpponentModel = bot.id === "opponent-model";
            const configuration = isMain
                ? testingConfiguration
                : isOpponentModel
                    ? opponentTestingConfiguration
                    : bot.strategyConfiguration;
            if (!configuration || (!isMain && !hasAbilityStrategyActions(configuration))) return null;
            const loadout = isMain
                ? selectedLoadout
                : isOpponentModel
                    ? opponentLoadout
                    : bot.combatLoadout;
            return {
                configuration,
                loadout,
                stateSnapshot: isMain ? stateSnapshot : statePayloads.forActor(loadout, bot.id),
            };
        },
        closingZoneElapsedMs(activeBots, botBefores) {
            return Number(activeBots.find((bot) => bot.id === "main")?.matchElapsedMs
                ?? botBefores.find((bot) => bot.id === "main")?.matchElapsedMs ?? AUTO_STEP_MS);
        },
    });
}
