import { useState, useCallback, useEffect, useLayoutEffect, useMemo, useRef } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { monotonicEpochNowMs } from "../matchmaking/networkDelayEstimator.js";
import AppNavbar from "../components/AppNavbar";
import { useDialogFocus } from "../components/useDialogFocus.js";
import PixiCanvas from "./pixi/PixiCanvas.jsx";
import CodingPanel from "./coding/CodingPanel.jsx";
import { SELECTABLE_BOT_ABILITIES, decodeBotLoadout, decodeSandboxLoadout, encodeSandboxLoadout, normalizedSandboxLoadout } from "./loadout/BotLoadout.js";
import { getAbilityCatalogueIcon, getAbilityCatalogueIconLayout } from "../abilityCatalogueIcons.js";
import {
    BOT_CODE_SELECTABLES,
    createDefaultAbilityStrategyConfiguration,
    hasAbilityStrategyActions,
    inspectAbilityStrategyConditions,
    normalizeAbilityStrategyConfiguration,
} from "./botlogic/code/BotCode.js";
import { CODE_EDITOR_GRAPH_VERSION, sanitizeCodeEditorGraph } from "./botlogic/graph/CodeEditorGraph.js";
import { buildDeterministicLogicAction, idleAction } from "./botlogic/planner/ArenaActionPlanner.js";
import {
    buildBotSubmissionPayload,
    submitBotPayload
} from "./botlogic/submission/SubmissionClient.js";
import { isAbilityEntity, tickAbilityEntityWorld } from "./ecs/abilities/AbilityEntitySystem.js";
import { isProjectileEntity } from "./ecs/contracts/EntityContracts.js";
import { applyBotAction } from "./ecs/bots/ActionExecutionSystem.js";
import { overlapsEntity, tickProjectileWorld } from "./ecs/abilities/ProjectileSystem.js";
import {
    applyDamageFromShapes,
    applyDamageToShape,
    resolveTriggeredAbilityCombatForRoster,
    settlePendingHealing,
} from "./gameconfig/BotCombatSystem.js";
import { triggeredAbilityDamage } from "./ecs/abilities/AbilityEffectSystem.js";
import { abilityHitsTarget } from "./ecs/abilities/AbilityHitDetectionSystem.js";
import { isClosingZone, tickClosingZoneWorld } from "./ecs/entities/ClosingZoneSystem.js";
import {
    actionIdsForLoadoutConfiguration,
    DEFAULT_BOT_CONFIGURATION_ID,
} from "./gameconfig/CombatLoadouts.js";
import { normalizePracticeConfig, readPracticeRoomDraft, savePracticeRoomDraft } from "./practiceRoomStorage.js";
import { readPuzzleBotCodeDraft, savePuzzleBotCodeDraft } from "../puzzles/puzzleBotCodeStorage.js";
import {
    PUZZLE_OPPONENT_TEAM,
    PUZZLE_PLAYER_TEAM,
    normalizePuzzleRoster,
    normalizePuzzleTeamSize,
    puzzleBotKey,
    puzzleBotRole,
    puzzleSimulationSlot,
} from "../pages/puzzles/puzzleRoster.js";

import {
    AUTO_STEP_MS,
    ARENA_HEIGHT_UNITS,
    ARENA_WIDTH_UNITS,
    BASE_BOT_HP,
    BOT_CENTER_MAX_X,
    BOT_CENTER_MAX_Y,
    BOT_CENTER_MIN_X,
    BOT_CENTER_MIN_Y,
    PRACTICE_OPPONENT_START,
    PRACTICE_PLAYER_START,
} from "./modelPayloads/arenaConstants.js";
import {
    buildAutoPlayStartShapes,
    buildInitialArenaShapes,
    buildOpponentShape,
    cloneShape,
    mergeBotShapeUpdates,
    resetBotShape,
    resetBotShapeToStartingConfiguration,
    toCanonicalBotShape,
    toSimulationBotShape,
} from "./modelPayloads/arenaShapes.js";
import {
    buildAbilityTestingArenaShapes,
    buildAbilityTestingPracticeConfig,
    findAbilityTestingPreset,
} from "./testing/AbilityTestingPresets.js";
import { buildStatePayload } from "./modelPayloads/strategyStatePayload.js";
import {
    buildTutorialArenaShapes,
    getTutorialScenario,
    TUTORIAL_STEP_COUNT,
    TUTORIAL_ACTIONS,
    hasTutorialPriorityOrder,
} from "../tutorial/TutorialPresets.js";

function finalizeTickMeasurements(shape, before) {
    if (!shape) return shape;
    return {
        ...shape,
        damageTakenLastTick: Number(shape.damageTakenThisTick ?? 0),
        damageTakenThisTick: 0,
        hpNetChangeLastTick: Number(shape.hp ?? 0) - Number(before?.hp ?? shape.hp ?? 0),
    };
}

function matchStrategyConfigurationKey(matchId, userId, loadoutId) {
    return matchId && userId
        ? `arena-match-strategy-v1-${loadoutId}-${matchId}-${userId}`
        : `arena-testing-strategy-v1-${loadoutId}`;
}

function opponentStrategyConfigurationKey(matchId, userId, loadoutId) {
    return matchId && userId
        ? `arena-match-opponent-strategy-v1-${loadoutId}-${matchId}-${userId}`
        : `arena-testing-opponent-strategy-v1-${loadoutId}`;
}

function loadStoredStrategyConfiguration(key) {
    if (!key) return createDefaultAbilityStrategyConfiguration();
    try {
        const stored = localStorage.getItem(key);
        if (!stored) return createDefaultAbilityStrategyConfiguration();
        const parsed = JSON.parse(stored);
        const normalized = normalizeAbilityStrategyConfiguration(parsed);
        return parsed?.editorGraph?.version === CODE_EDITOR_GRAPH_VERSION
            ? { ...normalized, editorGraph: sanitizeCodeEditorGraph(parsed.editorGraph) }
            : normalized;
    } catch {
        return createDefaultAbilityStrategyConfiguration();
    }
}

// Tutorial drafts are reset when the logic payload changes. Old normalized
// drafts may already have converted retired condition IDs into the valid
// Time Since Start fallback, so they cannot be safely migrated by shape alone.
const TUTORIAL_STRATEGY_PREFIX = "arena-tutorial-strategy-v2-";
const TUTORIAL_COMPLETION_PREFIX = "arena-tutorial-completion-v2-";
const TUTORIAL_SOLUTION_PREFIX = "arena-tutorial-solution-v2-";
const TUTORIAL_CHALLENGE_VERSION_PREFIX = "arena-tutorial-challenge-v2-";
const RESET_TUTORIAL_CHALLENGE_IDS = new Set(["rotate", "lock-on", "dodge"]);

function tutorialStrategyConfigurationKey(step) {
    return `${TUTORIAL_STRATEGY_PREFIX}${getTutorialScenario(step).id ?? step}`;
}

function loadTutorialStrategyConfiguration(step, fallback) {
    const key = tutorialStrategyConfigurationKey(step);
    try {
        return localStorage.getItem(key) ? loadStoredStrategyConfiguration(key) : fallback;
    } catch {
        return fallback;
    }
}

function tutorialBooleanStateKey(prefix, step) {
    return `${prefix}${getTutorialScenario(step).id ?? step}`;
}

function tutorialChallengeVersionKey(step) {
    return `${TUTORIAL_CHALLENGE_VERSION_PREFIX}${getTutorialScenario(step).id ?? step}`;
}

function loadTutorialBooleanState(prefix, step) {
    try {
        const scenario = getTutorialScenario(step);
        if (prefix === TUTORIAL_COMPLETION_PREFIX
            && RESET_TUTORIAL_CHALLENGE_IDS.has(scenario.id)
            && localStorage.getItem(tutorialChallengeVersionKey(step)) !== "true") return false;
        const currentValue = localStorage.getItem(tutorialBooleanStateKey(prefix, step));
        return currentValue === "true";
    } catch {
        return false;
    }
}

function saveTutorialBooleanState(prefix, step, value) {
    try {
        localStorage.setItem(tutorialBooleanStateKey(prefix, step), String(Boolean(value)));
        if (prefix === TUTORIAL_COMPLETION_PREFIX && RESET_TUTORIAL_CHALLENGE_IDS.has(getTutorialScenario(step).id)) {
            localStorage.setItem(tutorialChallengeVersionKey(step), "true");
        }
    } catch {
        // Tutorial memory is best-effort when browser storage is unavailable.
    }
}

function tutorialChallengeForScenario(step, scenario) {
    const completed = loadTutorialBooleanState(TUTORIAL_COMPLETION_PREFIX, step);
    return {
        status: "idle",
        remainingMs: scenario.durationMs ?? 0,
        code: "ready",
        completed,
        initialRunComplete: scenario.id === "priority" ? completed : false,
    };
}

function isSimulationBotShape(shape) {
    return shape?.id === "main"
        || shape?.id === "opponent-model"
        || shape?.type === "circle"
        || shape?.type === "bot"
        || shape?.type === "botModel"
        || shape?.type === "opponentModel"
        || (shape?.slot != null && shape?.userId != null && shape?.abilityId == null);
}

const STRATEGY_STORAGE_PREFIXES = Object.freeze([
    "arena-testing-strategy-v1-",
    "arena-testing-opponent-strategy-v1-",
    "arena-match-strategy-v1-",
    "arena-match-opponent-strategy-v1-",
]);
const MAX_STORED_STRATEGY_BYTES = 750_000;

function saveStoredStrategyConfiguration(key, configuration) {
    if (!key) return false;
    const serialized = JSON.stringify(configuration);
    if (serialized.length * 2 > MAX_STORED_STRATEGY_BYTES) {
        console.warn("[arena-logic] Strategy draft is too large to persist safely.");
        return false;
    }
    try {
        localStorage.setItem(key, serialized);
        return true;
    } catch (error) {
        if (!isStorageQuotaError(error)) throw error;
    }

    removeStaleStrategyDrafts(key);
    try {
        localStorage.setItem(key, serialized);
        return true;
    } catch (error) {
        if (!isStorageQuotaError(error)) throw error;
        console.warn("[arena-logic] Browser storage is full; the current code remains available in memory but was not persisted.");
        return false;
    }
}

function removeStaleStrategyDrafts(activeKey) {
    const staleKeys = [];
    const counterpartKey = activeKey.includes("-opponent-strategy-")
        ? activeKey.replace("-opponent-strategy-", "-strategy-")
        : activeKey.replace("-strategy-", "-opponent-strategy-");
    for (let index = 0; index < localStorage.length; index += 1) {
        const candidate = localStorage.key(index);
        if (candidate && candidate !== activeKey && candidate !== counterpartKey
            && STRATEGY_STORAGE_PREFIXES.some((prefix) => candidate.startsWith(prefix))) {
            staleKeys.push(candidate);
        }
    }
    staleKeys.forEach((key) => localStorage.removeItem(key));
}

function isStorageQuotaError(error) {
    return error?.name === "QuotaExceededError"
        || error?.name === "NS_ERROR_DOM_QUOTA_REACHED"
        || error?.code === 22
        || error?.code === 1014;
}

function sanitizeStrategyConfigurationForLoadout(configuration, loadoutId) {
    const sourceConfiguration = configuration && typeof configuration === "object"
        ? configuration
        : createDefaultAbilityStrategyConfiguration();
    const source = normalizeAbilityStrategyConfiguration(sourceConfiguration);
    const allowedActionIds = new Set(actionIdsForLoadoutConfiguration(loadoutId));
    const sanitizeAction = (action) => {
        if (!action || typeof action !== "object") return action;
        const actionId = allowedActionIds.has(action.action) ? action.action : "none";
        return {
            ...action,
            action: actionId,
            selectable: actionId === "none" ? BOT_CODE_SELECTABLES.OPPONENT : action.selectable,
        };
    };
    const sanitizeBlock = (block) => {
        if (!block || typeof block !== "object") return block;
        return {
            ...block,
            ...sanitizeAction(block),
            ...(Array.isArray(block.actions) ? { actions: block.actions.map(sanitizeAction) } : {}),
            ...(Array.isArray(block.children) ? { children: block.children.map(sanitizeBlock) } : {}),
        };
    };
    return {
        ...source,
        roots: Array.isArray(source.roots) ? source.roots.map((root) => ({
            ...root,
            branches: Array.isArray(root?.branches) ? root.branches.map(sanitizeBlock) : [],
        })) : [],
    };
}

function secondsRemaining(targetTime) {
    if (!targetTime) return null;
    const targetMs = typeof targetTime === "number"
        ? targetTime
        : new Date(targetTime).getTime();
    if (!Number.isFinite(targetMs)) return null;
    return Math.max(0, Math.ceil((targetMs - monotonicEpochNowMs()) / 1000));
}

const AUTO_FINISH_SAFETY_BUFFER_MS = 500;

function applyActionToShape(shape, action, elapsedMs) {
    return applyBotAction(shape, action, elapsedMs, applyDamageToShape);
}

function defaultPuzzleBotStart(teamNumber) {
    const isPlayer = Number(teamNumber) === PUZZLE_PLAYER_TEAM;
    return {
        // Team members intentionally overlap their team's lead until the
        // author positions them. Their simulation slot still remains unique.
        startX: ARENA_WIDTH_UNITS / 2,
        startY: isPlayer ? PRACTICE_PLAYER_START.y : PRACTICE_OPPONENT_START.y,
        rotation: isPlayer ? PRACTICE_PLAYER_START.rotation : PRACTICE_OPPONENT_START.rotation,
    };
}

function puzzleSetupBots(puzzleSetup, playerLoadout, opponentLoadout) {
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

function puzzleBotForSetup(puzzleSetup, teamNumber, slot = 1) {
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

function puzzleBotShapeKey(shape) {
    if (shape?.puzzleBotKey) return shape.puzzleBotKey;
    if (shape?.id === "main") return puzzleBotKey(PUZZLE_PLAYER_TEAM, 1);
    if (shape?.id === "opponent-model") return puzzleBotKey(PUZZLE_OPPONENT_TEAM, 1);
    return null;
}

function puzzleCodeParticipantName(bot) {
    const teamNumber = Number(bot?.teamNumber);
    const slot = Number(bot?.slot) || 1;
    if (teamNumber === PUZZLE_PLAYER_TEAM && slot === 1) return "My Bot";
    return teamNumber === PUZZLE_PLAYER_TEAM ? `Teammate ${slot - 1}` : `Opponent ${slot}`;
}

function loadoutDraftForEntry(entry) {
    const supplied = entry?.loadout;
    if (supplied && typeof supplied === "object") return normalizedSandboxLoadout(supplied);
    const encoded = String(supplied ?? "");
    const source = encoded.startsWith("sandbox:")
        ? decodeSandboxLoadout(encoded)
        : decodeBotLoadout(encoded);
    return normalizedSandboxLoadout(source);
}

function loadoutDraftsForRoster(roster) {
    return Object.fromEntries((roster ?? []).map((entry) => [entry.key, loadoutDraftForEntry(entry)]));
}

function abilityDisplayTag(tag) {
    return String(tag ?? "")
        .replaceAll("-", " ")
        .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function SandboxAbilityCard({ ability, selected, onToggle }) {
    const iconPath = getAbilityCatalogueIcon(ability.id);
    return (
        <button
            type="button"
            aria-pressed={selected}
            aria-label={`${selected ? "Unequip" : "Equip"} ${ability.label}`}
            onClick={() => onToggle(ability.id)}
            className={`gray-button-surface ability-card ability-card-${ability.round} group relative min-h-52 w-full overflow-hidden rounded-none border p-0 text-left focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-green-200 ${selected
                ? "-translate-y-1 cursor-pointer border-green-400 bg-green-950/25 shadow-[0_8px_24px_rgba(114,182,93,0.12)] ring-2 ring-green-300/75 ring-offset-2 ring-offset-[#171a1c] hover:border-green-300"
                : "cursor-pointer border-slate-700/75 bg-[#202427]/85 hover:border-green-700 hover:bg-green-950/15"
            }`}
        >
            {iconPath && (
                <img
                    src={iconPath}
                    alt=""
                    aria-hidden="true"
                    className={`ability-card-art ability-card-art-${getAbilityCatalogueIconLayout(ability.id)}`}
                    onError={(event) => {
                        event.currentTarget.hidden = true;
                    }}
                />
            )}
            <span className="ability-card-gradient" aria-hidden="true" />
            <span className="absolute right-4 top-2 font-display-action text-6xl text-white/[.035]" aria-hidden="true">
                {String(ability.id).padStart(2, "0")}
            </span>
            <span className="ability-card-content absolute inset-x-0 bottom-0 border-t border-white/10 px-5 py-4">
                {selected && <span className="mb-1 block font-mono text-[9px] font-bold tracking-[.2em] text-green-200">EQUIPPED</span>}
                <span className="block font-display-action text-xl uppercase tracking-wider text-white">{ability.label}</span>
                <span className="mt-2 flex flex-wrap gap-1.5">
                    <span className="font-mono text-[8px] font-bold tracking-[.16em] text-green-300/70">{ability.kind.toUpperCase()}</span>
                    {(ability.catalogueTags ?? []).map((tag) => (
                        <span key={tag} className="border border-green-400/40 px-1.5 py-0.5 font-mono text-[8px] font-bold uppercase tracking-[.12em] text-green-300/80">
                            {abilityDisplayTag(tag)}
                        </span>
                    ))}
                </span>
            </span>
        </button>
    );
}

function practiceSetupForArena(
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

function buildPracticeArenaShapes(playerLoadout, opponentLoadout, puzzleSetup = null, allowPuzzleBotEditing = false) {
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

function buildInitialClosingZone(elapsedMs) {
    return tickClosingZoneWorld({
        zone: null,
        bots: [],
        elapsedMs,
        stepMs: 1,
        width: ARENA_WIDTH_UNITS,
        height: ARENA_HEIGHT_UNITS,
    }).zone;
}

export default function Arena({
    matchContext = null,
    finishStatus = null,
    finishError = null,
    onFinishMatch = null,
    onSurrenderMatch = null,
    onExit = null,
    tutorialMode = false,
    puzzleBuilder = false,
    puzzleMode = false,
    initialPuzzle = null,
    puzzleNumber = null,
    puzzleCodeOverride = null,
    arenaInfo = null,
    onPuzzleDraftChange = null,
    builderControls = null,
    puzzleControls = null,
    onOpenPuzzleSubmissions = null,
    onPuzzleOutcome = null,
    onPuzzleAttempt = null,
    logicLimits = null,
}) {
    const navigate = useNavigate();
    const location = useLocation();
    const isPracticeRoom = location.pathname === "/practice";

    useLayoutEffect(() => {
        if (typeof window !== "undefined") window.scrollTo(0, 0);
    }, [location.pathname]);

    const isPuzzleBuilder = Boolean(puzzleBuilder);
    const isPuzzleMode = Boolean(puzzleMode);
    const usesPuzzleSetup = isPuzzleBuilder || isPuzzleMode;
    const [storedPracticeRoom] = useState(() => isPracticeRoom ? readPracticeRoomDraft() : null);
    const initialTutorialStep = Math.max(0, Math.min(TUTORIAL_STEP_COUNT - 1, Number(location.state?.tutorialStep) || 0));
    const initialTutorialScenario = getTutorialScenario(initialTutorialStep);
    const catalogueAbilityId = isPracticeRoom
        ? new URLSearchParams(location.search).get("ability")
        : null;
    const catalogueAbilityTestingPreset = findAbilityTestingPreset(catalogueAbilityId);
    const isAbilityTesting = Boolean(catalogueAbilityTestingPreset?.id);
    const [practiceConfig, setPracticeConfig] = useState(() => isAbilityTesting
        ? buildAbilityTestingPracticeConfig(catalogueAbilityTestingPreset)
        : normalizePracticeConfig(storedPracticeRoom?.config));
    const matchId = matchContext?.matchId;
    const matchUserId = matchContext?.player?.userId;
    const isMatchTesting = Boolean(matchId && matchUserId);
    const abilityInfoEnabled = isPracticeRoom || isPuzzleMode || isPuzzleBuilder || (isMatchTesting && finishStatus === "BUILDING");
    const allowBotRotation = isPracticeRoom || isPuzzleBuilder || (isMatchTesting && finishStatus === "BUILDING");
    const allowLockedBotEditing = isPuzzleMode || (isMatchTesting && finishStatus === "BUILDING");
    // Tutorial, practice, puzzle, and live-match arenas share the same
    // responsive shell. The tutorial used to opt out of the fixed-layout
    // breakpoints, which made its toolbar and status panels disappear at
    // different widths from the regular arena.
    const usesArenaResponsiveLimits = true;
    const [selectedLoadout, setSelectedLoadout] = useState(() => tutorialMode
        ? initialTutorialScenario.playerLoadout
        : isAbilityTesting ? catalogueAbilityTestingPreset.playerLoadout
        : usesPuzzleSetup ? puzzleBotForSetup(initialPuzzle, PUZZLE_PLAYER_TEAM)?.loadout ?? DEFAULT_BOT_CONFIGURATION_ID
            : isPracticeRoom ? storedPracticeRoom?.player?.loadout ?? DEFAULT_BOT_CONFIGURATION_ID
            : matchContext?.player?.selectedLoadout ?? DEFAULT_BOT_CONFIGURATION_ID);
    const [opponentLoadout, setOpponentLoadout] = useState(() => tutorialMode
        ? initialTutorialScenario.opponentLoadout
        : isAbilityTesting ? catalogueAbilityTestingPreset.opponentLoadout
            : usesPuzzleSetup ? puzzleBotForSetup(initialPuzzle, PUZZLE_OPPONENT_TEAM)?.loadout ?? DEFAULT_BOT_CONFIGURATION_ID
            : isPracticeRoom ? storedPracticeRoom?.opponent?.loadout ?? DEFAULT_BOT_CONFIGURATION_ID
            : matchContext?.opponent?.selectedLoadout ?? DEFAULT_BOT_CONFIGURATION_ID);
    const strategyStorageKey = matchStrategyConfigurationKey(matchId, matchUserId, selectedLoadout);
    const opponentStrategyStorageKey = opponentStrategyConfigurationKey(matchId, matchUserId, opponentLoadout);
    const [shapes, setShapes] = useState(() => tutorialMode
        ? buildTutorialArenaShapes(initialTutorialStep)
        : isAbilityTesting ? buildAbilityTestingArenaShapes(catalogueAbilityTestingPreset)
            : usesPuzzleSetup ? buildPracticeArenaShapes(
                puzzleBotForSetup(initialPuzzle, PUZZLE_PLAYER_TEAM)?.loadout ?? DEFAULT_BOT_CONFIGURATION_ID,
                puzzleBotForSetup(initialPuzzle, PUZZLE_OPPONENT_TEAM)?.loadout ?? DEFAULT_BOT_CONFIGURATION_ID,
                initialPuzzle,
                isPuzzleBuilder,
            )
            : isPracticeRoom ? buildPracticeArenaShapes(
                selectedLoadout,
                opponentLoadout,
                practiceSetupForArena(
                    storedPracticeRoom?.config,
                    selectedLoadout,
                    opponentLoadout,
                    storedPracticeRoom?.player?.code,
                    storedPracticeRoom?.opponent?.code,
                ),
                true,
            )
            : buildInitialArenaShapes(matchContext));
    const loggedTrainingEntityIdsRef = useRef(null);
    const loggedTrainingConditionStateRef = useRef(null);

    useEffect(() => {
        if (isMatchTesting || tutorialMode) return;
        const entities = shapes.filter((shape) => !isSimulationBotShape(shape));
        const entityIds = entities.map((entity) => String(entity.id)).sort().join("|");
        if (loggedTrainingEntityIdsRef.current === entityIds) return;
        loggedTrainingEntityIdsRef.current = entityIds;
        console.log("[Training room entities]", {
            count: entities.length,
            entities: entities.map((entity) => ({
                id: entity.id,
                type: entity.type,
                abilityId: entity.abilityId ?? null,
                ownerId: entity.ownerId ?? null,
                ownerSlot: entity.ownerSlot ?? null,
                remainingMs: entity.remainingMs ?? null,
            })),
        });
    }, [isMatchTesting, shapes, tutorialMode]);
    const [selectedId, setSelectedId] = useState(null);
    const [submitStatus, setSubmitStatus] = useState(null);
    const [isAutoPlaying, setIsAutoPlaying] = useState(false);
    const [isPuzzleAttemptSubmitting, setIsPuzzleAttemptSubmitting] = useState(false);
    const [measurementEnabled, setMeasurementEnabled] = useState(false);
    const [measurementPoints, setMeasurementPoints] = useState([]);
    const [isBaseTesting] = useState(false);
    const [isEditingArena, setIsEditingArena] = useState(true);
    const [testingConfiguration, setTestingConfiguration] = useState(() => sanitizeStrategyConfigurationForLoadout(
        tutorialMode ? loadTutorialStrategyConfiguration(initialTutorialStep, initialTutorialScenario.emptyCode) : isAbilityTesting ? catalogueAbilityTestingPreset.playerCode : matchContext?.roundBrains?.at(-1)?.brain
            ?? (isPuzzleMode
                ? puzzleCodeOverride ?? readPuzzleBotCodeDraft(puzzleNumber, puzzleBotForSetup(initialPuzzle, PUZZLE_PLAYER_TEAM)?.brain ?? createDefaultAbilityStrategyConfiguration())
                : usesPuzzleSetup ? puzzleBotForSetup(initialPuzzle, PUZZLE_PLAYER_TEAM)?.brain ?? createDefaultAbilityStrategyConfiguration() : isPracticeRoom ? storedPracticeRoom?.player?.code ?? loadStoredStrategyConfiguration(strategyStorageKey) : loadStoredStrategyConfiguration(strategyStorageKey)),
        selectedLoadout,
    ));
    const [opponentTestingConfiguration, setOpponentTestingConfiguration] = useState(() => sanitizeStrategyConfigurationForLoadout(
        tutorialMode
            ? initialTutorialScenario.opponentCode
            : isAbilityTesting ? catalogueAbilityTestingPreset.opponentCode : isPracticeRoom
                ? storedPracticeRoom?.opponent?.code ?? loadStoredStrategyConfiguration(opponentStrategyStorageKey)
                : usesPuzzleSetup ? puzzleBotForSetup(initialPuzzle, PUZZLE_OPPONENT_TEAM)?.brain ?? createDefaultAbilityStrategyConfiguration()
                : loadStoredStrategyConfiguration(opponentStrategyStorageKey),
        opponentLoadout,
    ));
    const [sandboxCodeCopies, setSandboxCodeCopies] = useState({});
    const [practiceBotConfigurations, setPracticeBotConfigurations] = useState({});

    useEffect(() => {
        const registerResponder = matchContext?.registerCodeViewResponder;
        if (!isMatchTesting || typeof registerResponder !== "function") return undefined;
        registerResponder(() => ({
            brain: testingConfiguration,
            selectedLoadout,
        }));
        return () => registerResponder(null);
    }, [isMatchTesting, matchContext?.registerCodeViewResponder, selectedLoadout, testingConfiguration]);

    const [isFinishingMatch, setIsFinishingMatch] = useState(false);
    const [testingRemaining, setTestingRemaining] = useState(() =>
        secondsRemaining(matchContext?.buildingEndsAtMs ?? matchContext?.buildingEndsAt));
    const [sandboxLoadoutTarget, setSandboxLoadoutTarget] = useState(null);
    const [sandboxLoadoutDrafts, setSandboxLoadoutDrafts] = useState({});
    const [sandboxLoadoutSearch, setSandboxLoadoutSearch] = useState("");
    const closeSandboxLoadout = useCallback(() => {
        setSandboxLoadoutTarget(null);
        setSandboxLoadoutDrafts({});
        setSandboxLoadoutSearch("");
    }, []);
    const sandboxDialogRef = useRef(null);
    useDialogFocus(sandboxDialogRef, {
        onClose: closeSandboxLoadout,
        lockScroll: true,
        enabled: Boolean(sandboxLoadoutTarget),
    });
    const [isPracticeConfigOpen, setIsPracticeConfigOpen] = useState(false);
    const [tutorialStep, setTutorialStep] = useState(initialTutorialStep);
    const [tutorialInfoHost, setTutorialInfoHost] = useState(null);
    const [solutionShown, setSolutionShown] = useState(() => tutorialMode
        ? loadTutorialBooleanState(TUTORIAL_SOLUTION_PREFIX, initialTutorialStep)
        : false);
    const [tutorialChallenge, setTutorialChallenge] = useState(() => tutorialChallengeForScenario(initialTutorialStep, initialTutorialScenario));

    const autoIntervalRef = useRef(null);
    const handleFinishMatchRef = useRef(null);
    const autoFinishDeadlineRef = useRef(null);
    const finishInFlightRef = useRef(false);
    const tutorialRunRef = useRef(null);
    const puzzleAttemptIdRef = useRef(0);
    const tutorialResetTimerRef = useRef(null);
    const tutorialScenario = getTutorialScenario(tutorialStep);
    const initialPuzzleElapsedMs = Math.max(0, Number(initialPuzzle?.initialElapsedMs) || 0);
    const puzzleSetupRoster = useMemo(
        () => puzzleSetupBots(initialPuzzle, selectedLoadout, opponentLoadout),
        [initialPuzzle, opponentLoadout, selectedLoadout],
    );
    const puzzleSetupRosterKey = useMemo(() => JSON.stringify(puzzleSetupRoster), [puzzleSetupRoster]);
    const practiceArenaSetup = useMemo(
        () => isPracticeRoom
            ? practiceSetupForArena(
                practiceConfig,
                selectedLoadout,
                opponentLoadout,
                testingConfiguration,
                opponentTestingConfiguration,
                practiceBotConfigurations,
            )
            : null,
        [isPracticeRoom, opponentLoadout, opponentTestingConfiguration, practiceBotConfigurations, practiceConfig, selectedLoadout, testingConfiguration],
    );
    const practiceSetupRoster = useMemo(
        () => practiceArenaSetup ? puzzleSetupBots(practiceArenaSetup, selectedLoadout, opponentLoadout) : [],
        [opponentLoadout, practiceArenaSetup, selectedLoadout],
    );
    const arenaSelectableParticipants = useMemo(() => {
        if (tutorialMode) {
            return [
                { userId: "tutorial-player", username: "My Bot", slot: 1, teamNumber: PUZZLE_PLAYER_TEAM, selectedLoadout },
                { userId: "tutorial-opponent", username: "Opponent 1", slot: 2, teamNumber: PUZZLE_OPPONENT_TEAM, selectedLoadout: opponentLoadout },
            ];
        }
        if (!isPuzzleMode) return null;
        return puzzleSetupRoster.map((bot) => {
            const key = puzzleBotKey(bot);
            const isPrimaryPlayer = key === puzzleBotKey(PUZZLE_PLAYER_TEAM, 1);
            const isPrimaryOpponent = key === puzzleBotKey(PUZZLE_OPPONENT_TEAM, 1);
            return {
                ...bot,
                userId: bot.userId ?? `puzzle-selectable-${key}`,
                username: puzzleCodeParticipantName(bot),
                selectedLoadout: isPrimaryPlayer ? selectedLoadout : isPrimaryOpponent ? opponentLoadout : bot.loadout,
            };
        });
    }, [isPuzzleMode, opponentLoadout, puzzleSetupRoster, selectedLoadout, tutorialMode]);
    const puzzleCodeRoster = useMemo(() => {
        if (!isPuzzleBuilder) return null;
        return puzzleSetupRoster.map((bot) => {
            const key = puzzleBotKey(bot);
            const isPrimaryPlayer = key === puzzleBotKey(PUZZLE_PLAYER_TEAM, 1);
            const isPrimaryOpponent = key === puzzleBotKey(PUZZLE_OPPONENT_TEAM, 1);
            const selectedLoadoutForCode = isPrimaryPlayer
                ? selectedLoadout
                : isPrimaryOpponent ? opponentLoadout : bot.loadout;
            const configuration = isPrimaryPlayer
                ? testingConfiguration
                : isPrimaryOpponent
                    ? opponentTestingConfiguration
                    : bot.brain;
            return {
                ...bot,
                userId: `puzzle-code-${bot.teamNumber}-${bot.slot}`,
                username: puzzleCodeParticipantName(bot),
                selectedLoadout: selectedLoadoutForCode,
                configuration: sanitizeStrategyConfigurationForLoadout(
                    configuration ?? createDefaultAbilityStrategyConfiguration(),
                    selectedLoadoutForCode,
                ),
                codeKey: isPrimaryPlayer ? "player" : isPrimaryOpponent ? "opponent" : null,
                puzzleRosterKey: key,
            };
        });
    }, [isPuzzleBuilder, opponentLoadout, opponentTestingConfiguration, puzzleSetupRoster, selectedLoadout, testingConfiguration]);

    const practiceCodeRoster = useMemo(() => {
        if (!isPracticeRoom) return null;
        return practiceSetupRoster.map((bot) => {
            const key = puzzleBotKey(bot);
            const isPrimaryPlayer = key === puzzleBotKey(PUZZLE_PLAYER_TEAM, 1);
            const isPrimaryOpponent = key === puzzleBotKey(PUZZLE_OPPONENT_TEAM, 1);
            const selectedLoadoutForCode = isPrimaryPlayer
                ? selectedLoadout
                : isPrimaryOpponent ? opponentLoadout : bot.loadout;
            const configuration = isPrimaryPlayer
                ? testingConfiguration
                : isPrimaryOpponent
                    ? opponentTestingConfiguration
                    : practiceBotConfigurations[key] ?? bot.brain;
            return {
                ...bot,
                userId: `practice-code-${bot.teamNumber}-${bot.slot}`,
                username: puzzleCodeParticipantName(bot),
                selectedLoadout: selectedLoadoutForCode,
                configuration: sanitizeStrategyConfigurationForLoadout(
                    configuration ?? createDefaultAbilityStrategyConfiguration(),
                    selectedLoadoutForCode,
                ),
                codeKey: isPrimaryPlayer ? "player" : isPrimaryOpponent ? "opponent" : null,
                puzzleRosterKey: key,
            };
        });
    }, [isPracticeRoom, opponentLoadout, opponentTestingConfiguration, practiceBotConfigurations, practiceSetupRoster, selectedLoadout, testingConfiguration]);

    const loadoutEditorRoster = useMemo(() => {
        if (isPuzzleBuilder) {
            return puzzleSetupRoster.map((bot) => {
                const key = puzzleBotKey(bot);
                const isPrimaryPlayer = key === puzzleBotKey(PUZZLE_PLAYER_TEAM, 1);
                const isPrimaryOpponent = key === puzzleBotKey(PUZZLE_OPPONENT_TEAM, 1);
                return {
                    key,
                    role: isPrimaryPlayer ? "player" : isPrimaryOpponent ? "opponent" : "puzzle-bot",
                    shapeId: isPrimaryPlayer ? "main" : isPrimaryOpponent ? "opponent-model" : `bot-puzzle-${bot.teamNumber}-${bot.slot}`,
                    teamNumber: bot.teamNumber,
                    slot: bot.slot,
                    username: puzzleCodeParticipantName(bot),
                    loadout: isPrimaryPlayer ? selectedLoadout : isPrimaryOpponent ? opponentLoadout : bot.loadout,
                    configuration: isPrimaryPlayer ? testingConfiguration : isPrimaryOpponent ? opponentTestingConfiguration : bot.brain,
                };
            });
        }
        if (isPracticeRoom) {
            return practiceSetupRoster.map((bot) => {
                const key = puzzleBotKey(bot);
                const isPrimaryPlayer = key === puzzleBotKey(PUZZLE_PLAYER_TEAM, 1);
                const isPrimaryOpponent = key === puzzleBotKey(PUZZLE_OPPONENT_TEAM, 1);
                return {
                    key,
                    role: isPrimaryPlayer ? "player" : isPrimaryOpponent ? "opponent" : "practice-bot",
                    shapeId: isPrimaryPlayer ? "main" : isPrimaryOpponent ? "opponent-model" : `bot-puzzle-${bot.teamNumber}-${bot.slot}`,
                    teamNumber: bot.teamNumber,
                    slot: bot.slot,
                    username: puzzleCodeParticipantName(bot),
                    loadout: isPrimaryPlayer ? selectedLoadout : isPrimaryOpponent ? opponentLoadout : bot.loadout,
                    configuration: isPrimaryPlayer ? testingConfiguration : isPrimaryOpponent ? opponentTestingConfiguration : practiceBotConfigurations[key] ?? bot.brain,
                };
            });
        }
        return [];
    }, [isPracticeRoom, isPuzzleBuilder, opponentLoadout, opponentTestingConfiguration, practiceBotConfigurations, practiceSetupRoster, puzzleSetupRoster, selectedLoadout, testingConfiguration]);
    const activeLoadoutEntry = loadoutEditorRoster.find((entry) => entry.key === sandboxLoadoutTarget) ?? null;
    const activeLoadoutIndex = activeLoadoutEntry
        ? loadoutEditorRoster.findIndex((entry) => entry.key === activeLoadoutEntry.key)
        : -1;
    const activeSandboxLoadout = activeLoadoutEntry
        ? sandboxLoadoutDrafts[activeLoadoutEntry.key] ?? loadoutDraftForEntry(activeLoadoutEntry)
        : normalizedSandboxLoadout(null);
    const normalizedSandboxLoadoutSearch = sandboxLoadoutSearch.trim().toLowerCase();
    const visibleSandboxAbilities = SELECTABLE_BOT_ABILITIES.filter((ability) => (
        ability.label.toLowerCase().includes(normalizedSandboxLoadoutSearch)
    ));

    const handleOfflineCodeChange = useCallback((participantId, configuration) => {
        const roster = isPuzzleBuilder ? puzzleCodeRoster : isPracticeRoom ? practiceCodeRoster : null;
        const participant = roster?.find((entry) => String(entry.userId) === String(participantId));
        if (!participant) return;
        const normalized = sanitizeStrategyConfigurationForLoadout(
            configuration ?? createDefaultAbilityStrategyConfiguration(),
            participant.selectedLoadout,
        );
        if (isPuzzleBuilder) {
            if (!onPuzzleDraftChange || participant.puzzleRosterKey === puzzleBotKey(PUZZLE_PLAYER_TEAM, 1)) return;
            onPuzzleDraftChange({
                bots: puzzleSetupRoster.map((bot) => (
                    puzzleBotKey(bot) === participant.puzzleRosterKey
                        ? { ...bot, brain: normalized }
                        : bot
                )),
            });
            return;
        }
        if (isPracticeRoom && participant.puzzleRosterKey !== puzzleBotKey(PUZZLE_PLAYER_TEAM, 1)) {
            setPracticeBotConfigurations((current) => ({
                ...current,
                [participant.puzzleRosterKey]: normalized,
            }));
        }
    }, [isPracticeRoom, isPuzzleBuilder, onPuzzleDraftChange, practiceCodeRoster, puzzleCodeRoster, puzzleSetupRoster]);

    useEffect(() => {
        if (!isPuzzleBuilder || !onPuzzleDraftChange || isAutoPlaying) return;
        const configuredBots = puzzleSetupRoster;
        const nextBots = configuredBots.map((bot) => {
            const key = puzzleBotKey(bot);
            if (key === puzzleBotKey(PUZZLE_PLAYER_TEAM, 1)) {
                return { ...bot, loadout: selectedLoadout, brain: testingConfiguration };
            }
            if (key === puzzleBotKey(PUZZLE_OPPONENT_TEAM, 1)) {
                return { ...bot, loadout: opponentLoadout, brain: opponentTestingConfiguration };
            }
            return bot;
        });
        if (JSON.stringify(nextBots) === puzzleSetupRosterKey) return;
        // Starting stats are authoring inputs. Runtime movement, damage, and
        // rotation must remain preview state and never overwrite the draft.
        onPuzzleDraftChange({
            bots: nextBots,
            playerBot: {
                loadout: selectedLoadout,
                brain: testingConfiguration,
            },
            opponentBot: {
                loadout: opponentLoadout,
                brain: opponentTestingConfiguration,
            },
        });
    }, [initialPuzzle, isAutoPlaying, isPuzzleBuilder, onPuzzleDraftChange, opponentLoadout, opponentTestingConfiguration, puzzleSetupRoster, puzzleSetupRosterKey, selectedLoadout, testingConfiguration]);

    useEffect(() => () => {
        if (autoIntervalRef.current) {
            clearInterval(autoIntervalRef.current);
            autoIntervalRef.current = null;
        }
        if (tutorialResetTimerRef.current) {
            clearTimeout(tutorialResetTimerRef.current);
            tutorialResetTimerRef.current = null;
        }
    }, []);

    const releaseTutorialArenaFreeze = useCallback(() => {
        if (tutorialResetTimerRef.current) clearTimeout(tutorialResetTimerRef.current);
        setIsAutoPlaying(true);
        tutorialResetTimerRef.current = window.setTimeout(() => {
            tutorialResetTimerRef.current = null;
            setIsAutoPlaying(false);
        }, 100);
    }, []);

    useEffect(() => {
        if (!tutorialMode) return;
        if (autoIntervalRef.current) {
            clearInterval(autoIntervalRef.current);
            autoIntervalRef.current = null;
        }
        tutorialRunRef.current = null;
        const scenario = getTutorialScenario(tutorialStep);
        const lessonShapes = buildTutorialArenaShapes(tutorialStep);
        // This effect resets the external tutorial arena when the lesson changes.
        // eslint-disable-next-line react-hooks/set-state-in-effect
        setIsAutoPlaying(false);
        setIsEditingArena(true);
        setSelectedId(null);
        setSelectedLoadout(scenario.playerLoadout);
        setOpponentLoadout(scenario.opponentLoadout);
        setTestingConfiguration(sanitizeStrategyConfigurationForLoadout(loadTutorialStrategyConfiguration(tutorialStep, scenario.emptyCode), scenario.playerLoadout));
        setOpponentTestingConfiguration(sanitizeStrategyConfigurationForLoadout(scenario.opponentCode, scenario.opponentLoadout));
        setShapes(lessonShapes);
        releaseTutorialArenaFreeze();
        setSolutionShown(loadTutorialBooleanState(TUTORIAL_SOLUTION_PREFIX, tutorialStep));
        setTutorialChallenge(tutorialChallengeForScenario(tutorialStep, scenario));
    }, [releaseTutorialArenaFreeze, tutorialMode, tutorialStep]);

    useEffect(() => {
        if (!isAbilityTesting || !catalogueAbilityTestingPreset) return;
        if (autoIntervalRef.current) {
            clearInterval(autoIntervalRef.current);
            autoIntervalRef.current = null;
        }
        // This effect resets the external ability-testing arena when the preset changes.
        // eslint-disable-next-line react-hooks/set-state-in-effect
        setIsAutoPlaying(false);
        setIsEditingArena(true);
        setSelectedId(null);
        setSelectedLoadout(catalogueAbilityTestingPreset.playerLoadout);
        setOpponentLoadout(catalogueAbilityTestingPreset.opponentLoadout);
        setTestingConfiguration(sanitizeStrategyConfigurationForLoadout(catalogueAbilityTestingPreset.playerCode, catalogueAbilityTestingPreset.playerLoadout));
        setOpponentTestingConfiguration(sanitizeStrategyConfigurationForLoadout(catalogueAbilityTestingPreset.opponentCode, catalogueAbilityTestingPreset.opponentLoadout));
        // Keep Practice Config as the reset baseline for this catalogue preset.
        setPracticeConfig(buildAbilityTestingPracticeConfig(catalogueAbilityTestingPreset));
        setShapes(buildAbilityTestingArenaShapes(catalogueAbilityTestingPreset));
    }, [catalogueAbilityTestingPreset, isAbilityTesting]);

    useEffect(() => {
        // Live matches already spawn the complete authoritative roster in
        // buildMatchSpawnShapes. The legacy opponent-model fallback is only
        // for practice/puzzle rooms; appending it to a 2v2 would duplicate
        // the first opposing participant in the arena.
        if (matchContext?.matchId || !matchContext?.opponent) return;
        const timeoutId = window.setTimeout(() => {
            setShapes((prev) => {
                if (prev.some((shape) => shape.type === "opponentModel")) {
                    return prev.map((shape) => shape.type === "opponentModel"
                        ? {
                            ...shape,
                            ...resetBotShape({
                                ...shape,
                                combatLoadout: matchContext.opponent.selectedLoadout ?? shape.combatLoadout,
                                loadout: matchContext.opponentLoadout,
                            }),
                            username: matchContext.opponent.username,
                            opponentUsername: matchContext.opponent.username,
                        }
                        : shape);
                }
                return [...prev, buildOpponentShape(matchContext.opponent)];
            });
        }, 0);
        return () => window.clearTimeout(timeoutId);
    }, [matchContext?.matchId, matchContext?.opponent, matchContext?.opponentLoadout]);

    const updateTestingConfiguration = (configuration) => {
        const sanitized = sanitizeStrategyConfigurationForLoadout(configuration, selectedLoadout);
        setTestingConfiguration(sanitized);
        if (isPuzzleMode) {
            savePuzzleBotCodeDraft(puzzleNumber, sanitized);
        } else if (!isPuzzleBuilder) {
            saveStoredStrategyConfiguration(strategyStorageKey, sanitized);
        }
        if (isPracticeRoom) {
            savePracticeRoomDraft({
                player: { loadout: selectedLoadout, code: sanitized },
                opponent: { loadout: opponentLoadout, code: opponentTestingConfiguration },
            });
        }
        if (tutorialMode) saveStoredStrategyConfiguration(tutorialStrategyConfigurationKey(tutorialStep), sanitized);
    };

    const updateOpponentTestingConfiguration = (configuration) => {
        const sanitized = sanitizeStrategyConfigurationForLoadout(configuration, opponentLoadout);
        setOpponentTestingConfiguration(sanitized);
        if (!isPuzzleBuilder) saveStoredStrategyConfiguration(opponentStrategyStorageKey, sanitized);
        if (isPracticeRoom) {
            savePracticeRoomDraft({
                player: { loadout: selectedLoadout, code: testingConfiguration },
                opponent: { loadout: opponentLoadout, code: sanitized },
            });
        }
    };

    const updateSandboxParticipantConfiguration = useCallback((userId, configuration) => {
        const key = String(userId ?? "");
        if (!key) return;
        const participants = Array.isArray(matchContext?.players) && matchContext.players.length > 0
            ? matchContext.players
            : [matchContext?.player, matchContext?.opponent].filter(Boolean);
        const participant = participants.find((candidate) => String(candidate?.userId) === key);
        setSandboxCodeCopies((current) => {
            const copy = current[key] ?? {
                configuration: createDefaultAbilityStrategyConfiguration(),
                selectedLoadout: participant?.selectedLoadout ?? DEFAULT_BOT_CONFIGURATION_ID,
            };
            return {
                ...current,
                [key]: {
                    ...copy,
                    configuration: sanitizeStrategyConfigurationForLoadout(
                        configuration ?? copy.configuration,
                        copy.selectedLoadout,
                    ),
                },
            };
        });
    }, [matchContext]);

    const openSandboxLoadout = (targetKey = null) => {
        if (isMatchTesting || isAutoPlaying) return;
        const target = loadoutEditorRoster.find((entry) => entry.key === targetKey)
            ?? loadoutEditorRoster[0];
        if (!target) return;
        setSandboxLoadoutDrafts(loadoutDraftsForRoster(loadoutEditorRoster));
        setSandboxLoadoutSearch("");
        setSandboxLoadoutTarget(target.key);
    };

    const cycleSandboxLoadout = (direction) => {
        if (loadoutEditorRoster.length < 2) return;
        const currentIndex = activeLoadoutIndex >= 0 ? activeLoadoutIndex : 0;
        const nextIndex = (currentIndex + direction + loadoutEditorRoster.length) % loadoutEditorRoster.length;
        const next = loadoutEditorRoster[nextIndex];
        setSandboxLoadoutTarget(next.key);
    };

    const toggleSandboxLoadoutAbility = (abilityId) => {
        if (!activeLoadoutEntry) return;
        setSandboxLoadoutDrafts((current) => {
            const currentDraft = current[activeLoadoutEntry.key] ?? loadoutDraftForEntry(activeLoadoutEntry);
            const selected = currentDraft.abilities.includes(abilityId);
            return {
                ...current,
                [activeLoadoutEntry.key]: normalizedSandboxLoadout({
                    ...currentDraft,
                    abilities: selected
                        ? currentDraft.abilities.filter((id) => id !== abilityId)
                        : [...currentDraft.abilities, abilityId],
                }),
            };
        });
    };

    const applySandboxLoadouts = () => {
        if (!activeLoadoutEntry) {
            closeSandboxLoadout();
            return;
        }
        const updates = loadoutEditorRoster.map((entry) => {
            const draft = sandboxLoadoutDrafts[entry.key] ?? loadoutDraftForEntry(entry);
            const encoded = encodeSandboxLoadout(draft);
            return {
                ...entry,
                encoded,
                nextConfiguration: sanitizeStrategyConfigurationForLoadout(entry.configuration, encoded),
            };
        });
        const updatesByKey = new Map(updates.map((entry) => [entry.key, entry]));
        const playerUpdate = updates.find((entry) => entry.role === "player");
        const opponentUpdate = updates.find((entry) => entry.role === "opponent");

        if (playerUpdate) {
            setSelectedLoadout(playerUpdate.encoded);
            setTestingConfiguration(playerUpdate.nextConfiguration);
        }
        if (opponentUpdate) {
            setOpponentLoadout(opponentUpdate.encoded);
            setOpponentTestingConfiguration(opponentUpdate.nextConfiguration);
        }
        if (isPuzzleBuilder) {
            const puzzleDraftChanges = {
                bots: puzzleSetupRoster.map((bot) => {
                    const update = updatesByKey.get(puzzleBotKey(bot));
                    return update
                        ? { ...bot, loadout: update.encoded, brain: update.nextConfiguration }
                        : bot;
                }),
                ...(playerUpdate ? {
                    playerBot: { loadout: playerUpdate.encoded, brain: playerUpdate.nextConfiguration },
                } : {}),
                ...(opponentUpdate ? {
                    opponentBot: { loadout: opponentUpdate.encoded, brain: opponentUpdate.nextConfiguration },
                } : {}),
            };
            onPuzzleDraftChange?.(puzzleDraftChanges);
        }

        if (isPracticeRoom) {
            const currentPracticeConfig = normalizePracticeConfig(practiceConfig);
            const nextPracticeConfig = normalizePracticeConfig({
                ...currentPracticeConfig,
                bots: currentPracticeConfig.bots.map((bot) => {
                    const update = updatesByKey.get(puzzleBotKey(bot));
                    return update ? { ...bot, loadout: update.encoded } : bot;
                }),
            });
            const practiceConfigurationUpdates = updates
                .filter((entry) => entry.role === "practice-bot")
                .reduce((result, entry) => ({
                    ...result,
                    [entry.key]: entry.nextConfiguration,
                }), {});
            setPracticeConfig(nextPracticeConfig);
            if (Object.keys(practiceConfigurationUpdates).length > 0) {
                setPracticeBotConfigurations((current) => ({
                    ...current,
                    ...practiceConfigurationUpdates,
                }));
            }
            savePracticeRoomDraft({
                config: nextPracticeConfig,
                player: {
                    loadout: playerUpdate?.encoded ?? selectedLoadout,
                    code: playerUpdate?.nextConfiguration ?? testingConfiguration,
                },
                opponent: {
                    loadout: opponentUpdate?.encoded ?? opponentLoadout,
                    code: opponentUpdate?.nextConfiguration ?? opponentTestingConfiguration,
                },
            });
        }

        setShapes((current) => current.map((shape) => {
            const update = updates.find((entry) => entry.shapeId === shape.id);
            return update
                ? resetBotShape({ ...shape, combatLoadout: update.encoded, strategyConfiguration: update.nextConfiguration })
                : shape;
        }));
        closeSandboxLoadout();
    };

    const savePracticeConfig = (nextConfig) => {
        if (!isPracticeRoom || isMatchTesting || isAutoPlaying) return;
        const normalized = normalizePracticeConfig(nextConfig);
        setPracticeConfig(normalized);
        setSelectedId(null);
        setShapes(buildPracticeArenaShapes(
            selectedLoadout,
            opponentLoadout,
            practiceSetupForArena(
                normalized,
                selectedLoadout,
                opponentLoadout,
                testingConfiguration,
                opponentTestingConfiguration,
                practiceBotConfigurations,
            ),
            true,
        ));
        savePracticeRoomDraft({
            config: normalized,
            player: { loadout: selectedLoadout, code: testingConfiguration },
            opponent: { loadout: opponentLoadout, code: opponentTestingConfiguration },
        });
        setIsPracticeConfigOpen(false);
        setSubmitStatus({ ok: true, message: "Practice configuration saved." });
        setTimeout(() => setSubmitStatus(null), 2500);
    };

    const handleUpdateShape = useCallback((id, updates) => {
        setShapes((previous) => previous.map((shape) => (
            shape.id === id && (!shape.locked || allowLockedBotEditing)
                ? mergeBotShapeUpdates(shape, updates)
                : shape
        )));
    }, [allowLockedBotEditing]);

    const playerSetup = puzzleBotForSetup(initialPuzzle, PUZZLE_PLAYER_TEAM);
    const opponentSetup = puzzleBotForSetup(initialPuzzle, PUZZLE_OPPONENT_TEAM);
    const playerStartX = playerSetup?.startX;
    const playerStartY = playerSetup?.startY;
    const playerRotation = playerSetup?.rotation;
    const opponentStartX = opponentSetup?.startX;
    const opponentStartY = opponentSetup?.startY;
    const opponentRotation = opponentSetup?.rotation;
    const playerStartHp = playerSetup?.startHp;
    const opponentStartHp = opponentSetup?.startHp;
    const puzzleSetupKey = JSON.stringify([
        initialPuzzleElapsedMs,
        ...puzzleSetupRoster.map((bot) => [
            bot.teamNumber,
            bot.slot,
            bot.startX,
            bot.startY,
            bot.rotation,
            bot.startHp,
        ]),
    ]);
    const previousPuzzleSetupKeyRef = useRef(null);

    useEffect(() => {
        if (!isPuzzleBuilder || isAutoPlaying) return;
        if (previousPuzzleSetupKeyRef.current === puzzleSetupKey) return;
        previousPuzzleSetupKeyRef.current = puzzleSetupKey;
        const freshBotShapes = buildPracticeArenaShapes(selectedLoadout, opponentLoadout, initialPuzzle, isPuzzleBuilder)
            .filter(isSimulationBotShape);
        const freshShapesByKey = new Map(freshBotShapes
            .map((shape) => [puzzleBotShapeKey(shape), shape])
            .filter(([key]) => key));
        const activeKeys = new Set(freshShapesByKey.keys());
        const setupByKey = Object.fromEntries(puzzleSetupRoster.map((bot) => [puzzleBotKey(bot), {
            startX: bot.startX,
            startY: bot.startY,
            rotation: bot.rotation,
            startHp: bot.startHp,
        }]));
        const setupById = {
            main: { startX: playerStartX, startY: playerStartY, rotation: playerRotation, startHp: playerStartHp },
            "opponent-model": { startX: opponentStartX, startY: opponentStartY, rotation: opponentRotation, startHp: opponentStartHp },
        };
        // Synchronize the editable puzzle canvas with its external initial-puzzle inputs.
        // eslint-disable-next-line react-hooks/set-state-in-effect
        setShapes((previous) => {
            let changed = false;
            const existingKeys = new Set();
            const next = previous
                .filter((shape) => !isClosingZone(shape))
                .filter((shape) => {
                    const key = puzzleBotShapeKey(shape);
                    if (!key || activeKeys.has(key)) return true;
                    changed = true;
                    return false;
                })
                .map((shape) => {
                    const key = puzzleBotShapeKey(shape);
                    if (key) existingKeys.add(key);
                    const setup = setupByKey[key] ?? setupById[shape.id];
                    if (!setup) return shape;
                    const x = Number(setup.startX);
                    const y = Number(setup.startY);
                    const rotation = Number(setup.rotation);
                    const current = toSimulationBotShape(shape);
                    const startHp = Number.isFinite(Number(setup.startHp))
                        ? Math.max(1, Math.min(BASE_BOT_HP, Number(setup.startHp)))
                        : Number(current.maxHp ?? BASE_BOT_HP);
                    if (![x, y, rotation, startHp].every(Number.isFinite)) return shape;
                    const elapsedChanged = Number(current.matchElapsedMs ?? 0) !== initialPuzzleElapsedMs;
                    if (current.x === x && current.y === y && current.rotation === rotation && current.hp === startHp && !elapsedChanged) return shape;
                    changed = true;
                    return mergeBotShapeUpdates(shape, {
                        x,
                        y,
                        rotation,
                        hp: startHp,
                        startX: x,
                        startY: y,
                        startRotation: rotation,
                        startHp,
                        matchElapsedMs: initialPuzzleElapsedMs,
                        ...(isPuzzleBuilder ? { spawnX: x, spawnY: y } : {}),
                    });
                });
            freshShapesByKey.forEach((shape, key) => {
                if (existingKeys.has(key)) return;
                changed = true;
                next.push(shape);
            });
            const previousZone = previous.find((shape) => isClosingZone(shape));
            const nextZone = buildInitialClosingZone(initialPuzzleElapsedMs);
            const zoneChanged = Boolean(previousZone) !== Boolean(nextZone)
                || previousZone?.size !== nextZone?.size
                || previousZone?.safeRadius !== nextZone?.safeRadius
                || previousZone?.activeElapsedMs !== nextZone?.activeElapsedMs
                || previousZone?.geometryElapsedMs !== nextZone?.geometryElapsedMs;
            if (!changed && !zoneChanged) return previous;
            return nextZone ? [...next, nextZone] : next;
        });
    }, [initialPuzzle, initialPuzzleElapsedMs, isAutoPlaying, isPuzzleBuilder, opponentLoadout, opponentRotation, opponentStartHp, opponentStartX, opponentStartY, playerRotation, playerStartHp, playerStartX, playerStartY, puzzleSetupKey, puzzleSetupRoster, selectedLoadout]);

    useEffect(() => {
        if ((!isPuzzleBuilder && !isPracticeRoom) || isAutoPlaying) return;
        const configuredBots = isPuzzleBuilder ? puzzleSetupRoster : practiceSetupRoster;
        const configurationsByKey = new Map(configuredBots.map((bot) => [
            puzzleBotKey(bot),
            normalizeAbilityStrategyConfiguration(bot.brain ?? createDefaultAbilityStrategyConfiguration()),
        ]));
        // Keep non-primary simulation brains in step with the shared code
        // workspace without replacing their live preview transforms.
        // eslint-disable-next-line react-hooks/set-state-in-effect
        setShapes((previous) => {
            let changed = false;
            const next = previous.map((shape) => {
                const key = puzzleBotShapeKey(shape);
                const configuration = configurationsByKey.get(key);
                if (!configuration
                    || key === puzzleBotKey(PUZZLE_PLAYER_TEAM, 1)
                    || key === puzzleBotKey(PUZZLE_OPPONENT_TEAM, 1)) return shape;
                const current = toSimulationBotShape(shape).strategyConfiguration;
                if (JSON.stringify(current) === JSON.stringify(configuration)) return shape;
                changed = true;
                return mergeBotShapeUpdates(shape, { strategyConfiguration: configuration });
            });
            return changed ? next : previous;
        });
    }, [isAutoPlaying, isPracticeRoom, isPuzzleBuilder, practiceSetupRoster, puzzleSetupRoster]);

    const handleDeleteSelectedShape = useCallback(() => {
        setShapes((prev) => {
            const selected = prev.find((shape) => shape.id === selectedId);
            if (!isEditingArena || !selected || selected.id === "main" || selected.locked) return prev;
            setSelectedId(null);
            return prev.filter((shape) => shape.id !== selected.id);
        });
    }, [isEditingArena, selectedId]);

    useEffect(() => {
        const handleKeyDown = (event) => {
            if (event.key !== "Delete" && event.key !== "Backspace") return;
            if (event.target?.closest?.("input,select,textarea,button")) return;
            const selected = shapes.find((shape) => shape.id === selectedId);
            if (!selected || selected.id === "main" || selected.locked || !isEditingArena) return;
            event.preventDefault();
            handleDeleteSelectedShape();
        };

        window.addEventListener("keydown", handleKeyDown);
        return () => window.removeEventListener("keydown", handleKeyDown);
    }, [handleDeleteSelectedShape, isEditingArena, selectedId, shapes]);

    const submitPuzzleAttempt = () => {
        if (!isPuzzleMode || !onPuzzleAttempt || isPuzzleAttemptSubmitting) return;
        const attemptId = puzzleAttemptIdRef.current + 1;
        puzzleAttemptIdRef.current = attemptId;
        const brain = normalizeAbilityStrategyConfiguration(
            sanitizeStrategyConfigurationForLoadout(testingConfiguration, selectedLoadout),
        );
        onPuzzleOutcome?.(null);
        stopAutoPlay();
        setIsPuzzleAttemptSubmitting(true);
        setSubmitStatus({ ok: null, message: "Submitting puzzle for server simulation..." });
        Promise.resolve(onPuzzleAttempt({ brain }))
            .then((result) => {
                if (!result || attemptId !== puzzleAttemptIdRef.current) return;
                stopAutoPlay();
                setIsEditingArena(false);
                setSubmitStatus({
                    ok: result.status === "solved",
                    message: result.message ?? (result.status === "solved" ? "PUZZLE SOLVED" : "PUZZLE FAILED"),
                });
            })
            .catch((error) => {
                if (attemptId !== puzzleAttemptIdRef.current) return;
                stopAutoPlay();
                setIsEditingArena(false);
                setSubmitStatus({ ok: false, message: error.message ?? "Puzzle simulation failed." });
            })
            .finally(() => {
                if (attemptId === puzzleAttemptIdRef.current) setIsPuzzleAttemptSubmitting(false);
            });
    };

    const runAutoPlay = () => {
        if (isAutoPlaying) return;
        if (isPuzzleMode) onPuzzleOutcome?.(null);
        const customVariableGoal = tutorialMode && tutorialScenario.goal === "custom_variable";
        const customVariable = customVariableGoal
            ? (testingConfiguration.customVariables ?? []).find((variable) => (
                variable?.valueType === "number"
                && String(variable?.name ?? "").trim() === "Variable 1"
            ))
            : null;
        const priorityGoal = tutorialMode && tutorialScenario.goal === "priority";
        const priorityStage = priorityGoal && tutorialChallenge?.initialRunComplete ? "final" : "initial";
        const priorityOrderCorrect = !priorityGoal
            || (priorityStage === "initial"
                ? hasTutorialPriorityOrder(testingConfiguration, TUTORIAL_ACTIONS.DASH, TUTORIAL_ACTIONS.LOCK_ON)
                : hasTutorialPriorityOrder(testingConfiguration, TUTORIAL_ACTIONS.LOCK_ON, TUTORIAL_ACTIONS.DASH));
        setIsEditingArena(false);
        setIsAutoPlaying(true);
        setSelectedId(null);
        if (tutorialMode) {
            const freshShapes = buildTutorialArenaShapes(tutorialStep);
            const main = toSimulationBotShape(freshShapes.find((shape) => shape.id === "main"));
            const opponent = toSimulationBotShape(freshShapes.find((shape) => shape.id === "opponent-model"));
            tutorialRunRef.current = tutorialScenario.durationMs ? {
                deadline: monotonicEpochNowMs() + tutorialScenario.durationMs,
                durationMs: tutorialScenario.durationMs,
                goal: tutorialScenario.goal,
                playerHp: main.hp,
                opponentHp: opponent.hp,
                customVariableId: customVariable?.id ?? null,
                customVariableStartValue: Number(customVariable?.initialValue ?? 0),
                priorityStage,
                priorityOrderCorrect,
            } : null;
            if (!tutorialScenario.durationMs) {
                saveTutorialBooleanState(TUTORIAL_COMPLETION_PREFIX, tutorialStep, true);
            }
            setTutorialChallenge((current) => ({
                ...current,
                status: tutorialScenario.durationMs ? "running" : "idle",
                remainingMs: tutorialScenario.durationMs ?? 0,
                completed: current.completed || !tutorialScenario.durationMs,
                code: tutorialScenario.durationMs ? "reading_code" : "demonstration_running",
            }));
            setShapes(freshShapes);
        } else if (isPuzzleMode) {
            const freshShapes = buildPracticeArenaShapes(selectedLoadout, opponentLoadout, initialPuzzle);
            setShapes(freshShapes);
        } else if (isPracticeRoom) {
            // Practice playback starts from the current arena state. Reset
            // Stats is the explicit action that reinitializes positions and
            // combat state; pressing Play must not silently do that again.
        } else {
            setShapes((prevShapes) => buildAutoPlayStartShapes(prevShapes, matchContext, isMatchTesting));
        }

        autoIntervalRef.current = setInterval(() => {
            setShapes((prevShapes) => {
                const stateSnapshot = buildStatePayload(prevShapes, selectedLoadout);
                if (!isMatchTesting && !tutorialMode) {
                    const conditionInspections = inspectAbilityStrategyConditions(testingConfiguration, stateSnapshot);
                    const conditionState = JSON.stringify(conditionInspections);
                    if (loggedTrainingConditionStateRef.current !== conditionState) {
                        loggedTrainingConditionStateRef.current = conditionState;
                        console.log("[Training room player conditions]", {
                            payload: {
                                abilities: stateSnapshot.playerModel?.abilities ?? [],
                                abilityActiveMs: stateSnapshot.playerModel?.abilityActiveMs ?? {},
                                abilityCooldowns: stateSnapshot.playerModel?.abilityCooldowns ?? {},
                            },
                            conditions: conditionInspections,
                        });
                    }
                }
                const botBefores = prevShapes
                    .filter(isSimulationBotShape)
                    .map(toSimulationBotShape);
                const mainBefore = botBefores.find((bot) => bot.id === "main") ?? null;
                const botsAfterActions = botBefores.map((bot) => {
                    const configuration = bot.id === "main"
                        ? testingConfiguration
                        : bot.id === "opponent-model"
                            ? opponentTestingConfiguration
                            : bot.strategyConfiguration;
                    const botLoadout = bot.id === "main"
                        ? selectedLoadout
                        : bot.id === "opponent-model"
                            ? opponentLoadout
                            : bot.combatLoadout;
                    const action = configuration
                        && (bot.id === "main" || hasAbilityStrategyActions(configuration))
                        ? buildDeterministicLogicAction(
                            configuration,
                            bot.id === "main" ? stateSnapshot : buildStatePayload(prevShapes, botLoadout, bot.id),
                        )
                        : idleAction();
                    return {
                        ...applyActionToShape({ ...bot, lastPredictedAction: action }, action, AUTO_STEP_MS),
                        customVariables: action.customVariables,
                    };
                });
                const spawnedEntities = botsAfterActions.map((bot) => bot.abilitySpawn).filter(Boolean);
                let projectileEntities = [...prevShapes.filter(isProjectileEntity)];
                let abilityEntities = [...prevShapes.filter(isAbilityEntity)];
                const previousClosingZone = prevShapes.find(isClosingZone) ?? null;
                projectileEntities.push(...spawnedEntities.filter(isProjectileEntity));
                abilityEntities.push(...spawnedEntities.filter(isAbilityEntity));
                let activeBots = botsAfterActions.map((bot) => ({ ...bot, abilitySpawn: null }));
                activeBots = resolveTriggeredAbilityCombatForRoster(activeBots);
                const projectileUpdate = tickProjectileWorld({
                    bots: activeBots,
                    entities: projectileEntities,
                    stepMs: AUTO_STEP_MS,
                    width: ARENA_WIDTH_UNITS,
                    height: ARENA_HEIGHT_UNITS,
                }, { applyDamageToShape, applyDamageFromShapes });
                const grenadeExploded = (projectileUpdate.grenadeExplosions ?? []).some((explosion) => explosion.ownerId === "opponent-model");
                activeBots = projectileUpdate.bots;
                projectileEntities = projectileUpdate.entities;
                abilityEntities.push(...projectileUpdate.spawnedEntities);
                const entityUpdate = tickAbilityEntityWorld({
                    entities: abilityEntities,
                    projectiles: projectileEntities,
                    bots: activeBots,
                    stepMs: AUTO_STEP_MS,
                    width: ARENA_WIDTH_UNITS,
                    height: ARENA_HEIGHT_UNITS,
                }, {
                    applyDamageToShape,
                    applyDamageFromShapes,
                    abilityHitsTarget,
                    triggeredAbilityDamage,
                    overlapsShape: overlapsEntity,
                });
                activeBots = entityUpdate.bots;
                const closingZoneUpdate = tickClosingZoneWorld({
                    zone: previousClosingZone,
                    bots: activeBots,
                    elapsedMs: Number(activeBots.find((bot) => bot.id === "main")?.matchElapsedMs
                        ?? mainBefore?.matchElapsedMs ?? AUTO_STEP_MS),
                    stepMs: AUTO_STEP_MS,
                    width: ARENA_WIDTH_UNITS,
                    height: ARENA_HEIGHT_UNITS,
                }, { applyDamageToShape });
                const settledBots = closingZoneUpdate.bots
                    .map(settlePendingHealing)
                    .map((bot) => finalizeTickMeasurements(
                        bot,
                        botBefores.find((before) => before.id === bot.id),
                    ));
                const mainAfter = settledBots.find((bot) => bot.id === "main") ?? null;
                const opponentAfter = settledBots.find((bot) => bot.id === "opponent-model") ?? null;
                abilityEntities = entityUpdate.entities;
                if (tutorialMode && tutorialRunRef.current && opponentAfter) {
                    const run = tutorialRunRef.current;
                    const remainingMs = Math.max(0, run.deadline - monotonicEpochNowMs());
                    const hit = opponentAfter.hp < run.opponentHp;
                    const tookDamage = mainAfter.hp < run.playerHp;
                    const survived = Number(mainAfter.hp) > 0;
                    const customVariableValue = run.goal === "custom_variable" && run.customVariableId
                        ? Number(mainAfter.customVariables?.[run.customVariableId])
                        : Number.NaN;
                    const customVariableIncreased = run.goal === "custom_variable"
                        && Number.isFinite(customVariableValue)
                        && customVariableValue >= run.customVariableStartValue + 5;
                    const priorityPassed = run.goal === "priority"
                        && remainingMs === 0
                        && run.priorityOrderCorrect;
                    const passed = run.goal === "survive"
                        ? remainingMs === 0 && survived
                        : run.goal === "heavy_slash"
                            ? hit
                            : run.goal === "combo"
                                ? hit && !tookDamage
                                : run.goal === "dodge_grenade"
                                    ? grenadeExploded && !tookDamage
                                        : run.goal === "basic_strike"
                                            ? hit
                                        : run.goal === "custom_variable"
                                            ? customVariableIncreased
                                        : run.goal === "priority"
                                            ? priorityPassed
                                        : false;
                    const failed = run.goal === "survive"
                        ? !survived
                        : run.goal === "priority" ? remainingMs === 0 : tookDamage || remainingMs === 0;
                    const priorityInitialPassed = passed && run.goal === "priority" && run.priorityStage === "initial";
                    const priorityFinalPassed = passed && run.goal === "priority" && run.priorityStage === "final";
                    const code = passed
                        ? run.goal === "survive" ? "survive_passed"
                            : run.goal === "heavy_slash" ? "heavy_slash_passed"
                                : run.goal === "combo" ? "combo_passed"
                                    : run.goal === "basic_strike" ? "basic_strike_passed"
                                        : run.goal === "custom_variable" ? "custom_variable_passed"
                                            : run.goal === "priority" ? (priorityFinalPassed ? "priority_final_passed" : "priority_initial_passed")
                                                : "dodge_passed"
                        : failed
                            ? run.goal === "survive" ? "survive_defeated"
                                : run.goal === "heavy_slash" ? "heavy_slash_timed_out"
                                    : run.goal === "combo" ? tookDamage ? "combo_took_damage" : "combo_timed_out"
                                : run.goal === "basic_strike"
                                            ? tookDamage ? "basic_strike_took_damage" : "basic_strike_timed_out"
                                            : run.goal === "custom_variable"
                                                ? "custom_variable_timed_out"
                                                : run.goal === "priority"
                                                    ? "priority_failed"
                                                    : tookDamage ? "dodge_took_damage" : "dodge_timed_out"
                            : "reading_code";
                    if (passed && !priorityInitialPassed) saveTutorialBooleanState(TUTORIAL_COMPLETION_PREFIX, tutorialStep, true);
                    setTutorialChallenge((current) => ({
                        ...current,
                        status: passed ? "passed" : failed ? "failed" : "running",
                        remainingMs,
                        completed: current.completed || (passed && !priorityInitialPassed),
                        initialRunComplete: current.initialRunComplete || priorityInitialPassed,
                        hit,
                        dodged: !tookDamage,
                        code,
                    }));
                    if (passed || failed) {
                        tutorialRunRef.current = null;
                        window.setTimeout(() => stopAutoPlay(), 0);
                    }
                }
                return [
                    ...settledBots.map(toCanonicalBotShape),
                    ...projectileEntities,
                    ...abilityEntities,
                    ...(closingZoneUpdate.zone ? [closingZoneUpdate.zone] : []),
                ];
            });
        }, AUTO_STEP_MS);
    };

    const stopAutoPlay = () => {
        if (autoIntervalRef.current) {
            clearInterval(autoIntervalRef.current);
            autoIntervalRef.current = null;
        }
        setIsAutoPlaying(false);
    };

    const handleTutorialStepChange = (nextStep) => {
        if (!tutorialMode) return;
        stopAutoPlay();
        tutorialRunRef.current = null;
        const scenario = getTutorialScenario(nextStep);
        setIsEditingArena(true);
        setSelectedId(null);
        setSelectedLoadout(scenario.playerLoadout);
        setOpponentLoadout(scenario.opponentLoadout);
        setTestingConfiguration(sanitizeStrategyConfigurationForLoadout(loadTutorialStrategyConfiguration(nextStep, scenario.emptyCode), scenario.playerLoadout));
        setOpponentTestingConfiguration(sanitizeStrategyConfigurationForLoadout(scenario.opponentCode, scenario.opponentLoadout));
        setShapes(buildTutorialArenaShapes(nextStep));
        releaseTutorialArenaFreeze();
        setSolutionShown(loadTutorialBooleanState(TUTORIAL_SOLUTION_PREFIX, nextStep));
        setTutorialChallenge(tutorialChallengeForScenario(nextStep, scenario));
        setTutorialStep(nextStep);
    };

    const toggleTutorialSolution = () => {
        const nextShown = !solutionShown;
        updateTestingConfiguration(nextShown ? tutorialScenario.solution : tutorialScenario.emptyCode);
        setSolutionShown(nextShown);
        if (tutorialMode) saveTutorialBooleanState(TUTORIAL_SOLUTION_PREFIX, tutorialStep, nextShown);
    };

    const resetArenaStats = () => {
        setSelectedId(null);
        if (isPracticeRoom) {
            setShapes(buildPracticeArenaShapes(
                selectedLoadout,
                opponentLoadout,
                practiceArenaSetup,
                true,
            ));
        } else {
            setShapes((prevShapes) => prevShapes
                .filter((shape) => shape.type !== "grenade" && shape.type !== "grenadeExplosion")
                .filter((shape) => shape.type !== "fireball")
                .filter((shape) => !["proximityMine", "mineExplosion", "orbitalMarker", "orbitalExplosion", "windburstProjectile"].includes(shape.type))
                .map((shape) => {
                    if (!isSimulationBotShape(shape)) return cloneShape(shape);
                    if (!isPuzzleBuilder) return resetBotShape(shape);
                    const configuration = puzzleBotForSetup(
                        initialPuzzle,
                        shape.teamNumber,
                        shape.puzzleSlot ?? shape.slot,
                    ) ?? (shape.id === "main"
                        ? initialPuzzle?.playerBot
                        : shape.id === "opponent-model" ? initialPuzzle?.opponentBot : null);
                    return configuration
                        ? resetBotShapeToStartingConfiguration(shape, configuration)
                        : resetBotShape(shape);
                }));
        }
        setSubmitStatus({ ok: true, message: "Bot stats, cooldowns, and status effects reset." });
        setTimeout(() => setSubmitStatus(null), 2500);
    };

    const handleAutoPlayToggle = () => {
        if (isAutoPlaying) {
            stopAutoPlay();
            setIsEditingArena(true);
            if (tutorialMode && tutorialRunRef.current) {
                tutorialRunRef.current = null;
                setTutorialChallenge((current) => ({ ...current, status: "idle", code: "stopped" }));
            }
            return;
        }
        runAutoPlay();
    };

    const handleSubmitBot = async ({ preserveStatus = false } = {}) => {
        if (!isMatchTesting) {
            const result = {
                accepted: true,
                message: "Practice code stays in this browser.",
            };
            setSubmitStatus({ ok: true, message: result.message });
            if (!preserveStatus) {
                setTimeout(() => setSubmitStatus(null), 4000);
            }
            return result;
        }

        setSubmitStatus({ ok: null, message: "Submitting bot code..." });

        try {
            const configuration = normalizeAbilityStrategyConfiguration(
                sanitizeStrategyConfigurationForLoadout(testingConfiguration, selectedLoadout),
            );
            const payload = await buildBotSubmissionPayload({
                code: configuration,
                matchId,
                roundNumber: matchContext?.roundNumber ?? null,
                phase: "BUILDING",
                selectedLoadout: selectedLoadout,
                loadout: matchContext?.loadout ?? null,
            });

            const result = await submitBotPayload(payload);
            console.info("[arena-bot] Submitted bot code contract:", payload);
            setSubmitStatus({
                ok: result.accepted !== false,
                message: result.message ?? "Bot code submitted",
            });
            if (!preserveStatus) {
                setTimeout(() => setSubmitStatus(null), 4000);
            }
            return result;
        } catch (err) {
            setSubmitStatus({
                ok: false,
                message: err.message,
            });
            if (!preserveStatus) {
                setTimeout(() => setSubmitStatus(null), 4000);
            }
            return null;
        }
    };
    const handleFinishMatch = async () => {
        if (!onFinishMatch || finishStatus === "FINISHED" || finishStatus === "SURRENDERED"
            || isFinishingMatch || finishInFlightRef.current) return;
        finishInFlightRef.current = true;
        setIsFinishingMatch(true);

        const result = await handleSubmitBot({ preserveStatus: true });

        if (result && result.accepted !== false) {
            onFinishMatch();
            setSubmitStatus({ ok: true, message: "Successfully submitted." });
        } else {
            finishInFlightRef.current = false;
            setIsFinishingMatch(false);
        }
    };
    useEffect(() => {
        handleFinishMatchRef.current = handleFinishMatch;
    });
    useEffect(() => {
        const visibleDeadline = matchContext?.buildingEndsAtMs ?? matchContext?.buildingEndsAt;
        const authoritativeDeadline = matchContext?.buildingEndsAtAuthoritativeMs
            ?? matchContext?.buildingEndsAt
            ?? visibleDeadline;
        const autoSubmitDeadline = typeof authoritativeDeadline === "number"
            ? authoritativeDeadline - AUTO_FINISH_SAFETY_BUFFER_MS
            : authoritativeDeadline;
        if (!visibleDeadline || !authoritativeDeadline || !onFinishMatch) return;

        const interval = setInterval(() => {
            const remaining = secondsRemaining(visibleDeadline);
            setTestingRemaining(remaining);
            const authoritativeRemaining = secondsRemaining(autoSubmitDeadline);
            if (authoritativeRemaining === 0) {
                clearInterval(interval);
                const deadlineKey = String(authoritativeDeadline);
                if (autoFinishDeadlineRef.current !== deadlineKey) {
                    autoFinishDeadlineRef.current = deadlineKey;
                    // Preserve the latest in-memory graph/loadout even when
                    // the player never presses the manual submit button.
                    handleFinishMatchRef.current?.();
                }
            }
        }, 100);

        return () => clearInterval(interval);
    }, [
        matchContext?.buildingEndsAt,
        matchContext?.buildingEndsAtAuthoritativeMs,
        matchContext?.buildingEndsAtMs,
        onFinishMatch,
    ]);

    return (
        <div className={`arena-page-shell relative flex h-screen flex-col text-ink-hi font-ui overflow-hidden ${isMatchTesting ? "match-arena-shell" : "bg-arena-deep"}`}>
            {submitStatus && (
                <div role="status" aria-live="polite" className={`
                    fixed bottom-6 left-1/2 -translate-x-1/2 z-50
                    px-4 py-2 rounded shadow-lg border text-xs font-mono tracking-widest
                    transition-opacity duration-300
                    ${submitStatus.ok === true
                        ? "bg-green-950 border-green-700 text-green-400"
                        : submitStatus.ok === false
                            ? "bg-red-950 border-red-700 text-red-400"
                            : "bg-arena-panel border-border-lo text-ink-muted"}
                `}>
                    {submitStatus.message}
                </div>
            )}

            <div className="arena-content-shell flex min-h-0 flex-1 flex-col overflow-hidden">
                <AppNavbar inPageFlow account={!matchContext && !tutorialMode} currentPage={isPuzzleBuilder ? "puzzle-builder" : isPuzzleMode ? "puzzle-play" : null} onHome={onExit} />

                <div className="arena-workspace-shell flex min-h-0 min-w-0 flex-1 overflow-hidden">
                <main className={`arena-stage-main min-w-0 flex-1 flex items-center justify-center overflow-hidden p-2 ${isMatchTesting ? "match-arena-stage" : "bg-arena-deep"}`}>
                    <div className="arena-stage-frame relative flex h-full w-full min-h-0 flex-col items-center justify-center">
                        {(arenaInfo || tutorialMode) && (
                            <div className="arena-stage-info">
                                {arenaInfo}
                                {tutorialMode && <div ref={setTutorialInfoHost} className="arena-stage-info__tutorial" />}
                            </div>
                        )}
                        <div className="arena-stage-canvas flex min-h-0 w-full flex-1 items-center justify-center">
                            <PixiCanvas
                            shapes={shapes}
                            selectedId={selectedId}
                            onSelectShape={isEditingArena && !tutorialMode ? setSelectedId : () => { }}
                            onUpdateShape={isEditingArena && !tutorialMode ? handleUpdateShape : () => { }}
                            onDeselectAll={isEditingArena && !tutorialMode ? () => setSelectedId(null) : () => { }}
                            editable={isEditingArena && !tutorialMode}
                            fillAvailable
                            fixedLayout={usesArenaResponsiveLimits}
                            abilityLayout="split"
                            showEmptyAbilitySlot={!isMatchTesting}
                            showParticipantNumbers={isMatchTesting}
                            abilityInfoEnabled={abilityInfoEnabled}
                            measurementEnabled={measurementEnabled}
                            measurementPoints={measurementPoints}
                            onMeasurementPointsChange={setMeasurementPoints}
                            isPlaying={isAutoPlaying}
                            allowBotRotation={allowBotRotation}
                            allowLockedBotEditing={allowLockedBotEditing}
                            />
                        </div>
                    </div>
                </main>

                <CodingPanel
                    configuration={testingConfiguration}
                    onChange={updateTestingConfiguration}
                    opponentConfiguration={isMatchTesting || tutorialMode || (isPuzzleMode && initialPuzzle?.hideOpponentCode !== false) ? null : opponentTestingConfiguration}
                    onOpponentChange={isMatchTesting || tutorialMode ? null : updateOpponentTestingConfiguration}
                    offlineCodeParticipants={isPuzzleBuilder ? puzzleCodeRoster : isPracticeRoom ? practiceCodeRoster : null}
                    selectableParticipants={arenaSelectableParticipants}
                    onOfflineCodeChange={isPuzzleBuilder || isPracticeRoom ? handleOfflineCodeChange : null}
                    opponentReadOnly={isPuzzleMode && initialPuzzle?.hideOpponentCode === false}
                    selectedLoadout={selectedLoadout}
                    opponentLoadout={opponentLoadout}
                    isMatchTesting={isMatchTesting}
                    usesArenaResponsiveLimits={usesArenaResponsiveLimits}
                    matchContext={matchContext}
                    codeSnapshots={matchContext?.codeSnapshots}
                    codeViewError={matchContext?.codeViewError}
                    onRequestCodeView={matchContext?.requestCodeView}
                    sandboxCodeCopies={sandboxCodeCopies}
                    onSandboxParticipantChange={updateSandboxParticipantConfiguration}
                    testingRemaining={testingRemaining}
                    isAutoPlaying={isAutoPlaying}
                    onMeasurementToggle={() => setMeasurementEnabled((current) => {
                        if (current) setMeasurementPoints([]);
                        return !current;
                    })}
                    isBaseTesting={isBaseTesting}
                    finishStatus={finishStatus}
                    finishError={finishError}
                    isFinishingMatch={isFinishingMatch}
                    canFinishMatch={Boolean(onFinishMatch)}
                    onAutoPlayToggle={handleAutoPlayToggle}
                    onResetArenaStats={resetArenaStats}
                    customVariableValues={shapes.find((shape) => shape.id === "main")?.customVariables ?? {}}
                    opponentCustomVariableValues={shapes.find((shape) => shape.id === "opponent-model")?.customVariables ?? {}}
                    onFinishMatch={handleFinishMatch}
                    onSurrenderMatch={onSurrenderMatch}
                    onOpenLoadout={!isMatchTesting && !tutorialMode && !isPuzzleMode && loadoutEditorRoster.length > 0 ? () => openSandboxLoadout() : null}
                    onOpenPracticeConfig={!isMatchTesting && !tutorialMode && !isPuzzleMode && isPracticeRoom ? () => setIsPracticeConfigOpen(true) : null}
                    onOpenPuzzleSubmissions={isPuzzleMode ? onOpenPuzzleSubmissions : null}
                    builderControls={builderControls}
                    puzzleControls={puzzleControls}
                    onPuzzleSubmit={isPuzzleMode && onPuzzleAttempt ? submitPuzzleAttempt : null}
                    isPuzzleSubmitting={isPuzzleAttemptSubmitting}
                    logicLimits={usesPuzzleSetup ? logicLimits : null}
                    tutorialMode={tutorialMode}
                    tutorialGuideHost={tutorialInfoHost}
                    tutorialStep={tutorialStep}
                    onShowTutorialSolution={toggleTutorialSolution}
                    tutorialGuideProps={tutorialMode ? {
                        step: tutorialStep,
                        onStepChange: handleTutorialStepChange,
                        challenge: tutorialChallenge,
                        onAbilityCatalogue: () => navigate("/ability-catalogue"),
                        onConditionalCatalogue: () => navigate("/conditionals"),
                        onPuzzles: () => navigate("/puzzles"),
                        onShowSolution: toggleTutorialSolution,
                        solutionShown,
                    } : null}
                />
                </div>
            </div>
            {sandboxLoadoutTarget && activeLoadoutEntry && (
                <div
                    ref={sandboxDialogRef}
                    onMouseDown={(event) => {
                        if (event.target === event.currentTarget) closeSandboxLoadout();
                    }}
                    className="fixed inset-0 z-[100] flex items-center justify-center overflow-y-auto bg-[#02070de8] p-4 backdrop-blur-sm"
                    role="dialog"
                    aria-modal="true"
                    aria-labelledby="sandbox-loadout-title"
                    tabIndex={-1}
                >
                    <div className="max-h-[92vh] w-full max-w-6xl overflow-y-auto border border-green-400/60 bg-[#171a1c] p-5 text-white shadow-[0_32px_100px_rgba(0,0,0,.72)] sm:p-7">
                        <div className="flex items-start justify-between gap-4 border-b border-slate-700/70 pb-5">
                            <div>
                                <p className="font-mono text-[10px] font-bold tracking-[.28em] text-green-300">BOT LOADOUT EDITOR</p>
                                <h2 id="sandbox-loadout-title" className="mt-2 font-display-action text-4xl uppercase tracking-wide text-white sm:text-5xl">{activeLoadoutEntry.username} loadout</h2>
                                <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-400">Choose abilities for every bot in this room. Changes stay local while you browse players and are committed together when you apply loadouts.</p>
                            </div>
                            <button type="button" onClick={closeSandboxLoadout} aria-label="Close sandbox loadout editor" className="gray-button-surface min-h-11 shrink-0 rounded border border-slate-600 px-3 font-mono text-xs text-slate-300">CLOSE</button>
                        </div>

                        <div className="mt-5 flex items-center gap-2">
                            <button type="button" aria-label="Show previous bot loadout" title="Previous bot" onClick={() => cycleSandboxLoadout(-1)} disabled={loadoutEditorRoster.length < 2} className="code-bot-selector__arrow h-11 w-10 shrink-0">‹</button>
                            <div className="flex min-w-0 flex-1 gap-2 overflow-x-auto pb-1" role="tablist" aria-label="Select bot loadout">
                                {loadoutEditorRoster.map((entry) => {
                                    const draft = sandboxLoadoutDrafts[entry.key] ?? loadoutDraftForEntry(entry);
                                    const active = entry.key === activeLoadoutEntry.key;
                                    const teamLabel = Number(entry.teamNumber) === PUZZLE_OPPONENT_TEAM ? "RED TEAM" : "BLUE TEAM";
                                    return (
                                        <button
                                            type="button"
                                            key={entry.key}
                                            role="tab"
                                            aria-selected={active}
                                            onClick={() => setSandboxLoadoutTarget(entry.key)}
                                            className={`min-w-32 shrink-0 rounded border px-3 py-2 text-left transition ${active
                                                ? "border-green-400 bg-green-950/30 text-white shadow-[0_0_0_1px_rgba(114,182,93,.22)]"
                                                : "border-slate-700/80 bg-slate-950/25 text-slate-400 hover:border-green-700/70 hover:text-slate-200"
                                            }`}
                                        >
                                            <span className="block truncate text-xs font-bold">{entry.username}</span>
                                            <span className="mt-1 block truncate font-mono text-[8px] tracking-widest text-green-300/70">{teamLabel} · {draft.abilities.length} EQUIPPED</span>
                                        </button>
                                    );
                                })}
                            </div>
                            <button type="button" aria-label="Show next bot loadout" title="Next bot" onClick={() => cycleSandboxLoadout(1)} disabled={loadoutEditorRoster.length < 2} className="code-bot-selector__arrow h-11 w-10 shrink-0">›</button>
                        </div>

                        <div className="mt-5 flex flex-col gap-4 border-y border-slate-700/70 py-4 sm:flex-row sm:items-center sm:justify-between">
                            <div>
                                <p className="font-mono text-[10px] font-bold tracking-[.2em] text-green-300">{Number(activeLoadoutEntry.teamNumber) === PUZZLE_OPPONENT_TEAM ? "RED TEAM" : "BLUE TEAM"} · LOADOUT {Math.max(1, activeLoadoutIndex + 1)}/{loadoutEditorRoster.length}</p>
                                <p className="mt-1 text-sm text-slate-400">{activeSandboxLoadout.abilities.length} abilities equipped</p>
                            </div>
                            <label className="flex min-h-10 w-full items-center rounded border border-slate-700 bg-[#202427] px-3 focus-within:border-green-400 sm:max-w-xs">
                                <span className="mr-2 text-slate-500" aria-hidden="true">⌕</span>
                                <span className="sr-only">Search abilities by name</span>
                                <input
                                    type="search"
                                    value={sandboxLoadoutSearch}
                                    onChange={(event) => setSandboxLoadoutSearch(event.target.value)}
                                    placeholder="Search abilities by name"
                                    className="min-w-0 flex-1 bg-transparent text-sm text-white outline-none placeholder:text-slate-600"
                                />
                            </label>
                        </div>

                        <div className="mt-6 space-y-8">
                            {[1, 2, 3].map((round) => {
                                const roundAbilities = visibleSandboxAbilities.filter((ability) => ability.round === round);
                                if (roundAbilities.length === 0) return null;
                                return (
                                    <section key={round} aria-labelledby={`sandbox-round-${round}-title`}>
                                        <div className="mb-4 flex items-end justify-between gap-4 border-b border-slate-700/60 pb-3">
                                            <div>
                                                <p className="font-mono text-[9px] font-bold tracking-[.28em] text-slate-500">DRAFT TIER 0{round}</p>
                                                <h3 id={`sandbox-round-${round}-title`} className="mt-1 font-display-action text-3xl uppercase tracking-wider text-white">Round {round}</h3>
                                            </div>
                                            <span className="font-mono text-[9px] tracking-widest text-green-300">{roundAbilities.length} ABILITIES</span>
                                        </div>
                                        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                                            {roundAbilities.map((ability) => (
                                                <SandboxAbilityCard
                                                    key={ability.id}
                                                    ability={ability}
                                                    selected={activeSandboxLoadout.abilities.includes(ability.id)}
                                                    onToggle={toggleSandboxLoadoutAbility}
                                                />
                                            ))}
                                        </div>
                                    </section>
                                );
                            })}
                            {visibleSandboxAbilities.length === 0 && (
                                <p className="border border-slate-700/70 bg-slate-950/30 px-4 py-6 text-sm text-slate-400">No abilities match “{sandboxLoadoutSearch.trim()}”. Search by ability name.</p>
                            )}
                        </div>

                        <div className="mt-7 flex flex-col gap-4 border-t border-slate-700/70 pt-5 sm:flex-row sm:items-center sm:justify-between">
                            <p className="text-xs leading-5 text-slate-500">Switching players keeps each draft until you close this editor or apply all loadouts.</p>
                            <button type="button" onClick={applySandboxLoadouts} className="gray-button-surface min-h-11 rounded border border-green-400/70 bg-green-950/20 px-6 font-mono text-[11px] font-bold tracking-widest text-green-200 hover:bg-green-950/40">APPLY LOADOUTS</button>
                        </div>
                    </div>
                </div>
            )}
            {isPracticeConfigOpen && (
                <PracticeConfigModal
                    draft={practiceConfig}
                    onClose={() => setIsPracticeConfigOpen(false)}
                    onSave={savePracticeConfig}
                />
            )}
        </div>
    );
}

function practiceBotDisplayName(bot) {
    const teamNumber = Number(bot?.teamNumber);
    const slot = Number(bot?.slot) || 1;
    if (teamNumber === PUZZLE_PLAYER_TEAM && slot === 1) return "My Bot";
    return teamNumber === PUZZLE_PLAYER_TEAM ? `Teammate ${slot - 1}` : `Opponent ${slot}`;
}

function practiceTeamLabel(teamNumber) {
    return Number(teamNumber) === PUZZLE_OPPONENT_TEAM ? "RED TEAM" : "BLUE TEAM";
}

function DeferredNumberInput({ value, onCommit, ...props }) {
    const [draftValue, setDraftValue] = useState(() => String(value ?? ""));

    useEffect(() => {
        // Re-sync after a committed value or bot selection changes while
        // preserving the raw value during the active edit.
        // eslint-disable-next-line react-hooks/set-state-in-effect
        setDraftValue(String(value ?? ""));
    }, [value]);

    const commit = () => onCommit?.(draftValue);

    return (
        <input
            {...props}
            type="number"
            value={draftValue}
            onChange={(event) => setDraftValue(event.target.value)}
            onBlur={commit}
            onKeyDown={(event) => {
                if (event.key !== "Enter") return;
                event.preventDefault();
                event.currentTarget.blur();
            }}
        />
    );
}

function PracticeConfigModal({ draft, onClose, onSave }) {
    const dialogRef = useRef(null);
    useDialogFocus(dialogRef, {
        onClose,
        lockScroll: true,
        enabled: true,
    });
    const [localDraft, setLocalDraft] = useState(() => normalizePracticeConfig(draft));
    const [selectedIndex, setSelectedIndex] = useState(0);
    const bots = localDraft.bots;
    const selectedBotIndex = Math.min(selectedIndex, Math.max(0, bots.length - 1));
    const selectedBot = bots[selectedBotIndex] ?? bots[0];
    const teamNumber = Number(selectedBot?.teamNumber) === PUZZLE_OPPONENT_TEAM
        ? PUZZLE_OPPONENT_TEAM
        : PUZZLE_PLAYER_TEAM;
    const tone = teamNumber === PUZZLE_OPPONENT_TEAM ? "red" : "blue";
    const updateTeamSize = (field, rawValue) => {
        setLocalDraft((current) => normalizePracticeConfig({ ...current, [field]: rawValue }));
    };
    const updateElapsedTime = (rawValue) => {
        setLocalDraft((current) => {
            const seconds = Number(rawValue);
            const fallbackSeconds = Number(current.initialElapsedMs ?? 0) / 1000;
            const resolvedSeconds = Number.isFinite(seconds) ? seconds : fallbackSeconds;
            return normalizePracticeConfig({ ...current, initialElapsedMs: resolvedSeconds * 1000 });
        });
    };
    const updateBot = (field, rawValue) => {
        setLocalDraft((current) => normalizePracticeConfig({
            ...current,
            bots: current.bots.map((bot, index) => index === selectedBotIndex ? { ...bot, [field]: rawValue } : bot),
        }));
    };
    const cycle = (direction) => {
        if (bots.length < 2) return;
        setSelectedIndex((current) => (Math.min(current, bots.length - 1) + direction + bots.length) % bots.length);
    };
    const inputClass = `mt-1 h-9 w-full border bg-slate-950 px-2 text-center font-interface-numeric text-sm text-white outline-none ${tone === "red" ? "border-red-900/80 focus:border-red-400" : "border-cyan-900/80 focus:border-cyan-400"}`;

    return (
        <div className="fixed inset-0 z-[110] grid place-items-center bg-black/75 p-4 backdrop-blur-sm" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
            <section ref={dialogRef} className="max-h-[92vh] w-[min(92vw,560px)] overflow-y-auto rounded-xl border border-cyan-700/70 bg-[#11171a] shadow-2xl" role="dialog" aria-modal="true" aria-labelledby="practice-config-title" tabIndex={-1}>
                <header className="flex items-center justify-between gap-4 border-b border-slate-700/80 bg-slate-950/70 px-5 py-4">
                    <div><p className="font-mono text-[9px] font-bold tracking-[.2em] text-cyan-300">PRACTICE CONFIG</p><h2 id="practice-config-title" className="mt-1 text-lg font-bold text-white">Practice arena setup</h2></div>
                    <button type="button" onClick={onClose} aria-label="Close practice config" className="modal-close-button"><span aria-hidden="true">×</span></button>
                </header>
                <div className="space-y-4 p-5">
                    <div className="space-y-2">
                        <label className="flex min-h-11 items-center justify-between gap-4 border-b border-slate-800/80 pb-2 font-mono text-[9px] text-slate-300">
                            <span>BLUE TEAM PLAYERS</span>
                            <DeferredNumberInput min="1" max="2" step="1" value={localDraft.playerTeamSize} onCommit={(value) => updateTeamSize("playerTeamSize", value)} aria-label="Number of blue team players" className="h-9 w-24 border-2 border-cyan-400/80 bg-cyan-950/20 px-2 text-center font-interface-numeric text-sm text-white outline-none focus:border-cyan-300" />
                        </label>
                        <label className="flex min-h-11 items-center justify-between gap-4 border-b border-slate-800/80 pb-2 font-mono text-[9px] text-slate-300">
                            <span>RED TEAM PLAYERS</span>
                            <DeferredNumberInput min="1" max="2" step="1" value={localDraft.opponentTeamSize} onCommit={(value) => updateTeamSize("opponentTeamSize", value)} aria-label="Number of red team players" className="h-9 w-24 border-2 border-red-400/80 bg-red-950/20 px-2 text-center font-interface-numeric text-sm text-white outline-none focus:border-red-300" />
                        </label>
                        <label className="flex min-h-11 items-center justify-between gap-4 border-b border-slate-800/80 pb-2 font-mono text-[9px] text-slate-300">
                            <span>TIME AT / SEC</span>
                            <DeferredNumberInput min="0" max="60" step="1" value={Math.round(localDraft.initialElapsedMs / 1000)} onCommit={updateElapsedTime} aria-label="Practice elapsed time in seconds" className="h-9 w-24 border border-slate-700 bg-slate-950 px-2 text-center font-interface-numeric text-sm text-white outline-none focus:border-cyan-400" />
                        </label>
                    </div>
                    <section className={`rounded border p-3 ${tone === "red" ? "border-red-900/60 bg-red-950/20" : "border-cyan-400/65 bg-cyan-950/30"}`}>
                        <div className="mb-2 flex items-center justify-between"><h3 className="font-mono text-[10px] font-bold tracking-[.16em] text-cyan-200">STARTING STATS</h3></div>
                        <div className="code-bot-selector-stack w-full max-w-none">
                            <div className={`code-bot-selector ${tone === "red" ? "is-red" : "is-blue"}`} role="group" aria-label="Select practice starting stats">
                                <button type="button" aria-label="Show previous practice bot" title="Previous bot" onClick={() => cycle(-1)} disabled={bots.length < 2} className="code-bot-selector__arrow">‹</button>
                                <div className="code-bot-selector__current" aria-live="polite">
                                    <span className="code-bot-selector__name">{practiceBotDisplayName(selectedBot)}</span>
                                    <span className="code-bot-selector__meta">{practiceTeamLabel(teamNumber)} · STARTING STATS · {Math.max(1, selectedBotIndex + 1)}/{bots.length}</span>
                                </div>
                                <button type="button" aria-label="Show next practice bot" title="Next bot" onClick={() => cycle(1)} disabled={bots.length < 2} className="code-bot-selector__arrow">›</button>
                            </div>
                        </div>
                        <div className="mt-3 grid grid-cols-2 gap-2">
                            <label className="font-mono text-[8px] text-slate-500">X<DeferredNumberInput min={BOT_CENTER_MIN_X} max={BOT_CENTER_MAX_X} step="1" value={selectedBot?.startX ?? BOT_CENTER_MIN_X} onCommit={(value) => updateBot("startX", value)} aria-label={`${practiceBotDisplayName(selectedBot)} starting X position`} className={inputClass} /></label>
                            <label className="font-mono text-[8px] text-slate-500">Y<DeferredNumberInput min={BOT_CENTER_MIN_Y} max={BOT_CENTER_MAX_Y} step="1" value={selectedBot?.startY ?? BOT_CENTER_MIN_Y} onCommit={(value) => updateBot("startY", value)} aria-label={`${practiceBotDisplayName(selectedBot)} starting Y position`} className={inputClass} /></label>
                            <label className="font-mono text-[8px] text-slate-500">ROTATION<DeferredNumberInput min="-360" max="360" step="1" value={selectedBot?.rotation ?? 0} onCommit={(value) => updateBot("rotation", value)} aria-label={`${practiceBotDisplayName(selectedBot)} starting rotation`} className={inputClass} /></label>
                            <label className="font-mono text-[8px] text-slate-500">HP<DeferredNumberInput min="1" max={BASE_BOT_HP} step="1" value={selectedBot?.startHp ?? BASE_BOT_HP} onCommit={(value) => updateBot("startHp", value)} aria-label={`${practiceBotDisplayName(selectedBot)} starting HP`} className={inputClass} /></label>
                        </div>
                    </section>
                </div>
                <footer className="flex justify-end gap-2 border-t border-slate-700/80 bg-slate-950/70 px-5 py-4"><button type="button" onClick={onClose} className="gray-button-surface min-h-10 border border-slate-600 px-5 font-mono text-[10px] font-bold tracking-[.16em] text-slate-300">CANCEL</button><button type="button" onClick={() => onSave(localDraft)} className="gray-button-surface min-h-10 border border-cyan-400 px-5 font-mono text-[10px] font-bold tracking-[.16em] text-cyan-100">SAVE PRACTICE CONFIG</button></footer>
            </section>
        </div>
    );
}
