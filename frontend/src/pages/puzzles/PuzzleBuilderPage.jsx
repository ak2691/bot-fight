import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
    BOT_CENTER_MAX_X,
    BOT_CENTER_MAX_Y,
    BOT_CENTER_MIN_X,
    BOT_CENTER_MIN_Y,
    PRACTICE_OPPONENT_START,
    PRACTICE_PLAYER_START,
} from "../../gameArena/modelPayloads/arenaConstants.js";
import { selectableAbilityIdsForLoadouts, selectableTypesForLoadouts } from "../../gameArena/coding/nodes/GraphNodes.jsx";
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
    const fallback = isPlayer ? PRACTICE_PLAYER_START : PRACTICE_OPPONENT_START;
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

function PuzzleRulesModal({ draft, setDraft, onTeamSizeChange, onClose }) {
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
        ["BLUE TEAM PLAYERS", <EditableNumberInput key="blue-team-size" value={draft.playerTeamSize} min={MIN_PUZZLE_TEAM_SIZE} max={MAX_PUZZLE_TEAM_SIZE} fallback={MIN_PUZZLE_TEAM_SIZE} emptyValue={MIN_PUZZLE_TEAM_SIZE} integerOnly ariaLabel="Number of blue team players" onCommit={(value) => onTeamSizeChange("playerTeamSize", value)} className="h-9 w-28 border-2 border-cyan-400/80 bg-cyan-950/20 px-2 text-center font-interface-numeric text-sm text-white outline-none focus:border-cyan-300" />],
        ["RED TEAM PLAYERS", <EditableNumberInput key="red-team-size" value={draft.opponentTeamSize} min={MIN_PUZZLE_TEAM_SIZE} max={MAX_PUZZLE_TEAM_SIZE} fallback={MIN_PUZZLE_TEAM_SIZE} emptyValue={MIN_PUZZLE_TEAM_SIZE} integerOnly ariaLabel="Number of red team players" onCommit={(value) => onTeamSizeChange("opponentTeamSize", value)} className="h-9 w-28 border-2 border-red-400/80 bg-red-950/20 px-2 text-center font-interface-numeric text-sm text-white outline-none focus:border-red-300" />],
        ["ACTION NODES", <EditableNumberInput key="actions" value={draft.maxActionNodes} min={0} max={MAX_ACTION_NODES} fallback={0} emptyValue={0} integerOnly ariaLabel="Maximum action nodes" onCommit={(value) => updateLimit("maxActionNodes", value)} className="h-9 w-28 border border-slate-700 bg-slate-900 px-2 text-center font-interface-numeric text-sm text-white outline-none focus:border-cyan-400" />],
        ["CONDITIONAL NODES", <EditableNumberInput key="conditions" value={draft.maxConditionNodes} min={0} max={MAX_CONDITION_NODES} fallback={0} emptyValue={0} integerOnly ariaLabel="Maximum conditional nodes" onCommit={(value) => updateLimit("maxConditionNodes", value)} className="h-9 w-28 border border-slate-700 bg-slate-900 px-2 text-center font-interface-numeric text-sm text-white outline-none focus:border-cyan-400" />],
        ["CUSTOM VARIABLES", <EditableNumberInput key="variables" value={draft.maxCustomVariables} min={0} max={MAX_CUSTOM_VARIABLES} fallback={0} emptyValue={0} integerOnly ariaLabel="Maximum custom variables" onCommit={(value) => updateLimit("maxCustomVariables", value)} className="h-9 w-28 border border-slate-700 bg-slate-900 px-2 text-center font-interface-numeric text-sm text-white outline-none focus:border-cyan-400" />],
    ];
    return <div className="fixed inset-0 z-[110] grid place-items-center bg-black/75 p-4 backdrop-blur-sm" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
        <section ref={dialogRef} className="w-[min(92vw,520px)] rounded-xl border border-cyan-700/70 bg-[#11171a] shadow-2xl" role="dialog" aria-modal="true" aria-labelledby="puzzle-rules-title" tabIndex={-1}>
            <header className="flex items-center justify-between gap-4 border-b border-slate-700/80 bg-slate-950/70 px-5 py-4"><div><p className="font-mono text-[9px] font-bold tracking-[.2em] text-cyan-300">PUZZLE RULES</p><h2 id="puzzle-rules-title" className="mt-1 text-lg font-bold text-white">Limits & visibility</h2></div><button ref={closeButtonRef} type="button" onClick={onClose} aria-label="Close puzzle rules" className="modal-close-button"><span aria-hidden="true">×</span></button></header>
            <div className="space-y-2 p-5">
                {rows.map(([label, control]) => <div key={label} className="flex min-h-12 items-center justify-between gap-4 border-b border-slate-800/80 pb-2 font-mono text-[9px] text-slate-400"><span>{label}</span>{control}</div>)}
                <label className="flex min-h-12 items-center justify-between gap-4 border-b border-slate-800/80 pb-2 font-mono text-[9px] text-slate-300"><span>PUBLISH PUZZLE</span><input type="checkbox" checked={draft.published} onChange={(event) => setDraft((current) => ({ ...current, published: event.target.checked }))} /></label>
                <label className="flex min-h-12 items-center justify-between gap-4 font-mono text-[9px] text-slate-300"><span>HIDE OPPONENT CODE</span><input type="checkbox" checked={draft.hideOpponentCode} onChange={(event) => setDraft((current) => ({ ...current, hideOpponentCode: event.target.checked }))} /></label>
            </div>
            <footer className="flex justify-end border-t border-slate-700/80 bg-slate-950/70 px-5 py-4"><button type="button" onClick={onClose} className="gray-button-surface min-h-10 border border-cyan-400 px-6 font-mono text-[10px] font-bold tracking-[.16em] text-cyan-100">DONE</button></footer>
        </section>
    </div>;
}

function puzzleTeamLabel(teamNumber) {
    return Number(teamNumber) === PUZZLE_OPPONENT_TEAM ? "RED TEAM" : "BLUE TEAM";
}

function puzzleBotDisplayName(bot) {
    const teamNumber = Number(bot?.teamNumber);
    const slot = Number(bot?.slot) || 1;
    if (teamNumber === PUZZLE_PLAYER_TEAM && slot === 1) return "My Bot";
    return teamNumber === PUZZLE_PLAYER_TEAM ? `Teammate ${slot - 1}` : `Opponent ${slot}`;
}

function PuzzleStartingStatsEditor({ draft, setDraft, onSave }) {
    const bots = Array.isArray(draft.bots) && draft.bots.length > 0
        ? draft.bots
        : [draft.playerBot, draft.opponentBot].filter(Boolean);
    const [selectedIndex, setSelectedIndex] = useState(0);
    const selectedBotIndex = Math.min(selectedIndex, Math.max(0, bots.length - 1));
    const selectedBot = bots[selectedBotIndex] ?? bots[0] ?? createDefaultPuzzleBot(PUZZLE_PLAYER_TEAM, 1);
    const teamNumber = Number(selectedBot.teamNumber) === PUZZLE_OPPONENT_TEAM ? PUZZLE_OPPONENT_TEAM : PUZZLE_PLAYER_TEAM;
    const teamSize = normalizePuzzleTeamSize(teamNumber === PUZZLE_PLAYER_TEAM ? draft.playerTeamSize : draft.opponentTeamSize);
    const fallbackStart = defaultPuzzleStart(teamNumber, Number(selectedBot.slot) || 1, teamSize);
    const tone = teamNumber === PUZZLE_OPPONENT_TEAM ? "red" : "blue";
    const updateSelectedBot = (field, value) => setDraft((current) => {
        const currentBots = Array.isArray(current.bots) ? current.bots : [current.playerBot, current.opponentBot].filter(Boolean);
        const nextBots = currentBots.map((bot, index) => index === selectedBotIndex ? { ...bot, [field]: value } : bot);
        return normalizeDraftRoster(current, nextBots);
    });
    const cycle = (direction) => {
        if (bots.length < 2) return;
        setSelectedIndex((current) => (Math.min(current, bots.length - 1) + direction + bots.length) % bots.length);
    };

    return (
        <section className="rounded-xl border border-slate-600/70 bg-slate-950/55 p-4">
            <div className="mb-2 flex items-center justify-between"><h2 className="font-mono text-[10px] font-bold tracking-[.16em] text-cyan-200">STARTING STATS</h2></div>
            <div className="code-bot-selector-stack w-full max-w-none">
                <div className={`code-bot-selector ${tone === "red" ? "is-red" : "is-blue"}`} role="group" aria-label="Select puzzle starting stats">
                    <button type="button" aria-label="Show previous player starting stats" title="Previous player" onClick={() => cycle(-1)} disabled={bots.length < 2} className="code-bot-selector__arrow">‹</button>
                    <div className="code-bot-selector__current" aria-live="polite">
                        <span className="code-bot-selector__name">{puzzleBotDisplayName(selectedBot)}</span>
                        <span className="code-bot-selector__meta">{puzzleTeamLabel(teamNumber)} · STARTING STATS · {Math.max(1, selectedBotIndex + 1)}/{bots.length}</span>
                    </div>
                    <button type="button" aria-label="Show next player starting stats" title="Next player" onClick={() => cycle(1)} disabled={bots.length < 2} className="code-bot-selector__arrow">›</button>
                </div>
            </div>
            <div className={`mt-2 rounded border p-2 font-mono text-[9px] ${tone === "red" ? "border-red-900/60 bg-red-950/20" : "border-cyan-400/65 bg-cyan-950/30"}`}>
                <p className={tone === "red" ? "text-red-200" : "text-cyan-200"}>{puzzleBotDisplayName(selectedBot)}</p>
                <div className="mt-2 space-y-2">
                    <div className="grid grid-cols-2 gap-1.5">
                        <label className="text-[8px] text-slate-500"><span className="block">X</span><EditableNumberInput value={selectedBot.startX} min={BOT_CENTER_MIN_X} max={BOT_CENTER_MAX_X} fallback={fallbackStart.startX} emptyValue={fallbackStart.startX} decimalPlaces={1} ariaLabel={`${puzzleBotDisplayName(selectedBot)} starting X position`} onCommit={(value) => updateSelectedBot("startX", value)} className={`mt-1 h-8 w-full border bg-slate-900 px-1 text-center font-interface-numeric text-xs text-white outline-none ${tone === "red" ? "border-red-900/80 focus:border-red-400" : "border-cyan-900/80 focus:border-cyan-400"}`} /></label>
                        <label className="text-[8px] text-slate-500"><span className="block">Y</span><EditableNumberInput value={selectedBot.startY} min={BOT_CENTER_MIN_Y} max={BOT_CENTER_MAX_Y} fallback={fallbackStart.startY} emptyValue={fallbackStart.startY} decimalPlaces={1} ariaLabel={`${puzzleBotDisplayName(selectedBot)} starting Y position`} onCommit={(value) => updateSelectedBot("startY", value)} className={`mt-1 h-8 w-full border bg-slate-900 px-1 text-center font-interface-numeric text-xs text-white outline-none ${tone === "red" ? "border-red-900/80 focus:border-red-400" : "border-cyan-900/80 focus:border-cyan-400"}`} /></label>
                    </div>
                    <label className="block text-[8px] text-slate-500"><span className="block">ROTATION</span><EditableNumberInput value={selectedBot.rotation} min={-360} max={360} fallback={fallbackStart.rotation} emptyValue={fallbackStart.rotation} decimalPlaces={1} ariaLabel={`${puzzleBotDisplayName(selectedBot)} starting rotation`} onCommit={(value) => updateSelectedBot("rotation", value)} className={`mt-1 h-8 w-full border bg-slate-900 px-1 text-center font-interface-numeric text-xs text-white outline-none ${tone === "red" ? "border-red-900/80 focus:border-red-400" : "border-cyan-900/80 focus:border-cyan-400"}`} /></label>
                    <label className="block text-[8px] text-slate-500"><span className="block">HP</span><EditableNumberInput value={selectedBot.startHp} min={1} max={BASE_BOT_HP} fallback={BASE_BOT_HP} emptyValue={BASE_BOT_HP} decimalPlaces={1} ariaLabel={`${puzzleBotDisplayName(selectedBot)} starting HP`} onCommit={(value) => updateSelectedBot("startHp", value)} className={`mt-1 h-8 w-full border bg-slate-900 px-1 text-center font-interface-numeric text-xs text-white outline-none ${tone === "red" ? "border-red-900/80 focus:border-red-400" : "border-cyan-900/80 focus:border-cyan-400"}`} /></label>
                </div>
            </div>
            <button type="button" onClick={onSave} className="arena-toolbar-button arena-toolbar-button--blue mt-2">SAVE STARTING STATS</button>
        </section>
    );
}

function PuzzleBuilderControls({ draft, setDraft, saveState, onSaveStartingStats, onSaveOpponentCode, onSavePuzzle, onOpenConfiguration, onOpenRules, onPuzzleTeamSizeChange, isSaving, isEditing, conditionVariables, conditionTargets, conditionTargetAbilityIds, isConfigurationOpen, onCloseConfiguration, isRulesOpen, onCloseRules, onPuzzleLogicChange }) {

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

            <PuzzleStartingStatsEditor draft={draft} setDraft={setDraft} onSave={onSaveStartingStats} />

            <section className="rounded-xl border border-red-900/60 bg-slate-950/55 p-4">
                <div className="mb-2 flex items-center justify-between"><h2 className="font-mono text-[10px] font-bold tracking-[.16em] text-red-200">OPPONENT BOT</h2></div>
                <button type="button" onClick={onSaveOpponentCode} className="arena-toolbar-button arena-toolbar-button--opponent mt-2">SAVE OPPONENT CODE</button>
            </section>

            <section className="rounded-xl border border-cyan-700/60 bg-cyan-950/20 p-4">
                {saveState && <p role="status" className={`mb-2 font-mono text-[9px] leading-relaxed ${saveState.ok ? "text-emerald-300" : "text-rose-300"}`}>{saveState.message}</p>}
                <button type="button" disabled={isSaving} onClick={onSavePuzzle} className="arena-toolbar-button arena-toolbar-button--blue">{isSaving ? (isEditing ? "UPDATING PUZZLE..." : "SAVING PUZZLE...") : (isEditing ? "UPDATE PUZZLE" : "SAVE PUZZLE")}</button>
            </section>
            {isConfigurationOpen && <PuzzleConfigurationModal draft={draft} conditionVariables={conditionVariables} conditionTargets={conditionTargets} conditionTargetAbilityIds={conditionTargetAbilityIds} onPuzzleLogicChange={onPuzzleLogicChange} onClose={onCloseConfiguration} />}
            {isRulesOpen && <PuzzleRulesModal draft={draft} setDraft={setDraft} onTeamSizeChange={onPuzzleTeamSizeChange} onClose={onCloseRules} />}
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
    const saveNoticeTimer = useRef(null);

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
            onPuzzleTeamSizeChange={handlePuzzleTeamSizeChange}
            isEditing={isEditing}
            conditionVariables={conditionVariables}
            conditionTargets={conditionTargets}
            conditionTargetAbilityIds={conditionTargetAbilityIds}
        />
    );

    return <Arena puzzleBuilder initialPuzzle={draft} onPuzzleDraftChange={handleArenaDraftChange} builderControls={builderControls} logicLimits={logicLimits} />;
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
