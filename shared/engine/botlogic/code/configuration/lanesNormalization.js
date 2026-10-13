import { BOT_LOGIC_LANES_VERSION, LANE_SECTIONS } from "./constants.js";

/**
 * Normalizes a lanes brain (bot-logic-lanes-v1). Conditions and actions go through the tree's own normalizers
 * (`operations`), so every reading, target and setting means the same in both formats.
 *
 * Nothing is cut here: bounds (modes, cards, conditions) and section membership are validation errors in
 * brainRules.js, so a hostile or oversized brain is reported instead of silently shortened. Ids are kept as written;
 * a missing id takes a positional fallback, so an id stays the same through normalization and the editor can
 * highlight a card. Empty sections and switches are omitted, and a card carries `enabled: false` only when it is
 * switched off. `followUps`, `move` and `face` are written only when present.
 *
 * `operations`: normalizeCustomVariables, customVariablesWithReferencedActions, normalizeConditions(conditions,
 * customVariables), normalizeActionEntry(entry) (one action with no entry identity, the NONE action when invalid).
 */
export function normalizeLanesConfiguration(configuration, operations) {
    const customVariables = operations.normalizeCustomVariables(operations.customVariablesWithReferencedActions(configuration));
    const conditionsOf = (conditions) => (Array.isArray(conditions) ? operations.normalizeConditions(conditions, customVariables) : []);

    const normalizeSwitches = (switches, scope) => (Array.isArray(switches) ? switches : []).map((entry, index) => ({
        id: stableId(entry?.id, `switch-${scope}-${index + 1}`),
        to: String(entry?.to ?? "").trim(),
        conditions: conditionsOf(entry?.conditions),
    }));

    const normalizeCard = (card, fallbackId) => {
        const id = stableId(card?.id, fallbackId);
        const followUps = Array.isArray(card?.followUps) ? card.followUps : [];
        return {
            id,
            conditions: conditionsOf(card?.conditions),
            action: operations.normalizeActionEntry(card?.action),
            ...(card?.enabled === false ? { enabled: false } : {}),
            ...(followUps.length ? { followUps: followUps.map((follow, index) => normalizeCard(follow, `${id}-follow-up-${index + 1}`)) } : {}),
            ...(card?.move != null ? { move: operations.normalizeActionEntry(card.move) } : {}),
            ...(card?.face != null ? { face: operations.normalizeActionEntry(card.face) } : {}),
        };
    };

    const normalizeSections = (set, scope) => {
        const normalized = {};
        for (const section of LANE_SECTIONS) {
            const cards = Array.isArray(set?.[section]) ? set[section] : [];
            if (cards.length === 0) continue;
            normalized[section] = cards.map((card, index) => normalizeCard(card, `card-${scope}-${section}-${index + 1}`));
        }
        return normalized;
    };

    const normalizeSet = (set, scope) => {
        const switches = normalizeSwitches(set?.switches, scope);
        return {
            ...(switches.length ? { switches } : {}),
            ...normalizeSections(set, scope),
        };
    };

    const modes = (Array.isArray(configuration?.modes) ? configuration.modes : []).map((mode, index) => {
        const id = stableId(mode?.id, `mode-${index + 1}`);
        return {
            id,
            name: String(mode?.name ?? "").trim().replace(/\s+/g, " "),
            ...normalizeSet(mode, id),
        };
    });

    return {
        version: BOT_LOGIC_LANES_VERSION,
        modes,
        shared: normalizeSet(configuration?.shared, "shared"),
        customVariables,
    };
}

function stableId(value, fallback) {
    const id = String(value ?? "").trim();
    return id || fallback;
}
