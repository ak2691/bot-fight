import { useCallback, useEffect, useRef, useState } from "react";
import { useAuth } from "../../auth/auth-context";
import { userFacingAuthError, usernameError } from "../../auth/validation";
import { apiUrl } from "../../config/api";
import AppNavbar from "../../components/AppNavbar";
import { useDialogFocus } from "../../components/useDialogFocus.js";
import { useNavigate, useParams } from "react-router-dom";

const RECENT_MATCH_LIMIT = 5;

const resultTone = {
    WIN: "border-emerald-400/60 bg-emerald-950/30 text-emerald-300",
    LOSS: "border-rose-400/60 bg-rose-950/30 text-rose-300",
    DRAW: "border-amber-400/60 bg-amber-950/30 text-amber-300",
};

function formatMatchDate(value) {
    if (!value) return "Date unavailable";
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return "Date unavailable";
    return new Intl.DateTimeFormat(undefined, {
        month: "short",
        day: "numeric",
        year: date.getFullYear() === new Date().getFullYear() ? undefined : "numeric",
        hour: "numeric",
        minute: "2-digit",
    }).format(date);
}

function formatJoinedDate(value) {
    if (!value) return "Date unavailable";
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return "Date unavailable";
    return new Intl.DateTimeFormat(undefined, {
        month: "short",
        day: "numeric",
        year: "numeric",
    }).format(date);
}

function profileUrl(username) {
    return username
        ? apiUrl(`/api/profile/users/${encodeURIComponent(username)}`)
        : apiUrl("/api/profile");
}

function historyUrl(page, username) {
    const path = username
        ? `/api/profile/users/${encodeURIComponent(username)}/matches`
        : "/api/profile/matches";
    return apiUrl(`${path}?page=${page}`);
}

function appendUniqueMatches(current, next) {
    const seen = new Set(current.map((match) => match.matchId));
    return [...current, ...next.filter((match) => !seen.has(match.matchId))];
}

export default function ProfilePage() {
    const { user, updateUsername, updateAboutMe } = useAuth();
    const navigate = useNavigate();
    const { username: routeUsername } = useParams();
    const viewedUsername = routeUsername?.trim() || null;
    const isOwner = !viewedUsername;
    const [profile, setProfile] = useState(null);
    const [matches, setMatches] = useState([]);
    const [historyPage, setHistoryPage] = useState(0);
    const [hasMore, setHasMore] = useState(false);
    const [totalMatches, setTotalMatches] = useState(0);
    const [historyStatus, setHistoryStatus] = useState("loading");
    const [googleLinked, setGoogleLinked] = useState(false);
    const [googleStatus, setGoogleStatus] = useState("loading");
    const [status, setStatus] = useState("loading");
    const [isMatchesModalOpen, setIsMatchesModalOpen] = useState(false);
    const profileRequestRef = useRef(0);
    const historyRequestRef = useRef(0);

    const loadProfile = useCallback(async () => {
        const profileRequestId = ++profileRequestRef.current;
        const historyRequestId = ++historyRequestRef.current;
        setStatus("loading");
        setHistoryStatus("loading");
        try {
            const [profileResponse, historyResponse, googleResponse] = await Promise.all([
                fetch(profileUrl(viewedUsername), { credentials: "include" }),
                fetch(historyUrl(0, viewedUsername), { credentials: "include" }),
                isOwner
                    ? fetch(apiUrl("/api/auth/google/status"), { credentials: "include" })
                    : Promise.resolve(null),
            ]);
            if (!profileResponse.ok || !historyResponse.ok || (isOwner && !googleResponse?.ok)) {
                throw new Error("profile request failed");
            }
            const [nextProfile, history, google] = await Promise.all([
                profileResponse.json(),
                historyResponse.json(),
                googleResponse ? googleResponse.json() : Promise.resolve(null),
            ]);
            if (profileRequestId !== profileRequestRef.current || historyRequestId !== historyRequestRef.current) return;
            setProfile(nextProfile);
            setMatches(Array.isArray(history.matches) ? history.matches : []);
            setHistoryPage(history.page ?? 0);
            setHasMore(history.hasMore === true);
            setTotalMatches(history.totalMatches ?? 0);
            setGoogleLinked(google?.linked === true);
            setGoogleStatus(isOwner ? "ready" : "unavailable");
            setHistoryStatus("ready");
            setStatus("ready");
        } catch {
            if (profileRequestId !== profileRequestRef.current || historyRequestId !== historyRequestRef.current) return;
            setHistoryStatus("error");
            setStatus("error");
        }
    }, [isOwner, viewedUsername]);

    const requestHistory = useCallback(async (page, append) => {
        const historyRequestId = ++historyRequestRef.current;
        setHistoryStatus(append ? "loading-more" : "loading");
        try {
            const response = await fetch(historyUrl(page, viewedUsername), { credentials: "include" });
            if (!response.ok) throw new Error("history request failed");
            const history = await response.json();
            if (historyRequestId !== historyRequestRef.current) return;
            setMatches((current) => append
                ? appendUniqueMatches(current, Array.isArray(history.matches) ? history.matches : [])
                : (Array.isArray(history.matches) ? history.matches : []));
            setHistoryPage(history.page ?? page);
            setHasMore(history.hasMore === true);
            setTotalMatches(history.totalMatches ?? 0);
            setHistoryStatus("ready");
        } catch {
            if (historyRequestId !== historyRequestRef.current) return;
            setHistoryStatus("error");
        }
    }, [viewedUsername]);

    useEffect(() => {
        void loadProfile();
    }, [loadProfile]);

    const saveUsername = useCallback(async (username) => {
        const updatedProfile = await updateUsername({ username });
        setProfile((current) => current ? { ...current, username: updatedProfile.username } : current);
        return updatedProfile;
    }, [updateUsername]);

    const saveAboutMe = useCallback(async (aboutMe) => {
        const updatedProfile = await updateAboutMe({ aboutMe });
        setProfile((current) => current ? { ...current, aboutMe: updatedProfile.aboutMe } : current);
        return updatedProfile;
    }, [updateAboutMe]);

    return (
        <main className="home-grid min-h-screen bg-[#050d16] font-interface text-slate-100">
            <AppNavbar account currentPage="profile" />

            <section className="relative z-[1] mx-auto w-full max-w-[1180px] px-5 py-10 sm:px-8 sm:py-12">
                <div className="max-w-3xl">

                    <ProfileSearchBar onSearch={(query) => navigate(`/profile/search?query=${encodeURIComponent(query)}`)} />
                </div>

                {status === "loading" && <ProfileLoading username={viewedUsername ?? user?.username} />}
                {status === "error" && <ProfileError onRetry={loadProfile} />}
                {status === "ready" && profile && (
                    <ProfileContent
                        profile={profile}
                        matches={matches}
                        totalMatches={totalMatches}
                        historyStatus={historyStatus}
                        googleLinked={googleLinked}
                        googleStatus={googleStatus}
                        isOwner={isOwner}
                        onUsernameSaved={saveUsername}
                        onAboutMeSaved={saveAboutMe}
                        onOpenMatches={() => setIsMatchesModalOpen(true)}
                    />
                )}
            </section>

            {isMatchesModalOpen && (
                <MatchesModal
                    matches={matches}
                    totalMatches={totalMatches}
                    historyStatus={historyStatus}
                    hasMore={hasMore}
                    onLoadMore={() => void requestHistory(historyPage + 1, true)}
                    onClose={() => setIsMatchesModalOpen(false)}
                />
            )}
        </main>
    );
}

function ProfileLoading({ username }) {
    return (
        <div className="mt-9 grid gap-5 lg:grid-cols-[minmax(240px,.85fr)_minmax(0,1.6fr)]" aria-busy="true" aria-label="Loading profile">
            <div className="h-96 animate-pulse rounded-2xl border border-slate-700/70 bg-[#0b1722cc] p-7">
                <div className="h-20 w-20 rounded-full bg-slate-700/70" />
                <div className="mt-6 h-5 w-36 rounded bg-slate-700/70" />
                <p className="mt-3 text-sm text-slate-500">{username ? `Loading ${username}'s profile...` : "Loading player profile..."}</p>
            </div>
            <div className="space-y-5">
                <div className="h-80 animate-pulse rounded-2xl border border-slate-700/70 bg-[#0b1722cc]" />
                <div className="h-44 animate-pulse rounded-2xl border border-slate-700/70 bg-[#0b1722cc]" />
            </div>
        </div>
    );
}

function ProfileError({ onRetry }) {
    return (
        <div className="mx-auto mt-10 max-w-xl rounded-2xl border border-rose-400/30 bg-[#130f18e8] px-7 py-10 text-center shadow-[0_20px_60px_rgba(0,0,0,.3)]">
            <div className="mx-auto grid h-12 w-12 place-items-center rounded-full border border-rose-400/50 bg-rose-950/30 font-mono text-xl text-rose-300">!</div>
            <h2 className="mt-5 text-2xl font-bold text-white">Profile data unavailable</h2>
            <p className="mt-2 text-sm leading-6 text-slate-400">The server could not load your profile record. Your results are safe; try the request again.</p>
            <button type="button" onClick={onRetry} className="mt-6 border border-cyan-400/50 bg-cyan-950/30 px-5 py-2.5 font-bold text-cyan-200 hover:border-cyan-300">
                Try again
            </button>
        </div>
    );
}

function ProfileSearchBar({ onSearch }) {
    const [query, setQuery] = useState("");

    const handleSubmit = (event) => {
        event.preventDefault();
        const normalizedQuery = query.trim();
        if (normalizedQuery) onSearch(normalizedQuery);
    };

    return (
        <form onSubmit={handleSubmit} className="mt-6 max-w-xl" role="search">
            <label htmlFor="profile-search" className="block">
                <span className="font-mono text-[10px] font-bold tracking-[.18em] text-slate-500">FIND A PLAYER</span>
                <div className="mt-2 flex flex-col gap-2 sm:flex-row">
                    <input
                        id="profile-search"
                        name="query"
                        type="search"
                        value={query}
                        onChange={(event) => setQuery(event.target.value)}
                        maxLength={50}
                        placeholder="Search by username"
                        autoComplete="off"
                        className="h-11 min-w-0 flex-1 rounded-lg border border-slate-700 bg-[#07111b] px-4 text-sm text-white outline-none placeholder:text-slate-600 focus:border-cyan-400/70"
                    />
                    <button
                        type="submit"
                        className="h-11 border border-cyan-400/50 bg-cyan-950/30 px-5 text-sm font-bold text-cyan-200 hover:border-cyan-300"
                    >
                        Search
                    </button>
                </div>
            </label>
        </form>
    );
}

function ProfileContent({
    profile,
    matches,
    totalMatches,
    historyStatus,
    googleLinked,
    googleStatus,
    isOwner,
    onUsernameSaved,
    onAboutMeSaved,
    onOpenMatches,
}) {
    const initial = String(profile.username || "?").slice(0, 1).toUpperCase();
    return (
        <div className="mt-9 grid gap-5 lg:grid-cols-[minmax(240px,.85fr)_minmax(0,1.6fr)] lg:items-start">
            <section className="rounded-2xl border border-cyan-800/80 bg-[linear-gradient(145deg,rgba(12,28,42,.94),rgba(6,16,26,.97))] p-6 shadow-[0_18px_60px_rgba(0,0,0,.28)] sm:p-8">
                <div className="flex items-center gap-5">
                    <div className="grid h-20 w-20 flex-none place-items-center rounded-full border border-cyan-400/70 bg-cyan-950/40 text-3xl font-bold text-cyan-300 shadow-[inset_0_0_24px_rgba(34,211,238,.1)]">
                        {initial}
                    </div>
                    <div className="min-w-0">
                        <p className="font-mono text-[10px] tracking-[.2em] text-slate-500">USERNAME</p>
                        <h2 className="mt-1 break-words text-2xl font-bold text-white">{profile.username}</h2>
                    </div>
                </div>

                <dl className="mt-8 divide-y divide-cyan-900/70 border-y border-cyan-900/70">
                    <Stat label="Matches played" value={profile.matchesPlayed} tone="text-white" />
                    <Stat label="Wins" value={profile.wins} tone="text-emerald-300" />
                    <Stat label="Losses" value={profile.losses} tone="text-rose-300" />
                    <Stat label="Draws" value={profile.draws} tone="text-amber-300" />
                </dl>

                <div className="mt-7 border-t border-cyan-900/70 pt-5">
                    <p className="font-mono text-[10px] font-bold uppercase tracking-[.18em] text-slate-500">Joined</p>
                    <time className="mt-2 block text-sm font-semibold text-slate-200" dateTime={profile.joinedAt ?? undefined}>
                        {formatJoinedDate(profile.joinedAt)}
                    </time>
                </div>

                {isOwner && <UsernameEditor username={profile.username} onSave={onUsernameSaved} />}

                {isOwner && (
                    <div className="mt-7 border-t border-cyan-900/70 pt-5">
                        <p className="font-mono text-[10px] font-bold tracking-[.18em] text-cyan-400">CONNECTED SIGN-IN</p>
                        <h2 className="mt-2 text-lg font-bold text-white">Google account</h2>
                        <p className="mt-1 text-sm leading-6 text-slate-400">
                            {googleLinked ? "Linked for sign-in." : "Link Google to use either sign-in method."}
                        </p>
                        {googleStatus === "ready" && (
                            googleLinked ? (
                                <span className="mt-4 inline-flex rounded border border-emerald-400/40 bg-emerald-950/30 px-3 py-2 text-xs font-bold text-emerald-300">Linked</span>
                            ) : (
                                <button
                                    type="button"
                                    onClick={() => window.location.assign(apiUrl("/api/auth/google/link"))}
                                    className="mt-4 border border-cyan-400/50 bg-cyan-950/30 px-4 py-2.5 text-xs font-bold text-cyan-200 hover:border-cyan-300"
                                >
                                    Link Google account
                                </button>
                            )
                        )}
                    </div>
                )}
            </section>

            <div className="min-w-0 space-y-5">
                <RecentMatchesCard
                    matches={matches}
                    totalMatches={totalMatches}
                    historyStatus={historyStatus}
                    isOwner={isOwner}
                    onOpenMatches={onOpenMatches}
                />
                <AboutMeCard aboutMe={profile.aboutMe} editable={isOwner} onSave={onAboutMeSaved} />
            </div>
        </div>
    );
}

function RecentMatchesCard({ matches, totalMatches, historyStatus, isOwner, onOpenMatches }) {
    const previewMatches = matches.slice(0, RECENT_MATCH_LIMIT);
    const isInitialError = historyStatus === "error" && matches.length === 0;
    return (
        <section className="overflow-hidden rounded-2xl border border-cyan-900/80 bg-[#091521ed] shadow-[0_18px_60px_rgba(0,0,0,.24)]">
            <div className="flex flex-col gap-4 border-b border-slate-700/70 px-6 py-5 sm:flex-row sm:items-start sm:justify-between sm:px-8">
                <div>
                    <h2 className="mt-2 text-2xl font-bold text-white">Recent matches</h2>
                </div>
                <button
                    type="button"
                    onClick={onOpenMatches}
                    className="w-full flex-none border border-cyan-400/50 bg-cyan-950/30 px-4 py-2.5 text-sm font-bold text-cyan-200 hover:border-cyan-300 sm:w-auto"
                >
                    View All Matches
                </button>
            </div>

            <div className="divide-y divide-slate-800">
                {historyStatus === "loading" ? (
                    <div className="space-y-px" aria-label="Loading recent matches" aria-busy="true">
                        {Array.from({ length: 4 }, (_, index) => <div key={index} className="h-20 animate-pulse bg-slate-800/20" />)}
                    </div>
                ) : isInitialError ? (
                    <div className="px-6 py-10 text-center">
                        <p className="text-sm text-rose-300">Recent matches could not be loaded.</p>
                    </div>
                ) : previewMatches.length === 0 ? (
                    <p className="px-6 py-12 text-center text-sm text-slate-500">
                        {isOwner ? "Your completed matches will appear here." : "This player's completed matches will appear here."}
                    </p>
                ) : (
                    previewMatches.map((match) => <MatchRow key={match.matchId} match={match} />)
                )}
            </div>

            {historyStatus !== "loading" && !isInitialError && (
                <div className="border-t border-slate-800 px-6 py-4 sm:px-8">
                    <p className="font-mono text-[10px] tracking-wider text-slate-500">
                        {totalMatches} TOTAL MATCHES

                    </p>
                </div>
            )}
        </section>
    );
}

function MatchRow({ match }) {
    return (
        <article className="grid min-w-0 gap-3 px-6 py-4 sm:grid-cols-[minmax(0,1fr)_auto_auto] sm:items-center sm:px-8">
            <div className="min-w-0">
                <p className="text-[10px] font-bold uppercase tracking-wider text-slate-500">Opponent</p>
                <p className="mt-1 break-words font-semibold text-slate-100">{match.opponentUsername}</p>
            </div>
            <span className={`w-fit rounded-lg border px-3 py-1 font-mono text-xs font-bold tracking-wider ${resultTone[match.result] ?? resultTone.DRAW}`}>
                {match.result}
            </span>
            <time className="text-sm text-slate-400 sm:text-right" dateTime={match.completedAt ?? undefined}>
                {formatMatchDate(match.completedAt)}
            </time>
        </article>
    );
}

function AboutMeCard({ aboutMe, editable, onSave }) {
    const [isEditing, setIsEditing] = useState(false);
    const [draft, setDraft] = useState(aboutMe ?? "");
    const [error, setError] = useState(null);
    const [isSaving, setIsSaving] = useState(false);

    useEffect(() => {
        setDraft(aboutMe ?? "");
    }, [aboutMe]);

    const handleSubmit = async (event) => {
        event.preventDefault();
        setError(null);
        setIsSaving(true);
        try {
            await onSave(draft);
            setIsEditing(false);
        } catch (submissionError) {
            setError(userFacingAuthError(submissionError, "About Me could not be saved. Try again."));
        } finally {
            setIsSaving(false);
        }
    };

    return (
        <section className="rounded-2xl border border-slate-700/80 bg-[#091521ed] p-6 shadow-[0_18px_60px_rgba(0,0,0,.2)] sm:p-8">
            <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                <div>
                    <p className="font-mono text-[10px] font-bold tracking-[.2em] text-cyan-400">PLAYER NOTE</p>
                    <h2 className="mt-2 text-2xl font-bold text-white">About Me</h2>
                </div>
                {editable && !isEditing && (
                    <button
                        type="button"
                        onClick={() => { setError(null); setIsEditing(true); }}
                        className="w-full border border-slate-600 bg-slate-900/40 px-4 py-2.5 text-sm font-bold text-slate-200 hover:border-cyan-400/60 hover:text-cyan-200 sm:w-auto"
                    >
                        Edit About Me
                    </button>
                )}
            </div>

            {!editable || !isEditing ? (
                <p className="mt-6 whitespace-pre-wrap break-words text-sm leading-7 text-slate-300">
                    {aboutMe ? aboutMe : <span className="text-slate-500">No About Me added yet.</span>}
                </p>
            ) : (
                <form onSubmit={handleSubmit} className="mt-6">
                    <label htmlFor="profile-about-me" className="block">
                        <span className="sr-only">About Me</span>
                        <textarea
                            id="profile-about-me"
                            name="aboutMe"
                            value={draft}
                            onChange={(event) => setDraft(event.target.value)}
                            maxLength={500}
                            rows={6}
                            aria-invalid={Boolean(error)}
                            aria-describedby={error ? "profile-about-me-error" : "profile-about-me-help"}
                            className="w-full resize-y rounded-lg border border-slate-700 bg-[#07111b] px-4 py-3 text-sm leading-6 text-white outline-none focus:border-cyan-400/70"
                        />
                    </label>
                    <div className="mt-3 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                        <p id={error ? "profile-about-me-error" : "profile-about-me-help"} className={`text-xs ${error ? "text-rose-300" : "text-slate-500"}`} role={error ? "alert" : undefined}>
                            {error ?? `${draft.length}/500 characters · Plain text only`}
                        </p>
                        <div className="flex gap-2">
                            <button type="submit" disabled={isSaving} className="h-11 border border-cyan-400/50 bg-cyan-950/30 px-4 text-sm font-bold text-cyan-200 hover:border-cyan-300 disabled:opacity-50">
                                {isSaving ? "Saving..." : "Save"}
                            </button>
                            <button type="button" onClick={() => { setDraft(aboutMe ?? ""); setError(null); setIsEditing(false); }} className="h-11 border border-slate-600 bg-slate-900/40 px-4 text-sm text-slate-300">
                                Cancel
                            </button>
                        </div>
                    </div>
                </form>
            )}
        </section>
    );
}

function MatchesModal({ matches, totalMatches, historyStatus, hasMore, onLoadMore, onClose }) {
    const dialogRef = useRef(null);
    const closeButtonRef = useRef(null);
    const isLoadingMore = historyStatus === "loading-more";
    const isIncrementalError = historyStatus === "error" && matches.length > 0;

    useDialogFocus(dialogRef, { initialFocusRef: closeButtonRef, onClose, lockScroll: true });

    const handleMatchesScroll = (event) => {
        if (!hasMore || historyStatus !== "ready") return;
        const scrollContainer = event.currentTarget;
        const distanceFromBottom = scrollContainer.scrollHeight
            - scrollContainer.scrollTop
            - scrollContainer.clientHeight;
        if (distanceFromBottom <= 24) onLoadMore();
    };

    return (
        <div
            className="fixed inset-0 z-50 grid place-items-center bg-[#02070de8] p-4 backdrop-blur-sm"
            onMouseDown={(event) => {
                if (event.target === event.currentTarget) onClose();
            }}
        >
            <section
                ref={dialogRef}
                className="flex max-h-[min(86vh,54rem)] w-[min(48rem,calc(100vw-2rem))] flex-col overflow-hidden rounded-2xl border border-cyan-400/50 bg-[#071521] shadow-[0_24px_90px_rgba(0,0,0,.6)]"
                role="dialog"
                aria-modal="true"
                aria-labelledby="match-history-modal-title"
                tabIndex={-1}
            >
                <header className="flex items-start justify-between gap-5 border-b border-slate-700/80 px-6 py-5 sm:px-8">
                    <div>
                        <h2 id="match-history-modal-title" className="mt-2 text-2xl font-bold text-white">All Matches</h2>
                        <p className="mt-1 text-sm text-slate-500">Showing {matches.length} of {totalMatches}, newest first.</p>
                    </div>
                    <button ref={closeButtonRef} type="button" onClick={onClose} aria-label="Close all matches" className="grid h-10 w-10 flex-none place-items-center border border-slate-600 bg-slate-900/50 text-xl text-slate-300 hover:border-cyan-400/70 hover:text-cyan-200">
                        <span aria-hidden="true">×</span>
                    </button>
                </header>

                <div
                    className="min-h-0 overflow-y-auto divide-y divide-slate-800"
                    onScroll={handleMatchesScroll}
                    aria-live="polite"
                >
                    {historyStatus === "loading" && matches.length === 0 ? (
                        <div className="space-y-px" aria-busy="true" aria-label="Loading matches">
                            {Array.from({ length: 5 }, (_, index) => <div key={index} className="h-20 animate-pulse bg-slate-800/20" />)}
                        </div>
                    ) : matches.length === 0 ? (
                        <p className="px-6 py-14 text-center text-sm text-slate-500">No completed matches yet.</p>
                    ) : (
                        matches.map((match) => <MatchRow key={match.matchId} match={match} />)
                    )}
                </div>

                <footer className="flex flex-col gap-3 border-t border-slate-700/80 px-6 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-8">
                    {isLoadingMore ? (
                        <p className="text-xs text-slate-500" role="status">Loading more matches...</p>
                    ) : isIncrementalError ? (
                        <p className="text-sm text-rose-300" role="alert">More matches could not be loaded. Your loaded matches are still visible.</p>
                    ) : hasMore ? (
                        <p className="text-xs text-slate-500">Scroll to the bottom to load more matches.</p>
                    ) : (
                        <p className="text-xs text-slate-500">All available matches are loaded.</p>
                    )}
                    {isIncrementalError && (
                        <button type="button" onClick={onLoadMore} className="w-full border border-cyan-400/50 bg-cyan-950/30 px-5 py-2.5 text-sm font-bold text-cyan-200 hover:border-cyan-300 sm:w-auto">
                            Try again
                        </button>
                    )}
                </footer>
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
            setError(userFacingAuthError(submissionError, "That username could not be saved. Choose another and try again."));
        } finally {
            setIsSaving(false);
        }
    };

    return (
        <div className="mt-7 border-t border-cyan-900/70 pt-5">
            {!isEditing ? (
                <button type="button" onClick={() => { setError(null); setIsEditing(true); }} className="min-h-11 border border-cyan-400/50 bg-cyan-950/30 px-4 py-2 text-sm font-bold text-cyan-200 hover:border-cyan-300">
                    Change username
                </button>
            ) : (
                <form onSubmit={handleSubmit} className="flex flex-col gap-3">
                    <label htmlFor="profile-username" className="block min-w-0">
                        <span className="text-[10px] font-bold uppercase tracking-wider text-slate-500">New username</span>
                        <input
                            id="profile-username"
                            name="username"
                            type="text"
                            value={draft}
                            onChange={(event) => setDraft(event.target.value)}
                            maxLength={20}
                            pattern="[A-Za-z0-9_-]+"
                            autoComplete="username"
                            autoFocus
                            required
                            aria-invalid={Boolean(error)}
                            aria-describedby={error ? "profile-username-error" : "profile-username-help"}
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
            {error && <p id="profile-username-error" className="form-error mt-2 text-sm text-rose-300" role="alert">{error}</p>}
            {!error && isEditing && <p id="profile-username-help" className="mt-2 text-xs text-slate-500">3–20 characters: letters, numbers, underscores, and hyphens only.</p>}
        </div>
    );
}

function Stat({ label, value, tone }) {
    return (
        <div className="flex items-center justify-between gap-4 py-2.5">
            <dt className="text-sm text-slate-400">{label}:</dt>
            <dd className={`font-interface-numeric text-xl ${tone}`}>{value}</dd>
        </div>
    );
}
