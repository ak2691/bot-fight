import { BASE_BOT_HP } from "../../../modelPayloads/arenaConstants.js";
import { normalizeStatusEffect } from "../../../ecs/contracts/StatusContracts.js";

const ENTITY_SIZE = 60;
const SIMULATION_STEP_SECONDS = 0.1;

function botState(source = {}) {
    const health = source.health ?? {};
    const stats = source.stats ?? {};
    const transform = source.transform ?? {};
    const position = transform.position ?? {};
    const velocity = transform.velocity ?? {};
    const movementVelocity = transform.movementVelocity ?? {};
    const legacyMovementVelocityX = source.transform
        ? Number(velocity.x ?? 0) * SIMULATION_STEP_SECONDS
        : source.velocityX ?? 0;
    const legacyMovementVelocityY = source.transform
        ? Number(velocity.y ?? 0) * SIMULATION_STEP_SECONDS
        : source.velocityY ?? 0;
    const statusEffects = Array.isArray(source.statusEffects)
        ? source.statusEffects.map(normalizeStatusEffect).filter(Boolean)
        : [];
    return {
        ...source,
        hp: source.hp ?? health.current ?? BASE_BOT_HP,
        maxHp: source.maxHp ?? health.max ?? BASE_BOT_HP,
        size: source.size ?? transform.size ?? ENTITY_SIZE,
        x: source.x ?? position.x ?? 0,
        y: source.y ?? position.y ?? 0,
        rotation: source.rotation ?? transform.rotation ?? 0,
        velocityX: source.velocityX ?? velocity.x ?? 0,
        velocityY: source.velocityY ?? velocity.y ?? 0,
        movementVelocityX: source.movementVelocityX ?? movementVelocity.x ?? legacyMovementVelocityX,
        movementVelocityY: source.movementVelocityY ?? movementVelocity.y ?? legacyMovementVelocityY,
        moveSpeed: source.moveSpeed ?? stats.movementSpeed ?? 0,
        attackDamageMultiplier: source.attackDamageMultiplier ?? stats.attackDamageMultiplier ?? 1,
        attackSpeedMultiplier: source.attackSpeedMultiplier ?? stats.attackSpeedMultiplier ?? 1,
        statusEffects,
        damageTakenLastTick: source.damageTakenLastTick ?? health.damageTakenLastTick ?? 0,
        hpNetChangeLastTick: source.hpNetChangeLastTick ?? health.netChangeLastTick ?? 0,
        abilities: abilityIdsFromBoundary(source.abilities),
        abilityCooldowns: abilityMapFromBoundary(source.abilityCooldowns),
        abilityPendingCooldownMs: abilityMapFromBoundary(source.abilityPendingCooldownMs),
        abilityCharges: abilityMapFromBoundary(source.abilityCharges),
        abilityRechargeMs: abilityMapFromBoundary(source.abilityRechargeMs),
        abilityActiveMs: abilityMapFromBoundary(source.abilityActiveMs),
        preparingAbility: source.preparingAbility == null ? null : abilityIdFromBoundary(source.preparingAbility),
        preparingMs: Number(source.preparingMs) || 0,
    };
}

export function stateFromPayload(payload) {
    const objects = Array.isArray(payload?.objects) ? payload.objects : [];
    const player = botState(payload?.playerModel);
    const botObjects = objects.filter(isBotModel);
    const teammateSources = botObjects
        .filter((object) => object?.role === "teammate")
        .sort(botOrder);
    const opponentSources = botObjects
        .filter((object) => object?.role === "opponent")
        .sort(botOrder);
    const normalizedTeammates = teammateSources.map(botState);
    const opponentSourcesWithLegacyFallback = (opponentSources.length > 0
        ? opponentSources
        : [
            botObjects.find((object) => object?.type === "opponentModel")
                ?? objects.find((object) => object?.id === "opponent-model" || object?.id === "main"),
        ].filter(Boolean));
    const normalizedOpponents = opponentSourcesWithLegacyFallback.map((source) => ({
            ...botState(source),
            swingActive: Boolean(source.swingActive),
        }));
    const opponent = normalizedOpponents[0] ?? null;
    return {
        player,
        opponent,
        teammates: normalizedTeammates,
        opponents: normalizedOpponents,
        bots: [player, ...normalizedTeammates, ...normalizedOpponents],
        closingZone: payload?.closingZone ?? null,
        objects,
        obstacles: objects.filter((object) => object?.type && !isBotModel(object)),
    };
}

function isBotModel(object) {
    return object?.type === "opponentModel"
        || object?.type === "botModel"
        || object?.type === "bot"
        || object?.role === "teammate"
        || object?.role === "opponent";
}

function botOrder(first, second) {
    const firstIndex = Number(first?.botIndex ?? first?.slot ?? Number.MAX_SAFE_INTEGER);
    const secondIndex = Number(second?.botIndex ?? second?.slot ?? Number.MAX_SAFE_INTEGER);
    return firstIndex - secondIndex || String(first?.id ?? "").localeCompare(String(second?.id ?? ""));
}

import { abilityIdFromBoundary, abilityIdsFromBoundary, abilityMapFromBoundary } from "../../../gameconfig/AbilityCompatibility.js";
