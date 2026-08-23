import { ARENA_HEIGHT_UNITS, ARENA_WIDTH_UNITS } from "../../../modelPayloads/arenaConstants.js";
import { truncateToNumberPrecision } from "../configuration/constants.js";
import {
    abilityActiveMs,
    abilityCharges,
    abilityCooldownMs,
    abilityOnCooldown,
    abilityReady,
} from "./actionRuntime.js";
import { abilityIdFromBoundary } from "../../../gameconfig/AbilityCompatibility.js";
import {
    BOT_CODE_TARGETS,
    CUSTOM_VARIABLE_CONTRACT,
    STATE_VARIABLE_BY_ID,
    STATE_VARIABLE_SCOPES,
    STATE_VARIABLE_SOURCES,
    TARGET_BY_ID,
    TARGET_CAPABILITIES,
} from "../contracts/BotLogicContracts.js";

const ENTITY_SIZE = 60;

export function resolveStateVariable(state, condition, variableId, targetId, operations) {
    if (String(variableId).startsWith(CUSTOM_VARIABLE_CONTRACT.PREFIX)) return operations.resolveCustom(state, variableId);
    const definition = STATE_VARIABLE_BY_ID.get(variableId);
    if (!definition?.runtimeSource) return null;
    const normalizedTargetId = targetId ?? condition.target ?? BOT_CODE_TARGETS.OPPONENT;
    if (definition.targetCapability && !targetSupportsCapability(normalizedTargetId, definition.targetCapability)) return null;
    const target = operations.resolveTarget(state, normalizedTargetId);
    const resolver = RUNTIME_RESOLVERS[definition.runtimeSource];
    const resolved = resolver?.({ state, condition, definition, target, normalizedTargetId, operations }) ?? null;
    return typeof resolved === "number" ? truncateToNumberPrecision(resolved) : resolved;
}

const RUNTIME_RESOLVERS = Object.freeze({
    [STATE_VARIABLE_SOURCES.MATCH_ELAPSED_SECONDS]: ({ state }) => millisecondsToSeconds(state.player.matchElapsedMs),
    [STATE_VARIABLE_SOURCES.BOT_HP]: ({ state, definition }) => scopedBot(state, definition)?.hp ?? 0,
    [STATE_VARIABLE_SOURCES.BOT_DAMAGE_TAKEN_LAST_TICK]: ({ state, definition }) => Number(scopedBot(state, definition)?.damageTakenLastTick ?? 0),
    [STATE_VARIABLE_SOURCES.BOT_HP_NET_CHANGE_LAST_TICK]: ({ state, definition }) => Number(scopedBot(state, definition)?.hpNetChangeLastTick ?? 0),
    [STATE_VARIABLE_SOURCES.BOT_X]: ({ state, definition }) => scopedBot(state, definition)?.x ?? 0,
    [STATE_VARIABLE_SOURCES.BOT_Y]: ({ state, definition }) => scopedBot(state, definition)?.y ?? 0,
    [STATE_VARIABLE_SOURCES.TARGET_DISTANCE]: ({ state, target }) => target ? distanceBetween(state.player, target) : Number.POSITIVE_INFINITY,
    [STATE_VARIABLE_SOURCES.TARGET_HP]: ({ target }) => Math.max(0, Number(target?.hp ?? 0)),
    [STATE_VARIABLE_SOURCES.TARGET_ALIVE]: ({ target }) => Boolean(target) && Number(target.hp ?? 0) > 0,
    [STATE_VARIABLE_SOURCES.TARGET_BEARING_FROM_ME]: ({ state, target }) => signedBearing(state.player, target),
    [STATE_VARIABLE_SOURCES.TARGET_MOVEMENT_DIRECTION]: ({ target }) => movementDirection(target),
    [STATE_VARIABLE_SOURCES.TARGET_SPEED]: ({ target }) => target
        ? Math.hypot(Number(target.movementVelocityX ?? target.velocityX ?? 0), Number(target.movementVelocityY ?? target.velocityY ?? 0))
        : 0,
    [STATE_VARIABLE_SOURCES.BEARING_FROM_TARGET]: ({ state, target }) => target ? compassBearing(target, state.player) : 0,
    [STATE_VARIABLE_SOURCES.TARGET_RELATIVE_BEARING]: ({ state, target }) => target ? Math.abs(signedAngleDelta(state.player?.rotation ?? 0, compassBearing(state.player, target))) : 0,
    [STATE_VARIABLE_SOURCES.TARGET_RELATIVE_BEARING_CLOCKWISE]: ({ state, target }) => target ? clockwiseAngleDelta(state.player?.rotation ?? 0, compassBearing(state.player, target)) : 0,
    [STATE_VARIABLE_SOURCES.TARGET_RELATIVE_BEARING_COUNTERCLOCKWISE]: ({ state, target }) => target ? clockwiseAngleDelta(compassBearing(state.player, target), state.player?.rotation ?? 0) : 0,
    [STATE_VARIABLE_SOURCES.TARGET_FACING]: ({ state, target }) => target === state.opponent ? normalizeRotation(target.rotation) : 0,
    [STATE_VARIABLE_SOURCES.TARGET_COUNT]: ({ normalizedTargetId, operations, state }) => operations.matchingTargets(state, normalizedTargetId).length,
    [STATE_VARIABLE_SOURCES.TARGET_AGE]: ({ target }) => millisecondsToSeconds(target?.ageMs ?? 0),
    [STATE_VARIABLE_SOURCES.BOT_EDGE_DISTANCE]: ({ state, definition }) => edgeDistance(scopedBot(state, definition)),
    [STATE_VARIABLE_SOURCES.BOT_CLOSING_ZONE_EDGE_DISTANCE]: ({ state, definition }) => closingZoneEdgeDistance(state.closingZone, scopedBot(state, definition)),
    [STATE_VARIABLE_SOURCES.TARGET_EDGE_DISTANCE]: ({ target }) => target ? edgeDistance(target) : 0,
    [STATE_VARIABLE_SOURCES.TARGET_EXISTS]: ({ target }) => Boolean(target),
    [STATE_VARIABLE_SOURCES.SELECTED_ABILITY_READY]: (context) => abilityReady(scopedBot(context.state, context.definition), selectedAbilityId(context)),
    [STATE_VARIABLE_SOURCES.SELECTED_ABILITY_ACTIVE]: (context) => abilityActiveMs(scopedBot(context.state, context.definition), selectedAbilityId(context)) > 0,
    [STATE_VARIABLE_SOURCES.SELECTED_ABILITY_ACTIVE_MS]: (context) => millisecondsToSeconds(abilityActiveMs(scopedBot(context.state, context.definition), selectedAbilityId(context))),
    [STATE_VARIABLE_SOURCES.SELECTED_ABILITY_ON_COOLDOWN]: (context) => abilityOnCooldown(scopedBot(context.state, context.definition), selectedAbilityId(context)),
    [STATE_VARIABLE_SOURCES.SELECTED_ABILITY_COOLDOWN_MS]: (context) => millisecondsToSeconds(abilityCooldownMs(scopedBot(context.state, context.definition), selectedAbilityId(context))),
    [STATE_VARIABLE_SOURCES.SELECTED_ABILITY_CHARGES]: (context) => abilityCharges(scopedBot(context.state, context.definition), selectedAbilityId(context)),
    [STATE_VARIABLE_SOURCES.SELECTED_ABILITY_PREPARING]: (context) => {
        const bot = scopedBot(context.state, context.definition);
        return bot?.preparingAbility === selectedAbilityId(context) && Number(bot.preparingMs) > 0;
    },
    [STATE_VARIABLE_SOURCES.SELECTED_ABILITY_PREPARATION_MS]: (context) => {
        const bot = scopedBot(context.state, context.definition);
        // preparingMs is the remaining countdown for the active wind-up.
        return bot?.preparingAbility === selectedAbilityId(context) ? millisecondsToSeconds(bot.preparingMs ?? 0) : 0;
    },
    [STATE_VARIABLE_SOURCES.SELECTED_STATUS_EFFECT_ACTIVE]: (context) => {
        const bot = scopedBot(context.state, context.definition);
        return statusEffectActive(bot, context.condition.statusEffect);
    },
    [STATE_VARIABLE_SOURCES.SELECTED_STATUS_EFFECT_DURATION_MS]: (context) => millisecondsToSeconds(
        statusEffectDurationMs(scopedBot(context.state, context.definition), context.condition.statusEffect)),
});

function scopedBot(state, definition) {
    return definition.scope === STATE_VARIABLE_SCOPES.MY ? state.player : state.opponent;
}

function selectedAbilityId(context) {
    return abilityIdFromBoundary(context.condition.ability);
}

function statusEffectDurationMs(bot, effect) {
    const normalizedEffect = String(effect ?? "").toLowerCase();
    return (bot?.statusEffects ?? [])
        .filter((status) => statusEffectId(status) === normalizedEffect && status?.mode !== "presence")
        .reduce((remaining, status) => Math.max(remaining, Number(status?.remainingMs ?? 0)), 0);
}

function statusEffectId(status) {
    return String(status?.type ?? "").toLowerCase();
}

function statusEffectActive(bot, effect) {
    const normalizedEffect = String(effect ?? "").toLowerCase();
    return (bot?.statusEffects ?? []).some((status) => statusEffectId(status) === normalizedEffect
        && (status?.mode === "presence" || Number(status?.remainingMs ?? 0) > 0));
}
function millisecondsToSeconds(value) { const number = Number(value); return Number.isFinite(number) ? number / 1000 : 0; }
function distanceBetween(a, b) { return !a || !b ? Number.POSITIVE_INFINITY : Math.hypot(b.x - a.x, b.y - a.y); }
function compassBearing(a, b) { return ((Math.atan2(b.x - a.x, a.y - b.y) * 180 / Math.PI) % 360 + 360) % 360; }
function signedBearing(a, b) { if (!b) return 0; const value = compassBearing(a, b); return value > 180 ? value - 360 : value; }
function movementDirection(target) { const x = Number(target?.velocityX ?? 0); const y = Number(target?.velocityY ?? 0); return Math.hypot(x, y) <= .001 ? Number.NaN : signedBearing({ x: 0, y: 0 }, { x, y }); }
function normalizeRotation(value) { return ((Number(value ?? 0) % 360) + 360) % 360; }
function signedAngleDelta(from, to) { return ((to - from + 540) % 360) - 180; }
function clockwiseAngleDelta(from, to) { return ((to - from) % 360 + 360) % 360; }
function edgeDistance(entity) { const half = Math.max(0, Number(entity?.size ?? ENTITY_SIZE) / 2); return Math.max(0, Math.min(entity.x - half, ARENA_WIDTH_UNITS - half - entity.x, entity.y - half, ARENA_HEIGHT_UNITS - half - entity.y)); }
function closingZoneEdgeDistance(zone, entity) {
    if (!zone || !entity) return null;
    const safeRadius = Number(zone.safeRadius ?? Number(zone.size ?? 0) / 2);
    const entityX = Number(entity.x);
    const entityY = Number(entity.y);
    if (!Number.isFinite(safeRadius) || !Number.isFinite(entityX) || !Number.isFinite(entityY)) return null;
    const centerX = Number(zone.x ?? ARENA_WIDTH_UNITS / 2);
    const centerY = Number(zone.y ?? ARENA_HEIGHT_UNITS / 2);
    if (!Number.isFinite(centerX) || !Number.isFinite(centerY)) return null;
    const entityRadius = Math.max(0, Number(entity.size ?? ENTITY_SIZE) / 2);
    return safeRadius - Math.hypot(entityX - centerX, entityY - centerY) - entityRadius;
}
function targetSupportsCapability(target, capability) {
    const definition = TARGET_BY_ID.get(String(target ?? "").split(":")[0]);
    return capability === TARGET_CAPABILITIES.HEALTH ? Boolean(definition?.healthBearing) : true;
}
