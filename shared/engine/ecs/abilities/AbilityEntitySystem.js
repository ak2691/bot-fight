import { angleDelta, clamp, normalizeAngle } from "../../gameconfig/geometry.js";
import { entityMovementSegment, findTargets, TARGET_KIND_BOT, TARGET_KIND_ENTITY } from "./findTargets.js";
import { advanceEntityAge } from "../entities/EntityWorld.js";
import {
    abilityAppliesToOwner,
    abilityContract,
    EVENT_SCHEDULE_MODES,
    EFFECT_TYPES,
    eventTargetsEntity,
    eventTargetsKind,
    effectTargetsTarget,
    eventVerbs,
    hitVerbs,
    MOVEMENT_MODES,
    PHASE_EVENT_TYPES,
    phaseEffects,
    phaseSpeed,
    TARGET_KINDS,
    targetKindsForEntity,
    VERBS,
    verbEffects,
} from "../contracts/AbilityContracts.js";
import { applyEffectsToEntity, applyStatus, dealDamage, entityEffectStats, phaseStatsFor } from "./effects.js";
import { ignoresHostileEffects } from "../../gameconfig/DefensiveState.js";
import {
    effectiveMovementSpeedMultiplier,
    effectiveRotationSpeedMultiplier,
} from "../../gameconfig/HitStagger.js";
import { compassDirection, vectorToCompassDegrees } from "../../botlogic/planner/arenaAngles.js";
import { ACTION_TO_ABILITY } from "../../loadout/BotLoadout.js";
import {
    entityContract,
    phaseForEntity,
    phasesForEntity,
} from "../contracts/AbilityContracts.js";
import { ABILITY_STAGES, abilityRecord } from "../../gameconfig/AbilityState.js";
import { ownerRelativePose } from "../entities/EntityFactory.js";
import { ownerBot } from "../entities/EntityCombat.js";
import { dispatchEntityEvent } from "./EntityEventSystem.js";
import { BASE_BOT_HP } from "../../modelPayloads/arenaConstants.js";
import {
    clearPresenceStatuses,
    statusIsActive,
} from "../contracts/StatusContracts.js";
import { abilityHitsTarget, verbHitsTarget } from "./AbilityHitDetectionSystem.js";

export function isAbilityEntity(entity) {
    return phasesForEntity(entity).length > 0;
}

/**
 * Advances persistent ability entities one tick. Every entity runs the same `tickEntity`: its clocks advance,
 * incoming impacts land, it moves by its phase's movement mode, its due events run (collision, trigger,
 * schedule), and its lifetime ends or its phase changes. Nothing dispatches on what kind of entity it is; a
 * trap is a phase with a `trigger`, a summon is `seek` movement plus a `schedule` event.
 */
export function tickAbilityEntityWorld(world) {
    // `world.entitiesAged`: the caller already aged the entities this tick (the server ages them before new
    // entities spawn, so an entity spawned this tick starts at age 0).
    // Entities that a `spawn` verb inside an entity event creates wait here and join the world after the
    // tick, so they start acting on the next one.
    // The bots and the entities change in place; the returned list drops the entities that ended and adds the
    // ones that were created.
    const spawnQueue = [];
    for (const entity of world.entities) {
        entity.tickStartHp = entity.hp == null ? null : Number(entity.hp);
        entity.damageTakenThisTick = 0;
        if (!world.entitiesAged) advanceEntityAge(entity, world.stepMs);
    }
    for (const bot of world.bots) clearPresenceStatuses(bot);
    const staged = { ...world, spawnQueue };
    staged.entities = bindEntitiesToOwners(staged);
    staged.entities = settleTriggerEntities(staged);
    staged.entities = settleRemainingEntities(staged);
    const entities = [...staged.entities, ...spawnQueue];
    for (const entity of entities) {
        entity.phaseEnteredThisTick = false;
        entity.damageTakenLastTick = Number(entity.damageTakenThisTick ?? 0);
        entity.damageTakenThisTick = 0;
        entity.hpNetChangeLastTick = entity.hp == null || entity.tickStartHp == null
            ? 0
            : Number(entity.hp) - Number(entity.tickStartHp);
    }
    return { ...world, entities, bots: world.bots };
}

// --- the entity tick -------------------------------------------------------------------------------------------

/**
 * What one pass of the tick shares. The pass reads the other entities as they were when it began, whatever
 * order it settles them in (`world.entities` is a copy taken now); the bots are the live ones, as events change
 * them.
 */
function tickRun(world) {
    return {
        world: { ...world, entities: world.entities.map((entity) => ({ ...entity })) },
        bots: world.bots,
        tickBots: null,
    };
}

/** The part of a bot that finding targets reads, as it is now. */
function botTargetView(bot) {
    return {
        kind: bot.kind,
        id: bot.id,
        slot: bot.slot,
        teamNumber: bot.teamNumber,
        hp: bot.hp,
        statusEffects: bot.statusEffects,
        x: bot.x,
        y: bot.y,
        size: bot.size,
        velocityX: bot.velocityX,
        velocityY: bot.velocityY,
        movementStartX: bot.movementStartX,
        movementStartY: bot.movementStartY,
    };
}

/**
 * One entity, one tick: advance (clocks, incoming impacts), then settle (incoming events, movement, due events,
 * lifetime end, phase entry). Returns the entity, or null when it is gone.
 */
function tickEntity(entity, run, triggered = false) {
    return settleEntity(advanceEntity(entity, run), run, triggered);
}

/**
 * Advances the clocks and lets the world's impacts reach an entity that has health. Entities whose phase carries
 * a trigger settle together (a chain trigger crosses entities), so the two halves can run apart.
 */
function advanceEntity(entity, run) {
    const world = run.world;
    const stepMs = Number(world.stepMs ?? 0);
    clearEntityPresenceStatuses(entity);
    const phase = phaseForEntity(entity);
    const previousHp = phase.health
        ? Math.max(0, Number(entity.hp ?? phase.health.hp ?? phase.health.maxHp ?? 0)) : 0;
    const remainingBefore = entity.remainingMs == null ? null : Number(entity.remainingMs);
    tickEntityStatuses(entity, stepMs);
    // A phase with a `schedule` event is timed by that schedule (a summon's shots), so it has no phase clock.
    const clocked = !phase.on?.[PHASE_EVENT_TYPES.SCHEDULE];
    entity.phaseId = phase.id;
    entity.remainingMs = remainingBefore == null ? null : remainingBefore - stepMs;
    entity.intervalTimerMs = Math.max(0, entity.intervalTimerMs - stepMs);
    if (clocked) {
        entity.phaseTimerMs = Math.max(0, entity.phaseTimerMs + stepMs);
        entity.visualEventMs = Math.max(0, Number(entity.visualEventMs ?? 0) - stepMs);
        if (entity.visibleMs != null) entity.visibleMs = Math.max(0, Number(entity.visibleMs) - stepMs);
    }
    if (entity.shotVisualMs != null || phase.on?.[PHASE_EVENT_TYPES.SCHEDULE]) {
        entity.shotVisualMs = Math.max(0, Number(entity.shotVisualMs ?? 0) - stepMs);
    }
    let damage = 0;
    let killed = false;
    if (phase.health) {
        applyIncomingEntityEffects(entity, world);
        damage = Math.max(0, previousHp - Number(entity.hp ?? previousHp));
        killed = previousHp > 0 && Number(entity.hp ?? 0) <= 0 && damage > 0;
    }
    return { entity, phase, remainingBefore, damage, killed };
}

function settleEntity({ entity: advanced, phase: startPhase, remainingBefore, damage, killed }, run, triggered) {
    let entity = advanced;
    let phase = startPhase;
    const stepMs = Number(run.world.stepMs ?? 0);
    run.tickBots = run.bots.map(botTargetView);

    // Incoming impacts raise `hit` and `killed`. An entity with no `killed` handler dies when its health runs out.
    if (damage > 0) {
        const type = killed ? PHASE_EVENT_TYPES.KILLED : PHASE_EVENT_TYPES.HIT;
        const handler = phase.on?.[type];
        if (handler) entity = fire(run, entity, type, phase).entity;
        if (!entity || killed && !handler) return null;
        const incomingPhase = phaseForEntity(entity);
        if (Number(entity.hp ?? 0) <= 0 && (!incomingPhase || incomingPhase.health)) return null;
        const entered = enterPhase(run, entity, phase, handler, type);
        if (entered.entered) return entered.entity;
        phase = incomingPhase ?? phase;
    }
    if (Number(entity.hp ?? 0) <= 0 && phase.health) return null;

    const move = moveEntity(entity, phase, run);
    entity = move.entity;

    // Due events. Collision runs while the entity had life left at the start of the tick.
    const collisionEvent = phase.on?.[PHASE_EVENT_TYPES.COLLISION];
    if (collisionEvent) {
        const collided = collisionEventStep(run, entity, phase, move, remainingBefore == null || remainingBefore > 0);
        if (collided.entered || !collided.entity) return collided.entity;
        entity = collided.entity;
    }
    if (triggered) {
        const triggerEvent = phase.on?.[PHASE_EVENT_TYPES.TRIGGER];
        const targets = triggerTargets(entity, phase, run.world);
        const result = fire(run, entity, PHASE_EVENT_TYPES.TRIGGER, phase, {
            targetIds: targets.map(({ bot }) => bot.id),
            targetDistances: new Map(targets.map(({ bot, collisionDistance }) => [bot.id, collisionDistance])),
        });
        return enterPhase(run, result.entity, phase, triggerEvent, PHASE_EVENT_TYPES.TRIGGER).entity;
    }
    // A timer event does not fire on the entity's last tick, nor while a seeking entity has nothing to chase.
    const scheduled = phase.on?.[PHASE_EVENT_TYPES.SCHEDULE];
    const expiring = lifeEnded(entity, phase);
    if (scheduled && !expiring && !(move.seeking && !move.target)
        && canExecute(entity) && scheduleDue(entity, scheduled)) {
        const result = fire(run, entity, PHASE_EVENT_TYPES.SCHEDULE, phase, { seekTargetId: move.target?.id ?? null });
        entity = result.entity;
        if (!entity) return null;
        if (result.hitConnected || !scheduled.waitForHit) {
            const shot = eventVerbs(scheduled).find((verb) => verb.do === VERBS.HIT);
            entity.intervalTimerMs = Math.max(1, Number(scheduled.schedule.intervalMs));
            entity.shotVisualMs = Math.max(0, Number(shot?.visual?.visibleMs ?? phase.durationMs ?? 300) - stepMs);
        }
        const entered = enterPhase(run, entity, phase, scheduled, PHASE_EVENT_TYPES.SCHEDULE);
        if (entered.entered) return entered.entity;
    }

    // Lifetime end: the phase ran its duration, the entity ran out of life, or a projectile left the arena.
    const phaseExpired = phase.durationMs != null && entity.phaseTimerMs >= Number(phase.durationMs);
    const lifeExpired = lifeEnded(entity, phase);
    const removeAtEdge = move.hitEdge && eventHasVerb(collisionEvent, VERBS.REMOVE);
    if (!phaseExpired && !lifeExpired && !removeAtEdge) return entity;
    const lifetimeEnd = phase.on?.[PHASE_EVENT_TYPES.LIFETIME_END];
    const ended = fire(run, entity, PHASE_EVENT_TYPES.LIFETIME_END, phase).entity;
    if (ended === entity && !lifetimeEnd) return null;
    return enterPhase(run, ended, phase, lifetimeEnd, PHASE_EVENT_TYPES.LIFETIME_END).entity;
}

/** Runs one event through the verb executor; the bots and the entity change in place. */
function fire(run, entity, eventType, phase, options = {}) {
    return dispatch(entity, eventType, {
        bots: run.bots,
        world: run.world,
        phase,
        ...options,
    });
}

/**
 * Phase entry. When an event moved the entity into another phase, that phase's collision runs once at its
 * position (unless the event opted out). This is the only place the entered phase's collision check lives.
 */
function enterPhase(run, entity, fromPhase, event, eventType) {
    const entered = entity ? phaseForEntity(entity) : null;
    if (!entered || entered.id === fromPhase.id) return { entity, entered: false };
    if (event?.recheckCollisionOnTransition === false
        || !eventHasVerb(entered.on?.[PHASE_EVENT_TYPES.COLLISION], VERBS.APPLY_EFFECTS)) {
        return { entity, entered: true };
    }
    // An entry through a collision or the end of the last phase finds its targets among the bots as they were
    // when the entity's tick began; an entry through a trigger or a kill finds them among the bots as they are
    // now. Every entry but a kill counts the once-collision as run, so a trigger does not hit twice.
    const sameTickTargets = eventType === PHASE_EVENT_TYPES.COLLISION || eventType === PHASE_EVENT_TYPES.LIFETIME_END;
    const marks = eventType !== PHASE_EVENT_TYPES.KILLED;
    const targets = canonicalCollisionTargets(entity, entered, {
        ...run.world, bots: sameTickTargets ? run.tickBots : run.bots,
    });
    const result = fire(run, entity, PHASE_EVENT_TYPES.COLLISION, entered, {
        targetIds: targets.map(({ bot }) => bot.id),
        targetDistances: new Map(targets.map(({ bot, collisionDistance }) => [bot.id, collisionDistance])),
    });
    return { entity: result.entity && marks ? markScheduledEvent(result.entity, PHASE_EVENT_TYPES.COLLISION) : result.entity, entered: true };
}

/** The collision event when it is due: targets swept along the entity's move, then the event once per check. */
function collisionEventStep(run, entity, phase, move, alive) {
    const stepMs = Number(run.world.stepMs ?? 0);
    const event = phase.on[PHASE_EVENT_TYPES.COLLISION];
    const checks = collisionCheckCount(entity, phase, stepMs);
    let next = entity;
    if (alive && checks.count > 0) {
        const candidates = canonicalCollisionTargets(next, phase, run.world, move.start, move.end);
        const selected = event.nearestOnly ? candidates.slice(0, 1) : candidates;
        const emitsVisual = eventHasVerb(event, VERBS.EMIT_VISUAL);
        for (let check = 0; check < checks.count && next; check += 1) {
            if (selected.length === 0 && !emitsVisual) continue;
            next = fire(run, next, PHASE_EVENT_TYPES.COLLISION, phase, {
                targetIds: selected.map(({ bot }) => bot.id),
                targetDistances: new Map(selected.map(({ bot, collisionDistance }) => [bot.id, collisionDistance])),
                // The effects read the entity as it was at the start of its move.
                effectSources: new Map(selected.map(({ bot }) => [bot.id, { ...next, x: move.start.x, y: move.start.y }])),
            }).entity;
            const entered = enterPhase(run, next, phase, event, PHASE_EVENT_TYPES.COLLISION);
            if (entered.entered) return entered;
        }
    }
    if (!next) return { entity: null, entered: false };
    return { entity: withEventScheduleState(next, PHASE_EVENT_TYPES.COLLISION, checks.state), entered: false };
}

// --- the entity stages -------------------------------------------------------------------------------------------

function hasTrigger(entity) {
    return Boolean(phaseForEntity(entity)?.trigger);
}

/**
 * Entities in a phase with a `trigger` settle first and together: a chain trigger sets off its neighbours, so
 * every one of them advances before any of them reacts. Their results follow the other entities in the list.
 */
function settleTriggerEntities(world) {
    const group = world.entities.filter(hasTrigger);
    if (group.length === 0) return world.entities;
    const run = tickRun(world);
    const hitIds = new Set(group.filter((entity) => triggerHit(entity, phaseForEntity(entity), run.world))
        .map((entity) => entity.id));
    const removed = entityCollisionRemovalIds(run.world);

    const entries = [];
    for (const source of group) {
        if (removed.has(source.id)) continue;
        const advanced = advanceEntity(source, run);
        const { entity, killed } = advanced;
        const phase = phaseForEntity(entity);
        if (phase?.health && Number(entity.hp ?? 0) <= 0 && !killed && !hitIds.has(source.id)) continue;
        entries.push({ advanced, hit: killed || hitIds.has(source.id) });
    }
    const triggered = resolveTriggers(entries, run.world);
    const groupIds = new Set(group.map((entity) => entity.id));
    const entities = world.entities.filter((entity) => !groupIds.has(entity.id) && !removed.has(entity.id));
    for (const { advanced } of entries) {
        const next = settleEntity(advanced, run, triggered.has(advanced.entity.id) && !advanced.killed);
        // A phase entered here counts the entry tick as its first tick.
        if (next) entities.push(next.phaseEnteredThisTick ? consumeEnteredPhaseTick(next, run.world.stepMs) : next);
    }
    return entities;
}

function consumeEnteredPhaseTick(entity, stepMs) {
    const step = Math.max(0, Number(stepMs ?? 0));
    if (entity.remainingMs != null) entity.remainingMs = Number(entity.remainingMs) - step;
    entity.phaseTimerMs = entity.phaseTimerMs + step;
    return entity;
}

/** Every other entity settles one at a time, in order; an entity that entered a phase this tick waits a tick. */
function settleRemainingEntities(world) {
    const run = tickRun(world);
    const removed = entityCollisionRemovalIds(run.world);
    const entities = [];
    for (const entity of world.entities) {
        if (removed.has(entity.id)) continue;
        if (entity.phaseEnteredThisTick) {
            entity.phaseEnteredThisTick = false;
            entities.push(entity);
            continue;
        }
        const phase = phaseForEntity(entity);
        if (!phase?.type || phase.trigger) {
            entities.push(entity);
            continue;
        }
        const next = tickEntity(entity, run);
        if (next) entities.push(next);
    }
    return entities;
}

// --- triggers ----------------------------------------------------------------------------------------------------

/** The trigger group's ids that fire this tick: a hit, a bot in reach, or a chain from a neighbour that fired. */
function resolveTriggers(entries, world) {
    const fired = new Set();
    for (const { advanced, hit } of entries) {
        const { entity, phase } = advanced;
        const trigger = phase.trigger;
        const contact = trigger.botContact
            && findTargets({ x: entity.x, y: entity.y, rotation: entity.rotation },
                { shape: "circle", radius: triggerRadius(phase) }, {
                    world,
                    kinds: [TARGET_KIND_BOT],
                    source: entity,
                    sweep: entityMovementSegment(entity),
                    isTarget: (bot) => isEnemy(entity, bot, world.bots),
                }).length > 0;
        if (hit || contact) fired.add(entity.id);
    }

    let changed = true;
    while (changed) {
        changed = false;
        for (const source of entries.filter(({ advanced }) => fired.has(advanced.entity.id))) {
            const trigger = source.advanced.phase.trigger;
            if (!trigger?.chain) continue;
            const radius = triggerRadius(source.advanced.phase);
            for (const target of entries) {
                if (fired.has(target.advanced.entity.id)
                    || target.advanced.entity.abilityId !== source.advanced.entity.abilityId
                    || Math.hypot(target.advanced.entity.x - source.advanced.entity.x,
                        target.advanced.entity.y - source.advanced.entity.y) > radius) continue;
                fired.add(target.advanced.entity.id);
                changed = true;
            }
        }
    }
    return fired;
}

/** Whether an attack or projectile reached an entity this tick, when its trigger asks for that. */
function triggerHit(entity, phase, world) {
    const trigger = phase?.trigger ?? {};
    if (trigger.attackHits && world.bots.some((bot) => (bot.entityHitIds ?? []).includes(entity.id))) return true;
    if (trigger.projectileOverlap && world.entities.some((candidate) => candidate.id !== entity.id
        && phaseForEntity(candidate)?.type === "projectile"
        && overlaps(candidate, entity))) return true;
    return trigger.attackHits && world.bots.some((bot) => hostileAbilityCanHitEntity(bot)
        && abilityHitsTarget(bot, entity));
}

function hostileAbilityCanHitEntity(bot) {
    return !abilityAppliesToOwner(ACTION_TO_ABILITY[bot?.triggeredAbility]);
}

/**
 * `trigger.radius` is the only radius a trigger uses, for detection, chains and trigger targets. The phase hitbox
 * (radius and radiusMultiplier) is the entity's body and never widens or narrows a trigger.
 */
function triggerRadius(phase) {
    return phaseStat(phase, phase?.trigger?.radius, 0);
}

/** The living enemy bots inside the phase's trigger radius. */
function triggerTargets(entity, phase, world) {
    const radius = triggerRadius(phase);
    const point = { x: Number(entity.x), y: Number(entity.y) };
    return findTargets({ ...point, rotation: entity.rotation },
        { shape: "circle", radius }, {
            world,
            kinds: [TARGET_KIND_BOT],
            source: entity,
            sweep: { start: point, end: point },
            isTarget: (bot) => isEnemy(entity, bot, world.bots)
                && bot.hp > 0
                && !ignoresHostileEffects(bot),
        }).map(({ target, distance }) => ({ bot: target, collisionDistance: distance }));
}

// --- movement ----------------------------------------------------------------------------------------------------

/**
 * Moves an entity by its phase's movement mode and returns the sweep it covered. `straight` follows its
 * heading (backward on request) inside the arena, `static` stays, and `seek` turns toward the nearest living
 * enemy and closes on it. `followOwner` poses are set earlier, when the entity binds to its owner.
 */
function moveEntity(entity, phase, run) {
    const world = run.world;
    const movement = phase.movement ?? {};
    const start = { x: Number(entity.x), y: Number(entity.y) };
    if (movement.mode === MOVEMENT_MODES.SEEK) return seekEntity(entity, phase, movement, start, world);

    const speed = resolvePhaseNumber(phaseSpeed(phase), phase, 0);
    const velocityMagnitude = Math.hypot(entity.velocityX, entity.velocityY);
    const baseDirection = velocityMagnitude > 0.001
        ? { x: entity.velocityX / velocityMagnitude, y: entity.velocityY / velocityMagnitude }
        : compassDirection(entity.rotation);
    const direction = movement.direction === "backward"
        ? { x: -baseDirection.x, y: -baseDirection.y }
        : baseDirection;
    const shouldMove = speed > 0;
    const end = shouldMove
        ? {
            x: clamp(start.x + direction.x * speed, 0, world.width),
            y: clamp(start.y + direction.y * speed, 0, world.height),
        }
        : start;
    entity.x = end.x;
    entity.y = end.y;
    entity.velocityX = shouldMove ? direction.x * speed : 0;
    entity.velocityY = shouldMove ? direction.y * speed : 0;
    entity.traveled = entity.traveled + Math.hypot(end.x - start.x, end.y - start.y);
    return {
        start,
        end,
        hitEdge: end.x === 0 || end.x === world.width || end.y === 0 || end.y === world.height,
        entity,
    };
}

function seekEntity(entity, phase, movement, start, world) {
    const target = world.bots
        .filter((bot) => isEnemy(entity, bot, world.bots) && bot.hp > 0)
        .sort((first, second) => Math.hypot(first.x - entity.x, first.y - entity.y)
            - Math.hypot(second.x - entity.x, second.y - entity.y))[0] ?? null;
    const idle = { start, end: start, hitEdge: false, seeking: true, target, entity };
    if (!target) return idle;

    const dx = target.x - entity.x;
    const dy = target.y - entity.y;
    const targetDistance = Math.max(1, Math.hypot(dx, dy));
    const turn = resolvePhaseNumber(movement.turnDegrees, phase, 8) * effectiveRotationSpeedMultiplier(entity);
    const speed = canMove(entity)
        ? resolvePhaseNumber(phaseSpeed(phase), phase, 0) * effectiveMovementSpeedMultiplier(entity)
        : 0;
    const rotation = normalizeAngle(entity.rotation + clamp(
        angleDelta(entity.rotation, vectorToCompassDegrees(dx, dy)),
        -turn,
        turn,
    ));
    const size = resolvePhaseNumber(movement.size, phase, entity.size);
    const end = {
        x: clamp(entity.x + dx / targetDistance * Math.min(speed, targetDistance), size / 2, world.width - size / 2),
        y: clamp(entity.y + dy / targetDistance * Math.min(speed, targetDistance), size / 2, world.height - size / 2),
    };
    entity.x = end.x;
    entity.y = end.y;
    entity.rotation = rotation;
    return { ...idle, end };
}

// --- incoming impacts and entity statuses ------------------------------------------------------------------------

/**
 * Resolves all contract effects that can reach one HP-bearing entity. The
 * target phase decides whether this is damage-only (ordinary HP entity) or a
 * full summon target. This is deliberately separate from bot combat because
 * entity status state lives on the entity payload. The target changes in place.
 */
function applyIncomingEntityEffects(target, world) {
    if (!target || target.hp == null) return;
    const targetPhase = phaseForEntity(target);
    const allowFriendlyDamage = Boolean(targetPhase?.health?.allowFriendlyDamage);

    const entityKinds = targetKindsForEntity(target);
    for (const bot of world.bots ?? []) {
        const abilityId = ACTION_TO_ABILITY[bot?.triggeredAbility];
        if (abilityId == null || !allowFriendlyDamage && !isEnemy(target, bot, world.bots)) continue;
        const activation = abilityContract(abilityId)?.activation;
        // A trigger `hit` verb reaches an entity that its `targets` name when its hitbox touches it.
        for (const verb of hitVerbs(abilityId)) {
            if (!eventTargetsEntity(verb, entityKinds) || !verbHitsTarget(bot, verb, target, activation)) continue;
            applyEffectsToEntity(target, {
                source: bot,
                abilityId,
                effects: verb.effects,
                distance: Math.hypot(Number(target.x) - Number(bot.x), Number(target.y) - Number(bot.y)),
                stats: phaseStatsFor(verb),
                damageMultiplier: Math.max(0, Number(bot.attackDamageMultiplier ?? 1)),
            }, world);
        }
    }

    for (const source of world.entities ?? []) {
        if (!source || source.id === target.id
            || !allowFriendlyDamage && !entityOwnersAreHostile(source, target, world.bots)) continue;
        const phase = phaseForEntity(source);
        const event = phase?.on?.[PHASE_EVENT_TYPES.COLLISION];
        const collision = entityCollision(source, target);
        if (!phase || !event || !collision
            || !eventHasVerb(event, VERBS.APPLY_EFFECTS)
            || !eventTargetsEntity(event, entityKinds)) continue;
        applyEffectsToEntity(target, {
            source,
            abilityId: source.abilityId,
            effects: eventApplyEffects(event),
            distance: collision.distance,
            stats: entityEffectStats(phase),
            damageMultiplier: Number(source.damageMultiplier ?? 1),
        }, world);
    }
}

/** Ticks the statuses an entity carries (a summon's burn or shock) in place; an entity without any is unchanged. */
function tickEntityStatuses(entity, stepMs) {
    const step = Math.max(0, Number(stepMs ?? 0));
    const statuses = Array.isArray(entity.statusEffects) ? entity.statusEffects : [];
    if (statuses.length === 0) return;
    entity.hp = Math.max(0, Number(entity.hp ?? 0));
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
        const intervalMs = Math.max(0, Number(status.tickMs ?? 0));
        let tickElapsedMs = Math.max(0, Number(status.tickElapsedMs ?? 0)) + activeStep;
        if (intervalMs > 0 && activeStep > 0 && tickElapsedMs >= intervalMs) {
            const ticks = Math.floor(tickElapsedMs / intervalMs);
            tickElapsedMs -= ticks * intervalMs;
            const tickDamage = Math.max(0, Number(status.effects?.find((effect) => effect.type === "damage")?.amount ?? 0));
            // Status damage is not an attack: it reaches the entity without a combat log entry.
            dealDamage(entity, tickDamage * ticks, null, { log: false });
            const movementLockMs = Number(status.effects?.find((effect) => effect.type === "movement_lock")?.durationMs ?? 0);
            if (movementLockMs > 0) pendingMovementLocks.push(movementLockMs);
        }
        const remainingMs = remainingBefore - step;
        if (remainingMs > 0) nextStatuses.push({ ...status, remainingMs, tickElapsedMs });
    }
    entity.statusEffects = nextStatuses;
    for (const lockMs of pendingMovementLocks) {
        applyStatus(entity, {
            type: "stun",
            remainingMs: lockMs,
            effects: [{ type: "stun", mode: "constant" }],
        });
    }
}

function clearEntityPresenceStatuses(entity) {
    if (!Array.isArray(entity?.statusEffects)) return;
    const remaining = entity.statusEffects.filter((status) => status?.mode !== "presence");
    if (remaining.length !== entity.statusEffects.length) entity.statusEffects = remaining;
}

function canMove(entity) {
    return !statusIsActive(entity, "stun") && !statusIsActive(entity, "interrupt");
}

function canExecute(entity) {
    return canMove(entity) && !statusIsActive(entity, "silence");
}

/** The collision between two arena entities, or null: the source's collider swept against the target. */
function entityCollision(source, target) {
    return findTargets({ x: Number(source.x), y: Number(source.y), rotation: source.rotation },
        { shape: "collider" }, {
            world: { entities: [target] },
            kinds: [TARGET_KIND_ENTITY],
            source,
            sweep: entityMovementSegment(source),
        })[0] ?? null;
}

function canonicalCollisionTargets(entity, phase, world, start = null, end = null) {
    // Collision cadence belongs to the collision event's schedule.
    // `execution` is reserved for embedded summon abilities.
    const targetEvent = phase.on?.[PHASE_EVENT_TYPES.COLLISION];
    const targetsBots = eventTargetsKind(targetEvent, TARGET_KINDS.BOT);
    const declaredTargetKinds = Array.isArray(targetEvent?.targets) ? targetEvent.targets : [];
    const targetsEntities = declaredTargetKinds.some((kind) => [
        TARGET_KINDS.HP_ENTITY, TARGET_KINDS.SUMMON, TARGET_KINDS.ENTITY,
    ].includes(kind));
    if (!targetsBots && !targetsEntities) return [];
    const entityStart = start ?? { x: Number(entity.x), y: Number(entity.y) };
    const entityEnd = end ?? entityStart;
    const radius = phaseRadius(phase, "radius", entity.size / 2);
    return findTargets({ x: entityStart.x, y: entityStart.y, rotation: entity.rotation },
        { shape: phase.hitbox?.shape === "circle" ? "circle" : "collider", radius }, {
            world,
            kinds: [...(targetsBots ? [TARGET_KIND_BOT] : []), ...(targetsEntities ? [TARGET_KIND_ENTITY] : [])],
            source: entity,
            sweep: { start: entityStart, end: entityEnd },
            skipOwner: Boolean(phase.skipOwner),
            isTarget: (target, kind) => kind === TARGET_KIND_BOT
                ? isEnemy(entity, target, world.bots)
                    && Number(target.hp ?? BASE_BOT_HP) > 0
                    && !ignoresHostileEffects(target)
                : eventTargetsEntity(targetEvent, targetKindsForEntity(target))
                    && (target?.hp == null || Number(target.hp) > 0)
                    && (targetAllowsFriendlyDamage(target) || entityOwnersAreHostile(entity, target, world.bots)),
        }).map(({ target, distance }) => ({ bot: target, collisionDistance: distance }));
}

function collisionCheckCount(entity, phase, stepMs) {
    return scheduledEventCount(entity, phase, PHASE_EVENT_TYPES.COLLISION, stepMs);
}

/**
 * Generic phase-event scheduler. The event key describes what is evaluated;
 * its schedule describes when it is evaluated. `once` fires on phase entry,
 * `repeat` fires on a fixed cadence, and `continuous` is reserved for
 * collision geometry that is checked every simulation tick.
 */
function scheduledEventCount(entity, phase, eventType, stepMs) {
    const handler = phase?.on?.[eventType];
    const currentState = entity?.eventScheduleState ?? {};
    if (!handler) return { count: 0, state: currentState[eventType] ?? {} };

    const schedule = handler.schedule ?? {
        mode: eventType === PHASE_EVENT_TYPES.COLLISION
            ? EVENT_SCHEDULE_MODES.CONTINUOUS : EVENT_SCHEDULE_MODES.ONCE,
    };
    const previous = currentState[eventType] ?? {};
    const mode = schedule.mode;
    if (mode === EVENT_SCHEDULE_MODES.CONTINUOUS) {
        return {
            count: eventType === PHASE_EVENT_TYPES.COLLISION ? 1 : previous.occurrences ? 0 : 1,
            state: eventType === PHASE_EVENT_TYPES.COLLISION
                ? previous : { initialized: true, occurrences: 1 },
        };
    }
    if (mode === EVENT_SCHEDULE_MODES.ONCE) {
        const count = Number(previous.occurrences ?? 0) > 0 ? 0 : 1;
        return {
            count,
            state: { initialized: true, occurrences: Number(previous.occurrences ?? 0) + count },
        };
    }

    const intervalMs = Math.max(1, resolvePhaseNumber(
        schedule.intervalMs, phase,
        Math.max(1, stepMs),
    ));
    const maxOccurrences = Number(schedule.count);
    const previousOccurrences = Math.max(0, Number(previous.occurrences ?? 0));
    if (Number.isFinite(maxOccurrences) && maxOccurrences > 0
        && previousOccurrences >= Math.trunc(maxOccurrences)) {
        return {
            count: 0,
            state: { initialized: true, occurrences: previousOccurrences, timerMs: null },
        };
    }
    const initialized = previous.initialized === true;
    let timerMs = initialized
        ? Number(previous.timerMs ?? 0) - Math.max(0, stepMs)
        : (schedule.startImmediately === false ? intervalMs : 0) - Math.max(0, stepMs);
    let count = 0;
    while (timerMs <= 0 && count < 100) {
        if (Number.isFinite(maxOccurrences) && maxOccurrences > 0
            && previousOccurrences + count >= Math.trunc(maxOccurrences)) break;
        count += 1;
        timerMs += intervalMs;
    }
    return {
        count,
        state: {
            initialized: true,
            occurrences: previousOccurrences + count,
            timerMs,
        },
    };
}

function withEventScheduleState(entity, eventType, state) {
    entity.eventScheduleState = {
        ...(entity?.eventScheduleState ?? {}),
        [eventType]: state ?? {},
    };
    return entity;
}

function markScheduledEventState(scheduleState, eventType) {
    const previous = scheduleState?.[eventType] ?? {};
    return {
        ...(scheduleState ?? {}),
        [eventType]: {
            ...previous,
            initialized: true,
            occurrences: Math.max(1, Number(previous.occurrences ?? 0)),
        },
    };
}

function markScheduledEvent(entity, eventType) {
    entity.eventScheduleState = markScheduledEventState(entity?.eventScheduleState, eventType);
    return entity;
}

function resolvePhaseNumber(value, phase, fallback = 0) {
    if (value == null) return Number(fallback);
    if (typeof value === "number") return value;
    if (typeof value === "string") return Number(phase?.statOverrides?.[value] ?? fallback);
    return Number(value?.value ?? value?.fallback ?? fallback);
}

function phaseStat(phase, name, fallback = 0) {
    if (name == null) return Number(fallback);
    if (typeof name === "number") return name;
    if (typeof name === "object") {
        return Number(name.value ?? name.fallback ?? fallback);
    }
    return Number(phase?.statOverrides?.[name] ?? fallback);
}

function phaseRadius(phase, fallbackStat = null, fallback = 0) {
    const radius = phaseStat(phase, phase?.hitbox?.radius ?? fallbackStat, fallback);
    return radius * Number(phase?.hitbox?.radiusMultiplier ?? 1);
}

function entityCollisionRemovalIds(world) {
    const removed = new Set();
    const targets = (world.entities ?? []).filter((entity) => {
        const phase = phaseForEntity(entity);
        return phase?.health && Number(entity.hp ?? 0) > 0;
    });
    for (const source of world.entities ?? []) {
        const sourcePhase = phaseForEntity(source);
        const collisionEvent = sourcePhase?.on?.[PHASE_EVENT_TYPES.COLLISION];
        if (!eventHasVerb(collisionEvent, VERBS.APPLY_EFFECTS)
            || !eventHasVerb(collisionEvent, VERBS.REMOVE)) continue;
        for (const target of targets) {
            if (source.id === target.id
                || !targetAllowsFriendlyDamage(target)
                    && !entityOwnersAreHostile(source, target, world.bots)) continue;
            if (damagingEntityCollision(source, target, world.bots)) {
                removed.add(source.id);
                break;
            }
        }
    }
    return removed;
}

function damagingEntityCollision(source, target, bots = []) {
    const phase = phaseForEntity(source);
    const collisionEvent = phase?.on?.[PHASE_EVENT_TYPES.COLLISION];
    if (!targetAllowsFriendlyDamage(target) && !entityOwnersAreHostile(source, target, bots)
        || !eventTargetsEntity(collisionEvent, targetKindsForEntity(target))
        || !phaseEffects(phase).some((effect) => effect?.type === EFFECT_TYPES.DAMAGE
            && effectTargetsTarget(effect, targetKindsForEntity(target)))
        || !eventHasVerb(collisionEvent, VERBS.APPLY_EFFECTS)) return null;
    return entityCollision(source, target);
}

function targetAllowsFriendlyDamage(target) {
    return Boolean(phaseForEntity(target)?.health?.allowFriendlyDamage);
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

/** An age-timed entity lives exactly its lifetime duration of ticks (the server counts ageMs only); others run down remainingMs. */
function lifeEnded(entity, phase) {
    if (entityContract(entity)?.lifetime?.timerMode === "age") return lifetimeExpired(entity);
    return entity.remainingMs != null && Number(entity.remainingMs) <= 0
        || phase.durationMs == null && lifetimeExpired(entity);
}

/** The entity has lived through its contract's whole lifetime, whatever its remaining clock says. */
function lifetimeExpired(entity) {
    const lifetime = entityContract(entity)?.lifetime;
    if (lifetime?.duration == null) return false;
    return Number(entity?.ageMs ?? 0) >= Number(lifetime.duration) + Number(lifetime.add ?? 0);
}

function overlaps(first, second) {
    return entityCollision(first, second) != null;
}

// --- verbs and scheduling helpers --------------------------------------------------------------------------------

/** Runs an event through the verb executor; entities its `spawn` verbs create wait in the world's queue. */
function dispatch(entity, eventType, options) {
    const result = dispatchEntityEvent(entity, eventType, options);
    options.world?.spawnQueue?.push(...result.spawned);
    return result;
}

function eventHasVerb(event, kind) {
    return eventVerbs(event).some((verb) => verb.do === kind);
}

/** The effects the `applyEffects` verbs of one event apply, in order. */
function eventApplyEffects(event) {
    return verbEffects(eventVerbs(event).filter((verb) => verb.do === VERBS.APPLY_EFFECTS));
}

/**
 * True when a timer event is due: its countdown reached zero and it has runs left. A fresh entity is due at
 * once unless the event starts later.
 */
function scheduleDue(entity, event) {
    const intervalMs = Number(event.schedule?.intervalMs);
    const count = Number(event.schedule?.count);
    if (Number.isFinite(count) && count > 0
        && Number(entity.eventScheduleState?.schedule?.occurrences ?? 0) >= Math.trunc(count)) return false;
    const initialized = entity.eventScheduleState?.schedule?.initialized === true;
    if (!initialized && event.schedule?.startImmediately === false) return false;
    return entity.intervalTimerMs <= 0 && intervalMs > 0;
}

/**
 * First stage of the entity tick. An entity bound to its cast ends as soon as the ability that spawned it
 * leaves its active stage (it finished or was interrupted); an entity that follows its owner takes the owner's
 * pose plus its spawn offset.
 */
function bindEntitiesToOwners(world) {
    const entities = [];
    for (const entity of world.entities) {
        const owner = entity.ownerId == null ? null : ownerBot(world.bots, entity);
        if (entity.bindToCast && !castIsActive(entity, owner)) continue;
        const phase = phaseForEntity(entity);
        if (phase?.movement?.mode === MOVEMENT_MODES.FOLLOW_OWNER && owner) followOwner(entity, owner);
        entities.push(entity);
    }
    return entities;
}

function castIsActive(entity, owner) {
    const record = owner ? abilityRecord(owner, entity.abilityId) : null;
    return record?.stage === ABILITY_STAGES.ACTIVE;
}

function followOwner(entity, owner) {
    const definition = entityContract(entity);
    const pose = ownerRelativePose(owner, definition?.spawn, {
        angle: Number(entity.patternAngle ?? 0),
        lateral: Number(entity.patternLateral ?? 0),
    });
    const fromX = Number(entity.x);
    const fromY = Number(entity.y);
    entity.movementStartX = entity.x;
    entity.movementStartY = entity.y;
    entity.x = pose.x;
    entity.y = pose.y;
    entity.rotation = pose.rotation;
    entity.velocityX = pose.x - fromX;
    entity.velocityY = pose.y - fromY;
    entity.traveled = entity.traveled + Math.hypot(pose.x - fromX, pose.y - fromY);
}
