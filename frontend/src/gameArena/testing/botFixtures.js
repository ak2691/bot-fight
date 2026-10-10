import { createBotState, isBotState } from "../../../../shared/engine/modelPayloads/botState.js";

const BOT_TYPES = new Set(["circle", "bot", "botModel", "opponentModel"]);

/** Test fixtures are written as loose objects; the engine only accepts bots built by the factory. */
export function asBot(shape) {
    if (isBotState(shape) || shape?.abilityId != null || shape?.phases != null) return shape;
    const looksLikeBot = shape?.id === "main" || shape?.id === "opponent-model" || BOT_TYPES.has(shape?.type);
    return looksLikeBot ? createBotState(shape) : shape;
}

export function asBots(shapes) {
    return shapes.map(asBot);
}
