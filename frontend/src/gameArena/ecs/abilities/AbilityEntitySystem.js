import { angleDelta, clamp, movingCirclesDistance, movingCirclesIntersect, normalizeAngle, rayIntersectsCircle } from "../../gameconfig/geometry.js";
import { entityAbilitySpawnTransform, movingEntityCollision } from "../../gameconfig/hitboxGeometry.js";
import { advanceEntityAge, runEntityWorld, withComponentState } from "../entities/EntityWorld.js";
import {
    attachedAbilityContract,
    attachedAbilityTargetsOwner,
    EFFECT_TYPES,
    entityAbilitySpawnForEntity,
    eventAllowsEffect,
    eventTargetsKind,
    PHASE_ACTIONS,
    PHASE_EVENT_TYPES,
    TARGET_KINDS,
    resolveEffectOverride,
} from "../contracts/AbilityContracts.js";
import { amountAtDistance, durationAtDistance } from "./AbilityEffectSystem.js";
import { ignoresHostileEffects } from "../../gameconfig/DefensiveState.js";
import { compassDirection, vectorToCompassDegrees } from "../../botlogic/planner/arenaAngles.js";
import { ACTION_TO_ABILITY } from "../../loadout/BotLoadout.js";
import {
    ENTITY_CATEGORIES,
    entityAbilityPhaseForEntity,
    entityContract,
    phaseForEntity as canonicalPhaseForEntity,
    phasesForEntity,
} from "../contracts/AbilityContracts.js";
import { dispatchEntityEvent } from "./EntityEventSystem.js";
import { BASE_BOT_HP } from "../../modelPayloads/arenaConstants.js";
import {
    clearPresenceStatuses,
    statusEffectFor,
    statusIsActive,
    upsertStatusEffect,
} from "../contracts/StatusContracts.js";
import { abilityHitsTarget } from "./AbilityHitDetectionSystem.js";

export function isAbilityEntity(entity) {
    return phasesForEntity(entity).length > 0;
}

/**
 * Advances persistent ability entities through generic contract-defined
 * phases. The phase type is the only runtime dispatch key for lifecycle,
 * movement, collision, summon, and self phases.
 */
export function tickAbilityEntityWorld(world, combat) {
    const staged = runEntityWorld({
        ...world,
        entities: world.entities.map((entity) => withComponentState(entity, {
            tickStartHp: entity.hp == null ? null : Number(entity.hp),
            damageTakenThisTick: 0,
        })).map((entity) => advanceEntityAge(entity, world.stepMs)),
        bots: resetContractPresenceState(world),
    }, [
        markTriggeredEntities(combat),
        tickTrapEntities(combat),
        tickRemainingEntities(combat),
    ]);
    return {
        ...staged,
        entities: staged.entities.map((entity) => {
            const { phaseEnteredThisTick: _phaseEnteredThisTick, ...settled } = entity;
            return withComponentState(settled, {
                damageTakenLastTick: Number(entity.damageTakenThisTick ?? 0),
                damageTakenThisTick: 0,
                hpNetChangeLastTick: entity.hp == null || entity.tickStartHp == null
                    ? 0
                    : Number(entity.hp) - Number(entity.tickStartHp),
            });
        }),
    };
}

function resetContractPresenceState(world) {
    return world.bots.map((bot) => clearPresenceStatuses(bot));
}

function markTriggeredEntities(combat) {
    return (world) => ({
        entities: world.entities.map((entity) => {
            const contract = contractForEntity(entity);
            const phase = canonicalPhaseForEntity(entity);
            if (contract?.category !== ENTITY_CATEGORIES.TRAP || !phase?.trigger) return entity;
            const triggerDetected = trapHitByCurrentWorld(entity, phase, world, combat);
            return withComponentState(entity, {
                hitTriggered: triggerDetected,
                killedByDamage: false,
            });
        }),
    });
}

function tickTrapEntities(combat) {
    return (world) => {
        const trapEntries = world.entities
            .map((entity) => ({ entity, contract: contractForEntity(entity), phase: canonicalPhaseForEntity(entity) }))
            .filter(({ contract, phase }) => contract?.category === ENTITY_CATEGORIES.TRAP
                && phase?.trigger);
        if (trapEntries.length === 0) return null;
        const removedByEntityCollision = entityCollisionRemovalIds(world);

        const moved = trapEntries
            .filter(({ entity }) => !removedByEntityCollision.has(entity.id))
            .map(({ entity, contract, phase }) => {
                let movedEntity = advancePhaseEntity(entity, phasesForEntity(contract), {}, world);
                let killedByDamage = false;
                if (phase?.health) {
                    const previousHp = Math.max(0, Number(movedEntity.hp ?? phase.health.hp ?? phase.health.maxHp ?? 0));
                    const damage = damageToEntity(movedEntity, world, combat);
                    const hp = Math.max(0, Number(movedEntity.hp ?? 0) - damage);
                    killedByDamage = previousHp > 0 && hp <= 0 && damage > 0;
                    movedEntity = withComponentState(movedEntity, {
                        hp,
                        damageTakenThisTick: Number(movedEntity.damageTakenThisTick ?? 0) + Math.max(0, damage),
                        ...(killedByDamage
                            ? { hitTriggered: true, killedByDamage: true }
                            : {}),
                    });
                }
                return {
                    entity: movedEntity,
                    contract,
                    phase: canonicalPhaseForEntity(movedEntity),
                    killedByDamage,
                };
            }).filter(({ entity, phase }) => !phase?.health
                || Number(entity.hp ?? 0) > 0
                || Boolean(entity.hitTriggered)
                || Boolean(entity.killedByDamage));
        const triggerEvents = resolveTrapTriggers(moved, world);
        let bots = world.bots;
        const trapIds = new Set(trapEntries.map(({ entity }) => entity.id));
        const entities = world.entities.filter((entity) => !trapIds.has(entity.id)
            && !removedByEntityCollision.has(entity.id));

        for (const entry of triggerEvents) {
            let nextEntity = entry.entity;
            const incomingPhase = canonicalPhaseForEntity(nextEntity) ?? entry.phase;
            const incomingEvent = nextEntity.killedByDamage
                ? PHASE_EVENT_TYPES.KILLED
                : Number(nextEntity.damageTakenThisTick ?? 0) > 0
                    ? PHASE_EVENT_TYPES.HIT
                    : null;
            if (incomingEvent) {
                const incomingHandler = incomingPhase?.events?.[incomingEvent];
                if (incomingEvent !== PHASE_EVENT_TYPES.KILLED || incomingHandler) {
                    const incomingResult = dispatchEntityEvent(nextEntity, incomingEvent, {
                        bots,
                        world: { ...world, bots },
                        combat,
                        phase: incomingPhase,
                    });
                    nextEntity = incomingResult.entity;
                    bots = incomingResult.bots;
                } else {
                    nextEntity = null;
                }
            }
            if (!nextEntity) continue;
            if (!entry.triggerEvent) {
                entities.push(nextEntity);
                continue;
            }
            const currentPhase = canonicalPhaseForEntity(nextEntity) ?? entry.phase;
            const eventType = entry.killedByDamage
                ? PHASE_EVENT_TYPES.COLLISION : entry.triggerEvent;
            const targets = trapEffectTargets(nextEntity, currentPhase, { ...world, bots });
            const eventResult = dispatchEntityEvent(nextEntity, eventType, {
                bots,
                world,
                combat,
                phase: currentPhase,
                targetIds: targets.map(({ bot }) => bot.id),
                targetDistances: new Map(targets.map(({ bot, collisionDistance }) => [bot.id, collisionDistance])),
            });
            nextEntity = eventResult.entity;
            bots = eventResult.bots;
            const enteredPhase = nextEntity ? canonicalPhaseForEntity(nextEntity) : null;
            if (nextEntity && eventType !== PHASE_EVENT_TYPES.COLLISION
                && enteredPhase && enteredPhase.id !== currentPhase?.id
                && enteredPhase.events?.[PHASE_EVENT_TYPES.COLLISION]) {
                const enteredTargets = trapEffectTargets(nextEntity, enteredPhase, { ...world, bots });
                const activeResult = dispatchEntityEvent(nextEntity, PHASE_EVENT_TYPES.COLLISION, {
                    bots,
                    world,
                    combat,
                    phase: enteredPhase,
                    targetIds: enteredTargets.map(({ bot }) => bot.id),
                    targetDistances: new Map(enteredTargets.map(({ bot, collisionDistance }) => [bot.id, collisionDistance])),
                });
                nextEntity = activeResult.entity;
                bots = activeResult.bots;
            }
            if (nextEntity?.phaseEnteredThisTick) {
                nextEntity = consumeEnteredPhaseTick(nextEntity, world.stepMs);
            }
            if (nextEntity) entities.push(nextEntity);
        }
        return { entities, bots };
    };
}

function consumeEnteredPhaseTick(entity, stepMs) {
    const step = Math.max(0, Number(stepMs ?? 0));
    return withComponentState(entity, {
        ...(entity.remainingMs == null ? {} : { remainingMs: Number(entity.remainingMs) - step }),
        phaseTimerMs: Number(entity.phaseTimerMs ?? 0) + step,
    });
}

function trapEffectTargets(entity, phase, world) {
    const stats = {};
    const triggerRadius = phase?.trigger?.radius;
    const radius = triggerRadius == null
        ? phaseRadius(stats, phase, phase?.hitbox?.radius, Number(entity.size ?? 0) / 2)
        : phaseStat(stats, phase, triggerRadius, Number(entity.size ?? 0) / 2)
            * Number(phase?.hitbox?.radiusMultiplier ?? 1);
    const sourcePoint = { x: Number(entity.x), y: Number(entity.y) };
    return world.bots
        .map((bot) => {
            if (!isEnemy(entity, bot, world.bots)
                || Number(bot.hp ?? BASE_BOT_HP) <= 0
                || ignoresHostileEffects(bot)) return null;
            const path = botMovementSegment(bot, world.stepMs);
            if (!movingCirclesIntersect(sourcePoint, sourcePoint, radius, path.start, path.end, Number(bot.size ?? 60) / 2)) return null;
            return {
                bot,
                collisionDistance: movingCirclesDistance(sourcePoint, sourcePoint, path.start, path.end),
            };
        })
        .filter(Boolean);
}

function resolveTrapTriggers(entries, world) {
    const triggerEvents = new Map();
    for (const { entity, phase } of entries) {
        const stats = {};
        const trigger = phase?.trigger ?? {};
        const entityPath = entityMovementSegment(entity);
        const lifetimeExpired = Boolean(phase?.trigger || entity.armed)
            && entity.remainingMs != null
            && Number(entity.remainingMs) <= 0;
        const contact = trigger.botContact && Boolean(phase?.trigger || entity.armed) && world.bots.some((bot) => {
                if (!isEnemy(entity, bot, world.bots)) return false;
                const botPath = botMovementSegment(bot, world.stepMs);
                return movingCirclesIntersect(
                    entityPath.start,
                    entityPath.end,
                    0,
                    botPath.start,
                    botPath.end,
                    phaseStat(stats, phase, trigger.radius, 0) + Number(bot.size ?? 60) / 2,
                );
            });
        if (Boolean(entity.hitTriggered) || contact) {
            triggerEvents.set(entity.id, PHASE_EVENT_TYPES.TRIGGER);
        } else if (lifetimeExpired) {
            triggerEvents.set(entity.id, PHASE_EVENT_TYPES.LIFETIME_END);
        }
    }

    let changed = true;
    while (changed) {
        changed = false;
        for (const source of entries.filter(({ entity }) =>
            triggerEvents.get(entity.id) === PHASE_EVENT_TYPES.TRIGGER)) {
            const trigger = source.phase?.trigger;
            if (!trigger?.chain) continue;
            const radius = phaseStat({},
                source.phase, trigger.radius, 0);
            for (const target of entries) {
                if (triggerEvents.has(target.entity.id)
                    || target.contract.abilityId !== source.contract.abilityId
                    || Math.hypot(target.entity.x - source.entity.x, target.entity.y - source.entity.y) > radius) continue;
                triggerEvents.set(target.entity.id, PHASE_EVENT_TYPES.TRIGGER);
                changed = true;
            }
        }
    }
    return entries.map((entry) => ({
        ...entry,
        triggerEvent: entry.killedByDamage
            ? PHASE_EVENT_TYPES.COLLISION : triggerEvents.get(entry.entity.id) ?? null,
    }));
}

function trapHitByCurrentWorld(entity, phase, world, combat) {
    const trigger = phase?.trigger ?? {};
    if (trigger.attackHits && world.bots.some((bot) => (bot.entityHitIds ?? []).includes(entity.id))) return true;
    if (trigger.projectileOverlap && world.entities.some((candidate) => candidate.id !== entity.id
        && canonicalPhaseForEntity(candidate)?.type === "projectile"
        && overlaps(candidate, entity, world.stepMs))) return true;
    return trigger.attackHits && world.bots.some((bot) => hostileAbilityCanHitEntity(bot)
        && typeof combat.abilityHitsTarget === "function"
        && combat.abilityHitsTarget(bot, entity));
}

function hostileAbilityCanHitEntity(bot) {
    return !attachedAbilityTargetsOwner(bot?.triggeredAbility);
}

function tickRemainingEntities(combat) {
    return (world) => {
        let bots = world.bots;
        const entities = [];
        const removedByEntityCollision = entityCollisionRemovalIds(world);
        for (const entity of world.entities) {
            if (removedByEntityCollision.has(entity.id)) continue;
            if (entity.phaseEnteredThisTick) {
                const ready = { ...entity };
                delete ready.phaseEnteredThisTick;
                entities.push(ready);
                continue;
            }
            if (entity.spawnedThisTick) {
                const ready = { ...entity };
                delete ready.spawnedThisTick;
                entities.push(ready);
                continue;
            }
            const phase = canonicalPhaseForEntity(entity);
            const contract = contractForEntity(entity);
            if (!contract || !phase?.type) {
                entities.push(entity);
                continue;
            }
            if (contract.category === ENTITY_CATEGORIES.TRAP && phase?.trigger) {
                entities.push(entity);
                continue;
            }
            const result = tickCanonicalEntity(entity, phase, { ...world, bots }, combat);
            bots = result.bots;
            if (result.entity) entities.push(result.entity);
            if (result.spawned?.length) entities.push(...result.spawned);
        }
        return { entities, bots };
    };
}

/**
 * Executes the current phase. The phase type is the only dispatch vocabulary.
 */
function tickCanonicalEntity(entity, phase, world, combat) {
    let effectivePhase = phase;
    let runtimeEntity = clearEntityPresenceStatuses(entity);
    let bots = world.bots;
    if (effectivePhase.health && effectivePhase.type !== "summon") {
        const incoming = processIncomingEntity(runtimeEntity, effectivePhase, world, combat);
        runtimeEntity = incoming.entity;
        bots = incoming.bots;
        effectivePhase = runtimeEntity ? canonicalPhaseForEntity(runtimeEntity) ?? effectivePhase : effectivePhase;
        if (!runtimeEntity) return { bots, entity: null };
    }
    if (effectivePhase.type === "projectile" || effectivePhase.type === "ray" || effectivePhase.type === "arc" || effectivePhase.type === "melee") {
        return tickCanonicalProjectile(runtimeEntity, effectivePhase, { ...world, bots }, combat);
    }
    if (effectivePhase.type === "zone") return tickCanonicalZone(runtimeEntity, effectivePhase, { ...world, bots }, combat);
    if (effectivePhase.type === "summon") return tickCanonicalSummon(runtimeEntity, effectivePhase, { ...world, bots }, combat);
    return { bots, entity: runtimeEntity };
}

function tickCanonicalProjectile(entity, phase, world, combat) {
    const contract = contractForEntity(entity);
    const stats = {};
    const stepMs = Number(world.stepMs ?? 0);
    const movement = phase.movement ?? {};
    const speed = resolvePhaseNumber(movement.speed, stats, phase, 0);
    const velocityMagnitude = Math.hypot(Number(entity.velocityX ?? 0), Number(entity.velocityY ?? 0));
    const direction = velocityMagnitude > 0.001
        ? {
            x: Number(entity.velocityX ?? 0) / velocityMagnitude,
            y: Number(entity.velocityY ?? 0) / velocityMagnitude,
        }
        : compassDirection(entity.rotation);
    const start = { x: Number(entity.x), y: Number(entity.y) };
    const rawEnd = {
        x: start.x + direction.x * speed,
        y: start.y + direction.y * speed,
    };
    const shouldMove = speed > 0;
    const end = shouldMove
        ? { x: clamp(rawEnd.x, 0, world.width), y: clamp(rawEnd.y, 0, world.height) }
        : start;
    const velocityX = shouldMove ? direction.x * speed : 0;
    const velocityY = shouldMove ? direction.y * speed : 0;
    const moved = withComponentState(entity, {
        x: end.x,
        y: end.y,
        velocityX,
        velocityY,
        traveled: Number(entity.traveled ?? 0) + Math.hypot(end.x - start.x, end.y - start.y),
        phaseId: phase.id,
        phaseTimerMs: Math.max(0, Number(entity.phaseTimerMs ?? 0) + stepMs),
        remainingMs: entity.remainingMs == null
            ? null : Number(entity.remainingMs) - stepMs,
        visualEventMs: Math.max(0, Number(entity.visualEventMs ?? 0) - stepMs),
        ...(entity.visibleMs == null ? {} : { visibleMs: Math.max(0, Number(entity.visibleMs) - stepMs) }),
    });
    const candidates = canonicalCollisionTargets(moved, phase, world, start, end);
    const selected = phase.hit?.mode === "nearest" ? candidates.slice(0, 1) : candidates;
    let next = moved;
    let bots = world.bots;
    const execution = phase.execution;
    const executionEvent = execution?.event ?? (phase.events?.interval ? PHASE_EVENT_TYPES.INTERVAL : null);
    const executionHandler = executionEvent == null ? null : phase.events?.[executionEvent];
    let intervalTimerMs = Number(entity.intervalTimerMs ?? 0) - stepMs;
    const intervalMs = executionHandler == null ? 0 : Math.max(1, resolvePhaseNumber(
        execution?.intervalMs
            ?? executionHandler.intervalMs
            ?? "intervalMs",
        stats,
        phase,
        stepMs,
    ));
    if (executionHandler != null && execution?.startImmediately === false
        && Number(entity.phaseTimerMs ?? 0) === 0) {
        intervalTimerMs = intervalMs - stepMs;
    }
    const shouldDispatch = executionHandler == null
        ? selected.length > 0
        : intervalTimerMs <= 0;
    if (shouldDispatch && selected.length > 0) {
        const result = dispatchEntityEvent(next, executionEvent ?? "collision", {
            bots,
            world,
            combat,
            phase,
            targetIds: selected.map(({ bot }) => bot.id),
            targetDistances: new Map(selected.map(({ bot, collisionDistance }) => [bot.id, collisionDistance])),
            effectSources: new Map(selected.map(({ bot }) => [bot.id, withComponentState(next, {
                x: start.x,
                y: start.y,
            })])),
        });
        next = result.entity;
        bots = result.bots;
        const enteredPhase = next && canonicalPhaseForEntity(next);
        if (enteredPhase && enteredPhase.id !== phase.id
            && enteredPhase.events?.collision?.actions?.includes("applyEffects")) {
            const enteredResult = dispatchEntityEvent(next, "collision", {
                bots,
                world,
                combat,
                phase: enteredPhase,
                targetIds: selected.map(({ bot }) => bot.id),
                // A projectile that transitions into an impact phase has
                // already established contact. Preserve the point-impact
                // damage semantics while later zone ticks use their actual
                // center distance.
                targetDistances: new Map(selected.map(({ bot }) => [bot.id, 0])),
            });
            next = enteredResult.entity;
            bots = enteredResult.bots;
        }
    }
    if (executionHandler != null) {
        if (shouldDispatch) intervalTimerMs += intervalMs;
        if (next) next = withComponentState(next, { intervalTimerMs });
    }
    if (!next) return { bots, entity: null };
    const phaseExpired = phase.durationMs != null
        && Number(next.phaseTimerMs ?? 0) >= Number(phase.durationMs);
    const hitEdge = end.x === 0 || end.x === world.width || end.y === 0 || end.y === world.height;
    const removeAtEdge = hitEdge && phase.events?.collision?.actions?.includes("remove");
    const overallExpired = phase.durationMs == null && lifetimeExpired(next, contract)
        || next.remainingMs != null && Number(next.remainingMs) <= 0;
    if (phaseExpired || overallExpired || removeAtEdge) {
        const ended = dispatchEntityEvent(next, "lifetimeEnd", { bots, world, combat, phase });
        return {
            bots: ended.bots,
            entity: ended.entity === next && !phase.events?.lifetimeEnd ? null : ended.entity,
        };
    }
    return { bots, entity: next };
}

function tickCanonicalZone(entity, phase, world, combat) {
    const contract = contractForEntity(entity);
    const stats = {};
    const stepMs = Number(world.stepMs ?? 0);
    const nextPhase = phase;
    let next = entity;
    next = withComponentState(next, {
        phaseId: nextPhase.id,
        phaseTimerMs: Math.max(0, Number(next.phaseTimerMs ?? 0) + stepMs),
        remainingMs: remainingLifetime(next, contract, stepMs),
        visualEventMs: Math.max(0, Number(next.visualEventMs ?? 0) - stepMs),
        ...(next.visibleMs == null ? {} : { visibleMs: Math.max(0, Number(next.visibleMs) - stepMs) }),
    });
    let bots = world.bots;
    const targets = canonicalCollisionTargets(next, nextPhase, world);
    const lifecycleActive = next.remainingMs == null
        || Number(entity.remainingMs ?? next.remainingMs) > 0;
    const execution = nextPhase.execution;
    const executionEvent = execution?.event ?? (nextPhase.events?.interval ? PHASE_EVENT_TYPES.INTERVAL : null);
    const executionHandler = executionEvent == null ? null : nextPhase.events?.[executionEvent];
    if (executionHandler && lifecycleActive) {
        const intervalMs = Math.max(1, resolvePhaseNumber(
            execution?.intervalMs
                ?? executionHandler.intervalMs
                ?? "intervalMs",
            stats,
            nextPhase,
            stepMs,
        ));
        let intervalTimerMs = Number(entity.intervalTimerMs ?? 0) - stepMs;
        if (execution?.startImmediately === false && Number(entity.phaseTimerMs ?? 0) === 0) {
            intervalTimerMs = intervalMs - stepMs;
        }
        const intervalCanRunOnThisTick = lifecycleActive;
        while (intervalTimerMs <= 0 && intervalCanRunOnThisTick) {
                const result = dispatchEntityEvent(next, executionEvent, {
                bots,
                world,
                combat,
                phase: nextPhase,
                targetIds: targets.map(({ bot }) => bot.id),
                targetDistances: new Map(targets.map(({ bot, collisionDistance }) => [bot.id, collisionDistance])),
            });
            next = result.entity;
            bots = result.bots;
            intervalTimerMs += intervalMs;
            if (!next) break;
        }
        if (!next) return { bots, entity: null };
        next = withComponentState(next, { intervalTimerMs });
    } else if (lifecycleActive && nextPhase.events?.collision && targets.length > 0) {
        const result = dispatchEntityEvent(next, "collision", {
            bots,
            world,
            combat,
            phase: nextPhase,
            targetIds: targets.map(({ bot }) => bot.id),
            targetDistances: new Map(targets.map(({ bot, collisionDistance }) => [bot.id, collisionDistance])),
        });
        next = result.entity;
        bots = result.bots;
    }
    if (!next) return { bots, entity: null };
    const phaseExpired = nextPhase.durationMs != null
        && Number(next.phaseTimerMs ?? 0) >= Number(nextPhase.durationMs);
    if (phaseExpired || Number(next.remainingMs ?? 0) <= 0) {
        // A transient event visual is still carried by this same logical
        // entity after gameplay lifetime ends. It is presentation-only while
        // the event timer counts down, so no collision work runs above.
        if (Number(next.visualEventMs ?? 0) > 0) return { bots, entity: next };
        const ended = dispatchEntityEvent(next, "lifetimeEnd", { bots, world, combat, phase: nextPhase });
        const enteredPhase = ended.entity && canonicalPhaseForEntity(ended.entity);
        if (enteredPhase && enteredPhase.id !== nextPhase.id
            && enteredPhase.events?.collision?.actions?.includes("applyEffects")) {
            const enteredTargets = canonicalCollisionTargets(ended.entity, enteredPhase, world);
            return dispatchEntityEvent(ended.entity, "collision", {
                bots: ended.bots,
                world,
                combat,
                phase: enteredPhase,
                targetIds: enteredTargets.map(({ bot }) => bot.id),
                targetDistances: new Map(enteredTargets.map(({ bot, collisionDistance }) => [bot.id, collisionDistance])),
            });
        }
        return {
            bots: ended.bots,
            entity: ended.entity === next && !nextPhase.events?.lifetimeEnd ? null : ended.entity,
        };
    }
    return { bots, entity: next };
}

function tickCanonicalSummon(entity, phase, world, combat) {
    // Summons retain their specialized seeking/health loop, but attacks go
    // through the same phase event dispatcher as every other targetable type.
    const contract = contractForEntity(entity);
    const stats = {};
    const stepMs = Number(world.stepMs ?? 0);
    const remainingMs = remainingLifetime(entity, contract, stepMs);
    const previousHp = Math.max(0, Number(entity.hp ?? phase.health?.hp ?? phase.health?.maxHp ?? 0));
    let bots = world.bots;
    let summon = tickSummonStatuses(entity, stepMs);
    summon = withComponentState(summon, {
        remainingMs,
        intervalTimerMs: Math.max(0, Number(entity.intervalTimerMs ?? 0) - stepMs),
        shotVisualMs: Math.max(0, Number(entity.shotVisualMs ?? 0) - stepMs),
    });
    summon = applyIncomingEntityEffects(summon, world, combat);
    let damage = Math.max(0, previousHp - Number(summon.hp ?? previousHp));
    if (damage === 0 && phase.health) {
        const legacyDamage = Math.max(0, damageToEntity(entity, world, combat));
        if (legacyDamage > 0) {
            summon = withComponentState(summon, {
                hp: Math.max(0, previousHp - legacyDamage),
                damageTakenThisTick: Number(summon.damageTakenThisTick ?? 0) + legacyDamage,
            });
            damage = legacyDamage;
        }
    }
    const killedByDamage = previousHp > 0 && Number(summon.hp ?? 0) <= 0 && damage > 0;
    let currentPhase = phase;
    if (damage > 0) {
        const eventType = killedByDamage ? PHASE_EVENT_TYPES.KILLED : PHASE_EVENT_TYPES.HIT;
        const handler = currentPhase.events?.[eventType];
        if (handler) {
            const result = dispatchEntityEvent(summon, eventType, {
                bots,
                world: { ...world, bots },
                combat,
                phase: currentPhase,
            });
            summon = result.entity;
            bots = result.bots;
        }
        if (!summon || killedByDamage && !handler) return { bots, entity: null };
        const incomingPhase = canonicalPhaseForEntity(summon);
        if (Number(summon.hp ?? 0) <= 0 && (!incomingPhase || incomingPhase.health)) return { bots, entity: null };
        currentPhase = incomingPhase ?? currentPhase;
    }
    if (Number(summon.hp ?? 0) <= 0 && currentPhase.health) return { bots, entity: null };
    if (remainingMs <= 0) {
        const ended = dispatchEntityEvent(summon, "lifetimeEnd", {
            bots,
            world: { ...world, bots },
            combat,
            phase: currentPhase,
        });
        return {
            bots: ended.bots,
            entity: ended.entity === summon && !currentPhase.events?.lifetimeEnd ? null : ended.entity,
        };
    }

    const target = bots
        .filter((bot) => isEnemy(summon, bot, bots) && Number(bot.hp ?? 0) > 0)
        .sort((first, second) => Math.hypot(first.x - summon.x, first.y - summon.y) - Math.hypot(second.x - summon.x, second.y - summon.y))[0];
    if (!target) return { bots, entity: summon };

    const dx = target.x - summon.x;
    const dy = target.y - summon.y;
    const targetDistance = Math.max(1, Math.hypot(dx, dy));
    const desiredRotation = vectorToCompassDegrees(dx, dy);
    const movement = currentPhase.movement ?? {};
    const turn = resolvePhaseNumber(movement.turnDegrees, stats, currentPhase, 8);
    const speed = summonCanMove(summon)
        ? resolvePhaseNumber(movement.speed, stats, currentPhase, 0) * summonMovementMultiplier(summon)
        : 0;
    const rotation = normalizeAngle(Number(summon.rotation ?? 0) + clamp(
        angleDelta(Number(summon.rotation ?? 0), desiredRotation),
        -turn,
        turn,
    ));
    const summonSize = resolvePhaseNumber(movement.size, stats, currentPhase, Number(summon.size ?? 28));
    summon = withComponentState(summon, {
        x: clamp(summon.x + dx / targetDistance * Math.min(speed, targetDistance), summonSize / 2, world.width - summonSize / 2),
        y: clamp(summon.y + dy / targetDistance * Math.min(speed, targetDistance), summonSize / 2, world.height - summonSize / 2),
        rotation,
    });

    const execution = currentPhase.execution;
    const abilityPhase = entityAbilityPhaseForEntity(summon);
    const abilitySpawn = entityAbilitySpawnForEntity(summon);
    const abilityTransform = entityAbilitySpawnTransform(summon, abilitySpawn, rotation);
    const range = resolvePhaseNumber(
        abilityPhase?.hitbox?.range ?? abilityPhase?.hitbox?.length,
        stats,
        abilityPhase,
        0,
    );
    const intervalMs = Math.max(1, Number(execution?.intervalMs ?? 0));
    if (execution?.abilityId != null && abilityPhase
        && summonCanExecute(summon)
        && Number(summon.intervalTimerMs ?? 0) <= 0
        && rayIntersectsCircle({ ...summon, x: abilityTransform.x, y: abilityTransform.y }, abilityTransform.rotation, range, target)) {
        const result = dispatchEntityEvent(summon, PHASE_EVENT_TYPES.COLLISION, {
            bots,
            world,
            combat,
            phase: abilityPhase,
            targetIds: [target.id],
            targetDistances: new Map([[target.id, Math.hypot(target.x - abilityTransform.x, target.y - abilityTransform.y)]]),
            effectSources: new Map([[target.id, summon]]),
        });
        bots = result.bots;
        summon = result.entity;
        if (!summon) return { bots, entity: null };
        summon = withComponentState(summon, {
            intervalTimerMs: intervalMs,
            shotVisualMs: Math.max(0, Number(abilityPhase.visual?.visibleMs
                ?? abilityPhase.durationMs ?? 300) - stepMs),
        });
    }
    return { bots, entity: summon };
}

/** Applies incoming HP effects before a non-summon entity advances its phase. */
function processIncomingEntity(entity, phase, world, combat) {
    const previousHp = Math.max(0, Number(entity.hp ?? phase.health?.hp ?? phase.health?.maxHp ?? 0));
    let next = applyIncomingEntityEffects(entity, world, combat);
    const damage = Math.max(0, previousHp - Number(next?.hp ?? previousHp));
    let bots = world.bots;
    if (damage <= 0 || !next) return { entity: next, bots };

    const killed = previousHp > 0 && Number(next.hp ?? 0) <= 0;
    const eventType = killed ? PHASE_EVENT_TYPES.KILLED : PHASE_EVENT_TYPES.HIT;
    const handler = phase.events?.[eventType];
    if (handler) {
        const result = dispatchEntityEvent(next, eventType, {
            bots,
            world: { ...world, bots },
            combat,
            phase,
        });
        next = result.entity;
        bots = result.bots;
    }
    if (!next || killed && !handler || Number(next.hp ?? 0) <= 0) {
        return { entity: null, bots };
    }
    return { entity: next, bots };
}

/**
 * Resolves all contract effects that can reach one HP-bearing entity. The
 * target phase decides whether this is damage-only (ordinary HP entity) or a
 * full summon target. This is deliberately separate from bot combat because
 * entity status state lives on the entity payload.
 */
function applyIncomingEntityEffects(target, world, combat) {
    if (!target || target.hp == null) return target;
    const targetPhase = canonicalPhaseForEntity(target);
    const summonTarget = targetPhase?.type === "summon";
    let next = target;

    for (const bot of world.bots ?? []) {
        const abilityId = ACTION_TO_ABILITY[bot?.triggeredAbility];
        const contract = attachedAbilityContract(abilityId);
        const phase = contract?.phases?.[0];
        const eventType = attachedAbilityTargetsOwner(abilityId)
            ? PHASE_EVENT_TYPES.ACTIVATION : PHASE_EVENT_TYPES.COLLISION;
        const event = phase?.events?.[eventType];
        if (!abilityId || !phase || !event
            || !event.actions?.includes(PHASE_ACTIONS.APPLY_EFFECTS)
            || !eventCanAffectHpEntity(event, summonTarget)
            || !isEnemy(target, bot, world.bots)
            || !abilityHitsTarget(bot, next, abilityId)) continue;
        const distance = Math.hypot(Number(next.x) - Number(bot.x), Number(next.y) - Number(bot.y));
        const botDamage = typeof combat?.triggeredAbilityDamage === "function"
            ? Number(combat.triggeredAbilityDamage(bot, next)) : 0;
        next = applyIncomingImpact(next, {
            source: bot,
            abilityId,
            phase,
            event,
            distance,
            damage: botDamage,
        }, summonTarget, world);
    }

    for (const source of world.entities ?? []) {
        if (!source || source.id === target.id || !entityOwnersAreHostile(source, target, world.bots)) continue;
        const phase = canonicalPhaseForEntity(source);
        const event = phase?.events?.[PHASE_EVENT_TYPES.COLLISION];
        const collision = entityEffectCollision(source, target);
        if (!phase || !event || !collision
            || !event.actions?.includes(PHASE_ACTIONS.APPLY_EFFECTS)
            || !eventCanAffectHpEntity(event, summonTarget)) continue;
        next = applyIncomingImpact(next, {
            source,
            abilityId: source.abilityId,
            phase,
            event,
            distance: collision.distance,
            damage: null,
        }, summonTarget, world);
    }
    return next;
}

function applyIncomingImpact(target, impact, summonTarget, world) {
    const { source, abilityId, phase, event, distance } = impact;
    const allowed = normalizedEffectTypes(event.effectTypes ?? event.effects);
    const overrides = event.effectOverrides ?? phase.effectOverrides;
    let next = target;
    let damageApplied = 0;
    for (const declared of phase.effects ?? []) {
        const effect = typeof declared === "string" ? { type: declared } : declared;
        if (!effect?.type || allowed && !allowed.has(effect.type)
            || !eventAllowsEffect(event, effect)) continue;
        if (!summonTarget && effect.type !== EFFECT_TYPES.DAMAGE) continue;
        const resolved = resolveEffectOverride(effect, overrides);
        if (resolved.type === EFFECT_TYPES.DAMAGE) {
            const amount = impact.damage == null
                ? amountAtDistance(abilityId, distance, resolved, phase.statOverrides)
                    * Number(source.damageMultiplier ?? 1)
                : impact.damage;
            const hpBefore = Math.max(0, Number(next.hp ?? 0));
            const hp = Math.max(0, hpBefore - Math.max(0, Number(amount) || 0));
            damageApplied += hpBefore - hp;
            next = withComponentState(next, {
                hp,
                damageTakenThisTick: Number(next.damageTakenThisTick ?? 0) + hpBefore - hp,
            });
        } else if (resolved.type === EFFECT_TYPES.STATUS) {
            next = applySummonStatus(next, resolved, abilityId, distance, phase);
        } else if (resolved.type === EFFECT_TYPES.INTERRUPT) {
            next = applySummonInterrupt(next, abilityId, durationAtDistance(abilityId, distance, resolved, phase.statOverrides));
        } else if (resolved.type === EFFECT_TYPES.KNOCKBACK) {
            next = moveEntityAway(next, source, amountAtDistance(abilityId, distance, resolved, phase.statOverrides), world);
        } else if (resolved.type === EFFECT_TYPES.PULL) {
            next = moveEntityToward(next, source, amountAtDistance(abilityId, distance, resolved, phase.statOverrides), world);
        }
    }
    return damageApplied > 0 ? next : next;
}

function applySummonStatus(target, effect, abilityId, distance, phase) {
    const subtype = String(effect.subtype ?? "").toLowerCase();
    if (!subtype) return target;
    const presence = Boolean(effect.whileInside);
    const durationMs = durationAtDistance(abilityId, distance, effect, phase.statOverrides);
    if (durationMs <= 0 && !presence) return target;
    const intervalMs = Math.max(0, Number(effect.intervalMs ?? 0));
    const amount = intervalMs > 0
        ? amountAtDistance(abilityId, distance, effect, phase.statOverrides) : 0;
    const applications = subtype === "slow"
        ? [{ type: "movement_modifier", mode: "constant", movementMultiplier: 0.85 }]
        : subtype === "silence"
            ? [{ type: "silence", mode: "constant" }]
            : subtype === "stun"
                ? [{ type: "stun", mode: "constant" }]
                : intervalMs > 0
                    ? [{ type: "damage", mode: "tick", amount }]
                    : [];
    let next = upsertStatusEffect(target, {
        type: subtype,
        mode: presence ? "presence" : "duration",
        remainingMs: durationMs,
        intervalMs,
        amount,
        movementLockMs: Number(effect.movementLockMs ?? 0),
        effects: applications,
    });
    if (subtype === "silence" || subtype === "stun") next = resetSummonExecution(next);
    return next;
}

function applySummonInterrupt(target, abilityId, durationMs) {
    if (durationMs <= 0) return resetSummonExecution(target);
    return resetSummonExecution(upsertStatusEffect(target, {
        type: "stun",
        abilityId,
        remainingMs: durationMs,
        effects: [{ type: "stun", mode: "constant" }],
    }));
}

function resetSummonExecution(entity) {
    const intervalMs = Number(canonicalPhaseForEntity(entity)?.execution?.intervalMs ?? 1000);
    return withComponentState(entity, { intervalTimerMs: Math.max(1, intervalMs) });
}

function tickSummonStatuses(entity, stepMs) {
    const step = Math.max(0, Number(stepMs ?? 0));
    const statuses = Array.isArray(entity.statusEffects) ? entity.statusEffects : [];
    if (statuses.length === 0) return entity;
    let hp = Math.max(0, Number(entity.hp ?? 0));
    let damage = 0;
    const nextStatuses = [];
    const pendingMovementLocks = [];
    for (const rawStatus of statuses) {
        const status = { ...rawStatus };
        if (status.mode === "presence") {
            nextStatuses.push({ ...status, remainingMs: 0 });
            continue;
        }
        const remainingBefore = Math.max(0, Number(status.remainingMs ?? 0));
        const activeStep = Math.min(step, remainingBefore);
        const intervalMs = Math.max(0, Number(status.intervalMs ?? status.tickMs ?? 0));
        let tickElapsedMs = Math.max(0, Number(status.tickElapsedMs ?? 0)) + activeStep;
        if (intervalMs > 0 && activeStep > 0 && tickElapsedMs >= intervalMs) {
            const ticks = Math.floor(tickElapsedMs / intervalMs);
            tickElapsedMs -= ticks * intervalMs;
            const tickDamage = Math.max(0, Number(status.amount
                ?? status.effects?.find((effect) => effect.type === "damage")?.amount ?? 0));
            const applied = Math.min(hp, tickDamage * ticks);
            hp -= applied;
            damage += applied;
            if (status.movementLockMs > 0) pendingMovementLocks.push(status.movementLockMs);
        }
        const remainingMs = remainingBefore - step;
        if (remainingMs > 0) nextStatuses.push({ ...status, remainingMs, tickElapsedMs });
    }
    let next = withComponentState(entity, {
        hp,
        statusEffects: nextStatuses,
        damageTakenThisTick: Number(entity.damageTakenThisTick ?? 0) + damage,
    });
    for (const lockMs of pendingMovementLocks) {
        next = upsertStatusEffect(next, {
            type: "stun",
            remainingMs: lockMs,
            effects: [{ type: "stun", mode: "constant" }],
        });
    }
    return damage > 0 ? next : next;
}

function clearEntityPresenceStatuses(entity) {
    if (!Array.isArray(entity?.statusEffects)) return entity;
    const remaining = entity.statusEffects.filter((status) => status?.mode !== "presence");
    return remaining.length === entity.statusEffects.length
        ? entity
        : withComponentState(entity, { statusEffects: remaining });
}

function summonCanMove(entity) {
    return !statusIsActive(entity, "stun") && !statusIsActive(entity, "interrupt");
}

function summonCanExecute(entity) {
    return summonCanMove(entity) && !statusIsActive(entity, "silence");
}

function summonMovementMultiplier(entity) {
    const status = statusEffectFor(entity, "slow");
    const multiplier = status?.effects?.find((effect) => effect.type === "movement_modifier")?.movementMultiplier;
    const value = Number(multiplier);
    return Number.isFinite(value) && value >= 0 ? value : status ? 0.85 : 1;
}

function normalizedEffectTypes(effects) {
    if (!Array.isArray(effects) || effects.length === 0) return null;
    return new Set(effects.map((effect) => typeof effect === "string" ? effect : effect?.type).filter(Boolean));
}

function entityEffectCollision(source, target) {
    const sourcePath = entityMovementSegment(source);
    const targetPath = entityMovementSegment(target);
    const collision = movingEntityCollision(
        source,
        sourcePath.start,
        sourcePath.end,
        target,
        targetPath.start,
        targetPath.end,
    );
    return collision?.hit ? collision : null;
}

function eventCanAffectHpEntity(event, summonTarget) {
    return Boolean(event) && (eventTargetsKind(event, TARGET_KINDS.HP_ENTITY)
        || summonTarget && eventTargetsKind(event, TARGET_KINDS.BOT));
}

function moveEntityAway(target, source, distance, world) {
    const dx = Number(target.x) - Number(source.x);
    const dy = Number(target.y) - Number(source.y);
    const magnitude = Math.max(0.001, Math.hypot(dx, dy));
    const radius = Number(target.size ?? 0) / 2;
    return withComponentState(target, {
        x: clamp(Number(target.x) + dx / magnitude * Number(distance || 0), radius, Number(world.width) - radius),
        y: clamp(Number(target.y) + dy / magnitude * Number(distance || 0), radius, Number(world.height) - radius),
    });
}

function moveEntityToward(target, source, distance, world) {
    const dx = Number(source.x) - Number(target.x);
    const dy = Number(source.y) - Number(target.y);
    const magnitude = Math.max(0.001, Math.hypot(dx, dy));
    const radius = Number(target.size ?? 0) / 2;
    return withComponentState(target, {
        x: clamp(Number(target.x) + dx / magnitude * Number(distance || 0), radius, Number(world.width) - radius),
        y: clamp(Number(target.y) + dy / magnitude * Number(distance || 0), radius, Number(world.height) - radius),
    });
}

function canonicalCollisionTargets(entity, phase, world, start = null, end = null) {
    const targetEventType = phase.execution?.event
        ?? (phase.events?.[PHASE_EVENT_TYPES.INTERVAL]
            ? PHASE_EVENT_TYPES.INTERVAL : PHASE_EVENT_TYPES.COLLISION);
    const targetEvent = phase.events?.[targetEventType]
        ?? phase.events?.[PHASE_EVENT_TYPES.COLLISION];
    if (!eventTargetsKind(targetEvent, TARGET_KINDS.BOT)) return [];
    const skipOwner = Boolean(phase.skipOwner);
    const entityStart = start ?? { x: Number(entity.x), y: Number(entity.y) };
    const entityEnd = end ?? entityStart;
    const radius = phaseRadius({}, phase, "radius", Number(entity.size ?? 0) / 2);
    return world.bots
        .map((bot) => {
            if (!isEnemy(entity, bot, world.bots)
                || skipOwner && Number(bot.slot) === Number(entity.ownerSlot)
                || Number(bot.hp ?? BASE_BOT_HP) <= 0
                || ignoresHostileEffects(bot)) return null;
            const botPath = botMovementSegment(bot, world.stepMs);
            const collision = phase.hitbox?.shape === "circle"
                ? movingCirclesIntersect(entityStart, entityEnd, radius, botPath.start, botPath.end, Number(bot.size ?? 60) / 2)
                : movingEntityCollision(entity, entityStart, entityEnd, bot, botPath.start, botPath.end);
            const hit = phase.hitbox?.shape === "circle" ? Boolean(collision) : Boolean(collision?.hit);
            if (!hit) return null;
            return {
                bot,
                collisionDistance: phase.hitbox?.shape === "circle"
                    ? movingCirclesDistance(entityStart, entityEnd, botPath.start, botPath.end)
                    : collision.distance ?? movingCirclesDistance(entityStart, entityEnd, botPath.start, botPath.end),
            };
        })
        .filter(Boolean)
        .sort((first, second) => first.collisionDistance - second.collisionDistance);
}

function resolvePhaseNumber(value, stats, phase, fallback = 0) {
    if (value == null) return Number(fallback);
    if (typeof value === "number") return value;
    if (typeof value === "string") return Number(phase?.statOverrides?.[value] ?? stats[value] ?? fallback);
    return Number(value?.value ?? value?.fallback ?? fallback);
}

function lifetimeExpired(entity, contract) {
    const duration = Number(contract?.lifetime?.duration);
    if (!Number.isFinite(duration)) return false;
    return Number(entity?.ageMs ?? 0) >= duration + Number(contract?.lifetime?.add ?? 0);
}

function remainingLifetime(entity, contract, stepMs) {
    if (entity?.remainingMs != null) return Number(entity.remainingMs) - Number(stepMs ?? 0);
    const duration = Number(contract?.lifetime?.duration);
    if (!Number.isFinite(duration)) return null;
    return duration + Number(contract?.lifetime?.add ?? 0) - Number(entity?.ageMs ?? 0);
}

function phaseStat(stats, phase, name, fallback = 0) {
    if (name == null) return Number(fallback);
    if (typeof name === "number") return name;
    if (typeof name === "object") {
        return Number(name.value ?? name.fallback ?? fallback);
    }
    return Number(phase?.statOverrides?.[name] ?? stats?.[name] ?? fallback);
}

function phaseRadius(stats, phase, fallbackStat = null, fallback = 0) {
    const radius = phaseStat(stats, phase, phase?.hitbox?.radius ?? fallbackStat, fallback);
    return radius * Number(phase?.hitbox?.radiusMultiplier ?? 1);
}

/** Advances a trigger-bearing entity in its explicitly selected phase. */
function advancePhaseEntity(entity, phases, stats, world) {
    const stepMs = Number(world.stepMs ?? 0);
    const phase = canonicalPhaseForEntity(entity) ?? phases?.[0];
    const movement = phase?.movement ?? {};
    const radius = Number(entity.size ?? 0) / 2;
    const speed = resolvePhaseNumber(movement.speed, stats, phase, 0);
    const moving = speed > 0;
    let velocityX = Number(entity.velocityX ?? 0);
    let velocityY = Number(entity.velocityY ?? 0);
    if (moving) {
        const magnitude = Math.hypot(velocityX, velocityY);
        if (magnitude > 0) {
            velocityX *= speed / magnitude;
            velocityY *= speed / magnitude;
        } else {
            const direction = compassDirection(entity.rotation);
            velocityX = direction.x * speed;
            velocityY = direction.y * speed;
        }
    } else {
        velocityX = 0;
        velocityY = 0;
    }
    const nextX = moving
        ? clamp(Number(entity.x) + velocityX, radius, world.width - radius)
        : Number(entity.x);
    const nextY = moving
        ? clamp(Number(entity.y) + velocityY, radius, world.height - radius)
        : Number(entity.y);
    const phaseId = phase?.id ?? entity.phaseId ?? null;
    const phaseTimerMs = phase ? Math.max(0, Number(entity.phaseTimerMs ?? 0) + stepMs) : 0;
    return withComponentState(entity, {
        x: nextX,
        y: nextY,
        velocityX,
        velocityY,
        traveled: Number(entity.traveled ?? 0) + Math.hypot(nextX - Number(entity.x), nextY - Number(entity.y)),
        phaseId,
        phaseTimerMs,
        remainingMs: Math.max(0, Number(entity.remainingMs ?? stats.durationMs ?? 0) - stepMs),
        armed: phaseId === "armed" || Boolean(entity.armed),
    });
}

function damageToEntity(entity, world, combat) {
    let damage = 0;
    const teamProtectedSummon = canonicalPhaseForEntity(entity)?.type === "summon";
    for (const bot of world.bots) {
        if (teamProtectedSummon && !isEnemy(entity, bot, world.bots)) continue;
        if (typeof combat.triggeredAbilityDamage === "function") damage += combat.triggeredAbilityDamage(bot, entity);
    }
    for (const effect of world.entities ?? []) {
        if (effect.id === entity.id) continue;
        const phase = canonicalPhaseForEntity(effect);
        const collision = damagingEntityCollision(effect, entity, world.bots);
        if (!collision) continue;
        const damageEffect = phase.effects
            ?.find((declared) => declared.type === EFFECT_TYPES.DAMAGE) ?? null;
        if (!damageEffect) continue;
        const resolvedDamageEffect = resolveEffectOverride(damageEffect, phase.effectOverrides);
        damage += amountAtDistance(effect.abilityId, collision.distance, resolvedDamageEffect, phase.statOverrides)
            * Number(effect.damageMultiplier ?? 1);
    }
    return damage;
}

function entityCollisionRemovalIds(world) {
    const removed = new Set();
    const targets = (world.entities ?? []).filter((entity) => {
        const phase = canonicalPhaseForEntity(entity);
        return phase?.health && Number(entity.hp ?? 0) > 0;
    });
    for (const source of world.entities ?? []) {
        const sourcePhase = canonicalPhaseForEntity(source);
        const collisionEvent = sourcePhase?.events?.[PHASE_EVENT_TYPES.COLLISION];
        if (!collisionEvent?.actions?.includes(PHASE_ACTIONS.APPLY_EFFECTS)
            || !collisionEvent.actions.includes(PHASE_ACTIONS.REMOVE)) continue;
        for (const target of targets) {
            if (source.id === target.id || !entityOwnersAreHostile(source, target, world.bots)) continue;
            if (damagingEntityCollision(source, target, world.bots)) {
                removed.add(source.id);
                break;
            }
        }
    }
    return removed;
}

function damagingEntityCollision(source, target, bots = []) {
    const phase = canonicalPhaseForEntity(source);
    const collisionEvent = phase?.events?.[PHASE_EVENT_TYPES.COLLISION];
    if (!entityOwnersAreHostile(source, target, bots)
        || !eventCanAffectHpEntity(collisionEvent, canonicalPhaseForEntity(target)?.type === "summon")
        || !phase?.effects?.some((declared) =>
            (typeof declared === "string" ? declared : declared?.type) === EFFECT_TYPES.DAMAGE)
        || !collisionEvent?.actions?.includes(PHASE_ACTIONS.APPLY_EFFECTS)) return null;
    const sourcePath = entityMovementSegment(source);
    const targetPath = entityMovementSegment(target);
    const collision = movingEntityCollision(
        source,
        sourcePath.start,
        sourcePath.end,
        target,
        targetPath.start,
        targetPath.end,
    );
    return collision?.hit ? collision : null;
}

function entityOwnersAreHostile(source, target, bots = []) {
    if (!source || !target || source.id === target.id) return false;
    if (source.ownerSlot == null || target.ownerSlot == null) return true;
    const sourceOwner = bots.find((bot) => Number(bot?.slot) === Number(source.ownerSlot));
    const targetOwner = bots.find((bot) => Number(bot?.slot) === Number(target.ownerSlot));
    const sourceTeam = Number(sourceOwner?.teamNumber);
    const targetTeam = Number(targetOwner?.teamNumber);
    if (sourceTeam > 0 && targetTeam > 0) return sourceTeam !== targetTeam;
    return Number(source.ownerSlot) !== Number(target.ownerSlot);
}

function isEnemy(source, target, bots) {
    if (!source || !target) return false;
    if (target.id === source.ownerId) return false;
    const owner = bots?.find((bot) => bot?.id === source.ownerId
        || (Number.isFinite(Number(source.ownerSlot)) && Number(bot?.slot) === Number(source.ownerSlot)));
    const sourceTeam = Number(owner?.teamNumber ?? source.ownerTeam);
    const targetTeam = Number(target.teamNumber);
    if (Number.isFinite(sourceTeam) && Number.isFinite(targetTeam)
        && sourceTeam > 0 && targetTeam > 0) return sourceTeam !== targetTeam;
    return Number(target.slot) !== Number(source.ownerSlot);
}

function contractForEntity(entity) {
    return entityContract(entity?.entityContractId ?? entity?.abilityId ?? entity?.entityContractType ?? entity?.type);
}

function overlaps(first, second, stepMs = 100) {
    const firstPath = entityMovementSegment(first, stepMs);
    const secondPath = entityMovementSegment(second, stepMs);
    return movingEntityCollision(
        first,
        firstPath.start,
        firstPath.end,
        second,
        secondPath.start,
        secondPath.end,
    ).hit;
}

function entityMovementSegment(entity) {
    const startX = Number.isFinite(Number(entity.movementStartX))
        ? Number(entity.movementStartX)
        : Number(entity.x) - Number(entity.velocityX ?? 0);
    const startY = Number.isFinite(Number(entity.movementStartY))
        ? Number(entity.movementStartY)
        : Number(entity.y) - Number(entity.velocityY ?? 0);
    return {
        start: { x: startX, y: startY },
        end: { x: Number(entity.x), y: Number(entity.y) },
    };
}

function botMovementSegment(bot, stepMs) {
    const seconds = Math.max(Number(stepMs ?? 0) / 1000, 0);
    const startX = Number.isFinite(Number(bot.movementStartX))
        ? Number(bot.movementStartX)
        : Number(bot.x) - Number(bot.velocityX ?? 0) * seconds;
    const startY = Number.isFinite(Number(bot.movementStartY))
        ? Number(bot.movementStartY)
        : Number(bot.y) - Number(bot.velocityY ?? 0) * seconds;
    return {
        start: { x: startX, y: startY },
        end: { x: Number(bot.x), y: Number(bot.y) },
    };
}
