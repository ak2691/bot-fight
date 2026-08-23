import { ABILITY_STATS } from "../../gameconfig/Abilities.js";
import { angleDelta, clamp, movingCircleCollision, movingCirclesDistance, movingCirclesIntersect, normalizeAngle, rayIntersectsCircle } from "../../gameconfig/geometry.js";
import { advanceEntityAge, runEntityWorld, withComponentState } from "../entities/EntityWorld.js";
import { abilityContract, DELIVERY_TYPES, EFFECT_TYPES, SHIELD_CHARGE_COSTS } from "../../gameconfig/AbilityContracts.js";
import { damageAtDistance } from "./AbilityEffectSystem.js";
import { ignoresHostileEffects } from "../../gameconfig/DefensiveState.js";
import { vectorToCompassDegrees } from "../../botlogic/planner/arenaAngles.js";
import { ENTITY_CATEGORIES, ENTITY_SYSTEM_TYPES, entityContract, entitySystemType } from "../contracts/EntityContracts.js";
import { applyEntityEffects } from "./EntityEffectSystem.js";
import { BASE_BOT_HP } from "../../modelPayloads/arenaConstants.js";
import { clearPresenceStatuses } from "../contracts/StatusContracts.js";

export function isAbilityEntity(entity) {
    return entitySystemType(entity) === ENTITY_SYSTEM_TYPES.ABILITY;
}

/**
 * Advances persistent ability entities through generic contract-defined
 * phases. Entity behavior is data in EntityContracts; this system only knows
 * how to execute lifecycle, trap, segment, zone, radial, summon, and visual
 * phases.
 */
export function tickAbilityEntityWorld(world, combat) {
    return runEntityWorld({
        ...world,
        entities: world.entities.map((entity) => advanceEntityAge(entity, world.stepMs)),
        bots: resetContractPresenceState(world),
    }, [
        markTriggeredEntities(combat),
        tickTrapEntities(combat),
        tickRemainingEntities(combat),
    ]);
}

function resetContractPresenceState(world) {
    return world.bots.map((bot) => clearPresenceStatuses(bot));
}

function markTriggeredEntities(combat) {
    return (world) => ({
        entities: world.entities.map((entity) => {
            const behavior = behaviorForEntity(entity);
            if (!["trap", "phase"].includes(behavior?.kind)) return entity;
            const phase = activePhase(entity, behavior);
            const trigger = phase?.trigger ?? behavior.trigger ?? {};
            const hitTriggered = trapHitByCurrentWorld(entity, behavior, world, combat);
            const attackTriggered = hitTriggered;
            return withComponentState(entity, {
                // These are per-tick trigger facts. HP resolution below turns
                // lethal damage into hitTriggered for death-gated traps.
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
            .map((entity) => ({ entity, contract: contractForEntity(entity), behavior: behaviorForEntity(entity) }))
            .filter(({ behavior }) => ["trap", "phase"].includes(behavior?.kind));
        if (trapEntries.length === 0) return null;

        const moved = trapEntries.map(({ entity, contract, behavior }) => {
            let movedEntity = behavior.kind === "phase"
                ? advancePhaseEntity(entity, behavior, ABILITY_STATS[contract.abilityId] ?? {}, world)
                : advanceTrapTravel(entity, behavior, ABILITY_STATS[contract.abilityId] ?? {}, world);
            if (contract.health && contract.collider?.hittable) {
                const damage = damageToEntity(movedEntity, world, combat);
                const hp = Math.max(0, Number(movedEntity.hp ?? 0) - damage);
                movedEntity = withComponentState(movedEntity, {
                    hp,
                    ...(hp <= 0 && damage > 0
                        ? { hitTriggered: true, destroyedByDamage: true }
                        : {}),
                });
            }
            return { entity: movedEntity, contract, behavior, phase: activePhase(movedEntity, behavior) };
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
            bots = applyZoneEffects(
                bots,
                entry.entity,
                entry.contract.abilityId,
                entry.phase?.effectTypes ?? entry.behavior.effectTypes,
                phaseStat(ABILITY_STATS[entry.contract.abilityId], entry.phase,
                    (entry.phase?.trigger ?? entry.behavior.trigger)?.radiusStat, 0),
                combat,
                world,
                {
                    effectOverrides: entry.phase?.effectOverrides,
                },
            );
            entities.push(createDerivedEntity(
                entry.entity,
                entry.phase?.explosion ?? entry.behavior.explosion,
                entry.contract,
                {
                    spawnedThisTick: true,
                    statOverrides: entry.phase?.statOverrides,
                },
            ));
        }
        return { entities, bots };
    };
}

function resolveTrapTriggers(entries, world) {
    const triggered = new Set(entries.filter(({ entity, behavior, contract }) => {
        const stats = ABILITY_STATS[contract.abilityId] ?? {};
        const phase = activePhase(entity, behavior);
        const trigger = phase?.trigger ?? behavior.trigger ?? {};
        const entityPath = entityMovementSegment(entity);
        const armedExpired = Boolean(phase?.trigger || entity.armed)
            && entity.remainingMs != null
            && Number(entity.remainingMs) <= 0;
        return Boolean(entity.hitTriggered)
            || armedExpired
            || (trigger.botContact && Boolean(phase?.trigger || entity.armed) && world.bots.some((bot) => {
                if (bot.slot === entity.ownerSlot) return false;
                const botPath = botMovementSegment(bot, world.stepMs);
                return movingCirclesIntersect(
                    entityPath.start,
                    entityPath.end,
                    0,
                    botPath.start,
                    botPath.end,
                    phaseStat(stats, phase, trigger.radiusStat, 0),
                );
            }));
    }).map(({ entity }) => entity.id));

    let changed = true;
    while (changed) {
        changed = false;
        for (const source of entries.filter(({ entity }) => triggered.has(entity.id))) {
            const trigger = activePhase(source.entity, source.behavior)?.trigger ?? source.behavior.trigger;
            if (!trigger?.chain) continue;
            const radius = phaseStat(ABILITY_STATS[source.contract.abilityId],
                activePhase(source.entity, source.behavior), trigger.radiusStat, 0);
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

function trapHitByCurrentWorld(entity, behavior, world, combat) {
    const trigger = activePhase(entity, behavior)?.trigger ?? behavior.trigger ?? {};
    const contract = contractForEntity(entity);
    const radius = phaseStat(ABILITY_STATS[contract?.abilityId], activePhase(entity, behavior), trigger.radiusStat, entity.size ?? 0);
    if (trigger.attackHits && world.bots.some((bot) => (bot.entityHitIds ?? []).includes(entity.id))) return true;
    if (trigger.projectileOverlap && (world.projectiles ?? []).some((projectile) => overlaps(projectile, entity, world.stepMs))) return true;
    if (trigger.projectileOverlap && world.entities.some((candidate) => candidate.id !== entity.id
        && entityCategory(candidate) === ENTITY_CATEGORIES.PROJECTILE
        && overlaps(candidate, entity, world.stepMs))) return true;
    return trigger.attackHits && world.bots.some((bot) => hostileAbilityCanHitEntity(bot)
        && typeof combat.abilityHitsTarget === "function"
        && combat.abilityHitsTarget(bot, { ...entity, size: radius }));
}

function hostileAbilityCanHitEntity(bot) {
    return abilityContract(bot?.triggeredAbility)?.delivery?.type !== DELIVERY_TYPES.SELF;
}

function tickRemainingEntities(combat) {
    return (world) => {
        let bots = world.bots;
        const entities = [];
        for (const entity of world.entities) {
            if (entity.spawnedThisTick) {
                const ready = { ...entity };
                delete ready.spawnedThisTick;
                entities.push(ready);
                continue;
            }
            const behavior = behaviorForEntity(entity);
            if (!behavior || ["trap", "phase"].includes(behavior.kind)) {
                entities.push(entity);
                continue;
            }
            const result = tickBehavior(entity, behavior, { ...world, bots }, combat);
            bots = result.bots;
            if (result.entity) entities.push(result.entity);
            if (result.spawned?.length) entities.push(...result.spawned);
        }
        return { entities, bots };
    };
}

function tickBehavior(entity, behavior, world, combat) {
    if (behavior.kind === "segment") return tickSegment(entity, behavior, world, combat);
    if (behavior.kind === "radial") return tickRadial(entity, behavior, world, combat);
    if (behavior.kind === "visualZone") return tickVisual(entity, behavior, world);
    if (behavior.kind === "zone") return tickZone(entity, behavior, world, combat);
    if (behavior.kind === "summon") return tickSummon(entity, behavior, world, combat);
    if (behavior.kind === "delayedZone") return tickDelayedZone(entity, behavior, world, combat);
    if (behavior.kind === "interval") return tickInterval(entity, behavior, world, combat);
    if (behavior.kind === "lifetime") return tickLifetime(entity, world);
    return { bots: world.bots, entity };
}

function tickSegment(entity, behavior, world, combat) {
    const contract = contractForEntity(entity);
    const movement = behavior.movement ?? {};
    const scale = movement.scale === "stepRatio" ? Number(world.stepMs ?? 100) / 100 : 1;
    const start = { x: Number(entity.x), y: Number(entity.y) };
    const rawEnd = {
        x: start.x + Number(entity.velocityX ?? 0) * scale,
        y: start.y + Number(entity.velocityY ?? 0) * scale,
    };
    const end = movement.clamp
        ? { x: clamp(rawEnd.x, 0, world.width), y: clamp(rawEnd.y, 0, world.height) }
        : rawEnd;
    const distance = Math.hypot(end.x - start.x, end.y - start.y);
    const hit = behavior.hit ?? {};
    const hitSlots = [...(entity.hitSlots ?? [])];
    let bots = world.bots;
    let blocked = false;
    const candidates = world.bots
        .map((bot, index) => ({ bot, index }))
        .filter(({ bot }) => bot.slot !== entity.ownerSlot
            && !hitSlots.includes(bot.slot)
            && Number(bot.hp ?? BASE_BOT_HP) > 0
            && !ignoresHostileEffects(bot)
        && movingCircleCollision(
                start,
                end,
                Number(entity.size ?? 0) / 2,
                botMovementSegment(bot, world.stepMs).start,
                botMovementSegment(bot, world.stepMs).end,
                Number(bot.size ?? 60) / 2,
            ).hit)
        .map((candidate) => ({
            ...candidate,
            collisionDistance: movingCirclesDistance(
                start,
                end,
                botMovementSegment(candidate.bot, world.stepMs).start,
                botMovementSegment(candidate.bot, world.stepMs).end,
            ),
        }))
        .sort((first, second) => first.collisionDistance - second.collisionDistance);
    const selected = hit.mode === "nearest" ? candidates.slice(0, 1) : candidates;
    for (const candidate of selected) {
        hitSlots.push(candidate.bot.slot);
        const result = applyEntityEffects(bots, candidate.index, entity, contract.abilityId, combat, {
            effectTypes: hit.effectTypes,
            world,
            knockbackDirection: hit.knockbackDirection,
            collisionDistance: candidate.collisionDistance,
        });
        bots = result.bots;
        if (result.shield?.preventedEffects?.size && hit.stopOnBlocked) {
            blocked = true;
            break;
        }
    }
    const remainingMs = Number(entity[behavior.lifetimeField] ?? 0) - Number(world.stepMs ?? 0);
    const traveled = Number(entity.traveled ?? 0) + distance;
    const hitEdge = end.x === 0 || end.x === world.width || end.y === 0 || end.y === world.height;
    const remove = (selected.length > 0 && hit.removeOnHit)
        || blocked
        || remainingMs <= 0
        || (hitEdge && movement.clamp);
    return {
        bots,
        entity: remove
            ? null
            : withComponentState(entity, { ...end, traveled, [behavior.lifetimeField]: remainingMs, hitSlots }),
    };
}

function tickRadial(entity, behavior, world, combat) {
    const contract = contractForEntity(entity);
    let bots = world.bots;
    if (!entity.damageApplied) {
        bots = applyZoneEffects(bots, entity, contract.abilityId, behavior.effectTypes, Number(entity.size ?? 0) / 2, combat, world);
    }
    const remainingMs = Number(entity.remainingMs ?? 0) - Number(world.stepMs ?? 0);
    return {
        bots,
        entity: remainingMs > 0 ? withComponentState(entity, { remainingMs, damageApplied: true }) : null,
    };
}

function tickVisual(entity, behavior, world) {
    const timerField = entity.visibleMs == null ? "remainingMs" : "visibleMs";
    const remaining = Number(entity[timerField] ?? behavior.durationMs ?? 0) - Number(world.stepMs ?? 0);
    return { bots: world.bots, entity: remaining > 0 ? withComponentState(entity, { [timerField]: remaining }) : null };
}

function tickZone(entity, behavior, world, combat) {
    if (behavior.phases?.length) return tickPhasedZone(entity, behavior, world, combat);
    const contract = contractForEntity(entity);
    const stats = ABILITY_STATS[contract.abilityId] ?? {};
    const movement = behavior.movement ?? null;
    const movementDurationMs = movement?.durationStat == null
        ? 0
        : Math.max(0, Number(stats[movement.durationStat] ?? 0));
    const hasFuse = Boolean(behavior.fuse);
    const fuseDurationMs = hasFuse ? Math.max(0, Number(stats[behavior.fuse.stat] ?? 0)) : 0;
    const durationPhase = movementDurationMs > 0 && !entity.armed;
    const fusePhase = Boolean(entity.armed)
        && hasFuse
        && Number(entity.phaseTimerMs ?? 0) < fuseDurationMs;
    const moving = durationPhase || (fusePhase && Boolean(movement?.continueDuringFuse));
    const moved = durationPhase
        ? advanceTravel(entity, movement, stats, world)
        : moving
            ? advanceFuseTravel(entity, world)
            : withComponentState(entity, { velocityX: 0, velocityY: 0, armed: true });
    const phaseTimerMs = durationPhase
        ? Number(moved.phaseTimerMs ?? 0)
        : hasFuse
            ? Math.min(fuseDurationMs, Number(entity.phaseTimerMs ?? 0) + Number(world.stepMs ?? 0))
            : 0;
    const fuseMs = hasFuse ? Math.max(0, fuseDurationMs - phaseTimerMs) : 0;
    const active = !durationPhase && (!hasFuse || phaseTimerMs >= fuseDurationMs);
    const remainingMs = Number(entity.remainingMs ?? stats.durationMs ?? 0) - (active ? Number(world.stepMs ?? 0) : 0);
    if (remainingMs <= 0) return { bots: world.bots, entity: null };

    let zone = withComponentState(moved, {
        ...(moving ? {} : { velocityX: 0, velocityY: 0 }),
        fuseMs,
        remainingMs,
        phaseTimerMs,
        armed: Boolean(moved.armed ?? true),
    });
    let bots = world.bots;
    if (!durationPhase && !active && behavior.preActiveEffectTypes) {
        bots = applyZoneEffects(bots, zone, contract.abilityId, behavior.preActiveEffectTypes, Number(zone.size ?? 0) / 2, combat, world, { skipShield: true });
    }
    if (active) {
        bots = applyZoneEffects(bots, zone, contract.abilityId, behavior.activeEffectTypes, Number(zone.size ?? 0) / 2, combat, world);
        if (behavior.explosion) {
            zone = createDerivedEntity(zone, behavior.explosion, contract);
        }
    }
    return { bots, entity: zone };
}

function tickPhasedZone(entity, behavior, world, combat) {
    const contract = contractForEntity(entity);
    const stats = ABILITY_STATS[contract.abilityId] ?? {};
    const moved = advancePhaseEntity(entity, behavior, stats, world);
    const phase = activePhase(moved, behavior);
    const previousPhase = entity.phaseId
        ? behavior.phases.find((candidate) => candidate.id === entity.phaseId)
        : phaseAtElapsed(behavior, Math.max(0, Number(entity.ageMs ?? 0) - Number(world.stepMs ?? 0)));
    const enteredPhase = previousPhase?.id !== phase?.id;
    const remainingMs = Number(moved.remainingMs ?? 0);
    let bots = world.bots;
    let next = withComponentState(moved, {
        phaseId: phase?.id ?? moved.phaseId,
        phaseTimerMs: moved.phaseTimerMs,
    });
    if (phase?.effectTypes?.length) {
                bots = applyZoneEffects(
            bots,
            next,
            contract.abilityId,
            phase.effectTypes,
            phaseStat(stats, phase, phase.radiusStat ?? "radius", next.size / 2),
            combat,
            world,
            {
                skipShield: Boolean(phase.skipShield),
                effectOverrides: phase.effectOverrides,
            },
        );
    }
    if (phase?.explosion && enteredPhase) {
        return {
            bots,
            entity: null,
            spawned: [createDerivedEntity(next, phase.explosion, contract, { statOverrides: phase.statOverrides })],
        };
    }
    return { bots, entity: remainingMs > 0 ? next : null };
}

function tickSummon(entity, behavior, world, combat) {
    const contract = contractForEntity(entity);
    const stats = ABILITY_STATS[contract.abilityId] ?? {};
    const remainingMs = Number(entity.remainingMs ?? stats.durationMs ?? 0) - Number(world.stepMs ?? 0);
    const hp = Number(entity.hp ?? stats.hp ?? 0) - damageToEntity(entity, world, combat);
    if (remainingMs <= 0 || hp <= 0) return { bots: world.bots, entity: null };

    let bots = world.bots;
    const target = bots
        .filter((bot) => bot.slot !== entity.ownerSlot && Number(bot.hp ?? 0) > 0)
        .sort((first, second) => Math.hypot(first.x - entity.x, first.y - entity.y) - Math.hypot(second.x - entity.x, second.y - entity.y))[0];
    let summon = withComponentState(entity, {
        hp,
        remainingMs,
        shotCooldownMs: Math.max(0, Number(entity.shotCooldownMs ?? 0) - Number(world.stepMs ?? 0)),
        shotVisualMs: Math.max(0, Number(entity.shotVisualMs ?? 0) - Number(world.stepMs ?? 0)),
    });
    if (!target) return { bots, entity: summon };

    const dx = target.x - summon.x;
    const dy = target.y - summon.y;
    const distance = Math.max(1, Math.hypot(dx, dy));
    const desiredRotation = vectorToCompassDegrees(dx, dy);
    const rotation = normalizeAngle(Number(summon.rotation ?? 0) + clamp(
        angleDelta(Number(summon.rotation ?? 0), desiredRotation),
        -Number(stats[behavior.movement.turnStat] ?? 8),
        Number(stats[behavior.movement.turnStat] ?? 8),
    ));
    summon = withComponentState(summon, {
        x: clamp(summon.x + dx / distance * Math.min(Number(stats[behavior.movement.speedStat] ?? 0), distance), Number(stats[behavior.movement.sizeStat] ?? summon.size) / 2, world.width - Number(stats[behavior.movement.sizeStat] ?? summon.size) / 2),
        y: clamp(summon.y + dy / distance * Math.min(Number(stats[behavior.movement.speedStat] ?? 0), distance), Number(stats[behavior.movement.sizeStat] ?? summon.size) / 2, world.height - Number(stats[behavior.movement.sizeStat] ?? summon.size) / 2),
        rotation,
    });

    const attack = behavior.attack;
    if (summon.shotCooldownMs <= 0 && rayIntersectsCircle(summon, rotation, Number(stats[attack.rangeStat] ?? 0), target)) {
        const targetIndex = bots.findIndex((bot) => bot.id === target.id);
        if (targetIndex >= 0) {
            const result = applyEntityEffects(bots, targetIndex, summon, contract.abilityId, combat, {
                effectTypes: attack.effectTypes,
                world,
            });
            bots = result.bots;
        }
        summon = withComponentState(summon, {
            [attack.cooldownField]: Number(stats[attack.cooldownStat] ?? 1000),
            [attack.visualField]: Math.max(0, Number(stats[attack.visualStat] ?? 300) - Number(world.stepMs ?? 0)),
        });
    }
    return { bots, entity: summon };
}

function tickDelayedZone(entity, behavior, world, combat) {
    const contract = contractForEntity(entity);
    const fuseMs = Number(entity[behavior.fuseField] ?? 0) - Number(world.stepMs ?? 0);
    if (fuseMs > 0) return { bots: world.bots, entity: withComponentState(entity, { [behavior.fuseField]: fuseMs }) };
    const stats = ABILITY_STATS[contract.abilityId] ?? {};
    const bots = applyZoneEffects(world.bots, entity, contract.abilityId, behavior.effectTypes, Number(stats[behavior.radiusStat] ?? entity.size / 2), combat, world);
    return { bots, entity: createDerivedEntity(entity, behavior.explosion, contract) };
}

/** Applies one declarative action every configured interval. */
function tickInterval(entity, behavior, world, combat) {
    const contract = contractForEntity(entity);
    const stats = ABILITY_STATS[contract.abilityId] ?? {};
    const stepMs = Number(world.stepMs ?? 0);
    const intervalMs = Math.max(1, Number(stats[behavior.intervalStat] ?? stepMs));
    const remainingMs = Number(entity.remainingMs ?? stats.durationMs ?? 0) - stepMs;
    let intervalTimerMs = Number(entity.intervalTimerMs ?? 0) - stepMs;
    let bots = world.bots;
    const spawned = [];
    while (intervalTimerMs <= 0) {
        bots = applyZoneEffects(
            bots,
            entity,
            contract.abilityId,
            behavior.effectTypes,
            Number(stats[behavior.radiusStat] ?? entity.size / 2),
            combat,
            world,
        );
        if (behavior.explosion) spawned.push(createDerivedEntity(entity, behavior.explosion, contract));
        intervalTimerMs += intervalMs;
    }
    return {
        bots,
        entity: remainingMs > 0
            ? withComponentState(entity, { remainingMs, intervalTimerMs })
            : null,
        spawned,
    };
}

function tickLifetime(entity, world) {
    const remainingMs = Number(entity.remainingMs ?? 0) - Number(world.stepMs ?? 0);
    return { bots: world.bots, entity: remainingMs > 0 ? withComponentState(entity, { remainingMs }) : null };
}

function applyZoneEffects(bots, source, abilityId, effectTypes, radius, combat, world, options = {}) {
    let nextBots = bots;
    for (let index = 0; index < nextBots.length; index += 1) {
        const target = nextBots[index];
        const targetPath = botMovementSegment(target, world?.stepMs);
        const sourcePoint = { x: Number(source.x), y: Number(source.y) };
        if (!movingCirclesIntersect(
            sourcePoint,
            sourcePoint,
            Number(radius),
            targetPath.start,
            targetPath.end,
            0,
        )) continue;
        if (ignoresHostileEffects(target)) continue;
        const sourceBehavior = behaviorForEntity(source);
        if (sourceBehavior?.skipOwner && Number(target.slot) === Number(source.ownerSlot)) continue;
        const result = applyEntityEffects(nextBots, index, source, abilityId, combat, {
            effectTypes,
            world,
            skipShield: options.skipShield,
            effectOverrides: options.effectOverrides,
            shieldChargeCost: shieldChargeCostForDistance(target, source, abilityId),
            collisionDistance: movingCirclesDistance(sourcePoint, sourcePoint, targetPath.start, targetPath.end),
        });
        nextBots = result.bots;
    }
    return nextBots;
}

function advanceTravel(entity, movement, stats, world) {
    const stepMs = Number(world.stepMs ?? 0);
    const elapsedMs = Number(entity.phaseTimerMs ?? 0) + stepMs;
    const durationMs = Math.max(0, Number(stats[movement?.durationStat] ?? 0));
    const radius = Number(entity.size ?? 0) / 2;
    const nextX = clamp(Number(entity.x) + Number(entity.velocityX ?? 0), radius, world.width - radius);
    const nextY = clamp(Number(entity.y) + Number(entity.velocityY ?? 0), radius, world.height - radius);
    const armed = durationMs <= 0 || elapsedMs >= durationMs;
    return withComponentState(entity, {
        x: nextX,
        y: nextY,
        velocityX: armed ? 0 : Number(entity.velocityX ?? 0),
        velocityY: armed ? 0 : Number(entity.velocityY ?? 0),
        traveled: Number(entity.traveled ?? 0) + Math.hypot(nextX - Number(entity.x), nextY - Number(entity.y)),
        phaseTimerMs: armed ? 0 : elapsedMs,
        armed,
    });
}

function advanceFuseTravel(entity, world) {
    const radius = Number(entity.size ?? 0) / 2;
    const nextX = clamp(Number(entity.x) + Number(entity.velocityX ?? 0), radius, world.width - radius);
    const nextY = clamp(Number(entity.y) + Number(entity.velocityY ?? 0), radius, world.height - radius);
    return withComponentState(entity, {
        x: nextX,
        y: nextY,
        traveled: Number(entity.traveled ?? 0) + Math.hypot(nextX - Number(entity.x), nextY - Number(entity.y)),
        armed: true,
    });
}

function phaseAtElapsed(behavior, elapsedMs) {
    const phases = behavior?.phases ?? [];
    if (phases.length === 0) return null;
    return phases.reduce((current, phase) => Number(phase.startMs ?? 0) <= elapsedMs ? phase : current, phases[0]);
}

function phaseStat(stats, phase, name, fallback = 0) {
    if (name == null) return Number(fallback);
    return Number(phase?.statOverrides?.[name] ?? stats?.[name] ?? fallback);
}

function activePhase(entity, behavior) {
    const phases = behavior?.phases ?? [];
    if (entity?.destroyedByDamage) {
        const destroyed = phases.find((phase) => phase.id === "destroyed");
        if (destroyed) return destroyed;
    }
    if (entity?.phaseId) {
        const explicit = phases.find((phase) => phase.id === entity.phaseId);
        if (explicit) return explicit;
    }
    if (entity?.armed) {
        const armed = phases.find((phase) => phase.id === "armed");
        if (armed) return armed;
    }
    return phaseAtElapsed(behavior, Number(entity?.ageMs ?? 0))
        ?? (entity?.phaseId ? phases.find((phase) => phase.id === entity.phaseId) : null);
}

/** Advances a multi-phase entity from elapsed lifecycle time. */
function advancePhaseEntity(entity, behavior, stats, world) {
    const stepMs = Number(world.stepMs ?? 0);
    const elapsedMs = Number(entity.ageMs ?? 0);
    const previousElapsedMs = Math.max(0, elapsedMs - stepMs);
    const previousPhase = phaseAtElapsed(behavior, previousElapsedMs);
    const phase = phaseAtElapsed(behavior, elapsedMs) ?? previousPhase;
    const movement = previousPhase?.movement ?? {};
    const radius = Number(entity.size ?? 0) / 2;
    const moving = movement.mode === "travel";
    let velocityX = Number(entity.velocityX ?? 0);
    let velocityY = Number(entity.velocityY ?? 0);
    const speedOverride = previousPhase?.statOverrides?.speedPerTick ?? previousPhase?.statOverrides?.speed;
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

/** Advances a trap through its throw phase, then its armed lifetime phase. */
function advanceTrapTravel(entity, behavior, stats, world) {
    const stepMs = Number(world.stepMs ?? 0);
    const armedDurationMs = Number(stats.durationMs ?? Number.POSITIVE_INFINITY);
    const phaseTimerMs = Number(entity.phaseTimerMs ?? 0);
    if (entity.armed) {
        const armedElapsedMs = phaseTimerMs + stepMs;
        return withComponentState(entity, {
            velocityX: 0,
            velocityY: 0,
            phaseTimerMs: armedElapsedMs,
            remainingMs: Math.max(0, armedDurationMs - armedElapsedMs),
            armed: true,
        });
    }

    const movement = behavior.movement ?? {};
    const radius = Number(entity.size ?? 0) / 2;
    const nextX = clamp(Number(entity.x) + Number(entity.velocityX ?? 0), radius, world.width - radius);
    const nextY = clamp(Number(entity.y) + Number(entity.velocityY ?? 0), radius, world.height - radius);
    const traveled = Number(entity.traveled ?? 0) + Math.hypot(nextX - Number(entity.x), nextY - Number(entity.y));
    const travelDurationMs = Math.max(0, Number(
        movement.durationStat ? stats[movement.durationStat] : stats.durationMs ?? 0,
    ));
    const travelElapsedMs = phaseTimerMs + stepMs;
    const armed = travelDurationMs <= 0 || travelElapsedMs >= travelDurationMs;
    return withComponentState(entity, {
        x: nextX,
        y: nextY,
        velocityX: armed ? 0 : Number(entity.velocityX ?? 0),
        velocityY: armed ? 0 : Number(entity.velocityY ?? 0),
        traveled,
        phaseTimerMs: armed ? 0 : travelElapsedMs,
        remainingMs: armed ? armedDurationMs : Math.max(0, travelDurationMs - travelElapsedMs),
        armed,
    });
}

function createDerivedEntity(source, definition, contract, { spawnedThisTick = false, statOverrides = null } = {}) {
    if (!definition) return source;
    const stats = ABILITY_STATS[contract.abilityId] ?? {};
    const size = Number(statOverrides?.[definition.sizeStat] ?? stats[definition.sizeStat] ?? source.size ?? 0)
        * Number(definition.sizeMultiplier ?? 1);
    const visibleMs = definition.visibleStat ? Number(stats[definition.visibleStat] ?? 0) : null;
    return withComponentState(source, {
        id: `${source.id}-${definition.type}`,
        type: definition.type,
        entityBehaviorKey: definition.behaviorKey,
        entityCategory: definition.category,
        category: definition.category,
        entitySystem: definition.system,
        size,
        velocityX: 0,
        velocityY: 0,
        ageMs: 0,
        ...(visibleMs == null ? {} : { visibleMs }),
        spawnedThisTick,
    });
}

function damageToEntity(entity, world, combat) {
    let damage = 0;
    for (const bot of world.bots) {
        if (typeof combat.triggeredAbilityDamage === "function") damage += combat.triggeredAbilityDamage(bot, entity);
    }
    for (const projectile of world.projectiles ?? []) {
        const contract = contractForEntity(projectile);
        if (contract?.projectile?.hit === "effects" && typeof combat.overlapsShape === "function" && combat.overlapsShape(projectile, entity)) {
            damage += damageAtDistance(contract.abilityId, 0) * Number(projectile.damageMultiplier ?? 1);
        }
    }
    for (const effect of world.entities ?? []) {
        const behavior = behaviorForEntity(effect);
        if (effect.spawnedThisTick || !behavior || !["radial", "visualZone"].includes(behavior.kind)) continue;
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
        ) && behavior.damageAbilityId) {
            damage += damageAtDistance(behavior.damageAbilityId, distance) * Number(effect.damageMultiplier ?? 1);
        }
    }
    return damage;
}

function shieldChargeCostForDistance(target, source, abilityId) {
    const policy = abilityContract(abilityId)?.shieldInteraction;
    if (policy?.chargeCost !== SHIELD_CHARGE_COSTS.DISTANCE_SCALED) return undefined;
    const stats = ABILITY_STATS[abilityId] ?? {};
    const radius = Number(stats.explosionRadius ?? stats.radius ?? Number(source?.size ?? 0) / 2);
    const distance = Math.hypot(Number(target.x) - Number(source?.x), Number(target.y) - Number(source?.y));
    return clamp(Math.round(radius > 0 ? 5 - (distance / radius) * 4 : 1), 1, Number(stats.maxCharges ?? 5));
}

function contractForEntity(entity) {
    return entityContract(entity?.entityContractId ?? entity?.abilityId ?? entity?.entityContractType ?? entity?.type);
}

function behaviorForEntity(entity) {
    const contract = contractForEntity(entity);
    if (!contract) return null;
    if (entity.entityBehaviorKey && contract.derived?.[entity.entityBehaviorKey]) return contract.derived[entity.entityBehaviorKey];
    return Object.values(contract.derived ?? {}).find((derived) => derived.type === entity.type) ?? contract.behavior ?? null;
}

function entityCategory(entity) {
    return entity.category
        ?? contractForEntity(entity)?.category
        ?? null;
}

function overlaps(first, second, stepMs = 100) {
    const firstPath = entityMovementSegment(first, stepMs);
    const secondPath = entityMovementSegment(second, stepMs);
    return movingCirclesIntersect(
        firstPath.start,
        firstPath.end,
        Number(first.size ?? 0) / 2,
        secondPath.start,
        secondPath.end,
        Number(second.size ?? 0) / 2,
    );
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
