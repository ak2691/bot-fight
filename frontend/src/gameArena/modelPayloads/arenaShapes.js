import {
    BASE_BOT_HP,
} from "../../../../shared/engine/modelPayloads/arenaConstants.js";
import { initialAbilityState } from "../../../../shared/engine/gameconfig/AbilityResourceSystem.js";
import { cloneAbilityState } from "../../../../shared/engine/gameconfig/AbilityState.js";
import { BASE_BOT_STATS, DEFAULT_BOT_LOADOUT, STANDARD_ABILITY_IDS, decodeBotLoadout, decodeSandboxLoadout, encodeBotLoadout, normalizedBotLoadout } from "../../../../shared/engine/loadout/BotLoadout.js";
import { withoutBotStatuses } from "../../../../shared/engine/gameconfig/DefensiveState.js";
import { initialMovementState } from "../../../../shared/engine/gameconfig/StaminaSystem.js";
import { isClosingZone } from "../../../../shared/engine/ecs/entities/ClosingZoneSystem.js";
import { createBotState, isBotState } from "../../../../shared/engine/modelPayloads/botState.js";
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
} from "../../../../shared/engine/modelPayloads/arenaConstants.js";

export const MAIN_SHAPE = createBotState({
    id: "main",
    isCurrentUser: true,
    username: "Player",
    type: "circle",
    slot: 1,
    moveSpeed: BASE_BOT_STATS.moveSpeed,
    x: ARENA_WIDTH_UNITS / 2,
    y: ARENA_HEIGHT_UNITS / 2,
    rotation: 90,
    size: 60,
    combatLoadout: encodeBotLoadout(DEFAULT_BOT_LOADOUT),
    loadout: DEFAULT_BOT_LOADOUT,
    abilities: [...STANDARD_ABILITY_IDS],
    abilityState: initialAbilityState(STANDARD_ABILITY_IDS),
    abilityEntitySerial: 1,
    ...initialMovementState(),
});

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
    return createBotState({
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
        abilityState: initialAbilityState(abilities, stats.maxHp),
        abilityEntitySerial: 1,
        ...initialMovementState(),
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
        const frozen = frozenBotState(matchContext, participant);
        const spawned = resetBotShape({
            ...baseShape,
            id: shapeId,
            type: isPlayer ? "circle" : "bot",
            combatLoadout: loadoutId,
            loadout: loadoutObject(loadoutId),
            x: frozen?.x ?? position.x,
            y: frozen?.y ?? position.y,
            rotation: frozen?.rotation ?? position.rotation,
            slot: Number(participant.slot) || (isPlayer ? 1 : 2),
            teamNumber: teamNumberForParticipant(participant),
            isCurrentUser: isPlayer,
            userId: participant.userId ?? null,
            username: participant.username ?? (isPlayer ? "Player" : "Opponent"),
            opponentUsername: participant.username ?? (isPlayer ? "Player" : "Opponent"),
            locked: !isPlayer,
        });
        // Reset restores full HP and stamina; the frozen frame carries what the last segment left.
        return frozen
            ? { ...spawned, hp: frozen.hp, ...(frozen.stamina != null ? { stamina: frozen.stamina } : {}) }
            : spawned;
    });
}

/**
 * The end of the last segment, frozen: the building room starts from where each bot stood (position,
 * rotation, HP, stamina) instead of the spawn row. A non-authoritative preview; the server simulates
 * the real continuation. The preview opponent stays a stationary dummy because it runs no code.
 */
function frozenBotState(matchContext, participant) {
    const states = matchContext?.timedRounds?.segmentEndState;
    if (!Array.isArray(states)) return null;
    const state = states.find((bot) => Number(bot?.slot) === Number(participant?.slot));
    if (!state || !Number.isFinite(Number(state.x)) || !Number.isFinite(Number(state.y))) return null;
    const hp = Number(state.hp);
    return {
        x: Number(state.x),
        y: Number(state.y),
        rotation: Number.isFinite(Number(state.rotation)) ? Number(state.rotation) : null,
        hp: Number.isFinite(hp) ? Math.max(0, hp) : BASE_BOT_HP,
        stamina: Number.isFinite(Number(state.stamina)) ? Number(state.stamina) : undefined,
    };
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
    if (!isBotState(shape)) return { ...shape };
    return {
        ...shape,
        statusEffects: shape.statusEffects.map((effect) => ({ ...effect })),
        abilities: [...shape.abilities],
        abilityState: cloneAbilityState(shape.abilityState),
        abilityLastHitAgeMs: { ...shape.abilityLastHitAgeMs },
    };
}

export function cloneShapes(shapes) {
    return shapes.map(cloneShape);
}

export function resetBotShape(shape) {
    const sandbox = String(shape.combatLoadout).startsWith("sandbox:");
    const loadout = sandbox ? decodeSandboxLoadout(shape.combatLoadout) : normalizedBotLoadout(shape.loadout
        ?? (String(shape.combatLoadout).startsWith("custom:") ? decodeBotLoadout(shape.combatLoadout) : DEFAULT_BOT_LOADOUT));
    const abilities = abilitiesForLoadout(loadout);
    const stats = BASE_BOT_STATS;
    const startingHp = Math.max(0, Math.min(stats.maxHp, numberValue(shape.startHp ?? stats.maxHp, stats.maxHp)));
    const reset = withoutBotStatuses({
        ...shape,
        combatLoadout: sandbox ? shape.combatLoadout : encodeBotLoadout(loadout),
        loadout,
        abilities,
        spawnX: shape.spawnX ?? shape.x,
        spawnY: shape.spawnY ?? shape.y,
        hp: startingHp,
        maxHp: stats.maxHp,
        moveSpeed: stats.moveSpeed,
        attackDamageMultiplier: stats.attackDamagePercent / 100,
        attackSpeedMultiplier: stats.attackSpeedPercent / 100,
        matchElapsedMs: 0,
        closingZoneDamageCount: 0,
        customVariables: {},
        chainStack: [],
        runningChain: null,
        abilityLastHitAgeMs: {},
        abilityHitsThisTick: [],
        activationSerial: 0,
        refundedActivations: [],
        entityActivations: {},
        pendingStaminaRefund: 0,
        abilityState: initialAbilityState(abilities, stats.maxHp),
        abilityEntitySerial: 1,
        ...initialMovementState(),
        triggeredAbility: null,
        abilityVisual: null,
        movementVelocityX: 0,
        movementVelocityY: 0,
        velocityX: 0,
        velocityY: 0,
    });
    return createBotState(reset);
}

export function resetBotShapeToStartingConfiguration(shape, configuration = {}) {
    const setup = configuration ?? {};
    const startX = boundedNumber(setup.startX, shape.x ?? BOT_CENTER_MIN_X, BOT_CENTER_MIN_X, BOT_CENTER_MAX_X);
    const startY = boundedNumber(setup.startY, shape.y ?? BOT_CENTER_MIN_Y, BOT_CENTER_MIN_Y, BOT_CENTER_MAX_Y);
    const rotation = boundedNumber(setup.rotation, shape.rotation ?? 0, -360, 360);
    const startHp = boundedNumber(setup.startHp, shape.startHp ?? shape.hp ?? BASE_BOT_HP, 1, BASE_BOT_HP);
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

function numberValue(value, fallback) {
    const numeric = Number(value);
    return Number.isFinite(numeric) ? numeric : fallback;
}

function boundedNumber(value, fallback, min, max) {
    return Math.max(min, Math.min(max, numberValue(value, fallback)));
}

function abilitiesForLoadout(loadout) {
    return [...STANDARD_ABILITY_IDS, ...loadout.abilities];
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
