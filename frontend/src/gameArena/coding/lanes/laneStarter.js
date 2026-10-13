// The starter lanes brain (docs/LANES.md "Starter"): one mode "Main" with Movement cards "Walk to enemy" and "Face enemy",
// and one Actions card per equipped ability that has a base range. Every card is an ordinary card the player can edit
// or delete.
import { normalizeAbilityStrategyConfiguration } from "../../../../../shared/engine/botlogic/code/BotCode.js";
import { ACTION_BY_ID, ACTION_HEADS, BOT_CODE_ACTIONS, BOT_CODE_SELECTABLES } from "../../../../../shared/engine/botlogic/code/contracts/BotLogicContracts.js";
import { BOT_LOGIC_LANES_VERSION } from "../../../../../shared/engine/botlogic/code/configuration/constants.js";
import { abilityBaseRange } from "../../../../../shared/engine/loadout/abilityBaseRange.js";
import { defaultAimFields } from "./aimDefaults.js";

export const STARTER_MODE_ID = "mode-main";
export const STARTER_MODE_NAME = "Main";

/** "When the enemy is within this ability's base range": distance from My Bot to its nearest enemy, against Base Range. */
export function abilityRangeCondition(abilityId) {
    return {
        type: "expression",
        left: "selectable.distance",
        selectable1: BOT_CODE_SELECTABLES.MY,
        selectable2: BOT_CODE_SELECTABLES.OPPONENT,
        comparator: "lte",
        right: { type: "variable", value: "bot.selectedAbilityBaseRange" },
        ability: abilityId,
        rightSelectable: BOT_CODE_SELECTABLES.MY,
    };
}

/**
 * The starter brain for the given ability ids (the equipped set, standard abilities included). Abilities without a
 * base range (movement-only, circles) and dash abilities get no Actions card: the starter only holds what a
 * visible rule can say. Returns the normalized brain, so it passes the same checks as any saved brain.
 */
export function createLanesStarter(abilityIds = []) {
    const abilityCards = [...new Set(abilityIds.map(Number))]
        .filter((id) => Number.isInteger(id) && ACTION_BY_ID.get(id)?.head === ACTION_HEADS.ABILITY && abilityBaseRange(id) != null)
        .sort((first, second) => first - second)
        .map((id) => ({
            id: `card-ability-${id}`,
            conditions: [abilityRangeCondition(id)],
            action: { action: id, selectable: BOT_CODE_SELECTABLES.OPPONENT, ...defaultAimFields(ACTION_BY_ID.get(id)) },
        }));
    const movement = [
        { id: "card-move", conditions: [], action: { action: BOT_CODE_ACTIONS.MOVE_WALK, selectable: BOT_CODE_SELECTABLES.OPPONENT } },
        { id: "card-face", conditions: [], action: { action: BOT_CODE_ACTIONS.ROTATE_TOWARD_TARGET, selectable: BOT_CODE_SELECTABLES.OPPONENT } },
    ];
    const actions = abilityCards;
    return normalizeAbilityStrategyConfiguration({
        version: BOT_LOGIC_LANES_VERSION,
        modes: [{ id: STARTER_MODE_ID, name: STARTER_MODE_NAME, movement, ...(actions.length ? { actions } : {}) }],
        shared: {},
        customVariables: [],
    });
}
