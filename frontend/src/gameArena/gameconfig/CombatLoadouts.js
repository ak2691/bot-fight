import { actionIdsForLoadout, actionIdsForSandboxLoadout, decodeBotLoadout, decodeSandboxLoadout, encodeBotLoadout, DEFAULT_BOT_LOADOUT } from "../loadout/BotLoadout.js";

export const COMMON_ACTION_IDS = Object.freeze(["none", "variable", "move_walk", "rotate_toward_enemy"]);

export const DEFAULT_BOT_CONFIGURATION_ID = encodeBotLoadout(DEFAULT_BOT_LOADOUT);
export function actionTypesForLoadout(actionTypes, configuration = DEFAULT_BOT_CONFIGURATION_ID) {
    const allowed = new Set(actionIdsForLoadoutConfiguration(configuration));
    return actionTypes.filter(({ id }) => allowed.has(id));
}
export function actionIdsForLoadoutConfiguration(configuration) {
    if (String(configuration).startsWith("sandbox:")) {
        return [...COMMON_ACTION_IDS, ...actionIdsForSandboxLoadout(decodeSandboxLoadout(configuration))];
    }
    if (String(configuration).startsWith("custom:")) return [...COMMON_ACTION_IDS, ...actionIdsForLoadout(decodeBotLoadout(configuration))];
    return [...COMMON_ACTION_IDS, ...actionIdsForLoadout(DEFAULT_BOT_LOADOUT)];
}
