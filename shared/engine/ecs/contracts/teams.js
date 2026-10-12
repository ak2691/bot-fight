import { isEntityShape, ownerBot } from "../entities/EntityCombat.js";

/**
 * Whether two combat shapes, bots or arena entities, are on opposing sides. Every shape is a side of
 * { team, slot, id }: an entity takes its owner's team and id (the owner bot in `bots`, else the entity's own
 * owner fields). Two sides with the same id are never enemies. Two sides with a team each are enemies when the
 * teams differ; otherwise they are enemies when the slots differ.
 */
export function areEnemies(a, b, bots = []) {
    if (!a || !b) return false;
    const first = sideOf(a, bots);
    const second = sideOf(b, bots);
    if (first.id != null && first.id === second.id) return false;
    const firstTeam = Number(first.team);
    const secondTeam = Number(second.team);
    if (Number.isFinite(firstTeam) && Number.isFinite(secondTeam) && firstTeam > 0 && secondTeam > 0) {
        return firstTeam !== secondTeam;
    }
    return Number(first.slot) !== Number(second.slot);
}

function sideOf(shape, bots) {
    if (isEntityShape(shape)) {
        const owner = ownerBot(bots ?? [], shape);
        return { team: owner?.teamNumber ?? shape.ownerTeam, slot: shape.ownerSlot, id: owner?.id ?? shape.ownerId };
    }
    // A bot has a team, a slot and an id. A status tick names only its ownerSlot, so the owner fields are the fallback.
    return { team: shape.teamNumber ?? shape.ownerTeam, slot: shape.slot ?? shape.ownerSlot, id: shape.id };
}
