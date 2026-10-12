import { ACTION_TO_ABILITY } from "../../loadout/BotLoadout.js";
import {
    compassDirection,
    movementAngle,
    relativeMovementVector,
} from "../../botlogic/planner/arenaAngles.js";
import { clamp } from "../../gameconfig/geometry.js";
import { ARENA_HEIGHT_UNITS, ARENA_WIDTH_UNITS } from "../../modelPayloads/arenaConstants.js";
import {
    abilityContract,
    entityContract,
    eventTargetsEntity,
    isAttachedEntity,
    findVerb,
    OWNER_TARGET,
    phaseById,
    phaseForEntity,
    TARGET_KINDS,
    TARGET_POLICY_MODES,
    TARGET_POLICY_SCOPES,
    targetKindsForEntity,
    VERBS,
} from "../contracts/AbilityContracts.js";
import { abilityRecord, patchAbilityRecord } from "../../gameconfig/AbilityState.js";
import {
    abilityPose,
    entityAbilitySpawnTransform,
} from "../../gameconfig/hitboxGeometry.js";
import { combatVisualDurationMs } from "../../gameconfig/visualState.js";
import { outgoingDamageMultiplier } from "../contracts/StatusContracts.js";
import {
    applyEffectList,
    applyEffectsFromEntity,
    applyEffectsToBot,
    phaseStatsFor,
} from "./effects.js";
import { collectHitTargets, hitKey, activationPose, verbHitbox } from "./AbilityHitDetectionSystem.js";
import { isEntityShape, ownerBot } from "../entities/EntityCombat.js";
import { spawnVerbEntities } from "../entities/EntityFactory.js";
import { areEnemies } from "../contracts/teams.js";
import { resolveDataNumber } from "../../gameconfig/dataValues.js";
import { BASE_BOT_HP } from "../../modelPayloads/arenaConstants.js";

/**
 * The one verb executor. An ability's `onActivate` list and every entity event's `do` list run through
 * `executeVerb`. A run context says where the verb runs:
 *
 *   act      the owner bot as the tick starts its ability (face, move)
 *   resolve  a roster of bots after every bot has acted (applyEffects on the owner, hit)
 *   entity   one arena entity handling an event (hit, spawn, applyEffects, transition, remove, emitVisual)
 *
 * A activation verb runs in the tick stage that owns it (VERB_STAGE): move in act, applyEffects and hit
 * in resolveHits, spawn at the end of act from the bot's final pose (the stage after adds the entities to the
 * world). Every activation verb runs on the activation tick; anything that lasts is an attached entity, whose
 * phases keep time. The run contexts are mutable; each runner below builds a fresh one. The bots and the entity
 * a verb changes are changed in place.
 */
export const VERB_STAGE = Object.freeze({
    [VERBS.MOVE]: "act",
    [VERBS.SPAWN]: "act",
    [VERBS.APPLY_EFFECTS]: "resolveHits",
    [VERBS.HIT]: "resolveHits",
});

export function executeVerb(verb, run) {
    // A verb of an entity event that names `targets` runs only when the event touched one of those kinds. A hit is the
    // exception: its `targets` name the kinds its own shape may touch, so it always runs.
    if (run.kind === "entity" && verb.do !== VERBS.HIT && declaresTargets(verb) && !run.targets.some((id) => reaches(verb, id, run))) {
        return run;
    }
    switch (verb.do) {
        case VERBS.MOVE: return run.kind === "entity" ? moveFromEntity(verb, run) : moveVerb(verb, run);
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
 * Runs the act-stage activation verbs on the owner: the pose capture, then move. Returns the bot.
 */
export function applyActivationVerbs(bot, payload, elapsedMs) {
    const verbs = payload.contract?.onActivate ?? [];
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

/**
 * An attached entity's `move` (a lunge) moves its owner, like an activation move: the heading is the one the cast
 * captured when it spawned. The owner is the bot the entity follows.
 */
function moveFromEntity(verb, run) {
    const { entity } = run;
    const owner = run.bots.find((bot) => bot.id === entity.ownerId);
    if (!owner) return run;
    const payload = { abilityId: entity.abilityId, ...(entity.heading ?? {}), activation: abilityContract(entity.abilityId)?.activation };
    moveVerb(verb, { kind: "act", bot: owner, payload, elapsedMs: 0 });
    return run;
}

function moveVerb(verb, run) {
    const { bot, payload } = run;
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
    // A dash starts after ordinary movement for this tick. Its swept hit path must therefore begin at this
    // pose, not at the pre-tick pose.
    bot.movementStartX = bot.x;
    bot.movementStartY = bot.y;
    bot.dashOriginX = bot.x;
    bot.dashOriginY = bot.y;
    bot.x = x;
    bot.y = y;
    // activeMs is ability-level timing; movement distance/speed/trail live on the verb.
    // One move runs per bot: a new one replaces any still travelling, and the ability that started it keeps it going.
    bot.moveAbilityId = payload.abilityId ?? null;
    bot.dashRemaining = Math.max(0, distance - traveled);
    bot.dashInitialDistance = distance;
    bot.dashStepDistance = stepDistance;
    bot.dashDirectionX = ux;
    bot.dashDirectionY = uy;
    // The bot effect shows for the verb's own `visual.visibleMs`, from the pose after this step (as setAbilityVisual).
    if (verb.visual) {
        const pose = abilityPose(bot, null, payload.activation?.capture);
        bot.abilityVisual = {
            ability: payload.abilityId,
            ms: combatVisualDurationMs(payload.abilityId, verb.visual),
            x: pose.x,
            y: pose.y,
            rotation: pose.rotation,
        };
    }
    return run;
}

// --- spawn -------------------------------------------------------------------------------------------------

/**
 * The entities the ability's spawn verbs create from the bot's final pose, in verb order and pattern index
 * order. Serial IDs run from `serial` in that order.
 */
export function spawnActivationEntities(bot, payload, { serial, targetX, targetY, activationSerial, clampFn }) {
    const abilityId = payload?.abilityId;
    const created = [];
    // An attached entity keeps the heading its cast captured, so its `move` verbs head where the brain pointed.
    const heading = { targetX: payload?.targetX, targetY: payload?.targetY, movementMode: payload?.movementMode, movementDirection: payload?.movementDirection };
    for (const verb of payload?.contract?.onActivate ?? []) {
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
        for (const entity of entities.filter(Boolean)) {
            if (isAttachedEntity(entity)) entity.heading = heading;
            created.push(entity);
        }
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

function distanceFrom(first, second) {
    return Math.hypot(Number(second?.x ?? 0) - Number(first?.x ?? 0), Number(second?.y ?? 0) - Number(first?.y ?? 0));
}

/** Sets the transient `abilityVisual` from the first verb of the ability that declares a visual. */
function setAbilityVisual(attacker, abilityId, contract) {
    const carrier = (contract.onActivate ?? []).find((verb) => verb.visual);
    if (!carrier) return;
    const hit = findVerb(contract.onActivate, VERBS.HIT);
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
 * Resolves the activation verbs of every bot's triggered ability against the roster, changing the bots and the
 * entities in place: owner effects first, then each `hit` against the opposing bots and the entities it touches. The
 * effects a hit has on an entity are queued in `impacts`, which the entities stage lands.
 */
export function resolveActivationVerbsForRoster(bots, entities = [], impacts = new Map()) {
    if (!Array.isArray(bots)) return [];
    const run = { kind: "resolve", bots, entities: Array.isArray(entities) ? entities : [], impacts };
    for (let attackerIndex = 0; attackerIndex < bots.length; attackerIndex += 1) {
        const attacker = bots[attackerIndex];
        if (!attacker) continue;
        run.attackerIndex = attackerIndex;
        // The ability that activated this tick runs its resolveHits verbs, in list order, on the activation tick.
        const abilityId = ACTION_TO_ABILITY[attacker.triggeredAbility];
        const contract = abilityContract(abilityId);
        if (abilityId && contract) {
            beginActivationRun(run, abilityId, contract, attacker);
            setAbilityVisual(attacker, abilityId, contract);
            for (const verb of contract.onActivate) {
                if (VERB_STAGE[verb.do] === "resolveHits") executeVerb(verb, run);
            }
            persistActivationHits(run);
        }
    }
    return bots;
}

/**
 * Points the run at one activation: its ability, and the "already hit" memory of that activation (stamped when the
 * ability activated this tick), which the activation-scoped hits read and extend.
 */
function beginActivationRun(run, abilityId, contract, attacker) {
    run.abilityId = abilityId;
    run.contract = contract;
    run.activationMemory = activationMemory(attacker, abilityId);
    run.activationHit = new Set(Object.keys(run.activationMemory?.ledger ?? {}));
    run.activationHitCount = run.activationHit.size;
}

/** Writes the targets an activation has newly hit back to its memory, replacing the memory's hit map. */
function persistActivationHits(run) {
    if (!run.activationMemory || run.activationHit.size === run.activationHitCount) return;
    const ledger = { ...run.activationMemory.ledger };
    for (const key of run.activationHit) {
        if (!Object.hasOwn(ledger, key)) ledger[key] = { timeMs: 0 };
    }
    run.activationMemory.write(ledger);
}

/**
 * The activation memory of `abilityId` on `owner`: the `activationLedger` of its record, when the record belongs to
 * the activation `serial` (any activation when it is left out). `write(hit)` replaces the hit map in the record.
 * Returns null when there is no such memory.
 */
function activationMemory(owner, abilityId, serial = undefined) {
    const memory = abilityRecord(owner, abilityId)?.activationLedger;
    if (!memory || (serial !== undefined && memory.serial !== serial)) return null;
    return {
        ledger: memory.hit ?? {},
        write: (hit) => patchAbilityRecord(owner, abilityId, { activationLedger: { serial: memory.serial, hit } }),
    };
}

/**
 * The "already hit" memory a targetPolicy reads and writes for one entity, as `{ ledger, write(hit) }`. The phase
 * scope is the entity's `hitLedger` (cleared on a phase change); the entity scope is `entityHitLedger`, which never
 * clears. The activation scope is the owner's activation memory for the entity's own activation serial. An entity
 * whose cast was replaced by a newer activation has no such memory, so it falls back to its entity memory.
 */
function entityMemory(entity, world, scope) {
    if (scope === TARGET_POLICY_SCOPES.ACTIVATION) {
        const owner = ownerBot(world.bots ?? [], entity);
        const memory = owner ? activationMemory(owner, entity.abilityId, entityActivationSerial(owner, entity)) : null;
        return memory ?? entityOwnedMemory(entity);
    }
    if (scope === TARGET_POLICY_SCOPES.ENTITY) return entityOwnedMemory(entity);
    return { ledger: entity.hitLedger ?? {}, write: (hit) => { entity.hitLedger = hit; } };
}

function entityOwnedMemory(entity) {
    return { ledger: entity.entityHitLedger ?? {}, write: (hit) => { entity.entityHitLedger = hit; } };
}

/** The activation serial an entity was spawned under (the one the owner recorded at spawn), as a hit refund uses it. */
function entityActivationSerial(owner, entity) {
    return owner?.entityActivations?.[entity.id] ?? owner?.activationSerial ?? 0;
}

function applyEffectsVerb(verb, run) {
    if (run.kind === "entity") return applyEffectsFromEntityEvent(verb, run);
    if (!(verb.targets ?? []).includes(OWNER_TARGET)) return run;
    // Self effects (heals, statuses, Rewind) land on the owner, which is the target of an OWNER verb; nothing else is touched.
    const attacker = run.bots[run.attackerIndex];
    applyEffectList(verb.effects, {
        abilityId: run.abilityId,
        stats: phaseStatsFor(verb),
        source: attacker,
        owner: attacker,
        target: attacker,
        damageMultiplier: Math.max(0, outgoingDamageMultiplier(attacker)),
        damageConfirmed: false,
        damageConfirmedAmount: 0,
    }, { targetKinds: [TARGET_KINDS.BOT] });
    return run;
}

/**
 * The one `hit` verb on a bot's activation: it fires from the activation pose (see hitFromEntity for an entity's own
 * hit). The hit tests read a copy of the attacker taken now, so a displace in the effects (a blink) does not move the
 * hitbox of the hits that run after it.
 */
function hitVerb(verb, run) {
    if (run.kind === "entity") return hitFromEntity(verb, run);
    const activationAttacker = { ...run.bots[run.attackerIndex] };
    const hitbox = verbHitbox(verb.hitbox ?? {}, activationAttacker);
    if (!hitbox) return run;
    const attacker = run.bots[run.attackerIndex];
    // A hit with a targetPolicy (validated as once, scope activation) shares the cast's memory with the cast's other hits.
    const once = verb.targetPolicy ? run.activationHit : null;
    run.conditionalHit = false;
    const hits = fireHit(verb, run, {
        source: attacker,
        abilityId: run.abilityId,
        pose: activationPose(activationAttacker, verb, run.contract.activation),
        hitbox,
        candidates: hitCandidates(verb, run, attacker),
        once,
    });
    for (const { target, landed } of hits) {
        if (landed) once?.add(hitKey(target));
    }
    // The activation's strike shows its bonus when a `when`-gated effect landed (Execute's finisher).
    if (run.conditionalHit && attacker.abilityVisual) attacker.abilityVisual.bonus = true;
    return run;
}

/**
 * The one hit path, for a bot's activation and an entity's own `hit`. The hit shape fires from `pose` at `candidates`
 * (bots and entities, nearest first; `nearestOnly` keeps the nearest; `once` leaves out what the policy has already hit),
 * and each target it reaches takes the verb's effects. Returns [{ target, landed }] (see applyHitTo).
 */
function fireHit(verb, run, { source, abilityId, pose, hitbox, candidates, once = null, stepMs = undefined }) {
    const stats = phaseStatsFor(verb);
    return collectHitTargets(pose, hitbox, candidates, { nearestOnly: Boolean(verb.nearestOnly), once, stepMs })
        .map(({ target, distance }) => ({
            target,
            landed: applyHitTo(verb, run, source, target, { abilityId, stats, found: distance }),
        }));
}

/**
 * What a hit may touch: the living enemy bots when `targets` names BOT, and the entities it names that the source can
 * hit. An aimed hit (a seeking entity's shot) reaches only the bot it is chasing, and no entity.
 */
function hitCandidates(verb, run, source) {
    const enemies = (verb.targets ?? []).includes(TARGET_KINDS.BOT)
        ? run.bots.filter((bot) => areEnemies(source, bot, run.bots) && Number(bot?.hp ?? 0) > 0)
        : [];
    if (verb.aim === "seekTarget") return enemies.filter((bot) => bot.id === run.seekTargetId);
    const entities = (run.kind === "entity" ? run.world.entities : run.entities) ?? [];
    const summons = entities.filter((entity) => entity.id !== source.id
        && eventTargetsEntity(verb, targetKindsForEntity(entity))
        && entityCanBeHitBy(source, entity, run.bots));
    return [...enemies, ...summons];
}

/** An entity takes a hit when it has health left and is an enemy, or its phase allows friendly damage. */
function entityCanBeHitBy(attacker, entity, bots) {
    const health = phaseForEntity(entity)?.health;
    if (!health || !(Number(entity.hp) > 0)) return false;
    return Boolean(health.allowFriendlyDamage) || areEnemies(attacker, entity, bots);
}

/**
 * The verb's effects on one target a hit reached. An HP entity queues them as an impact for the entities stage. A bot
 * takes them now (see applyEffectsToBot), with the immunity rule. Returns whether the hit landed: an entity always does,
 * and a bot does unless it is immune.
 */
function applyHitTo(verb, run, source, target, { abilityId, stats, found }) {
    const damageMultiplier = damageMultiplierOf(source);
    const distance = hitDistance(source, target, found);
    if (isEntityShape(target)) {
        queueImpact(run, target.id, { source, abilityId, effects: verb.effects, distance, stats, damageMultiplier });
        return true;
    }
    return applyEffectsToBot(target, {
        source,
        owner: isEntityShape(source) ? ownerBot(run.bots, source) : source,
        abilityId,
        effects: verb.effects,
        stats,
        distance,
        world: run.world,
        damageMultiplier,
        onConditionalHit: () => { run.conditionalHit = true; },
    });
}

/**
 * The distance a hit's falloff reads. An entity's hit keeps the distance its shape found. A bot's hit on an entity
 * measures centre to centre, from the attacker; a bot's hit on a bot leaves the distance to the effect, as it always did.
 */
function hitDistance(source, target, found) {
    if (isEntityShape(source)) return found;
    return isEntityShape(target) ? distanceFrom(source, target) : undefined;
}

/** The damage multiplier a hit's effects carry: an attacking bot's outgoing multiplier, or an entity's own. */
function damageMultiplierOf(source) {
    return isEntityShape(source) ? Number(source.damageMultiplier ?? 1) : Math.max(0, outgoingDamageMultiplier(source));
}

// --- entity events -----------------------------------------------------------------------------------------

function findTargetIndex(bots, targetId) {
    return bots.findIndex((bot) => bot?.id === targetId || String(bot?.slot) === String(targetId));
}

function eventTimestampMs(entity, world) {
    return Math.max(0, Number(entity?.ageMs ?? 0) - Math.max(0, Number(world?.stepMs ?? 0)));
}

/**
 * Returns whether an entity event may affect `target` now, under its targetPolicy. `world` supplies the bots (for
 * the activation scope) and the step length (for an interval).
 */
export function canApplyToTarget(entity, target, targetPolicy = null, world = {}) {
    const mode = targetPolicy?.mode ?? TARGET_POLICY_MODES.EVERY_TICK;
    if (mode === TARGET_POLICY_MODES.EVERY_TICK) return true;
    const lastHit = entityMemory(entity, world, targetPolicy?.scope).ledger[hitKey(target)];
    if (!lastHit) return true;
    if (mode === TARGET_POLICY_MODES.ONCE) return false;
    const intervalMs = Math.max(0, resolveDataNumber(targetPolicy?.intervalMs ?? 0, {}, Number(world.stepMs ?? 0)));
    return eventTimestampMs(entity, world) - Number(lastHit.timeMs ?? 0) >= intervalMs;
}

function recordTargetApplication(entity, target, targetPolicy, world) {
    const mode = targetPolicy?.mode ?? TARGET_POLICY_MODES.EVERY_TICK;
    if (mode === TARGET_POLICY_MODES.EVERY_TICK) return entity;
    const memory = entityMemory(entity, world, targetPolicy?.scope);
    // The entity clock is advanced at the start of a fixed tick. Store the time at which this event was
    // evaluated, not the end-of-tick clock value, so an interval measured in ticks remains intuitive:
    // a hit on tick 3 with a five-tick interval is eligible on tick 8.
    memory.write({ ...memory.ledger, [hitKey(target)]: { timeMs: eventTimestampMs(entity, world) } });
    return entity;
}

/** Changes phase without replacing the entity identity, in place. The entity-scope memory is kept. */
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
    // An entity with no HP takes it from the first phase with `health` it enters (a mine's travel phase has none).
    if (nextPhase.health && entity.hp == null) {
        entity.hp = resolveDataNumber(nextPhase.health.hp ?? nextPhase.health.maxHp, {}, 0);
        entity.maxHp = resolveDataNumber(nextPhase.health.maxHp ?? nextPhase.health.hp, {}, 0);
    }
    // Persistence is phase-local. A target affected by a fuse phase can be affected again by the damage phase
    // of the same logical entity.
    entity.hitLedger = {};
    if (nextPhase.type === "zone") entity.armed = true;
    return entity;
}

/** Whether a verb names `targets` of its own (an empty list names none). */
function declaresTargets(verb) {
    return Array.isArray(verb.targets) && verb.targets.length > 0;
}

/** Whether a verb reaches a touched id: it names no targets, or the id counts as one of the kinds it names. */
function reaches(verb, id, run) {
    return !declaresTargets(verb) || touchedKinds(id, run).some((kind) => verb.targets.includes(kind));
}

/**
 * The kinds a touched id counts as in an entity event. The owner bot is OWNER alone (it is never BOT), another bot is
 * BOT, and an entity has the kinds its phase gives it.
 */
function touchedKinds(id, run) {
    const index = findTargetIndex(run.bots, id);
    if (index >= 0) return run.bots[index] === ownerBot(run.bots, run.entity) ? [OWNER_TARGET] : [TARGET_KINDS.BOT];
    const other = (run.world.entities ?? []).find((candidate) => candidate.id === id);
    return other ? targetKindsForEntity(other) : [];
}

/**
 * An entity event's `applyEffects` verb, against the touched ids its `targets` reach (all of them when it names none).
 * A bot takes the effects now. An HP entity takes them as a queued impact (`run.impacts`) that lands in the entities
 * stage's impact pass. The event's targetPolicy governs both.
 */
function applyEffectsFromEntityEvent(verb, run) {
    const { world } = run;
    const policyWorld = { ...world, bots: run.bots };
    for (const targetId of run.targets) {
        if (!reaches(verb, targetId, run)) continue;
        const targetIndex = findTargetIndex(run.bots, targetId);
        if (targetIndex >= 0) {
            if (run.eventReachesBots) applyCollisionEffectsToBot(run, verb, targetIndex, policyWorld);
            continue;
        }
        applyEffectsToEntityTarget(run, verb, targetId, policyWorld);
    }
    return run;
}

/** The source the effects of a collision read for one target: the entity as it was at the start of its move. */
function effectSourceFor(run, targetId) {
    return run.effectSources instanceof Map
        ? run.effectSources.get(targetId) ?? run.entity
        : run.entity;
}

function collisionDistanceFor(run, targetId) {
    const distance = run.targetDistances instanceof Map
        ? run.targetDistances.get(targetId)
        : run.targetDistances?.[targetId];
    return Number.isFinite(Number(distance)) ? Number(distance) : run.collisionDistance;
}

function applyCollisionEffectsToBot(run, verb, targetIndex, policyWorld) {
    const target = run.bots[targetIndex];
    if (!canApplyToTarget(run.entity, target, run.event.targetPolicy, policyWorld)) return;
    applyEffectsFromEntity(run.bots, targetIndex, effectSourceFor(run, target.id), run.entity.abilityId, {
        world: run.world,
        collisionDistance: collisionDistanceFor(run, target.id),
        stats: run.entityStats,
        effects: verb.effects,
        // The entity's visual reads this: Backstab's bonus is the from-behind hit.
        onConditionalHit: () => { run.entity.bonusLanded = true; },
    });
    recordTargetApplication(run.entity, target, run.event.targetPolicy, policyWorld);
}

function applyEffectsToEntityTarget(run, verb, targetId, policyWorld) {
    const target = (run.world.entities ?? []).find((other) => other.id === targetId);
    if (!target || target.hp == null) return;
    if (!canApplyToTarget(run.entity, target, run.event.targetPolicy, policyWorld)) return;
    const source = effectSourceFor(run, targetId);
    queueImpact(run, targetId, {
        source,
        abilityId: run.entity.abilityId,
        effects: verb.effects,
        distance: collisionDistanceFor(run, targetId),
        stats: run.entityStats,
        damageMultiplier: Number(source.damageMultiplier ?? 1),
    });
    recordTargetApplication(run.entity, target, run.event.targetPolicy, policyWorld);
}

/**
 * Queues the effects of one entity's hit or collision on an HP entity, for the entities stage's impact pass. The
 * impacts for one target keep the order they were queued in.
 */
function queueImpact(run, targetId, impact) {
    run.impacts.set(targetId, [...(run.impacts.get(targetId) ?? []), impact]);
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
        visualEventMs: resolveDataNumber(verb.visibleMs, {}, 0),
    });
    run.emittedVisuals.push({ eventType: semanticEventType });
    return run;
}

/**
 * An entity's own `hit` verb (a summon's shot, a boomerang's catch): the hit shape fires from the entity's pose plus
 * the verb's origin, through the one hit path (see fireHit). Records whether anything was hit for a `waitForHit`
 * timer, and a once hit remembers what it touched in the policy's memory.
 */
function hitFromEntity(verb, run) {
    const { entity, world } = run;
    const hitbox = verbHitbox(verb.hitbox ?? {}, entity);
    if (!hitbox) return run;
    // A once hit remembers its targets in the policy's memory: a hit verb takes once or everyTick (see the validator).
    const memory = verb.targetPolicy?.mode === TARGET_POLICY_MODES.ONCE
        ? entityMemory(entity, { ...world, bots: run.bots }, verb.targetPolicy.scope)
        : null;
    const selected = fireHit(verb, run, {
        source: entity,
        abilityId: entity.abilityId,
        pose: entityAbilitySpawnTransform(entity, verb.origin, entity.rotation),
        hitbox,
        candidates: hitCandidates(verb, run, entity),
        once: memory ? new Set(Object.keys(memory.ledger)) : null,
        stepMs: world.stepMs,
    });
    if (selected.length === 0) return run;
    run.hitConnected = true;
    const remembered = { ...memory?.ledger };
    for (const { target } of selected) {
        remembered[hitKey(target)] = { timeMs: eventTimestampMs(entity, world) };
    }
    if (memory) memory.write(remembered);
    if (verb.visual?.visibleMs != null) {
        Object.assign(run.entity, {
            eventSequence: Number(run.entity.eventSequence ?? 0) + 1,
            eventType: String(run.eventType).toLowerCase(),
            eventPhaseId: run.phase?.id ?? run.entity.phaseId ?? null,
            visualEvent: Number(run.entity.visualEvent ?? 0) + 1,
            visualEventMs: resolveDataNumber(verb.visual.visibleMs, {}, 0),
        });
        run.emittedVisuals.push({ eventType: String(run.eventType).toLowerCase() });
    }
    return run;
}

/** The verb-level helpers other modules need to test or describe hits. */
export { activationPose, phaseForEntity };
