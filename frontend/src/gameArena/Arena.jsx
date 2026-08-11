import { useState, useCallback, useEffect, useRef } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { monotonicEpochNowMs } from "../matchmaking/networkDelayEstimator.js";
import AppNavbar from "../components/AppNavbar";
import { useDialogFocus } from "../components/useDialogFocus.js";
import PixiCanvas from "./pixi/PixiCanvas.jsx";
import CodingPanel from "./coding/CodingPanel.jsx";
import { BOT_ABILITIES, SELECTABLE_BOT_ABILITIES, SANDBOX_MAX_STAT_POINTS, botStatsForSandboxLoadout, decodeSandboxLoadout, encodeSandboxLoadout, normalizedSandboxLoadout } from "./loadout/BotLoadout.js";
import {
    createDefaultAbilityStrategyConfiguration,
    hasAbilityStrategyActions,
    normalizeAbilityStrategyConfiguration,
} from "./botlogic/code/BotCode.js";
import { CODE_EDITOR_GRAPH_VERSION, sanitizeCodeEditorGraph } from "./botlogic/graph/CodeEditorGraph.js";
import { buildDeterministicLogicAction, idleAction } from "./botlogic/planner/ArenaActionPlanner.js";
import {
    buildBotSubmissionPayload,
    createBuildingSession,
    submitBotPayload
} from "./botlogic/submission/SubmissionClient.js";
import { isAbilityEntity, tickAbilityEntityWorld } from "./ecs/AbilityEntitySystem.js";
import { applyBotAction } from "./ecs/ActionExecutionSystem.js";
import { grenadeDamageToEntity, overlapsEntity, tickProjectileWorld } from "./ecs/ProjectileSystem.js";
import {
    applyDamageFromShapes,
    applyDamageToShape,
    resolveTriggeredAbilityCombat,
    settlePendingHealing,
} from "./gameconfig/BotCombatSystem.js";
import { abilityHitsTarget, triggeredAbilityDamage } from "./ecs/AbilityEffectSystem.js";
import {
    actionIdsForLoadoutConfiguration,
    DEFAULT_BOT_CONFIGURATION_ID,
} from "./gameconfig/CombatLoadouts.js";

import {
    AUTO_STEP_MS,
    ARENA_HEIGHT_UNITS,
    ARENA_WIDTH_UNITS,
    SESSION_KEY,
} from "./modelPayloads/arenaConstants.js";
import {
    buildAutoPlayStartShapes,
    buildInitialArenaShapes,
    buildOpponentShape,
    cloneShape,
    resetBotShape,
} from "./modelPayloads/arenaShapes.js";
import { buildAbilityTestingArenaShapes, findAbilityTestingPreset } from "./testing/AbilityTestingPresets.js";
import { stepAbilityTestingSimulation } from "./testing/AbilityTestingSimulation.js";
import { buildStatePayload } from "./modelPayloads/strategyStatePayload.js";
import {
    buildTutorialArenaShapes,
    getTutorialScenario,
    TUTORIAL_STEP_COUNT,
    validateBooleanCustomVariableLesson,
    validateCustomVariablesLesson,
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
const RESET_TUTORIAL_CHALLENGE_IDS = new Set(["rotate", "lock-on", "dodge", "custom-integer"]);

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

function applyActionToShape(shape, action, elapsedMs) {
    return applyBotAction(shape, action, elapsedMs, applyDamageToShape);
}

export default function Arena({
    matchContext = null,
    finishStatus = null,
    finishError = null,
    autoSubmitEnabled = false,
    onFinishMatch = null,
    onSurrenderMatch = null,
    onExit = null,
    tutorialMode = false,
    abilityTestingMode = false,
    abilityTestingPreset = null,
    abilityTestingRunToken = 0,
    onAbilityTestingPayloadChange = null,
    roomAside = null,
}) {
    const navigate = useNavigate();
    const location = useLocation();
    const initialTutorialStep = Math.max(0, Math.min(TUTORIAL_STEP_COUNT - 1, Number(location.state?.tutorialStep) || 0));
    const initialTutorialScenario = getTutorialScenario(initialTutorialStep);
    const catalogueAbilityId = location.pathname === "/beta"
        ? new URLSearchParams(location.search).get("ability")
        : null;
    const catalogueAbilityTestingPreset = findAbilityTestingPreset(catalogueAbilityId);
    const activeAbilityTestingPreset = abilityTestingMode ? abilityTestingPreset : catalogueAbilityTestingPreset;
    const matchId = matchContext?.matchId;
    const matchUserId = matchContext?.player?.userId;
    const isMatchTesting = Boolean(matchId && matchUserId);
    const isAbilityTesting = Boolean(activeAbilityTestingPreset?.id);
    const usesArenaResponsiveLimits = !tutorialMode;
    const playerRoundWins = Math.max(0, Number(matchContext?.player?.roundWins) || 0);
    const opponentRoundWins = Math.max(0, Number(matchContext?.opponent?.roundWins) || 0);
    const [selectedLoadout, setSelectedLoadout] = useState(() => tutorialMode
        ? initialTutorialScenario.playerLoadout
        : isAbilityTesting ? activeAbilityTestingPreset.playerLoadout
            : matchContext?.player?.selectedLoadout ?? DEFAULT_BOT_CONFIGURATION_ID);
    const [opponentLoadout, setOpponentLoadout] = useState(() => tutorialMode
        ? initialTutorialScenario.opponentLoadout
        : isAbilityTesting ? activeAbilityTestingPreset.opponentLoadout
            : matchContext?.opponent?.selectedLoadout ?? DEFAULT_BOT_CONFIGURATION_ID);
    const strategyStorageKey = matchStrategyConfigurationKey(matchId, matchUserId, selectedLoadout);
    const opponentStrategyStorageKey = opponentStrategyConfigurationKey(matchId, matchUserId, opponentLoadout);
    const [shapes, setShapes] = useState(() => tutorialMode
        ? buildTutorialArenaShapes(initialTutorialStep)
        : isAbilityTesting ? buildAbilityTestingArenaShapes(activeAbilityTestingPreset)
            : buildInitialArenaShapes(matchContext));
    const [selectedId, setSelectedId] = useState(null);
    const [submitStatus, setSubmitStatus] = useState(null);
    const [isAutoPlaying, setIsAutoPlaying] = useState(false);
    const [measurementEnabled, setMeasurementEnabled] = useState(false);
    const [measurementPoints, setMeasurementPoints] = useState([]);
    const [isBaseTesting] = useState(false);
    const [isEditingArena, setIsEditingArena] = useState(true);
    const [testingConfiguration, setTestingConfiguration] = useState(() => (
        sanitizeStrategyConfigurationForLoadout(
            (tutorialMode ? loadTutorialStrategyConfiguration(initialTutorialStep, initialTutorialScenario.emptyCode) : isAbilityTesting ? activeAbilityTestingPreset.playerCode : matchContext?.roundBrains?.at(-1)?.brain)
            ?? loadStoredStrategyConfiguration(strategyStorageKey),
            selectedLoadout,
        )
    ));
    const [opponentTestingConfiguration, setOpponentTestingConfiguration] = useState(() => (
        sanitizeStrategyConfigurationForLoadout(tutorialMode
            ? initialTutorialScenario.opponentCode
            : isAbilityTesting ? activeAbilityTestingPreset.opponentCode : loadStoredStrategyConfiguration(opponentStrategyStorageKey), opponentLoadout)
    ));
    const [buildingSessionId, setBuildingSessionId] = useState(() => isMatchTesting || isAbilityTesting
        ? null
        : localStorage.getItem(SESSION_KEY));
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
    const [solutionShown, setSolutionShown] = useState(() => tutorialMode
        ? loadTutorialBooleanState(TUTORIAL_SOLUTION_PREFIX, initialTutorialStep)
        : false);
    const [tutorialChallenge, setTutorialChallenge] = useState(() => tutorialChallengeForScenario(initialTutorialStep, initialTutorialScenario));

    const autoIntervalRef = useRef(null);
    const handleFinishMatchRef = useRef(null);
    const abilityTestingRunAutoPlayRef = useRef(null);
    const abilityTestingRunTokenRef = useRef(0);
    const tutorialRunRef = useRef(null);
    const tutorialResetTimerRef = useRef(null);
    const tutorialScenario = getTutorialScenario(tutorialStep);

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
        if (!isAbilityTesting) return;
        if (autoIntervalRef.current) {
            clearInterval(autoIntervalRef.current);
            autoIntervalRef.current = null;
        }
        const presetShapes = buildAbilityTestingArenaShapes(activeAbilityTestingPreset);
        setIsAutoPlaying(false);
        setIsEditingArena(true);
        setSelectedId(null);
        setSelectedLoadout(activeAbilityTestingPreset.playerLoadout);
        setOpponentLoadout(activeAbilityTestingPreset.opponentLoadout);
        setTestingConfiguration(sanitizeStrategyConfigurationForLoadout(activeAbilityTestingPreset.playerCode, activeAbilityTestingPreset.playerLoadout));
        setOpponentTestingConfiguration(sanitizeStrategyConfigurationForLoadout(activeAbilityTestingPreset.opponentCode, activeAbilityTestingPreset.opponentLoadout));
        setShapes(presetShapes);
    }, [activeAbilityTestingPreset, isAbilityTesting]);

    useEffect(() => {
        if (!isAbilityTesting || !onAbilityTestingPayloadChange) return;
        onAbilityTestingPayloadChange({
            playerLoadout: selectedLoadout,
            opponentLoadout,
            playerCode: { ...testingConfiguration, loadout: selectedLoadout },
            opponentCode: { ...opponentTestingConfiguration, loadout: opponentLoadout },
        });
    }, [
        isAbilityTesting,
        onAbilityTestingPayloadChange,
        opponentLoadout,
        opponentTestingConfiguration,
        selectedLoadout,
        testingConfiguration,
    ]);

    const ensureBuildingSession = useCallback(async ({ required = false } = {}) => {
        try {
            const session = await createBuildingSession(isMatchTesting ? matchId : null);
            const sessionId = session.buildingSessionId;
            if (!isMatchTesting) {
                localStorage.setItem(SESSION_KEY, sessionId);
            }
            setBuildingSessionId(sessionId);
            return sessionId;
        } catch (err) {
            console.warn("[arena-building] Unable to create server building session.", err);
            setSubmitStatus({
                ok: false,
                message: "Server building session unavailable",
            });
            setTimeout(() => setSubmitStatus(null), 3000);
            if (required) {
                throw err;
            }
            return null;
        }
    }, [isMatchTesting, matchId]);

    useEffect(() => {
        if (tutorialMode || isAbilityTesting) return undefined;
        const buildingSessionTimeoutId = window.setTimeout(() => ensureBuildingSession(), 0);

        return () => {
            window.clearTimeout(buildingSessionTimeoutId);
            if (autoIntervalRef.current) {
                clearInterval(autoIntervalRef.current);
            }
        };
    }, [ensureBuildingSession, isAbilityTesting, tutorialMode]);

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
        const nextConfiguration = isAbilityTesting ? { ...sanitized, loadout: selectedLoadout } : sanitized;
        setTestingConfiguration(nextConfiguration);
        saveStoredStrategyConfiguration(strategyStorageKey, nextConfiguration);
        if (tutorialMode) saveStoredStrategyConfiguration(tutorialStrategyConfigurationKey(tutorialStep), nextConfiguration);
    };

    const updateOpponentTestingConfiguration = (configuration) => {
        const sanitized = sanitizeStrategyConfigurationForLoadout(configuration, opponentLoadout);
        const nextConfiguration = isAbilityTesting ? { ...sanitized, loadout: opponentLoadout } : sanitized;
        setOpponentTestingConfiguration(nextConfiguration);
        saveStoredStrategyConfiguration(opponentStrategyStorageKey, nextConfiguration);
    };

    const openSandboxLoadout = (target) => {
        if (isMatchTesting || isAutoPlaying) return;
        const bot = shapes.find((shape) => shape.id === (target === "opponent" ? "opponent-model" : "main"));
        const source = String(bot?.combatLoadout).startsWith("sandbox:")
            ? decodeSandboxLoadout(bot.combatLoadout)
            : { abilities: bot?.abilities ?? [], statPoints: { maxHp: 0, moveSpeed: 0, attackDamage: 0, attackSpeed: 0 } };
        setSandboxLoadoutDraft(normalizedSandboxLoadout(source));
        setSandboxLoadoutTarget(target);
    };

    const applySandboxLoadout = () => {
        const id = sandboxLoadoutTarget === "opponent" ? "opponent-model" : "main";
        const encoded = encodeSandboxLoadout(sandboxLoadoutDraft);
        if (id === "main") {
            setSelectedLoadout(encoded);
            setTestingConfiguration((current) => sanitizeStrategyConfigurationForLoadout({ ...current, loadout: encoded }, encoded));
        } else {
            setOpponentLoadout(encoded);
            setOpponentTestingConfiguration((current) => sanitizeStrategyConfigurationForLoadout({ ...current, loadout: encoded }, encoded));
        }
        setShapes((current) => current.map((shape) => shape.id === id
            ? resetBotShape({ ...shape, combatLoadout: encoded })
            : shape));
        setSandboxLoadoutTarget(null);
    };

    const handleUpdateShape = useCallback((id, updates) => {
        setShapes((previous) => previous.map((shape) => (
            shape.id === id && !shape.locked ? { ...shape, ...updates } : shape
        )));
    }, []);

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

    const runAutoPlay = () => {
        if (isAutoPlaying) return;
        const setupValidationGoal = tutorialMode && ["code_search", "custom_boolean", "custom_integer"].includes(tutorialScenario.goal);
        const setupValidationPassed = setupValidationGoal
            ? tutorialScenario.goal === "code_search"
                ? validateSearchNodesLesson(testingConfiguration)
                : tutorialScenario.goal === "custom_boolean"
                    ? validateBooleanCustomVariableLesson(testingConfiguration)
                    : validateCustomVariablesLesson(testingConfiguration)
            : false;
        setIsEditingArena(false);
        setIsAutoPlaying(true);
        setSelectedId(null);
        if (tutorialMode) {
            const freshShapes = buildTutorialArenaShapes(tutorialStep);
            const main = freshShapes.find((shape) => shape.id === "main");
            const opponent = freshShapes.find((shape) => shape.id === "opponent-model");
            tutorialRunRef.current = tutorialScenario.durationMs ? {
                deadline: Date.now() + tutorialScenario.durationMs,
                durationMs: tutorialScenario.durationMs,
                goal: tutorialScenario.goal,
                playerHp: main.hp,
                opponentHp: opponent.hp,
            } : null;
            if (setupValidationPassed || (!setupValidationGoal && !tutorialScenario.durationMs)) {
                saveTutorialBooleanState(TUTORIAL_COMPLETION_PREFIX, tutorialStep, true);
            }
            setTutorialChallenge((current) => setupValidationGoal ? {
                status: setupValidationPassed ? "passed" : "failed",
                remainingMs: 0,
                completed: current.completed || setupValidationPassed,
                code: tutorialScenario.goal === "code_search"
                    ? setupValidationPassed ? "search_passed" : "search_failed"
                    : tutorialScenario.goal === "custom_boolean"
                        ? setupValidationPassed ? "boolean_passed" : "boolean_failed"
                        : setupValidationPassed ? "variables_passed" : "variables_failed",
            } : {
                status: tutorialScenario.durationMs ? "running" : "idle",
                remainingMs: tutorialScenario.durationMs ?? 0,
                completed: current.completed || !tutorialScenario.durationMs,
                code: tutorialScenario.durationMs ? "reading_code" : "demonstration_running",
            });
            setShapes(freshShapes);
        } else if (!isAbilityTesting) {
            setShapes((prevShapes) => buildAutoPlayStartShapes(prevShapes, matchContext, isMatchTesting));
        }

        autoIntervalRef.current = setInterval(() => {
            setShapes((prevShapes) => {
                if (isAbilityTesting) {
                    return stepAbilityTestingSimulation(prevShapes, {
                        playerCode: testingConfiguration,
                        opponentCode: opponentTestingConfiguration,
                        playerLoadout: selectedLoadout,
                        opponentLoadout,
                        stepMs: AUTO_STEP_MS,
                    });
                }
                const stateSnapshot = buildStatePayload(prevShapes, selectedLoadout);
                const mainBefore = prevShapes.find((s) => s.id === "main");
                const opponentBefore = prevShapes.find((s) => s.id === "opponent-model");
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
                let grenadeShapes = prevShapes.filter((shape) => shape.type === "grenade" || shape.type === "grenadeExplosion");
                grenadeShapes.push(...[mainAfter.thrownGrenade, opponentAfter?.thrownGrenade].filter(Boolean));
                let fireballShapes = prevShapes.filter((shape) => shape.type === "fireball");
                fireballShapes.push(...[mainAfter.thrownFireball, opponentAfter?.thrownFireball].filter(Boolean));
                let abilityEntities = prevShapes.filter(isAbilityEntity);
                for (const spawn of [mainAfter.abilitySpawn, opponentAfter?.abilitySpawn].filter(Boolean)) {
                    abilityEntities.push(spawn);
                }
                mainAfter = { ...mainAfter, thrownGrenade: null };
                mainAfter = { ...mainAfter, thrownFireball: null };
                if (opponentAfter) opponentAfter = { ...opponentAfter, thrownGrenade: null };
                if (opponentAfter) opponentAfter = { ...opponentAfter, thrownFireball: null };
                mainAfter = { ...mainAfter, abilitySpawn: null };
                if (opponentAfter) opponentAfter = { ...opponentAfter, abilitySpawn: null };

                if (opponentAfter) {
                    [mainAfter, opponentAfter] = resolveTriggeredAbilityCombat(mainAfter, opponentAfter);
                } else {
                    [mainAfter, opponentAfter] = resolveTriggeredAbilityCombat(mainAfter, opponentAfter);
                }
                const projectileUpdate = tickProjectileWorld({
                    bots: opponentAfter ? [mainAfter, opponentAfter] : [mainAfter],
                    grenades: grenadeShapes,
                    fireballs: fireballShapes,
                    stepMs: AUTO_STEP_MS,
                    width: ARENA_WIDTH_UNITS,
                    height: ARENA_HEIGHT_UNITS,
                }, { applyDamageToShape, applyDamageFromShapes });
                const grenadeExploded = (projectileUpdate.grenadeExplosions ?? []).some((explosion) => explosion.ownerId === "opponent-model");
                [mainAfter] = projectileUpdate.bots;
                if (opponentAfter) opponentAfter = projectileUpdate.bots[1];
                grenadeShapes = projectileUpdate.grenades;
                fireballShapes = projectileUpdate.fireballs;
                const entityUpdate = tickAbilityEntityWorld({
                    entities: abilityEntities,
                    bots: opponentAfter ? [mainAfter, opponentAfter] : [mainAfter],
                    grenades: grenadeShapes,
                    fireballs: fireballShapes,
                    stepMs: AUTO_STEP_MS,
                    width: ARENA_WIDTH_UNITS,
                    height: ARENA_HEIGHT_UNITS,
                }, {
                    applyDamageToShape,
                    applyDamageFromShapes,
                    abilityHitsTarget,
                    triggeredAbilityDamage,
                    grenadeDamageToBot: grenadeDamageToEntity,
                    overlapsShape: overlapsEntity,
                });
                [mainAfter] = entityUpdate.bots;
                if (opponentAfter) opponentAfter = entityUpdate.bots[1];
                mainAfter = settlePendingHealing(mainAfter);
                if (opponentAfter) opponentAfter = settlePendingHealing(opponentAfter);
                mainAfter = finalizeTickMeasurements(mainAfter, mainBefore);
                if (opponentAfter) opponentAfter = finalizeTickMeasurements(opponentAfter, opponentBefore);
                abilityEntities = entityUpdate.entities;
                if (tutorialMode && tutorialRunRef.current && opponentAfter) {
                    const run = tutorialRunRef.current;
                    const remainingMs = Math.max(0, run.deadline - Date.now());
                    const hit = opponentAfter.hp < run.opponentHp;
                    const tookDamage = mainAfter.hp < run.playerHp;
                    const survived = Number(mainAfter.hp) > 0;
                    const passed = run.goal === "survive"
                        ? remainingMs === 0 && survived
                        : run.goal === "heavy_slash"
                            ? hit
                            : run.goal === "combo"
                                ? hit && !tookDamage
                                : run.goal === "dodge_grenade"
                                    ? grenadeExploded && !tookDamage
                                    : false;
                    const failed = run.goal === "survive" ? !survived : tookDamage || remainingMs === 0;
                    const code = passed
                        ? run.goal === "survive" ? "survive_passed"
                            : run.goal === "heavy_slash" ? "heavy_slash_passed"
                                : run.goal === "combo" ? "combo_passed" : "dodge_passed"
                        : failed
                            ? run.goal === "survive" ? "survive_defeated"
                                : run.goal === "heavy_slash" ? "heavy_slash_timed_out"
                                    : run.goal === "combo" ? tookDamage ? "combo_took_damage" : "combo_timed_out"
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
                return [mainAfter, ...(opponentAfter ? [opponentAfter] : []), ...grenadeShapes, ...fireballShapes, ...abilityEntities];
            });
        }, AUTO_STEP_MS);
    };

    abilityTestingRunAutoPlayRef.current = runAutoPlay;

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

    useEffect(() => {
        if (!isAbilityTesting || !abilityTestingRunToken || abilityTestingRunTokenRef.current === abilityTestingRunToken) return undefined;
        abilityTestingRunTokenRef.current = abilityTestingRunToken;
        const timeoutId = window.setTimeout(() => abilityTestingRunAutoPlayRef.current?.(), 0);
        return () => window.clearTimeout(timeoutId);
    }, [abilityTestingRunToken, isAbilityTesting]);

    const resetArenaStats = () => {
        setSelectedId(null);
        setShapes((prevShapes) => prevShapes
            .filter((shape) => shape.type !== "grenade" && shape.type !== "grenadeExplosion")
            .filter((shape) => shape.type !== "fireball")
            .filter((shape) => !["proximityMine", "mineExplosion", "orbitalMarker", "orbitalExplosion", "windburstProjectile"].includes(shape.type))
            .map((shape) => (shape.id === "main" || shape.id === "opponent-model")
                ? resetBotShape(shape)
                : cloneShape(shape)));
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
        setSubmitStatus({ ok: null, message: "Submitting bot code..." });

        try {
            const activeBuildingSessionId = buildingSessionId ?? await ensureBuildingSession({ required: true });
            if (!activeBuildingSessionId) {
                throw new Error("A server building session is required before submission.");
            }
            const configuration = normalizeAbilityStrategyConfiguration(
                sanitizeStrategyConfigurationForLoadout(testingConfiguration, selectedLoadout),
            );
            const payload = await buildBotSubmissionPayload({
                code: configuration,
                matchId: isMatchTesting ? matchId : null,
                buildingSessionId: activeBuildingSessionId,
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
        if (!onFinishMatch || finishStatus === "FINISHED" || finishStatus === "SURRENDERED" || isFinishingMatch) return;
        setIsFinishingMatch(true);

        const result = await handleSubmitBot({ preserveStatus: true });

        if (result && result.accepted !== false) {
            onFinishMatch();
            setSubmitStatus({ ok: true, message: "Successfully submitted." });
        } else {
            setIsFinishingMatch(false);
        }
    };
    handleFinishMatchRef.current = handleFinishMatch;
    useEffect(() => {
        const testingDeadline = matchContext?.buildingEndsAtMs ?? matchContext?.buildingEndsAt;
        if (!testingDeadline || !onFinishMatch) return;

        const interval = setInterval(() => {
            const remaining = secondsRemaining(testingDeadline);
            setTestingRemaining(remaining);
            if (remaining === 0) {
                clearInterval(interval);
                if (autoSubmitEnabled) void handleFinishMatchRef.current?.();
            }
        }, 100);

        return () => clearInterval(interval);
    }, [autoSubmitEnabled, matchContext?.buildingEndsAt, matchContext?.buildingEndsAtMs, onFinishMatch]);

    return (
        <div className={`flex h-screen flex-col text-ink-hi font-ui overflow-hidden ${isMatchTesting ? "match-arena-shell" : "bg-arena-deep"}`}>
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

            <AppNavbar account={!matchContext && !tutorialMode} onHome={onExit} />

            <div className="flex min-h-0 flex-1 overflow-hidden">
                {roomAside}
                <main className={`min-w-0 flex-1 flex items-center justify-center overflow-hidden p-2 ${isMatchTesting ? "match-arena-stage" : "bg-arena-deep"}`}>
                    <div
                        className="relative flex h-full w-full items-center justify-center"
                    >
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
                            measurementEnabled={measurementEnabled}
                            measurementPoints={measurementPoints}
                            onMeasurementPointsChange={setMeasurementPoints}
                            isPlaying={isAutoPlaying}
                        />
                    </div>
                </main>

                        <CodingPanel
                    configuration={testingConfiguration}
                    onChange={updateTestingConfiguration}
                    opponentConfiguration={tutorialMode ? null : opponentTestingConfiguration}
                    onOpponentChange={tutorialMode ? null : updateOpponentTestingConfiguration}
                    selectedLoadout={selectedLoadout}
                    opponentLoadout={opponentLoadout}
                    isMatchTesting={isMatchTesting}
                    usesArenaResponsiveLimits={usesArenaResponsiveLimits}
                    matchContext={matchContext}
                    testingRemaining={testingRemaining}
                    playerRoundWins={playerRoundWins}
                    opponentRoundWins={opponentRoundWins}
                    isAutoPlaying={isAutoPlaying}
                    measurementEnabled={measurementEnabled}
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
                    onOpenPlayerLoadout={!isMatchTesting && !tutorialMode ? () => openSandboxLoadout("player") : null}
                    onOpenOpponentLoadout={!isMatchTesting && !tutorialMode && shapes.some((shape) => shape.id === "opponent-model") ? () => openSandboxLoadout("opponent") : null}
                    tutorialMode={tutorialMode}
                    tutorialStep={tutorialStep}
                    onShowTutorialSolution={toggleTutorialSolution}
                    tutorialGuideProps={tutorialMode ? {
                        step: tutorialStep,
                        onStepChange: handleTutorialStepChange,
                        challenge: tutorialChallenge,
                        onAbilityCatalogue: () => navigate("/ability-catalogue"),
                        onConditionalCatalogue: () => navigate("/conditionals"),
                        onShowSolution: toggleTutorialSolution,
                        solutionShown,
                    } : null}
                />
            </div>
            {sandboxLoadoutTarget && (
                <div ref={sandboxDialogRef} className="fixed inset-0 z-[100] flex items-center justify-center overflow-y-auto bg-black/75 p-4" role="dialog" aria-modal="true" aria-labelledby="sandbox-loadout-title" tabIndex={-1}>
                    <div className="max-h-[92vh] w-full max-w-4xl overflow-y-auto rounded-xl border border-zinc-600 bg-zinc-800 p-5 shadow-2xl">
                        <div className="flex items-start justify-between gap-4">
                            <div><p className="font-mono text-[10px] tracking-[0.25em] text-cyan">BOT ROOM SANDBOX</p><h2 id="sandbox-loadout-title" className="mt-2 text-2xl font-bold text-ink-white">{sandboxLoadoutTarget === "opponent" ? "Opponent" : "Your bot"} loadout</h2><p className="mt-1 text-sm text-ink-muted">Equip any combination and experiment with up to {SANDBOX_MAX_STAT_POINTS} points per stat.</p></div>
                            <button type="button" onClick={() => setSandboxLoadoutTarget(null)} aria-label="Close sandbox loadout editor" className="min-h-11 rounded border border-border-lo px-3 font-mono text-xs text-ink-muted">CLOSE</button>
                        </div>
                        <div className="mt-5 grid gap-5 lg:grid-cols-[1.4fr_1fr]">
                            <div className="space-y-5">
                                {[1, 2, 3].map((round) => <section key={round}><div className="mb-2 border-b border-border-lo pb-1 font-mono text-[10px] font-bold tracking-widest text-cyan">ROUND {round}</div><div className="grid gap-2 sm:grid-cols-2">
                                    {SELECTABLE_BOT_ABILITIES.filter((ability) => ability.round === round).map((ability) => {
                                        const selected = sandboxLoadoutDraft.abilities.includes(ability.id);
                                        return <button type="button" key={ability.id} onClick={() => setSandboxLoadoutDraft((current) => normalizedSandboxLoadout({ ...current, abilities: selected ? current.abilities.filter((id) => id !== ability.id) : [...current.abilities, ability.id] }))} className={`rounded border p-3 text-left ${selected ? "border-cyan bg-cyan-950/30" : "border-border-lo bg-arena-panel"}`}><span className="font-mono text-[10px] font-bold tracking-widest text-ink-white">{selected ? "EQUIPPED - " : ""}{ability.label}</span><span className="ml-2 font-mono text-[8px] text-cyan">{ability.kind.toUpperCase()}</span><p className="mt-1 text-xs text-ink-muted">{ability.summary}</p></button>;
                                    })}
                                </div></section>)}
                            </div>
                            <div className="rounded border border-border-lo bg-arena-panel p-4">
                                <div className="font-mono text-[10px] tracking-widest text-cyan">SANDBOX STATS</div>
                                {[["maxHp", "HP"], ["moveSpeed", "MOVE"], ["attackDamage", "DAMAGE"], ["attackSpeed", "ATTACK SPEED"]].map(([key, label]) => {
                                    const stats = botStatsForSandboxLoadout(sandboxLoadoutDraft);
                                    const value = key === "maxHp" ? stats.maxHp : key === "moveSpeed" ? stats.moveSpeed : key === "attackDamage" ? `${stats.attackDamagePercent}%` : `${stats.attackSpeedPercent}%`;
                                    return <div key={key} className="mt-4"><div className="flex items-center justify-between"><span className="font-mono text-[9px] tracking-widest text-ink-muted">{label}</span><span className="font-mono text-xs text-ink-white">{value}</span></div><div className="mt-1 flex items-center gap-2"><button type="button" aria-label={`Decrease ${label}`} onClick={() => setSandboxLoadoutDraft((current) => normalizedSandboxLoadout({ ...current, statPoints: { ...current.statPoints, [key]: current.statPoints[key] - 1 } }))} className="h-11 min-h-11 min-w-11 w-11 border border-border-lo">-</button><input id={`sandbox-${key}`} name={key} type="range" min="0" max={SANDBOX_MAX_STAT_POINTS} value={sandboxLoadoutDraft.statPoints[key]} aria-label={`${label} stat points`} onChange={(event) => setSandboxLoadoutDraft((current) => normalizedSandboxLoadout({ ...current, statPoints: { ...current.statPoints, [key]: Number(event.target.value) } }))} className="min-w-0 flex-1" /><button type="button" aria-label={`Increase ${label}`} onClick={() => setSandboxLoadoutDraft((current) => normalizedSandboxLoadout({ ...current, statPoints: { ...current.statPoints, [key]: current.statPoints[key] + 1 } }))} className="h-11 min-h-11 min-w-11 w-11 border border-border-lo">+</button></div></div>;
                                })}
                            </div>
                        </div>
                        <div className="mt-5 flex justify-end"><button type="button" onClick={applySandboxLoadout} className="h-11 rounded border border-green-700/70 bg-green-900/30 px-6 font-mono text-[11px] font-bold tracking-widest text-green-200">APPLY LOADOUT</button></div>
                    </div>
                </div>
            )}
        </div>
    );
}
