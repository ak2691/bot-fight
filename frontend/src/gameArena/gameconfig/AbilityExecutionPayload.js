import { ABILITY_STATS } from "./Abilities.js";
import { abilityContract } from "./AbilityContracts.js";
import { abilityId as resolveAbilityId } from "./AbilityRegistry.js";

const EMPTY_EXECUTION = Object.freeze({});

/**
 * Builds the allowlisted runtime payload consumed by arena execution systems.
 *
 * The authored action remains a small stable ID. The runtime receives this
 * payload so systems can apply the declared activation/resource behavior
 * without branching on individual ability IDs.
 */
export function abilityExecutionPayload(value) {
    if (isExecutionPayload(value)) return value;

    const rawId = value && typeof value === "object"
        ? value.abilityId ?? value.actionId ?? value.action
        : value;
    const abilityId = resolveAbilityId(rawId);
    if (abilityId == null) return null;

    const contract = abilityContract(abilityId);
    if (!contract) return null;

    return Object.freeze({
        actionId: abilityId,
        abilityId,
        stats: ABILITY_STATS[abilityId] ?? Object.freeze({}),
        contract,
        execution: contract.execution ?? EMPTY_EXECUTION,
    });
}

function isExecutionPayload(value) {
    const abilityId = resolveAbilityId(value?.abilityId);
    return Boolean(value
        && typeof value === "object"
        && Number.isSafeInteger(value.actionId)
        && Number.isSafeInteger(value.abilityId)
        && abilityId === value.actionId
        && value.contract === abilityContract(abilityId)
        && value.stats === ABILITY_STATS[abilityId]
        && value.execution === value.contract.execution);
}
