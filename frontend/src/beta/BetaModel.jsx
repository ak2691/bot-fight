import { useState, useCallback, useEffect, useRef } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import AppNavbar from "../components/AppNavbar";
import PixiCanvas from "./PixiCanvas";
import StrategyTrainingPanel from "./StrategyTrainingPanel";
import { BOT_ABILITIES, PROTOTYPE_ACTION_TO_ABILITY, SANDBOX_MAX_STAT_POINTS, botStatsForSandboxLoadout, decodeSandboxLoadout, encodeSandboxLoadout, normalizedSandboxLoadout } from "./loadout/BotLoadout.js";
import {
    createDefaultMeleeStrategyConfiguration,
    hasMeleeStrategyActions,
    normalizeMeleeStrategyConfiguration,
} from "../logic/BotBrain.js";
import { buildDeterministicLogicAction, idleAction } from "../logic/ArenaActionPlanner.js";
import {
    buildModelSubmissionPayload,
    createTrainingSession,
    submitModelPayload
} from "../logic/SubmissionClient.js";
import { isAbilityEntity, tickAbilityEntityWorld } from "./ecs/AbilityEntitySystem.js";
import { applyFighterAction } from "./ecs/ActionExecutionSystem.js";
import { grenadeDamageToEntity, overlapsEntity, tickProjectileWorld } from "./ecs/ProjectileSystem.js";
import {
    applyDamageFromShapes,
    applyDamageToShape,
    applyStunHits,
    attackerDamageMultiplier,
    incomingGunDamage,
    incomingMeleeDamage,
    isSwingHitting,
    resolveBasicCombat,
    resolvePrototypeCombat,
    settlePendingHealing,
    stunHits,
} from "./combat/FighterCombatSystem.js";
import {
    actionIdsForLoadoutConfiguration,
    DEFAULT_BOT_CONFIGURATION_ID,
} from "./combat/CombatLoadouts.js";

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
    cloneShapes,
    resetArenaStartShapes,
    resetFighterShape,
} from "./modelPayloads/arenaShapes.js";
import { buildStatePayload } from "./modelPayloads/strategyStatePayload.js";
import {
    buildTutorialArenaShapes,
    getTutorialScenario,
    TUTORIAL_STEP_COUNT,
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
        : `arena-training-strategy-v1-${loadoutId}`;
}

function opponentStrategyConfigurationKey(matchId, userId, loadoutId) {
    return matchId && userId
        ? `arena-match-opponent-strategy-v1-${loadoutId}-${matchId}-${userId}`
        : `arena-training-opponent-strategy-v1-${loadoutId}`;
}

function loadStoredStrategyConfiguration(key) {
    if (!key) return createDefaultMeleeStrategyConfiguration();
    try {
        const stored = localStorage.getItem(key);
        return stored
            ? normalizeMeleeStrategyConfiguration(JSON.parse(stored))
            : createDefaultMeleeStrategyConfiguration();
    } catch {
        return createDefaultMeleeStrategyConfiguration();
    }
}

const STRATEGY_STORAGE_PREFIXES = Object.freeze([
    "arena-training-strategy-v1-",
    "arena-training-opponent-strategy-v1-",
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
        console.warn("[arena-logic] Browser storage is full; the current brain remains available in memory but was not persisted.");
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
        : createDefaultMeleeStrategyConfiguration();
    const allowedActionIds = new Set(actionIdsForLoadoutConfiguration(loadoutId));
    const sanitizeBlock = (block) => {
        if (!block || typeof block !== "object") return block;
        return allowedActionIds.has(block.action)
            ? block
            : { ...block, action: "move_stop", actionTarget: "opponent" };
    };
    return {
        ...source,
        blocks: Array.isArray(source.blocks) ? source.blocks.map(sanitizeBlock) : [],
        clusters: Array.isArray(source.clusters) ? source.clusters.map((cluster) => ({
            ...cluster,
            blocks: Array.isArray(cluster?.blocks) ? cluster.blocks.map(sanitizeBlock) : [],
        })) : [],
    };
}

function countStrategyBlocks(configuration) {
    const normalized = normalizeMeleeStrategyConfiguration(configuration);
    return normalized.blocks.length + normalized.clusters.reduce((total, cluster) => total + cluster.blocks.length, 0);
}

function secondsRemaining(targetTime) {
    if (!targetTime) return null;
    const targetMs = typeof targetTime === "number"
        ? targetTime
        : new Date(targetTime).getTime();
    if (!Number.isFinite(targetMs)) return null;
    return Math.max(0, Math.ceil((targetMs - Date.now()) / 1000));
}

function applyActionToShape(shape, action, elapsedMs) {
    return applyFighterAction(shape, action, elapsedMs, applyDamageToShape);
}

export default function BetaModel({
    matchContext = null,
    finishStatus = null,
    finishError = null,
    onFinishMatch = null,
    onSurrenderMatch = null,
    onExit = null,
    tutorialMode = false,
}) {
    const navigate = useNavigate();
    const location = useLocation();
    const initialTutorialStep = Math.max(0, Math.min(TUTORIAL_STEP_COUNT - 1, Number(location.state?.tutorialStep) || 0));
    const initialTutorialScenario = getTutorialScenario(initialTutorialStep);
    const matchId = matchContext?.matchId;
    const matchUserId = matchContext?.player?.userId;
    const isMatchTraining = Boolean(matchId && matchUserId);
    const usesArenaResponsiveLimits = !tutorialMode;
    const playerRoundWins = Math.max(0, Number(matchContext?.player?.roundWins) || 0);
    const opponentRoundWins = Math.max(0, Number(matchContext?.opponent?.roundWins) || 0);
    const [selectedLoadout, setSelectedLoadout] = useState(() => tutorialMode ? initialTutorialScenario.playerLoadout : matchContext?.player?.selectedClass ?? DEFAULT_BOT_CONFIGURATION_ID);
    const [opponentLoadout, setOpponentLoadout] = useState(() => tutorialMode ? initialTutorialScenario.opponentLoadout : matchContext?.opponent?.selectedClass ?? DEFAULT_BOT_CONFIGURATION_ID);
    const strategyStorageKey = matchStrategyConfigurationKey(matchId, matchUserId, selectedLoadout);
    const opponentStrategyStorageKey = opponentStrategyConfigurationKey(matchId, matchUserId, opponentLoadout);
    const [shapes, setShapes] = useState(() => tutorialMode ? buildTutorialArenaShapes(initialTutorialStep) : buildInitialArenaShapes(matchContext));
    const [selectedId, setSelectedId] = useState(null);
    const [submitStatus, setSubmitStatus] = useState(null);
    const [isAutoPlaying, setIsAutoPlaying] = useState(false);
    const [hasArenaCheckpoint, setHasArenaCheckpoint] = useState(false);
    const [measurementEnabled, setMeasurementEnabled] = useState(false);
    const [measurementPoints, setMeasurementPoints] = useState([]);
    const [isBaseTraining] = useState(false);
    const [baseCandidate] = useState(null);
    const [baseExportState] = useState("idle");
    const [isEditingArena, setIsEditingArena] = useState(true);
    const [trainingConfiguration, setTrainingConfiguration] = useState(() => (
        sanitizeStrategyConfigurationForLoadout(
            (tutorialMode ? initialTutorialScenario.emptyBrain : matchContext?.roundBrains?.at(-1)?.brain)
            ?? loadStoredStrategyConfiguration(strategyStorageKey),
            selectedLoadout,
        )
    ));
    const [opponentTrainingConfiguration, setOpponentTrainingConfiguration] = useState(() => (
        sanitizeStrategyConfigurationForLoadout(tutorialMode ? initialTutorialScenario.opponentBrain : loadStoredStrategyConfiguration(opponentStrategyStorageKey), opponentLoadout)
    ));
    const [isStrategyTraining, setIsStrategyTraining] = useState(false);
    const [, setTrainingProgress] = useState(null);
    const [, setTrainingSummary] = useState(null);
    const [trainingSessionId, setTrainingSessionId] = useState(() => isMatchTraining
        ? null
        : localStorage.getItem(SESSION_KEY));
    const [submittedModelId, setSubmittedModelId] = useState(null);
    const [isFinishingMatch, setIsFinishingMatch] = useState(false);
    const [trainingRemaining, setTrainingRemaining] = useState(() =>
        secondsRemaining(matchContext?.trainingEndsAtMs ?? matchContext?.trainingEndsAt));
    const [sandboxLoadoutTarget, setSandboxLoadoutTarget] = useState(null);
    const [sandboxLoadoutDraft, setSandboxLoadoutDraft] = useState(() => normalizedSandboxLoadout(null));
    const [tutorialStep, setTutorialStep] = useState(initialTutorialStep);
    const [solutionShown, setSolutionShown] = useState(false);
    const [tutorialChallenge, setTutorialChallenge] = useState({ status: "idle", remainingMs: initialTutorialScenario.durationMs ?? 0, code: "ready" });

    const autoIntervalRef = useRef(null);
    const originalArenaShapesRef = useRef(null);
    const arenaCheckpointShapesRef = useRef(null);
    const finishHandlerRef = useRef(null);
    const trainingRunRef = useRef(null);
    const tutorialRunRef = useRef(null);
    const tutorialScenario = getTutorialScenario(tutorialStep);

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
        setTrainingConfiguration(sanitizeStrategyConfigurationForLoadout(scenario.emptyBrain, scenario.playerLoadout));
        setOpponentTrainingConfiguration(sanitizeStrategyConfigurationForLoadout(scenario.opponentBrain, scenario.opponentLoadout));
        setShapes(lessonShapes);
        originalArenaShapesRef.current = cloneShapes(lessonShapes);
        arenaCheckpointShapesRef.current = null;
        setHasArenaCheckpoint(false);
        setSolutionShown(false);
        setTutorialChallenge({ status: "idle", remainingMs: scenario.durationMs ?? 0, code: "ready" });
    }, [tutorialMode, tutorialStep]);

    useEffect(() => {
        if (!originalArenaShapesRef.current) {
            originalArenaShapesRef.current = resetArenaStartShapes(
                cloneShapes(shapes),
                selectedLoadout,
                opponentLoadout,
            );
        }
    }, [opponentLoadout, selectedLoadout, shapes]);

    const ensureTrainingSession = useCallback(async ({ required = false } = {}) => {
        try {
            const session = await createTrainingSession(isMatchTraining ? matchId : null);
            if (!isMatchTraining) {
                localStorage.setItem(SESSION_KEY, session.trainingSessionId);
            }
            setTrainingSessionId(session.trainingSessionId);
            return session.trainingSessionId;
        } catch (err) {
            console.warn("[arena-ml] Unable to create server training session.", err);
            setSubmitStatus({
                ok: false,
                message: "Server training session unavailable",
            });
            setTimeout(() => setSubmitStatus(null), 3000);
            if (required) {
                throw err;
            }
            return null;
        }
    }, [isMatchTraining, matchId]);

    useEffect(() => {
        if (tutorialMode) return undefined;
        const trainingSessionTimeoutId = window.setTimeout(() => ensureTrainingSession(), 0);

        return () => {
            window.clearTimeout(trainingSessionTimeoutId);
            if (autoIntervalRef.current) {
                clearInterval(autoIntervalRef.current);
            }
        };
    }, [ensureTrainingSession, tutorialMode]);

    useEffect(() => {
        if (!matchContext?.opponent) return;
        const timeoutId = window.setTimeout(() => {
            setShapes((prev) => {
                if (prev.some((shape) => shape.type === "opponentModel")) {
                    return prev.map((shape) => shape.type === "opponentModel"
                        ? {
                            ...shape,
                            ...resetFighterShape({
                                ...shape,
                                combatClass: matchContext.opponent.selectedClass ?? shape.combatClass,
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

    const updateTrainingConfiguration = (configuration) => {
        const sanitized = sanitizeStrategyConfigurationForLoadout(configuration, selectedLoadout);
        setTrainingConfiguration(sanitized);
        saveStoredStrategyConfiguration(strategyStorageKey, sanitized);
    };

    const updateOpponentTrainingConfiguration = (configuration) => {
        const sanitized = sanitizeStrategyConfigurationForLoadout(configuration, opponentLoadout);
        setOpponentTrainingConfiguration(sanitized);
        saveStoredStrategyConfiguration(opponentStrategyStorageKey, sanitized);
    };

    const openSandboxLoadout = (target) => {
        if (isMatchTraining || isAutoPlaying || isStrategyTraining) return;
        const fighter = shapes.find((shape) => shape.id === (target === "opponent" ? "opponent-model" : "main"));
        const source = String(fighter?.combatClass).startsWith("sandbox:")
            ? decodeSandboxLoadout(fighter.combatClass)
            : { abilities: fighter?.abilities ?? [], statPoints: { maxHp: 0, moveSpeed: 0, attackDamage: 0, attackSpeed: 0 } };
        setSandboxLoadoutDraft(normalizedSandboxLoadout(source));
        setSandboxLoadoutTarget(target);
    };

    const applySandboxLoadout = () => {
        const id = sandboxLoadoutTarget === "opponent" ? "opponent-model" : "main";
        const encoded = encodeSandboxLoadout(sandboxLoadoutDraft);
        if (id === "main") setSelectedLoadout(encoded);
        else setOpponentLoadout(encoded);
        setShapes((current) => current.map((shape) => shape.id === id
            ? resetFighterShape({ ...shape, combatClass: encoded })
            : shape));
        setSandboxLoadoutTarget(null);
    };

    const handleSpawnOpponent = useCallback(() => {
        setShapes((prev) => {
            const existingOpponent = prev.find((shape) => shape.id === "opponent-model");
            if (existingOpponent) {
                setSelectedId(existingOpponent.id);
                return prev;
            }
            const nextShape = buildOpponentShape({ selectedLoadout: opponentLoadout, slot: 2 });
            setSelectedId(nextShape.id);
            return [...prev, nextShape];
        });
    }, [opponentLoadout]);

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
        const setupValidationGoal = tutorialMode && ["brain_search", "custom_variables"].includes(tutorialScenario.goal);
        const setupValidationPassed = setupValidationGoal
            ? tutorialScenario.goal === "brain_search"
                ? validateSearchNodesLesson(trainingConfiguration)
                : validateCustomVariablesLesson(trainingConfiguration)
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
            setTutorialChallenge(setupValidationGoal ? {
                status: setupValidationPassed ? "passed" : "failed",
                remainingMs: 0,
                code: tutorialScenario.goal === "brain_search"
                    ? setupValidationPassed ? "search_passed" : "search_failed"
                    : setupValidationPassed ? "variables_passed" : "variables_failed",
            } : {
                status: tutorialScenario.durationMs ? "running" : "idle",
                remainingMs: tutorialScenario.durationMs ?? 0,
                code: tutorialScenario.durationMs ? "reading_brain" : "demonstration_running",
            });
            setShapes(freshShapes);
        } else {
            setShapes((prevShapes) => buildAutoPlayStartShapes(prevShapes, matchContext, isMatchTraining));
        }

        autoIntervalRef.current = setInterval(() => {
            setShapes((prevShapes) => {
                const stateSnapshot = buildStatePayload(prevShapes, selectedLoadout);
                const mainBefore = prevShapes.find((s) => s.id === "main");
                const opponentBefore = prevShapes.find((s) => s.id === "opponent-model");
                const playerPredictedAction = buildDeterministicLogicAction(trainingConfiguration, stateSnapshot);
                const opponentPredictedAction = opponentBefore && hasMeleeStrategyActions(opponentTrainingConfiguration)
                    ? buildDeterministicLogicAction(opponentTrainingConfiguration, buildStatePayload(prevShapes, opponentLoadout, "opponent-model"))
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
                let prototypePlacementShapes = prevShapes.filter(isAbilityEntity);
                for (const spawn of [mainAfter.prototypeSpawn, opponentAfter?.prototypeSpawn].filter(Boolean)) {
                    prototypePlacementShapes.push(spawn);
                }
                mainAfter = { ...mainAfter, thrownGrenade: null };
                mainAfter = { ...mainAfter, thrownFireball: null };
                if (opponentAfter) opponentAfter = { ...opponentAfter, thrownGrenade: null };
                if (opponentAfter) opponentAfter = { ...opponentAfter, thrownFireball: null };
                mainAfter = { ...mainAfter, prototypeSpawn: null };
                if (opponentAfter) opponentAfter = { ...opponentAfter, prototypeSpawn: null };

                if (opponentAfter) {
                    [mainAfter, opponentAfter] = resolveBasicCombat(mainAfter, opponentAfter);
                    [mainAfter, opponentAfter] = resolvePrototypeCombat(mainAfter, opponentAfter);
                    [mainAfter, opponentAfter] = applyStunHits([mainAfter, opponentAfter]);
                } else {
                    [mainAfter, opponentAfter] = resolvePrototypeCombat(mainAfter, opponentAfter);
                }
                const projectileUpdate = tickProjectileWorld({
                    fighters: opponentAfter ? [mainAfter, opponentAfter] : [mainAfter],
                    grenades: grenadeShapes,
                    fireballs: fireballShapes,
                    stepMs: AUTO_STEP_MS,
                    width: ARENA_WIDTH_UNITS,
                    height: ARENA_HEIGHT_UNITS,
                }, { applyDamageToShape });
                [mainAfter] = projectileUpdate.fighters;
                if (opponentAfter) opponentAfter = projectileUpdate.fighters[1];
                grenadeShapes = projectileUpdate.grenades;
                fireballShapes = projectileUpdate.fireballs;
                const placementUpdate = tickAbilityEntityWorld({
                    entities: prototypePlacementShapes,
                    fighters: opponentAfter ? [mainAfter, opponentAfter] : [mainAfter],
                    grenades: grenadeShapes,
                    fireballs: fireballShapes,
                    stepMs: AUTO_STEP_MS,
                    width: ARENA_WIDTH_UNITS,
                    height: ARENA_HEIGHT_UNITS,
                }, {
                    applyDamageToShape,
                    applyDamageFromShapes,
                    isSwingHitting,
                    incomingMeleeDamage,
                    incomingGunDamage,
                    attackerDamageMultiplier,
                    stunHits,
                    grenadeDamageToFighter: grenadeDamageToEntity,
                    overlapsShape: overlapsEntity,
                });
                [mainAfter] = placementUpdate.fighters;
                if (opponentAfter) opponentAfter = placementUpdate.fighters[1];
                mainAfter = settlePendingHealing(mainAfter);
                if (opponentAfter) opponentAfter = settlePendingHealing(opponentAfter);
                mainAfter = finalizeTickMeasurements(mainAfter, mainBefore);
                if (opponentAfter) opponentAfter = finalizeTickMeasurements(opponentAfter, opponentBefore);
                prototypePlacementShapes = placementUpdate.entities;
                if (tutorialMode && tutorialRunRef.current && opponentAfter) {
                    const run = tutorialRunRef.current;
                    const remainingMs = Math.max(0, run.deadline - Date.now());
                    const hit = opponentAfter.hp < run.opponentHp;
                    const tookDamage = mainAfter.hp < run.playerHp;
                    const survived = Number(mainAfter.hp) > 0;
                    const passed = run.goal === "survive" ? remainingMs === 0 && survived : hit && !tookDamage;
                    const failed = run.goal === "survive" ? !survived : tookDamage || remainingMs === 0;
                    const code = passed
                        ? run.goal === "survive" ? "survive_passed" : "combo_passed"
                        : failed
                            ? run.goal === "survive" ? "survive_defeated" : tookDamage ? "combo_took_damage" : "combo_timed_out"
                            : "reading_brain";
                    setTutorialChallenge({
                        status: passed ? "passed" : failed ? "failed" : "running",
                        remainingMs,
                        hit,
                        dodged: !tookDamage,
                        code,
                    });
                    if (passed || failed) {
                        tutorialRunRef.current = null;
                        window.setTimeout(() => stopAutoPlay(), 0);
                    }
                }
                return [mainAfter, ...(opponentAfter ? [opponentAfter] : []), ...grenadeShapes, ...fireballShapes, ...prototypePlacementShapes];
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

    const resetArenaStats = () => {
        setSelectedId(null);
        setShapes((prevShapes) => prevShapes
            .filter((shape) => shape.type !== "grenade" && shape.type !== "grenadeExplosion")
            .filter((shape) => shape.type !== "fireball")
            .filter((shape) => !["proximityMine", "mineExplosion", "orbitalMarker", "orbitalExplosion"].includes(shape.type))
            .map((shape) => (shape.id === "main" || shape.id === "opponent-model")
                ? resetFighterShape(shape)
                : cloneShape(shape)));
        setSubmitStatus({ ok: true, message: "Bot stats, cooldowns, and status effects reset." });
        setTimeout(() => setSubmitStatus(null), 2500);
    };

    const handleSaveArenaCheckpoint = () => {
        if (isAutoPlaying || isStrategyTraining || isBaseTraining) return;
        arenaCheckpointShapesRef.current = cloneShapes(shapes);
        setHasArenaCheckpoint(true);
        setSubmitStatus({ ok: true, message: "Training checkpoint saved." });
        setTimeout(() => setSubmitStatus(null), 2500);
    };

    const handleResetArenaCheckpoint = () => {
        if (!arenaCheckpointShapesRef.current || isStrategyTraining || isBaseTraining) return;
        stopAutoPlay();
        setIsEditingArena(true);
        setSelectedId(null);
        const checkpointShapes = cloneShapes(arenaCheckpointShapesRef.current);
        setShapes(checkpointShapes);
        setSubmitStatus({ ok: true, message: "Restored training checkpoint." });
        setTimeout(() => setSubmitStatus(null), 2500);
    };

    const handleFullArenaReset = () => {
        if (isStrategyTraining || isBaseTraining) return;
        const originalShapes = tutorialMode ? buildTutorialArenaShapes(tutorialStep) : originalArenaShapesRef.current
            ?? resetArenaStartShapes(buildInitialArenaShapes(matchContext), selectedLoadout, opponentLoadout);
        stopAutoPlay();
        setIsEditingArena(true);
        setSelectedId(null);
        const resetShapes = tutorialMode
            ? cloneShapes(originalShapes)
            : resetArenaStartShapes(cloneShapes(originalShapes), selectedLoadout, opponentLoadout);
        arenaCheckpointShapesRef.current = null;
        setHasArenaCheckpoint(false);
        setShapes(resetShapes);
        if (tutorialMode) setTutorialChallenge({ status: "idle", remainingMs: tutorialScenario.durationMs ?? 0, code: "ready_again" });
        setSubmitStatus({ ok: true, message: "Arena reset to the original start." });
        setTimeout(() => setSubmitStatus(null), 2500);
    };

    const stopStrategyTraining = () => {
        if (trainingRunRef.current) {
            trainingRunRef.current.cancelled = true;
            setSubmitStatus({ ok: null, message: "Stopping bot check..." });
        }
    };

    const startStrategyTraining = async () => {
        if (isStrategyTraining || isBaseTraining) return;
        const configuration = normalizeMeleeStrategyConfiguration(
            sanitizeStrategyConfigurationForLoadout(trainingConfiguration, selectedLoadout),
        );
        stopAutoPlay();
        const serverDeadline = matchContext?.trainingEndsAtMs ?? matchContext?.trainingEndsAt;
        const parsedServerDeadline = serverDeadline ? new Date(serverDeadline).getTime() : Number.POSITIVE_INFINITY;
        // Event-handler wall-clock check; intentionally sampled at click time.
        const serverTimeRemainingMs = parsedServerDeadline - Date.now();
        if (serverDeadline && (!Number.isFinite(serverTimeRemainingMs) || serverTimeRemainingMs <= 0)) {
            setSubmitStatus({ ok: false, message: "The tuning window has ended." });
            return;
        }

        const run = { cancelled: false };
        const summary = {
            version: "deterministic-logic-check-v1",
            configuration,
            ruleCount: countStrategyBlocks(configuration),
        };
        trainingRunRef.current = run;
        updateTrainingConfiguration(configuration);
        setTrainingProgress(null);
        setTrainingSummary(summary);
        setIsEditingArena(false);
        setIsStrategyTraining(true);
        setSubmitStatus({ ok: null, message: "Checking deterministic bot rules..." });

        try {
            setSubmittedModelId(null);
            setSubmitStatus({ ok: null, message: "Bot rules checked. Submitting brain..." });
            await handleSubmitModel({ preserveStatus: true });
        } catch (err) {
            console.warn("[arena-bot] Deterministic bot check failed.", err);
            setSubmitStatus({ ok: false, message: `Bot check failed: ${err.message}` });
        } finally {
            trainingRunRef.current = null;
            setIsStrategyTraining(false);
            setIsEditingArena(true);
        }
    };

    const handleTrainBaseModel = async () => {
        setSubmitStatus({ ok: false, message: "Base model training was removed. Bots now submit deterministic logic." });
    };

    const handleExportBaseModel = async () => {
        setSubmitStatus({ ok: false, message: "Base artifact export was removed. The configured bot brain is submitted directly." });
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

    const handleSubmitModel = async ({ preserveStatus = false } = {}) => {
        setSubmitStatus({ ok: null, message: "Submitting bot brain..." });

        try {
            const activeTrainingSessionId = trainingSessionId ?? await ensureTrainingSession({ required: true });
            if (!activeTrainingSessionId) {
                throw new Error("A server tuning session is required before submission.");
            }
            const configuration = normalizeMeleeStrategyConfiguration(
                sanitizeStrategyConfigurationForLoadout(trainingConfiguration, selectedLoadout),
            );
            const payload = await buildModelSubmissionPayload({
                brain: configuration,
                matchId: isMatchTraining ? matchId : null,
                trainingSessionId: activeTrainingSessionId,
                selectedClass: selectedLoadout,
                loadout: matchContext?.loadout ?? null,
            });

            const result = await submitModelPayload(payload);
            console.info("[arena-bot] Submitted bot brain contract:", payload);
            if (result.modelSubmissionId) {
                setSubmittedModelId(result.modelSubmissionId);
            }
            setSubmitStatus({
                ok: result.accepted !== false,
                message: result.message ?? "Bot brain submitted",
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

        const result = submittedModelId
            ? { modelSubmissionId: submittedModelId, accepted: true }
            : await handleSubmitModel({ preserveStatus: true });

        if (result?.modelSubmissionId && result.accepted !== false) {
            onFinishMatch(result.modelSubmissionId);
            setSubmitStatus({ ok: true, message: "Successfully submitted." });
        } else {
            setIsFinishingMatch(false);
        }
    };
    useEffect(() => {
        finishHandlerRef.current = handleFinishMatch;
    });

    useEffect(() => {
        const trainingDeadline = matchContext?.trainingEndsAtMs ?? matchContext?.trainingEndsAt;
        if (!trainingDeadline || !onFinishMatch) return;

        const interval = setInterval(() => {
            const remaining = secondsRemaining(trainingDeadline);
            setTrainingRemaining(remaining);
            if (remaining === 0) {
                clearInterval(interval);
                finishHandlerRef.current?.();
            }
        }, 250);

        return () => clearInterval(interval);
    }, [matchContext?.trainingEndsAt, matchContext?.trainingEndsAtMs, onFinishMatch]);

    return (
        <div className={`flex h-screen flex-col text-ink-hi font-ui overflow-hidden ${isMatchTraining ? "match-arena-shell" : "bg-arena-deep"}`}>
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
                <main className={`min-w-0 flex-1 flex items-center justify-center overflow-hidden p-2 ${isMatchTraining ? "match-arena-stage" : "bg-arena-deep"}`}>
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
                            showEmptyAbilitySlot={!isMatchTraining}
                            measurementEnabled={measurementEnabled}
                            measurementPoints={measurementPoints}
                            onMeasurementPointsChange={setMeasurementPoints}
                        />
                    </div>
                </main>

                <StrategyTrainingPanel
                    configuration={trainingConfiguration}
                    onChange={updateTrainingConfiguration}
                    opponentConfiguration={tutorialMode ? null : opponentTrainingConfiguration}
                    onOpponentChange={tutorialMode ? null : updateOpponentTrainingConfiguration}
                    onStartTraining={startStrategyTraining}
                    onStopTraining={stopStrategyTraining}
                    isTraining={isStrategyTraining}
                    selectedLoadout={selectedLoadout}
                    opponentLoadout={opponentLoadout}
                    isMatchTraining={isMatchTraining}
                    usesArenaResponsiveLimits={usesArenaResponsiveLimits}
                    matchContext={matchContext}
                    trainingRemaining={trainingRemaining}
                    playerRoundWins={playerRoundWins}
                    opponentRoundWins={opponentRoundWins}
                    isAutoPlaying={isAutoPlaying}
                    hasArenaCheckpoint={hasArenaCheckpoint}
                    measurementEnabled={measurementEnabled}
                    onMeasurementToggle={() => setMeasurementEnabled((current) => {
                        if (current) setMeasurementPoints([]);
                        return !current;
                    })}
                    isBaseTraining={isBaseTraining}
                    baseCandidate={baseCandidate}
                    baseExportState={baseExportState}
                    finishStatus={finishStatus}
                    finishError={finishError}
                    isFinishingMatch={isFinishingMatch}
                    canFinishMatch={Boolean(onFinishMatch)}
                    onAutoPlayToggle={handleAutoPlayToggle}
                    onResetArenaStats={resetArenaStats}
                    customVariableValues={shapes.find((shape) => shape.id === "main")?.customVariables ?? {}}
                    opponentCustomVariableValues={shapes.find((shape) => shape.id === "opponent-model")?.customVariables ?? {}}
                    onSaveArenaCheckpoint={handleSaveArenaCheckpoint}
                    onResetArenaCheckpoint={handleResetArenaCheckpoint}
                    onFullArenaReset={handleFullArenaReset}
                    onTrainBaseModel={handleTrainBaseModel}
                    onExportBaseModel={handleExportBaseModel}
                    onFinishMatch={handleFinishMatch}
                    onSurrenderMatch={onSurrenderMatch}
                    onOpenPlayerLoadout={!isMatchTraining && !tutorialMode ? () => openSandboxLoadout("player") : null}
                    onOpenOpponentLoadout={!isMatchTraining && !tutorialMode && shapes.some((shape) => shape.id === "opponent-model") ? () => openSandboxLoadout("opponent") : null}
                    onSpawnOpponent={!isMatchTraining && !tutorialMode ? handleSpawnOpponent : null}
                    tutorialMode={tutorialMode}
                    tutorialStep={tutorialStep}
                    onShowTutorialSolution={() => {
                        const nextShown = !solutionShown;
                        updateTrainingConfiguration(nextShown ? tutorialScenario.solution : tutorialScenario.emptyBrain);
                        setSolutionShown(nextShown);
                    }}
                    tutorialGuideProps={tutorialMode ? {
                        step: tutorialStep,
                        onStepChange: setTutorialStep,
                        challenge: tutorialChallenge,
                        onAbilityCatalogue: () => navigate("/ability-catalogue"),
                        onConditionalCatalogue: () => navigate("/conditionals"),
                        onShowSolution: () => {
                            const nextShown = !solutionShown;
                            updateTrainingConfiguration(nextShown ? tutorialScenario.solution : tutorialScenario.emptyBrain);
                            setSolutionShown(nextShown);
                        },
                        solutionShown,
                    } : null}
                />
            </div>
            {sandboxLoadoutTarget && (
                <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/75 p-4" role="dialog" aria-modal="true" aria-label="Sandbox loadout editor">
                    <div className="max-h-[92vh] w-full max-w-4xl overflow-y-auto rounded-xl border border-zinc-600 bg-zinc-800 p-5 shadow-2xl">
                        <div className="flex items-start justify-between gap-4">
                            <div><p className="font-mono text-[10px] tracking-[0.25em] text-cyan">BOT ROOM SANDBOX</p><h2 className="mt-2 text-2xl font-bold text-ink-white">{sandboxLoadoutTarget === "opponent" ? "Opponent" : "Your bot"} loadout</h2><p className="mt-1 text-sm text-ink-muted">Equip any combination and experiment with up to {SANDBOX_MAX_STAT_POINTS} points per stat.</p></div>
                            <button type="button" onClick={() => setSandboxLoadoutTarget(null)} className="h-9 rounded border border-border-lo px-3 font-mono text-xs text-ink-muted">CLOSE</button>
                        </div>
                        <div className="mt-5 grid gap-5 lg:grid-cols-[1.4fr_1fr]">
                            <div className="space-y-5">
                                {[1, 2, 3].map((round) => <section key={round}><div className="mb-2 border-b border-border-lo pb-1 font-mono text-[10px] font-bold tracking-widest text-cyan">ROUND {round}</div><div className="grid gap-2 sm:grid-cols-2">
                                    {BOT_ABILITIES.filter((ability) => ability.round === round).map((ability) => {
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
                                    return <div key={key} className="mt-4"><div className="flex items-center justify-between"><span className="font-mono text-[9px] tracking-widest text-ink-muted">{label}</span><span className="font-mono text-xs text-ink-white">{value}</span></div><div className="mt-1 flex items-center gap-2"><button type="button" onClick={() => setSandboxLoadoutDraft((current) => normalizedSandboxLoadout({ ...current, statPoints: { ...current.statPoints, [key]: current.statPoints[key] - 1 } }))} className="h-8 w-8 border border-border-lo">-</button><input type="range" min="0" max={SANDBOX_MAX_STAT_POINTS} value={sandboxLoadoutDraft.statPoints[key]} onChange={(event) => setSandboxLoadoutDraft((current) => normalizedSandboxLoadout({ ...current, statPoints: { ...current.statPoints, [key]: Number(event.target.value) } }))} className="min-w-0 flex-1" /><button type="button" onClick={() => setSandboxLoadoutDraft((current) => normalizedSandboxLoadout({ ...current, statPoints: { ...current.statPoints, [key]: current.statPoints[key] + 1 } }))} className="h-8 w-8 border border-border-lo">+</button></div></div>;
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
