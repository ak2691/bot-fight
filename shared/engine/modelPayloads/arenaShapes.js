import {
    BASE_BOT_HP,
} from "./arenaConstants.js";
import { ABILITY_STATS } from "../gameconfig/Abilities.js";
import { abilityMaxCharges } from "../gameconfig/AbilityResourceSystem.js";
import { BASE_BOT_STATS, DEFAULT_BOT_LOADOUT, STANDARD_ABILITY_IDS, decodeBotLoadout, decodeSandboxLoadout, encodeBotLoadout, normalizedBotLoadout } from "../loadout/BotLoadout.js";
import { withoutBotStatuses } from "../gameconfig/DefensiveState.js";
import { isClosingZone } from "../ecs/entities/ClosingZoneSystem.js";
import { normalizeStatusEffect, statusEffectsFor } from "../ecs/contracts/StatusContracts.js";
import {
    ARENA_HEIGHT_UNITS,
    ARENA_WIDTH_UNITS,
    BOT_CENTER_MAX_X,
    BOT_CENTER_MAX_Y,
    BOT_CENTER_MIN_X,
    BOT_CENTER_MIN_Y,
    DUEL_SLOT_ONE_X,
    DUEL_SLOT_ONE_Y,
    DUEL_SLOT_TWO_X,
    DUEL_SLOT_TWO_Y,
} from "./arenaConstants.js";

export const MAIN_SHAPE = {
    id: "main",
    isCurrentUser: true,
    username: "Player",
    type: "circle",
    slot: 1,
    health: {
        current: BASE_BOT_HP,
        max: BASE_BOT_HP,
    },
    stats: {
        moveSpeed: BASE_BOT_STATS.moveSpeed,
        attackDamageMultiplier: 1,
        attackSpeedMultiplier: 1,
    },
    transform: {
        position: {
            x: ARENA_WIDTH_UNITS / 2,
            y: ARENA_HEIGHT_UNITS / 2,
        },
        rotation: 90,
        size: 60,
        velocity: { x: 0, y: 0 },
        movementVelocity: { x: 0, y: 0 },
    },
    statusEffects: [],
    combatLoadout: encodeBotLoadout(DEFAULT_BOT_LOADOUT),
    loadout: DEFAULT_BOT_LOADOUT,
    abilities: [...STANDARD_ABILITY_IDS],
    abilityActiveMs: {},
    abilityCooldowns: {},
    abilityPendingCooldownMs: {},
    abilityCharges: initialAbilityCharges(STANDARD_ABILITY_IDS),
    abilityRechargeMs: initialAbilityRechargeMs(STANDARD_ABILITY_IDS),
    abilityEntitySerial: 1,
};

export function buildOpponentShape(opponent) {
    const suppliedLoadout = opponent?.loadout ?? opponent?.selectedLoadout;
    const loadout = suppliedLoadout && typeof suppliedLoadout === "object"
        ? normalizedBotLoadout(suppliedLoadout)
        : decodeBotLoadout(suppliedLoadout);
    const loadoutId = encodeBotLoadout(loadout);
    const abilities = abilitiesForLoadout(loadout);
    const stats = BASE_BOT_STATS;
    const requestedSlot = Number(opponent?.slot);
    const slot = Number.isFinite(requestedSlot) && requestedSlot >= 1 && requestedSlot <= 8
        ? Math.floor(requestedSlot)
        : 2;
    return toCanonicalBotShape({
        id: "opponent-model",
        isCurrentUser: false,
        username: opponent?.username ?? "Opponent",
        type: "opponentModel",
        slot,
        teamNumber: teamNumberForParticipant(opponent),
        userId: opponent?.userId ?? null,
        x: DUEL_SLOT_TWO_X,
        y: DUEL_SLOT_TWO_Y,
        size: 64,
        rotation: 0,
        combatLoadout: loadoutId,
        loadout,
        abilities,
        hp: stats.maxHp,
        maxHp: stats.maxHp,
        moveSpeed: stats.moveSpeed,
        attackDamageMultiplier: stats.attackDamagePercent / 100,
        attackSpeedMultiplier: stats.attackSpeedPercent / 100,
        abilityActiveMs: {},
        abilityCooldowns: Object.fromEntries(abilities.map((ability) => [ability, 0])),
        abilityPendingCooldownMs: {},
        abilityCharges: initialAbilityCharges(abilities, stats.maxHp),
        abilityRechargeMs: initialAbilityRechargeMs(abilities),
        abilityEntitySerial: 1,
        preparingAbility: null,
        preparingMs: 0,
        preparingTargetX: null,
        preparingTargetY: null,
        movementVelocityX: 0,
        movementVelocityY: 0,
        velocityX: 0,
        velocityY: 0,
        opponentUsername: opponent?.username ?? "Opponent",
    });
}

export function buildInitialArenaShapes(matchContext) {
    if (matchContext?.matchId) return buildMatchSpawnShapes(matchContext);
    const shapes = [cloneShape(MAIN_SHAPE)];
    shapes.push(buildOpponentShape(matchContext?.opponent ?? {
        selectedLoadout: encodeBotLoadout(DEFAULT_BOT_LOADOUT),
        slot: 2,
    }));
    return shapes;
}

export function buildMatchSpawnShapes(matchContext) {
    const participants = matchParticipants(matchContext);
    const currentUserId = matchContext?.player?.userId == null
        ? null
        : String(matchContext.player.userId);
    const playerSlot = Number(matchContext?.player?.slot);
    return participants.map((participant) => {
        const isPlayer = currentUserId != null
            ? String(participant.userId) === currentUserId
            : Number(participant.slot) === playerSlot;
        const loadout = loadoutForParticipant(matchContext, participant, isPlayer);
        const loadoutId = loadoutIdentifier(loadout);
        const position = matchSpawnPosition(participants, participant);
        const shapeId = isPlayer
            ? "main"
            : participants.length === 2
                ? "opponent-model"
                : botShapeId(participant);
        const baseShape = isPlayer
            ? { ...MAIN_SHAPE }
            : buildOpponentShape({ ...participant, selectedLoadout: loadoutId });
        return resetBotShape({
            ...baseShape,
            id: shapeId,
            type: isPlayer ? "circle" : "bot",
            combatLoadout: loadoutId,
            loadout: loadoutObject(loadoutId),
            x: position.x,
            y: position.y,
            rotation: position.rotation,
            slot: Number(participant.slot) || (isPlayer ? 1 : 2),
            teamNumber: teamNumberForParticipant(participant),
            isCurrentUser: isPlayer,
            userId: participant.userId ?? null,
            username: participant.username ?? (isPlayer ? "Player" : "Opponent"),
            opponentUsername: participant.username ?? (isPlayer ? "Player" : "Opponent"),
            locked: !isPlayer,
        });
    });
}

function matchParticipants(matchContext) {
    const source = Array.isArray(matchContext?.players) && matchContext.players.length > 0
        ? matchContext.players
        : [matchContext?.player, matchContext?.opponent].filter(Boolean);
    return source
        .filter((participant) => participant?.userId != null || participant?.slot != null)
        .map((participant) => ({
            ...participant,
            slot: Number(participant.slot) || 1,
            teamNumber: teamNumberForParticipant(participant),
        }))
        .sort((first, second) => first.slot - second.slot);
}

function botShapeId(participant) {
    return participant?.userId != null
        ? `bot-${participant.userId}`
        : `bot-slot-${Number(participant?.slot) || 1}`;
}

function teamNumberForParticipant(participant) {
    const explicit = Number(participant?.teamNumber);
    if (Number.isFinite(explicit) && explicit > 0) return Math.floor(explicit);
    const slot = Number(participant?.slot);
    return Number.isFinite(slot) && slot === 1 ? 1 : 2;
}

function loadoutForParticipant(matchContext, participant, isPlayer) {
    if (isPlayer) return matchContext?.loadout ?? participant?.selectedLoadout ?? encodeBotLoadout(DEFAULT_BOT_LOADOUT);
    const opponentId = matchContext?.opponent?.userId;
    if (opponentId != null && String(opponentId) === String(participant?.userId)
        && matchContext?.opponentLoadout != null) {
        return matchContext.opponentLoadout;
    }
    return participant?.selectedLoadout ?? encodeBotLoadout(DEFAULT_BOT_LOADOUT);
}

function loadoutObject(loadout) {
    if (loadout && typeof loadout === "object") return normalizedBotLoadout(loadout);
    const encoded = String(loadout ?? "");
    return encoded.startsWith("sandbox:")
        ? decodeSandboxLoadout(encoded)
        : decodeBotLoadout(encoded || encodeBotLoadout(DEFAULT_BOT_LOADOUT));
}

function loadoutIdentifier(loadout) {
    if (loadout && typeof loadout === "object") return encodeBotLoadout(normalizedBotLoadout(loadout));
    const encoded = String(loadout ?? "");
    return encoded || encodeBotLoadout(DEFAULT_BOT_LOADOUT);
}

function matchSpawnPosition(participants, participant) {
    const teamPlayers = participants
        .filter((candidate) => candidate.teamNumber === participant.teamNumber)
        .sort((first, second) => first.slot - second.slot);
    const teamIndex = Math.max(0, teamPlayers.findIndex((candidate) => candidate.slot === participant.slot));
    const teamSize = Math.max(1, teamPlayers.length);
    const x = ARENA_WIDTH_UNITS * (teamIndex + 1) / (teamSize + 1);
    return {
        x,
        y: participant.teamNumber === 1 ? DUEL_SLOT_ONE_Y : DUEL_SLOT_TWO_Y,
        rotation: participant.teamNumber === 1 ? 180 : 0,
    };
}

export function cloneShape(shape) {
    if (!isArenaBotShape(shape)) return { ...shape };
    if (!isCanonicalBotShape(shape)) return { ...shape };
    return {
        ...shape,
        health: { ...(shape.health ?? {}) },
        stats: { ...(shape.stats ?? {}) },
        transform: {
            ...(shape.transform ?? {}),
            position: { ...(shape.transform?.position ?? {}) },
            velocity: { ...(shape.transform?.velocity ?? {}) },
            movementVelocity: { ...(shape.transform?.movementVelocity ?? {}) },
        },
        statusEffects: (shape.statusEffects ?? []).map((effect) => ({ ...effect })),
        abilities: [...(shape.abilities ?? [])],
        abilityActiveMs: { ...(shape.abilityActiveMs ?? {}) },
        abilityCooldowns: { ...(shape.abilityCooldowns ?? {}) },
        abilityPendingCooldownMs: { ...(shape.abilityPendingCooldownMs ?? {}) },
        abilityCharges: { ...(shape.abilityCharges ?? {}) },
        abilityRechargeMs: { ...(shape.abilityRechargeMs ?? {}) },
    };
}

export function cloneShapes(shapes) {
    return shapes.map(cloneShape);
}

export function resetBotShape(shape) {
    const current = toSimulationBotShape(shape);
    const sandbox = String(current.combatLoadout).startsWith("sandbox:");
    const loadout = sandbox ? decodeSandboxLoadout(current.combatLoadout) : normalizedBotLoadout(current.loadout
        ?? (String(current.combatLoadout).startsWith("custom:") ? decodeBotLoadout(current.combatLoadout) : DEFAULT_BOT_LOADOUT));
    const abilities = abilitiesForLoadout(loadout);
    const stats = BASE_BOT_STATS;
    const startingHp = Math.max(0, Math.min(stats.maxHp, numberValue(current.startHp, stats.maxHp)));
    const reset = withoutBotStatuses({
        ...current,
        combatLoadout: sandbox ? current.combatLoadout : encodeBotLoadout(loadout),
        loadout,
        abilities,
        spawnX: current.spawnX ?? current.x,
        spawnY: current.spawnY ?? current.y,
        hp: startingHp,
        maxHp: stats.maxHp,
        moveSpeed: stats.moveSpeed,
        attackDamageMultiplier: stats.attackDamagePercent / 100,
        attackSpeedMultiplier: stats.attackSpeedPercent / 100,
        matchElapsedMs: 0,
        closingZoneDamageCount: 0,
        customVariables: {},
        abilityActiveMs: {},
        abilityCooldowns: Object.fromEntries(abilities.map((ability) => [ability, 0])),
        abilityPendingCooldownMs: {},
        abilityCharges: initialAbilityCharges(abilities, stats.maxHp),
        abilityRechargeMs: initialAbilityRechargeMs(abilities),
        abilityEntitySerial: 1,
        preparingAbility: null,
        preparingMs: 0,
        triggeredAbility: null,
        abilityVisual: null,
        movementVelocityX: 0,
        movementVelocityY: 0,
        velocityX: 0,
        velocityY: 0,
    });
    return toCanonicalBotShape({
        ...reset,
        abilityCharges: initialAbilityCharges(abilities, stats.maxHp),
    });
}

export function resetBotShapeToStartingConfiguration(shape, configuration = {}) {
    const current = toSimulationBotShape(shape);
    const setup = configuration ?? {};
    const startX = boundedNumber(setup.startX, current.x ?? BOT_CENTER_MIN_X, BOT_CENTER_MIN_X, BOT_CENTER_MAX_X);
    const startY = boundedNumber(setup.startY, current.y ?? BOT_CENTER_MIN_Y, BOT_CENTER_MIN_Y, BOT_CENTER_MAX_Y);
    const rotation = boundedNumber(setup.rotation, current.rotation ?? 0, -360, 360);
    const startHp = boundedNumber(setup.startHp, current.startHp ?? current.hp ?? BASE_BOT_HP, 1, BASE_BOT_HP);
    return resetBotShape({
        ...shape,
        x: startX,
        y: startY,
        rotation,
        startX,
        startY,
        startRotation: rotation,
        startHp,
        spawnX: startX,
        spawnY: startY,
    });
}

/** Converts the canonical bot shape into the flat view consumed by ECS systems. */
export function toSimulationBotShape(shape) {
    if (!isArenaBotShape(shape)) return shape;
    const {
        statusEffects: rawStatusEffects,
        ...rest
    } = shape;
    const health = shape.health ?? {};
    const stats = shape.stats ?? {};
    const transform = shape.transform ?? {};
    const position = transform.position ?? {};
    const velocity = transform.velocity ?? {};
    const movementVelocity = transform.movementVelocity ?? {};
    return {
        ...rest,
        hp: nonNegativeNumber(shape.hp ?? health.current, BASE_BOT_HP),
        maxHp: nonNegativeNumber(shape.maxHp ?? health.max, BASE_BOT_HP),
        damageTakenLastTick: nonNegativeNumber(shape.damageTakenLastTick ?? health.damageTakenLastTick, 0),
        damageTakenThisTick: nonNegativeNumber(shape.damageTakenThisTick ?? health.damageTakenThisTick, 0),
        hpNetChangeLastTick: numberValue(shape.hpNetChangeLastTick ?? health.netChangeLastTick, 0),
        pendingHealing: nonNegativeNumber(shape.pendingHealing ?? health.pendingHealing, 0),
        moveSpeed: shape.moveSpeed ?? stats.moveSpeed ?? 0,
        attackDamageMultiplier: shape.attackDamageMultiplier ?? stats.attackDamageMultiplier ?? 1,
        attackSpeedMultiplier: shape.attackSpeedMultiplier ?? stats.attackSpeedMultiplier ?? 1,
        x: shape.x ?? position.x ?? 0,
        y: shape.y ?? position.y ?? 0,
        size: shape.size ?? transform.size ?? 60,
        rotation: shape.rotation ?? transform.rotation ?? 0,
        velocityX: shape.velocityX ?? velocity.x ?? 0,
        velocityY: shape.velocityY ?? velocity.y ?? 0,
        movementVelocityX: shape.movementVelocityX ?? movementVelocity.x ?? 0,
        movementVelocityY: shape.movementVelocityY ?? movementVelocity.y ?? 0,
        statusEffects: (rawStatusEffects ?? []).map(normalizeStatusEffect).filter(Boolean),
    };
}

/** Converts a simulation bot back into the readable persistent arena shape. */
export function toCanonicalBotShape(shape) {
    if (!isArenaBotShape(shape)) return shape;
    const flat = toSimulationBotShape(shape);
    const {
        hp, maxHp, damageTakenLastTick, damageTakenThisTick, hpNetChangeLastTick, pendingHealing,
        moveSpeed, attackDamageMultiplier, attackSpeedMultiplier,
        x, y, size, rotation, velocityX, velocityY, movementVelocityX, movementVelocityY,
        temporalRewindMs, temporalRewindPulseMs, temporalRewindX, temporalRewindY, temporalRewindHp,
        temporalRewindVisualX, temporalRewindVisualY,
        ...rest
    } = flat;
    return {
        ...rest,
        health: {
            current: hp,
            max: maxHp,
            damageTakenLastTick,
            damageTakenThisTick,
            netChangeLastTick: hpNetChangeLastTick,
            pendingHealing,
        },
        stats: {
            ...(shape.stats ?? {}),
            moveSpeed,
            attackDamageMultiplier,
            attackSpeedMultiplier,
        },
        transform: {
            ...(shape.transform ?? {}),
            position: { x, y },
            rotation,
            size,
            velocity: { x: velocityX, y: velocityY },
            movementVelocity: { x: movementVelocityX, y: movementVelocityY },
        },
        temporalRewindMs,
        temporalRewindPulseMs,
        temporalRewindX,
        temporalRewindY,
        temporalRewindHp,
        temporalRewindVisualX,
        temporalRewindVisualY,
        statusEffects: statusEffectsFor(flat),
    };
}

export function mergeBotShapeUpdates(shape, updates) {
    return toCanonicalBotShape({ ...toSimulationBotShape(shape), ...updates });
}

function isArenaBotShape(shape) {
    return shape?.id === "main"
        || shape?.id === "opponent-model"
        || String(shape?.id ?? "").startsWith("bot-")
        || shape?.type === "circle"
        || shape?.type === "bot"
        || shape?.type === "opponentModel"
        || (shape?.slot != null && shape?.userId != null);
}

function numberValue(value, fallback) {
    const numeric = Number(value);
    return Number.isFinite(numeric) ? numeric : fallback;
}

function boundedNumber(value, fallback, min, max) {
    return Math.max(min, Math.min(max, numberValue(value, fallback)));
}

function nonNegativeNumber(value, fallback) {
    return Math.max(0, numberValue(value, fallback));
}

function isCanonicalBotShape(shape) {
    return Boolean(shape?.health && shape?.stats && shape?.transform && Array.isArray(shape?.statusEffects));
}

function abilitiesForLoadout(loadout) {
    return [...STANDARD_ABILITY_IDS, ...loadout.abilities];
}

function initialAbilityCharges(abilities, maxHp = BASE_BOT_STATS.maxHp) {
    return Object.fromEntries(abilities
        .filter((ability) => ABILITY_STATS[ability]?.maxCharges != null
            && ABILITY_STATS[ability].resourceModel !== "fixed")
        .map((ability) => [ability, abilityMaxCharges(ability, { maxHp })]));
}

function initialAbilityRechargeMs(abilities) {
    return Object.fromEntries(abilities
        .filter((ability) => ABILITY_STATS[ability]?.maxCharges != null
            && ABILITY_STATS[ability].resourceModel !== "fixed")
        .map((ability) => [ability, 0]));
}

export function buildAutoPlayStartShapes(currentShapes, matchContext, isMatchTesting) {
    const fallbackShapes = isMatchTesting ? buildMatchSpawnShapes(matchContext) : [];
    const fallbackMain = fallbackShapes.find((shape) => shape.id === "main");
    const nextShapes = cloneShapes(currentShapes).filter((shape) => !isClosingZone(shape));
    if (!nextShapes.some((shape) => shape.id === "main")) {
        nextShapes.unshift(resetBotShape(fallbackMain ?? { ...MAIN_SHAPE }));
    }
    return nextShapes;
}
