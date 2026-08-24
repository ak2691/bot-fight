import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import AppNavbar from "../../components/AppNavbar.jsx";
import { fetchPuzzles } from "../../puzzles/puzzleApi.js";

const PAGE_SIZE = 20;

export default function PuzzleListPage() {
    const navigate = useNavigate();
    const [puzzles, setPuzzles] = useState([]);
    const [page, setPage] = useState(0);
    const [hasNext, setHasNext] = useState(false);
    const [isLoading, setIsLoading] = useState(true);
    const [isLoadingMore, setIsLoadingMore] = useState(false);
    const [error, setError] = useState(null);

    const loadPage = useCallback(async (pageToLoad, append) => {
        setError(null);
        append ? setIsLoadingMore(true) : setIsLoading(true);
        try {
            const result = await fetchPuzzles(pageToLoad, PAGE_SIZE);
            setPuzzles((current) => append ? [...current, ...(result.puzzles ?? [])] : (result.puzzles ?? []));
            setPage(Number(result.page ?? pageToLoad));
            setHasNext(Boolean(result.hasNext));
        } catch (loadError) {
            setError(loadError.message);
        } finally {
            append ? setIsLoadingMore(false) : setIsLoading(false);
        }
    }, []);

    useEffect(() => {
        void loadPage(0, false);
    }, [loadPage]);

    return (
        <main className="puzzle-page min-h-screen bg-[#050d16] font-interface text-slate-100">
            <AppNavbar account currentPage="puzzles" />
            <section className="mx-auto w-full max-w-[1120px] px-5 py-12 sm:px-8 sm:py-16">
                <header className="max-w-3xl border-b border-slate-800/90 pb-8">
                    <p className="font-mono text-[10px] font-bold tracking-[.24em] text-cyan-300">BOT FIGHT / PUZZLES</p>
                    <h1 className="mt-4 text-5xl font-bold tracking-[-.04em] text-white sm:text-6xl">Puzzles</h1>
                    <p className="mt-4 max-w-2xl text-base leading-7 text-slate-400 sm:text-lg">
                        Practice bot programming with combat scenarios and logic challenges.
                    </p>
                </header>

                <div className="mt-6 space-y-3">
                    {isLoading && <PuzzleListMessage>LOADING PUZZLES...</PuzzleListMessage>}
                    {!isLoading && error && (
                        <div className="rounded-xl border border-rose-400/30 bg-[#0d1722] px-5 py-8">
                            <p className="font-mono text-xs text-rose-300">{error}</p>
                            <button type="button" onClick={() => loadPage(0, false)} className="mt-5 min-h-11 border border-cyan-400/60 bg-cyan-950/30 px-5 font-mono text-[10px] font-bold tracking-widest text-cyan-200 hover:border-cyan-300 hover:text-cyan-100">RETRY</button>
                        </div>
                    )}
                    {!isLoading && !error && !puzzles.length && <PuzzleListMessage>NO PUZZLES PUBLISHED YET.</PuzzleListMessage>}
                    {!isLoading && !error && puzzles.map((puzzle) => {
                        return (
                            <button
                                key={`${puzzle.number}-${puzzle.name}`}
                                type="button"
                                onClick={() => navigate(`/puzzles/${encodeURIComponent(puzzle.number)}`)}
                                className="group flex h-28 w-full items-center justify-between gap-4 rounded-xl border border-slate-700/80 bg-[linear-gradient(145deg,rgba(17,27,37,.96),rgba(11,20,30,.96))] p-4 text-left shadow-[0_12px_32px_rgba(0,0,0,.2)] transition duration-150 hover:-translate-y-0.5 hover:border-cyan-400/60 hover:bg-[linear-gradient(145deg,rgba(20,35,47,.98),rgba(11,22,33,.98))] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400 sm:gap-8 sm:px-6 sm:py-5"
                                aria-label={`Open puzzle ${puzzle.number}: ${puzzle.name}`}
                            >
                                <span className="min-w-0 flex-1">
                                    <span className="line-clamp-2 break-words text-xl font-bold leading-tight tracking-[-.02em] text-white sm:text-2xl">
                                        {puzzle.number}. {puzzle.name}
                                    </span>
                                </span>

                                <span className="flex shrink-0 items-center gap-3">
                                    <span className={`inline-flex items-center gap-2 whitespace-nowrap rounded-lg border px-3 py-2 text-sm font-semibold ${puzzle.solved ? "border-emerald-400/25 bg-emerald-950/20 text-emerald-300" : "border-slate-700 bg-slate-950/20 text-slate-300"}`}>
                                        <span className={`h-2.5 w-2.5 rounded-full ${puzzle.solved ? "bg-emerald-400" : "bg-slate-400"}`} aria-hidden="true" />
                                        {puzzle.solved ? "Completed" : "Not Completed"}
                                    </span>
                                </span>
                            </button>
                        );
                    })}
                </div>

                {!isLoading && !error && hasNext && (
                    <button type="button" disabled={isLoadingMore} onClick={() => loadPage(page + 1, true)} className="mx-auto mt-7 flex min-h-11 items-center border border-slate-600 bg-[#111c27] px-5 font-mono text-[10px] font-bold tracking-widest text-slate-300 hover:border-cyan-400 hover:text-cyan-200 disabled:cursor-wait disabled:opacity-60">
                        {isLoadingMore ? "LOADING..." : "LOAD NEXT 20"}
                    </button>
                )}
            </section>
        </main>
    );
}

function PuzzleListMessage({ children }) {
    return <div className="rounded-xl border border-slate-700/80 bg-[#0e1822] px-5 py-10 font-mono text-xs tracking-widest text-slate-400">{children}</div>;
}
