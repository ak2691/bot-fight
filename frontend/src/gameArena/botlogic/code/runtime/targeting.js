import {
    BOT_CODE_SELECTABLES,
    SELECTABLE_BY_ID,
    SELECTABLE_ORDERS,
    SELECTABLE_OWNERS,
} from "../contracts/BotLogicContracts.js";

export function resolveAbilityStrategySelectable(state, selectableId) {
    const [baseSelectable, order = SELECTABLE_ORDERS[0], ordinalText = "1"] = String(selectableId ?? BOT_CODE_SELECTABLES.OPPONENT).split(":");
    if (baseSelectable !== selectableId) {
        const candidates = matchingStrategySelectables(state, baseSelectable);
        const ordinal = Math.max(1, Math.min(100, Number(ordinalText) || 1));
        candidates.sort(selectableOrderComparator(order, state?.player));
        return candidates[ordinal - 1] ?? null;
    }

    const selectableContract = SELECTABLE_BY_ID.get(baseSelectable);
    if (selectableContract?.kind === "bot") {
        return selectableContract.owner === SELECTABLE_OWNERS.MY ? state?.player ?? null : state?.opponent ?? null;
    }
    if (selectableContract?.kind === "entity") {
        return objectsForSelectable(state, selectableContract)
            .sort(selectableOrderComparator(SELECTABLE_ORDERS[0], state?.player))[0] ?? null;
    }
    return (state?.objects ?? []).find((object) => object?.id === selectableId) ?? null;
}

export function matchingStrategySelectables(state, selectableId) {
    const base = String(selectableId ?? "").split(":")[0];
    const selectableContract = SELECTABLE_BY_ID.get(base);
    if (selectableContract?.kind === "bot") {
        const bot = selectableContract.owner === SELECTABLE_OWNERS.MY ? state?.player : state?.opponent;
        return bot ? [bot] : [];
    }
    if (selectableContract?.kind !== "entity") return [];
    return objectsForSelectable(state, selectableContract);
}

function objectsForSelectable(state, selectableContract) {
    const objects = state?.objects ?? [];
    const abilityId = Number(selectableContract.abilityId);
    const isSelectableAbility = (object) => Number(object?.abilityId ?? object?.entityContractId) === abilityId;
    if (selectableContract.owner === SELECTABLE_OWNERS.NONE) {
        return objects.filter((object) => object?.type === selectableContract.runtimeType && isSelectableAbility(object));
    }
    const owner = selectableContract.owner === SELECTABLE_OWNERS.MY ? state?.player : state?.opponent;
    return objects.filter((object) => object?.type === selectableContract.runtimeType
        && isSelectableAbility(object)
        && (object.ownerId === owner?.id || object.ownerSlot === owner?.slot));
}

function selectableOrderComparator(order, player) {
    if (order === "oldest" || order === "newest") return (a, b) => {
        const ageA = Number(a.ageMs);
        const ageB = Number(b.ageMs);
        if (Number.isFinite(ageA) && Number.isFinite(ageB) && ageA !== ageB) {
            return order === "oldest" ? ageB - ageA : ageA - ageB;
        }
        const serialA = entitySerial(a);
        const serialB = entitySerial(b);
        if (Number.isFinite(serialA) && Number.isFinite(serialB) && serialA !== serialB) {
            return order === "oldest" ? serialA - serialB : serialB - serialA;
        }
        const compared = String(a.id ?? "").localeCompare(String(b.id ?? ""));
        return order === "oldest" ? compared : -compared;
    };
    return (a, b) => (order === "farthest" ? -1 : 1) * (distanceBetween(player, a) - distanceBetween(player, b));
}

function distanceBetween(first, second) {
    if (!first || !second) return Number.POSITIVE_INFINITY;
    return Math.hypot(second.x - first.x, second.y - first.y);
}

function entitySerial(entity) {
    const match = String(entity?.id ?? "").match(/-(\d+)$/);
    return match ? Number(match[1]) : Number.NaN;
}
