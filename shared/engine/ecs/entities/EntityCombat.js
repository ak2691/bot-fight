/** Applies damage through the shared combat contract, including reflection. */
export function applyEntityDamage(bots, targetIndex, entity, damage, combat) {
    const target = bots[targetIndex];
    const owner = ownerBot(bots, entity);
    const ownerIndex = owner ? bots.findIndex((bot) => bot.id === owner.id) : -1;
    if (ownerIndex >= 0 && ownerIndex !== targetIndex && typeof combat.applyDamageFromShapes === "function") {
        const nextBots = [...bots];
        [nextBots[ownerIndex], nextBots[targetIndex]] = combat.applyDamageFromShapes(owner, target, damage, entity);
        return nextBots;
    }
    return bots.map((bot, index) => index === targetIndex
        ? combat.applyDamageToShape(bot, damage, owner ?? entity)
        : bot);
}

export function ownerBot(bots, entity) {
    return bots.find((bot) => bot.id === entity?.ownerId
        || (Number.isFinite(Number(entity?.ownerSlot)) && Number(bot.slot) === Number(entity.ownerSlot)));
}
