import { useState, useCallback, useEffect, useLayoutEffect, useRef } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { monotonicEpochNowMs } from "../matchmaking/networkDelayEstimator.js";
import AppNavbar from "../components/AppNavbar";
import { useDialogFocus } from "../components/useDialogFocus.js";
import PixiCanvas from "./pixi/PixiCanvas.jsx";
import CodingPanel from "./coding/CodingPanel.jsx";
import { BOT_ABILITIES, SELECTABLE_BOT_ABILITIES, decodeBotLoadout, decodeSandboxLoadout, encodeSandboxLoadout, normalizedSandboxLoadout } from "./loadout/BotLoadout.js";
import {
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
    resolveTriggeredAbilityCombat,
    settlePendingHealing,
} from "./gameconfig/BotCombatSystem.js";
import { triggeredAbilityDamage } from "./ecs/abilities/AbilityEffectSystem.js";
import { abilityHitsTarget } from "./ecs/abilities/AbilityHitDetectionSystem.js";
import { isClosingZone, tickClosingZoneWorld } from "./ecs/entities/ClosingZoneSystem.js";
import {
    actionIdsForLoadoutConfiguration,
    DEFAULT_BOT_CONFIGURATION_ID,
} from "./gameconfig/CombatLoadouts.js";
import { readPracticeRoomDraft, savePracticeRoomDraft } from "./practiceRoomStorage.js";
import { readPuzzleBotCodeDraft, savePuzzleBotCodeDraft } from "../puzzles/puzzleBotCodeStorage.js";

import {
    AUTO_STEP_MS,
    ARENA_HEIGHT_UNITS,
    ARENA_WIDTH_UNITS,
    BASE_BOT_HP,
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
import { buildAbilityTestingArenaShapes, findAbilityTestingPreset } from "./testing/AbilityTestingPresets.js";
import { buildStatePayload } from "./modelPayloads/strategyStatePayload.js";
import {
    buildTutorialArenaShapes,
    getTutorialScenario,
    TUTORIAL_STEP_COUNT,
    validateSearchNodesLesson,
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

const TUTORIAL_STRATEGY_PREFIX = "arena-tutorial-strategy-v1-";
const TUTORIAL_COMPLETION_PREFIX = "arena-tutorial-completion-v1-";
const TUTORIAL_SOLUTION_PREFIX = "arena-tutorial-solution-v1-";
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
    return {
        status: "idle",
        remainingMs: scenario.durationMs ?? 0,
        code: "ready",
        completed: loadTutorialBooleanState(TUTORIAL_COMPLETION_PREFIX, step),
    };
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
    const source = configuration && typeof configuration === "object"
        ? configuration
        : createDefaultAbilityStrategyConfiguration();
    const allowedActionIds = new Set(actionIdsForLoadoutConfiguration(loadoutId));
    const sanitizeAction = (action) => {
        if (!action || typeof action !== "object") return action;
        const actionId = allowedActionIds.has(action.action) ? action.action : "none";
        return {
            ...action,
            action: actionId,
            actionTarget: actionId === "none" ? "opponent" : action.actionTarget,
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

function buildPracticeArenaShapes(playerLoadout, opponentLoadout, puzzleSetup = null) {
    const loadoutForId = (loadout) => String(loadout).startsWith("sandbox:")
        ? decodeSandboxLoadout(loadout)
        : decodeBotLoadout(loadout);
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
    const matchId = matchContext?.matchId;
    const matchUserId = matchContext?.player?.userId;
    const isMatchTesting = Boolean(matchId && matchUserId);
    const allowBotRotation = isPracticeRoom || isPuzzleBuilder || (isMatchTesting && finishStatus === "BUILDING");
    // Tutorial, practice, puzzle, and live-match arenas share the same
    // responsive shell. The tutorial used to opt out of the fixed-layout
    // breakpoints, which made its toolbar and status panels disappear at
    // different widths from the regular arena.
    const usesArenaResponsiveLimits = true;
    const playerRoundWins = Math.max(0, Number(matchContext?.player?.roundWins) || 0);
    const opponentRoundWins = Math.max(0, Number(matchContext?.opponent?.roundWins) || 0);
    const [selectedLoadout, setSelectedLoadout] = useState(() => tutorialMode
        ? initialTutorialScenario.playerLoadout
        : isAbilityTesting ? catalogueAbilityTestingPreset.playerLoadout
            : usesPuzzleSetup ? initialPuzzle?.playerBot?.loadout ?? DEFAULT_BOT_CONFIGURATION_ID
            : isPracticeRoom ? storedPracticeRoom?.player?.loadout ?? DEFAULT_BOT_CONFIGURATION_ID
            : matchContext?.player?.selectedLoadout ?? DEFAULT_BOT_CONFIGURATION_ID);
    const [opponentLoadout, setOpponentLoadout] = useState(() => tutorialMode
        ? initialTutorialScenario.opponentLoadout
        : isAbilityTesting ? catalogueAbilityTestingPreset.opponentLoadout
            : usesPuzzleSetup ? initialPuzzle?.opponentBot?.loadout ?? DEFAULT_BOT_CONFIGURATION_ID
            : isPracticeRoom ? storedPracticeRoom?.opponent?.loadout ?? DEFAULT_BOT_CONFIGURATION_ID
            : matchContext?.opponent?.selectedLoadout ?? DEFAULT_BOT_CONFIGURATION_ID);
    const strategyStorageKey = matchStrategyConfigurationKey(matchId, matchUserId, selectedLoadout);
    const opponentStrategyStorageKey = opponentStrategyConfigurationKey(matchId, matchUserId, opponentLoadout);
    const [shapes, setShapes] = useState(() => tutorialMode
        ? buildTutorialArenaShapes(initialTutorialStep)
        : isAbilityTesting ? buildAbilityTestingArenaShapes(catalogueAbilityTestingPreset)
            : usesPuzzleSetup ? buildPracticeArenaShapes(
                initialPuzzle?.playerBot?.loadout ?? DEFAULT_BOT_CONFIGURATION_ID,
                initialPuzzle?.opponentBot?.loadout ?? DEFAULT_BOT_CONFIGURATION_ID,
                initialPuzzle,
            )
            : isPracticeRoom ? buildPracticeArenaShapes(
                storedPracticeRoom?.player?.loadout ?? DEFAULT_BOT_CONFIGURATION_ID,
                storedPracticeRoom?.opponent?.loadout ?? DEFAULT_BOT_CONFIGURATION_ID,
            )
            : buildInitialArenaShapes(matchContext));
    const loggedTrainingEntityIdsRef = useRef(null);
    const loggedTrainingConditionStateRef = useRef(null);

    useEffect(() => {
        if (isMatchTesting || tutorialMode) return;
        const entities = shapes.filter((shape) => shape.id !== "main" && shape.id !== "opponent-model");
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
    const [isEditingArena, setIsEditingArena] = useState(!isPuzzleMode);
    const [testingConfiguration, setTestingConfiguration] = useState(() => sanitizeStrategyConfigurationForLoadout(
        tutorialMode ? loadTutorialStrategyConfiguration(initialTutorialStep, initialTutorialScenario.emptyCode) : isAbilityTesting ? catalogueAbilityTestingPreset.playerCode : matchContext?.roundBrains?.at(-1)?.brain
            ?? (isPuzzleMode
                ? puzzleCodeOverride ?? readPuzzleBotCodeDraft(puzzleNumber, initialPuzzle?.playerBot?.brain ?? createDefaultAbilityStrategyConfiguration())
                : usesPuzzleSetup ? initialPuzzle?.playerBot?.brain ?? createDefaultAbilityStrategyConfiguration() : isPracticeRoom ? storedPracticeRoom?.player?.code ?? loadStoredStrategyConfiguration(strategyStorageKey) : loadStoredStrategyConfiguration(strategyStorageKey)),
        selectedLoadout,
    ));
    const [opponentTestingConfiguration, setOpponentTestingConfiguration] = useState(() => sanitizeStrategyConfigurationForLoadout(
        tutorialMode
            ? initialTutorialScenario.opponentCode
            : isAbilityTesting ? catalogueAbilityTestingPreset.opponentCode : isPracticeRoom
                ? storedPracticeRoom?.opponent?.code ?? loadStoredStrategyConfiguration(opponentStrategyStorageKey)
                : usesPuzzleSetup ? initialPuzzle?.opponentBot?.brain ?? createDefaultAbilityStrategyConfiguration()
                : loadStoredStrategyConfiguration(opponentStrategyStorageKey),
        opponentLoadout,
    ));
    const [isFinishingMatch, setIsFinishingMatch] = useState(false);
    const [testingRemaining, setTestingRemaining] = useState(() =>
        secondsRemaining(matchContext?.buildingEndsAtMs ?? matchContext?.buildingEndsAt));
    const [sandboxLoadoutTarget, setSandboxLoadoutTarget] = useState(null);
    const sandboxDialogRef = useRef(null);
    useDialogFocus(sandboxDialogRef, {
        onClose: () => setSandboxLoadoutTarget(null),
        lockScroll: true,
        enabled: Boolean(sandboxLoadoutTarget),
    });
    const [sandboxLoadoutDraft, setSandboxLoadoutDraft] = useState(() => normalizedSandboxLoadout(null));
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

    useEffect(() => {
        if (!isPuzzleBuilder || !onPuzzleDraftChange || isAutoPlaying) return;
        // Starting stats are authoring inputs. Runtime movement, damage, and
        // rotation must remain preview state and never overwrite the draft.
        onPuzzleDraftChange({
            playerBot: {
                loadout: selectedLoadout,
                brain: testingConfiguration,
            },
            opponentBot: {
                loadout: opponentLoadout,
                brain: opponentTestingConfiguration,
            },
        });
    }, [isAutoPlaying, isPuzzleBuilder, onPuzzleDraftChange, opponentLoadout, opponentTestingConfiguration, selectedLoadout, testingConfiguration]);

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
        setShapes(buildAbilityTestingArenaShapes(catalogueAbilityTestingPreset));
    }, [catalogueAbilityTestingPreset, isAbilityTesting]);

    useEffect(() => {
        if (!matchContext?.opponent) return;
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
    }, [matchContext?.opponent, matchContext?.opponentLoadout]);

    const updateTestingConfiguration = (configuration) => {
        const sanitized = sanitizeStrategyConfigurationForLoadout(configuration, selectedLoadout);
        setTestingConfiguration(sanitized);
        if (isPuzzleMode) {
            savePuzzleBotCodeDraft(puzzleNumber, sanitized);
        } else {
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
        saveStoredStrategyConfiguration(opponentStrategyStorageKey, sanitized);
        if (isPracticeRoom) {
            savePracticeRoomDraft({
                player: { loadout: selectedLoadout, code: testingConfiguration },
                opponent: { loadout: opponentLoadout, code: sanitized },
            });
        }
    };

    const openSandboxLoadout = (target) => {
        if (isMatchTesting || isAutoPlaying) return;
        const bot = shapes.find((shape) => shape.id === (target === "opponent" ? "opponent-model" : "main"));
        const source = String(bot?.combatLoadout).startsWith("sandbox:")
            ? decodeSandboxLoadout(bot.combatLoadout)
            : { abilities: bot?.abilities ?? [] };
        setSandboxLoadoutDraft(normalizedSandboxLoadout(source));
        setSandboxLoadoutTarget(target);
    };

    const applySandboxLoadout = () => {
        const id = sandboxLoadoutTarget === "opponent" ? "opponent-model" : "main";
        const encoded = encodeSandboxLoadout(sandboxLoadoutDraft);
        if (id === "main") {
            const nextConfiguration = sanitizeStrategyConfigurationForLoadout({ ...testingConfiguration, loadout: encoded }, encoded);
            setSelectedLoadout(encoded);
            setTestingConfiguration(nextConfiguration);
            if (isPracticeRoom) {
                savePracticeRoomDraft({
                    player: { loadout: encoded, code: nextConfiguration },
                    opponent: { loadout: opponentLoadout, code: opponentTestingConfiguration },
                });
            }
        } else {
            const nextConfiguration = sanitizeStrategyConfigurationForLoadout({ ...opponentTestingConfiguration, loadout: encoded }, encoded);
            setOpponentLoadout(encoded);
            setOpponentTestingConfiguration(nextConfiguration);
            if (isPracticeRoom) {
                savePracticeRoomDraft({
                    player: { loadout: selectedLoadout, code: testingConfiguration },
                    opponent: { loadout: encoded, code: nextConfiguration },
                });
            }
        }
        setShapes((current) => current.map((shape) => shape.id === id
            ? resetBotShape({ ...shape, combatLoadout: encoded })
            : shape));
        setSandboxLoadoutTarget(null);
    };

    const handleUpdateShape = useCallback((id, updates) => {
        setShapes((previous) => previous.map((shape) => (
            shape.id === id && !shape.locked
                ? shape.id === "main" || shape.id === "opponent-model"
                    ? (() => {
                        const next = mergeBotShapeUpdates(shape, updates);
                        return next;
                    })()
                    : { ...shape, ...updates }
                : shape
        )));
    }, []);

    const playerStartX = initialPuzzle?.playerBot?.startX;
    const playerStartY = initialPuzzle?.playerBot?.startY;
    const playerRotation = initialPuzzle?.playerBot?.rotation;
    const opponentStartX = initialPuzzle?.opponentBot?.startX;
    const opponentStartY = initialPuzzle?.opponentBot?.startY;
    const opponentRotation = initialPuzzle?.opponentBot?.rotation;
    const playerStartHp = initialPuzzle?.playerBot?.startHp;
    const opponentStartHp = initialPuzzle?.opponentBot?.startHp;

    useEffect(() => {
        if (!isPuzzleBuilder || isAutoPlaying) return;
        const setupById = {
            main: { startX: playerStartX, startY: playerStartY, rotation: playerRotation, startHp: playerStartHp },
            "opponent-model": { startX: opponentStartX, startY: opponentStartY, rotation: opponentRotation, startHp: opponentStartHp },
        };
        // Synchronize the editable puzzle canvas with its external initial-puzzle inputs.
        // eslint-disable-next-line react-hooks/set-state-in-effect
        setShapes((previous) => {
            let changed = false;
            const next = previous
                .filter((shape) => !isClosingZone(shape))
                .map((shape) => {
                    const setup = setupById[shape.id];
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
    }, [initialPuzzleElapsedMs, isAutoPlaying, isPuzzleBuilder, opponentRotation, opponentStartHp, opponentStartX, opponentStartY, playerRotation, playerStartHp, playerStartX, playerStartY]);

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
        const setupValidationGoal = tutorialMode && tutorialScenario.goal === "code_search";
        const setupValidationPassed = setupValidationGoal
            ? validateSearchNodesLesson(testingConfiguration)
            : false;
        const customVariableGoal = tutorialMode && tutorialScenario.goal === "custom_variable";
        const customVariable = customVariableGoal
            ? (testingConfiguration.customVariables ?? []).find((variable) => (
                variable?.valueType === "number"
                && String(variable?.name ?? "").trim() === "Variable 1"
            ))
            : null;
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
            } : null;
            if (setupValidationPassed || (!setupValidationGoal && !tutorialScenario.durationMs)) {
                saveTutorialBooleanState(TUTORIAL_COMPLETION_PREFIX, tutorialStep, true);
            }
            setTutorialChallenge((current) => setupValidationGoal ? {
                status: setupValidationPassed ? "passed" : "failed",
                remainingMs: 0,
                completed: current.completed || setupValidationPassed,
                code: setupValidationPassed ? "search_passed" : "search_failed",
            } : {
                status: tutorialScenario.durationMs ? "running" : "idle",
                remainingMs: tutorialScenario.durationMs ?? 0,
                completed: current.completed || !tutorialScenario.durationMs,
                code: tutorialScenario.durationMs ? "reading_code" : "demonstration_running",
            });
            setShapes(freshShapes);
        } else if (isPuzzleMode) {
            const freshShapes = buildPracticeArenaShapes(selectedLoadout, opponentLoadout, initialPuzzle);
            setShapes(freshShapes);
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
                const mainBefore = toSimulationBotShape(prevShapes.find((s) => s.id === "main"));
                const opponentBefore = toSimulationBotShape(prevShapes.find((s) => s.id === "opponent-model"));
                const playerPredictedAction = buildDeterministicLogicAction(testingConfiguration, stateSnapshot);
            const opponentPredictedAction = opponentBefore && hasAbilityStrategyActions(opponentTestingConfiguration)
                    ? buildDeterministicLogicAction(opponentTestingConfiguration, buildStatePayload(prevShapes, opponentLoadout, "opponent-model"))
                    : idleAction();
                const playerAction = playerPredictedAction;
                const opponentAction = opponentPredictedAction;

                let mainAfter = {
                    ...applyActionToShape({ ...mainBefore, lastPredictedAction: playerPredictedAction }, playerAction, AUTO_STEP_MS),
                    customVariables: playerPredictedAction.customVariables,
                };
                let opponentAfter = opponentBefore
                    ? {
                        ...applyActionToShape({ ...opponentBefore, lastPredictedAction: opponentPredictedAction }, opponentAction, AUTO_STEP_MS),
                        customVariables: opponentPredictedAction.customVariables,
                    }
                    : null;
                const spawnedEntities = [mainAfter.abilitySpawn, opponentAfter?.abilitySpawn].filter(Boolean);
                let projectileEntities = prevShapes.filter(isProjectileEntity);
                let abilityEntities = prevShapes.filter(isAbilityEntity);
                const previousClosingZone = prevShapes.find(isClosingZone) ?? null;
                projectileEntities.push(...spawnedEntities.filter(isProjectileEntity));
                abilityEntities.push(...spawnedEntities.filter(isAbilityEntity));
                mainAfter = { ...mainAfter, abilitySpawn: null };
                if (opponentAfter) opponentAfter = { ...opponentAfter, abilitySpawn: null };

                [mainAfter, opponentAfter] = resolveTriggeredAbilityCombat(mainAfter, opponentAfter);
                const projectileUpdate = tickProjectileWorld({
                    bots: opponentAfter ? [mainAfter, opponentAfter] : [mainAfter],
                    entities: projectileEntities,
                    stepMs: AUTO_STEP_MS,
                    width: ARENA_WIDTH_UNITS,
                    height: ARENA_HEIGHT_UNITS,
                }, { applyDamageToShape, applyDamageFromShapes });
                const grenadeExploded = (projectileUpdate.grenadeExplosions ?? []).some((explosion) => explosion.ownerId === "opponent-model");
                [mainAfter] = projectileUpdate.bots;
                if (opponentAfter) opponentAfter = projectileUpdate.bots[1];
                projectileEntities = projectileUpdate.entities;
                abilityEntities.push(...projectileUpdate.spawnedEntities);
                const entityUpdate = tickAbilityEntityWorld({
                    entities: abilityEntities,
                    projectiles: projectileEntities,
                    bots: opponentAfter ? [mainAfter, opponentAfter] : [mainAfter],
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
                [mainAfter] = entityUpdate.bots;
                if (opponentAfter) opponentAfter = entityUpdate.bots[1];
                const closingZoneUpdate = tickClosingZoneWorld({
                    zone: previousClosingZone,
                    bots: opponentAfter ? [mainAfter, opponentAfter] : [mainAfter],
                    elapsedMs: Number(mainAfter.matchElapsedMs ?? mainBefore.matchElapsedMs ?? AUTO_STEP_MS),
                    stepMs: AUTO_STEP_MS,
                    width: ARENA_WIDTH_UNITS,
                    height: ARENA_HEIGHT_UNITS,
                }, { applyDamageToShape });
                [mainAfter] = closingZoneUpdate.bots;
                if (opponentAfter) opponentAfter = closingZoneUpdate.bots[1];
                mainAfter = settlePendingHealing(mainAfter);
                if (opponentAfter) opponentAfter = settlePendingHealing(opponentAfter);
                mainAfter = finalizeTickMeasurements(mainAfter, mainBefore);
                if (opponentAfter) opponentAfter = finalizeTickMeasurements(opponentAfter, opponentBefore);
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
                                        : false;
                    const failed = run.goal === "survive" ? !survived : tookDamage || remainingMs === 0;
                    const code = passed
                        ? run.goal === "survive" ? "survive_passed"
                            : run.goal === "heavy_slash" ? "heavy_slash_passed"
                                : run.goal === "combo" ? "combo_passed"
                                    : run.goal === "basic_strike" ? "basic_strike_passed"
                                        : run.goal === "custom_variable" ? "custom_variable_passed" : "dodge_passed"
                        : failed
                            ? run.goal === "survive" ? "survive_defeated"
                                : run.goal === "heavy_slash" ? "heavy_slash_timed_out"
                                    : run.goal === "combo" ? tookDamage ? "combo_took_damage" : "combo_timed_out"
                                : run.goal === "basic_strike"
                                            ? tookDamage ? "basic_strike_took_damage" : "basic_strike_timed_out"
                                            : run.goal === "custom_variable"
                                                ? "custom_variable_timed_out"
                                                : tookDamage ? "dodge_took_damage" : "dodge_timed_out"
                            : "reading_code";
                    if (passed) saveTutorialBooleanState(TUTORIAL_COMPLETION_PREFIX, tutorialStep, true);
                    setTutorialChallenge((current) => ({
                        status: passed ? "passed" : failed ? "failed" : "running",
                        remainingMs,
                        completed: current.completed || passed,
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
                    toCanonicalBotShape(mainAfter),
                    ...(opponentAfter ? [toCanonicalBotShape(opponentAfter)] : []),
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
        setShapes((prevShapes) => prevShapes
            .filter((shape) => shape.type !== "grenade" && shape.type !== "grenadeExplosion")
            .filter((shape) => shape.type !== "fireball")
            .filter((shape) => !["proximityMine", "mineExplosion", "orbitalMarker", "orbitalExplosion", "windburstProjectile"].includes(shape.type))
            .map((shape) => {
                if (shape.id !== "main" && shape.id !== "opponent-model") return cloneShape(shape);
                if (!isPuzzleBuilder) return resetBotShape(shape);
                const configuration = shape.id === "main"
                    ? initialPuzzle?.playerBot
                    : initialPuzzle?.opponentBot;
                return resetBotShapeToStartingConfiguration(shape, configuration);
            }));
        setSubmitStatus({ ok: true, message: "Bot stats, cooldowns, and status effects reset." });
        setTimeout(() => setSubmitStatus(null), 2500);
    };

    const handleAutoPlayToggle = () => {
        if (isAutoPlaying) {
            stopAutoPlay();
            setIsEditingArena(!isPuzzleMode);
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
        <div className={`arena-page-shell relative flex h-screen flex-col text-ink-hi font-ui overflow-hidden ${isMatchTesting ? "match-arena-shell" : "bg-arena-deep"} ${isMatchTesting || isPracticeRoom || isPuzzleBuilder || isPuzzleMode ? "gray-button-page" : ""}`}>
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

            <AppNavbar account={!matchContext && !tutorialMode} currentPage={isPuzzleBuilder ? "puzzle-builder" : isPuzzleMode ? "puzzle-play" : null} onHome={onExit} />

            <div className="arena-content-shell flex min-h-0 flex-1 overflow-hidden">
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
                            onSelectShape={isEditingArena && !tutorialMode && !isPuzzleMode ? setSelectedId : () => { }}
                            onUpdateShape={isEditingArena && !tutorialMode && !isPuzzleMode ? handleUpdateShape : () => { }}
                            onDeselectAll={isEditingArena && !tutorialMode && !isPuzzleMode ? () => setSelectedId(null) : () => { }}
                            editable={isEditingArena && !tutorialMode && !isPuzzleMode}
                            fillAvailable
                            fixedLayout={usesArenaResponsiveLimits}
                            abilityLayout="split"
                            showEmptyAbilitySlot={!isMatchTesting}
                            measurementEnabled={measurementEnabled}
                            measurementPoints={measurementPoints}
                            onMeasurementPointsChange={setMeasurementPoints}
                            isPlaying={isAutoPlaying}
                            allowBotRotation={allowBotRotation}
                            />
                        </div>
                    </div>
                </main>

                <CodingPanel
                    configuration={testingConfiguration}
                    onChange={updateTestingConfiguration}
                    opponentConfiguration={tutorialMode || (isPuzzleMode && initialPuzzle?.hideOpponentCode !== false) ? null : opponentTestingConfiguration}
                    onOpponentChange={tutorialMode ? null : updateOpponentTestingConfiguration}
                    opponentReadOnly={isPuzzleMode && initialPuzzle?.hideOpponentCode === false}
                    selectedLoadout={selectedLoadout}
                    opponentLoadout={opponentLoadout}
                    isMatchTesting={isMatchTesting}
                    usesArenaResponsiveLimits={usesArenaResponsiveLimits}
                    matchContext={matchContext}
                    testingRemaining={testingRemaining}
                    playerRoundWins={playerRoundWins}
                    opponentRoundWins={opponentRoundWins}
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
                    onOpenPlayerLoadout={!isMatchTesting && !tutorialMode && !isPuzzleMode ? () => openSandboxLoadout("player") : null}
                    onOpenOpponentLoadout={!isMatchTesting && !tutorialMode && !isPuzzleMode && shapes.some((shape) => shape.id === "opponent-model") ? () => openSandboxLoadout("opponent") : null}
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
            {sandboxLoadoutTarget && (
                <div ref={sandboxDialogRef} className="fixed inset-0 z-[100] flex items-center justify-center overflow-y-auto bg-black/75 p-4" role="dialog" aria-modal="true" aria-labelledby="sandbox-loadout-title" tabIndex={-1}>
                    <div className="max-h-[92vh] w-full max-w-4xl overflow-y-auto rounded-xl border border-zinc-600 bg-zinc-800 p-5 shadow-2xl">
                        <div className="flex items-start justify-between gap-4">
                            <div><p className="font-mono text-[10px] tracking-[0.25em] text-cyan">BOT ROOM SANDBOX</p><h2 id="sandbox-loadout-title" className="mt-2 text-2xl font-bold text-ink-white">{sandboxLoadoutTarget === "opponent" ? "Opponent" : "Your bot"} loadout</h2><p className="mt-1 text-sm text-ink-muted">Equip any combination of abilities. All bots use the standard combat stats.</p></div>
                            <button type="button" onClick={() => setSandboxLoadoutTarget(null)} aria-label="Close sandbox loadout editor" className="gray-button-surface min-h-11 rounded border border-border-lo px-3 font-mono text-xs text-ink-muted">CLOSE</button>
                        </div>
                        <div className="mt-5 grid gap-5">
                            <div className="space-y-5">
                                {[1, 2, 3].map((round) => <section key={round}><div className="mb-2 border-b border-border-lo pb-1 font-mono text-[10px] font-bold tracking-widest text-cyan">ROUND {round}</div><div className="grid gap-2 sm:grid-cols-2">
                                    {SELECTABLE_BOT_ABILITIES.filter((ability) => ability.round === round).map((ability) => {
                                        const selected = sandboxLoadoutDraft.abilities.includes(ability.id);
                                        return <button type="button" key={ability.id} onClick={() => setSandboxLoadoutDraft((current) => normalizedSandboxLoadout({ ...current, abilities: selected ? current.abilities.filter((id) => id !== ability.id) : [...current.abilities, ability.id] }))} className={`gray-button-surface rounded border p-3 text-left ${selected ? "border-cyan bg-cyan-950/30" : "border-border-lo bg-arena-panel"}`}><span className="font-mono text-[10px] font-bold tracking-widest text-ink-white">{selected ? "EQUIPPED - " : ""}{ability.label}</span><span className="ml-2 font-mono text-[8px] text-cyan">{ability.kind.toUpperCase()}</span><p className="mt-1 text-xs text-ink-muted">{ability.summary}</p></button>;
                                    })}
                                </div></section>)}
                            </div>
                        </div>
                        <div className="mt-5 flex justify-end"><button type="button" onClick={applySandboxLoadout} className="gray-button-surface h-11 rounded border border-green-700/70 px-6 font-mono text-[11px] font-bold tracking-widest text-green-200">APPLY LOADOUT</button></div>
                    </div>
                </div>
            )}
        </div>
    );
}
