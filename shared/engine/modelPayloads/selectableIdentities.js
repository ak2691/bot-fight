import { ENTITY_CATEGORIES, entityCategoryOf, isAttachedEntity, phaseForEntity } from "../ecs/contracts/AbilityContracts.js";

export const SELECTABLE_IDENTITIES = Object.freeze({
    BOT: "bot",
    ABILITY_ENTITY: "ability-entity",
    POSITION: "position",
    HEALTH: "health",
    FACING: "facing",
    MOVEMENT: "movement",
});

export const BOT_SELECTABLE_IDENTITIES = Object.freeze([
    SELECTABLE_IDENTITIES.BOT,
    SELECTABLE_IDENTITIES.POSITION,
    SELECTABLE_IDENTITIES.HEALTH,
    SELECTABLE_IDENTITIES.FACING,
    SELECTABLE_IDENTITIES.MOVEMENT,
]);

export const SELECTABLE_DEPENDENCIES = Object.freeze({
    ABILITY_LOADOUT: "ability-loadout",
    STATUS_EFFECT_LOADOUT: "status-effect-loadout",
});

/**
 * The identities a brain can select on an ability entity. A summon can be aimed and moved, so it has facing and
 * movement. An attached entity is part of its owner's attack, so no brain selects it: it has none.
 */
export function selectableIdentitiesForAbilityEntity(entity) {
    if (!entity || isAttachedEntity(entity)) return Object.freeze([]);
    const hasHealth = Boolean(phaseForEntity(entity)?.health);
    const summon = entityCategoryOf(entity) === ENTITY_CATEGORIES.SUMMON;
    return Object.freeze([
        SELECTABLE_IDENTITIES.ABILITY_ENTITY,
        SELECTABLE_IDENTITIES.POSITION,
        ...(hasHealth ? [SELECTABLE_IDENTITIES.HEALTH] : []),
        ...(summon ? [SELECTABLE_IDENTITIES.FACING, SELECTABLE_IDENTITIES.MOVEMENT] : []),
    ]);
}

export function selectableHasIdentity(selectable, identity) {
    return Array.isArray(selectable?.selectableIdentities) && selectable.selectableIdentities.includes(identity);
}
