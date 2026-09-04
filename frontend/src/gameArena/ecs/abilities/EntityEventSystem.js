import { ABILITY_STATS } from "../../gameconfig/Abilities.js";
import {
    PHASE_ACTIONS,
    PHASE_EVENT_TYPES,
    PERSISTENCE_MODES,
} from "../../gameconfig/AbilityContracts.js";
import { applyEntityEffects } from "./EntityEffectSystem.js";
import { entityContract, phaseForEntity } from "../contracts/EntityContracts.js";
import { withComponentState } from "../entities/EntityWorld.js";

/**
 * Dispatches a contract event to one entity.
 *
 * Collision detection deliberately stays outside this module. A detector
 * supplies stable target IDs and this dispatcher turns those IDs into the
 * allowlisted payload changes declared by the current phase. That keeps
 * geometry, lifecycle transitions, and bot-payload mutation independent and
 * makes two copies of the same entity maintain independent hit ledgers.
 */
export function dispatchEntityEvent(entity, eventType, {
    bots = [],
    world = {},
    combat,
    phase = phaseForEntity(entity),
    targetIds = [],
    targetDistances = null,
    effectSources = null,
    collisionDistance = undefined,
} = {}) {
    const handler = phase?.events?.[eventType];
    if (!handler) return { entity, bots, emittedVisuals: [] };

    let nextEntity = entity;
    let nextBots = bots;
    const contract = entityContract(entity?.entityContractId ?? entity?.abilityId ?? entity?.type);
    const abilityId = nextEntity?.abilityId ?? contract?.abilityId;
    const emittedVisuals = [];
    const targets = normalizeTargetIds(targetIds);
    const actions = Array.isArray(handler.actions) ? handler.actions : [];
    const effectTypes = normalizeEffectTypes(handler.effects ?? phase.effects ?? phase.effectTypes);


    for (const action of actions) {
        if (action === PHASE_ACTIONS.APPLY_EFFECTS) {
            for (const targetId of targets) {
                const targetIndex = findTargetIndex(nextBots, targetId);
                if (targetIndex < 0 || !canHitTarget(nextEntity, targetId, phase, world, eventType)) continue;
                const target = nextBots[targetIndex];
                const targetDistance = targetDistances instanceof Map
                    ? targetDistances.get(targetId)
                    : targetDistances?.[targetId];
                const effectSource = effectSources instanceof Map
                    ? effectSources.get(targetId) ?? nextEntity
                    : nextEntity;
                const result = applyEntityEffects(
                    nextBots,
                    targetIndex,
                    effectSource,
                    abilityId,
                    combat,
                    {
                        effectTypes,
                        world,
                        knockbackDirection: handler.knockbackDirection ?? phase.knockbackDirection ?? "source",
                        collisionDistance: Number.isFinite(Number(targetDistance))
                            ? Number(targetDistance)
                            : collisionDistance,
                        effectOverrides: handler.effectOverrides ?? phase.effectOverrides,
                        statOverrides: phase.statOverrides,
                    },
                );
                nextBots = result.bots;
                nextEntity = recordTargetHit(nextEntity, target, phase, world);
            }
        } else if (action === PHASE_ACTIONS.TRANSITION) {
            nextEntity = transitionEntityPhase(
                nextEntity,
                handler.transition ?? handler.phaseId ?? handler.to,
                world,
            );
        } else if (action === PHASE_ACTIONS.EMIT_VISUAL) {
            const visual = phase.visual ?? null;
            const eventVisual = handler.visual ?? null;
            const visibleMs = resolveNumber(
                handler.visibleMs ?? eventVisual?.visibleMs ?? visual?.visibleMs,
                nextEntity,
                world,
                0,
            );
            const visualType = handler.visualType ?? eventVisual?.type ?? visual?.type ?? null;
            const visualSize = resolveNumber(
                handler.visualSize ?? eventVisual?.visualSize ?? visual?.visualSize,
                nextEntity,
                world,
                Number(nextEntity.size ?? 0),
            );
            nextEntity = withComponentState(nextEntity, {
                visualEvent: Number(nextEntity.visualEvent ?? 0) + 1,
                visualEventType: visualType,
                visualEventMs: visibleMs,
                ...(visibleMs > 0 ? { visibleMs } : {}),
            });
            emittedVisuals.push({
                type: visualType,
                size: visualSize,
                visibleMs,
            });
        } else if (action === PHASE_ACTIONS.REMOVE) {
            nextEntity = null;
        }

        if (!nextEntity) break;
    }

    return { entity: nextEntity, bots: nextBots, emittedVisuals };
}

/** Applies an event to the owner, useful for self phases and activation hooks. */
export function dispatchEntityOwnerEvent(entity, eventType, options = {}) {
    const owner = (options.bots ?? []).find((bot) => bot?.id === entity?.ownerId)
        ?? (options.bots ?? []).find((bot) => Number(bot?.slot) === Number(entity?.ownerSlot));
    return dispatchEntityEvent(entity, eventType, {
        ...options,
        targetIds: owner ? [owner.id] : [],
    });
}

/** Returns whether this entity may affect a target during the current phase. */
export function canHitTarget(entity, targetId, phase = phaseForEntity(entity), world = {}, eventType = null) {
    const persistence = phase?.persistence;
    const mode = persistence?.mode ?? PERSISTENCE_MODES.EVERY_TICK;
    if (mode === PERSISTENCE_MODES.EVERY_TICK) return true;
    // An INTERVAL event is already emitted by the phase scheduler. The
    // scheduler is the cooldown for that event, so applying the same
    // interval a second time as a per-target gate would skip the first pulse
    // after a boundary. The ledger still governs collision events, where an
    // entity can see a target every tick and each target needs its own clock.
    if (eventType === PHASE_EVENT_TYPES.INTERVAL || phase?.repeat?.event === eventType) return true;
    const key = targetKey(targetId);
    const lastHit = entity?.hitLedger?.[key];
    if (!lastHit) return true;
    if (mode === PERSISTENCE_MODES.ONCE) return false;

    const intervalMs = persistenceIntervalMs(persistence, entity, world);
    return eventTimestampMs(entity, world) - Number(lastHit.atMs ?? 0) >= intervalMs;
}

/** Changes phase without replacing the entity identity. */
export function transitionEntityPhase(entity, phaseId, world = {}) {
    if (!entity || phaseId == null) return entity;
    const contract = entityContract(entity.entityContractId ?? entity.abilityId ?? entity.type);
    const nextPhase = contract?.phases?.find((phase) => phase.id === phaseId);
    if (!nextPhase) return entity;

    const visualLifetime = resolveNumber(
        nextPhase.durationMs ?? nextPhase.visual?.visibleMs,
        entity,
        world,
        null,
    );
    const changes = {
        phaseId,
        phaseTimerMs: 0,
        phaseLocked: true,
        phaseEnteredThisTick: true,
        ...(nextPhase.movement?.mode === "stopped" ? { velocityX: 0, velocityY: 0 } : {}),
        // Persistence is phase-local. A target affected by a fuse phase can
        // be affected again by the damage phase of the same logical entity.
        hitLedger: {},
        ...(nextPhase.type === "zone" || nextPhase.type === "self" ? { armed: true } : {}),
        ...(visualLifetime == null ? {} : {
            remainingMs: visualLifetime,
            visibleMs: visualLifetime,
        }),
    };
    return withComponentState(entity, changes);
}

function recordTargetHit(entity, target, phase, world) {
    const mode = phase?.persistence?.mode ?? PERSISTENCE_MODES.EVERY_TICK;
    if (mode === PERSISTENCE_MODES.EVERY_TICK) return entity;
    const key = targetKey(target);
    return withComponentState(entity, {
        hitLedger: {
            ...(entity.hitLedger ?? {}),
            // The entity clock is advanced at the start of a fixed tick. Store
            // the time at which this event was evaluated, not the end-of-tick
            // clock value, so an interval measured in ticks remains intuitive:
            // a hit on tick 3 with a five-tick interval is eligible on tick 8.
            [key]: { atMs: eventTimestampMs(entity, world) },
        },
    });
}

function eventTimestampMs(entity, world) {
    return Math.max(
        0,
        Number(entity?.ageMs ?? 0) - Math.max(0, Number(world?.stepMs ?? 0)),
    );
}

function persistenceIntervalMs(persistence, entity, world) {
    const raw = persistence?.intervalMs ?? persistence?.cooldownMs ?? 0;
    const value = resolveNumber(raw, entity, world, Number(world.stepMs ?? 0));
    if (persistence?.unit === "ticks" || persistence?.intervalTicks != null) {
        const ticks = Number(persistence.intervalTicks ?? value);
        return Math.max(0, ticks * Number(world.stepMs ?? 0));
    }
    return Math.max(0, value);
}

function resolveNumber(value, entity, world, fallback) {
    if (value == null) return fallback;
    if (typeof value === "number") return value;
    if (typeof value === "string") {
        const stats = ABILITY_STATS[Number(entity?.abilityId)] ?? {};
        const statValue = stats[value];
        return statValue == null ? Number(value) || fallback : Number(statValue);
    }
    if (typeof value === "object") {
        if (value.stat != null) return resolveNumber(value.stat, entity, world, value.fallback ?? fallback);
        if (value.value != null) return resolveNumber(value.value, entity, world, fallback);
    }
    return fallback;
}

function normalizeEffectTypes(effects) {
    if (!Array.isArray(effects)) return null;
    return effects.map((effect) => typeof effect === "string" ? effect : effect?.type).filter(Boolean);
}

function normalizeTargetIds(targetIds) {
    return [...new Set((Array.isArray(targetIds) ? targetIds : [targetIds])
        .filter((targetId) => targetId != null)
        .map((targetId) => typeof targetId === "object" ? targetId.id ?? targetId.slot : targetId))];
}

function findTargetIndex(bots, targetId) {
    return bots.findIndex((bot) => bot?.id === targetId || String(bot?.slot) === String(targetId));
}

function targetKey(target) {
    return String(typeof target === "object" ? target?.id ?? target?.slot : target);
}
