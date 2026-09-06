import { ABILITY_STATS } from "./Abilities.js";
import { attachedAbilityContract } from "./AttachedAbilityContracts.js";
import { abilityId as resolveAbilityId } from "./AbilityRegistry.js";
import { entityContractForAbility } from "../ecs/contracts/EntityContracts.js";

const EMPTY_ACTIVATION = Object.freeze({});

/**
 * Builds the allowlisted runtime payload consumed by arena execution systems.
 *
 * The authored action remains a small stable ID. The runtime receives this
 * payload so systems can apply the phase behavior without branching on
 * individual ability IDs. Entity abilities use their entity contract here;
 * attached abilities use their attached contract.
 */
export function abilityExecutionPayload(value) {
    if (isExecutionPayload(value)) return value;

    const rawId = value && typeof value === "object"
        ? value.abilityId ?? value.actionId ?? value.action
        : value;
    const abilityId = resolveAbilityId(rawId);
    if (abilityId == null) return null;

    const contract = attachedAbilityContract(abilityId) ?? entityContractForAbility(abilityId);
    if (!contract) return null;

    return Object.freeze({
        actionId: abilityId,
        abilityId,
        stats: ABILITY_STATS[abilityId] ?? Object.freeze({}),
        contract,
        activation: contract.activation ?? EMPTY_ACTIVATION,
    });
}

function isExecutionPayload(value) {
    const abilityId = resolveAbilityId(value?.abilityId);
    return Boolean(value
        && typeof value === "object"
        && Number.isSafeInteger(value.actionId)
        && Number.isSafeInteger(value.abilityId)
        && abilityId === value.actionId
        && value.contract === (attachedAbilityContract(abilityId) ?? entityContractForAbility(abilityId))
        && value.stats === ABILITY_STATS[abilityId]
        && value.activation === (value.contract.activation ?? EMPTY_ACTIVATION));
}
