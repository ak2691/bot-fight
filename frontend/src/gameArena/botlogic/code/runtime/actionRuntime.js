import { abilityChargesFor, abilityIgnoresGlobalLock, abilityRechargeRemainingMs, abilityTimingReady, anotherAbilityActive } from "../../../gameconfig/AbilityResourceSystem.js";
import { abilityContract } from "../../../gameconfig/AbilityContracts.js";
import { ACTION_HEADS, BOT_CODE_ACTIONS } from "../contracts/BotLogicContracts.js";

export function actionSupportsTarget(action) {
    return Boolean(action.movementConfig)
        || action.id === BOT_CODE_ACTIONS.ROTATE_TOWARD_TARGET
        || Boolean(action.targetMode)
        || action.locationTarget === true;
}

export function actionExecutableNow(block, state, operations) {
    const action = operations.actionById.get(block?.action) ?? operations.actionTypes[0];
    if (action.id === BOT_CODE_ACTIONS.NONE) return false;
    if (action.id === BOT_CODE_ACTIONS.VARIABLE) return true;
    if (actionSupportsTarget(action)
        && !(action.movementConfig && block.movementMode !== "target")
        && !(action.coordinateTarget && ["coordinates", "angle"].includes(block.targetMode))
        && !operations.resolveTarget(state, block.actionTarget)) return false;
    if (action.head === ACTION_HEADS.MOVEMENT || action.head === ACTION_HEADS.ROTATION) return true;
    const ability = operations.actionToAbility[action.id] ?? action.id;
    const equipped = state.player.abilities;
    if (Array.isArray(equipped) && equipped.length && !equipped.includes(ability)) return false;
    return abilityActionReady(state.player, ability);
}

export function abilityReady(bot, ability) {
    if (Number(bot?.preparingMs) > 0 && bot?.preparingAbility != null) {
        return false;
    }

    // Selection happens before this fixed step advances its timers. Do not
    // reserve the action for an ability whose recovery/reload ends later in
    // the step; a lower-priority action must be allowed to take over now.
    return abilityTimingReady(bot, ability, 0)
        && !anotherAbilityActive(bot, ability, abilityIgnoresGlobalLock(ability))
        && abilityRechargeRemainingMs(bot, ability) <= 0
        && (bot?.abilityCharges?.[ability] == null || Number(bot.abilityCharges[ability]) > 0);
}

// Conditions use abilityReady() to describe whether a new activation can
// start. Action selection also needs to keep an already-started wind-up or
// channelled ability selected until its execution phase completes.
export function abilityActionReady(bot, ability) {
    const abilityId = Number(ability);
    const preparingSameAbility = Number(bot?.preparingAbility) === abilityId
        && Number(bot?.preparingMs) > 0;
    const channelledSameAbility = abilityContract(abilityId)?.execution?.activationModel === "channelled"
        && abilityActiveMs(bot, abilityId) > 0;
    return preparingSameAbility || channelledSameAbility || abilityReady(bot, abilityId);
}

export function abilityCooldownMs(bot, ability) {
    if (Number(bot?.abilityActiveMs?.[ability]) > 0 || Number(bot?.preparingMs) > 0) {
        return 0;
    }

    return Math.max(
        Number(bot?.abilityCooldowns?.[ability]) || 0,
        abilityRechargeRemainingMs(bot, ability),
    );
}

export function abilityOnCooldown(bot, ability) {
    return abilityActiveMs(bot, ability) <= 0
        && Number(bot?.preparingMs) <= 0
        && abilityCooldownMs(bot, ability) > 0;
}

export function abilityActiveMs(bot, ability) {
    return Number(bot?.abilityActiveMs?.[ability]) || 0;
}

export function abilityCharges(bot, ability) {
    return abilityChargesFor(bot, ability);
}
