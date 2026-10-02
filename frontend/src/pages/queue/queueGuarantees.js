import { ALL_ABILITY_DEFINITIONS } from "../../gameArena/loadout/BotLoadout.js";

export const GUARANTEE_ROUNDS = [1, 2, 3];

export function abilityForRound(values, round) {
    const abilityId = Number(values?.[round - 1]);
    if (!Number.isInteger(abilityId)) return null;
    return ALL_ABILITY_DEFINITIONS.find((ability) => (
        ability.id === abilityId && ability.round === round
    )) ?? null;
}

// "Grenade (R1), random (R2), random (R3)" for the searching state.
export function guaranteeSummary(values) {
    return GUARANTEE_ROUNDS
        .map((round) => `${abilityForRound(values, round)?.label ?? "random"} (R${round})`)
        .join(", ");
}
