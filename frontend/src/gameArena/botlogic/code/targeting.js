export function resolveAbilityStrategyTarget(state, target) {
    const [baseTarget, order = "closest", ordinalText = "1"] = String(target ?? "opponent").split(":");
    if (baseTarget !== target) {
        const candidates = matchingStrategyTargets(state, baseTarget);
        const ordinal = Math.max(1, Math.min(100, Number(ordinalText) || 1));
        candidates.sort(targetOrderComparator(order, state?.player));
        return candidates[ordinal - 1] ?? null;
    }
    if (target === "opponent") return state?.opponent ?? null;
    if (target === "opponent_grenade") return (state?.objects ?? []).find((object) => (
        object?.type === "grenade" && object.ownerId && object.ownerId === state?.opponent?.id
    )) ?? null;
    if (target === "opponent_fireball") return closestOwnedObject(state, "fireball", state?.opponent);
    if (target === "orbital_zone") return closestObject(state, "orbitalMarker");

    const typeByTarget = {
        opponent_concussive_shot: "concussiveShot",
        opponent_proximity_mine: "proximityMine",
        opponent_gravity_field: "gravityField",
        opponent_hunter_drone: "hunterDrone",
        opponent_orbital_zone: "orbitalMarker",
        opponent_null_zone: "nullZone",
        opponent_silence_wave: "silenceWave",
        opponent_temporal_rewind_zone: "temporalRewindZone",
        my_grenade: "grenade",
        my_fireball: "fireball",
        my_concussive_shot: "concussiveShot",
        my_proximity_mine: "proximityMine",
        my_gravity_field: "gravityField",
        my_hunter_drone: "hunterDrone",
        my_orbital_zone: "orbitalMarker",
        my_null_zone: "nullZone",
        my_silence_wave: "silenceWave",
        my_temporal_rewind_zone: "temporalRewindZone",
    };
    if (typeByTarget[target]) {
        const owner = target.startsWith("my_") ? state?.player : state?.opponent;
        return closestOwnedObject(state, typeByTarget[target], owner);
    }
    return (state?.objects ?? []).find((object) => object?.id === target) ?? null;
}

function closestObject(state, type) {
    return (state?.objects ?? [])
        .filter((object) => object?.type === type)
        .sort((first, second) => distanceBetween(state?.player, first) - distanceBetween(state?.player, second))[0] ?? null;
}

function closestOwnedObject(state, type, owner) {
    return (state?.objects ?? [])
        .filter((object) => object?.type === type && (object.ownerId === owner?.id || object.ownerSlot === owner?.slot))
        .sort((first, second) => distanceBetween(state?.player, first) - distanceBetween(state?.player, second))[0] ?? null;
}

export function matchingStrategyTargets(state, target) {
    const base = String(target ?? "").split(":")[0];
    if (base === "opponent") return state?.opponent ? [state.opponent] : [];
    const typeByTarget = {
        orbital_zone: "orbitalMarker", opponent_grenade: "grenade", opponent_fireball: "fireball",
        opponent_concussive_shot: "concussiveShot", opponent_proximity_mine: "proximityMine",
        opponent_gravity_field: "gravityField", opponent_hunter_drone: "hunterDrone",
        opponent_orbital_zone: "orbitalMarker", opponent_null_zone: "nullZone", opponent_temporal_rewind_zone: "temporalRewindZone",
        opponent_silence_wave: "silenceWave", my_grenade: "grenade", my_fireball: "fireball", my_concussive_shot: "concussiveShot",
        my_proximity_mine: "proximityMine", my_gravity_field: "gravityField", my_hunter_drone: "hunterDrone",
        my_orbital_zone: "orbitalMarker", my_null_zone: "nullZone", my_silence_wave: "silenceWave", my_temporal_rewind_zone: "temporalRewindZone",
    };
    const type = typeByTarget[base];
    if (!type) return [];
    const own = base.startsWith("my_");
    return (state?.objects ?? []).filter((object) => object?.type === type && (base === "orbital_zone" || (own
        ? object.ownerId === state?.player?.id || object.ownerSlot === state?.player?.slot
        : object.ownerId === state?.opponent?.id || object.ownerSlot === state?.opponent?.slot)));
}

function targetOrderComparator(order, player) {
    if (order === "oldest" || order === "newest") return (a, b) => {
        const compared = String(a.id ?? "").localeCompare(String(b.id ?? ""));
        return order === "oldest" ? compared : -compared;
    };
    return (a, b) => (order === "farthest" ? -1 : 1) * (distanceBetween(player, a) - distanceBetween(player, b));
}

function distanceBetween(first, second) {
    if (!first || !second) return Number.POSITIVE_INFINITY;
    return Math.hypot(second.x - first.x, second.y - first.y);
}
