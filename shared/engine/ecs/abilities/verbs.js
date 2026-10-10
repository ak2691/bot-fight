import { ACTION_TO_ABILITY } from "../../loadout/BotLoadout.js";
import {
    compassDirection,
    movementAngle,
    relativeMovementVector,
} from "../../botlogic/planner/arenaAngles.js";
import { clamp, rayIntersectsCircle } from "../../gameconfig/geometry.js";
import { ARENA_HEIGHT_UNITS, ARENA_WIDTH_UNITS } from "../../modelPayloads/arenaConstants.js";
import {
    abilityContract,
    EFFECT_TYPES,
    effectTargetsTarget,
    entityContract,
    findVerb,
    OWNER_TARGET,
    phaseById,
    phaseForEntity,
    TARGET_KINDS,
    TARGET_POLICY_MODES,
    VERBS,
} from "../contracts/AbilityContracts.js";
import { ignoresHostileEffects, isAliveBot } from "../../gameconfig/DefensiveState.js";
import {
    abilityPose,
    entityAbilitySpawnTransform,
} from "../../gameconfig/hitboxGeometry.js";
import { combatVisualDurationMs } from "../../gameconfig/visualState.js";
import { recordAbilityHit } from "../../gameconfig/AbilityHitRecord.js";
import { withCombatAbility } from "../combatLog.js";
import {
    applyEffect,
    applyEffectsFromEntity,
    ENEMY_HIT_EFFECT_TYPES,
    phaseStatsFor,
    roundCombatValue,
} from "./effects.js";
import { findTargets, TARGET_KIND_BOT } from "./findTargets.js";
import { triggerPose, verbHitbox, verbHitsTarget } from "./AbilityHitDetectionSystem.js";
import { spawnVerbEntities } from "../entities/EntityFactory.js";
import { BASE_BOT_HP } from "../../modelPayloads/arenaConstants.js";

/**
 * The one verb executor. An ability's `onTrigger` list and every entity event's `do` list run through
 * `executeVerb`. A run context says where the verb runs:
 *
 *   act      the owner bot as the tick starts its ability (face, move)
 *   resolve  a roster of bots after every bot has acted (applyEffects on the owner, hit)
 *   entity   one arena entity handling an event (hit, spawn, applyEffects, transition, remove, emitVisual)
 *
 * A trigger verb runs in the tick stage that owns it (VERB_STAGE): move in act, applyEffects and hit
 * in resolveHits, spawn at the end of act from the bot's final pose (the stage after adds the entities to the
 * world). The run contexts are mutable; each runner below builds a fresh one. The bots and the entity a verb
 * changes are changed in place.
 */
export const VERB_STAGE = Object.freeze({
    [VERBS.MOVE]: "act",
    [VERBS.SPAWN]: "act",
    [VERBS.APPLY_EFFECTS]: "resolveHits",
    [VERBS.HIT]: "resolveHits",
});

export function executeVerb(verb, run) {
    switch (verb.do) {
        case VERBS.MOVE: return moveVerb(verb, run);
        case VERBS.SPAWN: return spawnVerb(verb, run);
        case VERBS.APPLY_EFFECTS: return applyEffectsVerb(verb, run);
        case VERBS.HIT: return hitVerb(verb, run);
        case VERBS.TRANSITION: return transitionVerb(verb, run);
        case VERBS.REMOVE: return removeVerb(verb, run);
        case VERBS.EMIT_VISUAL: return emitVisualVerb(verb, run);
        default: return run;
    }
}

// --- act stage ---------------------------------------------------------------------------------------------

/**
 * Runs the act-stage trigger verbs on the owner: the pose capture, then move. Returns the bot.
 */
export function applyActivationVerbs(bot, payload, elapsedMs) {
    const verbs = payload.contract?.onTrigger ?? [];
    const run = { kind: "act", bot, payload, elapsedMs };
    const capture = payload.activation?.capture;
    if (capture) {
        // Capture the new activation from the current owner pose. Do not read an older capture field that
        // may still be present on the bot shape.
        const pose = entityAbilitySpawnTransform(bot, findVerb(verbs, VERBS.HIT)?.origin ?? null);
        const captured = Object.entries(capture).map(([field, source]) => [field,
            source === "x" ? pose.x
                : source === "y" ? pose.y
                    : source === "rotation" ? pose.rotation
                        : bot[source] ?? null]);
        for (const [field, value] of captured) bot[field] = value;
    }
    for (const verb of verbs) if (verb.do === VERBS.MOVE) executeVerb(verb, run);
    return bot;
}

function moveVerb(verb, run) {
    const { bot, payload, elapsedMs } = run;
    const hasTarget = Number.isFinite(Number(payload.targetX)) && Number.isFinite(Number(payload.targetY));
    const targetDx = hasTarget ? Number(payload.targetX) - bot.x : 0;
    const targetDy = hasTarget ? Number(payload.targetY) - bot.y : 0;
    const targetVector = Math.hypot(targetDx, targetDy) > 0.001
        ? { x: targetDx, y: targetDy }
        : compassDirection(bot.rotation);
    const direction = payload.movementDirection ?? 0;
    const { x: ux, y: uy } = payload.movementMode === "absolute"
        ? compassDirection(movementAngle(direction))
        : relativeMovementVector(targetVector.x, targetVector.y, direction);
    const distance = Number(verb.distance);
    const stepDistance = Number(verb.unitsPerTick);
    const step = Math.min(stepDistance, distance);
    const x = clamp(bot.x + ux * step, bot.size / 2, ARENA_WIDTH_UNITS - bot.size / 2);
    const y = clamp(bot.y + uy * step, bot.size / 2, ARENA_HEIGHT_UNITS - bot.size / 2);
    const traveled = Math.hypot(x - bot.x, y - bot.y);
    const trailMs = Number(verb.trailMs);
    // A dash starts after ordinary movement for this tick. Its swept hit path must therefore begin at this
    // pose, not at the pre-tick pose.
    bot.movementStartX = bot.x;
    bot.movementStartY = bot.y;
    bot.dashOriginX = bot.x;
    bot.dashOriginY = bot.y;
    bot.x = x;
    bot.y = y;
    // activeMs is ability-level timing; movement distance/speed/trail live on the verb.
    bot.dashRemaining = Math.max(0, distance - traveled);
    bot.dashInitialDistance = distance;
    bot.dashStepDistance = stepDistance;
    bot.dashDirectionX = ux;
    bot.dashDirectionY = uy;
    bot.dashTrailMs = trailMs + elapsedMs;
    bot.abilityVisual = { ability: payload.abilityId, ms: trailMs };
    return run;
}

// --- spawn -------------------------------------------------------------------------------------------------

/**
 * The entities the ability's spawn verbs create from the bot's final pose, in verb order and pattern index
 * order. Serial IDs run from `serial` in that order.
 */
export function spawnTriggerEntities(bot, payload, { serial, targetX, targetY, activationSerial, clampFn }) {
    const abilityId = payload?.abilityId;
    const created = [];
    for (const verb of payload?.contract?.onTrigger ?? []) {
        if (verb.do !== VERBS.SPAWN) continue;
        const entities = spawnVerbEntities(bot, abilityId, verb, {
            serial: serial + created.length,
            targetX,
            targetY,
            activationSerial,
            clamp: clampFn,
            width: ARENA_WIDTH_UNITS,
            height: ARENA_HEIGHT_UNITS,
        });
        created.push(...entities.filter(Boolean));
    }
    return created;
}

function spawnVerb(verb, run) {
    if (run.kind !== "entity") return run;
    const { entity } = run;
    const ownerIndex = run.bots.findIndex((bot) => bot.id === entity.ownerId);
    const owner = run.bots[ownerIndex];
    if (!owner) return run;
    const serial = Math.max(1, Math.trunc(Number(owner.abilityEntitySerial) || 1));
    // The new entity spawns from the pose of the entity that spawned it; the bot stays its owner.
    const source = {
        ...owner,
        x: entity.x,
        y: entity.y,
        rotation: entity.rotation,
        size: entity.size,
    };
    const created = spawnVerbEntities(source, entity.abilityId, verb, {
        serial,
        activationSerial: owner.entityActivations?.[entity.id] ?? owner.activationSerial ?? 0,
        clamp,
        width: run.world.width ?? ARENA_WIDTH_UNITS,
        height: run.world.height ?? ARENA_HEIGHT_UNITS,
    }).filter(Boolean);
    for (const child of created) {
        child.ownerTeam = entity.ownerTeam;
        if (entity.damageMultiplier != null) child.damageMultiplier = entity.damageMultiplier;
    }
    if (created.length === 0) return run;
    const entityActivations = { ...(owner.entityActivations ?? {}) };
    for (const child of created) entityActivations[child.id] = entityActivations[entity.id] ?? owner.activationSerial ?? 0;
    owner.abilityEntitySerial = serial + created.length;
    owner.entityActivations = entityActivations;
    run.spawned.push(...created);
    return run;
}

// --- resolveHits stage ----------------------------------------------------------------------------------------

function areOpposingTeams(first, second) {
    const firstTeam = Number(first?.teamNumber);
    const secondTeam = Number(second?.teamNumber);
    if (Number.isFinite(firstTeam) && Number.isFinite(secondTeam)
        && firstTeam > 0 && secondTeam > 0) return firstTeam !== secondTeam;
    return Number(first?.slot) !== Number(second?.slot);
}

function distanceFrom(first, second) {
    return Math.hypot(Number(second?.x ?? 0) - Number(first?.x ?? 0), Number(second?.y ?? 0) - Number(first?.y ?? 0));
}

/** The effects of a verb that land on a bot, in declaration order. */
function botEffects(verb) {
    return (verb.effects ?? []).filter((effect) => effectTargetsTarget(effect, [TARGET_KINDS.BOT]));
}

/** Sets the transient `abilityVisual` from the first verb of the ability that declares a visual. */
function setAbilityVisual(attacker, abilityId, contract) {
    const carrier = (contract.onTrigger ?? []).find((verb) => verb.visual);
    if (!carrier) return;
    const hit = findVerb(contract.onTrigger, VERBS.HIT);
    const pose = abilityPose(attacker, hit?.origin ?? null, contract.activation?.capture);
    attacker.abilityVisual = {
        ability: abilityId,
        ms: combatVisualDurationMs(abilityId, carrier.visual),
        x: pose.x,
        y: pose.y,
        rotation: pose.rotation,
    };
}

/**
 * Resolves the trigger verbs of every bot's triggered ability against the roster, changing the bots in place:
 * owner effects first, then each `hit` against the opposing bots.
 */
export function resolveTriggerVerbsForRoster(bots) {
    if (!Array.isArray(bots)) return [];
    const run = { kind: "resolve", bots };
    for (let attackerIndex = 0; attackerIndex < bots.length; attackerIndex += 1) {
        const attacker = bots[attackerIndex];
        if (!attacker) continue;
        const abilityId = ACTION_TO_ABILITY[attacker.triggeredAbility];
        const contract = abilityContract(abilityId);
        if (!abilityId || !contract) continue;
        run.attackerIndex = attackerIndex;
        run.abilityId = abilityId;
        run.contract = contract;
        run.hitIds = new Set();
        setAbilityVisual(attacker, abilityId, contract);
        for (const verb of contract.onTrigger) {
            if (VERB_STAGE[verb.do] === "resolveHits") executeVerb(verb, run);
        }
    }
    return bots;
}

function applyEffectsVerb(verb, run) {
    if (run.kind === "entity") return applyEffectsFromEntityEvent(verb, run);
    if (!(verb.targets ?? []).includes(OWNER_TARGET)) return run;
    // Self effects (heals, buffs, Rewind) land on the owner; nothing else is touched.
    const attacker = run.bots[run.attackerIndex];
    const stats = phaseStatsFor(verb);
    for (const effect of botEffects(verb)) {
        withCombatAbility(run.abilityId, () => applyEffect(effect, {
            abilityId: run.abilityId,
            stats,
            source: attacker,
            owner: attacker,
            target: null,
            originalTarget: null,
            damageMultiplier: Math.max(0, Number(attacker?.attackDamageMultiplier ?? 1)),
            damageConfirmed: false,
            damageConfirmedAmount: 0,
        }));
    }
    return run;
}

function hitVerb(verb, run) {
    if (run.kind === "entity") return hitFromEntity(verb, run);
    const attackerIndex = run.attackerIndex;
    const teleports = Boolean(run.contract.activation?.teleportOncePerActivation);
    // The hitbox is fired from the pose the ability triggered at; a teleport must not move it, so the hit tests
    // read a copy taken now.
    const activationAttacker = { ...run.bots[attackerIndex] };
    const candidates = [];
    for (let defenderIndex = 0; defenderIndex < run.bots.length; defenderIndex += 1) {
        const defender = run.bots[defenderIndex];
        if (defenderIndex === attackerIndex || !areOpposingTeams(activationAttacker, defender)) continue;
        if (verb.oncePerTarget && run.hitIds.has(defender?.id)) continue;
        candidates.push({ defenderIndex, defender });
    }
    if (!(verb.targets ?? []).includes(TARGET_KINDS.BOT)) return run;

    let ordered = candidates;
    if (teleports || verb.nearestOnly) {
        ordered = candidates
            .filter(({ defender }) => Number(defender?.hp ?? 0) > 0
                && verbHitsTarget(activationAttacker, verb, defender, run.contract.activation))
            .sort((left, right) => distanceFrom(activationAttacker, left.defender)
                - distanceFrom(activationAttacker, right.defender));
        if (verb.nearestOnly) ordered = ordered.slice(0, 1);
    }

    // The displacement of a teleporting ability is consumed by the nearest valid target so roster order cannot
    // overwrite the landing position.
    let teleportApplied = false;
    for (const { defender: original } of ordered) {
        const skipEffectTypes = teleports && teleportApplied ? new Set([EFFECT_TYPES.TELEPORT]) : null;
        const canApplyTeleport = Number(original?.hp ?? 0) > 0 && !ignoresHostileEffects(original);
        hitOneDefender(verb, run, run.bots[attackerIndex], original, {
            hitTestAttacker: activationAttacker,
            effectSource: teleports ? activationAttacker : run.bots[attackerIndex],
            skipEffectTypes,
        });
        if (verb.oncePerTarget && original?.id != null) run.hitIds.add(original.id);
        if (teleports && !teleportApplied && canApplyTeleport) teleportApplied = true;
    }
    return run;
}

/** One `hit` verb against one opposing bot: geometry test, then the effects in declaration order. */
function hitOneDefender(verb, run, attacker, defender, { hitTestAttacker, effectSource, skipEffectTypes }) {
    if (!verbHitsTarget(hitTestAttacker, verb, defender, run.contract.activation)) return;
    if (!defender || ignoresHostileEffects(defender)) return;

    const stats = phaseStatsFor(verb);
    // A teleport lands next to where the defender stood before this ability's other effects moved it.
    const originalTarget = { x: defender.x, y: defender.y };
    let damageConfirmed = false;
    let damageConfirmedAmount = 0;
    let landedOnEnemy = false;
    for (const effect of botEffects(verb)) {
        if (skipEffectTypes?.has(effect.type)) continue;
        const defenderHpBefore = Number(defender.hp ?? 0);
        if (ENEMY_HIT_EFFECT_TYPES.has(effect.type) && isAliveBot(defender)) landedOnEnemy = true;
        withCombatAbility(run.abilityId, () => applyEffect(effect, {
            abilityId: run.abilityId,
            stats,
            source: effectSource,
            owner: attacker,
            target: defender,
            originalTarget,
            damageMultiplier: Math.max(0, Number(effectSource?.attackDamageMultiplier ?? 1)),
            damageConfirmed,
            damageConfirmedAmount,
        }));
        if (effect.type === EFFECT_TYPES.DAMAGE) {
            const appliedDamage = Math.max(0, defenderHpBefore - Number(defender.hp ?? 0));
            if (appliedDamage > 0) {
                damageConfirmed = true;
                damageConfirmedAmount = roundCombatValue(damageConfirmedAmount + appliedDamage);
            }
        }
    }
    if (landedOnEnemy) recordAbilityHit(attacker, run.abilityId);
}

// --- entity events -----------------------------------------------------------------------------------------

function findTargetIndex(bots, targetId) {
    return bots.findIndex((bot) => bot?.id === targetId || String(bot?.slot) === String(targetId));
}

function eventTimestampMs(entity, world) {
    return Math.max(0, Number(entity?.ageMs ?? 0) - Math.max(0, Number(world?.stepMs ?? 0)));
}

function resolveNumber(value, fallback) {
    if (value == null) return fallback;
    if (typeof value === "number") return value;
    if (typeof value === "string") {
        const numericValue = Number(value);
        return Number.isFinite(numericValue) ? numericValue : fallback;
    }
    if (typeof value === "object") {
        if (value.stat != null) return resolveNumber(value.stat, value.fallback ?? fallback);
        if (value.value != null) return resolveNumber(value.value, fallback);
    }
    return fallback;
}

/** Returns whether this entity may affect a target during the current phase. */
export function canApplyToTarget(entity, targetId, targetPolicy = null, world = {}) {
    const mode = targetPolicy?.mode ?? TARGET_POLICY_MODES.EVERY_TICK;
    if (mode === TARGET_POLICY_MODES.EVERY_TICK) return true;
    const key = String(typeof targetId === "object" ? targetId?.id ?? targetId?.slot : targetId);
    const lastHit = entity?.hitLedger?.[key];
    if (!lastHit) return true;
    if (mode === TARGET_POLICY_MODES.ONCE) return false;
    const intervalMs = Math.max(0, resolveNumber(targetPolicy?.intervalMs ?? 0, Number(world.stepMs ?? 0)));
    return eventTimestampMs(entity, world) - Number(lastHit.atMs ?? 0) >= intervalMs;
}

function recordTargetApplication(entity, target, targetPolicy, world) {
    const mode = targetPolicy?.mode ?? TARGET_POLICY_MODES.EVERY_TICK;
    if (mode === TARGET_POLICY_MODES.EVERY_TICK) return entity;
    const key = String(typeof target === "object" ? target?.id ?? target?.slot : target);
    entity.hitLedger = {
        ...(entity.hitLedger ?? {}),
        // The entity clock is advanced at the start of a fixed tick. Store the time at which this event was
        // evaluated, not the end-of-tick clock value, so an interval measured in ticks remains intuitive:
        // a hit on tick 3 with a five-tick interval is eligible on tick 8.
        [key]: { atMs: eventTimestampMs(entity, world) },
    };
    return entity;
}

/** Changes phase without replacing the entity identity, in place. */
export function transitionEntityPhase(entity, phaseId, contract = null) {
    if (!entity || phaseId == null) return entity;
    const definition = contract ?? entityContract(entity);
    const nextPhase = phaseById(definition, phaseId);
    if (!nextPhase) return entity;
    entity.phaseId = phaseId;
    entity.phaseTimerMs = 0;
    entity.eventScheduleState = {};
    entity.phaseLocked = true;
    entity.phaseEnteredThisTick = true;
    if (Number(nextPhase.movement?.unitsPerTick ?? 0) <= 0) {
        entity.velocityX = 0;
        entity.velocityY = 0;
    }
    // Persistence is phase-local. A target affected by a fuse phase can be affected again by the damage phase
    // of the same logical entity.
    entity.hitLedger = {};
    if (nextPhase.type === "zone") entity.armed = true;
    return entity;
}

function applyEffectsFromEntityEvent(verb, run) {
    const { entity, event, phase, world } = run;
    if (!run.eventReachesBots) return run;
    const abilityId = entity?.abilityId;
    const ownerOnly = (verb.targets ?? []).includes(OWNER_TARGET);
    const targets = ownerOnly
        ? run.bots.filter((bot) => bot.id === entity.ownerId).map((bot) => bot.id)
        : run.targets;
    const phaseStats = run.entityStats;
    for (const targetId of targets) {
        const targetIndex = findTargetIndex(run.bots, targetId);
        if (targetIndex < 0 || !canApplyToTarget(run.entity, targetId, event.targetPolicy, world)) continue;
        const target = run.bots[targetIndex];
        const targetDistance = run.targetDistances instanceof Map
            ? run.targetDistances.get(targetId)
            : run.targetDistances?.[targetId];
        const effectSource = run.effectSources instanceof Map
            ? run.effectSources.get(targetId) ?? run.entity
            : run.entity;
        applyEffectsFromEntity(
            run.bots,
            targetIndex,
            effectSource,
            abilityId,
            {
                world,
                knockbackDirection: verb.knockbackDirection ?? "source",
                pullDirection: verb.pullDirection ?? "source",
                collisionDistance: Number.isFinite(Number(targetDistance))
                    ? Number(targetDistance)
                    : run.collisionDistance,
                statOverrides: phaseStats,
                effects: verb.effects,
            },
        );
        recordTargetApplication(run.entity, target, event.targetPolicy, world);
    }
    void phase;
    return run;
}

function transitionVerb(verb, run) {
    run.entity = transitionEntityPhase(run.entity, verb.to, run.contract);
    return run;
}

function removeVerb(verb, run) {
    run.entity = null;
    return run;
}

function emitVisualVerb(verb, run) {
    // The simulation records only the semantic event occurrence. The renderer resolves its asset, size and
    // animation duration from the verb in the browser ability contract.
    const semanticEventType = String(run.eventType).toLowerCase();
    Object.assign(run.entity, {
        eventSequence: Number(run.entity.eventSequence ?? 0) + 1,
        eventType: semanticEventType,
        eventPhaseId: run.phase?.id ?? run.entity.phaseId ?? null,
        // The countdown is frontend-only presentation state. Pixi resolves the event's visual metadata from
        // the ability contract.
        visualEvent: Number(run.entity.visualEvent ?? 0) + 1,
        visualEventMs: resolveNumber(verb.visibleMs, 0),
    });
    run.emittedVisuals.push({ eventType: semanticEventType });
    return run;
}

function isEnemyOf(entity, target, bots) {
    if (!entity || !target) return false;
    if (target.id === entity.ownerId) return false;
    const owner = bots?.find((bot) => bot?.id === entity.ownerId
        || (Number.isFinite(Number(entity.ownerSlot)) && Number(bot?.slot) === Number(entity.ownerSlot)));
    const sourceTeam = Number(owner?.teamNumber ?? entity.ownerTeam);
    const targetTeam = Number(target.teamNumber);
    if (Number.isFinite(sourceTeam) && Number.isFinite(targetTeam)
        && sourceTeam > 0 && targetTeam > 0) return sourceTeam !== targetTeam;
    return Number(target.slot) !== Number(entity.ownerSlot);
}

/**
 * A `hit` verb inside an entity event (a summon's shot): the hitbox is fired from the entity's pose plus the
 * verb's origin, against living enemy bots. Records whether anything was hit for a `waitForHit` timer.
 */
function hitFromEntity(verb, run) {
    const { entity, world } = run;
    if (!(verb.targets ?? []).includes(TARGET_KINDS.BOT)) return run;
    const hitbox = verbHitbox(verb.hitbox ?? {}, entity);
    if (!hitbox) return run;
    const pose = entityAbilitySpawnTransform(entity, verb.origin, entity.rotation);
    const enemies = run.bots.filter((bot) => isEnemyOf(entity, bot, run.bots) && bot.hp > 0);
    // An aimed shot considers only the enemy the entity is chasing; otherwise every enemy the hitbox touches.
    const candidates = verb.aim === "seekTarget"
        ? enemies.filter((bot) => bot.id === run.seekTargetId)
        : enemies;
    // An entity's ray is a thin line tested against the target's circle (a bot's ray has its width).
    const found = hitbox.shape === "ray"
        ? candidates
            .filter((bot) => rayIntersectsCircle(pose, pose.rotation, hitbox.range, bot))
            .map((bot) => ({ target: bot, distance: Math.hypot(bot.x - pose.x, bot.y - pose.y) }))
            .sort((first, second) => first.distance - second.distance)
        : findTargets(pose, hitbox, {
            world: { bots: candidates, stepMs: world.stepMs },
            kinds: [TARGET_KIND_BOT],
        });
    const selected = verb.nearestOnly ? found.slice(0, 1) : found;
    if (selected.length === 0) return run;
    run.hitConnected = true;
    const stats = phaseStatsFor(verb);
    for (const { target, distance } of selected) {
        const targetIndex = findTargetIndex(run.bots, target.id);
        if (targetIndex < 0) continue;
        applyEffectsFromEntity(run.bots, targetIndex, entity, entity.abilityId, {
            world,
            knockbackDirection: verb.knockbackDirection ?? "source",
            pullDirection: verb.pullDirection ?? "source",
            collisionDistance: distance,
            statOverrides: stats,
            effects: verb.effects,
        });
    }
    if (verb.visual?.visibleMs != null) {
        Object.assign(run.entity, {
            eventSequence: Number(run.entity.eventSequence ?? 0) + 1,
            eventType: String(run.eventType).toLowerCase(),
            eventPhaseId: run.phase?.id ?? run.entity.phaseId ?? null,
            visualEvent: Number(run.entity.visualEvent ?? 0) + 1,
            visualEventMs: resolveNumber(verb.visual.visibleMs, 0),
        });
        run.emittedVisuals.push({ eventType: String(run.eventType).toLowerCase() });
    }
    return run;
}

/** The verb-level helpers other modules need to test or describe hits. */
export { triggerPose, phaseForEntity };
