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
    const botShapes = currentShapes.filter(isBotShape);
    const closingZone = currentShapes.find(isClosingZone);
    return {
        selectedLoadout,
        closingZone: closingZone ? closingZonePayload(closingZone) : null,
        playerModel: botPayload(main, selectedLoadout, "model", main?.ownerId ?? actorId, {
            role: "self",
            botIndex: 0,
        }),
        objects: currentShapes
            .filter((shape) => shape.id !== actorId && shape.visibility !== "renderer-only")
            .map((shape) => objectPayload(shape, actorId, main, botShapes)),
    };
}

function closingZonePayload(shape) {
    return {
        x: Number(shape.x ?? 0),
        y: Number(shape.y ?? 0),
        safeRadius: Number(shape.safeRadius ?? Number(shape.size ?? 0) / 2),
    };
}

function botPayload(shape, selectedLoadout, type = "model", ownerId = shape?.id, metadata = {}) {
    shape = toSimulationBotShape(shape);
    const combatLoadout = shape.combatLoadout ?? selectedLoadout;
    const currentHp = Number(shape.hp ?? BASE_BOT_HP);
    const maxHp = Number(shape.maxHp ?? BASE_BOT_HP);
    const alive = currentHp > 0;
    return {
        id: shape.id,
        userId: shape.userId ?? null,
        type,
        selectableIdentities: BOT_SELECTABLE_IDENTITIES,
        ownerId,
        role: metadata.role ?? null,
        botIndex: metadata.botIndex ?? null,
        teamNumber: teamNumberFor(shape),
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

function objectPayload(shape, actorId, actorShape, botShapes) {
    if (isBotShape(shape)) {
        const role = roleForBot(shape, actorShape, botShapes);
        return {
            ...botPayload(
                shape,
                shape.combatLoadout,
                shape.id === "opponent-model" ? "opponentModel" : "botModel",
                shape.ownerId ?? shape.id,
                role,
            ),
            owner: role.role === "teammate" ? "my" : "opponent",
        };
    }
    const contract = entityContract(shape.abilityId ?? shape.entityContractType ?? shape.type);
    const healthBearing = Boolean(contract?.health && contract?.collider?.hittable);
    const selectableIdentities = shape.selectableIdentities
        ?? selectableIdentitiesForAbilityEntity(contract, shape.abilityId ?? contract?.abilityId);
    return {
        id: shape.id,
        ownerId: shape.ownerId,
        ownerSlot: shape.ownerSlot,
        owner: ownerRoleForEntity(shape, actorId, actorShape, botShapes),
        ownerSelector: ownerSelectableForEntity(shape, actorId, actorShape, botShapes),
        abilityId: shape.abilityId,
        selectableIdentities,
        armed: Boolean(shape.armed),
        fuseMs: Math.round(shape.fuseMs ?? 0),
        type: shape.type,
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

function isBotShape(shape) {
    return shape?.id === "main"
        || shape?.id === "opponent-model"
        || shape?.type === "circle"
        || shape?.type === "bot"
        || shape?.type === "botModel"
        || shape?.type === "opponentModel"
        || (shape?.slot != null && shape?.userId != null && shape?.abilityId == null);
}

function teamNumberFor(shape) {
    const explicit = Number(shape?.teamNumber);
    if (Number.isFinite(explicit) && explicit > 0) return Math.floor(explicit);
    const slot = Number(shape?.slot);
    return Number.isFinite(slot) && slot > 0 ? slot <= 2 ? Math.floor(slot) : 1 : 1;
}

function roleForBot(shape, actorShape, botShapes) {
    if (shape?.id === actorShape?.id) return { role: "self", botIndex: 0 };
    const actorTeam = teamNumberFor(actorShape);
    const role = teamNumberFor(shape) === actorTeam ? "teammate" : "opponent";
    const candidates = botShapes
        .filter((candidate) => candidate.id !== actorShape?.id
            && (role === "teammate"
                ? teamNumberFor(candidate) === actorTeam
                : teamNumberFor(candidate) !== actorTeam))
        .sort((first, second) => Number(first.slot ?? 0) - Number(second.slot ?? 0));
    return { role, botIndex: Math.max(1, candidates.findIndex((candidate) => candidate.id === shape.id) + 1) };
}

function ownerRoleForEntity(shape, actorId, actorShape, botShapes) {
    const owner = ownerBotForEntity(shape, botShapes);
    if (owner) return teamNumberFor(owner) === teamNumberFor(actorShape) ? "my" : "opponent";
    return shape.ownerId === actorId ? "my" : "opponent";
}

function ownerSelectableForEntity(shape, actorId, actorShape, botShapes) {
    const owner = ownerBotForEntity(shape, botShapes);
    if (!owner) return shape.ownerId === actorId ? "my_bot" : null;
    if (owner.id === actorId) return "my_bot";
    const role = roleForBot(owner, actorShape, botShapes);
    return role.role === "teammate" ? `teammate_${role.botIndex}` : `opponent_${role.botIndex}`;
}

function ownerBotForEntity(shape, botShapes) {
    return botShapes.find((bot) => bot.id === shape.ownerId
        || (shape.ownerSlot != null && Number(bot.slot) === Number(shape.ownerSlot)));
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
