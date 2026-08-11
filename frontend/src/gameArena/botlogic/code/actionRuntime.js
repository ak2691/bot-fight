export function actionSupportsTarget(action) {
    return Boolean(action.movementConfig)
        || action.id === "rotate_toward_enemy"
        || action.id === 20
        || action.locationTarget === true;
}

export function actionExecutableNow(block, state, operations) {
    const action = operations.actionById.get(block?.action) ?? operations.actionTypes[0];
    if (action.id === "none") return false;
    if (action.id === "variable") return true;
    if (actionSupportsTarget(action)
        && !(action.movementConfig && block.movementMode !== "target")
        && !(action.coordinateTarget && block.targetMode === "coordinates")
        && !operations.resolveTarget(state, block.actionTarget)) return false;
    if (action.head === "movement" || action.head === "rotation") return true;
    const ability = operations.actionToAbility[action.id] ?? action.id;
    const equipped = state.player.abilities;
    if (Array.isArray(equipped) && equipped.length && !equipped.includes(ability)) return false;
    return abilityReady(state.player, ability);
}

export function abilityReady(bot, ability) {
    const legacyReadiness = {
        1: bot?.swingAvailable, 2: bot?.blockAvailable,
        3: bot?.gunAvailable, 4: bot?.grenadeAvailable,
        5: bot?.fireballAvailable, 6: bot?.stunAvailable,
    };
    if (ability in legacyReadiness) return Boolean(legacyReadiness[ability]);
    return Number(bot?.abilityCooldowns?.[ability] ?? 0) <= 0
        && (bot?.abilityCharges?.[ability] == null || Number(bot.abilityCharges[ability]) > 0);
}

export function abilityCooldownMs(bot, ability) {
    const legacyCooldowns = {
        1: bot?.swingCooldownRemainingMs, 2: bot?.blockCooldownRemainingMs,
        3: bot?.gunCooldownRemainingMs, 4: bot?.grenadeCooldownRemainingMs,
        5: bot?.fireballCooldownRemainingMs, 6: bot?.stunCooldownRemainingMs,
    };
    return Number(ability in legacyCooldowns ? legacyCooldowns[ability] : bot?.abilityCooldowns?.[ability]) || 0;
}

export function abilityAmmo(bot, ability) {
    const legacyCharges = {
        2: bot?.blockCharges,
        3: bot?.gunAmmo,
        5: bot?.fireballCharges,
    };
    return Number(legacyCharges[ability] ?? bot?.abilityCharges?.[ability] ?? 0);
}
