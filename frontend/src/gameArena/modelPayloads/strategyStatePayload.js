import {
    BASE_BOT_HP,
} from "./arenaConstants.js";
import { toSimulationBotShape } from "./arenaShapes.js";
import { isClosingZone } from "../ecs/entities/ClosingZoneSystem.js";
import { truncateToNumberPrecision } from "../botlogic/code/configuration/constants.js";
import { normalizeStatusEffect, statusEffectsFor } from "../ecs/contracts/StatusContracts.js";
import { entityContract } from "../ecs/contracts/EntityContracts.js";
import { BOT_SELECTABLE_IDENTITIES, selectableIdentitiesForAbilityEntity } from "./selectableIdentities.js";

export function buildStatePayload(currentShapes, selectedLoadout, actorId = "main") {
    const main = currentShapes.find((shape) => shape.id === actorId);
    const closingZone = currentShapes.find(isClosingZone);
    return {
        selectedLoadout,
        closingZone: closingZone ? closingZonePayload(closingZone) : null,
        playerModel: botPayload(main, selectedLoadout),
        objects: currentShapes
            .filter((shape) => shape.id !== actorId && shape.visibility !== "renderer-only")
            .map((shape) => objectPayload(shape, actorId)),
    };
}

function closingZonePayload(shape) {
    return {
        x: Number(shape.x ?? 0),
        y: Number(shape.y ?? 0),
        safeRadius: Number(shape.safeRadius ?? Number(shape.size ?? 0) / 2),
    };
}

function botPayload(shape, selectedLoadout, type = "model", ownerId = shape.id) {
    shape = toSimulationBotShape(shape);
    const combatLoadout = shape.combatLoadout ?? selectedLoadout;
    const currentHp = Number(shape.hp ?? BASE_BOT_HP);
    const maxHp = Number(shape.maxHp ?? BASE_BOT_HP);
    const alive = currentHp > 0;
    return {
        id: shape.id,
        type,
        selectableIdentities: BOT_SELECTABLE_IDENTITIES,
        ownerId,
        abilities: [...(shape.abilities ?? [])],
        health: healthPayload(shape, currentHp, maxHp, alive),
        stats: statsPayload(shape),
        transform: transformPayload(shape),
        statusEffects: statusEffectsPayload(shape),
        combatLoadout,
        matchElapsedMs: Math.max(0, Number(shape.matchElapsedMs ?? 0)),
        customVariables: { ...(shape.customVariables ?? {}) },
        abilityCooldowns: { ...(shape.abilityCooldowns ?? {}) },
        abilityPendingCooldownMs: { ...(shape.abilityPendingCooldownMs ?? {}) },
        abilityCharges: { ...(shape.abilityCharges ?? {}) },
        abilityRechargeMs: { ...(shape.abilityRechargeMs ?? {}) },
        abilityActiveMs: { ...(shape.abilityActiveMs ?? {}) },
        preparingAbility: shape.preparingAbility ?? null,
        preparingMs: Math.round(shape.preparingMs ?? 0),
        slot: shape.slot,
    };
}

function objectPayload(shape, actorId) {
    const opponentBotId = actorId === "main" ? "opponent-model" : "main";
    if (shape.id === opponentBotId) {
        return {
            ...botPayload(shape, shape.combatLoadout, "opponentModel", shape.ownerId),
            owner: shape.ownerId === actorId ? "my" : "opponent",
        };
    }
    const contract = entityContract(shape.abilityId ?? shape.entityContractType ?? shape.type);
    const healthBearing = Boolean(contract?.health && contract?.collider?.hittable);
    const selectableIdentities = shape.selectableIdentities
        ?? selectableIdentitiesForAbilityEntity(contract, shape.abilityId ?? contract?.abilityId);
    return {
        id: shape.id,
        ownerId: shape.ownerId,
        owner: shape.ownerId === actorId ? "my" : "opponent",
        abilityId: shape.abilityId,
        selectableIdentities,
        armed: Boolean(shape.armed),
        fuseMs: Math.round(shape.fuseMs ?? 0),
        // Bot roles come from stable ids. Renderer presentation types may be
        // changed by resets or editors and must not break gameplay targeting.
        type: shape.id === opponentBotId ? "opponentModel" : shape.type,
        x: truncateToNumberPrecision(Number(shape.x ?? 0)),
        y: truncateToNumberPrecision(Number(shape.y ?? 0)),
        size: shape.size ?? shape.components?.collider?.size ?? 0,
        ageMs: Math.max(0, Number(shape.ageMs ?? shape.components?.lifetime?.ageMs ?? 0)),
        rotation: truncateToNumberPrecision(Number(shape.rotation ?? 0)),
        velocityX: truncateToNumberPrecision(Number(shape.velocityX ?? 0)),
        velocityY: truncateToNumberPrecision(Number(shape.velocityY ?? 0)),
        combatLoadout: shape.combatLoadout,
        abilities: [...(shape.abilities ?? [])],
        // Every selectable has a stable metric shape. Non-health entities resolve
        // to zero, which keeps selectable conditionals deterministic and avoids
        // making callers infer whether an entity exposes a health component.
        hp: healthBearing ? Number(shape.hp ?? shape.health?.current ?? 0) : 0,
        damageTakenLastTick: healthBearing
            ? Number(shape.damageTakenLastTick ?? shape.health?.damageTakenLastTick ?? 0) : 0,
        hpNetChangeLastTick: healthBearing
            ? Number(shape.hpNetChangeLastTick ?? shape.health?.netChangeLastTick ?? 0) : 0,
        abilityCooldowns: { ...(shape.abilityCooldowns ?? {}) },
        abilityPendingCooldownMs: { ...(shape.abilityPendingCooldownMs ?? {}) },
        abilityCharges: { ...(shape.abilityCharges ?? {}) },
        abilityRechargeMs: { ...(shape.abilityRechargeMs ?? {}) },
        abilityActiveMs: { ...(shape.abilityActiveMs ?? {}) },
        preparingAbility: shape.preparingAbility ?? null,
        preparingMs: Math.round(shape.preparingMs ?? 0),
        slot: shape.slot,
    };
}

function healthPayload(shape, currentHp, maxHp, alive) {
    return {
        current: currentHp,
        max: maxHp,
        alive,
        hittable: alive,
        projectileHittable: alive,
        damageTakenLastTick: Number(shape.damageTakenLastTick ?? 0),
        netChangeLastTick: Number(shape.hpNetChangeLastTick ?? 0),
    };
}

function statsPayload(shape) {
    return {
        movementSpeed: Number(shape.moveSpeed ?? 0),
        attackDamageMultiplier: Number(shape.attackDamageMultiplier ?? 1),
        attackSpeedMultiplier: Number(shape.attackSpeedMultiplier ?? 1),
    };
}

function transformPayload(shape) {
    return {
        position: {
            x: truncateToNumberPrecision(Number(shape.x ?? 0)),
            y: truncateToNumberPrecision(Number(shape.y ?? 0)),
        },
        rotation: truncateToNumberPrecision(Number(shape.rotation ?? 0)),
        velocity: {
            x: truncateToNumberPrecision(Number(shape.velocityX ?? 0)),
            y: truncateToNumberPrecision(Number(shape.velocityY ?? 0)),
        },
        movementVelocity: {
            x: truncateToNumberPrecision(Number(shape.movementVelocityX ?? 0)),
            y: truncateToNumberPrecision(Number(shape.movementVelocityY ?? 0)),
        },
        size: truncateToNumberPrecision(Number(shape.size ?? 0)),
    };
}

function statusEffectsPayload(shape) {
    return statusEffectsFor(shape).map((status) => normalizeStatusEffect({
        ...status,
        remainingMs: Math.round(Number(status.remainingMs ?? 0)),
        effects: (status.effects ?? []).map((effect) => ({ ...effect })),
    }));
}
