import { GAMEPLAY_DATA } from "./gameplayData.js";

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

/** The status ids that stop a channel's abilities from starting (and cancel their wind-up). */
export function channelBlockingStatuses(channelId) {
    return GAMEPLAY_DATA.channels.channels[channelId]?.blockedByStatuses ?? [];
}

/** The blocking statuses that also report the channel's abilities as not ready (so a brain falls through). */
export function channelNotReadyStatuses(channelId) {
    return GAMEPLAY_DATA.channels.channels[channelId]?.notReadyWhileStatuses ?? [];
}
