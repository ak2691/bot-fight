import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useAuth } from "../../auth/auth-context";
import AppNavbar from "../../components/AppNavbar.jsx";
import Arena from "../../gameArena/Arena.jsx";
import { customVariableDefinitions, STATE_VARIABLES, VISIBLE_STATE_VARIABLES } from "../../gameArena/botlogic/code/BotCode.js";
import { selectableAbilityIdsForLoadouts, selectableTypesForLoadouts } from "../../gameArena/coding/nodes/GraphNodes.jsx";
import { fetchPuzzle, submitPuzzleAttempt } from "../../puzzles/puzzleApi.js";
import { puzzleConditionLabel } from "../../puzzles/puzzleConditions.js";
import { readPuzzleBotCodeDraft } from "../../puzzles/puzzleBotCodeStorage.js";
import { resolveSelectableTarget } from "../../gameArena/coding/nodes/actionNodePresentation.js";
import { summarizeCondition } from "../../gameArena/coding/nodes/conditionSummary.js";
import { useStackedLayout } from "../../tutorial/useStackedLayout.js";
import "../../tutorial/tutorialGuide.css";
import { loadPuzzleSubmissions, savePuzzleSubmission } from "../../puzzles/puzzleSubmissions.js";
import PuzzleLogicWorkspace from "./PuzzleLogicWorkspace.jsx";
import {
    MIN_PUZZLE_TEAM_SIZE,
    PUZZLE_OPPONENT_TEAM,
    PUZZLE_PLAYER_TEAM,
    normalizePuzzleRoster,
    normalizePuzzleTeamSize,
    puzzleBotKey,
    puzzleBotRole,
    puzzleBotsForTeam,
} from "./puzzleRoster.js";

function puzzleWithBotRoles(payload) {
    const sourceBots = Array.isArray(payload?.bots) && payload.bots.length > 0
        ? payload.bots
        : [payload?.playerBot, payload?.opponentBot].filter(Boolean);
    const playerCount = sourceBots.filter((bot) => String(bot?.role ?? "").toUpperCase() === "PLAYER").length;
    const opponentCount = sourceBots.filter((bot) => String(bot?.role ?? "").toUpperCase() === "OPPONENT").length;
    const playerTeamSize = normalizePuzzleTeamSize(payload?.playerTeamSize, Math.max(MIN_PUZZLE_TEAM_SIZE, Math.min(2, playerCount || 1)));
    const opponentTeamSize = normalizePuzzleTeamSize(payload?.opponentTeamSize, Math.max(MIN_PUZZLE_TEAM_SIZE, Math.min(2, opponentCount || 1)));
    const bots = normalizePuzzleRoster(sourceBots, playerTeamSize, opponentTeamSize, (teamNumber, slot) => ({
        role: puzzleBotRole(teamNumber),
        teamNumber,
        slot,
    }));
    return {
        ...payload,
        playerTeamSize,
        opponentTeamSize,
        bots,
        playerBot: bots.find((bot) => Number(bot?.teamNumber) === PUZZLE_PLAYER_TEAM && Number(bot?.slot) === 1) ?? null,
        opponentBot: bots.find((bot) => Number(bot?.teamNumber) === PUZZLE_OPPONENT_TEAM && Number(bot?.slot) === 1) ?? null,
    };
}

function PuzzleConditionStrip({ condition, variableDefinitions, selectableTypes, onOpenConfiguration }) {
    const canOpenConfiguration = typeof onOpenConfiguration === "function";
    const isFull = condition?.type === "always" || condition?.type === "expression";
    const lookups = {
        variable: (id) => variableDefinitions.find((variable) => variable.id === id) ?? null,
        selectable: (id) => resolveSelectableTarget(id, selectableTypes).description,
        ability: (id) => {
            for (const variable of variableDefinitions) {
                const option = (variable.abilityOptions ?? []).find((ability) => ability.id === id);
                if (option) return option.label;
            }
            return String(id ?? "Ability");
        },
    };
    const label = puzzleConditionLabel(condition, variableDefinitions);
    const summary = isFull ? summarizeCondition(condition, lookups) : null;
    const body = summary ? (
        <span className="code-bt-strip-text">
            <span className="code-bt-subject">{summary.subject}</span>
            {summary.entities.map((entity, index) => <span className="code-bt-entity" key={index}>{entity}</span>)}
            {summary.comparator && <span className="code-bt-comparator">{summary.comparator}</span>}
            {summary.value && <span className="code-bt-value">{summary.value}</span>}
            {summary.valueEntities.map((entity, index) => <span className="code-bt-entity" key={`value-${index}`}>{entity}</span>)}
        </span>
    ) : <span className="code-bt-strip-text"><span className="code-bt-subject">{label}</span></span>;
    return (
        <li>
            {canOpenConfiguration ? (
                <button type="button" onClick={onOpenConfiguration} title="View puzzle configuration" aria-label={label} className="code-bt-strip puzzle-strip is-clickable w-full text-left">{body}</button>
            ) : (
                <div className="code-bt-strip puzzle-strip" title={label} aria-label={label}>{body}</div>
            )}
        </li>
    );
}

function PuzzleIcon({ className = "h-5 w-5" }) {
    return (
        <svg viewBox="0 0 24 24" className={`${className} fill-none stroke-current`} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M10 4a2 2 0 1 1 4 0v1h3a1 1 0 0 1 1 1v3h-1a2 2 0 1 0 0 4h1v3a1 1 0 0 1-1 1h-3v-1a2 2 0 1 0-4 0v1H7a1 1 0 0 1-1-1v-3h1a2 2 0 1 0 0-4H6V6a1 1 0 0 1 1-1h3Z" />
        </svg>
    );
}

function PuzzleInfoBody({ puzzle, isSolved, variableDefinitions, selectableTypes, onOpenConfiguration }) {
    const winConditions = Array.isArray(puzzle.winConditions) ? puzzle.winConditions : [];
    const loseConditions = Array.isArray(puzzle.loseConditions) ? puzzle.loseConditions : [];
    const description = typeof puzzle.description === "string" ? puzzle.description.trim() : "";
    const playerTeam = Number(puzzle.playerTeamSize);
    const opponentTeam = Number(puzzle.opponentTeamSize);
    const mode = playerTeam > 0 && opponentTeam > 0 ? `${playerTeam}v${opponentTeam}` : null;
    const strips = (conditions) => conditions.map((condition, index) => (
        <PuzzleConditionStrip
            key={condition.id ?? `${condition.left}-${index}`}
            condition={condition}
            variableDefinitions={variableDefinitions}
            selectableTypes={selectableTypes}
            onOpenConfiguration={onOpenConfiguration}
        />
    ));
    return (
        <>
            <div className="tg-card__body puzzle-info__body">
                {description && <p className="whitespace-pre-wrap text-sm leading-6 text-slate-300">{description}</p>}
                <div className="mt-3 grid grid-cols-3 gap-2 text-center">
                    <div className="rounded-lg border border-[#262c33] bg-[#12181d] px-2 py-2">
                        <span className="block text-[10px] text-slate-500">Time limit</span>
                        <strong className="mt-0.5 block font-display text-sm text-white">{Math.round(Number(puzzle.timeLimitMs ?? 90_000) / 1000)} s</strong>
                    </div>
                    <div className="rounded-lg border border-[#262c33] bg-[#12181d] px-2 py-2">
                        <span className="block text-[10px] text-slate-500">Opponent code</span>
                        <strong className="mt-0.5 flex items-center justify-center gap-1 font-display text-sm text-white">
                            <svg viewBox="0 0 24 24" className="h-3.5 w-3.5 fill-none stroke-current" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                                {puzzle.hideOpponentCode === false
                                    ? <><path d="M2 12s3.6-6 10-6 10 6 10 6-3.6 6-10 6S2 12 2 12Z" /><circle cx="12" cy="12" r="2.6" /></>
                                    : <><path d="M3 3l18 18" /><path d="M10.6 6.2A9.6 9.6 0 0 1 12 6c6.4 0 10 6 10 6a17 17 0 0 1-3 3.6M6.5 7.6C3.9 9.3 2 12 2 12s3.6 6 10 6a9.6 9.6 0 0 0 4-.9" /></>}
                            </svg>
                            {puzzle.hideOpponentCode === false ? "Visible" : "Hidden"}
                        </strong>
                    </div>
                    {mode && (
                        <div className="rounded-lg border border-[#262c33] bg-[#12181d] px-2 py-2">
                            <span className="block text-[10px] text-slate-500">Mode</span>
                            <strong className="mt-0.5 block font-display text-sm text-white">{mode}</strong>
                        </div>
                    )}
                </div>

                <section className="mt-3 rounded-lg border border-emerald-500/40 bg-emerald-500/[.06] p-2" aria-label="Win if">
                    <h3 className="mb-1.5 text-[10px] font-bold text-emerald-300">WIN IF</h3>
                    <ul className="space-y-1">{strips(winConditions)}</ul>
                </section>

                {loseConditions.length > 0 && (
                    <section className="mt-2 rounded-lg border border-rose-500/40 bg-rose-500/[.06] p-2" aria-label="Lose if">
                        <h3 className="mb-1.5 text-[10px] font-bold text-rose-300">LOSE IF</h3>
                        <ul className="space-y-1">{strips(loseConditions)}</ul>
                    </section>
                )}
            </div>
            <p className="flex gap-2 border-t border-[#262c33] pt-2.5 text-[11px] leading-4 text-slate-500">
                <span aria-hidden="true">&#9432;</span>
                <span>Play previews your code here. Submit runs a hidden server check that decides the result.</span>
            </p>
            {isSolved && <span className="sr-only" role="status">Solved</span>}
        </>
    );
}

function PuzzlePlayInfoModal({ puzzle, outcome, onOpenConfiguration, selectableTypes }) {
    const stacked = useStackedLayout();
    const [minimized, setMinimized] = useState(false);
    const [sheetOpen, setSheetOpen] = useState(false);
    const variableDefinitions = [
        ...STATE_VARIABLES,
        ...customVariableDefinitions(puzzle.logicConfiguration),
    ];
    const isSolved = puzzle.solved === true || outcome?.status === "solved";
    const title = `#${puzzle.puzzleNumber} · ${puzzle.name}`;

    const card = (sheet) => (
        <aside id="puzzle-info-panel" className={`tg-card puzzle-info-card ${sheet ? "tg-card--sheet" : ""}`} aria-label="Puzzle information">
            {sheet && <button type="button" className="tg-card__handle" aria-label="Close puzzle info" onClick={() => setSheetOpen(false)}><span aria-hidden="true" /></button>}
            <header className="tg-card__header">
                <div className="min-w-0 flex-1">
                    <p className="tg-eyebrow flex flex-wrap items-center gap-2">
                        Puzzle #{puzzle.puzzleNumber}
                        {isSolved && <span className="inline-flex items-center gap-1 text-emerald-400">&#10003; Solved</span>}
                    </p>
                    <h2 className="tg-title" title={puzzle.name}>{puzzle.name}</h2>
                </div>
                <button
                    type="button"
                    onClick={() => (sheet ? setSheetOpen(false) : setMinimized(true))}
                    className="tg-minimize"
                    aria-label={sheet ? "Close puzzle info" : "Minimize puzzle information"}
                    title={sheet ? "Close" : "Minimize puzzle information"}
                ><span aria-hidden="true">{sheet ? "×" : "–"}</span></button>
            </header>
            <PuzzleInfoBody puzzle={puzzle} isSolved={isSolved} variableDefinitions={variableDefinitions} selectableTypes={selectableTypes} onOpenConfiguration={onOpenConfiguration} />
        </aside>
    );

    if (stacked) {
        return (
            <div className="tg-arena-host">
                <div className="tg-stacked">
                    {sheetOpen ? card(true) : (
                        <button type="button" className="tg-fab tg-fab--amber" onClick={() => setSheetOpen(true)} aria-label="Puzzle info" title={title}>
                            <PuzzleIcon className="tg-fab__icon" />
                            {isSolved && <span className="tg-fab__badge tg-fab__badge--solved">&#10003;</span>}
                        </button>
                    )}
                </div>
            </div>
        );
    }

    return (
        <div className="tg-arena-host">
            {minimized ? (
                <button type="button" onClick={() => setMinimized(false)} className="tg-pill" aria-label={`Expand puzzle information, ${title}`} aria-expanded="false" aria-controls="puzzle-info-panel" title={title}>
                    <PuzzleIcon className="tg-pill__icon text-amber-300" />
                    <span className="tg-pill__name">{title}</span>
                    {isSolved && <span className="tg-pill__count text-emerald-400" aria-label="Solved">&#10003;</span>}
                </button>
            ) : card(false)}
        </div>
    );
}

function PuzzlePlayToolbarControls({ onBack }) {
    return (
        <button type="button" onClick={onBack} className="puzzle-back-link">&larr; Puzzles</button>
    );
}

function PuzzleStatusPage({ children }) {
    return (
        <main className="min-h-screen bg-[#171a1c] font-interface text-white">
            <AppNavbar account currentPage="puzzles" />
            <section className="mx-auto w-full max-w-[980px] px-4 py-12 sm:px-8">
                {children}
            </section>
        </main>
    );
}

const SUBMISSION_STYLES = Object.freeze({
    solved: { label: "SOLVED", bar: "bg-emerald-400", text: "text-emerald-300" },
    error: { label: "ERROR", bar: "bg-amber-400", text: "text-amber-300" },
    failed: { label: "FAILED", bar: "bg-rose-400", text: "text-rose-300" },
});

function PuzzleSubmissionsModal({ puzzle, submissions, onClose, onLoad }) {
    return (
        <div className="fixed inset-0 z-[200] grid place-items-center bg-[#02070de8] px-4 pb-4 pt-[5.5rem] font-interface backdrop-blur-sm max-sm:grid-rows-[minmax(0,1fr)] max-sm:items-stretch max-sm:p-0 max-sm:pt-[72px]" role="dialog" aria-modal="true" aria-labelledby="puzzle-submissions-title" tabIndex={-1} onKeyDown={(event) => { if (event.key === "Escape") onClose(); }}>
            <section className="flex max-h-[calc(100dvh-7.5rem)] w-[min(34rem,calc(100vw-2rem))] flex-col overflow-hidden rounded-2xl border border-[#262c33] bg-[#0f1418] text-[#f2f4f5] shadow-[0_24px_90px_rgba(0,0,0,.6)] max-sm:h-full max-sm:max-h-none max-sm:w-full max-sm:rounded-none max-sm:border-0">
                <header className="flex items-start justify-between gap-4 border-b border-[#262c33] px-5 py-4">
                    <div className="min-w-0">
                        <h2 id="puzzle-submissions-title" className="font-display text-xl font-bold text-white">Submissions</h2>
                        <p className="mt-0.5 truncate text-xs text-slate-500">#{puzzle.puzzleNumber} &middot; {puzzle.name} &middot; last 10</p>
                    </div>
                    <button type="button" onClick={onClose} className="modal-close-button" aria-label="Close submissions"><span aria-hidden="true">×</span></button>
                </header>

                {submissions.length > 0 ? (
                    <ol className="min-h-0 flex-1 overflow-y-auto" aria-label="Puzzle submissions">
                        {submissions.map((submission, index) => {
                            const style = SUBMISSION_STYLES[submission.status] ?? SUBMISSION_STYLES.failed;
                            return (
                                <li key={submission.id} className="flex min-h-14 items-center gap-3 border-b border-[#1c2228] px-5 py-2.5 max-sm:min-h-[44px]">
                                    <span className={`h-9 w-[3px] shrink-0 rounded-full ${style.bar}`} aria-hidden="true" />
                                    <div className="min-w-0 flex-1">
                                        <p className={`flex items-center gap-2 font-display text-sm font-bold ${style.text}`}>
                                            {style.label}
                                            {index === 0 && <span className="rounded border border-[#2d353c] px-1.5 py-0.5 font-interface text-[10px] font-semibold text-slate-400">Latest</span>}
                                        </p>
                                        <p className="truncate text-xs text-slate-500">
                                            <time dateTime={submission.submittedAt}>{formatSubmissionDate(submission.submittedAt)}</time>
                                            {submission.message ? ` · ${submission.message}` : ""}
                                        </p>
                                    </div>
                                    <button type="button" onClick={() => onLoad(submission)} className="inline-flex min-h-9 shrink-0 items-center gap-1.5 rounded-md border border-[#2d353c] bg-[#12181d] px-3 text-xs font-semibold text-slate-200 hover:border-slate-500" aria-label={`Load code from ${style.label.toLowerCase()} submission`}>
                                        <svg viewBox="0 0 24 24" className="h-3.5 w-3.5 fill-none stroke-current" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M12 4v11m0 0 4-4m-4 4-4-4M5 20h14" /></svg>
                                        Load code
                                    </button>
                                </li>
                            );
                        })}
                    </ol>
                ) : (
                    <p className="px-5 py-10 text-center text-sm text-slate-500">No submissions yet. Submit your code to see results here.</p>
                )}
                <footer className="border-t border-[#262c33] px-5 py-3 text-[11px] text-slate-500">Loading replaces the code in your workspace.</footer>
            </section>
        </div>
    );
}

function formatSubmissionDate(value) {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return "Date unavailable";
    const startOfDay = (candidate) => new Date(candidate.getFullYear(), candidate.getMonth(), candidate.getDate()).getTime();
    const dayDifference = Math.round((startOfDay(new Date()) - startOfDay(date)) / 86_400_000);
    const time = new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit" }).format(date);
    if (dayDifference === 0) return `Today, ${time}`;
    if (dayDifference === 1) return `Yesterday, ${time}`;
    return new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }).format(date);
}

export default function PuzzlePlayPage() {
    const { user } = useAuth();
    const navigate = useNavigate();
    const { puzzleNumber } = useParams();
    const [puzzle, setPuzzle] = useState(null);
    const [outcome, setOutcome] = useState(null);
    const [submissionVersion, setSubmissionVersion] = useState(0);
    const [openSubmissionsFor, setOpenSubmissionsFor] = useState(null);
    const [isConfigurationOpen, setIsConfigurationOpen] = useState(false);
    const [restoredSubmission, setRestoredSubmission] = useState(null);
    const [isLoading, setIsLoading] = useState(true);
    const [error, setError] = useState(null);
    const submissionOwnerKey = String(user?.id ?? user?.username ?? "").trim();
    const submissions = useMemo(
        () => {
            void submissionVersion;
            return loadPuzzleSubmissions(submissionOwnerKey, puzzleNumber);
        },
        [puzzleNumber, submissionOwnerKey, submissionVersion],
    );
    const activeRestoredSubmission = restoredSubmission?.puzzleNumber === puzzleNumber
        ? restoredSubmission.submission
        : null;

    const rememberPuzzleSubmission = useCallback((brain, result) => {
        savePuzzleSubmission(submissionOwnerKey, puzzleNumber, {
            brain,
            status: result?.status ?? "error",
            message: result?.message ?? "",
            submittedAt: new Date().toISOString(),
        });
        setSubmissionVersion((current) => current + 1);
    }, [puzzleNumber, submissionOwnerKey]);

    const handlePuzzleAttempt = useCallback(async ({ brain }) => {
        try {
            const result = await submitPuzzleAttempt(puzzleNumber, { brain });
            rememberPuzzleSubmission(brain, result);
            if (result.status === "solved") {
                setPuzzle((current) => current ? { ...current, solved: true } : current);
            }
            setOutcome(result);
            return result;
        } catch (attemptError) {
            const serverError = { status: "error", message: attemptError.message };
            setOutcome(serverError);
            throw attemptError;
        }
    }, [puzzleNumber, rememberPuzzleSubmission]);

    useEffect(() => {
        let active = true;
        fetchPuzzle(puzzleNumber)
            .then((payload) => {
                if (active) {
                    setError(null);
                    setOutcome(null);
                    setIsConfigurationOpen(false);
                    setPuzzle(puzzleWithBotRoles(payload));
                }
            })
            .catch((loadError) => {
                if (active) setError(loadError.message);
            })
            .finally(() => {
                if (active) setIsLoading(false);
            });
        return () => { active = false; };
    }, [puzzleNumber]);

    const handleLoadSubmission = useCallback((submission) => {
        // Loading replaces the workspace code; confirm first when it holds edits that no submission has.
        const reference = activeRestoredSubmission ?? submissions[0] ?? null;
        const draft = readPuzzleBotCodeDraft(puzzleNumber);
        const untouched = JSON.stringify(draft) === JSON.stringify(readPuzzleBotCodeDraft(""));
        if (draft && reference && !untouched && JSON.stringify(draft) !== JSON.stringify(reference.brain)
            && !window.confirm("Replace the code in your workspace? Your unsaved changes will be lost.")) return;
        setOutcome(null);
        setOpenSubmissionsFor(null);
        setRestoredSubmission({ puzzleNumber, submission });
    }, [activeRestoredSubmission, puzzleNumber, submissions]);

    const puzzleForArena = useMemo(() => {
        if (!puzzle || !activeRestoredSubmission) return puzzle;
        return {
            ...puzzle,
            bots: (puzzle.bots ?? []).map((bot) => puzzleBotKey(bot) === puzzleBotKey(PUZZLE_PLAYER_TEAM, 1)
                ? { ...bot, brain: activeRestoredSubmission.brain }
                : bot),
            playerBot: {
                ...(puzzle.playerBot ?? {}),
                brain: activeRestoredSubmission.brain,
            },
        };
    }, [activeRestoredSubmission, puzzle]);

    const viewerStateVariables = useMemo(
        () => [...VISIBLE_STATE_VARIABLES, ...customVariableDefinitions(puzzle?.logicConfiguration)],
        [puzzle?.logicConfiguration],
    );
    const viewerSelectableTypes = useMemo(
        () => selectableTypesForLoadouts(
            puzzle?.playerBot?.loadout,
            puzzle?.opponentBot?.loadout,
            {
                teammateCount: Math.max(0, puzzleBotsForTeam(puzzle?.bots, PUZZLE_PLAYER_TEAM).length - 1),
                opponentCount: puzzleBotsForTeam(puzzle?.bots, PUZZLE_OPPONENT_TEAM).length,
                teammateLoadouts: puzzleBotsForTeam(puzzle?.bots, PUZZLE_PLAYER_TEAM).slice(1).map((bot) => bot.loadout),
                opponentLoadouts: puzzleBotsForTeam(puzzle?.bots, PUZZLE_OPPONENT_TEAM).map((bot) => bot.loadout),
            },
        ),
        [puzzle?.bots, puzzle?.opponentBot?.loadout, puzzle?.playerBot?.loadout],
    );
    const viewerSelectableAbilityIds = useMemo(
        () => selectableAbilityIdsForLoadouts(
            puzzle?.playerBot?.loadout,
            puzzle?.opponentBot?.loadout,
            {
                teammateCount: Math.max(0, puzzleBotsForTeam(puzzle?.bots, PUZZLE_PLAYER_TEAM).length - 1),
                opponentCount: puzzleBotsForTeam(puzzle?.bots, PUZZLE_OPPONENT_TEAM).length,
                teammateLoadouts: puzzleBotsForTeam(puzzle?.bots, PUZZLE_PLAYER_TEAM).slice(1).map((bot) => bot.loadout),
                opponentLoadouts: puzzleBotsForTeam(puzzle?.bots, PUZZLE_OPPONENT_TEAM).map((bot) => bot.loadout),
            },
        ),
        [puzzle?.bots, puzzle?.opponentBot?.loadout, puzzle?.playerBot?.loadout],
    );
    const canViewConfiguration = Array.isArray(puzzle?.logicConfiguration?.roots)
        && puzzle.logicConfiguration.roots.length > 0;
    const openConfiguration = useCallback(() => {
        if (canViewConfiguration) setIsConfigurationOpen(true);
    }, [canViewConfiguration]);

    const controls = puzzle
        ? <PuzzlePlayToolbarControls onBack={() => navigate("/puzzles")} />
        : null;

    if (isLoading) return <PuzzleStatusPage><p className="font-mono text-xs tracking-widest text-slate-400">LOADING PUZZLE...</p></PuzzleStatusPage>;
    if (error || !puzzle) return <PuzzleStatusPage><p className="font-mono text-xs text-rose-300">{error ?? "Puzzle not found."}</p><button type="button" onClick={() => navigate("/puzzles")} className="hud-btn hud-btn--auto mt-5 min-h-11">Back to puzzles</button></PuzzleStatusPage>;

    return <>
        <Arena key={`${puzzleNumber}:${activeRestoredSubmission?.id ?? "puzzle-default"}`} puzzleMode puzzleNumber={puzzleNumber} puzzleCodeOverride={activeRestoredSubmission?.brain ?? null} initialPuzzle={puzzleForArena} arenaInfo={<PuzzlePlayInfoModal puzzle={puzzle} outcome={outcome} selectableTypes={viewerSelectableTypes} onOpenConfiguration={canViewConfiguration ? openConfiguration : undefined} />} puzzleLastResult={submissions[0]?.status ?? null} puzzleControls={controls} onOpenPuzzleSubmissions={() => setOpenSubmissionsFor(puzzleNumber)} onPuzzleOutcome={setOutcome} onPuzzleAttempt={handlePuzzleAttempt} logicLimits={{ maxActionNodes: puzzle.maxActionNodes, maxConditionNodes: puzzle.maxConditionNodes, maxCustomVariables: puzzle.maxCustomVariables }} />
        {isConfigurationOpen && canViewConfiguration && <PuzzleLogicWorkspace
            configuration={puzzle.logicConfiguration}
            onChange={() => {}}
            stateVariables={viewerStateVariables}
            selectableTypes={viewerSelectableTypes}
            selectableAbilityIds={viewerSelectableAbilityIds}
            maxCustomVariables={puzzle.maxCustomVariables}
            readOnly
            onClose={() => setIsConfigurationOpen(false)}
        />}
        {openSubmissionsFor === puzzleNumber && <PuzzleSubmissionsModal puzzle={puzzle} submissions={submissions} onClose={() => setOpenSubmissionsFor(null)} onLoad={handleLoadSubmission} />}
    </>;
}
