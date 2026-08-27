import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../../auth/auth-context";
import AppNavbar from "../../components/AppNavbar.jsx";
import { apiUrl } from "../../config/api.js";
import { fetchPuzzles, MAX_PUZZLE_SEARCH_QUERY_LENGTH } from "../../puzzles/puzzleApi.js";

const PAGE_SIZE = 20;

const DECORATIVE_PUZZLE_PIECES = [
    { id: "left-top", top: "9%", left: "1%", size: 86, rotation: -24, opacity: 0.10 },
    { id: "right-top", top: "11%", right: "1%", size: 74, rotation: 18, opacity: 0.08 },
    { id: "left-middle", top: "34%", left: "-1%", size: 102, rotation: 12, opacity: 0.12 },
    { id: "right-middle", top: "39%", right: "-2%", size: 92, rotation: -31, opacity: 0.09 },
    { id: "left-lower", bottom: "18%", left: "3%", size: 68, rotation: 29, opacity: 0.07 },
    { id: "right-lower", bottom: "16%", right: "3%", size: 88, rotation: -17, opacity: 0.11 },
    { id: "left-upper-middle", top: "21%", left: "7%", size: 58, rotation: 34, opacity: 0.07 },
    { id: "right-upper-middle", top: "26%", right: "7%", size: 106, rotation: -8, opacity: 0.10 },
    { id: "left-lower-middle", top: "61%", left: "5%", size: 76, rotation: -35, opacity: 0.08 },
    { id: "right-lower-middle", top: "65%", right: "5%", size: 64, rotation: 22, opacity: 0.07 },
    { id: "left-bottom", bottom: "3%", left: "10%", size: 84, rotation: 25, opacity: 0.10 },
    { id: "right-bottom", bottom: "4%", right: "10%", size: 70, rotation: -37, opacity: 0.08 },
    { id: "top-center-left", top: "8%", left: "32%", size: 54, rotation: 8, opacity: 0.06 },
    { id: "top-center-right", top: "8%", right: "32%", size: 62, rotation: -19, opacity: 0.07 },
    { id: "bottom-center-left", bottom: "2%", left: "27%", size: 58, rotation: 36, opacity: 0.08 },
    { id: "bottom-center-right", bottom: "1%", right: "27%", size: 96, rotation: -30, opacity: 0.11 },
    { id: "left-center", top: "49%", left: "15%", size: 46, rotation: 15, opacity: 0.06 },
    { id: "right-center", top: "52%", right: "15%", size: 52, rotation: -4, opacity: 0.09 },
];

function PuzzleDecorationPiece({ piece }) {
    const position = Object.fromEntries(
        ["top", "right", "bottom", "left"]
            .filter((edge) => piece[edge] !== undefined)
            .map((edge) => [edge, piece[edge]])
    );

    return (
        <svg
            className="puzzle-page-decoration-piece"
            viewBox="0 0 100 100"
            aria-hidden="true"
            style={{
                ...position,
                width: `${piece.size}px`,
                height: `${piece.size}px`,
                opacity: piece.opacity,
                transform: `rotate(${piece.rotation}deg)`,
            }}
        >
            <path d="M18 8h22c0 12 18 12 18 0h24v24c-12 0-12 18 0 18v24H58c0-12-18-12-18 0H18V50c12 0 12-18 0-18V8Z" />
        </svg>
    );
}

function PuzzleDecorationLayer() {
    return (
        <div className="puzzle-page-decorations" aria-hidden="true">
            {DECORATIVE_PUZZLE_PIECES.map((piece) => <PuzzleDecorationPiece key={piece.id} piece={piece} />)}
        </div>
    );
}

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

    return (
        <main className="puzzle-page relative min-h-screen overflow-hidden bg-[#181b1c] font-interface text-[#f2f4f5]">
            <AppNavbar account currentPage="puzzles" />
            <PuzzleDecorationLayer />
            <section className="relative z-[1] mx-auto w-full max-w-[1160px] px-5 pb-10 pt-7 sm:px-8 sm:pb-14 sm:pt-10">
                <div className="flex flex-col gap-7 lg:flex-row lg:items-start lg:justify-between lg:gap-12">
                    <div className="min-w-0 max-w-2xl flex-1">
                        <h1 className="font-display-action text-5xl uppercase tracking-wide text-[#f2f4f5] sm:text-7xl">Puzzles</h1>

                        <form onSubmit={submitSearch} className="mt-6 max-w-[680px]">
                            <label htmlFor="puzzle-search" className="font-mono text-[10px] font-bold tracking-[.2em] text-[#35c7e8]">SEARCH PUZZLES</label>
                            <div className="relative mt-2">
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
                                    placeholder="Search by name or puzzle number"
                                    maxLength={MAX_PUZZLE_SEARCH_QUERY_LENGTH}
                                    autoComplete="off"
                                    className="puzzle-search-input min-h-11 w-full pl-10 pr-11 text-base text-[#f2f4f5] outline-none"
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
                        </form>
                    </div>

                    <PuzzleProgressStat
                        completed={completedPuzzleCount}
                        total={totalPuzzleCount}
                        percent={completionPercent}
                    />
                </div>

                <div className="puzzle-list-frame mt-8">
                    <div className="puzzle-list-heading" aria-hidden="true">
                        <span>#</span>
                        <span>PUZZLE</span>
                        <span>STATUS</span>
                        {isAdmin && <span />}
                    </div>
                    {isLoading && <PuzzleListMessage>LOADING PUZZLES...</PuzzleListMessage>}
                    {!isLoading && error && (
                        <div className="puzzle-list-message border-rose-400/30 text-rose-300">
                            <p className="font-mono text-xs text-rose-300">{error}</p>
                            <button type="button" onClick={() => loadPage(0, false, activeQuery)} className="puzzle-inline-action mt-5">RETRY</button>
                        </div>
                    )}
                    {!isLoading && !error && !puzzles.length && (
                        <PuzzleListMessage>
                            {activeQuery ? `NO PUZZLES MATCHING "${activeQuery}".` : "NO PUZZLES PUBLISHED YET."}
                        </PuzzleListMessage>
                    )}
                    {!isLoading && !error && puzzles.map((puzzle) => {
                        return (
                            <div
                                key={`${puzzle.number}-${puzzle.name}`}
                                className="puzzle-list-row group"
                            >
                                <button
                                    type="button"
                                    onClick={() => navigate(`/puzzles/${encodeURIComponent(puzzle.number)}`)}
                                    className="puzzle-list-open-button"
                                    aria-label={`Open puzzle ${puzzle.number}: ${puzzle.name}`}
                                >
                                    <span className="puzzle-row-number">{puzzle.number}</span>
                                    <span className="min-w-0 truncate">
                                        <span className="block truncate text-[.95rem] font-semibold leading-5 tracking-[-.01em] text-[#f2f4f5] sm:text-base" title={puzzle.name}>
                                            {puzzle.name}
                                        </span>
                                    </span>

                                    <span className={`puzzle-row-status ${puzzle.solved ? "puzzle-row-status--complete" : ""}`}>
                                        <span className="puzzle-status-dot" aria-hidden="true" />
                                        {puzzle.solved ? "Completed" : "Not completed"}
                                    </span>
                                </button>
                                {isAdmin && <button
                                    type="button"
                                    onClick={() => navigate(`/admin/puzzles/${encodeURIComponent(puzzle.number)}/edit`)}
                                    className="puzzle-edit-button"
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
                        );
                    })}
                </div>

                {!isLoading && !error && hasNext && (
                    <div ref={loadMoreSentinelRef} className="mx-auto mt-7 flex min-h-11 items-center justify-center font-mono text-[10px] font-bold tracking-widest text-[#9aa8b2]" aria-live="polite">
                        {isLoadingMore ? "LOADING NEXT 20..." : "SCROLL TO LOAD MORE"}
                    </div>
                )}
                {!isLoading && !error && loadMoreError && (
                    <div className="mx-auto mt-3 flex max-w-xl flex-wrap items-center justify-center gap-3 rounded-lg border border-rose-400/25 bg-[#151a1d] px-4 py-3 text-center">
                        <span className="font-mono text-[10px] text-rose-300">{loadMoreError}</span>
                        <button type="button" onClick={loadNextPage} className="puzzle-inline-action">RETRY</button>
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
    const displayedPercent = hasProgress && hasCompletion ? `${percent}%` : "—";

    return (
        <aside className="puzzle-progress-stat" aria-label={`${displayedCompleted} of ${displayedTotal} puzzles completed`}>
            <div className="puzzle-progress-label">PUZZLES COMPLETED</div>
            <div className="mt-2 flex items-baseline gap-2">
                <strong className="puzzle-progress-value">{displayedCompleted}</strong>
                <span className="puzzle-progress-total">/ {displayedTotal}</span>
            </div>
            <div className="puzzle-progress-track" aria-hidden="true">
                <span style={{ width: `${percent}%` }} />
            </div>
            <div className="mt-2 flex items-center justify-between gap-3 font-mono text-[10px] font-bold tracking-[.12em] text-[#9aa8b2]">
                <span>{displayedPercent} COMPLETE</span>
            </div>
        </aside>
    );
}
