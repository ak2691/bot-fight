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

export function selectableIdentitiesForAbilityEntity(entity, abilityId = entity?.abilityId) {
    if (!entity) return Object.freeze([]);
    return Object.freeze([
        SELECTABLE_IDENTITIES.ABILITY_ENTITY,
        SELECTABLE_IDENTITIES.POSITION,
        ...(entity.health && entity.collider?.hittable ? [SELECTABLE_IDENTITIES.HEALTH] : []),
        ...([17, 31].includes(Number(abilityId)) ? [SELECTABLE_IDENTITIES.FACING, SELECTABLE_IDENTITIES.MOVEMENT] : []),
    ]);
}

export function selectableHasIdentity(selectable, identity) {
    return Array.isArray(selectable?.selectableIdentities) && selectable.selectableIdentities.includes(identity);
}
