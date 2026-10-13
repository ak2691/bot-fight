import {
    BASE_BOT_HP,
} from "./arenaConstants.js";
import { isBotState } from "./botState.js";
import { botFastTurning, botSprinting, botStamina } from "../gameconfig/StaminaSystem.js";
import { cloneAbilityState } from "../gameconfig/AbilityState.js";
import { isClosingZone } from "../ecs/entities/ClosingZoneSystem.js";
import { truncateToNumberPrecision } from "../botlogic/code/configuration/constants.js";
import { normalizeStatusEffect, statusEffectsFor } from "../ecs/contracts/StatusContracts.js";
import { isAttachedEntity, phaseForEntity } from "../ecs/contracts/AbilityContracts.js";
import { BOT_SELECTABLE_IDENTITIES, selectableIdentitiesForAbilityEntity } from "./selectableIdentities.js";

let freezePayloads = false;

/**
 * Snapshot objects are always shallow-frozen (one Object.freeze each, cheap). Tests turn
 * deep freezing on so a write to a nested value fails loudly too; it stays off in the
 * practice room and in workers, where walking every payload each tick is pure cost.
 */
export function setPayloadFreezing(enabled) {
    freezePayloads = Boolean(enabled);
}

export function buildStatePayload(currentShapes, selectedLoadout, actorId = "main") {
    return createStatePayloadFactory(currentShapes).forActor(selectedLoadout, actorId);
}

/**
 * Builds the start-of-tick snapshot once (one core payload per bot and per entity) and
 * derives actor views from it. A view is a small object of its own that points at the
 * snapshot's nested values; nothing nested is copied per actor. Every actor observes the
 * same start-of-tick state.
 */
export function createStatePayloadFactory(currentShapes) {
    const botShapes = currentShapes.filter(isBotState);
    const botShapeSet = new Set(botShapes);
    const botsBySlot = [...botShapes].sort((first, second) => Number(first.slot ?? 0) - Number(second.slot ?? 0));
    const actorById = new Map();
    for (const shape of currentShapes) {
        if (!actorById.has(shape.id)) actorById.set(shape.id, shape);
    }

    const coreByShape = new Map();
    const ownerBotsByShape = new Map();
    for (const shape of currentShapes) {
        // An attached entity is part of its owner's attack: no brain lists or selects it.
        if (shape.visibility === "renderer-only" || isAttachedEntity(shape)) continue;
        if (botShapeSet.has(shape)) {
            coreByShape.set(shape, freeze(botCore(shape)));
        } else {
            coreByShape.set(shape, freeze(entityCore(shape)));
            ownerBotsByShape.set(shape, ownerBotForEntity(shape, botShapes));
        }
    }

    const closingZoneShape = currentShapes.find(isClosingZone);
    const closingZone = freeze(closingZoneShape ? closingZonePayload(closingZoneShape) : null);
    const rolesByActor = new Map();

    function rolesFor(actor) {
        let roles = rolesByActor.get(actor);
        if (roles) return roles;
        roles = new Map();
        const actorTeam = teamNumberFor(actor);
        let teammates = 0;
        let opponents = 0;
        for (const bot of botsBySlot) {
            if (bot === actor || bot.id === actor?.id) {
                roles.set(bot, { role: "self", botIndex: 0 });
            } else if (teamNumberFor(bot) === actorTeam) {
                roles.set(bot, { role: "teammate", botIndex: ++teammates });
            } else {
                roles.set(bot, { role: "opponent", botIndex: ++opponents });
            }
        }
        rolesByActor.set(actor, roles);
        return roles;
    }

    return Object.freeze({
        /** The frozen start-of-tick payload of one bot or entity (what "before" means to the stages). */
        core(shape) {
            return coreByShape.get(shape);
        },
        forActor(selectedLoadout, actorId = "main") {
            const actor = actorById.get(actorId);
            const roles = rolesFor(actor);
            const actorTeamNumber = teamNumberFor(actor);
            const objects = [];

            for (const shape of currentShapes) {
                if (shape.id === actorId || shape.visibility === "renderer-only" || isAttachedEntity(shape)) continue;
                const core = coreByShape.get(shape);
                if (botShapeSet.has(shape)) {
                    const role = roles.get(shape);
                    objects.push(freeze({
                        ...core,
                        type: shape.id === "opponent-model" ? "opponentModel" : "botModel",
                        ownerId: shape.ownerId ?? shape.id,
                        role: role.role,
                        botIndex: role.botIndex,
                        combatLoadout: shape.combatLoadout,
                        owner: role.role === "teammate" ? "my" : "opponent",
                    }, false));
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
                    const role = roles.get(ownerBot);
                    ownerSelector = role.role === "teammate"
                        ? `teammate_${role.botIndex}`
                        : `opponent_${role.botIndex}`;
                }
                objects.push(freeze({ ...core, owner: ownerRole, ownerSelector }, false));
            }

            const playerModel = {
                ...coreByShape.get(actor),
                type: "model",
                ownerId: actor?.ownerId ?? actorId,
                role: "self",
                botIndex: 0,
                combatLoadout: actor.combatLoadout ?? selectedLoadout,
                // Lanes runtime state (self only); tree bots have no mode and read 0.
                modeId: actor.modeId ?? null,
                timeInModeMs: Math.max(0, Math.round(Number(actor.timeInModeMs ?? 0))),
                comboStepId: actor.comboStepId ?? null,
                runningActionCardId: actor.runningActionCardId ?? null,
            };
            return freeze({
                selectedLoadout,
                closingZone,
                playerModel: freeze(playerModel, false),
                objects: freeze(objects, false),
            }, false);
        },
    });
}

/** Shallow-freezes the object; nested snapshot values are deep-frozen only when the test flag is on. */
function freeze(value, deep = true) {
    if (value == null || typeof value !== "object") return value;
    return deep && freezePayloads ? freezePayload(value) : Object.freeze(value);
}

function closingZonePayload(shape) {
    return {
        x: Number(shape.x ?? 0),
        y: Number(shape.y ?? 0),
        safeRadius: Number(shape.safeRadius ?? Number(shape.size ?? 0) / 2),
    };
}

/** Everything about a bot that does not depend on who is looking; views add type, ownerId, role and combatLoadout. */
function botCore(shape) {
    const currentHp = Number(shape.hp ?? BASE_BOT_HP);
    const maxHp = Number(shape.maxHp ?? BASE_BOT_HP);
    const alive = currentHp > 0;
    return {
        id: shape.id,
        userId: shape.userId ?? null,
        selectableIdentities: BOT_SELECTABLE_IDENTITIES,
        teamNumber: teamNumberFor(shape),
        abilities: [...(shape.abilities ?? [])],
        health: healthPayload(shape, currentHp, maxHp, alive),
        stats: statsPayload(shape),
        transform: transformPayload(shape),
        statusEffects: statusEffectsPayload(shape),
        matchElapsedMs: Math.max(0, Number(shape.matchElapsedMs ?? 0)),
        customVariables: { ...(shape.customVariables ?? {}) },
        abilityState: cloneAbilityState(shape.abilityState),
        abilityLastHitAgeMs: { ...(shape.abilityLastHitAgeMs ?? {}) },
        ...staminaPayload(shape),
        ...displacementPayload(shape),
        slot: shape.slot,
    };
}

/** Stamina state for conditions: the bot's stamina and regen pause. */
function staminaPayload(shape) {
    return {
        stamina: botStamina(shape),
        staminaRegenDelayMs: Math.max(0, Math.round(Number(shape.staminaRegenDelayMs) || 0)),
        sprinting: botSprinting(shape),
        fastTurning: botFastTurning(shape),
    };
}

/**
 * Last-tick displacement used by Is Moving and Approach Angle. It is the position change
 * since the start of the previous tick, so knockback, pulls and dashes count as movement.
 * Shapes without a recorded start report no displacement and fall back to velocity.
 */
function displacementPayload(shape) {
    if (shape.movementStartX == null || shape.movementStartY == null) return {};
    const startX = Number(shape.movementStartX);
    const startY = Number(shape.movementStartY);
    if (!Number.isFinite(startX) || !Number.isFinite(startY)) return {};
    return {
        displacementX: truncateToNumberPrecision(Number(shape.x ?? 0) - startX),
        displacementY: truncateToNumberPrecision(Number(shape.y ?? 0) - startY),
    };
}

function entityCore(shape) {
    const phase = phaseForEntity(shape);
    const healthBearing = Boolean(phase?.health);
    const selectableIdentities = shape.selectableIdentities
        ?? selectableIdentitiesForAbilityEntity(shape, shape.abilityId);
    return {
        id: shape.id,
        ownerId: shape.ownerId,
        ownerSlot: shape.ownerSlot,
        abilityId: shape.abilityId,
        selectableIdentities: [...selectableIdentities],
        armed: Boolean(shape.armed),
        fuseMs: Math.round(shape.fuseMs ?? 0),
        type: shape.type,
        x: truncateToNumberPrecision(Number(shape.x ?? 0)),
        y: truncateToNumberPrecision(Number(shape.y ?? 0)),
        size: shape.size ?? 0,
        ageMs: Math.max(0, Number(shape.ageMs ?? 0)),
        rotation: truncateToNumberPrecision(Number(shape.rotation ?? 0)),
        velocityX: truncateToNumberPrecision(Number(shape.velocityX ?? 0)),
        velocityY: truncateToNumberPrecision(Number(shape.velocityY ?? 0)),
        combatLoadout: shape.combatLoadout,
        abilities: [...(shape.abilities ?? [])],
        // Every selectable has a stable metric shape. Non-health entities resolve
        // to zero, which keeps selectable conditionals deterministic and avoids
        // making callers infer whether an entity exposes a health component.
        hp: healthBearing ? Number(shape.hp ?? 0) : 0,
        damageTakenLastTick: healthBearing
            ? Number(shape.damageTakenLastTick ?? 0) : 0,
        hpNetChangeLastTick: healthBearing
            ? Number(shape.hpNetChangeLastTick ?? 0) : 0,
        abilityState: cloneAbilityState(shape.abilityState),
        ...displacementPayload(shape),
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

function teamNumberFor(shape) {
    const explicit = Number(shape?.teamNumber);
    if (Number.isFinite(explicit) && explicit > 0) return Math.floor(explicit);
    const slot = Number(shape?.slot);
    return Number.isFinite(slot) && slot > 0 ? slot <= 2 ? Math.floor(slot) : 1 : 1;
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
