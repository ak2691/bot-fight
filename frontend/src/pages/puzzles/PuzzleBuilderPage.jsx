import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import Arena from "../../gameArena/Arena.jsx";
import { useDialogFocus } from "../../components/useDialogFocus.js";
import {
    createDefaultAbilityStrategyConfiguration,
    customVariableDefinitions,
    abilityDefinitionsForVariable,
    normalizeAbilityStrategyConfiguration,
    STATE_VARIABLES,
} from "../../gameArena/botlogic/code/BotCode.js";
import {
    decodeBotLoadout,
    decodeSandboxLoadout,
    STANDARD_ABILITY_IDS,
    statusEffectDefinitionsForAbilities,
} from "../../gameArena/loadout/BotLoadout.js";
import { DEFAULT_BOT_CONFIGURATION_ID } from "../../gameArena/gameconfig/CombatLoadouts.js";
import {
    BASE_BOT_HP,
    BOT_CENTER_MAX_X,
    BOT_CENTER_MAX_Y,
    BOT_CENTER_MIN_X,
    BOT_CENTER_MIN_Y,
    PRACTICE_OPPONENT_START,
    PRACTICE_PLAYER_START,
} from "../../gameArena/modelPayloads/arenaConstants.js";
import { targetTypesForLoadouts } from "../../gameArena/coding/nodes/GraphNodes.jsx";
import { savePuzzle } from "../../puzzles/puzzleApi.js";
import PuzzleLogicWorkspace, {
    createDefaultPuzzleLogic,
    flattenPuzzleConditions,
    normalizePuzzleLogic,
} from "./PuzzleLogicWorkspace.jsx";

const MAX_TIME_SECONDS = 90;
const MAX_INITIAL_ELAPSED_SECONDS = 60;
const MAX_ACTION_NODES = 100;
const MAX_CONDITION_NODES = 300;
const MAX_CUSTOM_VARIABLES = 100;

function createDefaultPuzzle() {
    const brain = createDefaultAbilityStrategyConfiguration();
    const puzzleLogic = createDefaultPuzzleLogic();
    return {
        name: "",
        description: "",
        initialElapsedMs: 0,
        published: true,
        hideOpponentCode: true,
        timeLimitMs: 90_000,
        maxActionNodes: MAX_ACTION_NODES,
        maxConditionNodes: MAX_CONDITION_NODES,
        maxCustomVariables: MAX_CUSTOM_VARIABLES,
        puzzleLogic,
        winConditions: flattenPuzzleConditions(puzzleLogic, "win"),
        loseConditions: flattenPuzzleConditions(puzzleLogic, "lose"),
        playerBot: {
            loadout: DEFAULT_BOT_CONFIGURATION_ID,
            brain,
            startX: PRACTICE_PLAYER_START.x,
            startY: PRACTICE_PLAYER_START.y,
            rotation: PRACTICE_PLAYER_START.rotation,
            startHp: BASE_BOT_HP,
        },
        opponentBot: {
            loadout: DEFAULT_BOT_CONFIGURATION_ID,
            brain: createDefaultAbilityStrategyConfiguration(),
            startX: PRACTICE_OPPONENT_START.x,
            startY: PRACTICE_OPPONENT_START.y,
            rotation: PRACTICE_OPPONENT_START.rotation,
            startHp: BASE_BOT_HP,
        },
    };
}

function abilityIdsForLoadout(loadout) {
    return String(loadout ?? "").startsWith("sandbox:")
        ? decodeSandboxLoadout(loadout).abilities
        : decodeBotLoadout(loadout).abilities;
}

function puzzleConditionVariables(playerLoadout, opponentLoadout, puzzleLogic) {
    const playerAbilities = new Set([...STANDARD_ABILITY_IDS, ...abilityIdsForLoadout(playerLoadout)]);
    const opponentAbilities = new Set([...STANDARD_ABILITY_IDS, ...abilityIdsForLoadout(opponentLoadout)]);
    const allAbilities = new Set([...playerAbilities, ...opponentAbilities]);
    const builtIns = STATE_VARIABLES.map((variable) => {
        if (!variable.supportsAbility && !variable.supportsStatusEffect) return variable;
        const equipped = variable.supportsStatusEffect
            ? allAbilities
            : variable.abilityOwner === "opponent" ? opponentAbilities : playerAbilities;
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
    return [...builtIns, ...customVariableDefinitions(puzzleLogic)];
}

function canonicalBrain(brain, loadout) {
    const normalized = normalizeAbilityStrategyConfiguration(brain ?? createDefaultAbilityStrategyConfiguration());
    return {
        ...normalized,
        loadout: { abilities: abilityIdsForLoadout(loadout) },
    };
}

function requestBot(bot, { useDefaultBrain = false } = {}) {
    const normalized = normalizeStartingBot(bot);
    return {
        loadout: normalized.loadout,
        startX: normalized.startX,
        startY: normalized.startY,
        rotation: normalized.rotation,
        startHp: normalized.startHp,
        brain: canonicalBrain(useDefaultBrain ? createDefaultAbilityStrategyConfiguration() : normalized.brain, normalized.loadout),
    };
}

function roundToDecimal(value, fallback = 0, decimalPlaces = 1) {
    const numeric = Number(value);
    return Number.isFinite(numeric) ? Number(numeric.toFixed(decimalPlaces)) : fallback;
}

function normalizeStartingBot(bot, fallback = {}) {
    if (!bot) return bot;
    return {
        ...bot,
        startX: boundedDecimal(bot.startX, roundToDecimal(fallback.startX, BOT_CENTER_MIN_X), BOT_CENTER_MIN_X, BOT_CENTER_MAX_X),
        startY: boundedDecimal(bot.startY, roundToDecimal(fallback.startY, BOT_CENTER_MIN_Y), BOT_CENTER_MIN_Y, BOT_CENTER_MAX_Y),
        rotation: boundedDecimal(bot.rotation, roundToDecimal(fallback.rotation, 0), -360, 360),
        startHp: boundedDecimal(bot.startHp, roundToDecimal(fallback.startHp, BASE_BOT_HP), 1, BASE_BOT_HP),
    };
}

function boundedDecimal(value, fallback, min, max) {
    return Math.max(min, Math.min(max, roundToDecimal(value, fallback)));
}

function EditableNumberInput({ value, onCommit, min, max, fallback = 0, emptyValue = fallback, integerOnly = false, decimalPlaces = null, className = "", ariaLabel }) {
    const inputRef = useRef(null);
    const initialText = String(value ?? fallback);
    const [text, setText] = useState(initialText);
    const externalTextRef = useRef(initialText);
    const decimalPattern = decimalPlaces == null ? null : new RegExp(`^-?\\d*(?:\\.\\d{0,${decimalPlaces}})?$`);

    useEffect(() => {
        const nextText = String(value ?? fallback);
        if (nextText === externalTextRef.current) return;
        externalTextRef.current = nextText;
        // Preserve an in-progress edit until the field is committed.
        // eslint-disable-next-line react-hooks/set-state-in-effect
        if (document.activeElement !== inputRef.current) setText(nextText);
    }, [fallback, value]);

    const commit = () => {
        const entered = text.trim();
        const parsed = entered === "" ? Number(emptyValue) : Number(entered);
        const finite = Number.isFinite(parsed) ? parsed : Number(fallback);
        const bounded = Number.isFinite(finite) ? Math.min(max, Math.max(min, finite)) : fallback;
        const rounded = decimalPlaces == null ? bounded : roundToDecimal(bounded, fallback, decimalPlaces);
        const nextValue = integerOnly ? Math.floor(rounded) : rounded;
        externalTextRef.current = String(nextValue);
        setText(String(nextValue));
        onCommit(nextValue);
    };

    return (
        <input
            ref={inputRef}
            type="text"
            inputMode={integerOnly ? "numeric" : "decimal"}
            aria-label={ariaLabel}
            value={text}
            onChange={(event) => {
                const nextText = event.target.value;
                if (!decimalPattern || decimalPattern.test(nextText)) setText(nextText);
            }}
            step={decimalPlaces == null ? undefined : 10 ** -decimalPlaces}
            onBlur={commit}
            onClick={(event) => event.currentTarget.select()}
            onKeyDown={(event) => {
                if (event.key === "Enter") {
                    event.preventDefault();
                    commit();
                    event.currentTarget.blur();
                }
            }}
            className={className}
        />
    );
}

function PuzzleConfigurationModal({ draft, conditionVariables, conditionTargets, onPuzzleLogicChange, onClose }) {
    return <PuzzleLogicWorkspace
        configuration={draft.puzzleLogic}
        onChange={onPuzzleLogicChange}
        stateVariables={conditionVariables}
        targetTypes={conditionTargets}
        maxCustomVariables={MAX_CUSTOM_VARIABLES}
        onClose={onClose}
    />;
}

function PuzzleRulesModal({ draft, setDraft, onClose }) {
    const dialogRef = useRef(null);
    const closeButtonRef = useRef(null);
    useDialogFocus(dialogRef, { initialFocusRef: closeButtonRef, onClose, lockScroll: true });
    const updateLimit = (field, value) => setDraft((current) => ({ ...current, [field]: value }));
    const initialElapsedSeconds = Math.max(0, Math.min(MAX_INITIAL_ELAPSED_SECONDS, Number(draft.initialElapsedMs ?? 0) / 1000));
    const maxTimeSeconds = Math.max(0, MAX_TIME_SECONDS - initialElapsedSeconds);
    const updateInitialElapsed = (value) => setDraft((current) => {
        const maxTimeLimitMs = (MAX_TIME_SECONDS - value) * 1000;
        const currentTimeLimitMs = Number(current.timeLimitMs);
        return {
            ...current,
            initialElapsedMs: value * 1000,
            timeLimitMs: Number.isFinite(currentTimeLimitMs) ? Math.min(currentTimeLimitMs, maxTimeLimitMs) : maxTimeLimitMs,
        };
    });
    const rows = [
        ["TIME PASSED / SEC", <EditableNumberInput key="initial-time" value={initialElapsedSeconds} min={0} max={MAX_INITIAL_ELAPSED_SECONDS} fallback={0} emptyValue={0} integerOnly ariaLabel="Time already passed at puzzle start in seconds" onCommit={updateInitialElapsed} className="h-9 w-28 border border-slate-700 bg-slate-900 px-2 text-center font-interface-numeric text-sm text-white outline-none focus:border-cyan-400" />],
        ["TIME LIMIT / SEC", <EditableNumberInput key="time" value={Number(draft.timeLimitMs ?? 0) / 1000} min={0} max={maxTimeSeconds} fallback={0} emptyValue={0} integerOnly ariaLabel="Puzzle time limit in seconds" onCommit={(value) => setDraft((current) => ({ ...current, timeLimitMs: value * 1000 }))} className="h-9 w-28 border border-slate-700 bg-slate-900 px-2 text-center font-interface-numeric text-sm text-white outline-none focus:border-cyan-400" />],
        ["ACTION NODES", <EditableNumberInput key="actions" value={draft.maxActionNodes} min={0} max={MAX_ACTION_NODES} fallback={0} emptyValue={0} integerOnly ariaLabel="Maximum action nodes" onCommit={(value) => updateLimit("maxActionNodes", value)} className="h-9 w-28 border border-slate-700 bg-slate-900 px-2 text-center font-interface-numeric text-sm text-white outline-none focus:border-cyan-400" />],
        ["CONDITIONAL NODES", <EditableNumberInput key="conditions" value={draft.maxConditionNodes} min={0} max={MAX_CONDITION_NODES} fallback={0} emptyValue={0} integerOnly ariaLabel="Maximum conditional nodes" onCommit={(value) => updateLimit("maxConditionNodes", value)} className="h-9 w-28 border border-slate-700 bg-slate-900 px-2 text-center font-interface-numeric text-sm text-white outline-none focus:border-cyan-400" />],
        ["CUSTOM VARIABLES", <EditableNumberInput key="variables" value={draft.maxCustomVariables} min={0} max={MAX_CUSTOM_VARIABLES} fallback={0} emptyValue={0} integerOnly ariaLabel="Maximum custom variables" onCommit={(value) => updateLimit("maxCustomVariables", value)} className="h-9 w-28 border border-slate-700 bg-slate-900 px-2 text-center font-interface-numeric text-sm text-white outline-none focus:border-cyan-400" />],
    ];
    return <div className="fixed inset-0 z-[110] grid place-items-center bg-black/75 p-4 backdrop-blur-sm" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
        <section ref={dialogRef} className="w-[min(92vw,520px)] rounded-xl border border-cyan-700/70 bg-[#11171a] shadow-2xl" role="dialog" aria-modal="true" aria-labelledby="puzzle-rules-title" tabIndex={-1}>
            <header className="flex items-center justify-between gap-4 border-b border-slate-700/80 bg-slate-950/70 px-5 py-4"><div><p className="font-mono text-[9px] font-bold tracking-[.2em] text-cyan-300">PUZZLE RULES</p><h2 id="puzzle-rules-title" className="mt-1 text-lg font-bold text-white">Limits & visibility</h2></div><button ref={closeButtonRef} type="button" onClick={onClose} aria-label="Close puzzle rules" className="gray-button-surface modal-close-button"><span aria-hidden="true">×</span></button></header>
            <div className="space-y-2 p-5">
                {rows.map(([label, control]) => <div key={label} className="flex min-h-12 items-center justify-between gap-4 border-b border-slate-800/80 pb-2 font-mono text-[9px] text-slate-400"><span>{label}</span>{control}</div>)}
                <label className="flex min-h-12 items-center justify-between gap-4 border-b border-slate-800/80 pb-2 font-mono text-[9px] text-slate-300"><span>PUBLISH PUZZLE</span><input type="checkbox" checked={draft.published} onChange={(event) => setDraft((current) => ({ ...current, published: event.target.checked }))} /></label>
                <label className="flex min-h-12 items-center justify-between gap-4 font-mono text-[9px] text-slate-300"><span>HIDE OPPONENT CODE</span><input type="checkbox" checked={draft.hideOpponentCode} onChange={(event) => setDraft((current) => ({ ...current, hideOpponentCode: event.target.checked }))} /></label>
            </div>
            <footer className="flex justify-end border-t border-slate-700/80 bg-slate-950/70 px-5 py-4"><button type="button" onClick={onClose} className="gray-button-surface min-h-10 border border-cyan-400 px-6 font-mono text-[10px] font-bold tracking-[.16em] text-cyan-100">DONE</button></footer>
        </section>
    </div>;
}

function PuzzleBuilderControls({ draft, setDraft, saveState, onSaveStartingStats, onSaveOpponentCode, onSavePuzzle, onOpenConfiguration, onOpenRules, isSaving, conditionVariables, conditionTargets, isConfigurationOpen, onCloseConfiguration, isRulesOpen, onCloseRules, onPuzzleLogicChange }) {
    const player = draft.playerBot;
    const opponent = draft.opponentBot;

    return (
        <div className="space-y-3">
            <section className="rounded-xl border border-cyan-700/60 bg-slate-950/65 p-4 shadow-[0_10px_30px_rgba(0,0,0,.2)]">
                <label className="mt-3 block font-mono text-[9px] tracking-widest text-slate-400">
                    PUZZLE NAME
                    <input value={draft.name} maxLength={120} onChange={(event) => setDraft((current) => ({ ...current, name: event.target.value }))} placeholder="Untitled challenge" className="mt-1.5 h-10 w-full border border-slate-600 bg-slate-900 px-2.5 font-interface text-sm tracking-normal text-white outline-none focus:border-cyan-400" />
                </label>
                <label className="mt-3 block font-mono text-[9px] tracking-widest text-slate-400">
                    PUZZLE DESCRIPTION
                    <textarea value={draft.description} maxLength={2000} onChange={(event) => setDraft((current) => ({ ...current, description: event.target.value }))} placeholder="Describe the challenge" rows={4} className="mt-1.5 w-full resize-y border border-slate-600 bg-slate-900 px-2.5 py-2 font-interface text-sm leading-5 tracking-normal text-white outline-none focus:border-cyan-400" />
                </label>
                <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2">
                    <button type="button" onClick={onOpenConfiguration} className="arena-toolbar-button arena-toolbar-button--blue">CONFIG</button>
                    <button type="button" onClick={onOpenRules} className="arena-toolbar-button arena-toolbar-button--neutral">LIMITS</button>
                </div>
            </section>

            <section className="rounded-xl border border-slate-600/70 bg-slate-950/55 p-4">
                <div className="mb-2 flex items-center justify-between"><h2 className="font-mono text-[10px] font-bold tracking-[.16em] text-cyan-200">STARTING STATS</h2></div>
                <div className="grid grid-cols-1 gap-2 font-mono text-[9px] text-slate-400 sm:grid-cols-2">
                    <div className="rounded border border-cyan-400/65 bg-cyan-950/30 p-2 shadow-[inset_0_1px_rgba(125,211,252,.04)]">
                        <p className="text-cyan-200">YOU</p>
                        <div className="mt-2 space-y-2">
                            <div className="grid grid-cols-2 gap-1.5">
                                <label className="text-[8px] text-slate-500"><span className="block">X</span><EditableNumberInput value={player.startX} min={BOT_CENTER_MIN_X} max={BOT_CENTER_MAX_X} fallback={PRACTICE_PLAYER_START.x} emptyValue={PRACTICE_PLAYER_START.x} decimalPlaces={1} ariaLabel="Your starting X position" onCommit={(value) => setDraft((current) => ({ ...current, playerBot: { ...current.playerBot, startX: value } }))} className="mt-1 h-8 w-full border border-cyan-900/80 bg-slate-900 px-1 text-center font-interface-numeric text-xs text-white outline-none focus:border-cyan-400" /></label>
                                <label className="text-[8px] text-slate-500"><span className="block">Y</span><EditableNumberInput value={player.startY} min={BOT_CENTER_MIN_Y} max={BOT_CENTER_MAX_Y} fallback={PRACTICE_PLAYER_START.y} emptyValue={PRACTICE_PLAYER_START.y} decimalPlaces={1} ariaLabel="Your starting Y position" onCommit={(value) => setDraft((current) => ({ ...current, playerBot: { ...current.playerBot, startY: value } }))} className="mt-1 h-8 w-full border border-cyan-900/80 bg-slate-900 px-1 text-center font-interface-numeric text-xs text-white outline-none focus:border-cyan-400" /></label>
                            </div>
                            <label className="block text-[8px] text-slate-500"><span className="block">ROTATION</span><EditableNumberInput value={player.rotation} min={-360} max={360} fallback={0} emptyValue={0} decimalPlaces={1} ariaLabel="Your starting rotation" onCommit={(value) => setDraft((current) => ({ ...current, playerBot: { ...current.playerBot, rotation: value } }))} className="mt-1 h-8 w-full border border-cyan-900/80 bg-slate-900 px-1 text-center font-interface-numeric text-xs text-white outline-none focus:border-cyan-400" /></label>
                            <label className="block text-[8px] text-slate-500"><span className="block">HP</span><EditableNumberInput value={player.startHp} min={1} max={BASE_BOT_HP} fallback={BASE_BOT_HP} emptyValue={BASE_BOT_HP} decimalPlaces={1} ariaLabel="Your starting HP" onCommit={(value) => setDraft((current) => ({ ...current, playerBot: { ...current.playerBot, startHp: value } }))} className="mt-1 h-8 w-full border border-cyan-900/80 bg-slate-900 px-1 text-center font-interface-numeric text-xs text-white outline-none focus:border-cyan-400" /></label>
                        </div>
                    </div>
                    <div className="rounded border border-red-900/60 bg-red-950/20 p-2">
                        <p className="text-red-200">OPPONENT</p>
                        <div className="mt-2 space-y-2">
                            <div className="grid grid-cols-2 gap-1.5">
                                <label className="text-[8px] text-slate-500"><span className="block">X</span><EditableNumberInput value={opponent.startX} min={BOT_CENTER_MIN_X} max={BOT_CENTER_MAX_X} fallback={PRACTICE_OPPONENT_START.x} emptyValue={PRACTICE_OPPONENT_START.x} decimalPlaces={1} ariaLabel="Opponent starting X position" onCommit={(value) => setDraft((current) => ({ ...current, opponentBot: { ...current.opponentBot, startX: value } }))} className="mt-1 h-8 w-full border border-red-900/80 bg-slate-900 px-1 text-center font-interface-numeric text-xs text-white outline-none focus:border-red-400" /></label>
                                <label className="text-[8px] text-slate-500"><span className="block">Y</span><EditableNumberInput value={opponent.startY} min={BOT_CENTER_MIN_Y} max={BOT_CENTER_MAX_Y} fallback={PRACTICE_OPPONENT_START.y} emptyValue={PRACTICE_OPPONENT_START.y} decimalPlaces={1} ariaLabel="Opponent starting Y position" onCommit={(value) => setDraft((current) => ({ ...current, opponentBot: { ...current.opponentBot, startY: value } }))} className="mt-1 h-8 w-full border border-red-900/80 bg-slate-900 px-1 text-center font-interface-numeric text-xs text-white outline-none focus:border-red-400" /></label>
                            </div>
                            <label className="block text-[8px] text-slate-500"><span className="block">ROTATION</span><EditableNumberInput value={opponent.rotation} min={-360} max={360} fallback={0} emptyValue={0} decimalPlaces={1} ariaLabel="Opponent starting rotation" onCommit={(value) => setDraft((current) => ({ ...current, opponentBot: { ...current.opponentBot, rotation: value } }))} className="mt-1 h-8 w-full border border-red-900/80 bg-slate-900 px-1 text-center font-interface-numeric text-xs text-white outline-none focus:border-red-400" /></label>
                            <label className="block text-[8px] text-slate-500"><span className="block">HP</span><EditableNumberInput value={opponent.startHp} min={1} max={BASE_BOT_HP} fallback={BASE_BOT_HP} emptyValue={BASE_BOT_HP} decimalPlaces={1} ariaLabel="Opponent starting HP" onCommit={(value) => setDraft((current) => ({ ...current, opponentBot: { ...current.opponentBot, startHp: value } }))} className="mt-1 h-8 w-full border border-red-900/80 bg-slate-900 px-1 text-center font-interface-numeric text-xs text-white outline-none focus:border-red-400" /></label>
                        </div>
                    </div>
                </div>
                <button type="button" onClick={onSaveStartingStats} className="arena-toolbar-button arena-toolbar-button--blue mt-2">SAVE STARTING STATS</button>
            </section>

            <section className="rounded-xl border border-red-900/60 bg-slate-950/55 p-4">
                <div className="mb-2 flex items-center justify-between"><h2 className="font-mono text-[10px] font-bold tracking-[.16em] text-red-200">OPPONENT BOT</h2></div>
                <button type="button" onClick={onSaveOpponentCode} className="arena-toolbar-button arena-toolbar-button--opponent mt-2">SAVE OPPONENT CODE</button>
            </section>

            <section className="rounded-xl border border-cyan-700/60 bg-cyan-950/20 p-4">
                {saveState && <p role="status" className={`mb-2 font-mono text-[9px] leading-relaxed ${saveState.ok ? "text-emerald-300" : "text-rose-300"}`}>{saveState.message}</p>}
                <button type="button" disabled={isSaving} onClick={onSavePuzzle} className="arena-toolbar-button arena-toolbar-button--blue">{isSaving ? "SAVING PUZZLE..." : "SAVE PUZZLE"}</button>
            </section>
            {isConfigurationOpen && <PuzzleConfigurationModal draft={draft} conditionVariables={conditionVariables} conditionTargets={conditionTargets} onPuzzleLogicChange={onPuzzleLogicChange} onClose={onCloseConfiguration} />}
            {isRulesOpen && <PuzzleRulesModal draft={draft} setDraft={setDraft} onClose={onCloseRules} />}
        </div>
    );
}

export default function PuzzleBuilderPage() {
    const navigate = useNavigate();
    const [draft, setDraft] = useState(createDefaultPuzzle);
    const [saveState, setSaveState] = useState(null);
    const [isSaving, setIsSaving] = useState(false);
    const [isConfigurationOpen, setIsConfigurationOpen] = useState(false);
    const [isRulesOpen, setIsRulesOpen] = useState(false);
    const saveNoticeTimer = useRef(null);

    const handleArenaDraftChange = useCallback((setup) => {
        if (!setup) return;
        setDraft((current) => {
            const playerBot = normalizeStartingBot(
                { ...current.playerBot, ...(setup.playerBot ?? {}) },
                current.playerBot,
            );
            const opponentBot = normalizeStartingBot(
                { ...current.opponentBot, ...(setup.opponentBot ?? {}) },
                current.opponentBot,
            );
            return { ...current, ...setup, playerBot, opponentBot };
        });
    }, []);

    const handlePuzzleLogicChange = useCallback((puzzleLogic) => {
        const normalizedLogic = normalizePuzzleLogic(puzzleLogic);
        setDraft((current) => ({
            ...current,
            puzzleLogic: normalizedLogic,
            winConditions: flattenPuzzleConditions(normalizedLogic, "win"),
            loseConditions: flattenPuzzleConditions(normalizedLogic, "lose"),
        }));
    }, []);

    const showDraftNotice = useCallback((message) => {
        setSaveState({ ok: true, message });
        if (saveNoticeTimer.current) window.clearTimeout(saveNoticeTimer.current);
        saveNoticeTimer.current = window.setTimeout(() => setSaveState(null), 2600);
    }, []);

    const logicLimits = useMemo(() => ({
        maxActionNodes: draft.maxActionNodes,
        maxConditionNodes: draft.maxConditionNodes,
        maxCustomVariables: draft.maxCustomVariables,
    }), [draft.maxActionNodes, draft.maxConditionNodes, draft.maxCustomVariables]);

    const conditionVariables = useMemo(
        () => puzzleConditionVariables(draft.playerBot.loadout, draft.opponentBot.loadout, draft.puzzleLogic),
        [draft.playerBot.loadout, draft.opponentBot.loadout, draft.puzzleLogic],
    );
    const conditionTargets = useMemo(
        () => targetTypesForLoadouts(draft.playerBot.loadout, draft.opponentBot.loadout),
        [draft.playerBot.loadout, draft.opponentBot.loadout],
    );

    const handleSavePuzzle = useCallback(async () => {
        if (!draft.name.trim()) {
            setSaveState({ ok: false, message: "Give the puzzle a name before saving." });
            return;
        }
        setIsSaving(true);
        setSaveState(null);
        try {
            const saved = await savePuzzle({
                name: draft.name.trim(),
                description: draft.description.trim(),
                published: draft.published,
                hideOpponentCode: draft.hideOpponentCode,
                initialElapsedMs: draft.initialElapsedMs,
                timeLimitMs: draft.timeLimitMs,
                maxActionNodes: draft.maxActionNodes,
                maxConditionNodes: draft.maxConditionNodes,
                maxCustomVariables: draft.maxCustomVariables,
                logicConfiguration: normalizePuzzleLogic(draft.puzzleLogic),
                winConditions: flattenPuzzleConditions(draft.puzzleLogic, "win"),
                loseConditions: flattenPuzzleConditions(draft.puzzleLogic, "lose"),
                // The builder's player code is a temporary testing draft. Keep
                // the server-side player bot valid without saving that draft.
                playerBot: requestBot(draft.playerBot, { useDefaultBrain: true }),
                opponentBot: requestBot(draft.opponentBot),
            });
            setSaveState({ ok: true, message: `Puzzle #${saved.puzzleNumber} saved.` });
            if (draft.published) window.setTimeout(() => navigate("/puzzles"), 700);
        } catch (error) {
            setSaveState({ ok: false, message: error.message });
        } finally {
            setIsSaving(false);
        }
    }, [draft, navigate]);

    const builderControls = (
        <PuzzleBuilderControls
            draft={draft}
            setDraft={setDraft}
            saveState={saveState}
            isSaving={isSaving}
            onSaveStartingStats={() => showDraftNotice("Starting stats saved.")}
            onSaveOpponentCode={() => showDraftNotice("Opponent code saved.")}
            onSavePuzzle={handleSavePuzzle}
            onOpenConfiguration={() => setIsConfigurationOpen(true)}
            onOpenRules={() => setIsRulesOpen(true)}
            isConfigurationOpen={isConfigurationOpen}
            onCloseConfiguration={() => setIsConfigurationOpen(false)}
            isRulesOpen={isRulesOpen}
            onCloseRules={() => setIsRulesOpen(false)}
            onPuzzleLogicChange={handlePuzzleLogicChange}
            conditionVariables={conditionVariables}
            conditionTargets={conditionTargets}
        />
    );

    return <Arena puzzleBuilder initialPuzzle={draft} onPuzzleDraftChange={handleArenaDraftChange} builderControls={builderControls} logicLimits={logicLimits} />;
}
