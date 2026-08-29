import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
    CONDITION_TYPES,
    STATE_VARIABLES,
    VISIBLE_STATE_VARIABLES,
    createCodeRoot,
    customVariableDefinitions,
    MAX_ROOT_NODES,
    MAX_LOGIC_BLOCKS,
    MAX_TOTAL_CONDITIONS,
    MAX_CUSTOM_VARIABLE_SLOTS,
    normalizeRoots,
    validateAbilityStrategyConfiguration,
    normalizeAbilityStrategyConfiguration,
    abilityDefinitionsForVariable,
} from "../botlogic/code/BotCode.js";
import { statusEffectDefinitionsForAbilities } from "../loadout/BotLoadout.js";
import { priorityForNode } from "../botlogic/code/configuration/identifiers.js";
import CustomVariablesModal from "./modals/CustomVariablesModal.jsx";
import TutorialGuide, { getTutorialProgress, TutorialCodeCoach } from "../../tutorial/TutorialGuide.jsx";
import { botColorRole } from "../pixi/pixiVisualState.js";
import { useDialogFocus } from "../../components/useDialogFocus.js";
import {
    sanitizeConfigurationConditions,
    ScoreBox,
    PanelHeading,
    ToolIcon,
    ControlButton,
    countActions,
    countLogicConditions,
    abilityIdsForConfiguration,
    selectableAbilityIdsForLoadouts,
    selectableTypesForLoadouts,
    formatClock,
} from "./nodes/GraphNodes.jsx";
import { TreeLogicBoard } from "./LogicBoard.jsx";

const MIN_ZOOM = 0.45;
const MAX_ZOOM = 1.35;
const TUTORIAL_OPENED_LOGIC_STORAGE_KEY = "arena-tutorial-opened-bot-code-v1";

function loadTutorialOpenedLogic() {
    try {
        return localStorage.getItem(TUTORIAL_OPENED_LOGIC_STORAGE_KEY) === "true";
    } catch {
        return false;
    }
}

function saveTutorialOpenedLogic() {
    try {
        localStorage.setItem(TUTORIAL_OPENED_LOGIC_STORAGE_KEY, "true");
    } catch {
        // Tutorial memory is best-effort when browser storage is unavailable.
    }
}

function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
}

function participantTeamNumber(participant) {
    const explicitTeam = Number(participant?.teamNumber);
    return Number.isFinite(explicitTeam) && explicitTeam > 0
        ? explicitTeam
        : Number(participant?.slot) === 1 ? 1 : 2;
}

function participantId(participant) {
    return participant?.userId == null ? "" : String(participant.userId);
}

function matchParticipantsForContext(matchContext) {
    const participants = Array.isArray(matchContext?.players) && matchContext.players.length > 0
        ? matchContext.players
        : [matchContext?.player, matchContext?.opponent].filter(Boolean);
    const unique = new Map();
    participants.forEach((participant) => {
        const key = participantId(participant);
        if (key && !unique.has(key)) unique.set(key, participant);
    });
    return [...unique.values()];
}

function orderedLiveCodeParticipants(matchContext) {
    const participants = matchParticipantsForContext(matchContext);
    const player = matchContext?.player ?? participants[0] ?? null;
    if (!player) return [];
    const playerKey = participantId(player);
    const playerTeam = participantTeamNumber(player);
    const bySlot = (first, second) => Number(first?.slot ?? 0) - Number(second?.slot ?? 0);
    const teammates = participants
        .filter((participant) => participantId(participant) !== playerKey
            && participantTeamNumber(participant) === playerTeam)
        .sort(bySlot);
    const opponents = participants
        .filter((participant) => participantId(participant) !== playerKey
            && participantTeamNumber(participant) !== playerTeam)
        .sort(bySlot);
    return [player, ...teammates, ...opponents];
}

const OFFLINE_PLAYER = Object.freeze({
    userId: "offline-player",
    username: "My Bot",
    slot: 1,
    teamNumber: 1,
});

const OFFLINE_OPPONENT = Object.freeze({
    userId: "offline-opponent",
    username: "Opponent 1",
    slot: 2,
    teamNumber: 2,
});

function offlineCodeParticipantsForContext(matchContext, opponentConfiguration) {
    const player = matchContext?.player ?? OFFLINE_PLAYER;
    const opponent = matchContext?.opponent ?? OFFLINE_OPPONENT;
    return opponentConfiguration ? [player, opponent] : [player];
}

function codeSelectorLabel(participant, roster, viewer) {
    if (!participant || participantId(participant) === participantId(viewer)) return "My Bot";
    const viewerTeam = participantTeamNumber(viewer);
    const role = participantTeamNumber(participant) === viewerTeam ? "Teammate" : "Opponent";
    const ordinal = roster
        .slice(0, Math.max(0, roster.indexOf(participant)))
        .filter((candidate) => candidate !== viewer
            && participantTeamNumber(candidate) === participantTeamNumber(participant))
        .length + 1;
    return `${role} ${ordinal}`;
}

function teamLabel(teamNumber) {
    return Number(teamNumber) === 2 ? "RED TEAM" : "BLUE TEAM";
}

function roundWinsForTeam(participants, teamNumber) {
    return participants
        .filter((participant) => participantTeamNumber(participant) === teamNumber)
        .reduce((highest, participant) => Math.max(highest, Math.max(0, Number(participant?.roundWins) || 0)), 0);
}

export default function CodingPanel({
    configuration,
    onChange,
    opponentConfiguration = null,
    onOpponentChange = null,
    offlineCodeParticipants = null,
    onOfflineCodeChange = null,
    isTesting,
    selectedLoadout,
    opponentLoadout,
    isMatchTesting = false,
    usesArenaResponsiveLimits = false,
    matchContext = null,
    codeSnapshots = {},
    codeViewError = null,
    onRequestCodeView = null,
    sandboxCodeCopies = {},
    onSandboxParticipantChange = null,
    testingRemaining = null,
    isAutoPlaying = false,
    onMeasurementToggle,
    isBaseTesting = false,
    finishStatus = null,
    finishError = null,
    isFinishingMatch = false,
    canFinishMatch = false,
    onAutoPlayToggle,
    onResetArenaStats,
    customVariableValues = {},
    opponentCustomVariableValues = {},
    onSurrenderMatch,
    onFinishMatch,
    onOpenLoadout,
    onOpenPracticeConfig = null,
    onOpenPuzzleSubmissions = null,
    builderControls = null,
    puzzleControls = null,
    onPuzzleSubmit = null,
    isPuzzleSubmitting = false,
    logicLimits = null,
    opponentReadOnly = false,
    tutorialMode = false,
    tutorialGuideProps = null,
    tutorialGuideHost = null,
    tutorialStep = 0,
    onShowTutorialSolution,
}) {
    const [isLogicOpen, setIsLogicOpen] = useState(false);
    const [hasOpenedLogic, setHasOpenedLogic] = useState(() => tutorialMode && loadTutorialOpenedLogic());
    const [isCustomVariablesOpen, setIsCustomVariablesOpen] = useState(false);
    const [isNodeSearchOpen, setIsNodeSearchOpen] = useState(false);
    const [isQuickSearchOpen, setIsQuickSearchOpen] = useState(false);
    const [activeCode, setActiveCode] = useState("player");
    const [canvasZoom, setCanvasZoom] = useState(0.85);
    const [canvasPan, setCanvasPan] = useState({ x: 40, y: 36 });
    const logicBoardRef = useRef(null);
    const logicDialogRef = useRef(null);
    const closeTopLogicLayer = () => {
        if (isNodeSearchOpen) {
            setIsNodeSearchOpen(false);
            setIsQuickSearchOpen(false);
            return;
        }
        if (isCustomVariablesOpen) {
            setIsCustomVariablesOpen(false);
            return;
        }
        setIsLogicOpen(false);
    };
    useDialogFocus(logicDialogRef, {
        onClose: closeTopLogicLayer,
        lockScroll: true,
        enabled: isLogicOpen,
    });
    const [editHistory, setEditHistory] = useState({ player: { undo: [], redo: [] }, opponent: { undo: [], redo: [] } });
    const liveCodeRoster = useMemo(
        () => isMatchTesting ? orderedLiveCodeParticipants(matchContext) : [],
        [isMatchTesting, matchContext],
    );
    const offlineCodeRoster = useMemo(
        () => isMatchTesting
            ? []
            : Array.isArray(offlineCodeParticipants) && offlineCodeParticipants.length > 0
                ? offlineCodeParticipants
                : offlineCodeParticipantsForContext(matchContext, opponentConfiguration),
        [isMatchTesting, matchContext, offlineCodeParticipants, opponentConfiguration],
    );
    const codeSelectorRoster = isMatchTesting ? liveCodeRoster : offlineCodeRoster;
    const activeLiveCodeType = activeCode.startsWith("real:")
        ? "real"
        : activeCode.startsWith("sandbox:") ? "sandbox" : null;
    const activeLiveParticipantId = activeLiveCodeType ? activeCode.slice(activeLiveCodeType.length + 1) : null;
    const activeLiveParticipant = activeLiveParticipantId
        ? liveCodeRoster.find((participant) => participantId(participant) === activeLiveParticipantId)
        : null;
    const activeOfflineParticipantId = activeCode.startsWith("offline:")
        ? activeCode.slice("offline:".length)
        : null;
    const activeOfflineParticipant = activeOfflineParticipantId
        ? offlineCodeRoster.find((participant) => participantId(participant) === activeOfflineParticipantId)
        : null;
    const viewingOfflineParticipant = Boolean(activeOfflineParticipant);
    const primaryOfflineParticipant = offlineCodeRoster[0] ?? null;
    const activeOfflineIsTeammate = Boolean(
        activeOfflineParticipant
        && primaryOfflineParticipant
        && participantTeamNumber(activeOfflineParticipant) === participantTeamNumber(primaryOfflineParticipant),
    );
    const offlineOpponentParticipant = offlineCodeRoster.find((participant) => participant.codeKey === "opponent")
        ?? offlineCodeRoster[1]
        ?? null;
    useEffect(() => {
        if (isMatchTesting || !activeCode.startsWith("offline:") || activeOfflineParticipant) return;
        // Reset the selector when a team-size change removes the active bot.
        setActiveCode("player");
    }, [activeCode, activeOfflineParticipant, isMatchTesting]);
    const activeCodeSnapshot = activeLiveParticipantId ? codeSnapshots?.[activeLiveParticipantId] : null;
    const activeSandboxCopy = activeLiveParticipantId ? sandboxCodeCopies?.[activeLiveParticipantId] : null;
    const viewingLiveParticipant = Boolean(activeLiveParticipant && activeLiveCodeType);
    const activeLiveIsTeammate = Boolean(activeLiveParticipant
        && participantTeamNumber(activeLiveParticipant) === participantTeamNumber(matchContext?.player));
    const viewingLiveReal = viewingLiveParticipant
        && activeLiveCodeType === "real"
        && activeLiveIsTeammate;
    const viewingLiveSandbox = viewingLiveParticipant && activeLiveCodeType === "sandbox";
    const viewingLiveTeammateSandbox = viewingLiveSandbox && activeLiveIsTeammate;
    const viewingLiveOpponentSandbox = viewingLiveSandbox && !activeLiveIsTeammate;
    const viewingOpponent = !isMatchTesting
        && activeCode === "opponent"
        && Boolean(opponentConfiguration);
    const editingOpponent = viewingLiveTeammateSandbox
        || (viewingOpponent && Boolean(onOpponentChange) && !opponentReadOnly)
        || (viewingOfflineParticipant && !activeOfflineIsTeammate && Boolean(onOfflineCodeChange));
    const activeCodeReadOnly = viewingLiveReal
        || viewingLiveOpponentSandbox
        || (viewingOpponent && opponentReadOnly)
        || (viewingOfflineParticipant && !onOfflineCodeChange);
    const currentRound = Math.max(1, Number(matchContext?.roundNumber) || 1);
    const maxActionNodes = Number.isFinite(Number(logicLimits?.maxActionNodes))
        ? editingOpponent ? MAX_LOGIC_BLOCKS : Math.max(0, Math.floor(Number(logicLimits.maxActionNodes)))
        : MAX_LOGIC_BLOCKS;
    const maxConditionNodes = Number.isFinite(Number(logicLimits?.maxConditionNodes))
        ? editingOpponent ? MAX_TOTAL_CONDITIONS : Math.max(0, Math.floor(Number(logicLimits.maxConditionNodes)))
        : MAX_TOTAL_CONDITIONS;
    const maxCustomVariableSlots = Number.isFinite(Number(logicLimits?.maxCustomVariables))
        ? editingOpponent ? MAX_CUSTOM_VARIABLE_SLOTS : Math.max(0, Math.floor(Number(logicLimits.maxCustomVariables)))
        : MAX_CUSTOM_VARIABLE_SLOTS;
    const activeConfigurationSource = viewingOfflineParticipant
        ? activeOfflineParticipant.configuration ?? activeOfflineParticipant.brain
        : viewingLiveTeammateSandbox
            ? activeSandboxCopy?.configuration
        : viewingLiveReal
            ? activeCodeSnapshot?.configuration
            : viewingLiveOpponentSandbox
                ? activeCodeSnapshot?.configuration
                    ?? { version: "bot-logic-tree-v1", roots: [], customVariables: [] }
            : viewingOpponent ? opponentConfiguration : configuration;
    const activeLoadoutSource = viewingOfflineParticipant
        ? activeOfflineParticipant.selectedLoadout ?? activeOfflineParticipant.loadout
        : viewingLiveTeammateSandbox
            ? activeSandboxCopy?.selectedLoadout
        : viewingLiveReal
            ? activeCodeSnapshot?.selectedLoadout
            : viewingLiveOpponentSandbox
                ? activeLiveParticipant?.selectedLoadout
            : viewingOpponent ? opponentLoadout : selectedLoadout;
    const normalizedActiveConfiguration = activeConfigurationSource && typeof activeConfigurationSource === "object"
        ? activeConfigurationSource
        : { version: "bot-logic-tree-v1", roots: [], customVariables: [] };
    const activeConfiguration = normalizedActiveConfiguration;
    const activeLoadout = activeLoadoutSource;
    const validation = validateAbilityStrategyConfiguration(normalizedActiveConfiguration);
    const isBotCodeLocked = isMatchTesting && (
        isFinishingMatch
        || finishStatus === "SUBMITTING"
        || finishStatus === "FINISHED"
    );
    const activeCustomVariableValues = viewingOfflineParticipant
        ? activeOfflineParticipant.customVariableValues ?? {}
        : viewingOpponent
            ? opponentCustomVariableValues
        : viewingLiveOpponentSandbox
            ? {}
            : customVariableValues;
    const activeParticipant = viewingLiveParticipant
        ? activeLiveParticipant
        : viewingOfflineParticipant
        ? activeOfflineParticipant
        : viewingOpponent
        ? offlineOpponentParticipant
        : isMatchTesting ? matchContext?.player : offlineCodeRoster[0];
    const opposingLoadout = useMemo(() => {
        if (!isMatchTesting) {
            return viewingOpponent || (viewingOfflineParticipant && !activeOfflineIsTeammate)
                ? selectedLoadout
                : opponentLoadout;
        }
        if (!activeParticipant) {
            return opponentLoadout;
        }
        const activeTeam = participantTeamNumber(activeParticipant);
        const opposingParticipant = matchParticipantsForContext(matchContext)
            .filter((participant) => participantTeamNumber(participant) !== activeTeam)
            .sort((first, second) => Number(first?.slot ?? 0) - Number(second?.slot ?? 0))[0];
        return opposingParticipant?.selectedLoadout ?? opponentLoadout;
    }, [activeOfflineIsTeammate, activeParticipant, isMatchTesting, matchContext, opponentLoadout, selectedLoadout, viewingOfflineParticipant, viewingOpponent]);
    const selectableRoster = useMemo(() => {
        if (!activeParticipant) return null;
        const participants = isMatchTesting
            ? matchParticipantsForContext(matchContext)
            : codeSelectorRoster;
        const activeTeam = participantTeamNumber(activeParticipant);
        const activeId = participantId(activeParticipant);
        const teammates = participants
            .filter((participant) => participantId(participant) !== activeId
                && participantTeamNumber(participant) === activeTeam)
            .sort((first, second) => Number(first?.slot ?? 0) - Number(second?.slot ?? 0));
        const opponents = participants
            .filter((participant) => participantTeamNumber(participant) !== activeTeam)
            .sort((first, second) => Number(first?.slot ?? 0) - Number(second?.slot ?? 0));
        return {
            teammateCount: teammates.length,
            opponentCount: opponents.length,
            teammateLoadouts: teammates.map((participant) => participant.selectedLoadout),
            opponentLoadouts: opponents.map((participant) => participant.selectedLoadout),
        };
    }, [activeParticipant, codeSelectorRoster, isMatchTesting, matchContext]);
    const blueTeamRoundWins = roundWinsForTeam(liveCodeRoster, 1);
    const redTeamRoundWins = roundWinsForTeam(liveCodeRoster, 2);
    const isCodeEditingLocked = isBotCodeLocked || activeCodeReadOnly;
    const openLogicWorkspace = useCallback((quickSearch = false) => {
        if (isBotCodeLocked) return;
        setHasOpenedLogic(true);
        if (tutorialMode) saveTutorialOpenedLogic();
        setIsLogicOpen(true);
        if (quickSearch) {
            setIsQuickSearchOpen(true);
            setIsNodeSearchOpen(true);
        }
    }, [isBotCodeLocked, tutorialMode]);
    useEffect(() => {
        const handleWorkspaceShortcut = (event) => {
            const textEntry = event.target?.closest?.("input,textarea,select,[contenteditable=\"true\"]");
            if (isBotCodeLocked || textEntry || event.ctrlKey || event.metaKey || event.altKey || event.key !== "/") return;
            event.preventDefault();
            if (isLogicOpen) {
                if (!isNodeSearchOpen && !isCustomVariablesOpen) {
                    setIsQuickSearchOpen(true);
                    setIsNodeSearchOpen(true);
                }
                return;
            }
            openLogicWorkspace(true);
        };
        window.addEventListener("keydown", handleWorkspaceShortcut);
        return () => window.removeEventListener("keydown", handleWorkspaceShortcut);
    }, [isBotCodeLocked, isCustomVariablesOpen, isLogicOpen, isNodeSearchOpen, openLogicWorkspace]);
    const applyActiveConfiguration = (next) => {
        if (isCodeEditingLocked) return;
        if (viewingOfflineParticipant) onOfflineCodeChange?.(activeOfflineParticipantId, next);
        else if (viewingLiveTeammateSandbox) onSandboxParticipantChange?.(activeLiveParticipantId, next);
        else if (editingOpponent) onOpponentChange?.(next);
        else onChange(next);
    };
    const updateActiveConfiguration = (next) => {
        if (isCodeEditingLocked) return;
        if (next === activeConfiguration) return;
        setEditHistory((current) => {
            const history = current[activeCode] ?? { undo: [], redo: [] };
            return {
                ...current,
                [activeCode]: { undo: [...history.undo.slice(-49), activeConfiguration], redo: [] },
            };
        });
        applyActiveConfiguration(next);
    };
    const travelHistory = (direction) => {
        if (isTesting || isCodeEditingLocked) return;
        const history = editHistory[activeCode] ?? { undo: [], redo: [] };
        const next = history[direction].at(-1);
        if (!next) return;
        const destination = direction === "undo" ? "redo" : "undo";
        setEditHistory((current) => ({ ...current, [activeCode]: {
            ...(current[activeCode] ?? { undo: [], redo: [] }),
            [direction]: history[direction].slice(0, -1),
            [destination]: [...(current[activeCode]?.[destination] ?? []), activeConfiguration],
        } }));
        applyActiveConfiguration(next);
    };
    const updateRoots = (roots, nodePositions = activeConfiguration.nodePositions) => updateActiveConfiguration({
        ...activeConfiguration,
        version: "bot-logic-tree-v1",
        roots: normalizeRoots(roots),
        customVariables: activeConfiguration?.customVariables ?? [],
        ...(nodePositions ? { nodePositions } : {}),
    });
    const totalActiveBlocks = countActions(activeConfiguration);
    const totalRootNodes = activeConfiguration?.roots?.length ?? 0;
    const totalActiveConditions = countLogicConditions(activeConfiguration);
    const usesTree = Array.isArray(activeConfiguration?.roots);
    const viewingCurrentRound = true;
    const roundDeleteLocked = false;
    const selectedLogicRound = currentRound;
    const currentRoundBlockCount = totalActiveBlocks;
    const roundBlockLimit = maxActionNodes;
    const totalRounds = isMatchTesting ? 3 : Math.max(1, (matchContext?.winsRequired ?? 1) * 2 - 1);
    const tutorialProgress = tutorialMode
        ? getTutorialProgress(tutorialStep, configuration, { hasOpenedLogic, isAutoPlaying, challenge: tutorialGuideProps?.challenge })
        : null;
    const tutorialFocus = tutorialProgress?.focus;
    const handleTutorialStepChange = (nextStep) => {
        setIsLogicOpen(false);
        setIsCustomVariablesOpen(false);
        setIsNodeSearchOpen(false);
        setIsQuickSearchOpen(false);
        tutorialGuideProps?.onStepChange?.(nextStep);
    };
    const visibleConditionTypes = CONDITION_TYPES;
    const visibleStateVariables = useMemo(() => {
        const ownAbilities = abilityIdsForConfiguration(activeLoadout);
        const opponentAbilities = abilityIdsForConfiguration(opposingLoadout);
        const builtIns = VISIBLE_STATE_VARIABLES.map((variable) => {
            if (!variable.supportsAbility && !variable.supportsStatusEffect) return variable;
            const equipped = variable.supportsStatusEffect
                ? new Set([...ownAbilities, ...opponentAbilities])
                : new Set([...ownAbilities, ...opponentAbilities]);
            return {
                ...variable,
                ...(variable.supportsAbility ? {
                    abilityOptions: abilityDefinitionsForVariable(variable, equipped),
                } : {}),
                ...(variable.supportsStatusEffect ? {
                    statusEffectOptions: statusEffectDefinitionsForAbilities(equipped),
                } : {}),
            };
        }).filter((variable) => (!variable.supportsAbility || variable.abilityOptions.length > 0)
            && (!variable.supportsStatusEffect || variable.statusEffectOptions.length > 0));
        return [...builtIns, ...customVariableDefinitions(activeConfiguration)];
    }, [activeLoadout, opposingLoadout, activeConfiguration]);
    const defaultCondition = visibleConditionTypes[0] ?? CONDITION_TYPES[0];
    const defaultVariable = visibleStateVariables.find((variable) => variable.id === "selectable.distance")
        ?? visibleStateVariables[0]
        ?? STATE_VARIABLES[0];
    const visibleSelectableTypes = useMemo(
        () => selectableTypesForLoadouts(activeLoadout, opposingLoadout, selectableRoster),
        [activeLoadout, opposingLoadout, selectableRoster],
    );
    const visibleSelectableAbilityIds = useMemo(
        () => selectableAbilityIdsForLoadouts(activeLoadout, opposingLoadout, selectableRoster),
        [activeLoadout, opposingLoadout, selectableRoster],
    );
    useEffect(() => {
        if (isCodeEditingLocked) return;
        const sanitized = sanitizeConfigurationConditions(activeConfiguration, visibleConditionTypes, defaultCondition, visibleSelectableTypes, visibleStateVariables, visibleSelectableAbilityIds);
        if (sanitized === activeConfiguration) return;
        if (viewingOfflineParticipant) onOfflineCodeChange?.(activeOfflineParticipantId, sanitized);
        else if (viewingLiveTeammateSandbox) onSandboxParticipantChange?.(activeLiveParticipantId, sanitized);
        else if (editingOpponent) onOpponentChange?.(sanitized);
        else onChange(sanitized);
    }, [activeConfiguration, activeLiveParticipantId, activeOfflineParticipantId, activeLoadout, defaultCondition, editingOpponent, isCodeEditingLocked, onChange, onOfflineCodeChange, onOpponentChange, onSandboxParticipantChange, opposingLoadout, viewingLiveTeammateSandbox, viewingOfflineParticipant, visibleConditionTypes, visibleStateVariables, visibleSelectableTypes, visibleSelectableAbilityIds]);

    useEffect(() => {
        if (isCodeEditingLocked) return;
        if (!isLogicOpen || usesTree) return;
        const tree = normalizeAbilityStrategyConfiguration(activeConfiguration);
        if (viewingOfflineParticipant) onOfflineCodeChange?.(activeOfflineParticipantId, tree);
        else if (viewingLiveTeammateSandbox) onSandboxParticipantChange?.(activeLiveParticipantId, tree);
        else if (editingOpponent) onOpponentChange?.(tree);
        else onChange(tree);
    }, [activeConfiguration, activeLiveParticipantId, activeOfflineParticipantId, editingOpponent, isCodeEditingLocked, isLogicOpen, onChange, onOfflineCodeChange, onOpponentChange, onSandboxParticipantChange, viewingLiveTeammateSandbox, viewingOfflineParticipant, usesTree]);

    useEffect(() => {
        if (!isBotCodeLocked) return;
        const closeWorkspaceId = window.setTimeout(() => {
            setIsLogicOpen(false);
            setIsNodeSearchOpen(false);
            setIsCustomVariablesOpen(false);
            setIsQuickSearchOpen(false);
        }, 0);
        return () => window.clearTimeout(closeWorkspaceId);
    }, [isBotCodeLocked]);

    const addRootNode = () => {
        if (isCodeEditingLocked || totalRootNodes >= MAX_ROOT_NODES) return;
        const roots = activeConfiguration.roots ?? [];
        const nextPriority = roots.reduce((highest, root, index) => Math.max(highest, priorityForNode(root, index + 1)), 0) + 1;
        const root = createCodeRoot(nextPriority);
        root.branches = [];
        const nextRoots = [...roots, root];
        const nodePositions = logicBoardRef.current?.placeRootAtCenter(nextRoots, nextRoots.length - 1);
        updateRoots(nextRoots, nodePositions ?? activeConfiguration.nodePositions);
    };
    const changeZoom = (delta, origin = null) => {
        setCanvasZoom((currentZoom) => {
            const nextZoom = clamp(Number((currentZoom + delta).toFixed(2)), MIN_ZOOM, MAX_ZOOM);
            if (origin && nextZoom !== currentZoom) {
                setCanvasPan((currentPan) => ({
                    x: origin.x - ((origin.x - currentPan.x) / currentZoom) * nextZoom,
                    y: origin.y - ((origin.y - currentPan.y) / currentZoom) * nextZoom,
                }));
            }
            return nextZoom;
        });
    };
    const applyPinchZoom = (nextZoom, nextPan) => {
        setCanvasZoom(nextZoom);
        setCanvasPan(nextPan);
    };
    const activeSelectorParticipant = isMatchTesting
        ? activeCode === "player"
            ? matchContext?.player
            : activeLiveParticipant
        : viewingOfflineParticipant
            ? activeOfflineParticipant
            : activeCode === "opponent"
                ? offlineOpponentParticipant
            : offlineCodeRoster[0];
    const activeSelectorIndex = codeSelectorRoster.findIndex((participant) =>
        participantId(participant) === participantId(activeSelectorParticipant));
    const activeSelectorRole = botColorRole(activeSelectorParticipant);
    const activeSelectorLabel = codeSelectorLabel(
        activeSelectorParticipant,
        codeSelectorRoster,
        isMatchTesting ? matchContext?.player : offlineCodeRoster[0],
    );
    const isViewingOwnCode = Boolean(activeSelectorParticipant
        && participantId(activeSelectorParticipant)
            === participantId(isMatchTesting ? matchContext?.player : offlineCodeRoster[0]));
    const activeSelectorMode = !isMatchTesting
        ? "SANDBOX CODE"
        : isViewingOwnCode
            ? "REAL CODE"
            : activeLiveIsTeammate
                ? viewingLiveSandbox ? "SANDBOX CODE" : "REAL CODE"
                : "SANDBOX CODE ONLY";
    const selectCodeParticipant = (index) => {
        const participant = codeSelectorRoster[index];
        if (!participant) return;
        if (!isMatchTesting) {
            if (index === 0) {
                setActiveCode("player");
                return;
            }
            if (participant.codeKey === "opponent" || !Array.isArray(offlineCodeParticipants)) {
                setActiveCode("opponent");
                return;
            }
            const key = participantId(participant);
            if (key) setActiveCode(`offline:${key}`);
            return;
        }
        const key = participantId(participant);
        setActiveCode(key === participantId(matchContext?.player) ? "player" : `sandbox:${key}`);
    };
    const cycleCodeParticipant = (direction) => {
        if (codeSelectorRoster.length < 2) return;
        const currentIndex = activeSelectorIndex >= 0 ? activeSelectorIndex : 0;
        const nextIndex = (currentIndex + direction + codeSelectorRoster.length) % codeSelectorRoster.length;
        selectCodeParticipant(nextIndex);
    };
    const toggleLiveCodeMode = () => {
        if (!isMatchTesting || !activeLiveParticipant || !activeLiveIsTeammate || isBotCodeLocked) return;
        const key = participantId(activeLiveParticipant);
        if (viewingLiveSandbox) {
            setActiveCode(`real:${key}`);
            onRequestCodeView?.(activeLiveParticipant.userId);
        } else {
            setActiveCode(`sandbox:${key}`);
        }
    };
    return (
        <aside className={`arena-toolbar-panel ${usesArenaResponsiveLimits ? "arena-right-toolbar" : ""} testing-mono h-full min-h-0 w-[23rem] flex-shrink-0 overflow-y-auto border-l border-slate-700/70 bg-[linear-gradient(180deg,rgba(12,22,31,.98),rgba(8,16,24,.98))] p-4 shadow-[-12px_0_30px_rgba(0,0,0,.28)]`}>
            <div className="space-y-4">
                {builderControls}
                {puzzleControls}
                {isMatchTesting && (
                    <section className="rounded-xl border border-slate-600/70 bg-slate-900/55 p-4 text-[10px] shadow-[0_10px_30px_rgba(0,0,0,.2)]">
                        <PanelHeading icon="status">MATCH STATUS</PanelHeading>
                        <div className="flex items-center justify-between text-ink-muted">
                            <span>ROUND</span>
                            <strong className="font-interface-numeric text-ink-white">{matchContext?.roundNumber ?? 1}/{totalRounds}</strong>
                        </div>
                        <div className="mt-2 flex items-center justify-between text-ink-muted">
                            <span>TIME</span>
                            <strong className="font-interface-numeric text-amber-200">{formatClock(testingRemaining)}</strong>
                        </div>
                        <div className="mt-3 grid grid-cols-2 gap-2">
                            <ScoreBox label="BLUE TEAM" value={blueTeamRoundWins} tone="blue" />
                            <ScoreBox label="RED TEAM" value={redTeamRoundWins} tone="red" />
                        </div>
                        {Number(matchContext?.surrenderVoteRequired) > 0
                            && Number(matchContext?.surrenderVoteCount) > 0 && (
                            <div className="mt-3 rounded border border-red-900/50 bg-red-950/20 px-2 py-2 text-red-200">
                                {teamLabel(participantTeamNumber(matchContext?.player))} FORFEIT VOTES: {matchContext.surrenderVoteCount}/{matchContext.surrenderVoteRequired}
                            </div>
                        )}
                        {matchContext?.opponent?.finished && finishStatus !== "FINISHED" && (
                            <div className="mt-3 rounded border border-green-800/50 bg-green-950/30 px-2 py-2 text-green-300">
                                OPPONENT FINISHED
                            </div>
                        )}
                        {testingRemaining === 0 && finishStatus === "BUILDING" && (
                            <div role="status" aria-live="polite" className="mt-3 flex items-center gap-2 rounded border border-cyan-900/60 bg-cyan-950/15 px-2 py-2 text-cyan-200/80">
                                <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-cyan-300/80" aria-hidden="true" />
                                PREPARING REPLAY · YOU CAN STILL SUBMIT
                            </div>
                        )}
                    </section>
                )}

                <section className="rounded-xl border border-slate-600/70 bg-slate-900/55 p-4 shadow-[0_10px_30px_rgba(0,0,0,.2)]">
                    <div className="flex items-center justify-between text-[10px]">
                        <PanelHeading icon="node">BOT CODE</PanelHeading>
                        <strong className="font-interface-numeric text-ink-muted">{countActions(activeConfiguration)}/{maxActionNodes} A · {countLogicConditions(activeConfiguration)}/{maxConditionNodes} C</strong>
                    </div>
                    <button
                        type="button"
                        disabled={isBotCodeLocked}
                        onClick={() => openLogicWorkspace(false)}
                        className={`arena-toolbar-button ${isBotCodeLocked ? "arena-toolbar-button--neutral" : "arena-toolbar-button--primary"} mt-4 ${tutorialFocus === "open-code" ? "tutorial-control-focus" : ""}`}
                    >
                        <ToolIcon name="node" /> {isBotCodeLocked ? "BOT CODE SUBMITTED" : "OPEN BOT CODE"}
                    </button>
                    {onOpenPuzzleSubmissions && (
                        <button type="button" onClick={onOpenPuzzleSubmissions} className="arena-toolbar-submission-link mt-3" aria-haspopup="dialog">
                            <span className="flex items-center gap-3"><ToolIcon name="reset" /> <span>PREVIOUS SUBMISSIONS</span></span>
                            <span aria-hidden="true" className="text-2xl font-normal leading-none text-slate-300">›</span>
                        </button>
                    )}
                    {validation.errors.map((error) => <p key={error} className="mt-2 text-[10px] text-red-300">{error}</p>)}
                    {validation.warnings?.map((warning) => <p key={warning} className="mt-2 text-[10px] text-amber-300">WARNING: {warning}</p>)}
                </section>

                <section className="rounded-xl border border-slate-600/70 bg-slate-900/55 p-4 shadow-[0_10px_30px_rgba(0,0,0,.2)]">
                    <div className="mb-4 flex items-center justify-between border-b border-slate-700/80 pb-3 text-[10px]">
                        <PanelHeading>MATCH TOOLS</PanelHeading>
                        <span className="font-display-action tracking-[.08em] text-ink-muted">BOT LOADOUT</span>
                    </div>
                    <div className="flex flex-col items-center gap-2.5">
                        <ControlButton
                            icon={isAutoPlaying ? "pause" : "play"}
                            onClick={onAutoPlayToggle}
                            disabled={isBaseTesting || isTesting}
                            tone="neutral"
                            className={tutorialFocus === "play" ? "tutorial-control-focus" : ""}
                        >
                            {isAutoPlaying ? "PAUSE" : "PLAY"}
                        </ControlButton>
                        {onPuzzleSubmit && (
                            <ControlButton
                                icon="check"
                                onClick={onPuzzleSubmit}
                                disabled={isPuzzleSubmitting || isBaseTesting || isTesting}
                                tone="neutral"
                            >
                                {isPuzzleSubmitting ? "SUBMITTING" : "SUBMIT PUZZLE"}
                            </ControlButton>
                        )}
                        <ControlButton icon="measure" onClick={onMeasurementToggle} disabled={!onMeasurementToggle} tone="neutral">
                            MEASURE
                        </ControlButton>
                        <ControlButton
                            icon="stats"
                            onClick={onResetArenaStats}
                            disabled={!onResetArenaStats || isBaseTesting || isTesting}
                            tone="neutral"
                        >
                            RESET STATS
                        </ControlButton>
                        {isMatchTesting && (
                            <>
                            <ControlButton
                                icon="check"
                                onClick={onFinishMatch}
                                disabled={!canFinishMatch || finishStatus === "FINISHED" || finishStatus === "SURRENDERED" || finishStatus === "SUBMITTING" || finishStatus === "SURRENDERING" || isFinishingMatch || isTesting}
                                tone="green"
                            >
                                {finishStatus === "FINISHED"
                                    ? "FINISHED"
                                    : finishStatus === "SURRENDERED"
                                        ? "RESIGNED"
                                        : finishStatus === "SURRENDER_VOTED"
                                            ? "SUBMIT / WITHDRAW VOTE"
                                        : finishStatus === "SUBMITTING"
                                            ? "SUBMITTING"
                                            : isFinishingMatch
                                                ? "SUBMITTING"
                                                : "SUBMIT"}
                            </ControlButton>
                            <ControlButton
                                icon="flag"
                                onClick={onSurrenderMatch}
                                disabled={!onSurrenderMatch || finishStatus === "SURRENDERED" || finishStatus === "FINISHED" || finishStatus === "SUBMITTING" || finishStatus === "SURRENDERING" || isFinishingMatch || isTesting}
                                tone="red"
                            >
                                {finishStatus === "SURRENDERING"
                                    ? "SURRENDERING"
                                    : finishStatus === "SURRENDER_VOTED" ? "WITHDRAW FORFEIT" : "VOTE TO FORFEIT"}
                            </ControlButton>
                            </>
                        )}
                        {!isMatchTesting && onOpenPracticeConfig && (
                            <ControlButton icon="tools" onClick={onOpenPracticeConfig} disabled={isTesting || isAutoPlaying} tone="neutral">
                                PRACTICE CONFIG
                            </ControlButton>
                        )}
                        {!isMatchTesting && onOpenLoadout && (
                            <ControlButton icon="edit" onClick={onOpenLoadout} disabled={isTesting || isAutoPlaying} tone="neutral">
                                EDIT LOADOUT
                            </ControlButton>
                        )}
                    </div>
                    {finishError && <p className="mt-2 rounded border border-red-800/70 bg-red-950/40 px-2 py-2 font-mono text-[9px] leading-relaxed text-red-200">{finishError}</p>}
                </section>
                {onPuzzleSubmit && (
                    <section className="rounded-lg border border-cyan-900/60 bg-slate-950/45 p-3 text-[9px] leading-4 text-slate-400">
                        <p>When you submit a puzzle, the server will return whether or not you succeeded based on a hidden simulation.</p>
                        <p className="mt-2">Pressing play shows you what happens visually with your current code</p>
                    </section>
                )}
            </div>

            {tutorialGuideProps && tutorialGuideHost && createPortal(
                <TutorialGuide {...tutorialGuideProps} onStepChange={handleTutorialStepChange} progress={tutorialProgress} />,
                tutorialGuideHost,
            )}
            {isLogicOpen && !isBotCodeLocked && typeof document !== "undefined" && createPortal(
                <div className="code-workspace-overlay fixed inset-0 z-40 flex items-center justify-center overflow-hidden bg-black/70 px-4 py-5">
                    <section ref={logicDialogRef} className="code-workspace testing-mono relative flex h-[min(90vh,820px)] w-[min(94vw,1440px)] flex-col overflow-hidden rounded-sm border border-border-mid bg-[#111519] shadow-2xl" role="dialog" aria-modal="true" aria-labelledby="code-workspace-title" tabIndex={-1}>
                        <div className="code-workspace-top-layer">
                        <header className="code-toolbar flex min-h-[84px] flex-shrink-0 items-center gap-4 border-b border-white/10 bg-[#12161a] px-5 py-3 shadow-[0_8px_24px_rgba(0,0,0,.18)]">
                            <div className="code-toolbar-title flex-none">
                                <div id="code-workspace-title" className="font-mono text-[11px] font-bold tracking-widest text-cyan">BOT CODE WORKSPACE</div>
                                <div className="mt-1 truncate font-mono text-[8px] tracking-wide text-ink-muted">
                                    {activeCodeReadOnly
                                        ? "REAL CODE SNAPSHOT"
                                        : viewingLiveSandbox
                                            ? "SANDBOX COPY"
                                            : viewingOpponent ? "SANDBOX CODE"
                                                : isMatchTesting ? "REAL CODE" : "SANDBOX CODE"}
                                    {activeParticipant?.username ? ` · ${activeParticipant.username}` : ""}
                                    {` - ${totalActiveBlocks}/${maxActionNodes} A - ${totalActiveConditions}/${maxConditionNodes} C`}
                                </div>
                            </div>
                            <div className="code-toolbar-controls min-w-0 flex-1 py-0.5">
                                {codeSelectorRoster.length > 0 ? (
                                    <div className="code-bot-selector-stack">
                                        <div className={`code-bot-selector ${activeSelectorRole === "red" ? "is-red" : "is-blue"}`} role="group" aria-label="Select bot code workspace">
                                            <button
                                                type="button"
                                                aria-label="Show previous bot"
                                                title="Previous bot"
                                                onClick={() => cycleCodeParticipant(-1)}
                                                disabled={codeSelectorRoster.length < 2}
                                                className="code-bot-selector__arrow"
                                            >
                                                ‹
                                            </button>
                                            <div className="code-bot-selector__current" aria-live="polite">
                                                <span className="code-bot-selector__name">{activeSelectorLabel}</span>
                                                <span className="code-bot-selector__meta">{teamLabel(participantTeamNumber(activeSelectorParticipant))} · {activeSelectorMode} · {Math.max(1, activeSelectorIndex + 1)}/{codeSelectorRoster.length}</span>
                                            </div>
                                            <button
                                                type="button"
                                                aria-label="Show next bot"
                                                title="Next bot"
                                                onClick={() => cycleCodeParticipant(1)}
                                                disabled={codeSelectorRoster.length < 2}
                                                className="code-bot-selector__arrow"
                                            >
                                                ›
                                            </button>
                                        </div>
                                        {!isMatchTesting ? (
                                            <div className="code-bot-view-mode">SANDBOX CODE</div>
                                        ) : isViewingOwnCode ? (
                                            <div className="code-bot-view-mode">REAL CODE</div>
                                        ) : activeLiveParticipant && activeLiveIsTeammate ? (
                                            <button
                                                type="button"
                                                onClick={toggleLiveCodeMode}
                                                disabled={isBotCodeLocked}
                                                className={`code-bot-view-toggle ${viewingLiveSandbox ? "is-sandbox" : "is-real"}`}
                                            >
                                                {viewingLiveSandbox ? "VIEW REAL CODE" : "VIEW SANDBOX CODE"}
                                            </button>
                                        ) : activeLiveParticipant ? (
                                            <div className="code-bot-view-mode">SANDBOX CODE ONLY · OPPONENT CODE IS PRIVATE</div>
                                        ) : null}
                                    </div>
                                ) : null}
                                {viewingLiveReal && !activeCodeSnapshot && (
                                    <div className="mt-2 rounded border border-cyan-900/70 bg-cyan-950/20 px-2 py-1.5 font-mono text-[8px] tracking-wide text-cyan-200">
                                        REQUESTING A READ-ONLY SNAPSHOT FROM {activeLiveParticipant?.username ?? "PLAYER"}...
                                    </div>
                                )}
                                {codeViewError && (
                                    <div role="status" aria-live="polite" className="mt-2 rounded border border-red-900/70 bg-red-950/30 px-2 py-1.5 font-mono text-[8px] tracking-wide text-red-200">
                                        {codeViewError}
                                    </div>
                                )}
                                <div className="code-toolbar-tools">
                                    <button type="button" onClick={() => { setIsQuickSearchOpen(false); setIsNodeSearchOpen(true); }} className={`code-toolbar-button ${tutorialFocus === "search-roots" ? "tutorial-control-focus" : ""}`}><span aria-hidden="true" className="code-toolbar-icon">⌕</span> SEARCH ROOTS <kbd className="code-toolbar-shortcut">/</kbd></button>
                                    <button type="button" onClick={() => setIsCustomVariablesOpen(true)} className={`code-toolbar-button ${tutorialFocus === "custom-variables" ? "tutorial-control-focus" : ""}`}><span aria-hidden="true" className="code-toolbar-icon">{'{ }'}</span> CUSTOM VARIABLES</button>
                                    <button
                                        type="button"
                                        disabled={isCodeEditingLocked || isTesting || !viewingCurrentRound
                                            || totalRootNodes >= MAX_ROOT_NODES}
                                        onClick={addRootNode}
                                        className={`code-toolbar-button code-toolbar-button-primary ${tutorialFocus === "add-root" ? "tutorial-control-focus" : ""}`}
                                    >
                                        <span aria-hidden="true" className="code-toolbar-icon">＋</span> ADD ROOT ({totalRootNodes}/{MAX_ROOT_NODES})
                                    </button>
                                </div>
                                <div className="code-toolbar-actions">
                                    <div className="code-toolbar-zoom">
                                        <button
                                            type="button"
                                            aria-label="Zoom out"
                                            onClick={() => changeZoom(-0.1)}
                                            className="code-toolbar-zoom-button"
                                        >
                                            −
                                        </button>
                                        <span className="code-toolbar-zoom-value">
                                            {Math.round(canvasZoom * 100)}%
                                        </span>
                                        <button
                                            type="button"
                                            aria-label="Zoom in"
                                            onClick={() => changeZoom(0.1)}
                                            className="code-toolbar-zoom-button"
                                        >
                                            +
                                        </button>
                                    </div>
                                    <button
                                        type="button"
                                        aria-label="Close bot code workspace"
                                        title="Close"
                                        onClick={() => { setIsNodeSearchOpen(false); setIsQuickSearchOpen(false); setIsCustomVariablesOpen(false); setIsLogicOpen(false); }}
                                        className="code-toolbar-button code-toolbar-close"
                                    >
                                        <span aria-hidden="true">×</span><span className="code-toolbar-close-label">CLOSE</span>
                                    </button>
                                </div>
                            </div>
                        </header>
                        {tutorialMode && <TutorialCodeCoach step={tutorialStep} progress={tutorialProgress} onShowSolution={onShowTutorialSolution} solutionShown={tutorialGuideProps?.solutionShown} />}
                        </div>
                        {isMatchTesting && !editingOpponent && currentRound < 0 && (
                            <div className="border-b border-border-lo bg-zinc-950 px-4 py-2">
                                {currentRound >= 3 && <div className="mb-2 border border-amber-800/70 bg-amber-950/30 px-3 py-2 font-mono text-[9px] tracking-widest text-amber-200">ROUNDS 1-2 LOGIC ARCHIVED · NOT USED FOR YOUR NEW ROLE</div>}
                                <div className="flex items-center gap-1">
                                {Array.from({ length: currentRound }, (_, index) => index + 1).map((round) => (
                                    <button
                                        key={round}
                                        type="button"
                                        onClick={() => {}}
                                        className={`h-7 border px-3 font-mono text-[9px] tracking-widest ${
                                            selectedLogicRound === round
                                                ? "border-cyan-500 bg-cyan-950 text-cyan-100"
                                                : "border-border-lo bg-zinc-900 text-ink-muted"
                                        }`}
                                    >
                                        ROUND {round}
                                    </button>
                                ))}
                                <span className="ml-auto font-mono text-[9px] tracking-widest text-ink-muted">
                                    {viewingCurrentRound
                                        ? `${currentRoundBlockCount}/${roundBlockLimit} NEW BLOCKS`
                                            : roundDeleteLocked ? "LOCKED" : "DELETE ONLY"}
                                </span>
                                </div>
                            </div>
                        )}
                        <TreeLogicBoard
                                ref={logicBoardRef}
                                configuration={activeConfiguration}
                                disabled={isCodeEditingLocked || isTesting || !viewingCurrentRound}
                                canRemove={!isCodeEditingLocked && !isTesting && !roundDeleteLocked}
                                selectedLoadout={activeLoadout}
                                selectableAbilityIds={visibleSelectableAbilityIds}
                                stateVariables={visibleStateVariables}
                                defaultVariable={defaultVariable}
                                selectableTypes={visibleSelectableTypes}
                                onChange={updateActiveConfiguration}
                                zoom={canvasZoom}
                                pan={canvasPan}
                                onPanChange={setCanvasPan}
                                onZoomChange={changeZoom}
                                onPinchZoom={applyPinchZoom}
                                tutorialFocus={tutorialFocus}
                                canUndo={!isCodeEditingLocked && !isTesting && (editHistory[activeCode]?.undo?.length ?? 0) > 0}
                                canRedo={!isCodeEditingLocked && !isTesting && (editHistory[activeCode]?.redo?.length ?? 0) > 0}
                                onUndo={() => travelHistory("undo")}
                                onRedo={() => travelHistory("redo")}
                                isSearchOpen={isNodeSearchOpen}
                                isQuickSearchOpen={isQuickSearchOpen}
                                onSearchClose={() => { setIsNodeSearchOpen(false); setIsQuickSearchOpen(false); }}
                                isExternalConfigurationOpen={isCustomVariablesOpen}
                                onCloseExternalConfiguration={() => setIsCustomVariablesOpen(false)}
                                maxLogicBlocks={maxActionNodes}
                                maxTotalConditions={maxConditionNodes}
                            />
                        {isCustomVariablesOpen && !isNodeSearchOpen && <CustomVariablesModal configuration={activeConfiguration} currentValues={activeCustomVariableValues} maxSlots={maxCustomVariableSlots} disabled={isCodeEditingLocked || isTesting} onChange={updateActiveConfiguration} onClose={() => setIsCustomVariablesOpen(false)} />}
                    </section>
                </div>,
                document.body
            )}
        </aside>
    );
}
