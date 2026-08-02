import { useCallback, useEffect, useState } from "react";
import { useAuth } from "../auth/auth-context";
import { usernameError } from "../auth/validation";
import { apiUrl } from "../config/api";
import AppNavbar from "../components/AppNavbar";

const resultTone = {
    WIN: "border-emerald-400/60 bg-emerald-950/30 text-emerald-300",
    LOSS: "border-rose-400/60 bg-rose-950/30 text-rose-300",
    DRAW: "border-amber-400/60 bg-amber-950/30 text-amber-300",
};

function formatMatchDate(value) {
    if (!value) return "Recently";
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return "Recently";
    return new Intl.DateTimeFormat(undefined, {
        month: "short",
        day: "numeric",
        year: date.getFullYear() === new Date().getFullYear() ? undefined : "numeric",
    }).format(date);
}

function historyUrl(page, filters) {
    const params = new URLSearchParams({ page: String(page) });
    const query = filters.query.trim();
    if (query) params.set("query", query);
    if (filters.from) {
        params.set("from", new Date(`${filters.from}T00:00:00`).toISOString());
    }
    if (filters.to) {
        const exclusiveEnd = new Date(`${filters.to}T00:00:00`);
        exclusiveEnd.setDate(exclusiveEnd.getDate() + 1);
        params.set("to", exclusiveEnd.toISOString());
    }
    return apiUrl(`/api/profile/matches?${params.toString()}`);
}

const emptyFilters = { query: "", from: "", to: "" };

export default function ProfilePage() {
    const { user, updateUsername } = useAuth();
    const [profile, setProfile] = useState(null);
    const [matches, setMatches] = useState([]);
    const [draftFilters, setDraftFilters] = useState(emptyFilters);
    const [activeFilters, setActiveFilters] = useState(emptyFilters);
    const [historyStatus, setHistoryStatus] = useState("loading");
    const [historyPage, setHistoryPage] = useState(0);
    const [hasMore, setHasMore] = useState(false);
    const [filteredTotal, setFilteredTotal] = useState(0);
    const [googleLinked, setGoogleLinked] = useState(false);
    const [googleStatus, setGoogleStatus] = useState("loading");
    const [status, setStatus] = useState("loading");

    const loadProfile = useCallback(async () => {
        setStatus("loading");
        try {
            const [profileResponse, historyResponse] = await Promise.all([
                fetch(apiUrl("/api/profile"), { credentials: "include" }),
                fetch(historyUrl(0, emptyFilters), { credentials: "include" }),
            ]);
            const googleResponse = await fetch(apiUrl("/api/auth/google/status"), { credentials: "include" });
            if (!profileResponse.ok || !historyResponse.ok || !googleResponse.ok) throw new Error("profile request failed");
            const [nextProfile, history, google] = await Promise.all([
                profileResponse.json(),
                historyResponse.json(),
                googleResponse.json(),
            ]);
            setProfile(nextProfile);
            setMatches(history.matches);
            setHistoryPage(0);
            setHasMore(history.hasMore);
            setFilteredTotal(history.totalMatches);
            setGoogleLinked(google.linked === true);
            setGoogleStatus("ready");
            setHistoryStatus("ready");
            setStatus("ready");
        } catch {
            setStatus("error");
        }
    }, []);

    const saveUsername = useCallback(async (username) => {
        const updatedProfile = await updateUsername({ username });
        setProfile((current) => current ? { ...current, username: updatedProfile.username } : current);
        return updatedProfile;
    }, [updateUsername]);

    useEffect(() => {
        void loadProfile();
    }, [loadProfile]);

    const requestHistory = async (page, filters, append) => {
        setHistoryStatus(append ? "loading-more" : "loading");
        try {
            const response = await fetch(historyUrl(page, filters), { credentials: "include" });
            if (!response.ok) throw new Error("history request failed");
            const history = await response.json();
            setMatches((current) => append ? [...current, ...history.matches] : history.matches);
            setHistoryPage(history.page);
            setHasMore(history.hasMore);
            setFilteredTotal(history.totalMatches);
            setHistoryStatus("ready");
        } catch {
            setHistoryStatus("error");
        }
    };

    const applyFilters = (event) => {
        event.preventDefault();
        const filters = {
            query: draftFilters.query.slice(0, 50),
            from: draftFilters.from,
            to: draftFilters.to,
        };
        setActiveFilters(filters);
        void requestHistory(0, filters, false);
    };

    const clearFilters = () => {
        setDraftFilters(emptyFilters);
        setActiveFilters(emptyFilters);
        void requestHistory(0, emptyFilters, false);
    };

    return (
        <main className="home-grid min-h-screen bg-[#050d16] font-interface text-slate-100">
            <AppNavbar account currentPage="profile" />

            <section className="relative z-[1] mx-auto w-full max-w-[1080px] px-5 py-12 sm:px-8">
                <div className="text-center">
                    <p className="font-mono text-[11px] font-bold tracking-[.3em] text-cyan-400">PLAYER RECORD</p>
                    <h1 className="mt-3 text-4xl font-bold tracking-tight text-white sm:text-5xl">Profile &amp; Match History</h1>
                    <p className="mt-3 text-sm text-slate-400 sm:text-base">Your competitive record and latest fights.</p>
                </div>

                {status === "loading" && <ProfileLoading username={user?.username} />}
                {status === "error" && <ProfileError onRetry={loadProfile} />}
                {status === "ready" && profile && (
                    <ProfileContent
                        profile={profile}
                        matches={matches}
                        draftFilters={draftFilters}
                        setDraftFilters={setDraftFilters}
                        activeFilters={activeFilters}
                        historyStatus={historyStatus}
                        hasMore={hasMore}
                        filteredTotal={filteredTotal}
                        googleLinked={googleLinked}
                        googleStatus={googleStatus}
                        onUsernameSaved={saveUsername}
                        onApplyFilters={applyFilters}
                        onClearFilters={clearFilters}
                        onLoadMore={() => void requestHistory(historyPage + 1, activeFilters, true)}
                        onRetry={() => void requestHistory(0, activeFilters, false)}
                    />
                )}
            </section>
        </main>
    );
}

function ProfileLoading({ username }) {
    return (
        <div className="mt-9 space-y-5" aria-busy="true" aria-label="Loading profile">
            <div className="h-40 animate-pulse rounded-2xl border border-slate-700/70 bg-[#0b1722cc] p-7">
                <div className="h-5 w-36 rounded bg-slate-700/70" />
                <p className="mt-3 text-sm text-slate-500">{username ? `Loading ${username}'s record...` : "Loading player record..."}</p>
            </div>
            <div className="h-72 animate-pulse rounded-2xl border border-slate-700/70 bg-[#0b1722cc]" />
        </div>
    );
}

function ProfileError({ onRetry }) {
    return (
        <div className="mx-auto mt-10 max-w-xl rounded-2xl border border-rose-400/30 bg-[#130f18e8] px-7 py-10 text-center shadow-[0_20px_60px_rgba(0,0,0,.3)]">
            <div className="mx-auto grid h-12 w-12 place-items-center rounded-full border border-rose-400/50 bg-rose-950/30 font-mono text-xl text-rose-300">!</div>
            <h2 className="mt-5 text-2xl font-bold text-white">Profile data unavailable</h2>
            <p className="mt-2 text-sm leading-6 text-slate-400">The server could not load your match record. Your results are safe; try the request again.</p>
            <button type="button" onClick={onRetry} className="mt-6 border border-cyan-400/50 bg-cyan-950/30 px-5 py-2.5 font-bold text-cyan-200 hover:border-cyan-300">
                Try again
            </button>
        </div>
    );
}

function ProfileContent({
    profile,
    matches,
    draftFilters,
    setDraftFilters,
    activeFilters,
    historyStatus,
    hasMore,
    filteredTotal,
    googleLinked,
    googleStatus,
    onUsernameSaved,
    onApplyFilters,
    onClearFilters,
    onLoadMore,
    onRetry,
}) {
    const initial = String(profile.username || "?").slice(0, 1).toUpperCase();
    const filtersActive = Boolean(activeFilters.query || activeFilters.from || activeFilters.to);
    return (
        <div className="mt-9 space-y-5">
            <section className="rounded-2xl border border-cyan-800/80 bg-[linear-gradient(145deg,rgba(12,28,42,.94),rgba(6,16,26,.97))] p-6 shadow-[0_18px_60px_rgba(0,0,0,.28)] sm:p-8">
                <div className="grid gap-8 md:grid-cols-[1.35fr_2.65fr] md:items-center">
                    <div className="flex items-center gap-5">
                        <div className="grid h-20 w-20 flex-none place-items-center rounded-full border border-cyan-400/70 bg-cyan-950/40 text-3xl font-bold text-cyan-300 shadow-[inset_0_0_24px_rgba(34,211,238,.1)]">{initial}</div>
                        <div>
                            <p className="font-mono text-[10px] tracking-[.2em] text-slate-500">USERNAME</p>
                            <h2 className="mt-1 break-all text-2xl font-bold text-white">{profile.username}</h2>
                        </div>
                    </div>
                    <dl className="grid grid-cols-2 gap-px overflow-hidden rounded-xl border border-slate-700/70 bg-slate-700/70 sm:grid-cols-4">
                        <Stat label="Matches played" value={profile.matchesPlayed} tone="text-white" />
                        <Stat label="Wins" value={profile.wins} tone="text-emerald-300" />
                        <Stat label="Losses" value={profile.losses} tone="text-rose-300" />
                        <Stat label="Draws" value={profile.draws} tone="text-amber-300" />
                    </dl>
                </div>
                <UsernameEditor username={profile.username} onSave={onUsernameSaved} />
            </section>

            <section className="flex flex-col gap-5 rounded-2xl border border-slate-700/80 bg-[#091521ed] p-6 shadow-[0_18px_60px_rgba(0,0,0,.2)] sm:flex-row sm:items-center sm:justify-between sm:p-8">
                <div>
                    <p className="font-mono text-[10px] font-bold tracking-[.2em] text-cyan-400">CONNECTED SIGN-IN</p>
                    <h2 className="mt-2 text-xl font-bold text-white">Google account</h2>
                    <p className="mt-1 max-w-2xl text-sm leading-6 text-slate-400">
                        {googleLinked
                            ? "Your Google account is linked and can be used to sign in."
                            : "Link Google to this account so you can use either sign-in method."}
                    </p>
                </div>
                {googleStatus === "ready" && (
                    googleLinked ? (
                        <span className="rounded border border-emerald-400/40 bg-emerald-950/30 px-4 py-2 text-sm font-bold text-emerald-300">Linked</span>
                    ) : (
                        <button
                            type="button"
                            onClick={() => window.location.assign(apiUrl("/api/auth/google/link"))}
                            className="border border-cyan-400/50 bg-cyan-950/30 px-5 py-2.5 text-sm font-bold text-cyan-200 hover:border-cyan-300"
                        >
                            Link Google account
                        </button>
                    )
                )}
            </section>

            <section className="overflow-hidden rounded-2xl border border-cyan-900/80 bg-[#091521ed] shadow-[0_18px_60px_rgba(0,0,0,.24)]">
                <div className="border-b border-slate-700/70 px-6 py-5 sm:px-8">
                    <h2 className="text-xl font-bold text-white">Recent matches</h2>
                    <p className="mt-1 text-sm text-slate-500">Showing 20 at a time, newest first.</p>
                    <form onSubmit={onApplyFilters} className="mt-5 grid gap-3 lg:grid-cols-[minmax(220px,1fr)_170px_170px_auto]">
                        <label className="block">
                            <span className="mb-1 block text-[10px] font-bold uppercase tracking-wider text-slate-500">Opponent</span>
                            <input
                                type="search"
                                maxLength={50}
                                value={draftFilters.query}
                                onChange={(event) => setDraftFilters((current) => ({ ...current, query: event.target.value }))}
                                placeholder="Search opponent name"
                                className="h-11 w-full rounded-lg border border-slate-700 bg-[#07111b] px-4 text-sm text-white outline-none placeholder:text-slate-600 focus:border-cyan-400/70"
                            />
                        </label>
                        <label className="block">
                            <span className="mb-1 block text-[10px] font-bold uppercase tracking-wider text-slate-500">From date</span>
                            <input
                                type="date"
                                aria-label="Matches from date"
                                value={draftFilters.from}
                                max={draftFilters.to || undefined}
                                onChange={(event) => setDraftFilters((current) => ({ ...current, from: event.target.value }))}
                                className="h-11 w-full rounded-lg border border-slate-700 bg-[#07111b] px-3 text-sm text-slate-300 outline-none focus:border-cyan-400/70"
                            />
                        </label>
                        <label className="block">
                            <span className="mb-1 block text-[10px] font-bold uppercase tracking-wider text-slate-500">Through date</span>
                            <input
                                type="date"
                                aria-label="Matches through date"
                                value={draftFilters.to}
                                min={draftFilters.from || undefined}
                                onChange={(event) => setDraftFilters((current) => ({ ...current, to: event.target.value }))}
                                className="h-11 w-full rounded-lg border border-slate-700 bg-[#07111b] px-3 text-sm text-slate-300 outline-none focus:border-cyan-400/70"
                            />
                        </label>
                        <div className="flex items-end gap-2 lg:pt-5">
                            <button type="submit" disabled={historyStatus === "loading"} className="h-11 flex-1 border border-cyan-400/50 bg-cyan-950/30 px-4 text-sm font-bold text-cyan-200 hover:border-cyan-300 disabled:opacity-50">
                                Search
                            </button>
                            {filtersActive && (
                                <button type="button" onClick={onClearFilters} className="h-11 border border-slate-600 bg-slate-900/40 px-3 text-sm text-slate-300">
                                    Clear
                                </button>
                            )}
                        </div>
                    </form>
                    <p className="mt-3 font-mono text-[10px] tracking-wider text-slate-500">
                        {historyStatus === "loading" ? "FILTERING MATCHES..." : `${matches.length} OF ${filteredTotal} MATCHES SHOWN`}
                    </p>
                </div>
                <div className="divide-y divide-slate-800">
                    {historyStatus === "error" ? (
                        <div className="px-6 py-10 text-center">
                            <p className="text-sm text-rose-300">The filtered match history could not be loaded.</p>
                            <button type="button" onClick={onRetry} className="mt-4 border border-cyan-400/40 bg-cyan-950/20 px-4 py-2 text-sm font-bold text-cyan-200">Try again</button>
                        </div>
                    ) : historyStatus === "loading" ? (
                        <div className="space-y-px" aria-label="Loading filtered matches" aria-busy="true">
                            {Array.from({ length: 4 }, (_, index) => <div key={index} className="h-20 animate-pulse bg-slate-800/20" />)}
                        </div>
                    ) : matches.length === 0 ? (
                        <p className="px-6 py-10 text-center text-sm text-slate-500">{filtersActive ? "No matches fit these filters." : "Your completed matches will appear here."}</p>
                    ) : matches.map((match) => (
                        <article key={match.matchId} className="grid items-center gap-3 px-6 py-4 sm:grid-cols-[1fr_130px_140px] sm:px-8">
                            <div>
                                <p className="text-xs text-slate-500">Opponent</p>
                                <p className="mt-1 font-semibold text-slate-100">{match.opponentUsername}</p>
                            </div>
                            <span className={`w-fit rounded-lg border px-3 py-1 font-mono text-xs font-bold tracking-wider ${resultTone[match.result] ?? resultTone.DRAW}`}>
                                {match.result}
                            </span>
                            <time className="text-sm text-slate-400 sm:text-right" dateTime={match.completedAt ?? undefined}>{formatMatchDate(match.completedAt)}</time>
                        </article>
                    ))}
                </div>
                {historyStatus !== "loading" && historyStatus !== "error" && hasMore && (
                    <div className="border-t border-slate-800 px-6 py-5 text-center">
                        <button type="button" onClick={onLoadMore} disabled={historyStatus === "loading-more"} className="border border-cyan-400/40 bg-cyan-950/20 px-5 py-2.5 text-sm font-bold text-cyan-200 hover:border-cyan-300 disabled:opacity-50">
                            {historyStatus === "loading-more" ? "Loading..." : "Load 20 more"}
                        </button>
                    </div>
                )}
            </section>
        </div>
    );
}

function UsernameEditor({ username, onSave }) {
    const [isEditing, setIsEditing] = useState(false);
    const [draft, setDraft] = useState(username ?? "");
    const [error, setError] = useState(null);
    const [isSaving, setIsSaving] = useState(false);

    useEffect(() => {
        setDraft(username ?? "");
    }, [username]);

    const handleSubmit = async (event) => {
        event.preventDefault();
        setError(null);
        const validationError = usernameError(draft);
        if (validationError) {
            setError(validationError);
            return;
        }

        setIsSaving(true);
        try {
            await onSave(draft.trim());
            setIsEditing(false);
        } catch (submissionError) {
            setError(submissionError.message);
        } finally {
            setIsSaving(false);
        }
    };

    return (
        <div className="mt-7 border-t border-cyan-900/70 pt-5">
            {!isEditing ? (
                <button type="button" onClick={() => { setError(null); setIsEditing(true); }} className="border border-cyan-400/50 bg-cyan-950/30 px-4 py-2 text-sm font-bold text-cyan-200 hover:border-cyan-300">
                    Change username
                </button>
            ) : (
                <form onSubmit={handleSubmit} className="flex flex-col gap-3 sm:flex-row sm:items-end">
                    <label className="block min-w-0 flex-1">
                        <span className="text-[10px] font-bold uppercase tracking-wider text-slate-500">New username</span>
                        <input
                            value={draft}
                            onChange={(event) => setDraft(event.target.value)}
                            maxLength={20}
                            pattern="[A-Za-z0-9_-]+"
                            autoFocus
                            className="mt-1 h-11 w-full rounded-lg border border-slate-700 bg-[#07111b] px-4 text-sm text-white outline-none focus:border-cyan-400/70"
                        />
                    </label>
                    <div className="flex gap-2">
                        <button type="submit" disabled={isSaving} className="h-11 border border-cyan-400/50 bg-cyan-950/30 px-4 text-sm font-bold text-cyan-200 hover:border-cyan-300 disabled:opacity-50">
                            {isSaving ? "Saving..." : "Save"}
                        </button>
                        <button type="button" onClick={() => { setDraft(username ?? ""); setError(null); setIsEditing(false); }} className="h-11 border border-slate-600 bg-slate-900/40 px-4 text-sm text-slate-300">
                            Cancel
                        </button>
                    </div>
                </form>
            )}
            {error && <p className="mt-2 text-sm text-rose-300">{error}</p>}
            {!error && isEditing && <p className="mt-2 text-xs text-slate-500">3–20 characters: letters, numbers, underscores, and hyphens only.</p>}
        </div>
    );
}

function Stat({ label, value, tone }) {
    return (
        <div className="bg-[#091521] px-4 py-5 text-center">
            <dt className="text-xs text-slate-400">{label}</dt>
            <dd className={`mt-2 font-interface-numeric text-3xl ${tone}`}>{value}</dd>
        </div>
    );
}
