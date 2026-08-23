import { useCallback, useEffect, useRef, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import AppNavbar from "../../components/AppNavbar";
import SpinningBotFace from "../../components/SpinningBotFace.jsx";
import { apiUrl } from "../../config/api";

const MAX_QUERY_LENGTH = 50;

function searchUrl(query, page) {
    const params = new URLSearchParams({ query, page: String(page) });
    return apiUrl(`/api/profile/search?${params.toString()}`);
}

function appendUniqueProfiles(current, next) {
    const seen = new Set(current.map((profile) => String(profile.username ?? "").toLowerCase()));
    return [...current, ...next.filter((profile) => !seen.has(String(profile.username ?? "").toLowerCase()))];
}

export default function ProfileSearchPage() {
    const [searchParams] = useSearchParams();
    const navigate = useNavigate();
    const query = (searchParams.get("query") ?? "").trim().slice(0, MAX_QUERY_LENGTH);
    const [profiles, setProfiles] = useState([]);
    const [page, setPage] = useState(0);
    const [hasMore, setHasMore] = useState(false);
    const [totalProfiles, setTotalProfiles] = useState(0);
    const [status, setStatus] = useState(query ? "loading" : "empty");
    const requestRef = useRef(0);

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

    return (
        <main className="min-h-screen bg-[#171a1c] font-interface text-slate-100">
            <AppNavbar account currentPage="profile" />

            <section className="relative z-[1] mx-auto w-full max-w-[980px] px-5 py-10 sm:px-8 sm:py-12">
                <div className="flex flex-col gap-5 sm:flex-row sm:items-end sm:justify-between">
                    <div>
                        <p className="font-mono text-[11px] font-bold tracking-[.3em] text-cyan-400">PLAYER SEARCH</p>
                        <h1 className="mt-3 text-4xl font-bold tracking-tight text-white sm:text-5xl">Search results</h1>
                        <p className="mt-3 text-sm text-slate-400 sm:text-base">
                            {query ? <>Profiles matching <span className="font-semibold text-slate-200">&ldquo;{query}&rdquo;</span>.</> : "Search for a username from your profile."}
                        </p>
                    </div>
                    <button
                        type="button"
                        onClick={() => navigate("/profile")}
                        className="profile-toolbar-button w-full text-sm font-bold sm:w-auto"
                    >
                        Back to my profile
                    </button>
                </div>

                <section className="mt-9 overflow-hidden rounded-2xl border border-cyan-900/80 bg-[#091521ed] shadow-[0_18px_60px_rgba(0,0,0,.24)]" aria-live="polite">
                    {status === "empty" ? (
                        <p className="px-6 py-14 text-center text-sm text-slate-500">Enter a username to search for players.</p>
                    ) : status === "loading" && profiles.length === 0 ? (
                        <SearchLoading />
                    ) : status === "error" && profiles.length === 0 ? (
                        <div className="px-6 py-14 text-center">
                            <p className="text-sm text-rose-300" role="alert">Profiles could not be loaded.</p>
                            <button
                                type="button"
                                onClick={() => void loadResults(0, false)}
                                className="profile-toolbar-button profile-toolbar-button--blue mt-5 text-sm font-bold"
                            >
                                Try again
                            </button>
                        </div>
                    ) : profiles.length === 0 ? (
                        <p className="px-6 py-14 text-center text-sm text-slate-500">No profiles match that username.</p>
                    ) : (
                        <>
                            <div className="divide-y divide-slate-800">
                                {profiles.map((profile) => <ProfileResult key={profile.username} profile={profile} />)}
                            </div>
                            <footer className="flex flex-col gap-3 border-t border-slate-700/80 px-6 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-8">
                                <p className="text-xs text-slate-500">
                                    Showing {profiles.length} of {totalProfiles} matching profiles.
                                </p>
                                {hasMore ? (
                                    <button
                                        type="button"
                                        onClick={() => void loadResults(page + 1, true)}
                                        disabled={status === "loading-more"}
                                        className="profile-toolbar-button profile-toolbar-button--blue w-full text-sm font-bold disabled:cursor-wait sm:w-auto"
                                    >
                                        {status === "loading-more" ? "Loading..." : "See more"}
                                    </button>
                                ) : status === "error" ? (
                                    <p className="text-sm text-rose-300" role="alert">More profiles could not be loaded.</p>
                                ) : (
                                    <p className="text-xs text-slate-500">All matching profiles are shown.</p>
                                )}
                            </footer>
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

function ProfileResult({ profile }) {
    const initial = String(profile.username || "?").slice(0, 1).toUpperCase();
    return (
        <Link
            to={`/profile/${encodeURIComponent(profile.username)}`}
            className="flex items-center gap-4 px-6 py-4 transition hover:bg-cyan-950/20 focus:bg-cyan-950/20 focus:outline-none focus:ring-2 focus:ring-inset focus:ring-cyan-400 sm:px-8"
        >
            <span className="grid h-12 w-12 flex-none place-items-center rounded-full border border-cyan-400/60 bg-cyan-950/40 text-lg font-bold text-cyan-300">
                {initial}
            </span>
            <span className="min-w-0 flex-1">
                <span className="block break-words font-semibold text-slate-100">{profile.username}</span>
                <span className="mt-1 block text-xs text-slate-500">Open profile</span>
            </span>
            <span aria-hidden="true" className="text-xl text-cyan-400">&rarr;</span>
        </Link>
    );
}
