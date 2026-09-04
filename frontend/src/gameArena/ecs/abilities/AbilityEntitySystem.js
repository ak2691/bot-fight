import { ABILITY_STATS } from "../../gameconfig/Abilities.js";
import { angleDelta, clamp, movingCirclesDistance, movingCirclesIntersect, normalizeAngle, rayIntersectsCircle } from "../../gameconfig/geometry.js";
import { movingEntityCollision } from "../../gameconfig/hitboxGeometry.js";
import { advanceEntityAge, runEntityWorld, withComponentState } from "../entities/EntityWorld.js";
import { abilityContract, DELIVERY_TYPES, EFFECT_TYPES, PHASE_EVENT_TYPES, resolveEffectOverride } from "../../gameconfig/AbilityContracts.js";
import { amountAtDistance } from "./AbilityEffectSystem.js";
import { ignoresHostileEffects } from "../../gameconfig/DefensiveState.js";
import { vectorToCompassDegrees } from "../../botlogic/planner/arenaAngles.js";
import {
    ENTITY_CATEGORIES,
    entityContract,
    phaseForEntity as canonicalPhaseForEntity,
    phasesForEntity,
} from "../contracts/EntityContracts.js";
import { dispatchEntityEvent, transitionEntityPhase } from "./EntityEventSystem.js";
import { BASE_BOT_HP } from "../../modelPayloads/arenaConstants.js";
import { clearPresenceStatuses } from "../contracts/StatusContracts.js";

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
            const hitTriggered = trapHitByCurrentWorld(entity, phase, world, combat);
            const trigger = phase.trigger;
            const attackTriggered = hitTriggered;
            return withComponentState(entity, {
                hitTriggered: attackTriggered && !trigger.requiresDestruction,
                attackTriggered,
                destroyedByDamage: false,
            });
        }),
    });
}

function tickTrapEntities(combat) {
    return (world) => {
        const trapEntries = world.entities
            .map((entity) => ({ entity, contract: contractForEntity(entity), phase: canonicalPhaseForEntity(entity) }))
            .filter(({ entity, contract }) => !entity.phaseLocked
                && contract?.category === ENTITY_CATEGORIES.TRAP);
        if (trapEntries.length === 0) return null;

        const moved = trapEntries.map(({ entity, contract }) => {
            let movedEntity = advancePhaseEntity(entity, phasesForEntity(contract), ABILITY_STATS[contract.abilityId] ?? {}, world);
            if (contract.health && contract.collider?.hittable) {
                const damage = damageToEntity(movedEntity, world, combat);
                const hp = Math.max(0, Number(movedEntity.hp ?? 0) - damage);
                movedEntity = withComponentState(movedEntity, {
                    hp,
                    damageTakenThisTick: Number(movedEntity.damageTakenThisTick ?? 0) + Math.max(0, damage),
                    ...(hp <= 0 && damage > 0
                        ? { hitTriggered: true, destroyedByDamage: true }
                        : {}),
                });
            }
            return { entity: movedEntity, contract, phase: canonicalPhaseForEntity(movedEntity) };
        }).filter(({ entity, contract }) => !contract.health
            || Number(entity.hp ?? 0) > 0
            || Boolean(entity.hitTriggered));
        const triggered = resolveTrapTriggers(moved, world);
        let bots = world.bots;
        const trapIds = new Set(trapEntries.map(({ entity }) => entity.id));
        const entities = world.entities.filter((entity) => !trapIds.has(entity.id));

        for (const entry of triggered) {
            if (!entry.isTriggered) {
                entities.push(entry.entity);
                continue;
            }
            let nextEntity = entry.entity;
            const currentPhase = canonicalPhaseForEntity(nextEntity) ?? entry.phase;
            if (entry.contract.abilityId === 29 && nextEntity.destroyedByDamage) {
                nextEntity = transitionEntityPhase(nextEntity, "destroyed", world);
            }
            const effectPhase = canonicalPhaseForEntity(nextEntity) ?? currentPhase;
            const targets = trapEffectTargets(nextEntity, effectPhase, world);
            const eventResult = dispatchEntityEvent(nextEntity, "collision", {
                bots,
                world,
                combat,
                phase: effectPhase,
                targetIds: targets.map(({ bot }) => bot.id),
                targetDistances: new Map(targets.map(({ bot, collisionDistance }) => [bot.id, collisionDistance])),
            });
            nextEntity = eventResult.entity;
            bots = eventResult.bots;
            // Mine arming is a lifecycle transition, not the damage event.
            // Dispatch the newly entered active phase against the same target
            // IDs in this tick so contact damage is applied exactly once while
            // the entity identity and hit ledger remain unchanged.
            if (nextEntity && entry.contract.abilityId === 11
                && effectPhase?.id === "armed"
                && canonicalPhaseForEntity(nextEntity)?.id === "active") {
                const activePhase = canonicalPhaseForEntity(nextEntity);
                const activeResult = dispatchEntityEvent(nextEntity, "collision", {
                    bots,
                    world,
                    combat,
                    phase: activePhase,
                    targetIds: targets.map(({ bot }) => bot.id),
                    targetDistances: new Map(targets.map(({ bot, collisionDistance }) => [bot.id, collisionDistance])),
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
    const contract = contractForEntity(entity);
    const stats = ABILITY_STATS[contract?.abilityId] ?? {};
    const trigger = phase?.trigger ?? {};
    const radius = phaseRadius(stats, phase, trigger.radius, Number(entity.size ?? 0) / 2);
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
    const triggered = new Set(entries.filter(({ entity, phase, contract }) => {
        const stats = ABILITY_STATS[contract.abilityId] ?? {};
        const trigger = phase?.trigger ?? {};
        const entityPath = entityMovementSegment(entity);
        const armedExpired = Boolean(phase?.trigger || entity.armed)
            && entity.remainingMs != null
            && Number(entity.remainingMs) <= 0;
        return Boolean(entity.hitTriggered)
            || armedExpired
            || (trigger.botContact && Boolean(phase?.trigger || entity.armed) && world.bots.some((bot) => {
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
            }));
    }).map(({ entity }) => entity.id));

    let changed = true;
    while (changed) {
        changed = false;
        for (const source of entries.filter(({ entity }) => triggered.has(entity.id))) {
            const trigger = source.phase?.trigger;
            if (!trigger?.chain) continue;
            const radius = phaseStat(ABILITY_STATS[source.contract.abilityId],
                source.phase, trigger.radius, 0);
            for (const target of entries) {
                if (triggered.has(target.entity.id)
                    || target.contract.abilityId !== source.contract.abilityId
                    || Math.hypot(target.entity.x - source.entity.x, target.entity.y - source.entity.y) > radius) continue;
                triggered.add(target.entity.id);
                changed = true;
            }
        }
    }
    return entries.map((entry) => ({ ...entry, isTriggered: triggered.has(entry.entity.id) }));
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
    return abilityContract(bot?.triggeredAbility)?.delivery?.type !== DELIVERY_TYPES.SELF;
}

function tickRemainingEntities(combat) {
    return (world) => {
        let bots = world.bots;
        const entities = [];
        for (const entity of world.entities) {
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
            if (contract.category === ENTITY_CATEGORIES.TRAP && !entity.phaseLocked) {
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
    const contract = contractForEntity(entity);
    let effectivePhase = entity.phaseLocked
        ? phase
        : phaseAtElapsedCanonical(phasesForEntity(contract), Number(entity.ageMs ?? 0)) ?? phase;
    let runtimeEntity = entity;
    if (!entity.phaseLocked
        && entity.phaseId != null
        && effectivePhase.id !== entity.phaseId
        && (effectivePhase.durationMs != null || effectivePhase.visual?.visibleMs != null)) {
        // A timed phase is a lifecycle transition on the same entity ID.
        runtimeEntity = transitionEntityPhase(entity, effectivePhase.id, world);
        effectivePhase = canonicalPhaseForEntity(runtimeEntity) ?? effectivePhase;
    }
    if (effectivePhase.type === "projectile" || effectivePhase.type === "ray" || effectivePhase.type === "arc" || effectivePhase.type === "melee") {
        return tickCanonicalProjectile(runtimeEntity, effectivePhase, world, combat);
    }
    if (effectivePhase.type === "zone") return tickCanonicalZone(runtimeEntity, effectivePhase, world, combat);
    if (effectivePhase.type === "summon") return tickCanonicalSummon(runtimeEntity, effectivePhase, world, combat);
    return { bots: world.bots, entity: runtimeEntity };
}

function tickCanonicalProjectile(entity, phase, world, combat) {
    const contract = contractForEntity(entity);
    const stats = ABILITY_STATS[contract?.abilityId] ?? {};
    const phases = phasesForEntity(contract);
    const stepMs = Number(world.stepMs ?? 0);
    const previousPhase = phaseAtElapsedCanonical(phases, Math.max(0, Number(entity.ageMs ?? 0) - stepMs));
    // Locked phases own their movement. An armed grenade must remain stopped
    // even though its travel phase is still the last elapsed-time phase.
    const movement = (entity.phaseLocked ? phase : previousPhase)?.movement ?? phase.movement ?? {};
    const scale = movement.scale === "stepRatio" ? stepMs / 100 : 1;
    const start = { x: Number(entity.x), y: Number(entity.y) };
    const rawEnd = {
        x: start.x + Number(entity.velocityX ?? 0) * scale,
        y: start.y + Number(entity.velocityY ?? 0) * scale,
    };
    const shouldMove = movement.mode === "travel" || movement.mode === "segment";
    const end = shouldMove && movement.clamp
        ? { x: clamp(rawEnd.x, 0, world.width), y: clamp(rawEnd.y, 0, world.height) }
        : shouldMove ? rawEnd : start;
    const velocityX = movement.mode === "stopped" ? 0 : Number(entity.velocityX ?? 0);
    const velocityY = movement.mode === "stopped" ? 0 : Number(entity.velocityY ?? 0);
    const moved = withComponentState(entity, {
        x: end.x,
        y: end.y,
        velocityX,
        velocityY,
        traveled: Number(entity.traveled ?? 0) + Math.hypot(end.x - start.x, end.y - start.y),
        phaseId: phase.id,
        phaseTimerMs: entity.phaseLocked
            ? Math.max(0, Number(entity.phaseTimerMs ?? 0) + stepMs)
            : Math.max(0, Number(entity.ageMs ?? 0) - Number(phase.startMs ?? 0)),
        remainingMs: entity.phaseLocked
            ? Number(entity.remainingMs ?? stats.durationMs ?? 0) - stepMs
            : stats.durationMs != null
                ? Number(stats.durationMs) - Number(entity.ageMs ?? 0)
                : entity.remainingMs == null
                    ? null
                    : Number(entity.remainingMs) - stepMs,
        visualEventMs: Math.max(0, Number(entity.visualEventMs ?? 0) - stepMs),
        ...(entity.visibleMs == null ? {} : { visibleMs: Math.max(0, Number(entity.visibleMs) - stepMs) }),
    });
    const candidates = canonicalCollisionTargets(moved, phase, world, start, end);
    const selected = phase.hit?.mode === "nearest" ? candidates.slice(0, 1) : candidates;
    let next = moved;
    let bots = world.bots;
    const repeat = phase.repeat;
    const repeatEvent = repeat?.event ?? (phase.events?.interval ? PHASE_EVENT_TYPES.INTERVAL : null);
    const repeatHandler = repeatEvent == null ? null : phase.events?.[repeatEvent];
    let intervalTimerMs = Number(entity.intervalTimerMs ?? 0) - stepMs;
    const intervalMs = repeatHandler == null ? 0 : Math.max(1, resolvePhaseNumber(
        repeat?.intervalMs
            ?? repeatHandler.intervalMs
            ?? phase.persistence?.intervalMs
            ?? phase.persistence?.intervalStat
            ?? "intervalMs",
        stats,
        phase,
        stepMs,
    ));
    const shouldDispatch = repeatHandler == null
        ? selected.length > 0
        : intervalTimerMs <= 0;
    if (shouldDispatch && selected.length > 0) {
        const result = dispatchEntityEvent(next, repeatEvent ?? "collision", {
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
    if (repeatHandler != null) {
        intervalTimerMs += intervalMs;
        if (next) next = withComponentState(next, { intervalTimerMs });
    }
    if (!next) return { bots, entity: null };
    const phaseExpired = phase.durationMs != null
        && !next.phaseLocked
        && Number(next.ageMs ?? 0) >= Number(phase.startMs ?? 0) + Number(phase.durationMs);
    const hitEdge = end.x === 0 || end.x === world.width || end.y === 0 || end.y === world.height;
    const removeAtEdge = Boolean(phase.movement?.clamp) && hitEdge && phase.events?.collision?.actions?.includes("remove");
    if (phaseExpired || next.remainingMs != null && Number(next.remainingMs) <= 0 || removeAtEdge) {
        const ended = dispatchEntityEvent(next, "lifetimeEnd", { bots, world, combat, phase });
        return { bots: ended.bots, entity: ended.entity };
    }
    return { bots, entity: next };
}

function tickCanonicalZone(entity, phase, world, combat) {
    const contract = contractForEntity(entity);
    const stats = ABILITY_STATS[contract?.abilityId] ?? {};
    const stepMs = Number(world.stepMs ?? 0);
    let nextPhase = canonicalPhaseForEntity({
        ...entity,
        // A phase transition action opts out of elapsed-time phase selection;
        // ordinary phases continue to advance from their startMs values.
        phaseId: entity.phaseLocked ? entity.phaseId : null,
    }) ?? phase;
    let next = entity;
    if (!entity.phaseLocked
        && nextPhase.id !== entity.phaseId
        && (nextPhase.durationMs != null || nextPhase.visual?.visibleMs != null)) {
        // A timed phase owns a fresh lifetime. Keep the same entity ID while
        // resetting its phase timer and phase-local visual/lifetime values.
        next = transitionEntityPhase(entity, nextPhase.id, world);
        nextPhase = canonicalPhaseForEntity(next) ?? nextPhase;
    }
    next = withComponentState(next, {
        phaseId: nextPhase.id,
        phaseTimerMs: next.phaseLocked
            ? Math.max(0, Number(next.phaseTimerMs ?? 0) + stepMs)
            : Math.max(0, Number(next.ageMs ?? 0) - Number(nextPhase.startMs ?? 0)),
        remainingMs: Number(next.remainingMs ?? stats.durationMs ?? 0) - stepMs,
        visualEventMs: Math.max(0, Number(next.visualEventMs ?? 0) - stepMs),
        ...(next.visibleMs == null ? {} : { visibleMs: Math.max(0, Number(next.visibleMs) - stepMs) }),
    });
    let bots = world.bots;
    const targets = canonicalCollisionTargets(next, nextPhase, world);
    const lifecycleActive = next.remainingMs == null
        || Number(entity.remainingMs ?? next.remainingMs) > 0;
    const repeat = nextPhase.repeat;
    const repeatEvent = repeat?.event ?? (nextPhase.events?.interval ? PHASE_EVENT_TYPES.INTERVAL : null);
    const intervalHandler = repeatEvent == null ? null : nextPhase.events?.[repeatEvent];
    if (intervalHandler && lifecycleActive) {
        const intervalMs = Math.max(1, resolvePhaseNumber(
            repeat?.intervalMs
                ?? intervalHandler.intervalMs
                ?? nextPhase.persistence?.intervalMs
                ?? nextPhase.persistence?.intervalStat
                ?? "intervalMs",
            stats,
            nextPhase,
            stepMs,
        ));
        let intervalTimerMs = Number(entity.intervalTimerMs ?? 0) - stepMs;
        const intervalCanRunOnThisTick = Number(entity.remainingMs ?? stats.durationMs ?? 0) > 0;
        while (intervalTimerMs <= 0 && intervalCanRunOnThisTick) {
            const result = dispatchEntityEvent(next, repeatEvent, {
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
    if (Number(next.remainingMs ?? 0) <= 0) {
        // A transient event visual is still carried by this same logical
        // entity after gameplay lifetime ends. It is presentation-only while
        // the event timer counts down, so no collision work runs above.
        if (Number(next.visualEventMs ?? 0) > 0) return { bots, entity: next };
        const ended = dispatchEntityEvent(next, "lifetimeEnd", { bots, world, combat, phase: nextPhase });
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
    const stats = ABILITY_STATS[contract?.abilityId] ?? {};
    const stepMs = Number(world.stepMs ?? 0);
    const remainingMs = Number(entity.remainingMs ?? stats.durationMs ?? 0) - stepMs;
    const damage = damageToEntity(entity, world, combat);
    const hp = Number(entity.hp ?? stats.hp ?? 0) - damage;
    if (remainingMs <= 0 || hp <= 0) return { bots: world.bots, entity: null };

    let bots = world.bots;
    const target = bots
        .filter((bot) => isEnemy(entity, bot, bots) && Number(bot.hp ?? 0) > 0)
        .sort((first, second) => Math.hypot(first.x - entity.x, first.y - entity.y) - Math.hypot(second.x - entity.x, second.y - entity.y))[0];
    let summon = withComponentState(entity, {
        hp,
        damageTakenThisTick: Number(entity.damageTakenThisTick ?? 0) + Math.max(0, damage),
        remainingMs,
        shotCooldownMs: Math.max(0, Number(entity.shotCooldownMs ?? 0) - stepMs),
        shotVisualMs: Math.max(0, Number(entity.shotVisualMs ?? 0) - stepMs),
    });
    if (!target) return { bots, entity: summon };

    const dx = target.x - summon.x;
    const dy = target.y - summon.y;
    const targetDistance = Math.max(1, Math.hypot(dx, dy));
    const desiredRotation = vectorToCompassDegrees(dx, dy);
    const movement = phase.movement ?? {};
    const rotation = normalizeAngle(Number(summon.rotation ?? 0) + clamp(
        angleDelta(Number(summon.rotation ?? 0), desiredRotation),
        -Number(stats[movement.turn ?? "turnStepDegrees"] ?? 8),
        Number(stats[movement.turn ?? "turnStepDegrees"] ?? 8),
    ));
    const summonSize = Number(stats[movement.size ?? "size"] ?? summon.size ?? 28);
    summon = withComponentState(summon, {
        x: clamp(summon.x + dx / targetDistance * Math.min(Number(stats[movement.speed ?? "speed"] ?? 0), targetDistance), summonSize / 2, world.width - summonSize / 2),
        y: clamp(summon.y + dy / targetDistance * Math.min(Number(stats[movement.speed ?? "speed"] ?? 0), targetDistance), summonSize / 2, world.height - summonSize / 2),
        rotation,
    });

    const attack = phase.attack;
    const range = resolvePhaseNumber(attack?.range ?? "range", stats, phase, 0);
    const cooldownField = attack?.cooldownField ?? "shotCooldownMs";
    const cooldownStat = attack?.cooldown ?? cooldownField;
    const visualField = attack?.visualField ?? "shotVisualMs";
    const visualStat = attack?.visual ?? visualField;
    if (attack && Number(summon[cooldownField] ?? 0) <= 0
        && rayIntersectsCircle(summon, rotation, range, target)) {
        const result = dispatchEntityEvent(summon, PHASE_EVENT_TYPES.COLLISION, {
            bots,
            world,
            combat,
            phase,
            targetIds: [target.id],
            targetDistances: new Map([[target.id, Math.hypot(target.x - summon.x, target.y - summon.y)]]),
            effectSources: new Map([[target.id, summon]]),
        });
        bots = result.bots;
        summon = result.entity;
        if (!summon) return { bots, entity: null };
        summon = withComponentState(summon, {
            [cooldownField]: resolvePhaseNumber(cooldownStat, stats, phase, 1000),
            [visualField]: Math.max(0, resolvePhaseNumber(visualStat, stats, phase, 300) - stepMs),
        });
    }
    return { bots, entity: summon };
}

function canonicalCollisionTargets(entity, phase, world, start = null, end = null) {
    const contract = contractForEntity(entity);
    const skipOwner = Boolean(phase.skipOwner);
    const entityStart = start ?? { x: Number(entity.x), y: Number(entity.y) };
    const entityEnd = end ?? entityStart;
    const radius = phaseRadius(ABILITY_STATS[contract?.abilityId] ?? {}, phase, "radius", Number(entity.size ?? 0) / 2);
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

function phaseAtElapsedCanonical(phases, elapsedMs) {
    if (!Array.isArray(phases) || phases.length === 0) return null;
    return phases.reduce((current, candidate) => !candidate.transitionOnly
        && Number(candidate.startMs ?? 0) >= 0
        && Number(candidate.startMs ?? 0) <= elapsedMs
        && (!current || Number(candidate.startMs ?? 0) > Number(current.startMs ?? 0))
        ? candidate : current, phases[0]);
}

function resolvePhaseNumber(value, stats, phase, fallback = 0) {
    if (value == null) return Number(fallback);
    if (typeof value === "number") return value;
    if (typeof value === "string") return Number(phase?.statOverrides?.[value] ?? stats[value] ?? fallback);
    return Number(value?.value ?? value?.fallback ?? fallback);
}

function phaseStat(stats, phase, name, fallback = 0) {
    if (name == null) return Number(fallback);
    return Number(phase?.statOverrides?.[name] ?? stats?.[name] ?? fallback);
}

function phaseRadius(stats, phase, fallbackStat = null, fallback = 0) {
    const radius = phaseStat(stats, phase, phase?.hitbox?.radius ?? fallbackStat, fallback);
    return radius * Number(phase?.hitbox?.radiusMultiplier ?? 1);
}

/** Advances a multi-phase entity from elapsed lifecycle time. */
function advancePhaseEntity(entity, phases, stats, world) {
    const stepMs = Number(world.stepMs ?? 0);
    const elapsedMs = Number(entity.ageMs ?? 0);
    const previousElapsedMs = Math.max(0, elapsedMs - stepMs);
    const previousPhase = phaseAtElapsedCanonical(phases, previousElapsedMs);
    const phase = phaseAtElapsedCanonical(phases, elapsedMs) ?? previousPhase;
    const movement = previousPhase?.movement ?? {};
    const radius = Number(entity.size ?? 0) / 2;
    const moving = movement.mode === "travel" || movement.mode === "segment";
    let velocityX = Number(entity.velocityX ?? 0);
    let velocityY = Number(entity.velocityY ?? 0);
    const speedOverride = previousPhase?.movement?.speed ?? previousPhase?.statOverrides?.speed;
    if (moving && speedOverride != null && Number.isFinite(Number(speedOverride))) {
        const magnitude = Math.hypot(velocityX, velocityY);
        if (magnitude > 0) {
            velocityX *= Number(speedOverride) / magnitude;
            velocityY *= Number(speedOverride) / magnitude;
        }
    }
    const nextX = moving
        ? clamp(Number(entity.x) + velocityX, radius, world.width - radius)
        : Number(entity.x);
    const nextY = moving
        ? clamp(Number(entity.y) + velocityY, radius, world.height - radius)
        : Number(entity.y);
    const phaseId = phase?.id ?? entity.phaseId ?? null;
    const phaseTimerMs = phase ? Math.max(0, elapsedMs - Number(phase.startMs ?? 0)) : 0;
    const stopped = phase?.movement?.mode === "stopped";
    return withComponentState(entity, {
        x: nextX,
        y: nextY,
        velocityX: stopped ? 0 : velocityX,
        velocityY: stopped ? 0 : velocityY,
        traveled: Number(entity.traveled ?? 0) + Math.hypot(nextX - Number(entity.x), nextY - Number(entity.y)),
        phaseId,
        phaseTimerMs,
        remainingMs: Math.max(0, Number(stats.durationMs ?? entity.remainingMs ?? 0) - elapsedMs),
        armed: phaseId === "armed" || Boolean(entity.armed),
    });
}

function damageToEntity(entity, world, combat) {
    let damage = 0;
    for (const bot of world.bots) {
        if (typeof combat.triggeredAbilityDamage === "function") damage += combat.triggeredAbilityDamage(bot, entity);
    }
    for (const effect of world.entities ?? []) {
        if (effect.id === entity.id) continue;
        const phase = canonicalPhaseForEntity(effect);
        const collision = phase?.events?.collision;
        if (phase?.type !== "zone"
            || !phase.effects?.some((declared) =>
                (typeof declared === "string" ? declared : declared?.type) === EFFECT_TYPES.DAMAGE)
            || !collision?.actions?.includes("applyEffects")) continue;
        const damageEffect = abilityContract(effect.abilityId)?.effects
            ?.find((declared) => declared.type === EFFECT_TYPES.DAMAGE) ?? null;
        if (!damageEffect) continue;
        const resolvedDamageEffect = resolveEffectOverride(damageEffect, phase.effectOverrides);
        const effectPath = entityMovementSegment(effect);
        const entityPath = entityMovementSegment(entity);
        const distance = movingCirclesDistance(effectPath.start, effectPath.end, entityPath.start, entityPath.end);
        if (movingCirclesIntersect(
            effectPath.start,
            effectPath.end,
            Number(effect.size ?? 0) / 2,
            entityPath.start,
            entityPath.end,
            Number(entity.size ?? 0) / 2,
        )) {
            damage += amountAtDistance(effect.abilityId, distance, resolvedDamageEffect, phase.statOverrides)
                * Number(effect.damageMultiplier ?? 1);
        }
    }
    return damage;
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
