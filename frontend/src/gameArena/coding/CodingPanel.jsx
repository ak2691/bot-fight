import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import AddIcon from "./controls/AddIcon.jsx";
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
import TutorialGuide from "../../tutorial/TutorialGuide.jsx";
import Toast, { ToastStack } from "../../components/Toast.jsx";
import { BudgetMeter, ToolbarBracesIcon, ToolbarCloseIcon } from "./controls/WorkspaceToolbarBits.jsx";
import {
    captureTutorialNavigationScrollPosition,
    tutorialLessonNavigationForArena,
} from "../../tutorial/tutorialLessonNavigation.js";
import { botColorRole } from "../pixi/pixiVisualState.js";
import { useDialogFocus } from "../../components/useDialogFocus.js";
import {
    sanitizeConfigurationConditions,
    ToolIcon,
    countActions,
    countLogicConditions,
    abilityIdsForConfiguration,
    selectableAbilityIdsForLoadouts,
    selectableTypesForLoadouts,
    formatClock,
} from "./nodes/GraphNodes.jsx";
import { TreeLogicBoard } from "./LogicBoard.jsx";
import { HudBudget, HudButton, HudScoreboard, HudSwitchRow } from "./HudControls.jsx";
import { readAddRootShortcut } from "./addRootShortcut.js";
import { BOT_LOGIC_TREE_VERSION } from "../botlogic/code/configuration/constants.js";
import { upgradeStoredStrategyCoordinates } from "../persistence/arenaStrategyStorage.js";

const MIN_ZOOM = 0.25;
const MAX_ZOOM = 1.35;
const EMPTY_CONFIGURATION = Object.freeze({ version: BOT_LOGIC_TREE_VERSION, roots: [], customVariables: [] });

function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
}

function TutorialLessonNavigationControls({ navigation }) {
    const navigate = useNavigate();
    const location = useLocation();
    if (!navigation) return null;

    const navigateToLesson = (target) => {
        if (!target) return;
        const contentShell = typeof document === "undefined" ? null : document.querySelector(".arena-content-shell");
        const toolbarPanel = typeof document === "undefined" ? null : document.querySelector(".arena-toolbar-panel");
        const tutorialNavigationScrollPosition = captureTutorialNavigationScrollPosition({
            windowTarget: typeof window === "undefined" ? null : window,
            contentShell,
            toolbarPanel,
        });
        const currentState = location.state && typeof location.state === "object" ? location.state : {};
        navigate(target.path, {
            replace: true,
            state: { ...currentState, tutorialNavigationScrollPosition },
        });
    };

    return (
        <section className="rounded-xl border border-slate-600/70 bg-slate-900/55 p-4 shadow-[0_10px_30px_rgba(0,0,0,.2)]" aria-labelledby="tutorial-lesson-navigation-title">
            <div className="mb-3 border-b border-slate-700/80 pb-3">
                <p className="font-mono text-[9px] font-bold tracking-[.16em] text-cyan-300">TUTORIAL LESSON</p>
                <h2 id="tutorial-lesson-navigation-title" className="mt-1 break-words font-display text-lg uppercase tracking-wide text-white">
                    {navigation.lesson.title}
                </h2>
            </div>
            <div className="flex w-full gap-2" role="group" aria-label="Tutorial lesson navigation">
                <HudButton
                    icon="previous"
                    label="Previous lesson"
                    onClick={() => navigateToLesson(navigation.previous)}
                    disabled={!navigation.previous}
                    variant="half"
                    className="min-w-0"
                >
                    Previous lesson
                </HudButton>
                {navigation.next && (
                    <HudButton
                        icon="next"
                        label="Next lesson"
                        onClick={() => navigateToLesson(navigation.next)}
                        variant="half"
                        className="min-w-0"
                    >
                        Next lesson
                    </HudButton>
                )}
            </div>
        </section>
    );
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

// Small labelled count with a 3px progress bar; amber near the limit, red at it.

function ToolbarSearchIcon() {
    return <svg className="code-tb-icon" viewBox="0 0 16 16" width="15" height="15" aria-hidden="true"><circle cx="7" cy="7" r="4.5" fill="none" stroke="currentColor" strokeWidth="1.5" /><path d="M10.5 10.5 14 14" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" /></svg>;
}



export default function CodingPanel({
    configuration,
    onChange,
    opponentConfiguration = null,
    onOpponentChange = null,
    offlineCodeParticipants = null,
    selectableParticipants = null,
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
    measurementEnabled = false,
    onMeasurementToggle,
    hitboxesEnabled = false,
    onHitboxesToggle = null,
    isBaseTesting = false,
    finishStatus = null,
    finishError = null,
    isFinishingMatch = false,
    canFinishMatch = false,
    onAutoPlayToggle,
    onResetArenaStats,
    onSaveGameState = null,
    customVariableValues = {},
    opponentCustomVariableValues = {},
    onSurrenderMatch,
    onFinishMatch,
    onOpenLoadout,
    onOpenPracticeConfig = null,
    onOpenPuzzleConfig = null,
    onOpenPuzzleSubmissions = null,
    puzzleLastResult = null,
    builderControls = null,
    puzzleControls = null,
    onPuzzleSubmit = null,
    isPuzzleSubmitting = false,
    logicLimits = null,
    opponentReadOnly = false,
    tutorialGuideProps = null,
    onWorkspaceOpen = null,
}) {
    const tutorialLessonNavigation = tutorialLessonNavigationForArena({
        tutorialMode: Boolean(tutorialGuideProps),
        lessonId: tutorialGuideProps?.lessonId,
        isMatchTesting,
        isReplay: Boolean(matchContext?.replay),
    });
    const [isLogicOpen, setIsLogicOpen] = useState(false);
    const [isCustomVariablesOpen, setIsCustomVariablesOpen] = useState(false);
    const [isNodeSearchOpen, setIsNodeSearchOpen] = useState(false);
    const [isQuickSearchOpen, setIsQuickSearchOpen] = useState(false);
    const [activeCode, setActiveCode] = useState("player");
    const [confirmingSurrender, setConfirmingSurrender] = useState(false);
    const [isToolsSheetOpen, setIsToolsSheetOpen] = useState(false);
    const toolsSheetRef = useRef(null);
    useDialogFocus(toolsSheetRef, { onClose: () => setIsToolsSheetOpen(false), enabled: isToolsSheetOpen });
    const [canvasZoom, setCanvasZoom] = useState(0.85);
    const [canvasPan, setCanvasPan] = useState({ x: 40, y: 36 });
    const logicBoardRef = useRef(null);
    const logicDialogRef = useRef(null);
    const workspaceToolbarRef = useRef(null);
    const zoomToFitRef = useRef(null);
    const [workspaceToolbarHeight, setWorkspaceToolbarHeight] = useState(56);
    useLayoutEffect(() => {
        if (!isLogicOpen || !workspaceToolbarRef.current) return undefined;
        const toolbar = workspaceToolbarRef.current;
        const updateToolbarHeight = () => {
            setWorkspaceToolbarHeight(Math.max(56, Math.ceil(toolbar.getBoundingClientRect().height)));
        };
        updateToolbarHeight();
        if (typeof ResizeObserver === "undefined") return undefined;
        const observer = new ResizeObserver(updateToolbarHeight);
        observer.observe(toolbar);
        return () => observer.disconnect();
    }, [isLogicOpen]);
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
                    ?? EMPTY_CONFIGURATION
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
        : EMPTY_CONFIGURATION;
    const activeConfiguration = useMemo(
        () => activeCodeReadOnly
            ? normalizedActiveConfiguration
            : upgradeStoredStrategyCoordinates(normalizedActiveConfiguration),
        [activeCodeReadOnly, normalizedActiveConfiguration],
    );
    const activeLoadout = activeLoadoutSource;
    const validation = validateAbilityStrategyConfiguration(activeConfiguration);
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
        : isMatchTesting ? matchContext?.player : selectableParticipants?.[0] ?? offlineCodeRoster[0];
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
            : selectableParticipants ?? codeSelectorRoster;
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
    }, [activeParticipant, codeSelectorRoster, isMatchTesting, matchContext, selectableParticipants]);
    const blueTeamRoundWins = roundWinsForTeam(liveCodeRoster, 1);
    const redTeamRoundWins = roundWinsForTeam(liveCodeRoster, 2);
    const isCodeEditingLocked = isBotCodeLocked || activeCodeReadOnly;
    const openLogicWorkspace = useCallback((quickSearch = false) => {
        if (isBotCodeLocked) return;
        onWorkspaceOpen?.();
        setIsLogicOpen(true);
        if (quickSearch) {
            setIsQuickSearchOpen(true);
            setIsNodeSearchOpen(true);
        }
    }, [isBotCodeLocked, onWorkspaceOpen]);
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
        version: BOT_LOGIC_TREE_VERSION,
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
    // Zoom keeps the point under the cursor fixed. Latest zoom / pan live in refs
    // (updated synchronously) so rapid wheel events and StrictMode double renders
    // never apply the pan correction twice or from a stale value.
    const zoomRef = useRef(canvasZoom);
    const panRef = useRef(canvasPan);
    useEffect(() => { zoomRef.current = canvasZoom; panRef.current = canvasPan; });
    const changeZoom = (delta, origin = null) => {
        const currentZoom = zoomRef.current;
        const nextZoom = clamp(Number((currentZoom + delta).toFixed(2)), MIN_ZOOM, MAX_ZOOM);
        if (nextZoom === currentZoom) return;
        // Toolbar buttons have no cursor point, so zoom about the centre of the board.
        let anchor = origin;
        if (!anchor) {
            const rect = logicDialogRef.current?.querySelector(".code-board")?.getBoundingClientRect();
            if (rect) anchor = { x: rect.width / 2, y: rect.height / 2 };
        }
        if (anchor) {
            const currentPan = panRef.current;
            const nextPan = {
                x: anchor.x - ((anchor.x - currentPan.x) / currentZoom) * nextZoom,
                y: anchor.y - ((anchor.y - currentPan.y) / currentZoom) * nextZoom,
            };
            panRef.current = nextPan;
            setCanvasPan(nextPan);
        }
        zoomRef.current = nextZoom;
        setCanvasZoom(nextZoom);
    };
    const applyPinchZoom = (nextZoom, nextPan) => {
        zoomRef.current = nextZoom;
        panRef.current = nextPan;
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
    // "Sandbox" | "Real code" | "Read-only snapshot" | "Opponent code is private"; a teammate gets a toggle instead.
    const showLiveModeToggle = isMatchTesting && !isViewingOwnCode && Boolean(activeLiveParticipant && activeLiveIsTeammate);
    const selectorModeText = !isMatchTesting
        ? "Sandbox"
        : isViewingOwnCode
            ? "Real code"
            : showLiveModeToggle
                ? (activeCodeReadOnly ? "Read-only snapshot" : null)
                : "Opponent code is private";
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
    const finishBusy = finishStatus === "SUBMITTING" || finishStatus === "SURRENDERING" || isFinishingMatch;
    const matchClosed = finishStatus === "SURRENDERED" || finishStatus === "FINISHED";
    const surrenderVoted = finishStatus === "SURRENDER_VOTED";
    const lockLabel = finishStatus === "FINISHED"
        ? "LOCKED IN"
        : finishStatus === "SURRENDERED"
            ? "RESIGNED"
            : surrenderVoted
                ? "LOCK IN / WITHDRAW VOTE"
                : finishBusy
                    ? "LOCKING IN"
                    : "LOCK IN";
    const surrenderLabel = finishStatus === "SURRENDERING"
        ? "Surrendering"
        : surrenderVoted ? "Withdraw vote" : "Surrender vote";
    const surrenderDisabled = !onSurrenderMatch || matchClosed || finishBusy || isTesting;
    const isPuzzleRoom = Boolean(onPuzzleSubmit);
    const primaryAction = isMatchTesting ? (
        <HudButton
            variant="primary"
            icon="check"
            className="hud-btn--lg"
            onClick={onFinishMatch}
            disabled={!canFinishMatch || matchClosed || finishBusy || isTesting}
        >
            {lockLabel}
        </HudButton>
    ) : isPuzzleRoom ? (
        <HudButton
            variant="primary"
            icon="check"
            className="hud-btn--lg"
            onClick={onPuzzleSubmit}
            disabled={isPuzzleSubmitting || isBaseTesting || isTesting}
        >
            {isPuzzleSubmitting ? "Submitting" : "Submit"}
        </HudButton>
    ) : (
        <HudButton
            variant="play"
            icon={isAutoPlaying ? "pause" : "play"}
            className="hud-btn--lg"
            onClick={onAutoPlayToggle}
            disabled={isBaseTesting || isTesting}
        >
            {isAutoPlaying ? "PAUSE" : "PLAY"}
        </HudButton>
    );
    const editCodeDisabled = isBotCodeLocked;
    const previewLabel = isAutoPlaying ? "Pause" : "Preview";
    const surrenderControl = isMatchTesting && (
        confirmingSurrender && !surrenderVoted ? (
            <div className="hud-confirm" role="group" aria-label="Confirm surrender vote">
                <span>Vote to surrender this match?</span>
                <button type="button" className="hud-link hud-link--danger" onClick={() => { setConfirmingSurrender(false); onSurrenderMatch?.(); }}>Yes, vote</button>
                <button type="button" className="hud-link" onClick={() => setConfirmingSurrender(false)}>Cancel</button>
            </div>
        ) : (
            <button
                type="button"
                className="hud-link hud-link--danger hud-surrender"
                disabled={surrenderDisabled}
                onClick={() => (surrenderVoted ? onSurrenderMatch?.() : setConfirmingSurrender(true))}
            >
                <ToolIcon name="flag" className="h-4 w-4" /> {surrenderLabel}
            </button>
        )
    );
    const brainExtras = (
        <>
            {onOpenPuzzleSubmissions && (
                <button type="button" onClick={onOpenPuzzleSubmissions} className="puzzle-submissions-row" aria-haspopup="dialog">
                    <span className="flex items-center gap-2"><ToolIcon name="reset" className="h-4 w-4" /> <span>Submissions</span></span>
                    <span className={`puzzle-submissions-row__last puzzle-submissions-row__last--${puzzleLastResult ?? "none"}`}>
                        {puzzleLastResult ? `Last: ${puzzleLastResult}` : "None yet"} <span aria-hidden="true">&rsaquo;</span>
                    </span>
                </button>
            )}
        </>
    );
    const budget = (
        <HudBudget
            actions={countActions(activeConfiguration)}
            maxActions={maxActionNodes}
            conditions={countLogicConditions(activeConfiguration)}
            maxConditions={maxConditionNodes}
        />
    );
    const toolsBody = (
        <>
            <div className="hud-switches">
                <HudSwitchRow icon="measure" label="Measure" checked={measurementEnabled} onChange={onMeasurementToggle} disabled={!onMeasurementToggle} />
                {onHitboxesToggle && (
                    <HudSwitchRow icon="target" label="Hitboxes" checked={hitboxesEnabled} onChange={onHitboxesToggle} />
                )}
            </div>
            <div className="hud-grid">
                <HudButton icon="stats" onClick={onResetArenaStats} disabled={!onResetArenaStats || isBaseTesting || isTesting}>Reset stats</HudButton>
                {onSaveGameState && (
                    <HudButton icon="save" onClick={onSaveGameState} disabled={isAutoPlaying}>Save state</HudButton>
                )}
                {!isMatchTesting && onOpenPracticeConfig && (
                    <HudButton icon="tools" label="Practice setup" onClick={onOpenPracticeConfig} disabled={isTesting || isAutoPlaying}>Setup</HudButton>
                )}
                {!isMatchTesting && onOpenPuzzleConfig && (
                    <HudButton icon="tools" label="Puzzle setup" onClick={onOpenPuzzleConfig} disabled={isTesting || isAutoPlaying}>Setup</HudButton>
                )}
                {!isMatchTesting && onOpenLoadout && (
                    <HudButton icon="edit" onClick={onOpenLoadout} disabled={isTesting || isAutoPlaying}>Loadout</HudButton>
                )}
            </div>
            {surrenderControl}
        </>
    );
    return (
        <aside className={`arena-toolbar-panel hud-panel ${usesArenaResponsiveLimits ? "arena-right-toolbar" : ""} h-full min-h-0 w-[23rem] flex-shrink-0 overflow-y-auto border-l border-slate-700/70 p-4`}>
            <div className="hud-stack">
                {isMatchTesting && (
                    <HudScoreboard
                        blueScore={blueTeamRoundWins}
                        redScore={redTeamRoundWins}
                        roundLabel={`${matchContext?.roundNumber ?? 1}/${totalRounds}`}
                        clock={formatClock(testingRemaining)}
                    />
                )}
                {typeof builderControls === "function"
                    ? builderControls({
                        openOpponentCode: () => { setActiveCode("opponent"); openLogicWorkspace(false); },
                        startTest: onAutoPlayToggle,
                    })
                    : builderControls}
                {puzzleControls}
                {isMatchTesting && Number(matchContext?.surrenderVoteRequired) > 0
                    && Number(matchContext?.surrenderVoteCount) > 0 && (
                    <div className="hud-notice hud-notice--red">
                        {teamLabel(participantTeamNumber(matchContext?.player))} forfeit votes: {matchContext.surrenderVoteCount}/{matchContext.surrenderVoteRequired}
                    </div>
                )}
                {isMatchTesting && matchContext?.opponent?.finished && finishStatus !== "FINISHED" && (
                    <div className="hud-notice hud-notice--green">Opponent locked in</div>
                )}
                {isMatchTesting && testingRemaining === 0 && finishStatus === "BUILDING" && (
                    <div role="status" aria-live="polite" className="hud-notice hud-notice--cyan">
                        <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-cyan-300/80" aria-hidden="true" />
                        Preparing replay · you can still lock in
                    </div>
                )}

                <section className="hud-card hud-card--brain" aria-labelledby="hud-brain-title">
                    <h2 id="hud-brain-title" className="hud-card__title"><ToolIcon name="node" className="h-4 w-4" /> Your bot's brain</h2>
                    {budget}
                    {primaryAction}
                    <div className="hud-row">
                        {isPuzzleRoom && (
                            <HudButton variant="play" icon={isAutoPlaying ? "pause" : "play"} className="hud-btn--half" onClick={onAutoPlayToggle} disabled={isBaseTesting || isTesting}>
                                {isAutoPlaying ? "Pause" : "Play"}
                            </HudButton>
                        )}
                        <HudButton icon="node" onClick={() => openLogicWorkspace(false)} disabled={editCodeDisabled}>
                            {isBotCodeLocked ? "Code locked" : "Edit code"}
                        </HudButton>
                        {isMatchTesting && (
                            <HudButton icon={isAutoPlaying ? "pause" : "play"} onClick={onAutoPlayToggle} disabled={isBaseTesting || isTesting}>
                                {previewLabel}
                            </HudButton>
                        )}
                    </div>
                    {brainExtras}
                </section>
                <section className="hud-card hud-card--tools" aria-labelledby="hud-tools-title">
                    <h2 id="hud-tools-title" className="hud-card__title">Tools</h2>
                    {toolsBody}
                </section>
                {validation.errors.map((error) => <p key={error} className="hud-message hud-message--error">{error}</p>)}
                {validation.warnings?.map((warning) => <p key={warning} className="hud-message hud-message--warn">Warning: {warning}</p>)}
                {finishError && <p className="hud-message hud-message--error">{finishError}</p>}
                {tutorialLessonNavigation && <TutorialLessonNavigationControls navigation={tutorialLessonNavigation} />}
            </div>

            <div className="hud-actionbar" role="toolbar" aria-label="Bot actions">
                {primaryAction}
                {isPuzzleRoom && (
                    <HudButton variant="icon" icon={isAutoPlaying ? "pause" : "play"} label={isAutoPlaying ? "Pause" : "Play"} onClick={onAutoPlayToggle} disabled={isBaseTesting || isTesting} />
                )}
                {!isPuzzleRoom && <HudButton variant="icon" icon="node" label={isBotCodeLocked ? "Code locked" : "Edit code"} onClick={() => openLogicWorkspace(false)} disabled={editCodeDisabled} />}
                {isMatchTesting && (
                    <HudButton variant="icon" icon={isAutoPlaying ? "pause" : "play"} label={previewLabel} onClick={onAutoPlayToggle} disabled={isBaseTesting || isTesting} />
                )}
                <HudButton variant="icon" label="More tools" onClick={() => setIsToolsSheetOpen(true)}>⋯</HudButton>
            </div>
            {isToolsSheetOpen && (
                <>
                    <div className="hud-sheet-backdrop" onClick={() => setIsToolsSheetOpen(false)} />
                    <div ref={toolsSheetRef} className="hud-sheet" role="dialog" aria-modal="true" aria-labelledby="hud-sheet-title" tabIndex={-1}>
                        <div className="hud-sheet__header">
                            <h2 id="hud-sheet-title" className="hud-card__title">Tools</h2>
                            <button type="button" className="hud-btn hud-btn--icon" aria-label="Close tools" onClick={() => setIsToolsSheetOpen(false)}>✕</button>
                        </div>
                        <div className="hud-sheet__body">
                            <div className="hud-card hud-card--brain">
                                <h3 className="hud-card__title"><ToolIcon name="node" className="h-4 w-4" /> Your bot's brain</h3>
                                {budget}
                                {isPuzzleRoom && (
                                    <HudButton icon="node" className="hud-btn--wide" onClick={() => { setIsToolsSheetOpen(false); openLogicWorkspace(false); }} disabled={editCodeDisabled}>
                                        {isBotCodeLocked ? "Code locked" : "Edit code"}
                                    </HudButton>
                                )}
                                {brainExtras}
                            </div>
                            {toolsBody}
                        </div>
                    </div>
                </>
            )}

            {isLogicOpen && !isBotCodeLocked && typeof document !== "undefined" && createPortal(
                <div className="code-workspace-overlay fixed inset-0 z-40 flex items-center justify-center overflow-hidden bg-black/70 px-4 py-5">
                    <section ref={logicDialogRef} style={{ "--tutorial-workspace-toolbar-height": `${workspaceToolbarHeight}px` }} className="code-workspace relative flex h-[min(90vh,820px)] w-[min(94vw,1440px)] flex-col overflow-hidden rounded-sm border border-border-mid bg-[#111519] shadow-2xl" role="dialog" aria-modal="true" aria-labelledby="code-workspace-title" tabIndex={-1}>
                        <div className="code-workspace-top-layer">
                        <header ref={workspaceToolbarRef} className="code-tb">
                            <h2 id="code-workspace-title" className="sr-only">Bot code workspace</h2>
                            {codeSelectorRoster.length > 0 && (
                                <div className={`code-tb-bot ${activeSelectorRole === "red" ? "is-red" : "is-blue"}`} role="group" aria-label="Select bot code workspace">
                                    <button type="button" aria-label="Show previous bot" title="Previous bot" onClick={() => cycleCodeParticipant(-1)} disabled={codeSelectorRoster.length < 2} className="code-tb-arrow">‹</button>
                                    <span className="code-tb-dot" aria-hidden="true" />
                                    <div className={`code-tb-bot-text ${showLiveModeToggle ? "has-toggle" : ""}`} aria-live="polite">
                                        <span className="code-tb-bot-line">
                                            <span className="code-tb-bot-name">{activeSelectorLabel}</span>
                                            {showLiveModeToggle && (
                                                <span className="code-tb-toggle-wide">
                                                    <span className="code-tb-segmented" role="group" aria-label="Code view">
                                                    <button type="button" disabled={isBotCodeLocked} aria-pressed={viewingLiveSandbox} className={viewingLiveSandbox ? "is-active" : ""} onClick={() => { if (!viewingLiveSandbox) toggleLiveCodeMode(); }}>Sandbox</button>
                                                    <button type="button" disabled={isBotCodeLocked} aria-pressed={!viewingLiveSandbox} className={!viewingLiveSandbox ? "is-active" : ""} onClick={() => { if (viewingLiveSandbox) toggleLiveCodeMode(); }}>Real</button>
                                                </span>
                                                </span>
                                            )}
                                        </span>
                                        {showLiveModeToggle && (
                                            <span className="code-tb-toggle-phone">
                                                <span className="code-tb-segmented" role="group" aria-label="Code view">
                                                    <button type="button" disabled={isBotCodeLocked} aria-pressed={viewingLiveSandbox} className={viewingLiveSandbox ? "is-active" : ""} onClick={() => { if (!viewingLiveSandbox) toggleLiveCodeMode(); }}>Sandbox</button>
                                                    <button type="button" disabled={isBotCodeLocked} aria-pressed={!viewingLiveSandbox} className={!viewingLiveSandbox ? "is-active" : ""} onClick={() => { if (viewingLiveSandbox) toggleLiveCodeMode(); }}>Real</button>
                                                </span>
                                            </span>
                                        )}
                                        <span className="code-tb-bot-meta">{[teamLabel(participantTeamNumber(activeSelectorParticipant)), selectorModeText, `${Math.max(1, activeSelectorIndex + 1)} of ${codeSelectorRoster.length}`].filter(Boolean).join(" · ")}</span>
                                    </div>
                                    <button type="button" aria-label="Show next bot" title="Next bot" onClick={() => cycleCodeParticipant(1)} disabled={codeSelectorRoster.length < 2} className="code-tb-arrow">›</button>
                                </div>
                            )}
                            <span className="code-tb-divider" aria-hidden="true" />
                            <div className="code-tb-meters" role="group" aria-label="Code budget">
                                <BudgetMeter label="Roots" value={totalRootNodes} max={MAX_ROOT_NODES} />
                                <BudgetMeter label="Actions" value={totalActiveBlocks} max={maxActionNodes} />
                                <BudgetMeter label="Conditions" value={totalActiveConditions} max={maxConditionNodes} />
                            </div>
                            <div className="code-tb-chips" role="group" aria-label="Code budget">
                                <BudgetMeter label="R" title="Roots" value={totalRootNodes} max={MAX_ROOT_NODES} compact />
                                <BudgetMeter label="A" title="Actions" value={totalActiveBlocks} max={maxActionNodes} compact />
                                <BudgetMeter label="C" title="Conditions" value={totalActiveConditions} max={maxConditionNodes} compact />
                            </div>
                            <span className="code-tb-break" aria-hidden="true" />
                            <span className="code-tb-spacer" />
                            <button type="button" onClick={() => { setIsQuickSearchOpen(false); setIsNodeSearchOpen(true); }} className="code-tb-search" aria-label="Search roots" title="Search roots">
                                <ToolbarSearchIcon />
                                <span className="code-tb-search-text">Search roots</span>
                                <kbd className="code-tb-kbd">/</kbd>
                            </button>
                            <button type="button" onClick={() => setIsCustomVariablesOpen(true)} className="code-tb-btn" aria-label="Custom variables" title="Custom variables">
                                <ToolbarBracesIcon />
                                <span className="code-tb-label">Variables</span>
                            </button>
                            <button
                                type="button"
                                disabled={isCodeEditingLocked || isTesting || !viewingCurrentRound
                                    || totalRootNodes >= MAX_ROOT_NODES}
                                onClick={addRootNode}
                                className="code-tb-btn is-primary"
                                aria-label="Add root"
                                title="Add root"
                            >
                                <AddIcon className="code-toolbar-icon" /> <span className="code-tb-label">Add root</span> <kbd className="code-tb-kbd">{readAddRootShortcut().toUpperCase()}</kbd>
                            </button>
                            <button
                                type="button"
                                aria-label="Close bot code workspace"
                                title="Close"
                                onClick={() => { setIsNodeSearchOpen(false); setIsQuickSearchOpen(false); setIsCustomVariablesOpen(false); setIsLogicOpen(false); }}
                                className="code-tb-close"
                            >
                                <ToolbarCloseIcon />
                            </button>
                        </header>
                        {((viewingLiveReal && !activeCodeSnapshot) || codeViewError) && (
                            <ToastStack>
                                {viewingLiveReal && !activeCodeSnapshot && (
                                    <Toast tone="info">Requesting a read-only snapshot from {activeLiveParticipant?.username ?? "player"}...</Toast>
                                )}
                                {codeViewError && <Toast tone="error">{codeViewError}</Toast>}
                            </ToastStack>
                        )}
                        </div>
                        <div className="code-zoom-cluster" role="group" aria-label="Zoom">
                            <button type="button" aria-label="Zoom out" title="Zoom out" onClick={() => changeZoom(-0.1)}>−</button>
                            <span className="code-zoom-value">{Math.round(canvasZoom * 100)}%</span>
                            <button type="button" aria-label="Zoom in" title="Zoom in" onClick={() => changeZoom(0.1)}>+</button>
                            <button type="button" aria-label="Zoom to fit the tree" title="Zoom to fit" onClick={() => zoomToFitRef.current?.()}>⤢</button>
                        </div>
                        {tutorialGuideProps && (
                            <div className="tg-workspace-host">
                                <TutorialGuide {...tutorialGuideProps} variant="workspace" />
                            </div>
                        )}
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
                                zoomToFitRef={zoomToFitRef}
                                onPinchZoom={applyPinchZoom}
                                canUndo={!isCodeEditingLocked && !isTesting && (editHistory[activeCode]?.undo?.length ?? 0) > 0}
                                canRedo={!isCodeEditingLocked && !isTesting && (editHistory[activeCode]?.redo?.length ?? 0) > 0}
                                onUndo={() => travelHistory("undo")}
                                onRedo={() => travelHistory("redo")}
                                onAddRoot={addRootNode}
                                canAddRoot={totalRootNodes < MAX_ROOT_NODES}
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
