import { ARENA_HEIGHT_UNITS, ARENA_WIDTH_UNITS } from "../../modelPayloads/arenaConstants.js";
import { abilityAmmo, abilityCooldownMs, abilityReady } from "./actionRuntime.js";

const ENTITY_SIZE = 60;

export function resolveStateVariable(state, condition, variableId, targetId, operations) {
    if (String(variableId).startsWith("custom.")) return operations.resolveCustom(state, variableId);
    const normalizedTargetId = targetId ?? condition.target ?? "opponent";
    const target = operations.resolveTarget(state, normalizedTargetId);
    const selectedAbility = String(condition.ability ?? "");
    const genericAbility = /^(my|opponent)\.selectedAbility(Ready|CooldownMs|Ammo|Preparing|PreparationMs)$/.exec(variableId);
    if (genericAbility) {
        const bot = genericAbility[1] === "my" ? state.player : state.opponent;
        if (genericAbility[2] === "Ready") return abilityReady(bot, selectedAbility);
        if (genericAbility[2] === "CooldownMs") return millisecondsToSeconds(abilityCooldownMs(bot, selectedAbility));
        if (genericAbility[2] === "Ammo") return abilityAmmo(bot, selectedAbility);
        if (genericAbility[2] === "Preparing") return bot?.preparingAbility === selectedAbility;
        return bot?.preparingAbility === selectedAbility ? millisecondsToSeconds(bot?.preparingMs ?? 0) : 0;
    }
    const genericStatus = /^(my|opponent)\.selectedStatusEffect(Active|DurationMs)$/.exec(variableId);
    if (genericStatus) {
        const bot = genericStatus[1] === "my" ? state.player : state.opponent;
        const duration = statusEffectDurationMs(bot, condition.statusEffect);
        return genericStatus[2] === "Active"
            ? duration > 0 || (condition.statusEffect === "silence" && Boolean(bot?.nullZoneSilenced))
            : millisecondsToSeconds(duration);
    }
    switch (variableId) {
        case "match.elapsedSeconds": return millisecondsToSeconds(state.player.matchElapsedMs);
        case "my.hp": return state.player.hp;
        case "my.damageTakenLastTick": return Number(state.player.damageTakenLastTick ?? 0);
        case "my.hpNetChangeLastTick": return Number(state.player.hpNetChangeLastTick ?? 0);
        case "my.x": return state.player.x ?? 0;
        case "my.y": return state.player.y ?? 0;
        case "opponent.hp": return state.opponent?.hp ?? 0;
        case "opponent.damageTakenLastTick": return Number(state.opponent?.damageTakenLastTick ?? 0);
        case "opponent.hpNetChangeLastTick": return Number(state.opponent?.hpNetChangeLastTick ?? 0);
        case "opponent.x": return state.opponent?.x ?? 0;
        case "opponent.y": return state.opponent?.y ?? 0;
        case "target.distance": return target ? distanceBetween(state.player, target) : Number.POSITIVE_INFINITY;
        case "target.hp": return Math.max(0, Number(target?.hp ?? 0));
        case "target.alive": return Boolean(target) && Number(target.hp ?? 0) > 0;
        case "target.bearingFromMe": return signedBearing(state.player, target);
        case "target.movementDirection": return movementDirection(target);
        case "target.velocity": return target ? Math.hypot(Number(target.velocityX ?? 0), Number(target.velocityY ?? 0)) : 0;
        case "my.bearingFromTarget": return target ? compassBearing(target, state.player) : 0;
        case "target.relativeBearing": return target ? Math.abs(signedAngleDelta(state.player?.rotation ?? 0, compassBearing(state.player, target))) : 0;
        case "target.relativeBearingClockwise": return target ? clockwiseAngleDelta(state.player?.rotation ?? 0, compassBearing(state.player, target)) : 0;
        case "target.relativeBearingCounterclockwise": return target ? clockwiseAngleDelta(compassBearing(state.player, target), state.player?.rotation ?? 0) : 0;
        case "target.facing": return target === state.opponent ? normalizeRotation(target.rotation) : 0;
        case "target.count": return operations.matchingTargets(state, normalizedTargetId).length;
        case "target.age": return millisecondsToSeconds(target?.ageMs ?? target?.timerMs ?? 0);
        case "my.edgeDistance": return edgeDistance(state.player);
        case "target.edgeDistance": return target ? edgeDistance(target) : 0;
        case "target.exists": return Boolean(target);
        default: return null;
    }
}

function statusEffectDurationMs(bot, effect) {
    return Number({ burn: bot?.burnRemainingMs, stun: bot?.stunnedMs, bleed: bot?.bleedRemainingMs,
        slow: bot?.slowedMs, shock: bot?.shockRemainingMs, silence: bot?.silencedMs }[effect] ?? 0);
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
