import { useEffect, useMemo, useRef, useState } from "react";
import {
    CONDITION_TYPES,
    STATE_VARIABLES,
    createCodeRoot,
    customVariableDefinitions,
    MAX_ROOT_NODES,
    MAX_LOGIC_BLOCKS,
    MAX_TOTAL_CONDITIONS,
    normalizeRoots,
    validateAbilityStrategyConfiguration,
    normalizeAbilityStrategyConfiguration,
} from "../botlogic/code/BotCode.js";
import { BOT_ABILITIES, statusEffectDefinitionsForAbilities } from "../loadout/BotLoadout.js";
import CustomVariablesModal from "./modals/CustomVariablesModal.jsx";
import TutorialGuide, { getTutorialProgress, TutorialCodeCoach } from "../../tutorial/TutorialGuide.jsx";
import { botColorRole } from "../pixi/pixiVisualState.js";
import { useDialogFocus } from "../../components/useDialogFocus.js";
import {
    ConditionEditor,
    sanitizeConfigurationConditions,
    ScoreBox,
    PanelHeading,
    ToolIcon,
    ControlButton,
    CodeTab,
    countActions,
    countLogicConditions,
    abilityIdsForConfiguration,
    targetTypesForLoadouts,
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

export default function CodingPanel({
    configuration,
    onChange,
    opponentConfiguration = null,
    onOpponentChange = null,
    isTesting,
    selectedLoadout,
    opponentLoadout,
    isMatchTesting = false,
    usesArenaResponsiveLimits = false,
    matchContext = null,
    testingRemaining = null,
    playerRoundWins = 0,
    opponentRoundWins = 0,
    isAutoPlaying = false,
    measurementEnabled = false,
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
    onOpenPlayerLoadout,
    onOpenOpponentLoadout,
    tutorialMode = false,
    tutorialGuideProps = null,
    tutorialStep = 0,
    onShowTutorialSolution,
}) {
    const [isLogicOpen, setIsLogicOpen] = useState(false);
    const [hasOpenedLogic, setHasOpenedLogic] = useState(() => tutorialMode && loadTutorialOpenedLogic());
    const [isCustomVariablesOpen, setIsCustomVariablesOpen] = useState(false);
    const [isNodeSearchOpen, setIsNodeSearchOpen] = useState(false);
    const [activeCode, setActiveCode] = useState("player");
    const [canvasZoom, setCanvasZoom] = useState(0.85);
    const [canvasPan, setCanvasPan] = useState({ x: 40, y: 36 });
    const logicBoardRef = useRef(null);
    const logicDialogRef = useRef(null);
    const closeTopLogicLayer = () => {
        if (isNodeSearchOpen) {
            setIsNodeSearchOpen(false);
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
    const currentRound = Math.max(1, Number(matchContext?.roundNumber) || 1);
    const validation = validateAbilityStrategyConfiguration(configuration);
    const editingOpponent = activeCode === "opponent" && opponentConfiguration && onOpponentChange;
    const playerBotLabel = matchContext?.player?.username ? `${matchContext.player.username}'s bot` : "Your bot";
    const activeLoadout = editingOpponent ? opponentLoadout : selectedLoadout;
    const opposingLoadout = editingOpponent ? selectedLoadout : opponentLoadout;
    const activeConfiguration = editingOpponent ? opponentConfiguration : configuration;
    const activeCustomVariableValues = editingOpponent ? opponentCustomVariableValues : customVariableValues;
    const applyActiveConfiguration = (next) => {
        if (editingOpponent) onOpponentChange(next);
        else onChange(next);
    };
    const updateActiveConfiguration = (next) => {
        if (next === activeConfiguration) return;
        setEditHistory((current) => ({ ...current, [activeCode]: { undo: [...current[activeCode].undo.slice(-49), activeConfiguration], redo: [] } }));
        applyActiveConfiguration(next);
    };
    const travelHistory = (direction) => {
        if (isTesting) return;
        const history = editHistory[activeCode];
        const next = history[direction].at(-1);
        if (!next) return;
        const destination = direction === "undo" ? "redo" : "undo";
        setEditHistory((current) => ({ ...current, [activeCode]: {
            ...current[activeCode],
            [direction]: current[activeCode][direction].slice(0, -1),
            [destination]: [...current[activeCode][destination], activeConfiguration],
        } }));
        applyActiveConfiguration(next);
    };
    const updateRoots = (roots) => updateActiveConfiguration({
        ...activeConfiguration,
        version: "bot-logic-tree-v1",
        roots: normalizeRoots(roots),
        customVariables: activeConfiguration?.customVariables ?? [],
    });
    const totalActiveBlocks = countActions(activeConfiguration);
    const totalRootNodes = activeConfiguration?.roots?.length ?? 0;
    const totalActiveConditions = countLogicConditions(activeConfiguration);
    const usesTree = Array.isArray(activeConfiguration?.roots);
    const viewingCurrentRound = true;
    const roundDeleteLocked = false;
    const selectedLogicRound = currentRound;
    const currentRoundBlockCount = totalActiveBlocks;
    const roundBlockLimit = MAX_LOGIC_BLOCKS;
    const totalRounds = isMatchTesting ? 3 : Math.max(1, (matchContext?.winsRequired ?? 1) * 2 - 1);
    const tutorialProgress = tutorialMode
        ? getTutorialProgress(tutorialStep, configuration, { hasOpenedLogic, isAutoPlaying, challenge: tutorialGuideProps?.challenge })
        : null;
    const tutorialFocus = tutorialProgress?.focus;
    const handleTutorialStepChange = (nextStep) => {
        setIsLogicOpen(false);
        setIsCustomVariablesOpen(false);
        setIsNodeSearchOpen(false);
        tutorialGuideProps?.onStepChange?.(nextStep);
    };
    const visibleConditionTypes = CONDITION_TYPES;
    const visibleStateVariables = useMemo(() => {
        const ownAbilities = abilityIdsForConfiguration(activeLoadout);
        const opponentAbilities = abilityIdsForConfiguration(opposingLoadout);
        const builtIns = STATE_VARIABLES.map((variable) => {
            if (!variable.supportsAbility && !variable.supportsStatusEffect) return variable;
            const equipped = variable.supportsStatusEffect
                ? variable.statusEffectOwner === "opponent" ? opponentAbilities : ownAbilities
                : variable.abilityOwner === "opponent" ? opponentAbilities : ownAbilities;
            return {
                ...variable,
                ...(variable.supportsAbility ? {
                    abilityOptions: BOT_ABILITIES.filter((ability) => equipped.has(ability.id) && (!variable.requiredTag || ability.tags.includes(variable.requiredTag))),
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
    const defaultVariable = visibleStateVariables.find((variable) => variable.id === "target.distance")
        ?? visibleStateVariables[0]
        ?? STATE_VARIABLES[0];
    const visibleTargetTypes = useMemo(
        () => targetTypesForLoadouts(activeLoadout, opposingLoadout),
        [activeLoadout, opposingLoadout],
    );
    useEffect(() => {
        const sanitized = sanitizeConfigurationConditions(activeConfiguration, visibleConditionTypes, defaultCondition);
        if (sanitized === activeConfiguration) return;
        if (editingOpponent) onOpponentChange?.(sanitized);
        else onChange(sanitized);
    }, [activeConfiguration, activeLoadout, opposingLoadout, defaultCondition, editingOpponent, onChange, onOpponentChange, visibleConditionTypes]);

    useEffect(() => {
        if (!isLogicOpen || usesTree) return;
        const tree = normalizeAbilityStrategyConfiguration(activeConfiguration);
        if (editingOpponent) onOpponentChange?.(tree);
        else onChange(tree);
    }, [activeConfiguration, editingOpponent, isLogicOpen, onChange, onOpponentChange, usesTree]);

    const addRootNode = () => {
        if (totalRootNodes >= MAX_ROOT_NODES) return;
        const roots = activeConfiguration.roots ?? [];
        const nextPriority = roots.reduce((highest, root) => Math.max(highest, Number(root?.createdOrder) + 1 || 0), 0) + 1;
        const root = createCodeRoot(nextPriority - 1);
        root.branches = [];
        const nextRoots = [...roots, root];
        logicBoardRef.current?.placeRootAtCenter(nextRoots, nextRoots.length - 1);
        updateRoots(nextRoots);
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

    return (
        <aside className={`${usesArenaResponsiveLimits ? "arena-right-toolbar" : ""} testing-mono h-full min-h-0 w-[23rem] flex-shrink-0 overflow-y-auto border-l border-slate-700/70 bg-[linear-gradient(180deg,rgba(12,22,31,.98),rgba(8,16,24,.98))] p-4 shadow-[-12px_0_30px_rgba(0,0,0,.28)]`}>
            <div className="space-y-4">
                {tutorialGuideProps && <TutorialGuide {...tutorialGuideProps} onStepChange={handleTutorialStepChange} progress={tutorialProgress} />}
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
                            <ScoreBox label="YOU" value={playerRoundWins} tone={botColorRole(matchContext?.player)} />
                            <ScoreBox label={matchContext?.opponent?.username ?? "OPP"} value={opponentRoundWins} tone={botColorRole(matchContext?.opponent)} />
                        </div>
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
                        <strong className="font-interface-numeric text-ink-muted">{countActions(configuration)}/{MAX_LOGIC_BLOCKS} A · {countLogicConditions(configuration)}/{MAX_TOTAL_CONDITIONS} C</strong>
                    </div>
                    <button
                        type="button"
                        onClick={() => { setHasOpenedLogic(true); if (tutorialMode) saveTutorialOpenedLogic(); setIsLogicOpen(true); }}
                        className={`font-display-action mt-4 flex min-h-14 w-full items-center justify-center gap-3 rounded-lg border border-cyan-500/80 bg-cyan-950/20 px-4 text-base tracking-[.025em] text-cyan-200 shadow-[0_0_18px_rgba(34,211,238,.08)] transition hover:bg-cyan-900/35 ${tutorialFocus === "open-code" ? "tutorial-control-focus" : ""}`}
                    >
                        <ToolIcon name="node" /> OPEN BOT CODE
                    </button>
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
                            tone={isAutoPlaying ? "neutral" : "blue"}
                            className={tutorialFocus === "play" ? "tutorial-control-focus" : ""}
                        >
                            {isAutoPlaying ? "PAUSE" : "PLAY"}
                        </ControlButton>
                        {isMatchTesting && (
                            <>
                            <ControlButton
                                icon="check"
                                onClick={onFinishMatch}
                                disabled={!canFinishMatch || finishStatus === "FINISHED" || finishStatus === "SURRENDERED" || finishStatus === "SUBMITTING" || finishStatus === "SURRENDERING" || isFinishingMatch || isTesting}
                                tone={finishStatus === "FINISHED" ? "green" : finishStatus === "SURRENDERED" ? "red" : "green"}
                            >
                                {finishStatus === "FINISHED"
                                    ? "FINISHED"
                                    : finishStatus === "SURRENDERED"
                                        ? "RESIGNED"
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
                                {finishStatus === "SURRENDERING" ? "SURRENDERING" : "FORFEIT"}
                            </ControlButton>
                            </>
                        )}
                        <ControlButton icon="measure" onClick={onMeasurementToggle} disabled={!onMeasurementToggle} tone={measurementEnabled ? "blue" : "neutral"}>
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
                        {!isMatchTesting && (
                            <>
                            <ControlButton icon="edit" onClick={onOpenPlayerLoadout} disabled={!onOpenPlayerLoadout || isTesting || isAutoPlaying} tone="violet">
                                EDIT MY LOADOUT
                            </ControlButton>
                            <ControlButton icon="opponent" onClick={onOpenOpponentLoadout} disabled={!onOpenOpponentLoadout || isTesting || isAutoPlaying} tone="violet">
                                EDIT DUMMY LOADOUT
                            </ControlButton>
                            </>
                        )}
                    </div>
                    {finishError && <p className="mt-2 rounded border border-red-800/70 bg-red-950/40 px-2 py-2 font-mono text-[9px] leading-relaxed text-red-200">{finishError}</p>}
                </section>
            </div>

            {isLogicOpen && (
                <div className="fixed inset-0 z-40 flex items-center justify-center overflow-y-auto bg-black/70 px-4 py-5">
                    <section ref={logicDialogRef} className="code-workspace testing-mono relative flex h-[min(90vh,820px)] w-[min(94vw,1440px)] flex-col overflow-hidden rounded-sm border border-border-mid bg-[#111519] shadow-2xl" role="dialog" aria-modal="true" aria-labelledby="code-workspace-title" tabIndex={-1}>
                        <header className="code-toolbar flex min-h-[84px] flex-shrink-0 items-center gap-4 border-b border-white/10 bg-[#12161a] px-5 py-3 shadow-[0_8px_24px_rgba(0,0,0,.18)]">
                            <div className="code-toolbar-title flex-none">
                                <div id="code-workspace-title" className="font-mono text-[11px] font-bold tracking-widest text-cyan">BOT CODE WORKSPACE</div>
                                <div className="mt-1 truncate font-mono text-[8px] tracking-wide text-ink-muted">
                                    {editingOpponent ? "TESTING OPPONENT" : "YOUR BOT"} - {totalActiveBlocks}/{MAX_LOGIC_BLOCKS} A - {totalActiveConditions}/{MAX_TOTAL_CONDITIONS} C
                                </div>
                            </div>
                            <div className="code-toolbar-controls min-w-0 flex-1 py-0.5">
                                {opponentConfiguration && onOpponentChange && (
                                    <div className="code-tab-group">
                                        <CodeTab active={activeCode === "player"} onClick={() => setActiveCode("player")}>{playerBotLabel}</CodeTab>
                                        <CodeTab active={activeCode === "opponent"} onClick={() => setActiveCode("opponent")}>Opponent bot</CodeTab>
                                    </div>
                                )}
                                <div className="code-toolbar-tools">
                                    <button type="button" onClick={() => setIsNodeSearchOpen(true)} className={`code-toolbar-button ${tutorialFocus === "search-roots" ? "tutorial-control-focus" : ""}`}><span aria-hidden="true" className="code-toolbar-icon">⌕</span> SEARCH ROOTS</button>
                                    <button type="button" onClick={() => setIsCustomVariablesOpen(true)} className={`code-toolbar-button ${tutorialFocus === "custom-variables" ? "tutorial-control-focus" : ""}`}><span aria-hidden="true" className="code-toolbar-icon">{'{ }'}</span> CUSTOM VARIABLES</button>
                                    <button
                                        type="button"
                                        disabled={isTesting || !viewingCurrentRound
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
                                        onClick={() => { setIsNodeSearchOpen(false); setIsCustomVariablesOpen(false); setIsLogicOpen(false); }}
                                        className="code-toolbar-button code-toolbar-close"
                                    >
                                        <span aria-hidden="true">×</span><span className="code-toolbar-close-label">CLOSE</span>
                                    </button>
                                </div>
                            </div>
                        </header>
                        {tutorialMode && <TutorialCodeCoach step={tutorialStep} progress={tutorialProgress} onShowSolution={onShowTutorialSolution} solutionShown={tutorialGuideProps?.solutionShown} />}
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
                                disabled={isTesting || !viewingCurrentRound}
                                canRemove={!isTesting && !roundDeleteLocked}
                                selectedLoadout={activeLoadout}
                                stateVariables={visibleStateVariables}
                                defaultVariable={defaultVariable}
                                targetTypes={visibleTargetTypes}
                                onChange={updateActiveConfiguration}
                                zoom={canvasZoom}
                                pan={canvasPan}
                                onPanChange={setCanvasPan}
                                onZoomChange={changeZoom}
                                tutorialFocus={tutorialFocus}
                                canUndo={!isTesting && editHistory[activeCode].undo.length > 0}
                                canRedo={!isTesting && editHistory[activeCode].redo.length > 0}
                                onUndo={() => travelHistory("undo")}
                                onRedo={() => travelHistory("redo")}
                                isSearchOpen={isNodeSearchOpen}
                                onSearchClose={() => setIsNodeSearchOpen(false)}
                                isExternalConfigurationOpen={isCustomVariablesOpen}
                                onCloseExternalConfiguration={() => setIsCustomVariablesOpen(false)}
                            />
                        {isCustomVariablesOpen && !isNodeSearchOpen && <CustomVariablesModal configuration={activeConfiguration} currentValues={activeCustomVariableValues} disabled={isTesting} stateVariables={visibleStateVariables} defaultVariable={defaultVariable} targetTypes={visibleTargetTypes} onChange={updateActiveConfiguration} onClose={() => setIsCustomVariablesOpen(false)} renderConditionEditor={(props) => <ConditionEditor {...props} />} />}
                    </section>
                </div>
            )}
        </aside>
    );
}
