import { useCallback, useEffect, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { useAuth } from "../../auth/auth-context";
import AppNavbar from "../../components/AppNavbar";
import PlayerAvatar from "../../components/PlayerAvatar.jsx";
import SpinningBotFace from "../../components/SpinningBotFace.jsx";
import { apiUrl } from "../../config/api";

const MAX_QUERY_LENGTH = 50;
const DEFAULT_ELO = 1000;

function searchUrl(query, page) {
    const params = new URLSearchParams({ query, page: String(page) });
    return apiUrl(`/api/profile/search?${params.toString()}`);
}

function appendUniqueProfiles(current, next) {
    const seen = new Set(current.map((profile) => String(profile.username ?? "").toLowerCase()));
    return [...current, ...next.filter((profile) => !seen.has(String(profile.username ?? "").toLowerCase()))];
}

export default function ProfileSearchPage() {
    const [searchParams, setSearchParams] = useSearchParams();
    const { user } = useAuth();
    const query = (searchParams.get("query") ?? "").trim().slice(0, MAX_QUERY_LENGTH);
    const [profiles, setProfiles] = useState([]);
    const [page, setPage] = useState(0);
    const [hasMore, setHasMore] = useState(false);
    const [totalProfiles, setTotalProfiles] = useState(0);
    const [status, setStatus] = useState(query ? "loading" : "empty");
    const requestRef = useRef(0);
    const [draft, setDraft] = useState(query);

    useEffect(() => {
        setDraft(query);
    }, [query]);

    const loadResults = useCallback(async (pageToLoad, append) => {
        const requestId = ++requestRef.current;
        setStatus(append ? "loading-more" : "loading");
        try {
            const response = await fetch(searchUrl(query, pageToLoad), { credentials: "include" });
            if (!response.ok) throw new Error("profile search failed");
            const result = await response.json();
            if (requestId !== requestRef.current) return;
            const nextProfiles = Array.isArray(result.profiles) ? result.profiles : [];
            setProfiles((current) => append ? appendUniqueProfiles(current, nextProfiles) : nextProfiles);
            setPage(result.page ?? pageToLoad);
            setHasMore(result.hasMore === true);
            setTotalProfiles(result.totalProfiles ?? 0);
            setStatus("ready");
        } catch {
            if (requestId !== requestRef.current) return;
            setStatus("error");
        }
    }, [query]);

    useEffect(() => {
        requestRef.current += 1;
        setProfiles([]);
        setPage(0);
        setHasMore(false);
        setTotalProfiles(0);
        if (!query) {
            setStatus("empty");
            return;
        }
        void loadResults(0, false);
    }, [loadResults, query]);

    const submitSearch = (event) => {
        event.preventDefault();
        const next = draft.trim().slice(0, MAX_QUERY_LENGTH);
        if (next === query) return;
        setSearchParams(next ? { query: next } : {});
    };

    return (
        <main className="profile-search-page min-h-screen bg-[#171a1c] font-interface text-slate-100">
            <AppNavbar account currentPage="profile" />

            <section className="relative z-[1] mx-auto w-full max-w-[720px] px-4 py-8 sm:px-8 sm:py-10">
                <form onSubmit={submitSearch} role="search" className="flex items-center gap-3 rounded-lg border border-cyan-400/70 bg-[#0f1418] px-3.5">
                    <svg viewBox="0 0 24 24" className="h-4 w-4 shrink-0 fill-none stroke-slate-400" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" /></svg>
                    <label htmlFor="profile-search-query" className="sr-only">Search players</label>
                    <input
                        id="profile-search-query"
                        type="search"
                        value={draft}
                        onChange={(event) => setDraft(event.target.value)}
                        maxLength={MAX_QUERY_LENGTH}
                        placeholder="Search players"
                        autoComplete="off"
                        className="h-11 min-w-0 flex-1 bg-transparent text-sm text-white outline-none placeholder:text-slate-500"
                    />
                    {query && status !== "loading" && status !== "empty" && (
                        <span className="shrink-0 text-xs text-slate-400">{totalProfiles} {totalProfiles === 1 ? "player" : "players"}</span>
                    )}
                </form>

                <section className="mt-4 overflow-hidden rounded-xl border border-[#262c33] bg-[#0f1418]" aria-live="polite">
                    {status === "empty" ? (
                        <p className="px-6 py-12 text-center text-sm text-slate-500">Enter a username to search for players.</p>
                    ) : status === "loading" && profiles.length === 0 ? (
                        <SearchLoading />
                    ) : status === "error" && profiles.length === 0 ? (
                        <div className="px-6 py-12 text-center">
                            <p className="text-sm text-rose-300" role="alert">Profiles could not be loaded.</p>
                            <button
                                type="button"
                                onClick={() => void loadResults(0, false)}
                                className="hud-btn hud-btn--auto mt-5 text-sm font-bold"
                            >
                                Try again
                            </button>
                        </div>
                    ) : profiles.length === 0 ? (
                        <p className="px-6 py-12 text-center text-sm text-slate-500">No profiles match that username.</p>
                    ) : (
                        <>
                            <div className="divide-y divide-[#1c2228]">
                                {profiles.map((profile) => (
                                    <ProfileResult
                                        key={profile.username}
                                        profile={profile}
                                        isSelf={String(profile.username).toLowerCase() === String(user?.username ?? "").toLowerCase()}
                                    />
                                ))}
                            </div>
                            {(hasMore || status === "error") && (
                                <footer className="flex items-center justify-between gap-3 border-t border-[#262c33] px-4 py-3">
                                    <p className="text-xs text-slate-500">Showing {profiles.length} of {totalProfiles}</p>
                                    {hasMore ? (
                                        <button
                                            type="button"
                                            onClick={() => void loadResults(page + 1, true)}
                                            disabled={status === "loading-more"}
                                            className="hud-btn hud-btn--auto text-sm font-bold disabled:cursor-wait"
                                        >
                                            {status === "loading-more" ? "Loading..." : "See more"}
                                        </button>
                                    ) : (
                                        <p className="text-sm text-rose-300" role="alert">More profiles could not be loaded.</p>
                                    )}
                                </footer>
                            )}
                        </>
                    )}
                </section>
            </section>
        </main>
    );
}

function SearchLoading() {
    return (
        <div className="flex items-center justify-center py-16" aria-busy="true" aria-label="Loading profile search">
            <SpinningBotFace />
        </div>
    );
}

function joinedLabel(joinedAt) {
    const date = joinedAt ? new Date(joinedAt) : null;
    if (!date || Number.isNaN(date.getTime())) return null;
    return `joined ${date.toLocaleDateString("en-US", { month: "short", year: "numeric" })}`;
}

function ProfileResult({ profile, isSelf }) {
    const matches = Number(profile.onesMatches);
    const hasMatches = Number.isFinite(matches) && matches > 0;
    const elo = Number.isFinite(Number(profile.elo)) && profile.elo !== null ? Number(profile.elo) : DEFAULT_ELO;
    const summary = [
        Number.isFinite(matches) ? (hasMatches ? `${matches} 1v1 ${matches === 1 ? "match" : "matches"}` : "No 1v1 matches yet") : null,
        joinedLabel(profile.joinedAt),
    ].filter(Boolean).join(" · ");
    return (
        <Link
            to={`/profile/${encodeURIComponent(profile.username)}`}
            className="flex min-h-14 items-center gap-3 px-4 py-2.5 transition hover:bg-[#151c22] focus:bg-[#151c22] focus:outline-none focus:ring-2 focus:ring-inset focus:ring-cyan-400"
        >
            <PlayerAvatar name={profile.username} size={36} />
            <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-semibold text-slate-100">
                    {profile.username}
                    {isSelf && <span className="ml-2 text-[10px] font-bold text-cyan-300">YOU</span>}
                </span>
                {summary && <span className="block truncate text-xs text-slate-500">{summary}</span>}
            </span>
            <span className="shrink-0 text-right leading-tight">
                <span className="block font-display text-sm text-cyan-300">{elo}</span>
                <span className="block text-[10px] text-slate-500">1v1 ELO</span>
            </span>
            <svg viewBox="0 0 24 24" className="h-4 w-4 shrink-0 fill-none stroke-slate-500" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m9 6 6 6-6 6" /></svg>
        </Link>
    );
}
