import {
    BLOCK_RECHARGE_MS,
    BASE_FIGHTER_HP,
    RANGED_AMMO_MAX,
    FIREBALL_CHARGES_MAX,
} from "../combat/Moves.js";

export function buildStatePayload(currentShapes, selectedLoadout, actorId = "main") {
    const main = currentShapes.find((shape) => shape.id === actorId);
    return {
        selectedLoadout,
        playerModel: fighterPayload(main, selectedLoadout),
        objects: currentShapes
            .filter((shape) => shape.id !== actorId)
            .map((shape) => objectPayload(shape, actorId)),
    };
}

function fighterPayload(shape, selectedLoadout) {
    const combatLoadout = shape.combatLoadout ?? selectedLoadout;
    return {
        id: shape.id,
        type: "model",
        ownerId: shape.id,
        abilities: [...(shape.abilities ?? [])],
        x: Math.round(shape.x),
        y: Math.round(shape.y),
        rotation: Math.round(shape.rotation ?? 0),
        swingAvailable: (shape.swingCooldownMs ?? 0) <= 0,
        swingCooldownRemainingMs: Math.round(shape.swingCooldownMs ?? 0),
        blockAvailable: (shape.blockCharges ?? 0) > 0 && (shape.blockCooldownMs ?? 0) <= 0,
        blockActive: (shape.blockActiveMs ?? 0) > 0,
        blockActiveRemainingMs: (shape.blockActiveMs ?? 0) > 0 ? 1 : 0,
        blockCooldownRemainingMs: Math.round(shape.blockCooldownMs ?? 0),
        blockRechargeRemainingMs: rechargeRemainingMs(shape),
        blockCharges: shape.blockCharges ?? 0,
        combatLoadout,
        gunAvailable: gunAvailable(shape, combatLoadout),
        gunActive: (shape.gunActiveMs ?? 0) > 0,
        gunCooldownRemainingMs: Math.round(shape.gunCooldownMs ?? 0),
        gunAmmo: shape.gunAmmo ?? (hasAbility(shape, "fire_gun") ? RANGED_AMMO_MAX : 0),
        gunReloadRemainingMs: Math.round(shape.gunReloadMs ?? 0),
        grenadeAvailable: hasAbility(shape, "throw_grenade") && (shape.grenadeCooldownMs ?? 0) <= 0,
        grenadeCooldownRemainingMs: Math.round(shape.grenadeCooldownMs ?? 0),
        fireballAvailable: fireballAvailable(shape, combatLoadout),
        fireballCooldownRemainingMs: Math.round(shape.fireballCooldownMs ?? 0),
        fireballCharges: shape.fireballCharges ?? (hasAbility(shape, "shoot_fireball") ? FIREBALL_CHARGES_MAX : 0),
        fireballReloadRemainingMs: Math.round(shape.fireballReloadMs ?? 0),
        stunAvailable: hasAbility(shape, "stun")
            && (shape.stunCooldownMs ?? 0) <= 0
            && (shape.stunActiveMs ?? 0) <= 0,
        stunCooldownRemainingMs: Math.round(shape.stunCooldownMs ?? 0),
        hp: shape.hp ?? BASE_FIGHTER_HP,
        alive: Number(shape.hp ?? BASE_FIGHTER_HP) > 0,
        hittable: Number(shape.hp ?? BASE_FIGHTER_HP) > 0,
        projectileHittable: Number(shape.hp ?? BASE_FIGHTER_HP) > 0,
        damageTakenLastTick: Number(shape.damageTakenLastTick ?? 0),
        hpNetChangeLastTick: Number(shape.hpNetChangeLastTick ?? 0),
        matchElapsedMs: Math.max(0, Number(shape.matchElapsedMs ?? 0)),
        customVariables: { ...(shape.customVariables ?? {}) },
        slowedMs: Math.round(shape.slowedMs ?? 0),
        abilityCooldowns: { ...(shape.abilityCooldowns ?? {}) },
        abilityCharges: { ...(shape.abilityCharges ?? {}) },
        abilityActiveMs: { ...(shape.abilityActiveMs ?? {}) },
        preparingAbility: shape.preparingAbility ?? null,
        preparingMs: Math.round(shape.preparingMs ?? 0),
        slot: shape.slot,
        size: shape.size,
        dashAvailable: dashAvailable(shape, combatLoadout),
        dashActive: (shape.dashActiveMs ?? 0) > 0,
        dashCooldownRemainingMs: Math.round(Math.max(shape.dashCooldownMs ?? 0, shape.dashActiveMs ?? 0)),
    };
}

function objectPayload(shape, actorId) {
    const opponentFighterId = actorId === "main" ? "opponent-model" : "main";
    return {
        id: shape.id,
        ownerId: shape.ownerId,
        owner: shape.ownerId === actorId ? "my" : "opponent",
        abilityId: shape.abilityId,
        armed: Boolean(shape.armed),
        fuseMs: Math.round(shape.fuseMs ?? 0),
        // Fighter roles come from stable ids. Renderer presentation types may be
        // changed by resets or editors and must not break gameplay targeting.
        type: shape.id === opponentFighterId ? "opponentModel" : shape.type,
        x: Math.round(shape.x),
        y: Math.round(shape.y),
        size: shape.size,
        rotation: Math.round(shape.rotation),
        velocityX: shape.velocityX ?? 0,
        velocityY: shape.velocityY ?? 0,
        combatLoadout: shape.combatLoadout,
        abilities: [...(shape.abilities ?? [])],
        hp: shape.hp ?? BASE_FIGHTER_HP,
        ...(shape.id === opponentFighterId ? {
            alive: Number(shape.hp ?? BASE_FIGHTER_HP) > 0,
            hittable: Number(shape.hp ?? BASE_FIGHTER_HP) > 0,
            projectileHittable: Number(shape.hp ?? BASE_FIGHTER_HP) > 0,
        } : {}),
        damageTakenLastTick: Number(shape.damageTakenLastTick ?? 0),
        hpNetChangeLastTick: Number(shape.hpNetChangeLastTick ?? 0),
        slowedMs: Math.round(shape.slowedMs ?? 0),
        abilityCooldowns: { ...(shape.abilityCooldowns ?? {}) },
        abilityCharges: { ...(shape.abilityCharges ?? {}) },
        abilityActiveMs: { ...(shape.abilityActiveMs ?? {}) },
        preparingAbility: shape.preparingAbility ?? null,
        preparingMs: Math.round(shape.preparingMs ?? 0),
        slot: shape.slot,
        swingActive: (shape.swingActiveMs ?? 0) > 0,
        swingAvailable: (shape.swingCooldownMs ?? 0) <= 0,
        swingCooldownRemainingMs: Math.round(shape.swingCooldownMs ?? 0),
        blockActive: (shape.blockActiveMs ?? 0) > 0,
        blockAvailable: (shape.blockCharges ?? 0) > 0 && (shape.blockCooldownMs ?? 0) <= 0,
        blockCooldownRemainingMs: Math.round(shape.blockCooldownMs ?? 0),
        blockRechargeRemainingMs: rechargeRemainingMs(shape),
        blockCharges: shape.blockCharges ?? 0,
        gunActive: (shape.gunActiveMs ?? 0) > 0,
        gunAvailable: gunAvailable(shape, shape.combatLoadout),
        gunCooldownRemainingMs: Math.round(shape.gunCooldownMs ?? 0),
        gunAmmo: shape.gunAmmo ?? (hasAbility(shape, "fire_gun") ? RANGED_AMMO_MAX : 0),
        gunReloadRemainingMs: Math.round(shape.gunReloadMs ?? 0),
        grenadeAvailable: hasAbility(shape, "throw_grenade") && (shape.grenadeCooldownMs ?? 0) <= 0,
        grenadeCooldownRemainingMs: Math.round(shape.grenadeCooldownMs ?? 0),
        fireballAvailable: fireballAvailable(shape, shape.combatLoadout),
        fireballCooldownRemainingMs: Math.round(shape.fireballCooldownMs ?? 0),
        fireballCharges: shape.fireballCharges ?? (hasAbility(shape, "shoot_fireball") ? FIREBALL_CHARGES_MAX : 0),
        fireballReloadRemainingMs: Math.round(shape.fireballReloadMs ?? 0),
        stunAvailable: hasAbility(shape, "stun")
            && (shape.stunCooldownMs ?? 0) <= 0
            && (shape.stunActiveMs ?? 0) <= 0,
        stunCooldownRemainingMs: Math.round(shape.stunCooldownMs ?? 0),
        dashActive: (shape.dashActiveMs ?? 0) > 0,
        dashAvailable: dashAvailable(shape, shape.combatLoadout),
        dashCooldownRemainingMs: Math.round(Math.max(shape.dashCooldownMs ?? 0, shape.dashActiveMs ?? 0)),
    };
}

function rechargeRemainingMs(shape) {
    return Math.max(0, BLOCK_RECHARGE_MS - Math.round(shape.blockRechargeMs ?? shape.blockCooldownMs ?? 0));
}

function gunAvailable(shape) {
    return hasAbility(shape, "fire_gun")
        && (shape.gunAmmo ?? RANGED_AMMO_MAX) > 0
        && (shape.gunReloadMs ?? 0) <= 0
        && (shape.gunCooldownMs ?? 0) <= 0
        && (shape.gunActiveMs ?? 0) <= 0;
}

function fireballAvailable(shape) {
    return hasAbility(shape, "shoot_fireball")
        && (shape.fireballCharges ?? FIREBALL_CHARGES_MAX) > 0
        && (shape.fireballReloadMs ?? 0) <= 0
        && (shape.fireballCooldownMs ?? 0) <= 0
        && (shape.fireballActiveMs ?? 0) <= 0;
}

function dashAvailable(shape) {
    return hasAbility(shape, "dash")
        && (shape.dashCooldownMs ?? 0) <= 0
        && (shape.dashActiveMs ?? 0) <= 0;
}

function hasAbility(shape, ability) {
    return Array.isArray(shape?.abilities) && shape.abilities.includes(ability);
}
