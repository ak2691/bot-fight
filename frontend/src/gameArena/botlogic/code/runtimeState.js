const ENTITY_SIZE = 60;

function botState(source = {}) {
    return {
        ...source,
        hp: source.hp ?? 100,
        size: source.size ?? ENTITY_SIZE,
        swingAvailable: Boolean(source.swingAvailable),
        swingCooldownRemainingMs: Number(source.swingCooldownRemainingMs) || 0,
        blockAvailable: Boolean(source.blockAvailable),
        blockActive: Boolean(source.blockActive),
        blockCooldownRemainingMs: Number(source.blockCooldownRemainingMs) || 0,
        blockCharges: Number.isFinite(Number(source.blockCharges)) ? Number(source.blockCharges) : 0,
        gunAvailable: Boolean(source.gunAvailable),
        gunCooldownRemainingMs: Number(source.gunCooldownRemainingMs) || 0,
        gunAmmo: Number.isFinite(Number(source.gunAmmo)) ? Number(source.gunAmmo) : 0,
        gunReloadRemainingMs: Number(source.gunReloadRemainingMs) || 0,
        grenadeAvailable: Boolean(source.grenadeAvailable),
        grenadeCooldownRemainingMs: Number(source.grenadeCooldownRemainingMs) || 0,
        fireballAvailable: Boolean(source.fireballAvailable),
        fireballCooldownRemainingMs: Number(source.fireballCooldownRemainingMs) || 0,
        fireballCharges: Number.isFinite(Number(source.fireballCharges)) ? Number(source.fireballCharges) : 0,
        fireballReloadRemainingMs: Number(source.fireballReloadRemainingMs) || 0,
        stunAvailable: Boolean(source.stunAvailable),
        stunCooldownRemainingMs: Number(source.stunCooldownRemainingMs) || 0,
        slowedMs: Number(source.slowedMs) || 0,
        silencedMs: Number(source.silencedMs) || 0,
        nullZoneSilenced: Boolean(source.nullZoneSilenced),
        stunnedMs: Number(source.stunnedMs) || 0,
        shockRemainingMs: Number(source.shockRemainingMs) || 0,
        burnRemainingMs: Number(source.burnRemainingMs) || 0,
        bleedRemainingMs: Number(source.bleedRemainingMs) || 0,
        abilities: abilityIdsFromBoundary(source.abilities),
        abilityCooldowns: abilityMapFromBoundary(source.abilityCooldowns),
        abilityCharges: abilityMapFromBoundary(source.abilityCharges),
        abilityActiveMs: abilityMapFromBoundary(source.abilityActiveMs),
        preparingAbility: source.preparingAbility == null ? null : abilityIdFromBoundary(source.preparingAbility),
        preparingMs: Number(source.preparingMs) || 0,
    };
}

export function stateFromPayload(payload) {
    const objects = Array.isArray(payload?.objects) ? payload.objects : [];
    const player = botState(payload?.playerModel);
    const opponentSource = objects.find((object) => object?.type === "opponentModel")
        ?? objects.find((object) => object?.id === "opponent-model" || object?.id === "main")
        ?? null;
    const opponent = opponentSource ? {
        ...botState(opponentSource),
        swingActive: Boolean(opponentSource.swingActive),
        velocityX: opponentSource.velocityX ?? 0,
        velocityY: opponentSource.velocityY ?? 0,
    } : null;
    return {
        player,
        opponent,
        objects,
        obstacles: objects.filter((object) => object?.type && object.type !== "opponentModel"),
    };
}
import { abilityIdFromBoundary, abilityIdsFromBoundary, abilityMapFromBoundary } from "../../gameconfig/AbilityCompatibility.js";
