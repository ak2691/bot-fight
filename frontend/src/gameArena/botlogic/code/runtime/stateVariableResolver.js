import { ARENA_HEIGHT_UNITS, ARENA_WIDTH_UNITS } from "../../../modelPayloads/arenaConstants.js";
import { truncateToNumberPrecision } from "../configuration/constants.js";
import {
    abilityActiveMs,
    abilityCharges,
    abilityCooldownMs,
    abilityOnCooldown,
    abilityReady,
    botHasAbility,
} from "./actionRuntime.js";
import { abilityIdFromBoundary } from "../../../gameconfig/AbilityCompatibility.js";
import {
    BOT_CODE_SELECTABLES,
    CUSTOM_VARIABLE_CONTRACT,
    STATE_VARIABLE_BY_ID,
    STATE_VARIABLE_SCOPES,
    STATE_VARIABLE_SOURCES,
    SELECTABLE_BY_ID,
    SELECTABLE_CAPABILITIES,
    TARGET_MODES,
    VARIABLE_SELECTABLE_TYPES,
    canonicalBotSelectableId,
    selectableIdentitiesForVariable,
} from "../contracts/BotLogicContracts.js";

const ENTITY_SIZE = 60;

export function resolveStateVariable(state, condition, variableId, selectableId, operations) {
    if (String(variableId).startsWith(CUSTOM_VARIABLE_CONTRACT.PREFIX)) return operations.resolveCustom(state, variableId);
    const definition = STATE_VARIABLE_BY_ID.get(variableId);
    if (!definition?.runtimeSource) return null;
    const pair = definition.selectableType === VARIABLE_SELECTABLE_TYPES.PAIR ? selectablePairIds(condition, definition) : null;
    const normalizedSelectableId = pair?.[0] ?? selectableId ?? condition.selectable ?? BOT_CODE_SELECTABLES.OPPONENT;
    const targetMode = normalizeTargetMode(condition, definition);
    const normalizedSelectable2Id = pair && targetMode === TARGET_MODES.TARGET ? pair[1] : null;
    if (definition.selectableCapability && !selectableSupportsCapability(normalizedSelectableId, definition.selectableCapability)) return null;
    const selectable = operations.resolveSelectable(state, normalizedSelectableId);
    const selectable2 = normalizedSelectable2Id ? operations.resolveSelectable(state, normalizedSelectable2Id) : null;
    const target = targetMode === TARGET_MODES.COORDINATES
        ? coordinateTarget(condition)
        : targetMode === TARGET_MODES.TARGET ? selectable2 : null;
    if (!selectableMatchesIdentities(normalizedSelectableId, selectableIdentitiesForVariable(definition, pair ? 0 : null))) return null;
    if (pair && targetMode === TARGET_MODES.TARGET
        && !selectableMatchesIdentities(normalizedSelectable2Id, selectableIdentitiesForVariable(definition, 1))) return null;
    const resolver = RUNTIME_RESOLVERS[definition.runtimeSource];
    const resolved = resolver?.({
        state,
        condition,
        definition,
        selectable,
        selectable2,
        target,
        targetMode,
        targetAngle: Number(condition?.targetAngle ?? 0),
        normalizedSelectableId,
        normalizedSelectable2Id,
        operations,
    }) ?? null;
    return typeof resolved === "number" ? truncateToNumberPrecision(resolved) : resolved;
}

const RUNTIME_RESOLVERS = Object.freeze({
    [STATE_VARIABLE_SOURCES.MATCH_ELAPSED_SECONDS]: ({ state }) => millisecondsToSeconds(state.player.matchElapsedMs),
    [STATE_VARIABLE_SOURCES.SELECTABLE_DISTANCE]: ({ selectable, target }) => distanceBetween(selectable, target),
    [STATE_VARIABLE_SOURCES.SELECTABLE_DAMAGE_TAKEN_LAST_TICK]: ({ selectable, normalizedSelectableId }) => selectableDamageTaken(normalizedSelectableId, selectable),
    [STATE_VARIABLE_SOURCES.SELECTABLE_HP_NET_CHANGE_LAST_TICK]: ({ selectable, normalizedSelectableId }) => selectableHpNetChange(normalizedSelectableId, selectable),
    [STATE_VARIABLE_SOURCES.SELECTABLE_X]: ({ selectable }) => Number(selectable?.x ?? 0),
    [STATE_VARIABLE_SOURCES.SELECTABLE_Y]: ({ selectable }) => Number(selectable?.y ?? 0),
    [STATE_VARIABLE_SOURCES.SELECTABLE_HP]: ({ selectable, normalizedSelectableId }) => selectableHasUsableHealth(normalizedSelectableId, selectable)
        ? Math.max(0, Number(selectable?.hp ?? 0)) : 0,
    [STATE_VARIABLE_SOURCES.SELECTABLE_ALIVE]: ({ selectable, normalizedSelectableId }) => selectableHasUsableHealth(normalizedSelectableId, selectable)
        && Number(selectable?.hp ?? 0) > 0,
    [STATE_VARIABLE_SOURCES.SELECTABLE_ABSOLUTE_BEARING]: ({ selectable, target }) => signedBearing(selectable, target),
    [STATE_VARIABLE_SOURCES.SELECTABLE_MOVEMENT_DIRECTION]: ({ selectable }) => movementDirection(selectable),
    [STATE_VARIABLE_SOURCES.SELECTABLE_SPEED]: ({ selectable }) => selectable
        ? Math.hypot(Number(selectable.movementVelocityX ?? selectable.velocityX ?? 0), Number(selectable.movementVelocityY ?? selectable.velocityY ?? 0))
        : 0,
    [STATE_VARIABLE_SOURCES.SELECTABLE_RELATIVE_BEARING]: ({ selectable, target, targetMode, targetAngle }) => {
        const bearing = bearingToTarget(selectable, target, targetMode, targetAngle);
        return bearing == null ? 0 : Math.abs(signedAngleDelta(normalizeRotation(selectable.rotation), bearing));
    },
    [STATE_VARIABLE_SOURCES.SELECTABLE_RELATIVE_BEARING_CLOCKWISE]: ({ selectable, target, targetMode, targetAngle }) => {
        const bearing = bearingToTarget(selectable, target, targetMode, targetAngle);
        return bearing == null ? 0 : clockwiseAngleDelta(normalizeRotation(selectable.rotation), bearing);
    },
    [STATE_VARIABLE_SOURCES.SELECTABLE_RELATIVE_BEARING_COUNTERCLOCKWISE]: ({ selectable, target, targetMode, targetAngle }) => {
        const bearing = bearingToTarget(selectable, target, targetMode, targetAngle);
        return bearing == null ? 0 : clockwiseAngleDelta(bearing, normalizeRotation(selectable.rotation));
    },
    [STATE_VARIABLE_SOURCES.SELECTABLE_FACING]: ({ selectable }) => selectable ? normalizeRotation(selectable.rotation) : 0,
    [STATE_VARIABLE_SOURCES.SELECTABLE_COUNT]: ({ normalizedSelectableId, operations, state }) => operations.matchingSelectables(state, normalizedSelectableId).length,
    [STATE_VARIABLE_SOURCES.SELECTABLE_AGE]: ({ selectable }) => millisecondsToSeconds(selectable?.ageMs ?? 0),
    [STATE_VARIABLE_SOURCES.SELECTABLE_EDGE_DISTANCE]: ({ selectable }) => selectable ? edgeDistance(selectable) : 0,
    [STATE_VARIABLE_SOURCES.SELECTABLE_CLOSING_ZONE_EDGE_DISTANCE]: ({ state, selectable }) => closingZoneEdgeDistance(state.closingZone, selectable),
    [STATE_VARIABLE_SOURCES.SELECTABLE_EXISTS]: ({ selectable }) => Boolean(selectable),
    [STATE_VARIABLE_SOURCES.SELECTED_ABILITY_READY]: (context) => abilityReady(botForContext(context), selectedAbilityId(context)),
    [STATE_VARIABLE_SOURCES.SELECTED_ABILITY_ACTIVE]: (context) => abilityActiveMs(botForContext(context), selectedAbilityId(context)) > 0,
    [STATE_VARIABLE_SOURCES.SELECTED_ABILITY_ACTIVE_MS]: (context) => millisecondsToSeconds(abilityActiveMs(botForContext(context), selectedAbilityId(context))),
    [STATE_VARIABLE_SOURCES.SELECTED_ABILITY_ON_COOLDOWN]: (context) => abilityOnCooldown(botForContext(context), selectedAbilityId(context)),
    [STATE_VARIABLE_SOURCES.SELECTED_ABILITY_COOLDOWN_MS]: (context) => millisecondsToSeconds(abilityCooldownMs(botForContext(context), selectedAbilityId(context))),
    [STATE_VARIABLE_SOURCES.SELECTED_ABILITY_CHARGES]: (context) => abilityCharges(botForContext(context), selectedAbilityId(context)),
    [STATE_VARIABLE_SOURCES.SELECTED_ABILITY_PREPARING]: (context) => {
        const bot = botForContext(context);
        const ability = selectedAbilityId(context);
        return botHasAbility(bot, ability) && bot?.preparingAbility === ability && Number(bot.preparingMs) > 0;
    },
    [STATE_VARIABLE_SOURCES.SELECTED_ABILITY_PREPARATION_MS]: (context) => {
        const bot = botForContext(context);
        const ability = selectedAbilityId(context);
        // preparingMs is the remaining countdown for the active wind-up.
        return botHasAbility(bot, ability) && bot?.preparingAbility === ability
            ? millisecondsToSeconds(bot.preparingMs ?? 0) : 0;
    },
    [STATE_VARIABLE_SOURCES.SELECTED_STATUS_EFFECT_ACTIVE]: (context) => {
        const bot = botForContext(context);
        return statusEffectActive(bot, context.condition.statusEffect);
    },
    [STATE_VARIABLE_SOURCES.SELECTED_STATUS_EFFECT_DURATION_MS]: (context) => millisecondsToSeconds(
        statusEffectDurationMs(botForContext(context), context.condition.statusEffect)),
});

function botForContext(context) {
    if (context.definition.scope === STATE_VARIABLE_SCOPES.SELECTABLE) {
        const bots = context.state.bots ?? [
            context.state.player,
            context.state.opponent,
            ...(context.state.teammates ?? []),
            ...(context.state.opponents ?? []),
        ];
        return bots.includes(context.selectable)
            ? context.selectable
            : null;
    }
    return null;
}

function selectablePairIds(condition, definition) {
    const first = condition?.selectable1 ?? definition.defaultSelectable1 ?? BOT_CODE_SELECTABLES.MY;
    const second = condition?.selectable2 ?? condition?.selectable ?? definition.defaultSelectable2 ?? BOT_CODE_SELECTABLES.OPPONENT;
    return [first, second];
}

function normalizeTargetMode(condition, definition) {
    const modes = definition?.targetModes;
    if (!Array.isArray(modes) || modes.length === 0) return TARGET_MODES.TARGET;
    const requested = condition?.targetMode
        ?? (condition?.targetX != null || condition?.targetY != null
            ? TARGET_MODES.COORDINATES
            : condition?.targetAngle != null ? TARGET_MODES.ANGLE : TARGET_MODES.TARGET);
    return modes.includes(requested)
        ? requested
        : modes.includes(TARGET_MODES.TARGET) ? TARGET_MODES.TARGET : modes[0];
}

function coordinateTarget(condition) {
    const x = Number(condition?.targetX ?? ARENA_WIDTH_UNITS / 2);
    const y = Number(condition?.targetY ?? ARENA_HEIGHT_UNITS / 2);
    return {
        x: Number.isFinite(x) ? Math.max(0, Math.min(ARENA_WIDTH_UNITS, x)) : ARENA_WIDTH_UNITS / 2,
        y: Number.isFinite(y) ? Math.max(0, Math.min(ARENA_HEIGHT_UNITS, y)) : ARENA_HEIGHT_UNITS / 2,
    };
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
function selectableDamageTaken(selectableId, selectable) {
    return selectableHasUsableHealth(selectableId, selectable)
        ? Math.max(0, Number(selectable?.damageTakenLastTick ?? selectable?.health?.damageTakenLastTick ?? 0))
        : 0;
}
function selectableHpNetChange(selectableId, selectable) {
    return selectableHasUsableHealth(selectableId, selectable)
        ? Number(selectable?.hpNetChangeLastTick ?? selectable?.health?.netChangeLastTick ?? 0)
        : 0;
}
function compassBearing(a, b) { return ((Math.atan2(b.x - a.x, a.y - b.y) * 180 / Math.PI) % 360 + 360) % 360; }
function bearingToTarget(selectable, target, targetMode, targetAngle) {
    if (!selectable) return null;
    if (targetMode === TARGET_MODES.ANGLE) {
        const angle = Number(targetAngle);
        return normalizeRotation(Number.isFinite(angle) ? angle : 0);
    }
    return target ? compassBearing(selectable, target) : null;
}
function signedBearing(a, b) { if (!a || !b) return 0; const value = compassBearing(a, b); return value > 180 ? value - 360 : value; }
function movementDirection(selectable) { const x = Number(selectable?.velocityX ?? 0); const y = Number(selectable?.velocityY ?? 0); return Math.hypot(x, y) <= .001 ? Number.NaN : signedBearing({ x: 0, y: 0 }, { x, y }); }
function normalizeRotation(value) { return ((Number(value ?? 0) % 360) + 360) % 360; }
function signedAngleDelta(from, to) { return ((to - from + 540) % 360) - 180; }
function clockwiseAngleDelta(from, to) { return ((to - from) % 360 + 360) % 360; }
function edgeDistance(entity) {
    if (!entity) return 0;
    const halfWidth = halfExtent(entity, "width");
    const halfHeight = halfExtent(entity, "height");
    return Math.max(0, Math.min(
        Number(entity.x) - halfWidth,
        ARENA_WIDTH_UNITS - halfWidth - Number(entity.x),
        Number(entity.y) - halfHeight,
        ARENA_HEIGHT_UNITS - halfHeight - Number(entity.y),
    ));
}
function closingZoneEdgeDistance(zone, entity) {
    if (!zone || !entity) return null;
    const safeRadius = Number(zone.safeRadius ?? Number(zone.size ?? 0) / 2);
    const entityX = Number(entity.x);
    const entityY = Number(entity.y);
    if (!Number.isFinite(safeRadius) || !Number.isFinite(entityX) || !Number.isFinite(entityY)) return null;
    const centerX = Number(zone.x ?? ARENA_WIDTH_UNITS / 2);
    const centerY = Number(zone.y ?? ARENA_HEIGHT_UNITS / 2);
    if (!Number.isFinite(centerX) || !Number.isFinite(centerY)) return null;
    const entityRadius = Math.max(0, Math.max(halfExtent(entity, "width"), halfExtent(entity, "height")));
    return safeRadius - Math.hypot(entityX - centerX, entityY - centerY) - entityRadius;
}
function halfExtent(entity, axis) {
    const direct = Number(entity?.[axis]);
    if (Number.isFinite(direct) && direct >= 0) return direct / 2;
    const size = Number(entity?.size ?? entity?.transform?.size ?? ENTITY_SIZE);
    return Number.isFinite(size) && size >= 0 ? size / 2 : ENTITY_SIZE / 2;
}
function selectableSupportsCapability(selectableId, capability) {
    const base = canonicalBotSelectableId(selectableId).split(":")[0];
    const definition = SELECTABLE_BY_ID.get(base);
    return capability === SELECTABLE_CAPABILITIES.HEALTH ? Boolean(definition?.healthBearing) : true;
}

function selectableHasUsableHealth(selectableId, selectable) {
    const base = canonicalBotSelectableId(selectableId).split(":")[0];
    const definition = SELECTABLE_BY_ID.get(base);
    return Boolean(selectable && definition?.healthBearing);
}
function selectableMatchesIdentities(selectableId, identities) {
    if (!identities?.length) return true;
    const base = canonicalBotSelectableId(selectableId).split(":")[0];
    const definition = SELECTABLE_BY_ID.get(base);
    return identities.every((identity) => definition?.selectableIdentities?.includes(identity));
}
