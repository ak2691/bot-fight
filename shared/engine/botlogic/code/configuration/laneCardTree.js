import { LANE_SECTIONS } from "./constants.js";

// Walks and rebuilds lanes cards with their follow-ups (Card.followUps). Shared by the engine's metrics and the
// editor's variable walkers, so every consumer sees a follow-up where it sees its parent. Attached movement
// (`move`, `face`) is not a card and is kept as written.

const followUpsOf = (card) => (Array.isArray(card?.followUps) ? card.followUps : []);

/** A card and every follow-up under it: the card first, then each follow-up's tree, in order. */
function cardTree(card) {
    return card ? [card, ...followUpsOf(card).flatMap(cardTree)] : [];
}

/** Every card of a lanes brain, follow-ups included, section by section. */
export function laneCards(configuration) {
    return LANE_SECTIONS.flatMap((section) => (Array.isArray(configuration?.[section]) ? configuration[section] : [])).flatMap(cardTree);
}

/**
 * Rebuilds a list of cards. `mapCard(card)` returns the replacement cards (an empty list removes the card, as
 * flatMap does); each replacement's follow-ups are rebuilt the same way, and `followUps` is left out when none remain.
 */
export function mapLaneCards(cards, mapCard) {
    return (Array.isArray(cards) ? cards : []).flatMap((card) => mapCard(card).map((next) => {
        const followUps = mapLaneCards(followUpsOf(next), mapCard);
        const { followUps: _previous, ...rest } = next;
        return followUps.length ? { ...rest, followUps } : rest;
    }));
}
