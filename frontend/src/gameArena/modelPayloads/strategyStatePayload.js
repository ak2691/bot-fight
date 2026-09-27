import {
    BASE_BOT_HP,
} from "./arenaConstants.js";
import { toSimulationBotShape } from "./arenaShapes.js";
import { isClosingZone } from "../ecs/entities/ClosingZoneSystem.js";
import { truncateToNumberPrecision } from "../botlogic/code/configuration/constants.js";
import { normalizeStatusEffect, statusEffectsFor } from "../ecs/contracts/StatusContracts.js";
import { phaseForEntity } from "../ecs/contracts/AbilityContracts.js";
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

/**
 * Builds one immutable, per-tick payload snapshot and derives actor views from
 * it. Shared bot/entity facts are normalized once before any bot chooses an
 * action, so every actor observes the same start-of-tick state.
 */
export function createStatePayloadFactory(currentShapes) {
    const botShapes = currentShapes.filter(isBotShape);
    const botShapeSet = new Set(botShapes);
    const actorById = new Map();
    for (const shape of currentShapes) {
        if (!actorById.has(shape.id)) actorById.set(shape.id, shape);
    }

    const sharedObjectsByShape = new Map();
    const ownerBotsByShape = new Map();
    for (const shape of currentShapes) {
        if (shape.visibility === "renderer-only") continue;
        sharedObjectsByShape.set(
            shape,
            freezePayload(objectPayload(shape, null, null, botShapes)),
        );
        if (!botShapeSet.has(shape)) {
            ownerBotsByShape.set(shape, ownerBotForEntity(shape, botShapes));
        }
    }

    const rolesByActor = new Map();
    for (const actor of botShapes) {
        rolesByActor.set(actor, new Map(botShapes.map((bot) => [
            bot,
            roleForBot(bot, actor, botShapes),
        ])));
    }

    const closingZoneShape = currentShapes.find(isClosingZone);
    const closingZone = freezePayload(closingZoneShape ? closingZonePayload(closingZoneShape) : null);

    return Object.freeze({
        forActor(selectedLoadout, actorId = "main") {
            const actor = actorById.get(actorId);
            const actorRoles = rolesByActor.get(actor);
            const actorTeamNumber = teamNumberFor(actor);
            const objects = [];

            for (const shape of currentShapes) {
                if (shape.id === actorId || shape.visibility === "renderer-only") continue;
                const shared = sharedObjectsByShape.get(shape);
                if (botShapeSet.has(shape)) {
                    const role = actorRoles?.get(shape) ?? roleForBot(shape, actor, botShapes);
                    objects.push(Object.freeze({
                        ...shared,
                        role: role.role,
                        botIndex: role.botIndex,
                        owner: role.role === "teammate" ? "my" : "opponent",
                    }));
                    continue;
                }

                const ownerBot = ownerBotsByShape.get(shape);
                const ownerRole = ownerBot
                    ? teamNumberFor(ownerBot) === actorTeamNumber ? "my" : "opponent"
                    : shape.ownerId === actorId ? "my" : "opponent";
                let ownerSelector;
                if (!ownerBot) {
                    ownerSelector = shape.ownerId === actorId ? "my_bot" : null;
                } else if (ownerBot.id === actorId) {
                    ownerSelector = "my_bot";
                } else {
                    const role = actorRoles?.get(ownerBot) ?? roleForBot(ownerBot, actor, botShapes);
                    ownerSelector = role.role === "teammate"
                        ? `teammate_${role.botIndex}`
                        : `opponent_${role.botIndex}`;
                }
                objects.push(Object.freeze({ ...shared, owner: ownerRole, ownerSelector }));
            }

            const playerModel = botPayload(
                actor,
                selectedLoadout,
                "model",
                actor?.ownerId ?? actorId,
                { role: "self", botIndex: 0 },
            );
            return Object.freeze({
                selectedLoadout,
                closingZone,
                playerModel: freezePayload(playerModel),
                objects: Object.freeze(objects),
            });
        },
    });
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
    const phase = phaseForEntity(shape);
    const healthBearing = Boolean(phase?.health);
    const selectableIdentities = shape.selectableIdentities
        ?? selectableIdentitiesForAbilityEntity(shape, shape.abilityId);
    return {
        id: shape.id,
        ownerId: shape.ownerId,
        ownerSlot: shape.ownerSlot,
        owner: ownerRoleForEntity(shape, actorId, actorShape, botShapes),
        ownerSelector: ownerSelectableForEntity(shape, actorId, actorShape, botShapes),
        abilityId: shape.abilityId,
        selectableIdentities: [...selectableIdentities],
        armed: Boolean(shape.armed),
        fuseMs: Math.round(shape.fuseMs ?? 0),
        type: shape.type,
        x: truncateToNumberPrecision(Number(shape.x ?? 0)),
        y: truncateToNumberPrecision(Number(shape.y ?? 0)),
        size: shape.size ?? 0,
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

function freezePayload(value, seen = new WeakSet()) {
    if (value == null || typeof value !== "object" || seen.has(value) || Object.isFrozen(value)) {
        return value;
    }
    seen.add(value);
    for (const child of Object.values(value)) freezePayload(child, seen);
    return Object.freeze(value);
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
