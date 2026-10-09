/** `kind` of an arena entity (a projectile, trap, zone or summon). Bots have `kind: "bot"` (see botState.js). */
export const ENTITY_KIND = "entity";

/** True for an arena entity. Everything else that takes part in combat is a bot. */
export function isEntityShape(shape) {
    return shape?.kind === ENTITY_KIND;
}

export function ownerBot(bots, entity) {
    return bots.find((bot) => bot.id === entity?.ownerId
        || (Number.isFinite(Number(entity?.ownerSlot)) && Number(bot.slot) === Number(entity.ownerSlot)));
}
