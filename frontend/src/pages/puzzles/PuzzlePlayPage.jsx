import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useAuth } from "../../auth/auth-context";
import AppNavbar from "../../components/AppNavbar.jsx";
import Arena from "../../gameArena/Arena.jsx";
import { customVariableDefinitions, STATE_VARIABLES, VISIBLE_STATE_VARIABLES } from "../../gameArena/botlogic/code/BotCode.js";
import { selectableAbilityIdsForLoadouts, selectableTypesForLoadouts } from "../../gameArena/coding/nodes/GraphNodes.jsx";
import { fetchPuzzle, submitPuzzleAttempt } from "../../puzzles/puzzleApi.js";
import { puzzleConditionLabel } from "../../puzzles/puzzleConditions.js";
import { loadPuzzleSubmissions, savePuzzleSubmission } from "../../puzzles/puzzleSubmissions.js";
import PuzzleLogicWorkspace from "./PuzzleLogicWorkspace.jsx";

function puzzleWithBotRoles(payload) {
    const bots = Array.isArray(payload?.bots) ? payload.bots : [];
    return {
        ...payload,
        playerBot: bots.find((bot) => bot?.role === "PLAYER") ?? null,
        opponentBot: bots.find((bot) => bot?.role === "OPPONENT") ?? null,
    };
}

function PuzzleConditionItem({ condition, variableDefinitions, onOpenConfiguration }) {
    const label = puzzleConditionLabel(condition, variableDefinitions);
    const canOpenConfiguration = typeof onOpenConfiguration === "function";
    const activate = () => onOpenConfiguration?.();
    const onKeyDown = (event) => {
        if (!canOpenConfiguration || !["Enter", " "].includes(event.key)) return;
        event.preventDefault();
        activate();
    };
    return <li>
        <span aria-hidden="true">- </span>
        <span
            role={canOpenConfiguration ? "button" : undefined}
            tabIndex={canOpenConfiguration ? 0 : undefined}
            title={canOpenConfiguration ? "View puzzle configuration" : undefined}
            onClick={canOpenConfiguration ? activate : undefined}
            onKeyDown={canOpenConfiguration ? onKeyDown : undefined}
            className={canOpenConfiguration ? "cursor-pointer transition hover:font-bold focus-visible:outline focus-visible:outline-1 focus-visible:outline-cyan-300" : ""}
        >
            {label}
        </span>
    </li>;
}

function PuzzlePlayInfoModal({ puzzle, outcome, onOpenConfiguration }) {
    const [minimized, setMinimized] = useState(false);
    const winConditions = Array.isArray(puzzle.winConditions) ? puzzle.winConditions : [];
    const loseConditions = Array.isArray(puzzle.loseConditions) ? puzzle.loseConditions : [];
    const variableDefinitions = [
        ...STATE_VARIABLES,
        ...customVariableDefinitions(puzzle.logicConfiguration),
    ];
    const description = typeof puzzle.description === "string" ? puzzle.description.trim() : "";
    const statusClass = outcome?.status === "solved"
        ? "border-emerald-500/60 bg-emerald-950/40 text-emerald-200"
        : outcome?.status === "error"
            ? "border-amber-500/60 bg-amber-950/40 text-amber-200"
            : "border-rose-500/60 bg-rose-950/40 text-rose-200";

    if (minimized) {
        return (
            <button type="button" onClick={() => setMinimized(false)} className="info-popup-minimized gray-button-surface flex items-center gap-3 rounded-lg border border-cyan-400/40 px-4 py-3 text-left shadow-2xl" aria-label="Expand puzzle information">
                <span className="font-mono text-sm font-bold tracking-[.12em] text-cyan-300">Puzzle Info</span>
                <img src="/assets/arena-toolbar/info-circle-icon.png" alt="" aria-hidden="true" className="info-circle-icon h-5 w-5" />
            </button>
        );
    }

    return (
        <aside className="info-popup-panel puzzle-info-panel w-[19rem] max-w-[calc(100vw-2rem)] overflow-hidden rounded-xl border border-cyan-400/30 bg-[#07111b] shadow-[0_18px_50px_rgba(0,0,0,.48)]" aria-label="Puzzle information">
            <div className="p-3.5">
                <div className="flex items-start justify-between gap-3">
                    <p className="min-w-0 flex-1 break-words font-mono text-lg font-bold leading-tight text-white">{puzzle.puzzleNumber}. {puzzle.name}</p>
                    <button type="button" onClick={() => setMinimized(true)} className="puzzle-info-minimize" aria-label="Minimize puzzle information" title="Minimize puzzle information"><span aria-hidden="true">-</span></button>
                </div>
                {description && <p className="mt-2 whitespace-pre-wrap text-[11px] leading-4 text-slate-300">{description}</p>}

                <div className="mt-5 grid grid-cols-2 gap-4 border-y border-white/10 py-3 font-mono text-[9px]">
                    <div>
                        <span className="block font-bold tracking-[.14em] text-cyan-300">TIME LIMIT</span>
                        <strong className="mt-1 block text-sm text-white">{Math.round(Number(puzzle.timeLimitMs ?? 90_000) / 1000)}s</strong>
                    </div>
                    <div>
                        <span className="block font-bold tracking-[.14em] text-cyan-300">OPPONENT CODE</span>
                        <strong className="mt-1 block text-sm text-white">{puzzle.hideOpponentCode === false ? "VISIBLE" : "HIDDEN"}</strong>
                    </div>
                </div>

                {outcome && <div role="status" className={`mt-4 rounded border px-3 py-2 font-mono text-[10px] font-bold tracking-widest ${statusClass}`}>
                    {outcome.status === "solved" ? "PUZZLE SOLVED" : outcome.status === "error" ? "PUZZLE SERVER ERROR" : "PUZZLE FAILED"}
                    {outcome.message && <span className="mt-1 block text-[9px] font-normal normal-case tracking-normal">{outcome.message}</span>}
                </div>}

                <section className="mt-5">
                    <h2 className="font-mono text-[10px] font-bold tracking-[.16em] text-emerald-200">WIN CONDITIONS:</h2>
                    <ul className="mt-2 space-y-1.5 font-mono text-[9px] leading-4 text-slate-300">
                        {winConditions.map((condition, index) => <PuzzleConditionItem key={condition.id ?? `${condition.left}-${index}`} condition={condition} variableDefinitions={variableDefinitions} onOpenConfiguration={onOpenConfiguration} />)}
                    </ul>
                </section>

                {loseConditions.length > 0 && (
                    <section className="mt-5">
                        <h2 className="font-mono text-[10px] font-bold tracking-[.16em] text-rose-200">LOSE CONDITIONS:</h2>
                        <ul className="mt-2 space-y-1.5 font-mono text-[9px] leading-4 text-slate-300">
                            {loseConditions.map((condition, index) => <PuzzleConditionItem key={condition.id ?? `${condition.left}-${index}`} condition={condition} variableDefinitions={variableDefinitions} onOpenConfiguration={onOpenConfiguration} />)}
                        </ul>
                    </section>
                )}

            </div>
        </aside>
    );
}

function PuzzlePlayToolbarControls({ onBack }) {
    return (
        <div className="space-y-2">
            <button type="button" onClick={onBack} className="arena-toolbar-button arena-toolbar-button--neutral">BACK TO PUZZLES</button>
        </div>
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

function PuzzleSubmissionsModal({ submissions, onClose, onLoad }) {
    return (
        <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/75 p-4" role="dialog" aria-modal="true" aria-labelledby="puzzle-submissions-title" tabIndex={-1} onKeyDown={(event) => { if (event.key === "Escape") onClose(); }}>
            <section className="max-h-[88vh] w-full max-w-2xl overflow-y-auto rounded-xl border border-cyan-400/40 bg-[#07111b] p-5 text-white shadow-[0_24px_80px_rgba(0,0,0,.55)] sm:p-6">
                <header className="flex items-start justify-between gap-4 border-b border-white/10 pb-4">
                    <div>
                        <p className="font-mono text-[10px] font-bold tracking-[.2em] text-cyan-300">PUZZLE HISTORY</p>
                        <h2 id="puzzle-submissions-title" className="mt-2 text-2xl font-bold">Your submissions</h2>
                        <p className="mt-1 text-sm text-slate-400">Your latest 10 submissions for this puzzle are stored on this device.</p>
                    </div>
                    <button type="button" onClick={onClose} className="modal-close-button gray-button-surface" aria-label="Close submissions"><span aria-hidden="true">×</span></button>
                </header>

                {submissions.length > 0 ? (
                    <ol className="mt-5 space-y-2" aria-label="Puzzle submissions">
                        {submissions.map((submission, index) => {
                            const solved = submission.status === "solved";
                            const error = submission.status === "error";
                            return (
                                <li key={submission.id}>
                                    <button type="button" onClick={() => onLoad(submission)} className="gray-button-surface flex w-full items-center gap-4 rounded-lg border border-slate-700 px-4 py-3 text-left transition hover:border-cyan-400/70">
                                        <span className={`grid h-9 w-9 flex-none place-items-center rounded-full border font-mono text-sm font-bold ${solved ? "border-emerald-400/60 bg-emerald-950/40 text-emerald-300" : error ? "border-amber-400/60 bg-amber-950/30 text-amber-300" : "border-rose-400/60 bg-rose-950/30 text-rose-300"}`} aria-hidden="true">{solved ? "✓" : error ? "!" : "×"}</span>
                                        <span className="min-w-0 flex-1">
                                            <span className={`block font-mono text-[10px] font-bold tracking-widest ${solved ? "text-emerald-300" : error ? "text-amber-300" : "text-rose-300"}`}>{solved ? "SUCCESSFUL" : error ? "ERROR" : "FAILED"}{index === 0 && <span className="ml-2 text-slate-500">LATEST</span>}</span>
                                            <time className="mt-1 block text-sm text-slate-300" dateTime={submission.submittedAt}>{formatSubmissionDate(submission.submittedAt)}</time>
                                        </span>
                                        <span className="flex-none font-mono text-[9px] font-bold tracking-widest text-cyan-200">LOAD CODE</span>
                                    </button>
                                </li>
                            );
                        })}
                    </ol>
                ) : (
                    <p className="mt-6 rounded-lg border border-slate-700 bg-slate-950/25 px-4 py-8 text-center font-mono text-[10px] tracking-widest text-slate-500">NO SUBMISSIONS YET.</p>
                )}
            </section>
        </div>
    );
}

function formatSubmissionDate(value) {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return "Date unavailable";
    return new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(date);
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
        setOutcome(null);
        setOpenSubmissionsFor(null);
        setRestoredSubmission({ puzzleNumber, submission });
    }, [puzzleNumber]);

    const puzzleForArena = useMemo(() => {
        if (!puzzle || !activeRestoredSubmission) return puzzle;
        return {
            ...puzzle,
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
        () => selectableTypesForLoadouts(puzzle?.playerBot?.loadout, puzzle?.opponentBot?.loadout),
        [puzzle?.opponentBot?.loadout, puzzle?.playerBot?.loadout],
    );
    const viewerSelectableAbilityIds = useMemo(
        () => selectableAbilityIdsForLoadouts(puzzle?.playerBot?.loadout, puzzle?.opponentBot?.loadout),
        [puzzle?.opponentBot?.loadout, puzzle?.playerBot?.loadout],
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
    if (error || !puzzle) return <PuzzleStatusPage><p className="font-mono text-xs text-rose-300">{error ?? "Puzzle not found."}</p><button type="button" onClick={() => navigate("/puzzles")} className="gray-button-surface mt-5 min-h-11 border border-slate-600 px-4 font-mono text-[10px] font-bold tracking-widest text-slate-300 hover:border-cyan-400 hover:text-cyan-200">BACK TO PUZZLES</button></PuzzleStatusPage>;

    return <>
        <Arena key={`${puzzleNumber}:${activeRestoredSubmission?.id ?? "puzzle-default"}`} puzzleMode puzzleNumber={puzzleNumber} puzzleCodeOverride={activeRestoredSubmission?.brain ?? null} initialPuzzle={puzzleForArena} arenaInfo={<PuzzlePlayInfoModal puzzle={puzzle} outcome={outcome} onOpenConfiguration={canViewConfiguration ? openConfiguration : undefined} />} puzzleControls={controls} onOpenPuzzleSubmissions={() => setOpenSubmissionsFor(puzzleNumber)} onPuzzleOutcome={setOutcome} onPuzzleAttempt={handlePuzzleAttempt} logicLimits={{ maxActionNodes: puzzle.maxActionNodes, maxConditionNodes: puzzle.maxConditionNodes, maxCustomVariables: puzzle.maxCustomVariables }} />
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
        {openSubmissionsFor === puzzleNumber && <PuzzleSubmissionsModal submissions={submissions} onClose={() => setOpenSubmissionsFor(null)} onLoad={handleLoadSubmission} />}
    </>;
}
