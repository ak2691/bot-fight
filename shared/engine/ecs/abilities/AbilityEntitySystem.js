import { angleDelta, clamp, normalizeAngle } from "../../gameconfig/geometry.js";
import { entityMovementSegment, findTargets, TARGET_KIND_BOT, TARGET_KIND_ENTITY } from "./findTargets.js";
import { advanceEntityAge } from "../entities/EntityWorld.js";
import {
    EVENT_SCHEDULE_MODES,
    EFFECT_TYPES,
    eventTargetsEntity,
    isAttachedEntity,
    eventTargetsKind,
    eventVerbs,
    MOVEMENT_MODES,
    PHASE_EVENT_TYPES,
    phaseSpeed,
    TARGET_KINDS,
    targetKindsForEntity,
    VERBS,
} from "../contracts/AbilityContracts.js";
import { applyEffectsToEntity, phaseStatsFor } from "./effects.js";
import { tickStatuses } from "../bots/BotStatusSystem.js";
import { areEnemies } from "../contracts/teams.js";
import { resolveDataNumber } from "../../gameconfig/dataValues.js";
import { ignoresHostileEffects, reactsToBlockedHits } from "../../gameconfig/DefensiveState.js";
import {
    effectiveMovementSpeedMultiplier,
    effectiveRotationSpeedMultiplier,
} from "../../gameconfig/HitStagger.js";
import { compassDirection, vectorToCompassDegrees } from "../../botlogic/planner/arenaAngles.js";
import {
    entityContract,
    phaseForEntity,
    phasesForEntity,
} from "../contracts/AbilityContracts.js";
import { ownerRelativePose } from "../entities/EntityFactory.js";
import { isEntityShape, ownerBot } from "../entities/EntityCombat.js";
import { OWNER_TARGET, SEEK_TARGETS } from "../../gameconfig/vocabulary.js";
import { dispatchEntityEvent } from "./EntityEventSystem.js";
import { collectHitTargets, verbHitbox } from "./AbilityHitDetectionSystem.js";
import { abilityRecord } from "../../gameconfig/AbilityState.js";
import { BASE_BOT_HP } from "../../modelPayloads/arenaConstants.js";
import {
    clearPresenceStatuses,
    isBlocked,
} from "../contracts/StatusContracts.js";

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
    // The impacts queued on HP entities this tick, keyed by the target's id: the resolveHits stage queues bots' hits in
    // `world.impacts`, and entity collisions and hits add to it here. They land in applyCollisionImpacts.
    const impacts = world.impacts ?? new Map();
    for (const entity of world.entities) {
        entity.tickStartHp = entity.hp == null ? null : Number(entity.hp);
        entity.damageTakenThisTick = 0;
        if (!world.entitiesAged) advanceEntityAge(entity, world.stepMs);
    }
    for (const bot of world.bots) clearPresenceStatuses(bot);
    const staged = { ...world, spawnQueue, impacts };
    staged.entities = bindEntitiesToOwners(staged);
    staged.entities = settleTriggerEntities(staged);
    staged.entities = settleRemainingEntities(staged);
    // Every collision has run, so every entity impact is known: they land now, in one pass.
    dropUnlandedBotImpacts(impacts);
    const settled = applyCollisionImpacts(staged.entities, tickRun({ ...staged, entities: staged.entities }));
    const entities = [...settled, ...spawnQueue];
    for (const entity of entities) {
        entity.phaseEnteredThisTick = false;
        entity.damageTakenLastTick = Number(entity.damageTakenThisTick ?? 0);
        entity.damageTakenThisTick = 0;
        entity.hpNetChangeLastTick = entity.hp == null || entity.tickStartHp == null
            ? 0
            : Number(entity.hp) - Number(entity.tickStartHp);
    }
    pruneEntityActivations(world.bots, entities);
    return { ...world, entities, bots: world.bots };
}

/**
 * An owner's record of which activation spawned each entity (`entityActivations`) only needs the entities that still
 * exist. Entries of entities that ended are dropped here, so the record does not grow for the whole fight.
 */
function pruneEntityActivations(bots, entities) {
    const live = new Set(entities.map((entity) => String(entity.id)));
    for (const bot of bots) {
        const activations = bot.entityActivations;
        if (!activations) continue;
        const kept = Object.entries(activations).filter(([id]) => live.has(id));
        if (kept.length !== Object.keys(activations).length) bot.entityActivations = Object.fromEntries(kept);
    }
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
        impacts: world.impacts ?? new Map(),
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
 * Advances the clocks and the entity's statuses. Entities whose phase carries a trigger settle together (a chain
 * trigger crosses entities), so the two halves can run apart.
 */
function advanceEntity(entity, run) {
    const world = run.world;
    const stepMs = Number(world.stepMs ?? 0);
    clearEntityPresenceStatuses(entity);
    const phase = phaseForEntity(entity);
    const previousHp = phase.health
        ? Math.max(0, Number(entity.hp ?? phase.health.hp ?? phase.health.maxHp ?? 0)) : 0;
    const remainingBefore = entity.remainingMs == null ? null : Number(entity.remainingMs);
    tickStatuses(entity, stepMs, world.bots);
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
        applyBotImpacts(entity, run);
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

    // Damage taken in the advance (a status tick) raises `hit` and `killed`. An entity with no `killed` handler dies when its health runs out.
    if (damage > 0) {
        const reacted = reactToDamage(run, entity, phase, killed);
        if (!reacted.entity) return null;
        if (reacted.entered) return reacted.entity;
        entity = reacted.entity;
        phase = reacted.phase;
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
            // A timer event counts its shots, so `schedule.count` caps them.
            const shots = entity.eventScheduleState?.[PHASE_EVENT_TYPES.SCHEDULE] ?? {};
            withEventScheduleState(entity, PHASE_EVENT_TYPES.SCHEDULE, { ...shots, occurrences: Number(shots.occurrences ?? 0) + 1 });
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
        impacts: run.impacts,
        ...options,
    });
}

/** How many rounds the impact pass runs. A round's reactions can queue more impacts, which get the next round. */
const MAX_IMPACT_ROUNDS = 8;

/**
 * The impacts that hits and collisions queued this tick land in one pass over the entities, after every entity has
 * settled, so the result does not depend on the order the entities settled in. A target hurt this tick reacts as a
 * hurt entity does (`hit`, `killed`, removal). Returns the entities that remain.
 */
function applyCollisionImpacts(entities, run) {
    let list = entities;
    for (let round = 0; round < MAX_IMPACT_ROUNDS && run.impacts.size > 0; round += 1) {
        const queued = [...run.impacts];
        run.impacts.clear();
        for (const [targetId, impacts] of queued) {
            const target = list.find((entity) => entity.id === targetId);
            if (!target || target.hp == null) continue;
            const phase = phaseForEntity(target);
            const previousHp = phase?.health ? Math.max(0, Number(target.hp)) : 0;
            for (const impact of impacts) applyEffectsToEntity(target, impact, run.world);
            const damage = Math.max(0, previousHp - Number(target.hp ?? previousHp));
            if (damage <= 0 || !phase?.health) continue;
            const killed = previousHp > 0 && Number(target.hp ?? 0) <= 0;
            if (!reactToDamage(run, target, phase, killed).entity) list = list.filter((entity) => entity !== target);
        }
    }
    return list;
}

/**
 * An entity hurt this tick raises its `killed` event (when it died) or its `hit` event. An entity with no `killed`
 * handler dies when its health runs out. Returns { entity, entered, phase }: `entity` is null when it is gone, `entered`
 * when the event moved it into another phase (that phase's entry has run), and `phase` is the phase it is in now.
 */
function reactToDamage(run, entity, phase, killed) {
    const type = killed ? PHASE_EVENT_TYPES.KILLED : PHASE_EVENT_TYPES.HIT;
    const handler = phase.on?.[type];
    const current = handler ? fire(run, entity, type, phase).entity : entity;
    if (!current || killed && !handler) return { entity: null, entered: false, phase };
    const incomingPhase = phaseForEntity(current);
    if (Number(current.hp ?? 0) <= 0 && (!incomingPhase || incomingPhase.health)) return { entity: null, entered: false, phase };
    const entered = enterPhase(run, current, phase, handler, type);
    return { entity: entered.entity, entered: entered.entered, phase: incomingPhase ?? phase };
}

/**
 * Phase entry. When an event moved the entity into another phase, that phase's collision runs once at its
 * position (unless the event opted out). This is the only place the entered phase's collision check lives.
 */
function enterPhase(run, entity, fromPhase, event, eventType) {
    const entered = entity ? phaseForEntity(entity) : null;
    if (!entered || entered.id === fromPhase.id) return { entity, entered: false };
    // An attached entity's move ran in this tick's event (a lunge), so its pose is the owner's new one before its collision runs.
    if (isAttachedEntity(entity)) rebindToOwner(entity, entered, run.bots);
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

    const entries = [];
    for (const source of group) {
        const advanced = advanceEntity(source, run);
        const { entity, killed } = advanced;
        const phase = phaseForEntity(entity);
        if (phase?.health && Number(entity.hp ?? 0) <= 0 && !killed) continue;
        entries.push({ advanced, killed });
    }
    const triggered = resolveTriggers(entries, run.world);
    const groupIds = new Set(group.map((entity) => entity.id));
    const entities = world.entities.filter((entity) => !groupIds.has(entity.id));
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
    const entities = [];
    for (const entity of world.entities) {
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

/**
 * The trigger group's ids that fire this tick: a body killed this tick (a killed trap still counts), an enemy in
 * `trigger.contact` inside the radius, or a chain from a neighbour that fired.
 */
function resolveTriggers(entries, world) {
    const fired = new Set();
    for (const { advanced, killed } of entries) {
        const { entity, phase } = advanced;
        if (killed || triggerContact(entity, phase, world)) fired.add(entity.id);
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

/**
 * Whether the proximity sensor notices an enemy inside the trigger radius. `trigger.contact` lists the kinds: "BOT"
 * is an enemy bot, "SUMMON" an enemy summon entity. Projectiles and damage never count here; those reach the body.
 */
function triggerContact(entity, phase, world) {
    const contact = phase.trigger.contact ?? [];
    const pose = { x: entity.x, y: entity.y, rotation: entity.rotation };
    const reach = { shape: "circle", radius: triggerRadius(phase) };
    // Bots are swept from the trap, with the trap's trigger circle as the reach.
    if (contact.includes("BOT") && findTargets(pose, reach, {
        world,
        kinds: [TARGET_KIND_BOT],
        source: entity,
        sweep: entityMovementSegment(entity),
        isTarget: (bot) => areEnemies(entity, bot, world.bots),
    }).length > 0) return true;
    // Summons are measured from the trigger circle too. A source entity would lend its own body as the collider.
    return contact.includes("SUMMON") && findTargets(pose, reach, {
        world,
        kinds: [TARGET_KIND_ENTITY],
        isTarget: (summon) => summon.id !== entity.id
            && targetKindsForEntity(summon).includes(TARGET_KINDS.SUMMON)
            && (summon.hp == null || Number(summon.hp) > 0)
            && entityOwnersAreHostile(entity, summon, world.bots),
    }).length > 0;
}

/**
 * `trigger.radius` is the only radius a trigger uses, for detection, chains and trigger targets. The phase hitbox
 * (radius and radiusMultiplier) is the entity's body and never widens or narrows a trigger.
 */
function triggerRadius(phase) {
    return resolveDataNumber(phase?.trigger?.radius, {}, 0);
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
            isTarget: (bot) => areEnemies(entity, bot, world.bots)
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

    const speed = resolveDataNumber(phaseSpeed(phase), {}, 0);
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
    const target = seekTargetOf(entity, movement, world);
    const idle = { start, end: start, hitEdge: false, seeking: true, target, entity };
    if (!target) return idle;

    const dx = target.x - entity.x;
    const dy = target.y - entity.y;
    const targetDistance = Math.max(1, Math.hypot(dx, dy));
    const turn = resolveDataNumber(movement.turnDegrees, {}, 8) * effectiveRotationSpeedMultiplier(entity);
    const speed = canMove(entity)
        ? resolveDataNumber(phaseSpeed(phase), {}, 0) * effectiveMovementSpeedMultiplier(entity)
        : 0;
    const rotation = normalizeAngle(entity.rotation + clamp(
        angleDelta(entity.rotation, vectorToCompassDegrees(dx, dy)),
        -turn,
        turn,
    ));
    const size = resolveDataNumber(movement.size, {}, entity.size);
    const end = {
        x: clamp(entity.x + dx / targetDistance * Math.min(speed, targetDistance), size / 2, world.width - size / 2),
        y: clamp(entity.y + dy / targetDistance * Math.min(speed, targetDistance), size / 2, world.height - size / 2),
    };
    entity.x = end.x;
    entity.y = end.y;
    entity.rotation = rotation;
    return { ...idle, end };
}

/**
 * What a seek entity turns toward and closes on: its owner when the movement's `target` is `owner` (a boomerang
 * coming back; nothing once the owner is dead, so the entity drifts until its lifetime ends), otherwise the nearest
 * living enemy.
 */
function seekTargetOf(entity, movement, world) {
    if (movement.target === SEEK_TARGETS.OWNER) {
        const owner = ownerBot(world.bots, entity);
        return owner && owner.hp > 0 ? owner : null;
    }
    return world.bots
        .filter((bot) => areEnemies(entity, bot, world.bots) && bot.hp > 0)
        .sort((first, second) => Math.hypot(first.x - entity.x, first.y - entity.y)
            - Math.hypot(second.x - entity.x, second.y - entity.y))[0] ?? null;
}

// --- queued impacts and entity statuses ----------------------------------------------------------------------------

/**
 * Lands the hits that bots queued on this HP entity, as the entity advances: a bot's hit takes effect in the tick it is
 * made, before the entity's own events. The impact queue holds bots' hits and entities' hits and collisions alike; only
 * the bots' are taken here. The entities' wait for applyCollisionImpacts. The target changes in place.
 */
function applyBotImpacts(target, run) {
    const queued = run.impacts.get(target.id) ?? [];
    const remaining = queued.filter((impact) => isEntityShape(impact.source));
    if (remaining.length > 0) run.impacts.set(target.id, remaining);
    else run.impacts.delete(target.id);
    if (target.hp == null) return;
    for (const impact of queued) {
        if (!isEntityShape(impact.source)) applyEffectsToEntity(target, impact, run.world);
    }
}

/**
 * Drops the bots' hits whose target did not advance this tick. They never landed, and a hit queued on an entity that
 * settled without advancing was dropped at the end of the tick before the queue existed.
 */
function dropUnlandedBotImpacts(impacts) {
    for (const [targetId, queued] of [...impacts]) {
        const remaining = queued.filter((impact) => isEntityShape(impact.source));
        if (remaining.length > 0) impacts.set(targetId, remaining);
        else impacts.delete(targetId);
    }
}

function clearEntityPresenceStatuses(entity) {
    if (!Array.isArray(entity?.statusEffects)) return;
    const remaining = entity.statusEffects.filter((status) => status?.mode !== "presence");
    if (remaining.length !== entity.statusEffects.length) entity.statusEffects = remaining;
}

function canMove(entity) {
    return !isBlocked(entity, "move");
}

function canExecute(entity) {
    return canMove(entity) && !isBlocked(entity, "ability");
}

function canonicalCollisionTargets(entity, phase, world, start = null, end = null) {
    if (isAttachedEntity(entity)) return attachedCollisionTargets(entity, phase, world);
    // Collision cadence belongs to the collision event's schedule.
    // `execution` is reserved for embedded summon abilities.
    const targetEvent = phase.on?.[PHASE_EVENT_TYPES.COLLISION];
    const targetsBots = eventTargetsKind(targetEvent, TARGET_KINDS.BOT);
    const declaredTargetKinds = Array.isArray(targetEvent?.targets) ? targetEvent.targets : [];
    const targetsEntities = declaredTargetKinds.some((kind) => [
        TARGET_KINDS.HP_ENTITY, TARGET_KINDS.SUMMON, TARGET_KINDS.ENTITY,
    ].includes(kind));
    // OWNER names the bot that owns the entity: it is touched only while alive, and it is the only bot an OWNER event matches.
    const targetsOwner = declaredTargetKinds.includes(OWNER_TARGET);
    const owner = targetsOwner ? ownerBot(world.bots, entity) : null;
    if (!targetsBots && !targetsEntities && !targetsOwner) return [];
    const entityStart = start ?? { x: Number(entity.x), y: Number(entity.y) };
    const entityEnd = end ?? entityStart;
    const radius = phaseRadius(phase, "radius", entity.size / 2);
    return findTargets({ x: entityStart.x, y: entityStart.y, rotation: entity.rotation },
        { shape: phase.hitbox?.shape === "circle" ? "circle" : "collider", radius }, {
            world,
            kinds: [...((targetsBots || owner != null) ? [TARGET_KIND_BOT] : []), ...(targetsEntities ? [TARGET_KIND_ENTITY] : [])],
            source: entity,
            sweep: { start: entityStart, end: entityEnd },
            // The owner is skipped by `skipOwner` unless the event names it.
            skipOwner: Boolean(phase.skipOwner) && !targetsOwner,
            isTarget: (target, kind) => kind === TARGET_KIND_BOT
                ? (targetsBots && areEnemies(entity, target, world.bots)
                    && Number(target.hp ?? BASE_BOT_HP) > 0
                    && (!ignoresHostileEffects(target) || reactsToBlockedHits(target)))
                    || (owner != null && target === owner && Number(target.hp ?? 0) > 0)
                : eventTargetsEntity(targetEvent, targetKindsForEntity(target))
                    && (target?.hp == null || Number(target.hp) > 0)
                    && (targetAllowsFriendlyDamage(target) || entityOwnersAreHostile(entity, target, world.bots)),
        }).map(({ target, distance }) => ({ bot: target, collisionDistance: distance }));
}

/**
 * An attached entity's collision tests its phase hitbox exactly as an activation hit does (the same shape test, with
 * includeTargetRadius), from its current pose. It does not sweep a collider, because it moves only with its owner.
 */
function attachedCollisionTargets(entity, phase, world) {
    const event = phase.on?.[PHASE_EVENT_TYPES.COLLISION];
    const hitbox = verbHitbox(phase.hitbox ?? {}, entity);
    if (!hitbox) return [];
    const bots = eventTargetsKind(event, TARGET_KINDS.BOT)
        ? world.bots.filter((bot) => areEnemies(entity, bot, world.bots)
            && Number(bot.hp ?? BASE_BOT_HP) > 0
            && !ignoresHostileEffects(bot))
        : [];
    const entities = (world.entities ?? []).filter((other) => other.id !== entity.id
        && eventTargetsEntity(event, targetKindsForEntity(other))
        && (other.hp == null || Number(other.hp) > 0)
        && (targetAllowsFriendlyDamage(other) || entityOwnersAreHostile(entity, other, world.bots)));
    const pose = { x: Number(entity.x), y: Number(entity.y), rotation: entity.rotation };
    return collectHitTargets(pose, hitbox, [...bots, ...entities], {
        nearestOnly: Boolean(event?.nearestOnly),
        stepMs: world.stepMs,
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

    const intervalMs = Math.max(1, resolveDataNumber(
        schedule.intervalMs, {},
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

function phaseRadius(phase, fallbackStat = null, fallback = 0) {
    // A stat name is looked up in the phase's own stats, which carry a radius only from hitbox.radius.
    const radius = resolveDataNumber(phase?.hitbox?.radius ?? { stat: fallbackStat, fallback }, { stats: phaseStatsFor(phase) });
    return radius * Number(phase?.hitbox?.radiusMultiplier ?? 1);
}

function targetAllowsFriendlyDamage(target) {
    return Boolean(phaseForEntity(target)?.health?.allowFriendlyDamage);
}

function entityOwnersAreHostile(source, target, bots = []) {
    if (!source || !target || source.id === target.id) return false;
    // A shape with no owner slot (a bot) is hostile to any entity, and the same id is never hostile.
    if (source.ownerSlot == null || target.ownerSlot == null) return true;
    return areEnemies(source, target, bots);
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
 * First stage of the entity tick. An entity that follows its owner takes the owner's pose plus its spawn
 * offset.
 */
function bindEntitiesToOwners(world) {
    const entities = [];
    for (const entity of world.entities) {
        const owner = entity.ownerId == null ? null : ownerBot(world.bots, entity);
        // An attached entity ends with its cast: it goes when its owner dies, or its cast was interrupted.
        if (isAttachedEntity(entity) && !attachedCastLives(entity, owner)) continue;
        const phase = phaseForEntity(entity);
        if (phase?.movement?.mode === MOVEMENT_MODES.FOLLOW_OWNER && owner) followOwner(entity, owner);
        entities.push(entity);
    }
    return entities;
}

/**
 * Whether an attached entity's cast is still running. Its owner must be alive, and the owner's record of the entity's
 * ability must not carry an interrupt stamped with the entity's own activation serial. A cast that ended normally has
 * no such stamp, so its entities live on for their remaining time.
 */
function attachedCastLives(entity, owner) {
    if (!owner || Number(owner.hp ?? 0) <= 0) return false;
    const serial = owner.entityActivations?.[entity.id] ?? owner.activationSerial ?? 0;
    return abilityRecord(owner, entity.abilityId)?.interruptedSerial !== serial;
}

/** An attached entity's phase entered on a tick its owner moved: it takes the owner's pose before its collision runs. */
function rebindToOwner(entity, phase, bots) {
    const owner = ownerBot(bots, entity);
    if (owner && phase.movement?.mode === MOVEMENT_MODES.FOLLOW_OWNER) followOwner(entity, owner);
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
