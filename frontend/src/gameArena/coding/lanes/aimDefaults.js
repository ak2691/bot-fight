// The default aim of a new ability card (docs/LANES.md "Aim"). An ability that aims at an entity and fires a projectile
// defaults to Auto, which leads by the wind-up left plus the travel time (aimPrediction.js). Melee, hitscan and
// movement abilities keep the plain Current aim, so no aim fields are stored for them. Pure.
import { ACTION_HEADS } from "../../../../../shared/engine/botlogic/code/contracts/BotLogicContracts.js";
import { actionSupportsAim } from "../../../../../shared/engine/botlogic/code/runtime/actionRuntime.js";
import { projectileSpeedPerSecond } from "../../../../../shared/engine/botlogic/planner/aimPrediction.js";
import { abilityDefinition } from "../../../../../shared/engine/loadout/BotLoadout.js";

/** The aim fields a new action entry gets for this action definition: `{ aim: "auto", leadAbilityId }` or `{}`. */
export function defaultAimFields(definition) {
    if (!definition || definition.head !== ACTION_HEADS.ABILITY || definition.abilityId == null) return {};
    if (!actionSupportsAim(definition)) return {};
    if (!(projectileSpeedPerSecond(definition.abilityId) > 0)) return {};
    return { aim: "auto", leadAbilityId: definition.abilityId };
}

/** Whether an ability fires a projectile (a shot that travels, so Auto can lead it). */
export function isProjectileAbility(abilityId) {
    return abilityId != null && projectileSpeedPerSecond(abilityId) > 0;
}

/** Auto's ability choices for a Face action: the loadout's projectile abilities, in loadout order, named. */
export function leadAbilityChoices(loadoutAbilityIds = []) {
    return loadoutAbilityIds
        .filter(isProjectileAbility)
        .map((id) => ({ id, label: abilityDefinition(id)?.label ?? String(id) }));
}

/** The ability Auto leads with by default: the card's own ability when it is a projectile, else the first choice. */
export function defaultLeadAbilityId(cardAbilityId, choices = []) {
    if (isProjectileAbility(cardAbilityId)) return cardAbilityId;
    return choices[0]?.id ?? null;
}

/**
 * The aim fields a Face action gets when it is attached to an ability card: Auto on that ability when it is a projectile
 * ("Fireball ＋ Face enemy" aims ahead by itself). Any other card keeps Current, so `{}`.
 */
export function attachedFaceAimFields(cardAbilityId) {
    return isProjectileAbility(cardAbilityId) ? { aim: "auto", leadAbilityId: cardAbilityId } : {};
}
