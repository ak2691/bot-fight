import {
    BASE_BOT_HP,
} from "./arenaConstants.js";
import { ABILITY_STATS } from "../gameconfig/Abilities.js";

export function buildStatePayload(currentShapes, selectedLoadout, actorId = "main") {
    const main = currentShapes.find((shape) => shape.id === actorId);
    return {
        selectedLoadout,
        playerModel: botPayload(main, selectedLoadout),
        objects: currentShapes
            .filter((shape) => shape.id !== actorId)
            .map((shape) => objectPayload(shape, actorId)),
    };
}

function botPayload(shape, selectedLoadout) {
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
        blockActive: (shape.abilityActiveMs?.[2] ?? 0) > 0,
        blockActiveRemainingMs: Math.round(shape.abilityActiveMs?.[2] ?? 0),
        blockCooldownRemainingMs: Math.round(shape.blockCooldownMs ?? 0),
        blockRechargeRemainingMs: rechargeRemainingMs(shape),
        blockCharges: shape.blockCharges ?? 0,
        combatLoadout,
        gunAvailable: gunAvailable(shape, combatLoadout),
        gunActive: (shape.abilityActiveMs?.[3] ?? 0) > 0,
        gunCooldownRemainingMs: Math.round(shape.gunCooldownMs ?? 0),
        gunAmmo: shape.gunAmmo ?? (hasAbility(shape, 3) ? ABILITY_STATS[3].ammoMax : 0),
        gunReloadRemainingMs: Math.round(shape.gunReloadMs ?? 0),
        grenadeAvailable: hasAbility(shape, 4) && (shape.grenadeCooldownMs ?? 0) <= 0,
        grenadeCooldownRemainingMs: Math.round(shape.grenadeCooldownMs ?? 0),
        fireballAvailable: fireballAvailable(shape, combatLoadout),
        fireballCooldownRemainingMs: Math.round(shape.fireballCooldownMs ?? 0),
        fireballCharges: shape.fireballCharges ?? (hasAbility(shape, 5) ? ABILITY_STATS[5].maxCharges : 0),
        fireballReloadRemainingMs: Math.round(shape.fireballReloadMs ?? 0),
        stunAvailable: hasAbility(shape, 6)
            && (shape.stunCooldownMs ?? 0) <= 0
            && (shape.abilityActiveMs?.[6] ?? 0) <= 0,
        stunCooldownRemainingMs: Math.round(shape.stunCooldownMs ?? 0),
        hp: shape.hp ?? BASE_BOT_HP,
        alive: Number(shape.hp ?? BASE_BOT_HP) > 0,
        hittable: Number(shape.hp ?? BASE_BOT_HP) > 0,
        projectileHittable: Number(shape.hp ?? BASE_BOT_HP) > 0,
        damageTakenLastTick: Number(shape.damageTakenLastTick ?? 0),
        hpNetChangeLastTick: Number(shape.hpNetChangeLastTick ?? 0),
        matchElapsedMs: Math.max(0, Number(shape.matchElapsedMs ?? 0)),
        customVariables: { ...(shape.customVariables ?? {}) },
        slowedMs: Math.round(shape.slowedMs ?? 0),
        silencedMs: Math.round(shape.silencedMs ?? 0),
        nullZoneSilenced: Boolean(shape.nullZoneSilenced),
        stunnedMs: Math.round(shape.stunnedMs ?? 0),
        shockRemainingMs: Math.round(shape.shockRemainingMs ?? 0),
        burnRemainingMs: Math.round(shape.burnRemainingMs ?? 0),
        bleedRemainingMs: Math.round(shape.bleedRemainingMs ?? 0),
        abilityCooldowns: { ...(shape.abilityCooldowns ?? {}) },
        abilityCharges: { ...(shape.abilityCharges ?? {}) },
        abilityActiveMs: { ...(shape.abilityActiveMs ?? {}) },
        preparingAbility: shape.preparingAbility ?? null,
        preparingMs: Math.round(shape.preparingMs ?? 0),
        slot: shape.slot,
        size: shape.size,
    };
}

function objectPayload(shape, actorId) {
    const opponentBotId = actorId === "main" ? "opponent-model" : "main";
    return {
        id: shape.id,
        ownerId: shape.ownerId,
        owner: shape.ownerId === actorId ? "my" : "opponent",
        abilityId: shape.abilityId,
        armed: Boolean(shape.armed),
        fuseMs: Math.round(shape.fuseMs ?? 0),
        // Bot roles come from stable ids. Renderer presentation types may be
        // changed by resets or editors and must not break gameplay targeting.
        type: shape.id === opponentBotId ? "opponentModel" : shape.type,
        x: Math.round(shape.x),
        y: Math.round(shape.y),
        size: shape.size,
        rotation: Math.round(shape.rotation),
        velocityX: shape.velocityX ?? 0,
        velocityY: shape.velocityY ?? 0,
        combatLoadout: shape.combatLoadout,
        abilities: [...(shape.abilities ?? [])],
        hp: shape.hp ?? BASE_BOT_HP,
        ...(shape.id === opponentBotId ? {
            alive: Number(shape.hp ?? BASE_BOT_HP) > 0,
            hittable: Number(shape.hp ?? BASE_BOT_HP) > 0,
            projectileHittable: Number(shape.hp ?? BASE_BOT_HP) > 0,
        } : {}),
        damageTakenLastTick: Number(shape.damageTakenLastTick ?? 0),
        hpNetChangeLastTick: Number(shape.hpNetChangeLastTick ?? 0),
        slowedMs: Math.round(shape.slowedMs ?? 0),
        silencedMs: Math.round(shape.silencedMs ?? 0),
        nullZoneSilenced: Boolean(shape.nullZoneSilenced),
        stunnedMs: Math.round(shape.stunnedMs ?? 0),
        shockRemainingMs: Math.round(shape.shockRemainingMs ?? 0),
        burnRemainingMs: Math.round(shape.burnRemainingMs ?? 0),
        bleedRemainingMs: Math.round(shape.bleedRemainingMs ?? 0),
        abilityCooldowns: { ...(shape.abilityCooldowns ?? {}) },
        abilityCharges: { ...(shape.abilityCharges ?? {}) },
        abilityActiveMs: { ...(shape.abilityActiveMs ?? {}) },
        preparingAbility: shape.preparingAbility ?? null,
        preparingMs: Math.round(shape.preparingMs ?? 0),
        slot: shape.slot,
        swingActive: (shape.abilityActiveMs?.[1] ?? 0) > 0,
        swingAvailable: (shape.swingCooldownMs ?? 0) <= 0,
        swingCooldownRemainingMs: Math.round(shape.swingCooldownMs ?? 0),
        blockActive: (shape.abilityActiveMs?.[2] ?? 0) > 0,
        blockAvailable: (shape.blockCharges ?? 0) > 0 && (shape.blockCooldownMs ?? 0) <= 0,
        blockCooldownRemainingMs: Math.round(shape.blockCooldownMs ?? 0),
        blockRechargeRemainingMs: rechargeRemainingMs(shape),
        blockCharges: shape.blockCharges ?? 0,
        gunActive: (shape.abilityActiveMs?.[3] ?? 0) > 0,
        gunAvailable: gunAvailable(shape, shape.combatLoadout),
        gunCooldownRemainingMs: Math.round(shape.gunCooldownMs ?? 0),
        gunAmmo: shape.gunAmmo ?? (hasAbility(shape, 3) ? ABILITY_STATS[3].ammoMax : 0),
        gunReloadRemainingMs: Math.round(shape.gunReloadMs ?? 0),
        grenadeAvailable: hasAbility(shape, 4) && (shape.grenadeCooldownMs ?? 0) <= 0,
        grenadeCooldownRemainingMs: Math.round(shape.grenadeCooldownMs ?? 0),
        fireballAvailable: fireballAvailable(shape, shape.combatLoadout),
        fireballCooldownRemainingMs: Math.round(shape.fireballCooldownMs ?? 0),
        fireballCharges: shape.fireballCharges ?? (hasAbility(shape, 5) ? ABILITY_STATS[5].maxCharges : 0),
        fireballReloadRemainingMs: Math.round(shape.fireballReloadMs ?? 0),
        stunAvailable: hasAbility(shape, 6)
            && (shape.stunCooldownMs ?? 0) <= 0
            && (shape.abilityActiveMs?.[6] ?? 0) <= 0,
        stunCooldownRemainingMs: Math.round(shape.stunCooldownMs ?? 0),
    };
}

function rechargeRemainingMs(shape) {
    return Math.max(0, ABILITY_STATS[2].rechargeMs - Math.round(shape.blockRechargeMs ?? shape.blockCooldownMs ?? 0));
}

function gunAvailable(shape) {
    return hasAbility(shape, 3)
        && (shape.gunAmmo ?? ABILITY_STATS[3].ammoMax) > 0
        && (shape.gunReloadMs ?? 0) <= 0
        && (shape.gunCooldownMs ?? 0) <= 0
        && (shape.abilityActiveMs?.[3] ?? 0) <= 0;
}

function fireballAvailable(shape) {
    return hasAbility(shape, 5)
        && (shape.fireballCharges ?? ABILITY_STATS[5].maxCharges) > 0
        && (shape.fireballReloadMs ?? 0) <= 0
        && (shape.fireballCooldownMs ?? 0) <= 0
        && (shape.abilityActiveMs?.[5] ?? 0) <= 0;
}

function hasAbility(shape, ability) {
    return Array.isArray(shape?.abilities) && shape.abilities.includes(ability);
}
