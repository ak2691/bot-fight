import { isSimulationBotShape } from "../modelPayloads/arenaTick.js";
import { toSimulationBotShape } from "../modelPayloads/arenaShapes.js";

/*
 * Shape -> MatchReplayDTO JSON. Field names, null/empty omission and rounding follow
 * Java ReplayMappingService and MatchReplayDTO (NON_NULL and NON_EMPTY includes).
 * Where a DTO field has no engine source it is always null and omitted; see the
 * report table for the list.
 */

/** Java round(): three decimals, half up. */
function round(value) {
    return Math.round(Number(value) * 1000) / 1000;
}

/** Java @JsonInclude(NON_NULL): null-valued properties are left out of the JSON. */
function compact(record) {
    return Object.fromEntries(Object.entries(record).filter(([, value]) => value != null));
}

function finiteOrNull(value) {
    const numeric = Number(value);
    return value != null && Number.isFinite(numeric) ? round(numeric) : null;
}

function nonZeroOrNull(value) {
    const numeric = Number(value);
    return value != null && Number.isFinite(numeric) && Math.abs(numeric) > 0.0001 ? round(numeric) : null;
}

// Java ReplayMappingService sends entity rotation and velocity unrounded.
function rawNonZeroOrNull(value) {
    const numeric = Number(value);
    return value != null && Number.isFinite(numeric) && Math.abs(numeric) > 0.0001 ? numeric : null;
}

function integerOrNull(value) {
    const numeric = Number(value);
    return value != null && Number.isFinite(numeric) ? Math.round(numeric) : null;
}

function positiveOrNull(value) {
    const numeric = integerOrNull(value);
    return numeric != null && numeric > 0 ? numeric : null;
}

function sortedEntries(record) {
    return Object.entries(record ?? {})
        .map(([key, value]) => [Number(key), value])
        .filter(([key]) => Number.isInteger(key))
        .sort(([left], [right]) => left - right);
}

/** Java positiveEntries: values strictly above zero, or null when none remain. */
function positiveEntries(record) {
    const entries = sortedEntries(record)
        .map(([id, value]) => [id, integerOrNull(value)])
        .filter(([, value]) => value != null && value > 0);
    return entries.length ? Object.fromEntries(entries) : null;
}

/** Java nonNegativeEntries: values at or above zero, or null when none remain. */
function nonNegativeEntries(record) {
    const entries = sortedEntries(record)
        .map(([id, value]) => [id, integerOrNull(value)])
        .filter(([, value]) => value != null && value >= 0);
    return entries.length ? Object.fromEntries(entries) : null;
}

/** Java initialEntries: one entry per listed ability, defaulting to zero. */
function initialEntries(abilityIds, record) {
    const ids = [...new Set(abilityIds.filter((id) => Number.isInteger(id)))].sort((a, b) => a - b);
    if (!ids.length) return null;
    return Object.fromEntries(ids.map((id) => [id, integerOrNull(record?.[id]) ?? 0]));
}

function abilityIdList(bot) {
    return (bot.abilities ?? []).map(Number).filter(Number.isInteger);
}

function statusEffectsOf(bot) {
    return JSON.parse(JSON.stringify(bot.statusEffects ?? []));
}

function teamOf(bot) {
    return Number.isInteger(Number(bot.teamNumber)) ? Number(bot.teamNumber) : 1;
}

/** Static per-bot metadata, written once (ReplayBotStaticDTO). */
export function replayBotStatic(shape) {
    const bot = toSimulationBotShape(shape);
    const abilities = abilityIdList(bot);
    return compact({
        slot: Number(bot.slot),
        x: round(bot.x),
        y: round(bot.y),
        rotation: nonZeroOrNull(bot.rotation),
        hp: Number(bot.hp),
        maxHp: Number(bot.maxHp),
        abilities,
        abilityCooldowns: initialEntries(abilities, bot.abilityCooldowns),
        abilityActiveMs: positiveEntries(bot.abilityActiveMs),
        abilityCharges: nonNegativeEntries(bot.abilityCharges),
        abilityRechargeMs: initialEntries(
            Object.keys(bot.abilityCharges ?? {}).map(Number),
            bot.abilityRechargeMs,
        ),
        teamNumber: teamOf(bot),
    });
}

/** Dynamic per-bot state for one frame (ReplayBotDTO). */
export function replayBot(shape) {
    const bot = toSimulationBotShape(shape);
    const triggered = bot.triggeredAbility != null && Number.isInteger(Number(bot.triggeredAbility));
    const rewindPulse = positiveOrNull(bot.temporalRewindPulseMs) ?? 0;
    const dashing = Number(bot.dashRemaining ?? 0) > 0 || Number(bot.abilityActiveMs?.[19] ?? 0) > 0;
    return compact({
        slot: Number(bot.slot),
        x: round(bot.x),
        y: round(bot.y),
        rotation: finiteOrNull(bot.rotation),
        hp: Number(bot.hp),
        statusEffects: statusEffectsOf(bot),
        abilityCooldowns: positiveEntries(bot.abilityCooldowns),
        abilityCharges: nonNegativeEntries(bot.abilityCharges),
        abilityRechargeMs: positiveEntries(bot.abilityRechargeMs),
        abilityActiveMs: positiveEntries(bot.abilityActiveMs),
        triggeredAbility: triggered ? Number(bot.triggeredAbility) : null,
        preparingAbility: integerOrNull(bot.preparingAbility),
        preparingMs: positiveOrNull(bot.preparingMs),
        // Java keeps the trigger payload only on the tick an ability fires.
        abilityTargetX: triggered ? finiteOrNull(bot.abilityTargetX) : null,
        abilityTargetY: triggered ? finiteOrNull(bot.abilityTargetY) : null,
        // The ability visual origin comes from the engine's abilityVisual pose, set by withAbilityVisual.
        visualOriginX: triggered ? finiteOrNull(bot.abilityVisual?.x) : null,
        visualOriginY: triggered ? finiteOrNull(bot.abilityVisual?.y) : null,
        visualOriginRotation: triggered ? finiteOrNull(bot.abilityVisual?.rotation) : null,
        temporalRewindX: rewindPulse > 0 ? finiteOrNull(bot.temporalRewindX) : null,
        temporalRewindY: rewindPulse > 0 ? finiteOrNull(bot.temporalRewindY) : null,
        temporalRewindPulseMs: rewindPulse > 0 ? rewindPulse : null,
        closingZoneDamageCount: positiveOrNull(bot.closingZoneDamageCount),
        dashDirectionX: dashing ? finiteOrNull(bot.dashDirectionX) : null,
        dashDirectionY: dashing ? finiteOrNull(bot.dashDirectionY) : null,
        teamNumber: teamOf(bot),
    });
}

/** One arena entity (ReplayEntityDTO). Event fields come from EntityEventSystem. */
export function replayEntity(entity) {
    const drone = entity.type === "hunterDrone" || entity.type === "repellerDrone";
    const hp = integerOrNull(entity.hp);
    const statusEffects = Array.isArray(entity.statusEffects) && entity.statusEffects.length
        ? JSON.parse(JSON.stringify(entity.statusEffects))
        : null;
    return compact({
        id: String(entity.id),
        type: entity.type,
        abilityId: integerOrNull(entity.abilityId),
        x: round(entity.x),
        y: round(entity.y),
        size: Math.round(Number(entity.size) || 0),
        rotation: rawNonZeroOrNull(entity.rotation),
        hp: drone ? hp : positiveOrNull(hp),
        armed: Boolean(entity.armed),
        timerMs: positiveOrNull(entity.remainingMs),
        velocityX: rawNonZeroOrNull(entity.velocityX),
        velocityY: rawNonZeroOrNull(entity.velocityY),
        phaseId: entity.phaseId ?? null,
        phaseTimerMs: positiveOrNull(entity.phaseTimerMs),
        eventType: entity.eventType ?? null,
        eventPhaseId: entity.eventPhaseId ?? null,
        eventSequence: positiveOrNull(entity.eventSequence),
        statusEffects,
    });
}

/** initialState for the replay: static bot metadata in request order. */
export function replayInitialState(shapes) {
    const bots = shapes.filter(isSimulationBotShape).map(replayBotStatic);
    return bots.length ? { bots } : {};
}

/** One frame: dynamic bots, then entities (ability entities, then the closing zone). */
export function replayFrame(elapsedMs, shapes) {
    const bots = shapes.filter(isSimulationBotShape).map(replayBot);
    const entities = shapes.filter((shape) => !isSimulationBotShape(shape)).map(replayEntity);
    return {
        elapsedMs: Math.round(elapsedMs),
        ...(bots.length ? { bots } : {}),
        ...(entities.length ? { entities } : {}),
    };
}

/** Java teamLabel: team 2 is Red, every other team is Blue. */
export function teamLabel(teamNumber) {
    return teamNumber === 2 ? "Red Team" : "Blue Team";
}

/** Result fields of MatchReplayDTO. A null winner is a draw; nulls are omitted. */
export function replayResult(winner) {
    return {
        result: winner ? "BOT_WIN" : "DRAW",
        ...(winner?.userId != null ? { winnerUserId: winner.userId } : {}),
        message: winner ? `${teamLabel(teamOf(winner))} wins.` : "The fight ended in a draw.",
    };
}
