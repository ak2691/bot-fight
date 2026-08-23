import {
    BOT_CODE_TARGETS,
    TARGET_BY_ID,
    TARGET_ORDERS,
    TARGET_OWNERS,
} from "../contracts/BotLogicContracts.js";

export function resolveAbilityStrategyTarget(state, target) {
    const [baseTarget, order = TARGET_ORDERS[0], ordinalText = "1"] = String(target ?? BOT_CODE_TARGETS.OPPONENT).split(":");
    if (baseTarget !== target) {
        const candidates = matchingStrategyTargets(state, baseTarget);
        const ordinal = Math.max(1, Math.min(100, Number(ordinalText) || 1));
        candidates.sort(targetOrderComparator(order, state?.player));
        return candidates[ordinal - 1] ?? null;
    }

    const targetContract = TARGET_BY_ID.get(baseTarget);
    if (targetContract?.kind === "bot") return state?.opponent ?? null;
    if (targetContract?.kind === "entity") {
        return objectsForTarget(state, targetContract)
            .sort(targetOrderComparator(TARGET_ORDERS[0], state?.player))[0] ?? null;
    }
    return (state?.objects ?? []).find((object) => object?.id === target) ?? null;
}

export function matchingStrategyTargets(state, target) {
    const base = String(target ?? "").split(":")[0];
    const targetContract = TARGET_BY_ID.get(base);
    if (targetContract?.kind === "bot") return state?.opponent ? [state.opponent] : [];
    if (targetContract?.kind !== "entity") return [];
    return objectsForTarget(state, targetContract);
}

function objectsForTarget(state, targetContract) {
    const objects = state?.objects ?? [];
    const abilityId = Number(targetContract.abilityId);
    const isTargetAbility = (object) => Number(object?.abilityId ?? object?.entityContractId) === abilityId;
    if (targetContract.owner === TARGET_OWNERS.NONE) {
        return objects.filter((object) => object?.type === targetContract.runtimeType && isTargetAbility(object));
    }
    const owner = targetContract.owner === TARGET_OWNERS.MY ? state?.player : state?.opponent;
    return objects.filter((object) => object?.type === targetContract.runtimeType
        && isTargetAbility(object)
        && (object.ownerId === owner?.id || object.ownerSlot === owner?.slot));
}

function targetOrderComparator(order, player) {
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
