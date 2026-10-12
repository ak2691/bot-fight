import { abilityChargesFor, abilityReadyInMs, abilityRechargeRemainingMs, abilityTimingReady, anotherAbilityActive } from "../../../gameconfig/AbilityResourceSystem.js";
import { abilityChannel, notReadyWhileBlocked } from "../../../gameconfig/AbilityChannels.js";
import { activeRemainingMs, channelWindingUp, windupRemainingMs } from "../../../gameconfig/AbilityState.js";
import { abilityIdFromBoundary } from "../../../gameconfig/AbilityCompatibility.js";
import { ACTION_HEADS, BOT_CODE_ACTIONS } from "../contracts/BotLogicContracts.js";
import { abilityStaminaReady, canCancelWindup } from "../../../gameconfig/StaminaSystem.js";

export function actionSupportsTarget(action) {
    return Boolean(action.movementConfig)
        || action.id === BOT_CODE_ACTIONS.ROTATE_TOWARD_TARGET
        || Boolean(action.targetMode)
        || action.locationTarget === true;
}

/**
 * Actions that aim at a selected entity can carry the optional `aim` setting:
 * Rotate: Face Target and ability actions with a target (never movement).
 */
export function actionSupportsAim(action) {
    if (!action || action.movementConfig || action.variableAction) return false;
    if (action.id === BOT_CODE_ACTIONS.ROTATE_TOWARD_TARGET) return true;
    return action.head === ACTION_HEADS.ABILITY && (Boolean(action.targetMode) || action.locationTarget === true);
}

export function actionExecutableNow(block, state, operations) {
    const action = operations.actionById.get(block?.action) ?? operations.actionTypes[0];
    if (action.id === BOT_CODE_ACTIONS.NONE) return false;
    if (action.id === BOT_CODE_ACTIONS.VARIABLE) return true;
    // Chain control is instant bookkeeping: it always selects its block and uses no category.
    if (action.head === ACTION_HEADS.CHAIN) return true;
    if (actionSupportsTarget(action)
        && !(action.movementConfig && block.movementMode !== "target")
        && !(action.coordinateTarget && ["coordinates", "angle"].includes(block.targetMode))
        && !operations.resolveTarget(state, block.selectable)) return false;
    if (action.head === ACTION_HEADS.MOVEMENT || action.head === ACTION_HEADS.ROTATION) return true;
    // Cancel Wind-up has no ability or parameters. It is only executable while the bot is
    // winding up with enough stamina, so it does nothing (and selects nothing) otherwise.
    if (action.id === BOT_CODE_ACTIONS.CANCEL_WINDUP) return canCancelWindup(state.player);
    const ability = operations.actionToAbility[action.id] ?? action.id;
    const equipped = state.player.abilities;
    if (Array.isArray(equipped) && equipped.length && !equipped.includes(ability)) return false;
    return abilityActionReady(state.player, ability);
}

/** A wind-up in the ability's own channel hides its cooldown readout; another channel's wind-up never does. */
function windingUpBlocks(bot, abilityId) {
    return channelWindingUp(bot, abilityChannel(abilityId));
}

export function abilityReady(bot, ability) {
    const abilityId = abilityIdFromBoundary(ability);
    if (!botHasAbility(bot, abilityId)) return false;
    // Another ability's wind-up in this ability's channel stops it from starting; other channels never do.
    if (windingUpBlocks(bot, abilityId)) return false;
    // A block on the channel that reports it not ready (slow, for the dash channel).
    if (notReadyWhileBlocked(bot, abilityId)) return false;

    // Selection happens before this fixed step advances its timers. Do not
    // reserve the action for an ability whose recovery/reload ends later in
    // the step; a lower-priority action must be allowed to take over now.
    return abilityTimingReady(bot, abilityId, 0)
        && !anotherAbilityActive(bot, abilityId)
        && abilityRechargeRemainingMs(bot, abilityId) <= 0
        && abilityStaminaReady(bot, abilityId)
        && (bot?.abilityState?.[abilityId]?.charges == null || Number(bot.abilityState[abilityId].charges) > 0);
}

// Conditions use abilityReady() to describe whether a new activation can
// start. Action selection also needs to keep an already-started wind-up
// selected until its execution phase completes.
export function abilityActionReady(bot, ability) {
    const abilityId = abilityIdFromBoundary(ability);
    if (!botHasAbility(bot, abilityId)) return false;
    return windupRemainingMs(bot, abilityId) > 0 || abilityReady(bot, abilityId);
}

export function abilityCooldownMs(bot, ability) {
    const abilityId = abilityIdFromBoundary(ability);
    if (!botHasAbility(bot, abilityId)) return 0;
    if (activeRemainingMs(bot, abilityId) > 0 || windingUpBlocks(bot, abilityId)) {
        return 0;
    }
    // The longest of the cooldown, the reload and the time to afford the stamina cost.
    return abilityReadyInMs(bot, abilityId);
}

export function abilityOnCooldown(bot, ability) {
    const abilityId = abilityIdFromBoundary(ability);
    return botHasAbility(bot, abilityId)
        && abilityActiveMs(bot, abilityId) <= 0
        && !windingUpBlocks(bot, abilityId)
        && abilityCooldownMs(bot, abilityId) > 0;
}

export function abilityActiveMs(bot, ability) {
    const abilityId = abilityIdFromBoundary(ability);
    return botHasAbility(bot, abilityId) ? activeRemainingMs(bot, abilityId) : 0;
}

export function abilityCharges(bot, ability) {
    const abilityId = abilityIdFromBoundary(ability);
    return botHasAbility(bot, abilityId) ? abilityChargesFor(bot, abilityId) : 0;
}

export function botHasAbility(bot, ability) {
    const abilityId = abilityIdFromBoundary(ability);
    return abilityId != null
        && Array.isArray(bot?.abilities)
        && bot.abilities.some((candidate) => abilityIdFromBoundary(candidate) === abilityId);
}
