import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import AppNavbar from "../../components/AppNavbar.jsx";
import FloatingLogicBackground from "../../components/FloatingLogicBackground.jsx";
import { fetchPuzzles } from "../../puzzles/puzzleApi.js";

const PAGE_SIZE = 20;

export default function PuzzleListPage() {
    const navigate = useNavigate();
    const [puzzles, setPuzzles] = useState([]);
    const [hasNext, setHasNext] = useState(false);
    const [isLoading, setIsLoading] = useState(true);
    const [isLoadingMore, setIsLoadingMore] = useState(false);
    const [error, setError] = useState(null);
    const [loadMoreError, setLoadMoreError] = useState(null);
    const [query, setQuery] = useState("");
    const [activeQuery, setActiveQuery] = useState("");
    const loadMoreSentinelRef = useRef(null);
    const requestIdRef = useRef(0);
    const pageRef = useRef(0);
    const hasNextRef = useRef(false);
    const isLoadingMoreRef = useRef(false);
    const activeQueryRef = useRef("");

    const loadPage = useCallback(async (pageToLoad, append, queryToLoad) => {
        if (append && (isLoadingMoreRef.current || !hasNextRef.current)) return;
        const requestId = requestIdRef.current + 1;
        requestIdRef.current = requestId;
        if (append) {
            isLoadingMoreRef.current = true;
            setIsLoadingMore(true);
            setLoadMoreError(null);
        } else {
            isLoadingMoreRef.current = false;
            setIsLoading(true);
            setError(null);
            setLoadMoreError(null);
        }

        try {
            const result = await fetchPuzzles(pageToLoad, PAGE_SIZE, queryToLoad);
            if (requestId !== requestIdRef.current) return;
            const nextPuzzles = result.puzzles ?? [];
            setPuzzles((current) => {
                if (!append) return nextPuzzles;
                const existingNumbers = new Set(current.map((puzzle) => String(puzzle.number)));
                return [...current, ...nextPuzzles.filter((puzzle) => !existingNumbers.has(String(puzzle.number)))];
            });
            const resolvedPage = Number(result.page ?? pageToLoad);
            const nextHasNext = Boolean(result.hasNext);
            pageRef.current = resolvedPage;
            hasNextRef.current = nextHasNext;
            setHasNext(nextHasNext);
        } catch (loadError) {
            if (requestId !== requestIdRef.current) return;
            if (append) {
                setLoadMoreError(loadError.message);
            } else {
                setError(loadError.message);
            }
        } finally {
            if (requestId === requestIdRef.current) {
                if (append) {
                    isLoadingMoreRef.current = false;
                    setIsLoadingMore(false);
                } else {
                    setIsLoading(false);
                }
            }
        }
    }, []);

    useEffect(() => {
        activeQueryRef.current = activeQuery;
        pageRef.current = 0;
        hasNextRef.current = false;
        isLoadingMoreRef.current = false;
        setPuzzles([]);
        setHasNext(false);
        void loadPage(0, false, activeQuery);
    }, [activeQuery, loadPage]);

    const submitSearch = (event) => {
        event.preventDefault();
        const nextQuery = query.trim();
        if (nextQuery === activeQuery) {
            void loadPage(0, false, nextQuery);
            return;
        }
        setActiveQuery(nextQuery);
    };

    const loadNextPage = useCallback(() => {
        if (!hasNextRef.current || isLoadingMoreRef.current) return;
        void loadPage(pageRef.current + 1, true, activeQueryRef.current);
    }, [loadPage]);

    useEffect(() => {
        const sentinel = loadMoreSentinelRef.current;
        if (!sentinel || !hasNext || typeof IntersectionObserver === "undefined") return undefined;

        const observer = new IntersectionObserver((entries) => {
            if (entries[0]?.isIntersecting) loadNextPage();
        }, { threshold: 1 });
        observer.observe(sentinel);
        return () => observer.disconnect();
    }, [hasNext, loadNextPage]);

    return (
        <main className="puzzle-page home-grid home-dashboard min-h-screen font-interface text-slate-100">
            <AppNavbar account currentPage="puzzles" />
            <FloatingLogicBackground />
            <section className="relative z-[2] mx-auto w-full max-w-[980px] px-5 pb-10 pt-6 sm:px-8 sm:pb-14 sm:pt-9">
                <div className="max-w-2xl border-b border-slate-800/90 pb-4">
                    <div className="text-[2.65rem] font-bold leading-none tracking-[-.04em] text-white sm:text-[3.5rem]">Puzzles</div>
                    <p className="mt-2 max-w-xl text-sm leading-6 text-slate-400 sm:text-base">
                        Practice bot programming with combat scenarios and logic challenges.
                    </p>
                </div>

                <form onSubmit={submitSearch} className="mt-4 max-w-2xl">
                    <label htmlFor="puzzle-search" className="font-mono text-[10px] font-bold tracking-[.2em] text-cyan-300">SEARCH PUZZLES</label>
                    <div className="relative mt-2">
                        <input
                            id="puzzle-search"
                            type="text"
                            value={query}
                            onChange={(event) => setQuery(event.target.value)}
                            placeholder="Search by number, name, or description"
                            autoComplete="off"
                            className="min-h-11 w-full rounded-xl border border-slate-700 bg-[#0e1822] px-4 pr-11 text-base text-white outline-none transition placeholder:text-slate-500 focus:border-cyan-400 focus:ring-2 focus:ring-cyan-400/20"
                        />
                        {query && (
                            <button
                                type="button"
                                aria-label="Clear puzzle search"
                                onClick={() => { setQuery(""); setActiveQuery(""); }}
                                className="absolute right-3 top-1/2 -translate-y-1/2 p-1 text-xl leading-none text-white hover:text-cyan-200 focus-visible:outline focus-visible:outline-1 focus-visible:outline-cyan-300"
                            >
                                ×
                            </button>
                        )}
                    </div>
                </form>

                <div className="mt-6 space-y-3">
                    {isLoading && <PuzzleListMessage>LOADING PUZZLES...</PuzzleListMessage>}
                    {!isLoading && error && (
                        <div className="rounded-xl border border-rose-400/30 bg-[#0d1722] px-5 py-8">
                            <p className="font-mono text-xs text-rose-300">{error}</p>
                            <button type="button" onClick={() => loadPage(0, false, activeQuery)} className="mt-5 min-h-11 border border-cyan-400/60 bg-cyan-950/30 px-5 font-mono text-[10px] font-bold tracking-widest text-cyan-200 hover:border-cyan-300 hover:text-cyan-100">RETRY</button>
                        </div>
                    )}
                    {!isLoading && !error && !puzzles.length && (
                        <PuzzleListMessage>
                            {activeQuery ? `NO PUZZLES MATCHING "${activeQuery}".` : "NO PUZZLES PUBLISHED YET."}
                        </PuzzleListMessage>
                    )}
                    {!isLoading && !error && puzzles.map((puzzle) => {
                        return (
                            <button
                                key={`${puzzle.number}-${puzzle.name}`}
                                type="button"
                                onClick={() => navigate(`/puzzles/${encodeURIComponent(puzzle.number)}`)}
                                className="group flex min-h-20 w-full items-center justify-between gap-4 rounded-xl border border-slate-700/80 bg-[linear-gradient(145deg,rgba(17,27,37,.96),rgba(11,20,30,.96))] p-3 text-left shadow-[0_12px_32px_rgba(0,0,0,.2)] transition duration-150 hover:-translate-y-0.5 hover:border-cyan-400/60 hover:bg-[linear-gradient(145deg,rgba(20,35,47,.98),rgba(11,22,33,.98))] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400 sm:gap-6 sm:px-5 sm:py-3.5"
                                aria-label={`Open puzzle ${puzzle.number}: ${puzzle.name}`}
                            >
                                <span className="min-w-0 flex-1">
                                    <span className="line-clamp-2 break-words text-lg font-bold leading-tight tracking-[-.02em] text-white sm:text-xl">
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
                    <div ref={loadMoreSentinelRef} className="mx-auto mt-7 flex min-h-11 items-center justify-center font-mono text-[10px] font-bold tracking-widest text-slate-500" aria-live="polite">
                        {isLoadingMore ? "LOADING NEXT 20..." : "SCROLL TO LOAD MORE"}
                    </div>
                )}
                {!isLoading && !error && loadMoreError && (
                    <div className="mx-auto mt-3 flex max-w-xl flex-wrap items-center justify-center gap-3 rounded-lg border border-rose-400/25 bg-[#0d1722] px-4 py-3 text-center">
                        <span className="font-mono text-[10px] text-rose-300">{loadMoreError}</span>
                        <button type="button" onClick={loadNextPage} className="border border-cyan-400/60 px-3 py-2 font-mono text-[10px] font-bold tracking-widest text-cyan-200 hover:border-cyan-300 hover:text-cyan-100">RETRY</button>
                    </div>
                )}
            </section>
        </main>
    );
}

function PuzzleListMessage({ children }) {
    return <div className="rounded-xl border border-slate-700/80 bg-[#0e1822] px-5 py-10 font-mono text-xs tracking-widest text-slate-400">{children}</div>;
}
