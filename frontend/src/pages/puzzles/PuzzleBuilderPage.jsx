import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Toast, { ToastStack } from "../../components/Toast.jsx";
import Stepper from "../../components/Stepper.jsx";
import ArenaSetup from "../../gameArena/components/ArenaSetup.jsx";
import { useNavigate, useParams } from "react-router-dom";
import AppNavbar from "../../components/AppNavbar.jsx";
import Arena from "../../gameArena/Arena.jsx";
import { useDialogFocus } from "../../components/useDialogFocus.js";
import {
    BOT_CODE_SELECTABLES,
    createDefaultAbilityStrategyConfiguration,
    customVariableDefinitions,
    abilityDefinitionsForVariable,
    normalizeAbilityStrategyConfiguration,
    VISIBLE_STATE_VARIABLES,
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
    PUBLIC_BOT_CENTER_MAX_X,
    PUBLIC_BOT_CENTER_MAX_Y,
    PUBLIC_BOT_CENTER_MIN_X,
    PUBLIC_BOT_CENTER_MIN_Y,
    PRACTICE_OPPONENT_PUBLIC_START,
    PRACTICE_PLAYER_PUBLIC_START,
} from "../../gameArena/modelPayloads/arenaConstants.js";
import { countActions, selectableAbilityIdsForLoadouts, selectableTypesForLoadouts } from "../../gameArena/coding/nodes/GraphNodes.jsx";
import { fetchAdminPuzzle, savePuzzle, updatePuzzle } from "../../puzzles/puzzleApi.js";
import PuzzleLogicWorkspace, {
    createDefaultPuzzleLogic,
    flattenPuzzleConditions,
    normalizePuzzleLogic,
} from "./PuzzleLogicWorkspace.jsx";
import {
    MAX_PUZZLE_TEAM_SIZE,
    MIN_PUZZLE_TEAM_SIZE,
    PUZZLE_OPPONENT_TEAM,
    PUZZLE_PLAYER_TEAM,
    normalizePuzzleRoster,
    normalizePuzzleTeamSize,
    puzzleBotKey,
    puzzleBotsForTeam,
    puzzleBotRole,
} from "./puzzleRoster.js";

const MAX_TIME_SECONDS = 90;
const MAX_INITIAL_ELAPSED_SECONDS = 60;
const MAX_ACTION_NODES = 100;
const MAX_CONDITION_NODES = 300;
const MAX_CUSTOM_VARIABLES = 100;

function defaultPuzzleStart(teamNumber) {
    const isPlayer = Number(teamNumber) === PUZZLE_PLAYER_TEAM;
    const fallback = isPlayer ? PRACTICE_PLAYER_PUBLIC_START : PRACTICE_OPPONENT_PUBLIC_START;
    return {
        // New team members begin on the same center line as their team lead.
        // The author can position them independently in the starting-stats
        // editor after they have been added.
        startX: fallback.x,
        startY: fallback.y,
        rotation: fallback.rotation,
    };
}

function createDefaultPuzzleBot(teamNumber, slot) {
    const start = defaultPuzzleStart(teamNumber);
    return {
        role: puzzleBotRole(teamNumber),
        teamNumber,
        slot,
        loadout: DEFAULT_BOT_CONFIGURATION_ID,
        brain: createDefaultAbilityStrategyConfiguration(),
        ...start,
        startHp: BASE_BOT_HP,
    };
}

function puzzleBotAliases(bots) {
    return {
        playerBot: bots.find((bot) => Number(bot?.teamNumber) === PUZZLE_PLAYER_TEAM && Number(bot?.slot) === 1) ?? bots[0],
        opponentBot: bots.find((bot) => Number(bot?.teamNumber) === PUZZLE_OPPONENT_TEAM && Number(bot?.slot) === 1)
            ?? bots.find((bot) => Number(bot?.teamNumber) === PUZZLE_OPPONENT_TEAM),
    };
}

function normalizeDraftRoster(draft, source = null, playerTeamSize = draft.playerTeamSize, opponentTeamSize = draft.opponentTeamSize) {
    const normalizedPlayerTeamSize = normalizePuzzleTeamSize(playerTeamSize);
    const normalizedOpponentTeamSize = normalizePuzzleTeamSize(opponentTeamSize);
    const sourceBots = Array.isArray(source)
        ? source
        : Array.isArray(draft.bots) ? draft.bots : [draft.playerBot, draft.opponentBot].filter(Boolean);
    const bots = normalizePuzzleRoster(
        sourceBots,
        normalizedPlayerTeamSize,
        normalizedOpponentTeamSize,
        createDefaultPuzzleBot,
    ).map((bot) => normalizeStartingBot(bot, createDefaultPuzzleBot(bot.teamNumber, bot.slot, bot.teamNumber === PUZZLE_PLAYER_TEAM ? normalizedPlayerTeamSize : normalizedOpponentTeamSize)));
    const sourceKeys = new Set(sourceBots
        .filter((bot) => Number.isFinite(Number(bot?.teamNumber)) && Number.isFinite(Number(bot?.slot)))
        .map((bot) => puzzleBotKey(bot)));
    const primaryByTeam = new Map(bots
        .filter((bot) => Number(bot?.slot) === 1)
        .map((bot) => [Number(bot.teamNumber), bot]));
    const alignedBots = bots.map((bot) => {
        const slot = Number(bot?.slot) || 1;
        const primary = primaryByTeam.get(Number(bot?.teamNumber));
        if (slot === 1 || sourceKeys.has(puzzleBotKey(bot)) || !primary) return bot;
        return {
            ...bot,
            startX: primary.startX,
            startY: primary.startY,
            rotation: primary.rotation,
        };
    });
    return {
        ...draft,
        playerTeamSize: normalizedPlayerTeamSize,
        opponentTeamSize: normalizedOpponentTeamSize,
        bots: alignedBots,
        ...puzzleBotAliases(alignedBots),
    };
}

function defaultPuzzleConditionSelectors(playerTeamSize, opponentTeamSize) {
    return {
        win: Number(opponentTeamSize) > 1 ? ["opponent_1", "opponent_2"] : [BOT_CODE_SELECTABLES.OPPONENT],
        lose: Number(playerTeamSize) > 1 ? ["my_bot", "teammate_1"] : ["my_bot"],
    };
}

function puzzleLogicUsesDefaultElimination(configuration, playerTeamSize, opponentTeamSize) {
    const selectors = defaultPuzzleConditionSelectors(playerTeamSize, opponentTeamSize);
    const conditionsFor = (kind) => flattenPuzzleConditions(configuration, kind);
    const isEliminationCondition = (condition, selector) => condition?.type === "expression"
        && condition.left === "selectable.hp"
        && condition.leftSelectable === selector
        && condition.comparator === "lte"
        && condition.right?.type === "number"
        && Number(condition.right.value) === 0
        && (condition.join == null || condition.join === "and");
    const roots = Array.isArray(configuration?.roots) ? configuration.roots : [];
    const winConditions = conditionsFor("win");
    const loseConditions = conditionsFor("lose");
    return roots.some((root) => root?.kind === "win")
        && roots.some((root) => root?.kind === "lose")
        && winConditions.length === selectors.win.length
        && loseConditions.length === selectors.lose.length
        && selectors.win.every((selector, index) => isEliminationCondition(winConditions[index], selector))
        && selectors.lose.every((selector, index) => isEliminationCondition(loseConditions[index], selector));
}

function createDefaultPuzzle() {
    const brain = createDefaultAbilityStrategyConfiguration();
    const puzzleLogic = createDefaultPuzzleLogic();
    const bots = normalizePuzzleRoster(
        [],
        MIN_PUZZLE_TEAM_SIZE,
        MIN_PUZZLE_TEAM_SIZE,
        (teamNumber, slot, teamSize) => ({
            ...createDefaultPuzzleBot(teamNumber, slot, teamSize),
            ...(teamNumber === PUZZLE_PLAYER_TEAM && slot === 1 ? { brain } : {}),
        }),
    );
    return normalizeDraftRoster({
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
        playerTeamSize: MIN_PUZZLE_TEAM_SIZE,
        opponentTeamSize: MIN_PUZZLE_TEAM_SIZE,
        bots,
    }, bots, MIN_PUZZLE_TEAM_SIZE, MIN_PUZZLE_TEAM_SIZE);
}

function numberOrFallback(value, fallback) {
    const numeric = Number(value);
    return Number.isFinite(numeric) ? numeric : fallback;
}

function botDraftFromAdminResponse(source, fallback) {
    return normalizeStartingBot({
        ...fallback,
        loadout: source?.loadout ?? fallback.loadout,
        brain: normalizeAbilityStrategyConfiguration(source?.brain ?? fallback.brain),
        startX: numberOrFallback(source?.startX, fallback.startX),
        startY: numberOrFallback(source?.startY, fallback.startY),
        rotation: numberOrFallback(source?.rotation, fallback.rotation),
        startHp: numberOrFallback(source?.startHp, fallback.startHp),
    }, fallback);
}

function puzzleDraftFromAdminResponse(payload) {
    const defaults = createDefaultPuzzle();
    const puzzleLogic = normalizePuzzleLogic(payload?.logicConfiguration ?? defaults.puzzleLogic);
    const payloadBots = Array.isArray(payload?.bots) ? payload.bots : [];
    const legacyPlayerBot = payload?.playerBot
        ?? payloadBots.find((bot) => String(bot?.role ?? "").toUpperCase() === "PLAYER");
    const legacyOpponentBot = payload?.opponentBot
        ?? payloadBots.find((bot) => String(bot?.role ?? "").toUpperCase() === "OPPONENT");
    const sourceBots = payloadBots.length > 0
        ? payloadBots
        : [
            legacyPlayerBot ? { ...legacyPlayerBot, role: "PLAYER", teamNumber: PUZZLE_PLAYER_TEAM, slot: 1 } : null,
            legacyOpponentBot ? { ...legacyOpponentBot, role: "OPPONENT", teamNumber: PUZZLE_OPPONENT_TEAM, slot: 1 } : null,
        ].filter(Boolean);
    const inferredTeam = (bot) => Number(bot?.teamNumber) === PUZZLE_OPPONENT_TEAM
        || String(bot?.role ?? "").toUpperCase() === "OPPONENT"
        ? PUZZLE_OPPONENT_TEAM
        : PUZZLE_PLAYER_TEAM;
    const playerCount = sourceBots.filter((bot) => inferredTeam(bot) === PUZZLE_PLAYER_TEAM).length;
    const opponentCount = sourceBots.filter((bot) => inferredTeam(bot) === PUZZLE_OPPONENT_TEAM).length;
    const playerTeamSize = normalizePuzzleTeamSize(payload?.playerTeamSize, Math.max(MIN_PUZZLE_TEAM_SIZE, Math.min(MAX_PUZZLE_TEAM_SIZE, playerCount || 1)));
    const opponentTeamSize = normalizePuzzleTeamSize(payload?.opponentTeamSize, Math.max(MIN_PUZZLE_TEAM_SIZE, Math.min(MAX_PUZZLE_TEAM_SIZE, opponentCount || 1)));
    const normalizedSourceBots = sourceBots.map((bot) => botDraftFromAdminResponse(bot, createDefaultPuzzleBot(
        inferredTeam(bot),
        Number(bot?.slot) || 1,
        inferredTeam(bot) === PUZZLE_OPPONENT_TEAM ? opponentTeamSize : playerTeamSize,
    )));
    const draft = normalizeDraftRoster({
        ...defaults,
        name: String(payload?.name ?? defaults.name),
        description: String(payload?.description ?? defaults.description),
        initialElapsedMs: numberOrFallback(payload?.initialElapsedMs, defaults.initialElapsedMs),
        published: payload?.status == null
            ? defaults.published
            : String(payload.status).toUpperCase() === "PUBLISHED",
        hideOpponentCode: payload?.hideOpponentCode !== false,
        timeLimitMs: numberOrFallback(payload?.timeLimitMs, defaults.timeLimitMs),
        maxActionNodes: numberOrFallback(payload?.maxActionNodes, defaults.maxActionNodes),
        maxConditionNodes: numberOrFallback(payload?.maxConditionNodes, defaults.maxConditionNodes),
        maxCustomVariables: numberOrFallback(payload?.maxCustomVariables, defaults.maxCustomVariables),
        puzzleLogic,
        winConditions: flattenPuzzleConditions(puzzleLogic, "win"),
        loseConditions: flattenPuzzleConditions(puzzleLogic, "lose"),
        playerTeamSize,
        opponentTeamSize,
        bots: normalizedSourceBots,
    }, normalizedSourceBots, playerTeamSize, opponentTeamSize);
    return normalizePuzzleDraftConditions(draft);
}

function abilityIdsForLoadout(loadout) {
    return String(loadout ?? "").startsWith("sandbox:")
        ? decodeSandboxLoadout(loadout).abilities
        : decodeBotLoadout(loadout).abilities;
}

function puzzleConditionVariables(playerLoadout, opponentLoadout, puzzleLogic, additionalLoadouts = []) {
    const playerAbilities = new Set([...STANDARD_ABILITY_IDS, ...abilityIdsForLoadout(playerLoadout)]);
    const opponentAbilities = new Set([...STANDARD_ABILITY_IDS, ...abilityIdsForLoadout(opponentLoadout)]);
    const allAbilities = new Set([
        ...playerAbilities,
        ...opponentAbilities,
        ...additionalLoadouts.flatMap((loadout) => abilityIdsForLoadout(loadout)),
    ]);
    const builtIns = VISIBLE_STATE_VARIABLES.map((variable) => {
        if (!variable.supportsAbility && !variable.supportsStatusEffect) return variable;
        const equipped = allAbilities;
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

function normalizePuzzleDraftConditions(draft) {
    const playerBots = puzzleBotsForTeam(draft.bots, PUZZLE_PLAYER_TEAM);
    const opponentBots = puzzleBotsForTeam(draft.bots, PUZZLE_OPPONENT_TEAM);
    const primaryPlayer = playerBots[0];
    const primaryOpponent = opponentBots[0];
    const roster = {
        teammateCount: Math.max(0, playerBots.length - 1),
        opponentCount: opponentBots.length,
        teammateLoadouts: playerBots.slice(1).map((bot) => bot.loadout),
        opponentLoadouts: opponentBots.map((bot) => bot.loadout),
    };
    const stateVariables = puzzleConditionVariables(
        primaryPlayer.loadout,
        primaryOpponent.loadout,
        draft.puzzleLogic,
        [...playerBots.slice(1), ...opponentBots.slice(1)].map((bot) => bot.loadout),
    );
    const selectableTypes = selectableTypesForLoadouts(primaryPlayer.loadout, primaryOpponent.loadout, roster);
    const selectableAbilityIds = selectableAbilityIdsForLoadouts(primaryPlayer.loadout, primaryOpponent.loadout, roster);
    const puzzleLogic = normalizePuzzleLogic(draft.puzzleLogic, {
        stateVariables,
        selectableTypes,
        selectableAbilityIds,
    });
    return {
        ...draft,
        puzzleLogic,
        winConditions: flattenPuzzleConditions(puzzleLogic, "win"),
        loseConditions: flattenPuzzleConditions(puzzleLogic, "lose"),
    };
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

function requestPuzzleBot(bot) {
    const teamNumber = Number(bot?.teamNumber) === PUZZLE_OPPONENT_TEAM ? PUZZLE_OPPONENT_TEAM : PUZZLE_PLAYER_TEAM;
    const slot = Math.max(1, Math.floor(Number(bot?.slot) || 1));
    return {
        ...requestBot(bot, { useDefaultBrain: teamNumber === PUZZLE_PLAYER_TEAM && slot === 1 }),
        role: puzzleBotRole(teamNumber),
        teamNumber,
        slot,
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
        startX: boundedDecimal(bot.startX, roundToDecimal(fallback.startX, PUBLIC_BOT_CENTER_MIN_X), PUBLIC_BOT_CENTER_MIN_X, PUBLIC_BOT_CENTER_MAX_X),
        startY: boundedDecimal(bot.startY, roundToDecimal(fallback.startY, PUBLIC_BOT_CENTER_MIN_Y), PUBLIC_BOT_CENTER_MIN_Y, PUBLIC_BOT_CENTER_MAX_Y),
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

function PuzzleConfigurationModal({ draft, conditionVariables, conditionTargets, conditionTargetAbilityIds, onPuzzleLogicChange, onClose }) {
    return <PuzzleLogicWorkspace
        configuration={draft.puzzleLogic}
        onChange={onPuzzleLogicChange}
        stateVariables={conditionVariables}
        selectableTypes={conditionTargets}
        selectableAbilityIds={conditionTargetAbilityIds}
        maxCustomVariables={MAX_CUSTOM_VARIABLES}
        onClose={onClose}
    />;
}

function SwitchRow({ label, helper, checked, onChange }) {
    return (
        <div className="flex min-h-12 items-center justify-between gap-4 border-b border-[#1c2228] py-1.5 last:border-b-0">
            <div className="min-w-0">
                <p className="text-sm text-slate-200">{label}</p>
                <p className="text-[11px] text-slate-500">{helper}</p>
            </div>
            <button
                type="button"
                role="switch"
                aria-checked={checked}
                aria-label={label}
                onClick={() => onChange(!checked)}
                className={`relative h-6 w-11 shrink-0 rounded-full transition-colors ${checked ? "bg-[#2088ac]" : "bg-[#262c33]"}`}
            >
                <span className={`absolute top-0.5 h-5 w-5 rounded-full bg-white transition-all ${checked ? "left-[22px]" : "left-0.5"}`} />
            </button>
        </div>
    );
}

function RulesSectionLabel({ children }) {
    return <h3 className="mb-1 mt-4 text-[10px] font-bold uppercase text-slate-500 first:mt-0">{children}</h3>;
}

// Rules and limits. Every change applies straight to the draft; the save button on the panel persists it.
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
    const row = (label, control) => (
        <div className="flex min-h-11 items-center justify-between gap-4 border-b border-[#1c2228]">
            <span className="text-sm text-slate-200">{label}</span>
            {control}
        </div>
    );
    return (
        <div className="fixed inset-0 z-[110] grid place-items-center bg-black/75 px-4 pb-4 pt-[5.5rem] backdrop-blur-sm max-sm:grid-rows-[minmax(0,1fr)] max-sm:items-stretch max-sm:p-0 max-sm:pt-[72px]" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
            <section ref={dialogRef} className="flex max-h-[calc(100dvh-7.5rem)] w-[min(94vw,28rem)] flex-col overflow-hidden rounded-2xl border border-[#262c33] bg-[#0f1418] text-slate-100 shadow-2xl max-sm:h-full max-sm:max-h-none max-sm:w-full max-sm:rounded-none max-sm:border-0" role="dialog" aria-modal="true" aria-labelledby="puzzle-rules-title" tabIndex={-1}>
                <header className="flex items-center justify-between gap-4 border-b border-[#262c33] px-5 py-4">
                    <h2 id="puzzle-rules-title" className="font-display text-xl font-bold text-white">Rules and limits</h2>
                    <button ref={closeButtonRef} type="button" onClick={onClose} aria-label="Close rules and limits" className="modal-close-button"><span aria-hidden="true">×</span></button>
                </header>
                <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 py-4">
                    <RulesSectionLabel>Match</RulesSectionLabel>
                    {row("Time limit", <Stepper value={Math.round(Number(draft.timeLimitMs ?? 0) / 1000)} min={0} max={maxTimeSeconds} unit=" s" ariaLabel="Puzzle time limit in seconds" onChange={(value) => updateLimit("timeLimitMs", value * 1000)} />)}
                    {row("Start at", <Stepper value={Math.round(initialElapsedSeconds)} min={0} max={MAX_INITIAL_ELAPSED_SECONDS} unit=" s" ariaLabel="Time already passed at puzzle start in seconds" onChange={updateInitialElapsed} />)}
                    <div className="flex min-h-11 items-center justify-between gap-4">
                        <span className="text-sm text-slate-200">Players</span>
                        <span className="text-xs text-slate-500">set in Arena setup &middot; {draft.playerTeamSize}v{draft.opponentTeamSize}</span>
                    </div>

                    <RulesSectionLabel>Solver budget</RulesSectionLabel>
                    {row("Actions", <Stepper value={draft.maxActionNodes} min={0} max={MAX_ACTION_NODES} ariaLabel="Maximum action nodes" onChange={(value) => updateLimit("maxActionNodes", value)} />)}
                    {row("Conditions", <Stepper value={draft.maxConditionNodes} min={0} max={MAX_CONDITION_NODES} ariaLabel="Maximum conditional nodes" onChange={(value) => updateLimit("maxConditionNodes", value)} />)}
                    {row("Custom variables", <Stepper value={draft.maxCustomVariables} min={0} max={MAX_CUSTOM_VARIABLES} ariaLabel="Maximum custom variables" onChange={(value) => updateLimit("maxCustomVariables", value)} />)}

                    <RulesSectionLabel>Visibility</RulesSectionLabel>
                    <SwitchRow label="Hide opponent code" helper="Solvers can't open the opponent's logic" checked={draft.hideOpponentCode} onChange={(value) => setDraft((current) => ({ ...current, hideOpponentCode: value }))} />
                    <SwitchRow label="Published" helper="Listed on the Puzzles page" checked={draft.published} onChange={(value) => setDraft((current) => ({ ...current, published: value }))} />
                </div>
            </section>
        </div>
    );
}

function StepIcon({ state }) {
    if (state === "done") {
        return <svg viewBox="0 0 24 24" className="h-4 w-4 shrink-0 fill-none stroke-emerald-400" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-label="Complete"><circle cx="12" cy="12" r="9" /><path d="m8 12.3 2.6 2.6L16 9.5" /></svg>;
    }
    return <span className={`h-4 w-4 shrink-0 rounded-full border-2 ${state === "next" ? "border-cyan-400" : "border-slate-600"}`} aria-label={state === "next" ? "Next step" : "Not started"} role="img" />;
}

function ChecklistRow({ title, summary, warn = false, state, onClick }) {
    return (
        <li>
            <button type="button" onClick={onClick} className={`flex min-h-11 w-full items-center gap-2.5 border-l-2 px-3 text-left hover:bg-white/[.03] ${state === "next" ? "border-l-cyan-400 bg-white/[.03]" : "border-l-transparent"}`}>
                <StepIcon state={state} />
                <span className="min-w-0 flex-1 truncate text-[13px] font-semibold text-slate-100">{title}</span>
                <span className={`shrink-0 text-[11px] ${warn ? "font-semibold text-amber-300" : "text-slate-500"}`}>{summary}</span>
                <span className="shrink-0 text-slate-500" aria-hidden="true">&rsaquo;</span>
            </button>
        </li>
    );
}

function PuzzleBuilderControls({ draft, setDraft, steps, dirty, onSavePuzzle, isSaving, isEditing, onOpenArenaSetup, onOpenConfiguration, onOpenRules, openOpponentCode, startTest, saveState, onDismissSaveState, children = null }) {
    const stepActions = {
        arena: onOpenArenaSetup,
        rules: onOpenConfiguration,
        opponent: openOpponentCode,
        limits: onOpenRules,
        test: startTest,
    };
    return (
        <div className="space-y-3">
            <section className="rounded-xl border border-[#262c33] bg-[#0f1418] p-3.5">
                <label className="block text-[11px] text-slate-500">
                    Puzzle name
                    <input value={draft.name} maxLength={120} onChange={(event) => setDraft((current) => ({ ...current, name: event.target.value }))} placeholder="Untitled challenge" className="mt-1 h-9 w-full rounded-md border border-[#262c33] bg-[#0b0f12] px-2.5 text-sm text-white outline-none focus:border-cyan-400" />
                </label>
                <label className="mt-3 block text-[11px] text-slate-500">
                    Description
                    <textarea value={draft.description} maxLength={2000} onChange={(event) => setDraft((current) => ({ ...current, description: event.target.value }))} placeholder="What should the solver do?" rows={3} className="mt-1 w-full resize-y rounded-md border border-[#262c33] bg-[#0b0f12] px-2.5 py-2 text-sm leading-5 text-white outline-none focus:border-cyan-400" />
                </label>
            </section>

            <section className="overflow-hidden rounded-xl border border-[#262c33] bg-[#0f1418]" aria-label="Puzzle steps">
                <ol className="divide-y divide-[#1c2228]">
                    {steps.map((step) => <ChecklistRow key={step.id} title={step.title} summary={step.summary} warn={step.warn} state={step.state} onClick={stepActions[step.id]} />)}
                </ol>
            </section>

            <div>
                <button type="button" disabled={isSaving} onClick={onSavePuzzle} className="flex min-h-12 w-full items-center justify-center rounded-xl border-b-[3px] border-[#1f6b3f] bg-[#2fa866] font-display text-base font-bold text-white hover:bg-[#38bd74] disabled:cursor-wait disabled:opacity-60">
                    {isSaving ? (isEditing ? "UPDATING..." : "SAVING...") : (isEditing ? "UPDATE PUZZLE" : "SAVE PUZZLE")}
                </button>
                <p className={`mt-1.5 text-center text-[11px] ${dirty ? "text-amber-300" : "text-slate-500"}`} role="status">{dirty ? "Unsaved changes" : "All changes saved"}</p>
            </div>
            {saveState && (
                <ToastStack>
                    <Toast tone={saveState.ok ? "success" : "error"} onDismiss={onDismissSaveState}>{saveState.message}</Toast>
                </ToastStack>
            )}
            {children}
        </div>
    );
}

export default function PuzzleBuilderPage() {
    const navigate = useNavigate();
    const { puzzleNumber } = useParams();
    const isEditing = puzzleNumber != null;
    const [draft, setDraft] = useState(createDefaultPuzzle);
    const [isLoading, setIsLoading] = useState(isEditing);
    const [loadError, setLoadError] = useState(null);
    const [saveState, setSaveState] = useState(null);
    const [isSaving, setIsSaving] = useState(false);
    const [isConfigurationOpen, setIsConfigurationOpen] = useState(false);
    const [isRulesOpen, setIsRulesOpen] = useState(false);
    const [isArenaSetupOpen, setIsArenaSetupOpen] = useState(false);
    const [savedSignature, setSavedSignature] = useState(null);
    const loadedAtRef = useRef(0);

    useEffect(() => {
        if (!isEditing) {
            setDraft(createDefaultPuzzle());
            setLoadError(null);
            setIsLoading(false);
            return undefined;
        }

        let active = true;
        setLoadError(null);
        setIsLoading(true);
        fetchAdminPuzzle(puzzleNumber)
            .then((payload) => {
                if (active) setDraft(puzzleDraftFromAdminResponse(payload));
            })
            .catch((error) => {
                if (active) setLoadError(error.message);
            })
            .finally(() => {
                if (active) setIsLoading(false);
            });
        return () => { active = false; };
    }, [isEditing, puzzleNumber]);

    const handleArenaDraftChange = useCallback((setup) => {
        if (!setup) return;
        setDraft((current) => {
            const currentBots = Array.isArray(current.bots)
                ? current.bots
                : [current.playerBot, current.opponentBot].filter(Boolean);
            const setupBots = Array.isArray(setup.bots) ? setup.bots : null;
            const nextBots = setupBots ?? currentBots.map((bot) => {
                const key = puzzleBotKey(bot);
                const update = key === puzzleBotKey(PUZZLE_PLAYER_TEAM, 1)
                    ? setup.playerBot
                    : key === puzzleBotKey(PUZZLE_OPPONENT_TEAM, 1) ? setup.opponentBot : null;
                return update ? { ...bot, ...update } : bot;
            });
            return normalizeDraftRoster(
                { ...current, ...setup },
                nextBots,
                setup.playerTeamSize ?? current.playerTeamSize,
                setup.opponentTeamSize ?? current.opponentTeamSize,
            );
        });
    }, []);

    // "Unsaved changes" compares the draft with what was loaded or last saved. The arena normalizes the
    // draft right after it mounts, so changes in that first second count as the baseline.
    const draftSignature = useMemo(() => JSON.stringify(draft), [draft]);
    useEffect(() => {
        if (!isLoading) loadedAtRef.current = Date.now();
    }, [isLoading]);
    useEffect(() => {
        if (Date.now() - loadedAtRef.current < 1000) setSavedSignature(draftSignature);
    }, [draftSignature]);
    const dirty = savedSignature !== null && savedSignature !== draftSignature;

    useEffect(() => {
        if (!dirty) return undefined;
        const warnBeforeUnload = (event) => {
            event.preventDefault();
            event.returnValue = "";
        };
        // In-app links: ask before leaving with unsaved changes.
        const confirmLinkNavigation = (event) => {
            const link = event.target instanceof Element ? event.target.closest("a[href^='/']") : null;
            if (link && !window.confirm("You have unsaved changes. Leave without saving?")) {
                event.preventDefault();
                event.stopPropagation();
            }
        };
        window.addEventListener("beforeunload", warnBeforeUnload);
        document.addEventListener("click", confirmLinkNavigation, true);
        return () => {
            window.removeEventListener("beforeunload", warnBeforeUnload);
            document.removeEventListener("click", confirmLinkNavigation, true);
        };
    }, [dirty]);

    const logicLimits = useMemo(() => ({
        maxActionNodes: draft.maxActionNodes,
        maxConditionNodes: draft.maxConditionNodes,
        maxCustomVariables: draft.maxCustomVariables,
    }), [draft.maxActionNodes, draft.maxConditionNodes, draft.maxCustomVariables]);

    const playerTeamBots = useMemo(() => puzzleBotsForTeam(draft.bots, PUZZLE_PLAYER_TEAM), [draft.bots]);
    const opponentTeamBots = useMemo(() => puzzleBotsForTeam(draft.bots, PUZZLE_OPPONENT_TEAM), [draft.bots]);
    const conditionRoster = useMemo(() => ({
        teammateCount: Math.max(0, playerTeamBots.length - 1),
        opponentCount: opponentTeamBots.length,
        teammateLoadouts: playerTeamBots.slice(1).map((bot) => bot.loadout),
        opponentLoadouts: opponentTeamBots.map((bot) => bot.loadout),
    }), [opponentTeamBots, playerTeamBots]);
    const additionalPuzzleLoadouts = useMemo(() => {
        const primaryKeys = new Set([
            puzzleBotKey(PUZZLE_PLAYER_TEAM, 1),
            puzzleBotKey(PUZZLE_OPPONENT_TEAM, 1),
        ]);
        return draft.bots
            .filter((bot) => !primaryKeys.has(puzzleBotKey(bot)))
            .map((bot) => bot.loadout);
    }, [draft.bots]);
    const conditionVariables = useMemo(
        () => puzzleConditionVariables(
            draft.playerBot.loadout,
            draft.opponentBot.loadout,
            draft.puzzleLogic,
            additionalPuzzleLoadouts,
        ),
        [additionalPuzzleLoadouts, draft.opponentBot, draft.playerBot, draft.puzzleLogic],
    );
    const conditionTargets = useMemo(
        () => selectableTypesForLoadouts(draft.playerBot.loadout, draft.opponentBot.loadout, conditionRoster),
        [conditionRoster, draft.opponentBot.loadout, draft.playerBot.loadout],
    );
    const conditionTargetAbilityIds = useMemo(
        () => selectableAbilityIdsForLoadouts(draft.playerBot.loadout, draft.opponentBot.loadout, conditionRoster),
        [conditionRoster, draft.opponentBot.loadout, draft.playerBot.loadout],
    );
    const handlePuzzleLogicChange = useCallback((puzzleLogic) => {
        const normalizedLogic = normalizePuzzleLogic(puzzleLogic, {
            stateVariables: conditionVariables,
            selectableTypes: conditionTargets,
            selectableAbilityIds: conditionTargetAbilityIds,
        });
        setDraft((current) => ({
            ...current,
            puzzleLogic: normalizedLogic,
            winConditions: flattenPuzzleConditions(normalizedLogic, "win"),
            loseConditions: flattenPuzzleConditions(normalizedLogic, "lose"),
        }));
    }, [conditionTargetAbilityIds, conditionTargets, conditionVariables]);
    const handlePuzzleTeamSizeChange = useCallback((field, value) => {
        setDraft((current) => {
            const playerTeamSize = normalizePuzzleTeamSize(field === "playerTeamSize" ? value : current.playerTeamSize);
            const opponentTeamSize = normalizePuzzleTeamSize(field === "opponentTeamSize" ? value : current.opponentTeamSize);
            const rosterDraft = normalizeDraftRoster(
                current,
                current.bots,
                playerTeamSize,
                opponentTeamSize,
            );
            const puzzleLogic = puzzleLogicUsesDefaultElimination(
                current.puzzleLogic,
                normalizePuzzleTeamSize(current.playerTeamSize),
                normalizePuzzleTeamSize(current.opponentTeamSize),
            )
                ? createDefaultPuzzleLogic(playerTeamSize, opponentTeamSize)
                : rosterDraft.puzzleLogic;
            return normalizePuzzleDraftConditions({ ...rosterDraft, puzzleLogic });
        });
    }, []);

    const handleSavePuzzle = useCallback(async () => {
        if (!draft.name.trim()) {
            setSaveState({ ok: false, message: "Give the puzzle a name before saving." });
            return;
        }
        setIsSaving(true);
        setSaveState(null);
        try {
            const normalizedLogic = normalizePuzzleLogic(draft.puzzleLogic);
            Object.assign(normalizedLogic, normalizePuzzleLogic(normalizedLogic, {
                stateVariables: conditionVariables,
                selectableTypes: conditionTargets,
                selectableAbilityIds: conditionTargetAbilityIds,
            }));
            const payload = {
                coordinateSystemVersion: "centered-y-up-v1",
                name: draft.name.trim(),
                description: draft.description.trim(),
                published: draft.published,
                hideOpponentCode: draft.hideOpponentCode,
                initialElapsedMs: draft.initialElapsedMs,
                timeLimitMs: draft.timeLimitMs,
                maxActionNodes: draft.maxActionNodes,
                maxConditionNodes: draft.maxConditionNodes,
                maxCustomVariables: draft.maxCustomVariables,
                playerTeamSize: draft.playerTeamSize,
                opponentTeamSize: draft.opponentTeamSize,
                logicConfiguration: normalizedLogic,
                winConditions: flattenPuzzleConditions(normalizedLogic, "win"),
                loseConditions: flattenPuzzleConditions(normalizedLogic, "lose"),
                bots: (draft.bots ?? []).map(requestPuzzleBot),
                // The builder's player code is a temporary testing draft. Keep
                // the server-side player bot valid without saving that draft.
                playerBot: requestBot(draft.playerBot, { useDefaultBrain: true }),
                opponentBot: requestBot(draft.opponentBot),
            };
            const saved = isEditing
                ? await updatePuzzle(puzzleNumber, payload)
                : await savePuzzle(payload);
            setSavedSignature(JSON.stringify(draft));
            setSaveState({ ok: true, message: `Puzzle #${saved.puzzleNumber} ${isEditing ? "updated" : "saved"}.` });
            if (draft.published) window.setTimeout(() => navigate("/puzzles"), 700);
        } catch (error) {
            setSaveState({ ok: false, message: error.message });
        } finally {
            setIsSaving(false);
        }
    }, [conditionTargetAbilityIds, conditionTargets, conditionVariables, draft, isEditing, navigate, puzzleNumber]);

    if (isLoading) {
        return <PuzzleBuilderStatus message="LOADING PUZZLE FOR EDITING..." />;
    }
    if (loadError) {
        return <PuzzleBuilderStatus message={loadError} error onBack={() => navigate("/puzzles")} />;
    }

    const rootKinds = (draft.puzzleLogic?.roots ?? []).map((root) => root?.kind);
    const winRules = rootKinds.filter((kind) => kind === "win").length;
    const loseRules = rootKinds.filter((kind) => kind === "lose").length;
    const opponentActions = countActions(draft.opponentBot?.brain);
    const completion = { arena: true, rules: winRules > 0, opponent: opponentActions > 0, limits: true, test: false };
    const nextStepId = ["arena", "rules", "opponent", "limits", "test"].find((id) => !completion[id]);
    const stepState = (id) => (completion[id] ? "done" : id === nextStepId ? "next" : "todo");
    const steps = [
        { id: "arena", title: "Arena setup", summary: `${draft.playerTeamSize}v${draft.opponentTeamSize} \u00b7 positions set`, state: stepState("arena") },
        {
            id: "rules",
            title: "Win and lose rules",
            summary: winRules > 0 ? `${winRules} win \u00b7 ${loseRules} lose` : "Add a win rule",
            warn: winRules === 0,
            state: stepState("rules"),
        },
        {
            id: "opponent",
            title: "Opponent bot",
            summary: opponentActions > 0 ? `${opponentActions} ${opponentActions === 1 ? "action" : "actions"}` : "No code yet",
            warn: opponentActions === 0,
            state: stepState("opponent"),
        },
        { id: "limits", title: "Rules and limits", summary: `${Math.round(Number(draft.timeLimitMs ?? 0) / 1000)} s \u00b7 ${draft.hideOpponentCode ? "hidden" : "visible"}`, state: stepState("limits") },
        // The builder has no self-submission result to read back, so this step runs the existing preview.
        { id: "test", title: "Test it yourself", summary: "play to preview", state: stepState("test") },
    ];

    // Team sizes go through the existing handler so the default win/lose rules follow the roster.
    const applyArenaSetup = (setup) => {
        if (setup.playerTeamSize !== draft.playerTeamSize) handlePuzzleTeamSizeChange("playerTeamSize", setup.playerTeamSize);
        if (setup.opponentTeamSize !== draft.opponentTeamSize) handlePuzzleTeamSizeChange("opponentTeamSize", setup.opponentTeamSize);
        setDraft((current) => {
            const nextBots = (current.bots ?? []).map((bot) => {
                const match = setup.bots.find((candidate) => puzzleBotKey(candidate) === puzzleBotKey(bot));
                return match
                    ? { ...bot, startX: match.startX, startY: match.startY, rotation: match.rotation, startHp: match.startHp }
                    : bot;
            });
            const maxTimeLimitMs = (MAX_TIME_SECONDS - setup.initialElapsedMs / 1000) * 1000;
            const currentTimeLimitMs = Number(current.timeLimitMs);
            return normalizeDraftRoster({
                ...current,
                initialElapsedMs: setup.initialElapsedMs,
                timeLimitMs: Number.isFinite(currentTimeLimitMs) ? Math.min(currentTimeLimitMs, maxTimeLimitMs) : maxTimeLimitMs,
            }, nextBots);
        });
        setIsArenaSetupOpen(false);
    };

    const builderControls = ({ openOpponentCode, startTest } = {}) => (
        <PuzzleBuilderControls
            draft={draft}
            setDraft={setDraft}
            steps={steps}
            dirty={dirty}
            saveState={saveState}
            onDismissSaveState={() => setSaveState(null)}
            isSaving={isSaving}
            onSavePuzzle={handleSavePuzzle}
            onOpenArenaSetup={() => setIsArenaSetupOpen(true)}
            onOpenConfiguration={() => setIsConfigurationOpen(true)}
            onOpenRules={() => setIsRulesOpen(true)}
            openOpponentCode={openOpponentCode}
            startTest={startTest}
            isEditing={isEditing}
        />
    );

    return (
        <>
            <Arena puzzleBuilder initialPuzzle={draft} onPuzzleDraftChange={handleArenaDraftChange} builderControls={builderControls} logicLimits={logicLimits} />
            {isArenaSetupOpen && (
                <ArenaSetup
                    draft={draft}
                    onClose={() => setIsArenaSetupOpen(false)}
                    onApply={applyArenaSetup}
                    title="Arena setup"
                    subtitle="Puzzle builder"
                    titleId="puzzle-arena-setup-title"
                    maxElapsedSeconds={MAX_INITIAL_ELAPSED_SECONDS}
                />
            )}
            {isConfigurationOpen && <PuzzleConfigurationModal draft={draft} conditionVariables={conditionVariables} conditionTargets={conditionTargets} conditionTargetAbilityIds={conditionTargetAbilityIds} onPuzzleLogicChange={handlePuzzleLogicChange} onClose={() => setIsConfigurationOpen(false)} />}
            {isRulesOpen && <PuzzleRulesModal draft={draft} setDraft={setDraft} onClose={() => setIsRulesOpen(false)} />}
        </>
    );
}

function PuzzleBuilderStatus({ message, error = false, onBack = null }) {
    return <main className="puzzle-page min-h-screen bg-[#050d16] font-interface text-slate-100">
        <div className="flex min-h-screen flex-col">
            <div className="shrink-0"><AppNavbar account currentPage="puzzle-builder" /></div>
            <section className="mx-auto flex w-full max-w-[680px] flex-1 flex-col items-center justify-center px-5 py-12 text-center">
                <p className={`font-mono text-xs tracking-widest ${error ? "text-rose-300" : "text-slate-400"}`}>{message}</p>
                {onBack && <button type="button" onClick={onBack} className="mt-5 min-h-11 border border-cyan-400/60 bg-cyan-950/30 px-5 font-mono text-[10px] font-bold tracking-widest text-cyan-200 hover:border-cyan-300 hover:text-cyan-100">BACK TO PUZZLES</button>}
            </section>
        </div>
    </main>;
}
