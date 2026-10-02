import { useCallback, useEffect, useRef, useState } from "react";
import PlayerAvatar from "../../components/PlayerAvatar.jsx";
import { useAuth } from "../../auth/auth-context";
import { useNotifications } from "../../notifications/notification-context";
import { newPasswordError, passwordError, userFacingAuthError, usernameError } from "../../auth/validation";
import { apiUrl } from "../../config/api";
import { matchModeLabel } from "../../matchmaking/matchModes";
import { ensureCsrfHeaders } from "../../security/csrf";
import { fetchPuzzles } from "../../puzzles/puzzleApi.js";
import AppNavbar from "../../components/AppNavbar";
import ProfileLink from "../../components/ProfileLink.jsx";
import SpinningBotFace from "../../components/SpinningBotFace.jsx";
import { useDialogFocus } from "../../components/useDialogFocus.js";
import { useNavigate, useParams } from "react-router-dom";
import {
    createProfileRetryTokenBucket,
    PROFILE_RETRY_REFILL_INTERVAL_MS,
} from "./profileRetryRateLimit.js";
import {
    MODE_FILTERS,
    RESULT_FILTERS,
    bannerTitle,
    endedByLabel,
    eloChangeTone,
    filterMatches,
    formatEloDelta,
    formatScore,
    formatShortDate,
    groupMatchesByDate,
    matchDetailLine,
    matchTeams,
    opponentLabel,
    recordProportions,
    resultKey,
    roundsLabel,
    teamColorKey,
    teamColorLabel,
} from "./profileMatchFormat.js";
import "./profile.css";
import {
    normalizeAddRootShortcut,
    readAddRootShortcut,
    saveAddRootShortcut,
} from "../../gameArena/coding/addRootShortcut.js";

const RECENT_MATCH_LIMIT = 5;

function formatMatchCalendarDate(value) {
    if (!value) return "Date unavailable";
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return "Date unavailable";
    return new Intl.DateTimeFormat(undefined, {
        month: "short",
        day: "numeric",
        year: "numeric",
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

function routeProfileUsername(value) {
    const raw = String(value ?? "").trim();
    if (!raw) return null;
    try {
        return decodeURIComponent(raw).trim() || null;
    } catch {
        return raw;
    }
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
    const { user, isGuest, updateUsername, updateAboutMe, changePassword, logout } = useAuth();
    const { hideInvitesFrom } = useNotifications();
    const navigate = useNavigate();
    const { username: routeUsername } = useParams();
    const viewedUsername = routeProfileUsername(routeUsername);
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
    const [selectedMatch, setSelectedMatch] = useState(null);
    const [isPuzzlesModalOpen, setIsPuzzlesModalOpen] = useState(false);
    const [isRetryRateLimited, setIsRetryRateLimited] = useState(false);
    const [blockState, setBlockState] = useState("idle");
    const [blockError, setBlockError] = useState(null);
    const profileRequestRef = useRef(0);
    const historyRequestRef = useRef(0);
    const solvedPuzzlesRequestRef = useRef(0);
    const profileRetryBucketRef = useRef(null);
    const retryRateLimitTimeoutRef = useRef(null);
    const profileMatchesRoute = !viewedUsername || (
        typeof profile?.username === "string"
        && profile.username.toLowerCase() === viewedUsername.toLowerCase()
    );

    if (profileRetryBucketRef.current === null) {
        profileRetryBucketRef.current = createProfileRetryTokenBucket();
    }

    const loadProfile = useCallback(async () => {
        const profileRequestId = ++profileRequestRef.current;
        const historyRequestId = ++historyRequestRef.current;
        const solvedPuzzlesRequestId = ++solvedPuzzlesRequestRef.current;
        // A profile URL is an explicit request for that username, including
        // when the URL happens to point back to the authenticated user.
        const requestUsername = viewedUsername;
        setStatus("loading");
        setHistoryStatus("loading");
        setSolvedPuzzlesStatus("loading");
        try {
            const [profileResponse, historyResponse, solvedPuzzlesResponse, googleResponse] = await Promise.all([
                fetch(profileUrl(requestUsername), { credentials: "include" }),
                fetch(historyUrl(0, requestUsername), { credentials: "include" }),
                fetch(solvedPuzzlesUrl(0, requestUsername), { credentials: "include" }),
                isOwner && !isGuest
                    ? fetch(apiUrl("/api/auth/google/status"), { credentials: "include" })
                    : Promise.resolve(null),
            ]);
            if (!profileResponse.ok || !historyResponse.ok || !solvedPuzzlesResponse.ok || (isOwner && !isGuest && !googleResponse?.ok)) {
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
    }, [isGuest, isOwner, viewedUsername]);

    const requestHistory = useCallback(async (page, append) => {
        const historyRequestId = ++historyRequestRef.current;
        const requestUsername = viewedUsername;
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
    }, [viewedUsername]);

    const requestSolvedPuzzles = useCallback(async (page, append) => {
        const solvedPuzzlesRequestId = ++solvedPuzzlesRequestRef.current;
        const requestUsername = viewedUsername;
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
    }, [viewedUsername]);

    useEffect(() => {
        void loadProfile();
    }, [loadProfile]);

    useEffect(() => {
        setBlockState("idle");
        setBlockError(null);
        setSelectedMatch(null);
    }, [viewedUsername]);

    useEffect(() => {
        if (isGuest || isOwner || !viewedUsername) {
            setBlockState("idle");
            setBlockError(null);
            return undefined;
        }

        const controller = new AbortController();
        let mounted = true;
        setBlockState("loading");
        setBlockError(null);
        fetch(apiUrl(`/api/blocks/status/${encodeURIComponent(viewedUsername)}`), {
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
    }, [isGuest, isOwner, viewedUsername]);

    useEffect(() => () => {
        if (retryRateLimitTimeoutRef.current !== null) {
            window.clearTimeout(retryRateLimitTimeoutRef.current);
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

    // Retained for the dormant About Me editor; the profile no longer renders that surface.
    const _saveAboutMe = useCallback(async (aboutMe) => {
        const updatedProfile = await updateAboutMe({ aboutMe });
        setProfile((current) => current ? { ...current, aboutMe: updatedProfile.aboutMe } : current);
        return updatedProfile;
    }, [updateAboutMe]);

    const savePassword = useCallback(async ({ currentPassword, newPassword, confirmPassword }) => {
        return changePassword({ currentPassword, newPassword, confirmPassword });
    }, [changePassword]);

    const handleLogout = useCallback(async () => {
        await logout();
        navigate("/login", { replace: true });
    }, [logout, navigate]);

    const toggleBlock = useCallback(async () => {
        if (!viewedUsername || isOwner || blockState === "loading" || blockState === "saving") return;
        const shouldBlock = blockState !== "blocked";
        const previousState = blockState;
        setBlockState("saving");
        setBlockError(null);
        try {
            const method = shouldBlock ? "POST" : "DELETE";
            const response = await fetch(
                apiUrl(`/api/blocks/${encodeURIComponent(viewedUsername)}`),
                {
                    method,
                    credentials: "include",
                    headers: await ensureCsrfHeaders(method),
                },
            );
            const body = await response.json().catch(() => ({}));
            if (!response.ok) throw new Error(body.message ?? "The block action could not be completed.");
            setBlockState(body.blocked === true ? "blocked" : "idle");
            if (body.blocked === true) hideInvitesFrom(viewedUsername);
        } catch (error) {
            setBlockState(previousState === "blocked" ? "blocked" : "error");
            setBlockError(error.message ?? "The block action could not be completed.");
        }
    }, [blockState, hideInvitesFrom, isOwner, viewedUsername]);

    return (
        <main className="profile-page min-h-screen bg-[#181b1c] font-interface text-[#f2f4f5]">
            <AppNavbar account currentPage="profile" />

            <section className="relative z-[1] mx-auto w-full max-w-[1180px] px-5 py-10 sm:px-8 sm:py-12">

                {(status === "loading" || (status === "ready" && !profileMatchesRoute)) && (
                    <ProfileLoading username={viewedUsername ?? user?.username} />
                )}
                {status === "error" && <ProfileError onRetry={retryProfile} retryRateLimited={isRetryRateLimited} />}
                {status === "ready" && profile && profileMatchesRoute && (
                    <ProfileContent
                        profile={profile}
                        matches={matches}
                        totalMatches={totalMatches}
                        historyStatus={historyStatus}
                        onOpenPuzzles={() => setIsPuzzlesModalOpen(true)}
                        googleLinked={googleLinked}
                        googleStatus={googleStatus}
                        isGuest={isGuest}
                        isOwner={isOwner}
                        hasPassword={user?.hasPassword === true}
                        onUsernameSaved={saveUsername}
                        onPasswordSaved={savePassword}
                        onLogout={handleLogout}
                        onOpenMatches={() => setIsMatchesModalOpen(true)}
                        onOpenMatchDetails={setSelectedMatch}
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
                    onOpenMatchDetails={setSelectedMatch}
                    onClose={() => setIsMatchesModalOpen(false)}
                />
            )}

            {selectedMatch && (
                <MatchDetailsModal
                    match={selectedMatch}
                    onClose={() => setSelectedMatch(null)}
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
                    username={profile?.username ?? viewedUsername ?? ""}
                    isOwner={isOwner}
                    canOpenPuzzles={!isGuest}
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
                className="hud-btn hud-btn--auto mt-6 font-bold disabled:cursor-wait"
            >
                {retryRateLimited ? "Please wait..." : "Try again"}
            </button>
        </div>
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
    isGuest,
    isOwner,
    hasPassword,
    onUsernameSaved,
    onPasswordSaved,
    onLogout,
    onOpenMatches,
    onOpenMatchDetails,
    canBlock,
    blockState,
    blockError,
    onToggleBlock,
}) {
    const isGuestProfile = isGuest && isOwner;
    const matchCount = isGuestProfile || historyStatus === "loading" ? "—" : totalMatches;
    const puzzleCount = isGuestProfile ? "—" : (profile.puzzlesSolved ?? 0);
    return (
        <div className="pf-page">
            <header className="pf-hero">
                <PlayerAvatar name={profile.username} size={56} className="pf-avatar" />
                <div className="pf-hero__id">
                    <h1>{profile.username}</h1>
                    <p className="pf-hero__joined">
                        Joined <time dateTime={profile.joinedAt ?? undefined}>{formatJoinedDate(profile.joinedAt)}</time>
                    </p>
                    <p className="pf-hero__summary">
                        {matchCount} {matchCount === 1 ? "match" : "matches"}
                        {" · "}
                        {isGuestProfile ? (
                            <span>{puzzleCount} puzzles</span>
                        ) : (
                            <button type="button" className="pf-link pf-link--inline" onClick={onOpenPuzzles} aria-label={`Puzzles solved: ${puzzleCount}. Open details`}>
                                {puzzleCount} {puzzleCount === 1 ? "puzzle" : "puzzles"}
                            </button>
                        )}
                    </p>
                </div>
                <div className="pf-hero__stats" role="group" aria-label="Player activity">
                    <div className="pf-stat"><strong>{matchCount}</strong><span>Matches</span></div>
                    {isGuestProfile ? (
                        <div className="pf-stat"><strong>{puzzleCount}</strong><span>Puzzles solved</span></div>
                    ) : (
                        <button type="button" className="pf-stat pf-stat--button" onClick={onOpenPuzzles} aria-label={`Puzzles solved: ${puzzleCount}. Open details`}>
                            <strong>{puzzleCount}</strong><span>Puzzles solved</span>
                        </button>
                    )}
                </div>
            </header>

            {canBlock && !isGuest && (
                <UserBlockButton
                    username={profile.username}
                    state={blockState}
                    error={blockError}
                    onToggle={onToggleBlock}
                />
            )}

            <div className="pf-grid">
                <section className="pf-card pf-ranked" aria-labelledby="pf-ranked-title">
                    <h2 id="pf-ranked-title" className="pf-card__title">Ranked</h2>
                    <div className="pf-ranked__tiles">
                        <QueueModeStatsCard label="1V1" stats={profile.queueStats?.ones} />
                        <QueueModeStatsCard label="2V2" stats={profile.queueStats?.twos} />
                    </div>
                </section>

                <RecentMatchesCard
                    matches={matches}
                    totalMatches={totalMatches}
                    historyStatus={historyStatus}
                    isGuestProfile={isGuestProfile}
                    isOwner={isOwner}
                    onOpenMatches={onOpenMatches}
                    onOpenMatchDetails={onOpenMatchDetails}
                />
            </div>

            {isOwner && !isGuest && (
                <section className="pf-settings" aria-labelledby="profile-settings-title">
                    <h2 id="profile-settings-title" className="pf-card__title">Settings</h2>
                    <UsernameSetting username={profile.username} onSave={onUsernameSaved} />
                    <SignInSetting hasPassword={hasPassword} googleLinked={googleLinked} googleStatus={googleStatus} onSave={onPasswordSaved} />
                    <AddRootShortcutSetting />
                    <div className="pf-settings__footer">
                        <button type="button" onClick={() => void onLogout()} className="pf-link pf-link--danger">
                            <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" /><path d="m16 17 5-5-5-5" /><path d="M21 12H9" /></svg>
                            Log out
                        </button>
                    </div>
                </section>
            )}
        </div>
    );
}

function QueueModeStatsCard({ label, stats }) {
    const wins = stats?.wins ?? 0;
    const losses = stats?.losses ?? 0;
    const draws = stats?.draws ?? 0;
    const proportions = recordProportions(stats);
    return (
        <div className="pf-tile">
            <h3 className="pf-tile__label">{label}</h3>
            <p className="pf-tile__elo">{stats?.elo ?? "N/A"}</p>
            <p className="pf-tile__caption">ELO</p>
            <div className="pf-bar" role="img" aria-label={`${wins} wins, ${losses} losses, ${draws} draws`}>
                {proportions.total > 0 && (
                    <>
                        <span className="pf-bar__win" style={{ width: `${proportions.wins}%` }} />
                        <span className="pf-bar__loss" style={{ width: `${proportions.losses}%` }} />
                        <span className="pf-bar__draw" style={{ width: `${proportions.draws}%` }} />
                    </>
                )}
            </div>
            <p className="pf-tile__record">
                <span className="pf-win">{wins}W</span> <span className="pf-loss">{losses}L</span> <span className="pf-draw">{draws}D</span>
            </p>
        </div>
    );
}

function UserBlockButton({ username, state, error, onToggle }) {
    const isBlocked = state === "blocked";
    const isPending = state === "loading" || state === "saving";
    return (
        <div className="pf-block">
            <button
                type="button"
                onClick={() => void onToggle()}
                disabled={isPending}
                className={`pf-link ${isBlocked ? "" : "pf-link--danger"}`}
                aria-label={`${isBlocked ? "Unblock" : "Block"} ${username}`}
            >
                {state === "loading" ? "Checking..." : state === "saving" ? "Saving..." : isBlocked ? "Unblock player" : "Block player"}
            </button>
            {error && <p className="pf-message pf-message--error" role="alert">{error}</p>}
            {isBlocked && <p className="pf-message" role="status">Their notifications and chat messages are hidden from you.</p>}
        </div>
    );
}

function RecentMatchesCard({ matches, totalMatches, historyStatus, isGuestProfile, isOwner, onOpenMatches, onOpenMatchDetails }) {
    const previewMatches = matches.slice(0, RECENT_MATCH_LIMIT);
    const isInitialError = historyStatus === "error" && matches.length === 0;
    if (isGuestProfile) {
        return (
            <section className="pf-card pf-recent">
                <h2 className="pf-card__title">Match history</h2>
                <p className="pf-empty">
                    Guest matches are temporary and are not saved. Create an account to keep your results.
                </p>
            </section>
        );
    }
    return (
        <section className="pf-card pf-recent" aria-labelledby="pf-recent-title">
            <div className="pf-card__head">
                <h2 id="pf-recent-title" className="pf-card__title">Recent matches</h2>
                <button type="button" onClick={onOpenMatches} className="pf-link pf-link--accent" aria-label="View all matches">
                    View all {totalMatches}
                </button>
            </div>

            <div className="pf-match-list">
                {historyStatus === "loading" ? (
                    <div className="pf-loading" aria-label="Loading recent matches" aria-busy="true">
                        <SpinningBotFace />
                    </div>
                ) : isInitialError ? (
                    <p className="pf-empty pf-empty--error">Recent matches could not be loaded.</p>
                ) : previewMatches.length === 0 ? (
                    <p className="pf-empty">
                        {isOwner ? "Your completed matches will appear here." : "This player's completed matches will appear here."}
                    </p>
                ) : (
                    previewMatches.map((match) => (
                        <MatchRow
                            key={match.matchId}
                            match={match}
                            onOpenDetails={() => onOpenMatchDetails(match)}
                        />
                    ))
                )}
            </div>
        </section>
    );
}

function MatchRow({ match, onOpenDetails, detailed = false }) {
    const modeLabel = matchModeLabel(match.mode);
    const detail = matchDetailLine(match);
    const shortDate = formatShortDate(match.completedAt);
    const handleKeyDown = (event) => {
        if (event.key !== "Enter" && event.key !== " ") return;
        event.preventDefault();
        onOpenDetails();
    };

    return (
        <article
            className={`pf-match pf-match--${resultKey(match)} ${detailed ? "pf-match--detailed" : ""}`}
            role="button"
            tabIndex={0}
            aria-label={`Open ${modeLabel} match details`}
            onClick={onOpenDetails}
            onKeyDown={handleKeyDown}
        >
            <span className="pf-match__result">{match.result ?? "DRAW"}</span>
            <span className="pf-match__main">
                <span className="pf-match__opponent">vs {opponentLabel(match)}</span>
                <small className="pf-match__detail">{detail}</small>
                <small className="pf-match__meta">{modeLabel} · {detail} · {shortDate}</small>
            </span>
            <span className="pf-tag pf-match__mode">{modeLabel}</span>
            <time className="pf-match__date" dateTime={match.completedAt ?? undefined}>{shortDate}</time>
            <span className="pf-match__chevron" aria-hidden="true">›</span>
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
                        className="hud-btn hud-btn--auto w-full text-sm font-bold sm:w-auto"
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
                            <button type="submit" disabled={isSaving} className="hud-btn hud-btn--play hud-btn--auto h-11 text-sm font-bold">
                                {isSaving ? "Saving..." : "Save"}
                            </button>
                            <button type="button" onClick={() => { setDraft(aboutMe ?? ""); setError(null); setIsEditing(false); }} className="hud-btn hud-btn--auto h-11 text-sm">
                                Cancel
                            </button>
                        </div>
                    </div>
                </form>
            )}
        </section>
    );
}

function MatchesModal({ matches, totalMatches, historyStatus, hasMore, onLoadMore, onOpenMatchDetails, onClose }) {
    const dialogRef = useRef(null);
    const closeButtonRef = useRef(null);
    const listRef = useRef(null);
    const [modeFilter, setModeFilter] = useState("ALL");
    const [resultFilter, setResultFilter] = useState(null);
    const isLoadingMore = historyStatus === "loading-more";
    const isIncrementalError = historyStatus === "error" && matches.length > 0;
    const filtersActive = modeFilter !== "ALL" || resultFilter !== null;
    // Filters apply to the matches loaded so far; the endpoint only pages newest first.
    const visibleMatches = filterMatches(matches, { mode: modeFilter, result: resultFilter });
    const groups = groupMatchesByDate(visibleMatches);

    useDialogFocus(dialogRef, { initialFocusRef: closeButtonRef, onClose, lockScroll: true });

    const handleMatchesScroll = (event) => {
        if (!hasMore || historyStatus !== "ready") return;
        const scrollContainer = event.currentTarget;
        const distanceFromBottom = scrollContainer.scrollHeight
            - scrollContainer.scrollTop
            - scrollContainer.clientHeight;
        if (distanceFromBottom <= 24) onLoadMore();
    };

    // A filter can leave too few rows to scroll; keep loading until the list fills or ends.
    useEffect(() => {
        const list = listRef.current;
        if (!list || !hasMore || historyStatus !== "ready") return;
        if (list.scrollHeight <= list.clientHeight + 24) onLoadMore();
    }, [hasMore, historyStatus, onLoadMore, visibleMatches.length]);

    const clearFilters = () => {
        setModeFilter("ALL");
        setResultFilter(null);
    };

    return (
        <div
            className="pf-overlay"
            onMouseDown={(event) => {
                if (event.target === event.currentTarget) onClose();
            }}
        >
            <section
                ref={dialogRef}
                className="pf-dialog pf-dialog--history"
                role="dialog"
                aria-modal="true"
                aria-labelledby="match-history-modal-title"
                tabIndex={-1}
            >
                <header className="pf-dialog__header">
                    <h2 id="match-history-modal-title" className="pf-dialog__title">
                        Match history <span className="pf-count">{totalMatches}</span>
                    </h2>
                    <button ref={closeButtonRef} type="button" onClick={onClose} aria-label="Close match history" className="modal-close-button">
                        <span aria-hidden="true">×</span>
                    </button>
                </header>

                <div className="pf-filters">
                    <div className="pf-chips" role="group" aria-label="Filter by mode">
                        {MODE_FILTERS.map((filter) => (
                            <button
                                key={filter.id}
                                type="button"
                                className={`pf-chip ${modeFilter === filter.id ? "is-active" : ""}`}
                                aria-pressed={modeFilter === filter.id}
                                onClick={() => setModeFilter(filter.id)}
                            >
                                {filter.label}
                            </button>
                        ))}
                    </div>
                    <div className="pf-chips" role="group" aria-label="Filter by result">
                        {RESULT_FILTERS.map((filter) => (
                            <button
                                key={filter.id}
                                type="button"
                                className={`pf-chip ${resultFilter === filter.id ? "is-active" : ""}`}
                                aria-pressed={resultFilter === filter.id}
                                onClick={() => setResultFilter((current) => (current === filter.id ? null : filter.id))}
                            >
                                {filter.label}
                            </button>
                        ))}
                    </div>
                </div>

                <div
                    ref={listRef}
                    className="pf-history"
                    onScroll={handleMatchesScroll}
                    aria-live="polite"
                >
                    {historyStatus === "loading" && matches.length === 0 ? (
                        <div className="pf-loading" aria-busy="true" aria-label="Loading matches">
                            <SpinningBotFace />
                        </div>
                    ) : matches.length === 0 ? (
                        <p className="pf-empty">No completed matches yet.</p>
                    ) : visibleMatches.length === 0 ? (
                        <p className="pf-empty">
                            No loaded matches fit these filters.{" "}
                            <button type="button" className="pf-link pf-link--inline pf-link--accent" onClick={clearFilters}>Clear filters</button>
                        </p>
                    ) : (
                        groups.map((group) => (
                            <section key={group.label} className="pf-history__group" aria-label={group.label}>
                                <h3 className="pf-history__heading">{group.label}</h3>
                                {group.matches.map((match) => (
                                    <MatchRow
                                        key={match.matchId}
                                        match={match}
                                        detailed
                                        onOpenDetails={() => onOpenMatchDetails(match)}
                                    />
                                ))}
                            </section>
                        ))
                    )}
                </div>

                <footer className="pf-dialog__footer">
                    {isLoadingMore ? (
                        <p role="status">Loading more matches…</p>
                    ) : isIncrementalError ? (
                        <p className="pf-message pf-message--error" role="alert">More matches could not be loaded. Your loaded matches are still visible.</p>
                    ) : (
                        <p>
                            {filtersActive
                                ? `${visibleMatches.length} ${visibleMatches.length === 1 ? "match fits" : "matches fit"} · ${matches.length} of ${totalMatches} loaded`
                                : `Showing ${matches.length} of ${totalMatches}`}
                            {hasMore ? " · loading more as you scroll" : ""}
                        </p>
                    )}
                    {isIncrementalError && (
                        <button type="button" onClick={onLoadMore} className="pf-btn">
                            Try again
                        </button>
                    )}
                </footer>
            </section>
        </div>
    );
}

function MatchDetailsModal({ match, onClose }) {
    const dialogRef = useRef(null);
    const closeButtonRef = useRef(null);
    const teams = matchTeams(match);
    const teamNumbers = Array.isArray(match.participantTeamNumbers) ? match.participantTeamNumbers : [];
    const [ownTeam, ...otherTeams] = teams;
    const score = formatScore(match.score);
    const eloTone = eloChangeTone(match);
    const eloDelta = formatEloDelta(match);
    const renderSide = (team, index, side) => {
        const colorKey = teamColorKey(teamNumbers[index]);
        const isYou = index === 0;
        return (
            <div key={`team-${index}`} className={`pf-side pf-side--${colorKey} pf-side--${side}`}>
                <span className="pf-side__tag">{teamColorLabel(teamNumbers[index], index)}{isYou ? " · YOU" : ""}</span>
                {team.map((username) => (
                    <ProfileLink key={`${index}-${username}`} username={username} className="pf-side__name">{username}</ProfileLink>
                ))}
            </div>
        );
    };

    useDialogFocus(dialogRef, { initialFocusRef: closeButtonRef, onClose, lockScroll: true });

    return (
        <div
            className="pf-overlay pf-overlay--top"
            onMouseDown={(event) => {
                if (event.target === event.currentTarget) onClose();
            }}
        >
            <section
                ref={dialogRef}
                className="pf-dialog pf-dialog--details"
                role="dialog"
                aria-modal="true"
                aria-labelledby="match-details-modal-title"
                tabIndex={-1}
            >
                <header className={`pf-banner pf-banner--${resultKey(match)}`}>
                    <div>
                        <h2 id="match-details-modal-title" className="pf-banner__title">{bannerTitle(match)}</h2>
                        <p className="pf-banner__meta">
                            {matchModeLabel(match.mode)} match · {formatMatchCalendarDate(match.completedAt)} · Ended by {endedByLabel(match)}
                        </p>
                    </div>
                    <button ref={closeButtonRef} type="button" onClick={onClose} aria-label="Close match details" className="modal-close-button">
                        <span aria-hidden="true">×</span>
                    </button>
                </header>

                <div className="pf-dialog__body">
                    <div className="pf-versus">
                        {ownTeam && renderSide(ownTeam, 0, "left")}
                        <p className="pf-versus__score" aria-label={score ? `Score ${score}` : "Score unavailable"}>
                            {score ? score.replace("–", " – ") : "—"}
                        </p>
                        <div className="pf-versus__others">
                            {otherTeams.map((team, offset) => renderSide(team, offset + 1, "right"))}
                        </div>
                    </div>

                    <dl className="pf-facts">
                        <div className="pf-fact">
                            <dt>ELO change</dt>
                            <dd>
                                {eloDelta == null ? <strong>Not rated</strong> : (
                                    <>
                                        <strong className={`pf-elo pf-elo--${eloTone}`}>{eloDelta} ELO</strong>
                                        <small>{match.ratingBefore} → {match.ratingAfter}</small>
                                    </>
                                )}
                            </dd>
                        </div>
                        <div className="pf-fact">
                            <dt>Rounds</dt>
                            <dd><strong>{roundsLabel(match)}</strong></dd>
                        </div>
                    </dl>
                </div>
            </section>
        </div>
    );
}

function shortSolvedDate(value) {
    const date = value ? new Date(value) : null;
    if (!date || Number.isNaN(date.getTime())) return "";
    return new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric" }).format(date);
}

function SolvedPuzzlesModal({ puzzles, totalPuzzles, puzzlesStatus, hasMore, onLoadMore, onOpenPuzzle, onClose, username = "", isOwner = false, canOpenPuzzles = true }) {
    const dialogRef = useRef(null);
    const closeButtonRef = useRef(null);
    const [puzzleTotal, setPuzzleTotal] = useState(null);
    const isLoadingMore = puzzlesStatus === "loading-more";
    const isIncrementalError = puzzlesStatus === "error" && puzzles.length > 0;
    const solvedCount = Math.max(Number(totalPuzzles) || 0, puzzles.length);
    const ringTotal = puzzleTotal != null ? Math.max(puzzleTotal, solvedCount) : null;
    const radius = 20;
    const circumference = 2 * Math.PI * radius;
    const progress = ringTotal ? Math.min(1, solvedCount / ringTotal) : 1;

    useDialogFocus(dialogRef, { initialFocusRef: closeButtonRef, onClose, lockScroll: true });

    // The total puzzle count only decorates the progress ring, so a failed lookup is ignored.
    useEffect(() => {
        let active = true;
        fetchPuzzles(0, 1, "")
            .then((result) => {
                const total = Number(result?.totalElements);
                if (active && Number.isFinite(total) && total > 0) setPuzzleTotal(total);
            })
            .catch(() => {});
        return () => { active = false; };
    }, []);

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
            className="profile-modal-overlay fixed inset-0 z-[110] grid place-items-center bg-[#02070de8] px-4 pb-4 pt-[5.5rem] backdrop-blur-sm max-sm:grid-rows-[minmax(0,1fr)] max-sm:items-stretch max-sm:p-0 max-sm:pt-[72px]"
            onMouseDown={(event) => {
                if (event.target === event.currentTarget) onClose();
            }}
        >
            <section
                ref={dialogRef}
                className="profile-dialog flex max-h-[calc(100dvh-7.5rem)] w-[min(34rem,calc(100vw-2rem))] flex-col overflow-hidden rounded-2xl border border-[#262c33] bg-[#0f1418] shadow-[0_24px_90px_rgba(0,0,0,.6)] max-sm:h-full max-sm:max-h-none max-sm:w-full max-sm:rounded-none max-sm:border-0"
                role="dialog"
                aria-modal="true"
                aria-labelledby="solved-puzzles-modal-title"
                tabIndex={-1}
            >
                <header className="flex items-center gap-3 border-b border-[#262c33] px-5 py-4">
                    <div className="relative h-12 w-12 shrink-0" role="img" aria-label={ringTotal ? `${solvedCount} of ${ringTotal} puzzles solved` : `${solvedCount} puzzles solved`}>
                        <svg viewBox="0 0 48 48" className="h-12 w-12 -rotate-90" aria-hidden="true">
                            <circle cx="24" cy="24" r={radius} fill="none" stroke="#262c33" strokeWidth="4" />
                            <circle cx="24" cy="24" r={radius} fill="none" stroke="#34d399" strokeWidth="4" strokeLinecap="round" strokeDasharray={circumference} strokeDashoffset={circumference * (1 - progress)} />
                        </svg>
                        <span className="absolute inset-0 grid place-items-center font-display text-[11px] font-bold text-white">{ringTotal ? `${solvedCount}/${ringTotal}` : solvedCount}</span>
                    </div>
                    <div className="min-w-0 flex-1">
                        <h2 id="solved-puzzles-modal-title" className="font-display text-xl font-bold text-white">Solved puzzles</h2>
                        <p className="truncate text-xs text-slate-500">{username ? `${username} · ` : ""}newest first</p>
                    </div>
                    <button ref={closeButtonRef} type="button" onClick={onClose} aria-label="Close solved puzzles" className="modal-close-button">
                        <span aria-hidden="true">×</span>
                    </button>
                </header>

                <div
                    className="min-h-0 flex-1 overflow-y-auto"
                    onScroll={handlePuzzlesScroll}
                    aria-live="polite"
                >
                    {puzzlesStatus === "loading" && puzzles.length === 0 ? (
                        <div className="flex items-center justify-center py-16" aria-busy="true" aria-label="Loading solved puzzles">
                            <SpinningBotFace />
                        </div>
                    ) : puzzles.length === 0 ? (
                        <p className="px-6 py-14 text-center text-sm text-slate-500">{isOwner ? "You haven't solved any puzzles yet." : `${username || "This player"} hasn't solved any puzzles yet.`}</p>
                    ) : (
                        <ul>
                            {puzzles.map((puzzle) => {
                                const content = (
                                    <>
                                        <svg viewBox="0 0 24 24" className="h-4 w-4 shrink-0 fill-none stroke-emerald-400" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" role="img" aria-label="Solved"><circle cx="12" cy="12" r="9" /><path d="m8 12.3 2.6 2.6L16 9.5" /></svg>
                                        <span className="w-9 shrink-0 font-display text-sm text-slate-500">#{puzzle.puzzleNumber}</span>
                                        <span className="min-w-0 flex-1 truncate text-sm font-semibold text-slate-100" title={puzzle.name}>{puzzle.name}</span>
                                        <time className="shrink-0 text-xs text-slate-500" dateTime={puzzle.solvedAt ?? undefined}>{shortSolvedDate(puzzle.solvedAt)}</time>
                                        {canOpenPuzzles && <svg viewBox="0 0 24 24" className="h-4 w-4 shrink-0 fill-none stroke-slate-500" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m9 6 6 6-6 6" /></svg>}
                                    </>
                                );
                                const rowClass = "flex min-h-[42px] w-full items-center gap-3 px-5 text-left max-sm:min-h-[44px]";
                                return (
                                    <li key={`${puzzle.puzzleNumber}-${puzzle.solvedAt}`} className="border-b border-[#1c2228] even:bg-[#12181d]">
                                        {canOpenPuzzles ? (
                                            <button
                                                type="button"
                                                onClick={() => onOpenPuzzle(puzzle.puzzleNumber)}
                                                className={`${rowClass} transition hover:bg-[#172028]`}
                                                aria-label={`Open puzzle ${puzzle.puzzleNumber}: ${puzzle.name}`}
                                            >
                                                {content}
                                            </button>
                                        ) : <div className={rowClass}>{content}</div>}
                                    </li>
                                );
                            })}
                        </ul>
                    )}
                </div>

                <footer className="flex items-center justify-between gap-3 border-t border-[#262c33] px-5 py-3">
                    {isLoadingMore ? (
                        <p className="text-xs text-slate-500" role="status">Loading more&hellip;</p>
                    ) : isIncrementalError ? (
                        <p className="text-sm text-rose-300" role="alert">More solved puzzles could not be loaded. Your loaded puzzles are still visible.</p>
                    ) : canOpenPuzzles && puzzles.length > 0 ? (
                        <p className="text-xs text-slate-500">Open a puzzle to try it yourself.</p>
                    ) : <span />}
                    {isIncrementalError && (
                        <button type="button" onClick={onLoadMore} className="hud-btn hud-btn--auto text-sm font-bold">
                            Try again
                        </button>
                    )}
                </footer>
            </section>
        </div>
    );
}

function SettingsRow({ label, action = null, children }) {
    return (
        <div className="pf-row">
            <div className="pf-row__text">
                <p className="pf-row__label">{label}</p>
                {children}
            </div>
            {action && <div className="pf-row__action">{action}</div>}
        </div>
    );
}

function AddRootShortcutSetting() {
    const [draft, setDraft] = useState(() => readAddRootShortcut().toUpperCase());
    const [shortcut, setShortcut] = useState(() => readAddRootShortcut().toUpperCase());
    const [isEditing, setIsEditing] = useState(false);
    const [error, setError] = useState(null);
    const [notice, setNotice] = useState(null);

    const handleSave = (event) => {
        event.preventDefault();
        const nextShortcut = normalizeAddRootShortcut(draft);
        if (!nextShortcut) {
            setError("Choose one letter or number (A–Z, 0–9).");
            setNotice(null);
            return;
        }
        if (!saveAddRootShortcut(nextShortcut)) {
            setError("This browser could not save the shortcut.");
            setNotice(null);
            return;
        }
        setDraft(nextShortcut.toUpperCase());
        setShortcut(nextShortcut.toUpperCase());
        setError(null);
        setNotice("Shortcut saved on this browser.");
        setIsEditing(false);
    };

    const cancel = () => {
        setDraft(shortcut);
        setError(null);
        setIsEditing(false);
    };

    return (
        <SettingsRow
            label="Add root key"
            action={!isEditing && (
                <>
                    <kbd className="pf-kbd">{shortcut}</kbd>
                    <button type="button" className="pf-btn" onClick={() => { setNotice(null); setError(null); setIsEditing(true); }}>Change</button>
                </>
            )}
        >
            <p id="profile-add-root-shortcut-help" className="pf-row__hint">
                Adds a root when nothing is selected in the code workspace. Saved on this browser.
            </p>
            {isEditing && (
                <form onSubmit={handleSave} className="pf-form pf-form--inline">
                    <label htmlFor="profile-add-root-shortcut" className="pf-field pf-field--key">
                        <span>Key</span>
                        <input
                            id="profile-add-root-shortcut"
                            type="text"
                            value={draft}
                            onChange={(event) => { setDraft(event.target.value.toUpperCase()); setError(null); setNotice(null); }}
                            onFocus={(event) => event.target.select()}
                            maxLength={1}
                            autoCapitalize="off"
                            autoComplete="off"
                            autoFocus
                            spellCheck={false}
                            aria-invalid={Boolean(error)}
                            aria-describedby={error ? "profile-add-root-shortcut-error" : "profile-add-root-shortcut-help"}
                            className="pf-input pf-input--key"
                        />
                    </label>
                    <button type="submit" className="pf-btn pf-btn--primary">Save key</button>
                    <button type="button" className="pf-btn" onClick={cancel}>Cancel</button>
                </form>
            )}
            {error && <p id="profile-add-root-shortcut-error" role="alert" className="pf-message pf-message--error">{error}</p>}
            {notice && <p role="status" className="pf-message pf-message--success">{notice}</p>}
        </SettingsRow>
    );
}

function UsernameSetting({ username, onSave }) {
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
        <SettingsRow
            label="Username"
            action={!isEditing && (
                <button type="button" onClick={() => { setError(null); setIsEditing(true); }} className="pf-btn">Change</button>
            )}
        >
            {!isEditing ? (
                <p className="pf-row__value">{username}</p>
            ) : (
                <form onSubmit={handleSubmit} className="pf-form pf-form--inline">
                    <label htmlFor="profile-username" className="pf-field">
                        <span>New username</span>
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
                            className="pf-input"
                        />
                    </label>
                    <button type="submit" disabled={isSaving} className="pf-btn pf-btn--primary">
                        {isSaving ? "Saving..." : "Save"}
                    </button>
                    <button type="button" onClick={() => { setDraft(username ?? ""); setError(null); setIsEditing(false); }} className="pf-btn">
                        Cancel
                    </button>
                </form>
            )}
            {error && <p id="profile-username-error" className="pf-message pf-message--error" role="alert">{error}</p>}
            {!error && isEditing && <p id="profile-username-help" className="pf-row__hint">3–20 characters: letters, numbers, underscores, and hyphens only.</p>}
        </SettingsRow>
    );
}

function SignInSetting({ hasPassword, googleLinked, googleStatus, onSave }) {
    const [isEditing, setIsEditing] = useState(false);
    const [currentPassword, setCurrentPassword] = useState("");
    const [newPassword, setNewPassword] = useState("");
    const [confirmPassword, setConfirmPassword] = useState("");
    const [error, setError] = useState(null);
    const [notice, setNotice] = useState(null);
    const [isSaving, setIsSaving] = useState(false);

    const cancel = () => {
        setCurrentPassword("");
        setNewPassword("");
        setConfirmPassword("");
        setError(null);
        setIsEditing(false);
    };

    const handleSubmit = async (event) => {
        event.preventDefault();
        setError(null);
        setNotice(null);
        const currentPasswordError = passwordError(currentPassword);
        const nextPasswordError = newPasswordError(newPassword);
        if (currentPasswordError) {
            setError(currentPasswordError);
            return;
        }
        if (nextPasswordError) {
            setError(nextPasswordError);
            return;
        }
        if (newPassword !== confirmPassword) {
            setError("Passwords do not match.");
            return;
        }

        setIsSaving(true);
        try {
            await onSave({ currentPassword, newPassword, confirmPassword });
            cancel();
            setNotice("Password updated successfully.");
        } catch (submissionError) {
            setError(userFacingAuthError(submissionError, "Your password could not be updated. Check your current password and try again."));
        } finally {
            setIsSaving(false);
        }
    };

    const description = hasPassword
        ? (googleLinked ? "Email and password. Google is also linked." : "Email and password.")
        : (googleLinked
            ? "Google account. Password is managed by Google."
            : "This account does not use password sign-in.");

    const action = (
        <>
            {hasPassword && !isEditing && (
                <button type="button" onClick={() => { setNotice(null); setError(null); setIsEditing(true); }} className="pf-btn">Change password</button>
            )}
            {googleStatus === "ready" && (googleLinked ? (
                <span className="pf-badge pf-badge--linked"><svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="9" /><path d="m8 12 3 3 5-6" /></svg>Linked</span>
            ) : (
                <button type="button" onClick={() => window.location.assign(apiUrl("/api/auth/google/link"))} className="pf-btn">Link Google account</button>
            ))}
        </>
    );

    return (
        <SettingsRow label="Sign-in" action={action}>
            <p className="pf-row__hint">{description}</p>
            {isEditing && (
                <form onSubmit={handleSubmit} className="pf-form">
                    <label htmlFor="profile-current-password" className="pf-field">
                        <span>Current password</span>
                        <input
                            id="profile-current-password"
                            name="currentPassword"
                            type="password"
                            value={currentPassword}
                            onChange={(event) => setCurrentPassword(event.target.value)}
                            autoComplete="current-password"
                            required
                            className="pf-input"
                        />
                    </label>
                    <label htmlFor="profile-new-password" className="pf-field">
                        <span>New password</span>
                        <input
                            id="profile-new-password"
                            name="newPassword"
                            type="password"
                            value={newPassword}
                            onChange={(event) => setNewPassword(event.target.value)}
                            autoComplete="new-password"
                            required
                            className="pf-input"
                        />
                    </label>
                    <label htmlFor="profile-confirm-password" className="pf-field">
                        <span>Confirm password</span>
                        <input
                            id="profile-confirm-password"
                            name="confirmPassword"
                            type="password"
                            value={confirmPassword}
                            onChange={(event) => setConfirmPassword(event.target.value)}
                            autoComplete="new-password"
                            required
                            className="pf-input"
                        />
                    </label>
                    {error && <p className="pf-message pf-message--error" role="alert">{error}</p>}
                    <p className="pf-row__hint">Use 8–128 characters without spaces.</p>
                    <div className="pf-form__actions">
                        <button type="submit" disabled={isSaving} className="pf-btn pf-btn--primary">
                            {isSaving ? "Saving..." : "Save"}
                        </button>
                        <button type="button" onClick={cancel} className="pf-btn">Cancel</button>
                    </div>
                </form>
            )}
            {error && !isEditing && <p className="pf-message pf-message--error" role="alert">{error}</p>}
            {notice && <p className="pf-message pf-message--success" role="status">{notice}</p>}
        </SettingsRow>
    );
}
