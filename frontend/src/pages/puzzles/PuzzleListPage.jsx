import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../../auth/auth-context";
import AppNavbar from "../../components/AppNavbar.jsx";
import { apiUrl } from "../../config/api.js";
import { fetchPuzzles, MAX_PUZZLE_SEARCH_QUERY_LENGTH } from "../../puzzles/puzzleApi.js";

const PAGE_SIZE = 20;
const PUZZLE_FILTERS = [
    { id: "all", label: "All" },
    { id: "unsolved", label: "Unsolved" },
    { id: "solved", label: "Solved" },
];

export default function PuzzleListPage() {
    const navigate = useNavigate();
    const { user } = useAuth();
    const isAdmin = user?.admin === true;
    const [puzzles, setPuzzles] = useState([]);
    const [hasNext, setHasNext] = useState(false);
    const [isLoading, setIsLoading] = useState(true);
    const [isLoadingMore, setIsLoadingMore] = useState(false);
    const [error, setError] = useState(null);
    const [loadMoreError, setLoadMoreError] = useState(null);
    const [totalPuzzleCount, setTotalPuzzleCount] = useState(null);
    const [completedPuzzleCount, setCompletedPuzzleCount] = useState(null);
    const [query, setQuery] = useState("");
    const [activeQuery, setActiveQuery] = useState("");
    const [filter, setFilter] = useState("all");
    const [helpOpen, setHelpOpen] = useState(false);
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
            if (!queryToLoad) setTotalPuzzleCount(Number(result.totalElements ?? nextPuzzles.length));
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

    useEffect(() => {
        const controller = new AbortController();
        fetch(apiUrl("/api/profile"), {
            credentials: "include",
            signal: controller.signal,
        })
            .then(async (response) => {
                if (!response.ok) throw new Error("profile request failed");
                const profile = await response.json();
                const completed = Number(profile.puzzlesSolved);
                setCompletedPuzzleCount(Number.isFinite(completed) ? completed : null);
            })
            .catch((profileError) => {
                if (profileError.name !== "AbortError") setCompletedPuzzleCount(null);
            });
        return () => controller.abort();
    }, []);

    const totalForProgress = Math.max(0, Number(totalPuzzleCount ?? 0));
    const completedForProgress = Math.min(totalForProgress, Math.max(0, Number(completedPuzzleCount ?? 0)));
    const completionPercent = totalForProgress > 0 ? Math.round((completedForProgress / totalForProgress) * 100) : 0;

    const visiblePuzzles = puzzles.filter((puzzle) => (
        filter === "solved" ? puzzle.solved : filter === "unsolved" ? !puzzle.solved : true
    ));

    return (
        <main className="puzzle-page relative min-h-screen bg-[#181b1c] font-interface text-[#f2f4f5]">
            <AppNavbar account currentPage="puzzles" />
            <section className="relative z-[1] mx-auto w-full max-w-[860px] px-4 pb-10 pt-6 sm:px-8 sm:pt-9">
                <div className="flex items-start justify-between gap-4">
                    <div className="min-w-0">
                        <h1 className="font-display text-3xl font-bold text-white sm:text-4xl">Puzzles</h1>
                        <div className="relative mt-1 flex items-center gap-1.5 text-sm text-slate-400">
                            <span>Solve tactical challenges with your bot&apos;s logic</span>
                            <button
                                type="button"
                                onClick={() => setHelpOpen((open) => !open)}
                                aria-expanded={helpOpen}
                                aria-label="How puzzle submissions work"
                                title="How submission works"
                                className="grid h-5 w-5 place-items-center rounded-full border border-slate-600 text-[11px] font-bold text-slate-300 hover:border-cyan-400 hover:text-cyan-200"
                            >
                                i
                            </button>
                            {helpOpen && (
                                <div role="note" className="absolute left-0 top-7 z-20 w-[min(22rem,calc(100vw-2rem))] rounded-lg border border-[#262c33] bg-[#0f1418] p-3 text-xs leading-5 text-slate-300 shadow-xl">
                                    Test your strategy in the browser, then click <strong className="text-white">Submit Puzzle</strong>. The server simulates your submitted logic and checks whether it solves the puzzle.
                                </div>
                            )}
                        </div>
                    </div>
                    <PuzzleProgressStat completed={completedPuzzleCount} total={totalPuzzleCount} percent={completionPercent} />
                </div>

                <form onSubmit={submitSearch} className="mt-5 flex flex-wrap items-center gap-2">
                    <label htmlFor="puzzle-search" className="sr-only">Search puzzles</label>
                    <div className="relative min-w-0 flex-1 basis-56">
                        <span className="puzzle-search-icon" aria-hidden="true">
                            <svg viewBox="0 0 24 24" className="h-4 w-4 fill-none stroke-current" strokeWidth="1.8">
                                <circle cx="10.8" cy="10.8" r="6.3" />
                                <path d="m16 16 4.2 4.2" />
                            </svg>
                        </span>
                        <input
                            id="puzzle-search"
                            type="text"
                            value={query}
                            onChange={(event) => setQuery(event.target.value)}
                            placeholder="Search by name or number"
                            maxLength={MAX_PUZZLE_SEARCH_QUERY_LENGTH}
                            autoComplete="off"
                            className="puzzle-search-input min-h-10 w-full pl-10 pr-11 text-sm text-[#f2f4f5] outline-none"
                        />
                        {query && (
                            <button
                                type="button"
                                aria-label="Clear puzzle search"
                                onClick={() => { setQuery(""); setActiveQuery(""); }}
                                className="puzzle-search-clear"
                            >
                                ×
                            </button>
                        )}
                    </div>
                    <div className="flex gap-1.5" role="group" aria-label="Filter puzzles">
                        {PUZZLE_FILTERS.map((option) => (
                            <button
                                key={option.id}
                                type="button"
                                onClick={() => setFilter(option.id)}
                                aria-pressed={filter === option.id}
                                className={`h-8 rounded-full border px-3 text-xs font-semibold transition ${filter === option.id ? "border-cyan-400/70 bg-cyan-400/15 text-cyan-100" : "border-[#2d353c] text-slate-300 hover:border-slate-500"}`}
                            >
                                {option.label}
                            </button>
                        ))}
                    </div>
                </form>

                <div className="puzzle-list-frame mt-4 overflow-hidden rounded-xl border border-[#262c33] bg-[#0f1418]">
                    <div className="flex items-center gap-3 border-b border-[#262c33] px-4 py-2 text-[11px] text-slate-500" aria-hidden="true">
                        <span className="w-6" />
                        <span className="w-8 shrink-0">#</span>
                        <span className="flex-1">Title</span>
                        {isAdmin && <span className="w-8" />}
                    </div>
                    {isLoading && <PuzzleListMessage>Loading puzzles...</PuzzleListMessage>}
                    {!isLoading && error && (
                        <div className="puzzle-list-message border-rose-400/30 text-rose-300">
                            <p className="text-xs text-rose-300">{error}</p>
                            <button type="button" onClick={() => loadPage(0, false, activeQuery)} className="puzzle-inline-action mt-5">Retry</button>
                        </div>
                    )}
                    {!isLoading && !error && !visiblePuzzles.length && (
                        <PuzzleListMessage>
                            {activeQuery ? `No puzzles matching "${activeQuery}".` : filter !== "all" ? `No ${filter} puzzles loaded.` : "No puzzles published yet."}
                        </PuzzleListMessage>
                    )}
                    {!isLoading && !error && visiblePuzzles.map((puzzle) => (
                        <div
                            key={`${puzzle.number}-${puzzle.name}`}
                            className="puzzle-list-row group relative flex min-h-[42px] items-center before:absolute before:inset-y-0 before:left-0 before:w-[3px] before:bg-transparent hover:before:bg-cyan-400"
                        >
                            <button
                                type="button"
                                onClick={() => navigate(`/puzzles/${encodeURIComponent(puzzle.number)}`)}
                                className="puzzle-list-open-button flex min-h-[42px] min-w-0 flex-1 items-center gap-3 px-4 text-left"
                                aria-label={`Open puzzle ${puzzle.number}: ${puzzle.name}`}
                            >
                                <span className="grid w-6 shrink-0 place-items-center" title={puzzle.solved ? "Solved" : undefined}>
                                    {puzzle.solved && (
                                        <svg viewBox="0 0 24 24" className="h-4 w-4 fill-none stroke-emerald-400" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-label="Solved"><circle cx="12" cy="12" r="9" /><path d="m8 12.3 2.6 2.6L16 9.5" /></svg>
                                    )}
                                </span>
                                <span className="puzzle-row-number w-8 shrink-0 font-display text-sm text-slate-500">{puzzle.number}</span>
                                <span className="min-w-0 flex-1 truncate text-sm font-semibold text-[#f2f4f5]" title={puzzle.name}>{puzzle.name}</span>
                            </button>
                            {isAdmin && <button
                                type="button"
                                onClick={() => navigate(`/admin/puzzles/${encodeURIComponent(puzzle.number)}/edit`)}
                                className="puzzle-edit-button mr-2"
                                aria-label={`Edit puzzle ${puzzle.number}: ${puzzle.name}`}
                                title="Edit puzzle"
                            >
                                <svg viewBox="0 0 24 24" className="h-[18px] w-[18px] fill-none stroke-current" strokeWidth="1.7" aria-hidden="true">
                                    <path d="m14.2 5.1 4.7 4.7" />
                                    <path d="m4.7 19.3.9-4.2L15.9 4.8a2.2 2.2 0 0 1 3.1 3.1L8.7 18.2l-4 1.1Z" />
                                    <path d="M13.8 6.9 17 10.1" />
                                </svg>
                            </button>}
                        </div>
                    ))}
                </div>

                {!isLoading && !error && hasNext && (
                    <div ref={loadMoreSentinelRef} className="mx-auto mt-6 flex min-h-11 items-center justify-center text-xs font-semibold text-[#9aa8b2]" aria-live="polite">
                        {isLoadingMore ? "Loading next 20..." : "Scroll to load more"}
                    </div>
                )}
                {!isLoading && !error && loadMoreError && (
                    <div className="mx-auto mt-3 flex max-w-xl flex-wrap items-center justify-center gap-3 rounded-lg border border-rose-400/25 bg-[#151a1d] px-4 py-3 text-center">
                        <span className="text-xs text-rose-300">{loadMoreError}</span>
                        <button type="button" onClick={loadNextPage} className="puzzle-inline-action">Retry</button>
                    </div>
                )}
            </section>
        </main>
    );
}

function PuzzleListMessage({ children }) {
    return <div className="puzzle-list-message">{children}</div>;
}

function PuzzleProgressStat({ completed, total, percent }) {
    const hasProgress = total !== null && Number.isFinite(Number(total));
    const hasCompletion = completed !== null && Number.isFinite(Number(completed));
    const displayedCompleted = hasCompletion ? Number(completed) : "—";
    const displayedTotal = hasProgress ? Number(total) : "—";
    const radius = 20;
    const circumference = 2 * Math.PI * radius;

    return (
        <aside className="flex shrink-0 items-center gap-2.5" aria-label={`${displayedCompleted} of ${displayedTotal} puzzles solved`}>
            <div className="relative h-12 w-12">
                <svg viewBox="0 0 48 48" className="h-12 w-12 -rotate-90" aria-hidden="true">
                    <circle cx="24" cy="24" r={radius} fill="none" stroke="#262c33" strokeWidth="4" />
                    <circle cx="24" cy="24" r={radius} fill="none" stroke="#34d399" strokeWidth="4" strokeLinecap="round" strokeDasharray={circumference} strokeDashoffset={circumference * (1 - percent / 100)} />
                </svg>
                <span className="absolute inset-0 grid place-items-center font-display text-[11px] font-bold text-white">{displayedCompleted}/{displayedTotal}</span>
            </div>
            <span className="text-xs text-slate-400">solved</span>
        </aside>
    );
}
