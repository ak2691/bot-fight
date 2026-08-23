import {
    BASE_BOT_HP,
} from "./arenaConstants.js";
import { toSimulationBotShape } from "./arenaShapes.js";
import { isClosingZone } from "../ecs/entities/ClosingZoneSystem.js";
import { truncateToNumberPrecision } from "../botlogic/code/configuration/constants.js";
import { normalizeStatusEffect, statusEffectsFor } from "../ecs/contracts/StatusContracts.js";

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
        x: truncateToNumberPrecision(Number(shape.x ?? 0)),
        y: truncateToNumberPrecision(Number(shape.y ?? 0)),
        size: shape.size,
        ageMs: Math.max(0, Number(shape.ageMs ?? shape.components?.lifetime?.ageMs ?? 0)),
        rotation: truncateToNumberPrecision(Number(shape.rotation ?? 0)),
        velocityX: truncateToNumberPrecision(Number(shape.velocityX ?? 0)),
        velocityY: truncateToNumberPrecision(Number(shape.velocityY ?? 0)),
        combatLoadout: shape.combatLoadout,
        abilities: [...(shape.abilities ?? [])],
        ...(shape.hp == null ? {} : { hp: Number(shape.hp) }),
        damageTakenLastTick: Number(shape.damageTakenLastTick ?? 0),
        hpNetChangeLastTick: Number(shape.hpNetChangeLastTick ?? 0),
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
