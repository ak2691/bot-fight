import { useCallback, useEffect, useRef, useState } from "react";
import { useAuth } from "../../auth/auth-context";
import { useNotifications } from "../../notifications/notification-context";
import { userFacingAuthError, usernameError } from "../../auth/validation";
import { apiUrl } from "../../config/api";
import { ensureCsrfHeaders } from "../../security/csrf";
import AppNavbar from "../../components/AppNavbar";
import SpinningBotFace from "../../components/SpinningBotFace.jsx";
import { useDialogFocus } from "../../components/useDialogFocus.js";
import { useNavigate, useParams } from "react-router-dom";
import {
    createProfileRetryTokenBucket,
    PROFILE_RETRY_REFILL_INTERVAL_MS,
} from "./profileRetryRateLimit.js";

const RECENT_MATCH_LIMIT = 5;
const DUEL_INVITE_COOLDOWN_MS = 15_000;

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

function solvedPuzzlesUrl(page, username) {
    const path = username
        ? `/api/profile/users/${encodeURIComponent(username)}/puzzles`
        : "/api/profile/puzzles";
    return apiUrl(`${path}?page=${page}`);
}

function appendUniqueMatches(current, next) {
    const seen = new Set(current.map((match) => match.matchId));
    return [...current, ...next.filter((match) => !seen.has(match.matchId))];
}

function appendUniqueSolvedPuzzles(current, next) {
    const seen = new Set(current.map((puzzle) => puzzle.puzzleNumber));
    return [...current, ...next.filter((puzzle) => !seen.has(puzzle.puzzleNumber))];
}

export default function ProfilePage() {
    const { user, updateUsername, updateAboutMe, logout } = useAuth();
    const { hideInvitesFrom } = useNotifications();
    const navigate = useNavigate();
    const { username: routeUsername } = useParams();
    const viewedUsername = routeUsername?.trim() || null;
    const isSelfProfile = Boolean(
        viewedUsername
        && user?.username
        && viewedUsername.toLowerCase() === user.username.toLowerCase(),
    );
    const isOwner = !viewedUsername || isSelfProfile;
    const [profile, setProfile] = useState(null);
    const [matches, setMatches] = useState([]);
    const [historyPage, setHistoryPage] = useState(0);
    const [hasMore, setHasMore] = useState(false);
    const [totalMatches, setTotalMatches] = useState(0);
    const [historyStatus, setHistoryStatus] = useState("loading");
    const [solvedPuzzles, setSolvedPuzzles] = useState([]);
    const [solvedPuzzlesPage, setSolvedPuzzlesPage] = useState(0);
    const [hasMoreSolvedPuzzles, setHasMoreSolvedPuzzles] = useState(false);
    const [totalSolvedPuzzles, setTotalSolvedPuzzles] = useState(0);
    const [solvedPuzzlesStatus, setSolvedPuzzlesStatus] = useState("loading");
    const [googleLinked, setGoogleLinked] = useState(false);
    const [googleStatus, setGoogleStatus] = useState("loading");
    const [status, setStatus] = useState("loading");
    const [isMatchesModalOpen, setIsMatchesModalOpen] = useState(false);
    const [isPuzzlesModalOpen, setIsPuzzlesModalOpen] = useState(false);
    const [isRetryRateLimited, setIsRetryRateLimited] = useState(false);
    const [inviteState, setInviteState] = useState("idle");
    const [inviteError, setInviteError] = useState(null);
    const [blockState, setBlockState] = useState("idle");
    const [blockError, setBlockError] = useState(null);
    const profileRequestRef = useRef(0);
    const historyRequestRef = useRef(0);
    const solvedPuzzlesRequestRef = useRef(0);
    const profileRetryBucketRef = useRef(null);
    const retryRateLimitTimeoutRef = useRef(null);
    const inviteCooldownTimeoutRef = useRef(null);

    if (profileRetryBucketRef.current === null) {
        profileRetryBucketRef.current = createProfileRetryTokenBucket();
    }

    const loadProfile = useCallback(async () => {
        const profileRequestId = ++profileRequestRef.current;
        const historyRequestId = ++historyRequestRef.current;
        const solvedPuzzlesRequestId = ++solvedPuzzlesRequestRef.current;
        const requestUsername = isOwner ? null : viewedUsername;
        setStatus("loading");
        setHistoryStatus("loading");
        setSolvedPuzzlesStatus("loading");
        try {
            const [profileResponse, historyResponse, solvedPuzzlesResponse, googleResponse] = await Promise.all([
                fetch(profileUrl(requestUsername), { credentials: "include" }),
                fetch(historyUrl(0, requestUsername), { credentials: "include" }),
                fetch(solvedPuzzlesUrl(0, requestUsername), { credentials: "include" }),
                isOwner
                    ? fetch(apiUrl("/api/auth/google/status"), { credentials: "include" })
                    : Promise.resolve(null),
            ]);
            if (!profileResponse.ok || !historyResponse.ok || !solvedPuzzlesResponse.ok || (isOwner && !googleResponse?.ok)) {
                throw new Error("profile request failed");
            }
            const [nextProfile, history, solvedPuzzlePage, google] = await Promise.all([
                profileResponse.json(),
                historyResponse.json(),
                solvedPuzzlesResponse.json(),
                googleResponse ? googleResponse.json() : Promise.resolve(null),
            ]);
            if (profileRequestId !== profileRequestRef.current
                || historyRequestId !== historyRequestRef.current
                || solvedPuzzlesRequestId !== solvedPuzzlesRequestRef.current) return;
            setProfile(nextProfile);
            setMatches(Array.isArray(history.matches) ? history.matches : []);
            setHistoryPage(history.page ?? 0);
            setHasMore(history.hasMore === true);
            setTotalMatches(history.totalMatches ?? 0);
            setSolvedPuzzles(Array.isArray(solvedPuzzlePage.puzzles) ? solvedPuzzlePage.puzzles : []);
            setSolvedPuzzlesPage(solvedPuzzlePage.page ?? 0);
            setHasMoreSolvedPuzzles(solvedPuzzlePage.hasMore === true);
            setTotalSolvedPuzzles(solvedPuzzlePage.totalPuzzles ?? 0);
            setGoogleLinked(google?.linked === true);
            setGoogleStatus(isOwner ? "ready" : "unavailable");
            setHistoryStatus("ready");
            setSolvedPuzzlesStatus("ready");
            setStatus("ready");
        } catch {
            if (profileRequestId !== profileRequestRef.current
                || historyRequestId !== historyRequestRef.current
                || solvedPuzzlesRequestId !== solvedPuzzlesRequestRef.current) return;
            setHistoryStatus("error");
            setSolvedPuzzlesStatus("error");
            setStatus("error");
        }
    }, [isOwner, viewedUsername]);

    const requestHistory = useCallback(async (page, append) => {
        const historyRequestId = ++historyRequestRef.current;
        const requestUsername = isOwner ? null : viewedUsername;
        setHistoryStatus(append ? "loading-more" : "loading");
        try {
            const response = await fetch(historyUrl(page, requestUsername), { credentials: "include" });
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
    }, [isOwner, viewedUsername]);

    const requestSolvedPuzzles = useCallback(async (page, append) => {
        const solvedPuzzlesRequestId = ++solvedPuzzlesRequestRef.current;
        const requestUsername = isOwner ? null : viewedUsername;
        setSolvedPuzzlesStatus(append ? "loading-more" : "loading");
        try {
            const response = await fetch(solvedPuzzlesUrl(page, requestUsername), { credentials: "include" });
            if (!response.ok) throw new Error("solved puzzles request failed");
            const solvedPuzzlePage = await response.json();
            if (solvedPuzzlesRequestId !== solvedPuzzlesRequestRef.current) return;
            setSolvedPuzzles((current) => append
                ? appendUniqueSolvedPuzzles(current, Array.isArray(solvedPuzzlePage.puzzles) ? solvedPuzzlePage.puzzles : [])
                : (Array.isArray(solvedPuzzlePage.puzzles) ? solvedPuzzlePage.puzzles : []));
            setSolvedPuzzlesPage(solvedPuzzlePage.page ?? page);
            setHasMoreSolvedPuzzles(solvedPuzzlePage.hasMore === true);
            setTotalSolvedPuzzles(solvedPuzzlePage.totalPuzzles ?? 0);
            setSolvedPuzzlesStatus("ready");
        } catch {
            if (solvedPuzzlesRequestId !== solvedPuzzlesRequestRef.current) return;
            setSolvedPuzzlesStatus("error");
        }
    }, [isOwner, viewedUsername]);

    useEffect(() => {
        void loadProfile();
    }, [loadProfile]);

    useEffect(() => {
        setInviteState("idle");
        setInviteError(null);
        if (inviteCooldownTimeoutRef.current !== null) {
            window.clearTimeout(inviteCooldownTimeoutRef.current);
            inviteCooldownTimeoutRef.current = null;
        }
        setBlockState("idle");
        setBlockError(null);
    }, [viewedUsername]);

    useEffect(() => {
        if (isOwner || !profile?.username) {
            setBlockState("idle");
            setBlockError(null);
            return undefined;
        }

        const controller = new AbortController();
        let mounted = true;
        setBlockState("loading");
        setBlockError(null);
        fetch(apiUrl(`/api/blocks/status/${encodeURIComponent(profile.username)}`), {
            credentials: "include",
            signal: controller.signal,
        })
            .then(async (response) => {
                const body = await response.json().catch(() => ({}));
                if (!response.ok) throw new Error(body.message ?? "Block status could not be loaded.");
                if (mounted) setBlockState(body.blocked === true ? "blocked" : "idle");
            })
            .catch((error) => {
                if (error.name === "AbortError" || !mounted) return;
                setBlockState("error");
                setBlockError(error.message ?? "Block status could not be loaded.");
            });

        return () => {
            mounted = false;
            controller.abort();
        };
    }, [isOwner, profile?.username]);

    useEffect(() => () => {
        if (retryRateLimitTimeoutRef.current !== null) {
            window.clearTimeout(retryRateLimitTimeoutRef.current);
        }
        if (inviteCooldownTimeoutRef.current !== null) {
            window.clearTimeout(inviteCooldownTimeoutRef.current);
        }
    }, []);

    const retryProfile = useCallback(() => {
        if (!profileRetryBucketRef.current.tryConsume()) return;
        setIsRetryRateLimited(true);
        if (retryRateLimitTimeoutRef.current !== null) {
            window.clearTimeout(retryRateLimitTimeoutRef.current);
        }
        retryRateLimitTimeoutRef.current = window.setTimeout(() => {
            retryRateLimitTimeoutRef.current = null;
            setIsRetryRateLimited(false);
        }, PROFILE_RETRY_REFILL_INTERVAL_MS);
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

    const handleLogout = useCallback(async () => {
        await logout();
        navigate("/login", { replace: true });
    }, [logout, navigate]);

    const sendDuelInvite = useCallback(async () => {
        if (!profile?.username || isOwner || inviteState === "sending" || inviteState === "sent") return;
        setInviteState("sending");
        setInviteError(null);
        try {
            const response = await fetch(apiUrl("/api/duel-invites"), {
                method: "POST",
                credentials: "include",
                headers: {
                    "Content-Type": "application/json",
                    ...(await ensureCsrfHeaders("POST")),
                },
                body: JSON.stringify({ username: profile.username }),
            });
            const body = await response.json().catch(() => ({}));
            if (!response.ok) throw new Error(body.message ?? "The duel invite could not be sent.");
            setInviteState("sent");
            inviteCooldownTimeoutRef.current = window.setTimeout(() => {
                inviteCooldownTimeoutRef.current = null;
                setInviteState("idle");
            }, DUEL_INVITE_COOLDOWN_MS);
        } catch (error) {
            setInviteState("error");
            setInviteError(error.message ?? "The duel invite could not be sent.");
        }
    }, [inviteState, isOwner, profile?.username]);

    const toggleBlock = useCallback(async () => {
        if (!profile?.username || isOwner || blockState === "loading" || blockState === "saving") return;
        const shouldBlock = blockState !== "blocked";
        const previousState = blockState;
        setBlockState("saving");
        setBlockError(null);
        try {
            const method = shouldBlock ? "POST" : "DELETE";
            const response = await fetch(
                apiUrl(`/api/blocks/${encodeURIComponent(profile.username)}`),
                {
                    method,
                    credentials: "include",
                    headers: await ensureCsrfHeaders(method),
                },
            );
            const body = await response.json().catch(() => ({}));
            if (!response.ok) throw new Error(body.message ?? "The block action could not be completed.");
            setBlockState(body.blocked === true ? "blocked" : "idle");
            if (body.blocked === true) hideInvitesFrom(profile.username);
        } catch (error) {
            setBlockState(previousState === "blocked" ? "blocked" : "error");
            setBlockError(error.message ?? "The block action could not be completed.");
        }
    }, [blockState, hideInvitesFrom, isOwner, profile?.username]);

    return (
        <main className="min-h-screen bg-[#171a1c] font-interface text-slate-100">
            <AppNavbar account currentPage="profile" />

            <section className="relative z-[1] mx-auto w-full max-w-[1180px] px-5 py-10 sm:px-8 sm:py-12">
                <div className="max-w-3xl">

                    <ProfileSearchBar onSearch={(query) => navigate(`/profile/search?query=${encodeURIComponent(query)}`)} />
                </div>

                {status === "loading" && <ProfileLoading username={viewedUsername ?? user?.username} />}
                {status === "error" && <ProfileError onRetry={retryProfile} retryRateLimited={isRetryRateLimited} />}
                {status === "ready" && profile && (
                    <ProfileContent
                        profile={profile}
                        matches={matches}
                        totalMatches={totalMatches}
                        historyStatus={historyStatus}
                        onOpenPuzzles={() => setIsPuzzlesModalOpen(true)}
                        googleLinked={googleLinked}
                        googleStatus={googleStatus}
                        isOwner={isOwner}
                        onUsernameSaved={saveUsername}
                        onLogout={handleLogout}
                        onAboutMeSaved={saveAboutMe}
                        onOpenMatches={() => setIsMatchesModalOpen(true)}
                        canInvite={!isOwner}
                        inviteState={inviteState}
                        inviteError={inviteError}
                        onInvite={sendDuelInvite}
                        canBlock={!isOwner}
                        blockState={blockState}
                        blockError={blockError}
                        onToggleBlock={toggleBlock}
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

            {isPuzzlesModalOpen && (
                <SolvedPuzzlesModal
                    puzzles={solvedPuzzles}
                    totalPuzzles={totalSolvedPuzzles}
                    puzzlesStatus={solvedPuzzlesStatus}
                    hasMore={hasMoreSolvedPuzzles}
                    onLoadMore={() => void requestSolvedPuzzles(solvedPuzzlesPage + 1, true)}
                    onOpenPuzzle={(puzzleNumber) => navigate(`/puzzles/${encodeURIComponent(puzzleNumber)}`)}
                    onClose={() => setIsPuzzlesModalOpen(false)}
                />
            )}
        </main>
    );
}

function ProfileLoading({ username }) {
    return (
        <div className="mt-9 flex flex-col items-center justify-center gap-4 rounded-2xl border border-slate-700/70 bg-[#0b1722cc] py-24" aria-busy="true" aria-label="Loading profile">
            <SpinningBotFace />
            <p className="text-sm text-slate-500">{username ? `Loading ${username}'s profile...` : "Loading player profile..."}</p>
        </div>
    );
}

function ProfileError({ onRetry, retryRateLimited }) {
    return (
        <div className="mx-auto mt-10 max-w-xl rounded-2xl border border-rose-400/30 bg-[#130f18e8] px-7 py-10 text-center shadow-[0_20px_60px_rgba(0,0,0,.3)]">
            <div className="mx-auto grid h-12 w-12 place-items-center rounded-full border border-rose-400/50 bg-rose-950/30 font-mono text-xl text-rose-300">!</div>
            <h2 className="mt-5 text-2xl font-bold text-white">Profile data unavailable</h2>
            <p className="mt-2 text-sm leading-6 text-slate-400">The server could not load your profile record. Your results are safe; try the request again.</p>
            <button
                type="button"
                onClick={onRetry}
                disabled={retryRateLimited}
                className="profile-toolbar-button profile-toolbar-button--blue mt-6 font-bold disabled:cursor-wait"
            >
                {retryRateLimited ? "Please wait..." : "Try again"}
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
                        className="profile-toolbar-button profile-toolbar-button--blue h-11 text-sm font-bold"
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
    onOpenPuzzles,
    googleLinked,
    googleStatus,
    isOwner,
    onUsernameSaved,
    onLogout,
    onAboutMeSaved,
    onOpenMatches,
    canInvite,
    inviteState,
    inviteError,
    onInvite,
    canBlock,
    blockState,
    blockError,
    onToggleBlock,
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
                    <Stat label="Puzzles solved" value={profile.puzzlesSolved ?? 0} tone="text-cyan-300" onClick={onOpenPuzzles} />
                </dl>

                <div className="mt-7 border-t border-cyan-900/70 pt-5">
                    <p className="font-mono text-[10px] font-bold uppercase tracking-[.18em] text-slate-500">Joined</p>
                    <time className="mt-2 block text-sm font-semibold text-slate-200" dateTime={profile.joinedAt ?? undefined}>
                        {formatJoinedDate(profile.joinedAt)}
                    </time>
                </div>

                {canInvite && (
                    <DuelInviteButton
                        username={profile.username}
                        state={inviteState}
                        error={inviteError}
                        onInvite={onInvite}
                    />
                )}

                {canBlock && (
                    <UserBlockButton
                        username={profile.username}
                        state={blockState}
                        error={blockError}
                        onToggle={onToggleBlock}
                    />
                )}

                {isOwner && <UsernameEditor username={profile.username} onSave={onUsernameSaved} onLogout={onLogout} />}

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
                                    className="profile-toolbar-button profile-toolbar-button--blue mt-4 text-xs font-bold"
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

function DuelInviteButton({ username, state, error, onInvite }) {
    return (
        <div className="mt-7 border-t border-cyan-900/70 pt-5">
            <p className="font-mono text-[10px] font-bold tracking-[.18em] text-cyan-400">DIRECT DUEL</p>
            <p className="mt-2 text-sm leading-6 text-slate-400">Send {username} a request to fight a rated 1v1.</p>
            <button
                type="button"
                onClick={() => void onInvite()}
                disabled={state === "sending" || state === "sent"}
                className="profile-toolbar-button profile-toolbar-button--violet mt-4 text-sm font-bold disabled:cursor-wait"
            >
                {state === "sending" ? "Sending..." : state === "sent" ? "Invite sent" : "Invite to 1v1"}
            </button>
            {error && <p className="mt-2 text-xs text-rose-300" role="alert">{error}</p>}
            {state === "sent" && <p className="mt-2 text-xs text-emerald-300" role="status">They will see the request in their notifications.</p>}
        </div>
    );
}

function UserBlockButton({ username, state, error, onToggle }) {
    const isBlocked = state === "blocked";
    const isPending = state === "loading" || state === "saving";
    return (
        <div className="mt-5 border-t border-cyan-900/70 pt-5">
            <button
                type="button"
                onClick={() => void onToggle()}
                disabled={isPending}
                className={`profile-toolbar-button ${isBlocked ? "profile-toolbar-button--green" : "profile-toolbar-button--red"} text-xs font-bold disabled:cursor-wait`}
                aria-label={`${isBlocked ? "Unblock" : "Block"} ${username}`}
            >
                {state === "loading" ? "Checking..." : state === "saving" ? "Saving..." : isBlocked ? "Unblock player" : "Block player"}
            </button>
            {error && <p className="mt-2 text-xs text-rose-300" role="alert">{error}</p>}
            {isBlocked && <p className="mt-2 text-xs text-slate-500" role="status">Their notifications and chat messages are hidden from you.</p>}
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
                    className="profile-toolbar-button profile-toolbar-button--blue w-full flex-none text-sm font-bold sm:w-auto"
                >
                    View All Matches
                </button>
            </div>

            <div className="divide-y divide-slate-800">
                {historyStatus === "loading" ? (
                    <div className="flex items-center justify-center py-14" aria-label="Loading recent matches" aria-busy="true">
                        <SpinningBotFace />
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
                        className="profile-toolbar-button w-full text-sm font-bold sm:w-auto"
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
                            <button type="submit" disabled={isSaving} className="profile-toolbar-button profile-toolbar-button--blue h-11 text-sm font-bold">
                                {isSaving ? "Saving..." : "Save"}
                            </button>
                            <button type="button" onClick={() => { setDraft(aboutMe ?? ""); setError(null); setIsEditing(false); }} className="profile-toolbar-button h-11 text-sm">
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
                    <button ref={closeButtonRef} type="button" onClick={onClose} aria-label="Close all matches" className="modal-close-button">
                        <span aria-hidden="true">×</span>
                    </button>
                </header>

                <div
                    className="min-h-0 overflow-y-auto divide-y divide-slate-800"
                    onScroll={handleMatchesScroll}
                    aria-live="polite"
                >
                    {historyStatus === "loading" && matches.length === 0 ? (
                        <div className="flex items-center justify-center py-16" aria-busy="true" aria-label="Loading matches">
                            <SpinningBotFace />
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
                        <button type="button" onClick={onLoadMore} className="profile-toolbar-button profile-toolbar-button--blue w-full text-sm font-bold sm:w-auto">
                            Try again
                        </button>
                    )}
                </footer>
            </section>
        </div>
    );
}

function SolvedPuzzlesModal({ puzzles, totalPuzzles, puzzlesStatus, hasMore, onLoadMore, onOpenPuzzle, onClose }) {
    const dialogRef = useRef(null);
    const closeButtonRef = useRef(null);
    const isLoadingMore = puzzlesStatus === "loading-more";
    const isIncrementalError = puzzlesStatus === "error" && puzzles.length > 0;

    useDialogFocus(dialogRef, { initialFocusRef: closeButtonRef, onClose, lockScroll: true });

    const handlePuzzlesScroll = (event) => {
        if (!hasMore || puzzlesStatus !== "ready") return;
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
                aria-labelledby="solved-puzzles-modal-title"
                tabIndex={-1}
            >
                <header className="flex items-start justify-between gap-5 border-b border-slate-700/80 px-6 py-5 sm:px-8">
                    <div>
                        <h2 id="solved-puzzles-modal-title" className="mt-2 text-2xl font-bold text-white">Solved Puzzles</h2>
                        <p className="mt-1 text-sm text-slate-500">Showing {puzzles.length} of {totalPuzzles}, newest first.</p>
                    </div>
                    <button ref={closeButtonRef} type="button" onClick={onClose} aria-label="Close solved puzzles" className="modal-close-button">
                        <span aria-hidden="true">×</span>
                    </button>
                </header>

                <div
                    className="min-h-0 overflow-y-auto divide-y divide-slate-800"
                    onScroll={handlePuzzlesScroll}
                    aria-live="polite"
                >
                    {puzzlesStatus === "loading" && puzzles.length === 0 ? (
                        <div className="flex items-center justify-center py-16" aria-busy="true" aria-label="Loading solved puzzles">
                            <SpinningBotFace />
                        </div>
                    ) : puzzles.length === 0 ? (
                        <p className="px-6 py-14 text-center text-sm text-slate-500">No solved puzzles yet.</p>
                    ) : (
                        puzzles.map((puzzle) => (
                            <button
                                key={`${puzzle.puzzleNumber}-${puzzle.solvedAt}`}
                                type="button"
                                onClick={() => onOpenPuzzle(puzzle.puzzleNumber)}
                                className="grid w-full min-w-0 gap-3 px-6 py-4 text-left transition hover:bg-cyan-950/20 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center sm:px-8"
                                aria-label={`Open puzzle ${puzzle.puzzleNumber}: ${puzzle.name}`}
                            >
                                <span className="min-w-0">
                                    <span className="block font-mono text-[10px] font-bold tracking-wider text-cyan-400">PUZZLE #{puzzle.puzzleNumber}</span>
                                    <span className="mt-1 block break-words font-semibold text-slate-100">{puzzle.name}</span>
                                </span>
                                <time className="text-sm text-slate-400 sm:text-right" dateTime={puzzle.solvedAt ?? undefined}>
                                    {formatMatchDate(puzzle.solvedAt)}
                                </time>
                            </button>
                        ))
                    )}
                </div>

                <footer className="flex flex-col gap-3 border-t border-slate-700/80 px-6 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-8">
                    {isLoadingMore ? (
                        <p className="text-xs text-slate-500" role="status">Loading more solved puzzles...</p>
                    ) : isIncrementalError ? (
                        <p className="text-sm text-rose-300" role="alert">More solved puzzles could not be loaded. Your loaded puzzles are still visible.</p>
                    ) : hasMore ? (
                        <p className="text-xs text-slate-500">Scroll to the bottom to load more puzzles.</p>
                    ) : (
                        <p className="text-xs text-slate-500">All solved puzzles are loaded.</p>
                    )}
                    {isIncrementalError && (
                        <button type="button" onClick={onLoadMore} className="profile-toolbar-button profile-toolbar-button--blue w-full text-sm font-bold sm:w-auto">
                            Try again
                        </button>
                    )}
                </footer>
            </section>
        </div>
    );
}

function UsernameEditor({ username, onSave, onLogout }) {
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
                <button type="button" onClick={() => { setError(null); setIsEditing(true); }} className="profile-toolbar-button profile-toolbar-button--blue text-sm font-bold">
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
                        <button type="submit" disabled={isSaving} className="profile-toolbar-button profile-toolbar-button--blue h-11 text-sm font-bold">
                            {isSaving ? "Saving..." : "Save"}
                        </button>
                        <button type="button" onClick={() => { setDraft(username ?? ""); setError(null); setIsEditing(false); }} className="profile-toolbar-button h-11 text-sm">
                            Cancel
                        </button>
                    </div>
                </form>
            )}
            <div className="mt-3">
                <button
                    type="button"
                    onClick={() => void onLogout()}
                    className="profile-toolbar-button profile-toolbar-button--red text-sm font-bold"
                >
                    Log out
                </button>
            </div>
            {error && <p id="profile-username-error" className="form-error mt-2 text-sm text-rose-300" role="alert">{error}</p>}
            {!error && isEditing && <p id="profile-username-help" className="mt-2 text-xs text-slate-500">3–20 characters: letters, numbers, underscores, and hyphens only.</p>}
        </div>
    );
}

function Stat({ label, value, tone, onClick }) {
    const interactiveProps = onClick ? {
        role: "button",
        tabIndex: 0,
        onClick,
        onKeyDown: (event) => {
            if (event.key === "Enter" || event.key === " ") {
                event.preventDefault();
                onClick();
            }
        },
        "aria-label": `${label}: ${value}. Open details`,
    } : {};
    return (
        <div {...interactiveProps} className={`flex items-center justify-between gap-4 py-2.5 ${onClick ? "cursor-pointer rounded px-2 transition hover:bg-cyan-950/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400" : ""}`}>
            <dt className="text-sm text-slate-400">{label}:</dt>
            <dd className={`font-interface-numeric text-xl ${tone}`}>{value}</dd>
        </div>
    );
}
