import { GAMEPLAY_DATA } from "./gameplayData.js";
import { blockedActions } from "../ecs/contracts/StatusContracts.js";

export const DASH_CHANNEL = "dash";

const ABILITY_DATA_BY_ID = Object.freeze(Object.fromEntries(GAMEPLAY_DATA.abilities.abilities.map(
    ({ id, channel, cost }) => [id, Object.freeze({ channel, staminaCost: cost?.stamina ?? 0 })],
)));

/** The channel id of an ability, or null for an unknown ability. */
export function abilityChannel(abilityId) {
    return ABILITY_DATA_BY_ID[Number(abilityId)]?.channel ?? null;
}

/** Stamina an activation pays; 0 for an ability with no cost. */
export function abilityStaminaCost(abilityId) {
    return ABILITY_DATA_BY_ID[Number(abilityId)]?.staminaCost ?? 0;
}

/**
 * True when a block on the ability's channel makes the ability read as not ready, so a brain falls through (the
 * dash shows not ready while slowed). Only `block` effects count here: a stun is not a block on a channel.
 */
export function notReadyWhileBlocked(shape, abilityId) {
    const channel = abilityChannel(abilityId);
    return GAMEPLAY_DATA.channels.channels[channel]?.notReadyWhileBlocked === true && blockedActions(shape).has(channel);
}
