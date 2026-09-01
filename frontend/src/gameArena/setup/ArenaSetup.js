import { createDefaultAbilityStrategyConfiguration, normalizeAbilityStrategyConfiguration } from "../botlogic/code/BotCode.js";
import { tickClosingZoneWorld } from "../ecs/entities/ClosingZoneSystem.js";
import { decodeBotLoadout, decodeSandboxLoadout } from "../loadout/BotLoadout.js";
import {
    ARENA_HEIGHT_UNITS,
    ARENA_WIDTH_UNITS,
    BASE_BOT_HP,
    PRACTICE_OPPONENT_START,
    PRACTICE_PLAYER_START,
} from "../modelPayloads/arenaConstants.js";
import {
    buildInitialArenaShapes,
    buildOpponentShape,
    mergeBotShapeUpdates,
    resetBotShapeToStartingConfiguration,
} from "../modelPayloads/arenaShapes.js";
import { normalizePracticeConfig } from "../practiceRoomStorage.js";
import {
    PUZZLE_OPPONENT_TEAM,
    PUZZLE_PLAYER_TEAM,
    normalizePuzzleRoster,
    normalizePuzzleTeamSize,
    puzzleBotKey,
    puzzleBotRole,
    puzzleSimulationSlot,
} from "../../pages/puzzles/puzzleRoster.js";

export function defaultPuzzleBotStart(teamNumber) {
    const isPlayer = Number(teamNumber) === PUZZLE_PLAYER_TEAM;
    return {
        // Team members intentionally overlap their team's lead until the
        // author positions them. Their simulation slot still remains unique.
        startX: ARENA_WIDTH_UNITS / 2,
        startY: isPlayer ? PRACTICE_PLAYER_START.y : PRACTICE_OPPONENT_START.y,
        rotation: isPlayer ? PRACTICE_PLAYER_START.rotation : PRACTICE_OPPONENT_START.rotation,
    };
}

export function puzzleSetupBots(puzzleSetup, playerLoadout, opponentLoadout) {
    const source = Array.isArray(puzzleSetup?.bots)
        ? puzzleSetup.bots
        : [puzzleSetup?.playerBot, puzzleSetup?.opponentBot].filter(Boolean);
    const playerCount = source.filter((bot) => String(bot?.role ?? "").toUpperCase() === "PLAYER").length;
    const opponentCount = source.filter((bot) => String(bot?.role ?? "").toUpperCase() === "OPPONENT").length;
    const playerTeamSize = normalizePuzzleTeamSize(puzzleSetup?.playerTeamSize, playerCount || 1);
    const opponentTeamSize = normalizePuzzleTeamSize(puzzleSetup?.opponentTeamSize, opponentCount || 1);
    return normalizePuzzleRoster(source, playerTeamSize, opponentTeamSize, (teamNumber, slot, teamSize) => ({
        role: puzzleBotRole(teamNumber),
        teamNumber,
        slot,
        loadout: teamNumber === PUZZLE_PLAYER_TEAM ? playerLoadout : opponentLoadout,
        brain: createDefaultAbilityStrategyConfiguration(),
        ...defaultPuzzleBotStart(teamNumber, slot, teamSize),
        startHp: BASE_BOT_HP,
    }));
}

export function puzzleBotForSetup(puzzleSetup, teamNumber, slot = 1) {
    const source = Array.isArray(puzzleSetup?.bots)
        ? puzzleSetup.bots
        : [puzzleSetup?.playerBot, puzzleSetup?.opponentBot].filter(Boolean);
    const exact = source.find((bot) => Number(bot?.teamNumber) === Number(teamNumber)
        && Number(bot?.slot) === Number(slot));
    if (exact) return exact;
    const role = puzzleBotRole(teamNumber);
    return source.find((bot) => String(bot?.role ?? "").toUpperCase() === role)
        ?? (Number(teamNumber) === PUZZLE_PLAYER_TEAM ? puzzleSetup?.playerBot : puzzleSetup?.opponentBot)
        ?? null;
}

export function puzzleBotShapeKey(shape) {
    if (shape?.puzzleBotKey) return shape.puzzleBotKey;
    if (shape?.id === "main") return puzzleBotKey(PUZZLE_PLAYER_TEAM, 1);
    if (shape?.id === "opponent-model") return puzzleBotKey(PUZZLE_OPPONENT_TEAM, 1);
    return null;
}

export function puzzleCodeParticipantName(bot) {
    const teamNumber = Number(bot?.teamNumber);
    const slot = Number(bot?.slot) || 1;
    if (teamNumber === PUZZLE_PLAYER_TEAM && slot === 1) return "My Bot";
    return teamNumber === PUZZLE_PLAYER_TEAM ? `Teammate ${slot - 1}` : `Opponent ${slot}`;
}

export function practiceSetupForArena(
    config,
    playerLoadout,
    opponentLoadout,
    playerConfiguration,
    opponentConfiguration,
    botConfigurations = {},
) {
    const normalized = normalizePracticeConfig(config);
    return {
        ...normalized,
        bots: normalized.bots.map((bot) => {
            const key = puzzleBotKey(bot);
            const isPrimaryPlayer = key === puzzleBotKey(PUZZLE_PLAYER_TEAM, 1);
            const isPrimaryOpponent = key === puzzleBotKey(PUZZLE_OPPONENT_TEAM, 1);
            return {
                ...bot,
                loadout: isPrimaryPlayer ? playerLoadout : isPrimaryOpponent ? opponentLoadout : bot.loadout,
                brain: isPrimaryPlayer
                    ? playerConfiguration ?? createDefaultAbilityStrategyConfiguration()
                    : isPrimaryOpponent
                        ? opponentConfiguration ?? createDefaultAbilityStrategyConfiguration()
                        : botConfigurations[key] ?? createDefaultAbilityStrategyConfiguration(),
            };
        }),
    };
}

export function puzzleSetupForArena(config, initialPuzzle) {
    const normalized = normalizePracticeConfig(config);
    const sourceBots = Array.isArray(initialPuzzle?.bots) && initialPuzzle.bots.length > 0
        ? initialPuzzle.bots
        : [initialPuzzle?.playerBot, initialPuzzle?.opponentBot].filter(Boolean);
    const sourceByKey = new Map(sourceBots.map((bot) => [puzzleBotKey(bot), bot]));
    return {
        ...normalized,
        bots: normalized.bots.map((bot) => {
            const source = sourceByKey.get(puzzleBotKey(bot));
            return source?.brain == null ? bot : { ...bot, brain: source.brain };
        }),
    };
}

export function buildPracticeArenaShapes(playerLoadout, opponentLoadout, puzzleSetup = null, allowPuzzleBotEditing = false) {
    const loadoutForId = (loadout) => String(loadout).startsWith("sandbox:")
        ? decodeSandboxLoadout(loadout)
        : decodeBotLoadout(loadout);
    if (puzzleSetup) {
        const initialElapsedMs = Math.max(0, Number(puzzleSetup.initialElapsedMs) || 0);
        const bots = puzzleSetupBots(puzzleSetup, playerLoadout, opponentLoadout);
        const playerTeamSize = normalizePuzzleTeamSize(puzzleSetup.playerTeamSize, 1);
        const botShapes = bots.map((bot) => {
            const isPlayer = Number(bot.teamNumber) === PUZZLE_PLAYER_TEAM && Number(bot.slot) === 1;
            const isPrimaryOpponent = Number(bot.teamNumber) === PUZZLE_OPPONENT_TEAM && Number(bot.slot) === 1;
            const localSlot = Number(bot.slot) || 1;
            const simulationSlot = puzzleSimulationSlot(bot, localSlot, playerTeamSize);
            const id = isPlayer ? "main" : isPrimaryOpponent ? "opponent-model" : `bot-puzzle-${bot.teamNumber}-${bot.slot}`;
            const fallback = defaultPuzzleBotStart(bot.teamNumber, bot.slot, Number(bot.teamNumber) === PUZZLE_PLAYER_TEAM
                ? normalizePuzzleTeamSize(puzzleSetup.playerTeamSize)
                : normalizePuzzleTeamSize(puzzleSetup.opponentTeamSize));
            const startConfiguration = {
                startX: Number.isFinite(Number(bot.startX)) ? Number(bot.startX) : fallback.startX,
                startY: Number.isFinite(Number(bot.startY)) ? Number(bot.startY) : fallback.startY,
                rotation: Number.isFinite(Number(bot.rotation)) ? Number(bot.rotation) : fallback.rotation,
                startHp: Number.isFinite(Number(bot.startHp)) ? Number(bot.startHp) : BASE_BOT_HP,
            };
            const loadout = bot.loadout ?? (isPlayer ? playerLoadout : opponentLoadout);
            const baseShape = isPlayer
                ? buildInitialArenaShapes(null).find((shape) => shape.id === "main")
                : buildOpponentShape({ slot: simulationSlot, teamNumber: bot.teamNumber, selectedLoadout: loadout });
            const displayName = puzzleCodeParticipantName(bot);
            const configured = {
                ...baseShape,
                id,
                type: isPlayer ? "circle" : isPrimaryOpponent ? "opponentModel" : "bot",
                slot: simulationSlot,
                puzzleSlot: localSlot,
                teamNumber: Number(bot.teamNumber) || PUZZLE_PLAYER_TEAM,
                puzzleBotKey: puzzleBotKey(bot.teamNumber, localSlot),
                username: displayName,
                opponentUsername: displayName,
                combatLoadout: loadout,
                loadout: loadoutForId(loadout),
                strategyConfiguration: normalizeAbilityStrategyConfiguration(bot.brain ?? createDefaultAbilityStrategyConfiguration()),
                locked: !isPlayer && !allowPuzzleBotEditing,
            };
            const reset = resetBotShapeToStartingConfiguration(configured, startConfiguration);
            return initialElapsedMs > 0 ? mergeBotShapeUpdates(reset, { matchElapsedMs: initialElapsedMs }) : reset;
        });
        const initialClosingZone = buildInitialClosingZone(initialElapsedMs);
        return initialClosingZone ? [...botShapes, initialClosingZone] : botShapes;
    }
    const shapes = buildInitialArenaShapes(null);
    const initialElapsedMs = Math.max(0, Number(puzzleSetup?.initialElapsedMs) || 0);
    const playerStart = puzzleSetup?.playerBot ?? puzzleSetup?.playerStart ?? null;
    const opponentStart = puzzleSetup?.opponentBot ?? puzzleSetup?.opponentStart ?? null;
    const botShapes = shapes.map((shape) => {
        const loadout = shape.id === "main" ? playerLoadout : opponentLoadout;
        const start = shape.id === "main" ? playerStart : opponentStart;
        const fallback = shape.id === "main" ? PRACTICE_PLAYER_START : PRACTICE_OPPONENT_START;
        const startConfiguration = {
            startX: Number.isFinite(Number(start?.startX ?? start?.x)) ? Number(start.startX ?? start.x) : fallback.x,
            startY: Number.isFinite(Number(start?.startY ?? start?.y)) ? Number(start.startY ?? start.y) : fallback.y,
            rotation: Number.isFinite(Number(start?.rotation)) ? Number(start.rotation) : fallback.rotation,
            startHp: Number.isFinite(Number(start?.startHp)) ? Number(start.startHp) : BASE_BOT_HP,
        };
        const reset = resetBotShapeToStartingConfiguration({
            ...shape,
            combatLoadout: loadout,
            loadout: loadoutForId(loadout),
        }, startConfiguration);
        return initialElapsedMs > 0 ? mergeBotShapeUpdates(reset, { matchElapsedMs: initialElapsedMs }) : reset;
    });
    const initialClosingZone = buildInitialClosingZone(initialElapsedMs);
    return initialClosingZone ? [...botShapes, initialClosingZone] : botShapes;
}

export function buildInitialClosingZone(elapsedMs) {
    return tickClosingZoneWorld({
        zone: null,
        bots: [],
        elapsedMs,
        stepMs: 1,
        width: ARENA_WIDTH_UNITS,
        height: ARENA_HEIGHT_UNITS,
    }).zone;
}
