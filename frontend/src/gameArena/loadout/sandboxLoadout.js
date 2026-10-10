import { SELECTABLE_BOT_ABILITIES, decodeBotLoadout, decodeSandboxLoadout, normalizedSandboxLoadout } from "../../../../shared/engine/loadout/BotLoadout.js";

export function loadoutDraftForEntry(entry) {
    const supplied = entry?.loadout;
    if (supplied && typeof supplied === "object") return normalizedSandboxLoadout(supplied);
    const encoded = String(supplied ?? "");
    const source = encoded.startsWith("sandbox:")
        ? decodeSandboxLoadout(encoded)
        : decodeBotLoadout(encoded);
    return normalizedSandboxLoadout(source);
}

export function loadoutDraftsForRoster(roster) {
    return Object.fromEntries((roster ?? []).map((entry) => [entry.key, loadoutDraftForEntry(entry)]));
}

/** The practice loadout holds one weapon (Slash unless another is picked) plus up to six abilities. */
export const SANDBOX_DEFAULT_WEAPON_ID = 1;
export const SANDBOX_MAX_ABILITY_PICKS = 6;

const WEAPON_IDS = new Set(SELECTABLE_BOT_ABILITIES.filter((ability) => ability.category === "weapon").map((ability) => ability.id));

export function sandboxWeaponId(loadout) {
    return normalizedSandboxLoadout(loadout).abilities.find((id) => WEAPON_IDS.has(id)) ?? SANDBOX_DEFAULT_WEAPON_ID;
}

export function sandboxAbilityPicks(loadout) {
    return normalizedSandboxLoadout(loadout).abilities.filter((id) => !WEAPON_IDS.has(id));
}

/** Weapon first, then the abilities in the order they were picked. */
export function sandboxLoadoutWithWeapon(loadout) {
    return normalizedSandboxLoadout({ abilities: [sandboxWeaponId(loadout), ...sandboxAbilityPicks(loadout)] });
}

export function toggleSandboxAbility(loadout, abilityId) {
    const current = sandboxLoadoutWithWeapon(loadout);
    if (WEAPON_IDS.has(abilityId)) {
        return normalizedSandboxLoadout({ abilities: [abilityId, ...sandboxAbilityPicks(current)] });
    }
    const picks = sandboxAbilityPicks(current);
    const next = picks.includes(abilityId)
        ? picks.filter((id) => id !== abilityId)
        : picks.length < SANDBOX_MAX_ABILITY_PICKS ? [...picks, abilityId] : picks;
    return normalizedSandboxLoadout({ abilities: [sandboxWeaponId(current), ...next] });
}
