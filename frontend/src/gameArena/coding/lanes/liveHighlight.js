// The live highlight's id sets (mockup 1b), from the practice room's preview of the bot. `strong` holds every card that
// acted this tick (the winners, which include an ability card whose attached movement won) and the running combo step.
// `faint` holds the ancestors of the combo step, so the whole combo path shows. Pure: the board paints from these sets.
import { LANE_SECTIONS } from "../../../../../shared/engine/botlogic/code/configuration/constants.js";

/** Every winning card id in a live snapshot: Move, Face, the action and every card that ran in Variables. */
export function winnerIdsOf(live) {
    const ids = new Set();
    for (const value of Object.values(live?.winners ?? {})) {
        if (Array.isArray(value)) value.forEach((id) => ids.add(id));
        else if (value) ids.add(value);
    }
    return ids;
}

/** The ids of the cards above a card (its parents, nearest last), searched in every mode and the shared set. */
export function ancestorIdsOf(configuration, cardId) {
    if (cardId == null) return [];
    for (const set of [...(configuration.modes ?? []), configuration.shared ?? {}]) {
        for (const section of LANE_SECTIONS) {
            const path = pathTo(set[section] ?? [], cardId, []);
            if (path) return path;
        }
    }
    return [];
}

function pathTo(cards, cardId, ancestors) {
    for (const card of cards) {
        if (card.id === cardId) return ancestors;
        const found = pathTo(card.followUps ?? [], cardId, [...ancestors, card.id]);
        if (found) return found;
    }
    return null;
}

/** `{ strong, faint }`: the bar sets for the cards on the board. A card that is both is strong. */
export function liveHighlightSets(live, configuration) {
    const strong = winnerIdsOf(live);
    const step = live?.comboStepId ?? null;
    if (step != null) strong.add(step);
    const faint = new Set(step != null ? ancestorIdsOf(configuration, step) : []);
    for (const id of strong) faint.delete(id);
    return { strong, faint };
}
