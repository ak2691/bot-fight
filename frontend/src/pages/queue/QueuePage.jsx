import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import AppNavbar from "../../components/AppNavbar";
import { useAuth } from "../../auth/auth-context";
import { apiUrl } from "../../config/api";
import { useMatchmaking } from "../../matchmaking/matchmaking-context";
import { MATCH_MODES, QUEUE_MODES } from "../../matchmaking/matchModes";
import { cacheProfileStats, loadCachedProfileStats } from "../profile/profileStatsCache.js";
import QueueAbilityGuaranteePicker from "./QueueAbilityGuaranteePicker.jsx";

function formatQueueTime(elapsedSeconds) {
    const minutes = Math.floor(elapsedSeconds / 60);
    const seconds = elapsedSeconds % 60;
    return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

function numericStat(value) {
    if (value === null || value === undefined || value === "") return null;
    const numeric = Number(value);
    return Number.isFinite(numeric) ? numeric : null;
}

function formatQueueElo(stats) {
    if (stats?.elo == null) return "N/A";
    return numericStat(stats?.elo) ?? "...";
}

function formatQueueRecord(stats) {
    const values = [stats?.wins, stats?.losses, stats?.draws].map(numericStat);
    return values.every((value) => value !== null) ? values.join("-") : "...";
}

const PARTY_QUEUE_NOTICE_DURATION_MS = 3500;

function QueuePlayerIcon({ large = false, grouped = false }) {
    const sizeClass = grouped
        ? large ? "h-7 w-7 text-cyan-300 sm:h-8 sm:w-8" : "h-5 w-5 text-cyan-200"
        : large ? "h-14 w-14 text-cyan-300 sm:h-16 sm:w-16" : "h-8 w-8 text-cyan-200";
    const iconClass = grouped
        ? large ? "h-6 w-6 sm:h-7 sm:w-7" : "h-4 w-4"
        : large ? "h-7 w-7 sm:h-8 sm:w-8" : "h-5 w-5";
    const surfaceClass = grouped
        ? "rounded-none border-0 bg-transparent"
        : "rounded-full border border-cyan-300/35 bg-[#071a29]";
    return (
        <span className={`grid shrink-0 place-items-center ${surfaceClass} ${sizeClass}`} aria-hidden="true">
            <svg viewBox="0 0 24 24" className={`${iconClass} fill-none stroke-current`} strokeWidth="1.7">
                <circle cx="12" cy="8" r="3.25" />
                <path d="M5.75 19c.7-3.45 2.78-5.25 6.25-5.25s5.55 1.8 6.25 5.25" />
            </svg>
        </span>
    );
}

function QueuePlayerGroup({ count, side, large = false, grouped = large }) {
    if (grouped) {
        return (
            <span className={`grid shrink-0 place-items-center rounded-lg border border-cyan-300/45 bg-[#102c38] ${count > 1 ? "grid-cols-2" : ""} ${large ? "h-14 w-14 sm:h-16 sm:w-16" : "h-8 w-8"}`} aria-hidden="true">
                {Array.from({ length: count }, (_, index) => <QueuePlayerIcon key={`${side}-${index}`} large={large} grouped />)}
            </span>
        );
    }
    return (
        <span className={`flex min-w-0 items-center ${large ? "gap-2" : "gap-1"} ${side === "right" ? "justify-end" : ""}`} aria-hidden="true">
            {Array.from({ length: count }, (_, index) => <QueuePlayerIcon key={`${side}-${index}`} large={large} />)}
        </span>
    );
}

export default function QueuePage() {
    const navigate = useNavigate();
    const { user, isGuest } = useAuth();
    const profileCacheKey = user?.authenticated === true ? user.id ?? user.username : null;
    const [customLobby, setCustomLobby] = useState(null);
    const [customLobbyChecked, setCustomLobbyChecked] = useState(false);
    const [profileStats, setProfileStats] = useState(() => loadCachedProfileStats(profileCacheKey));
    const {
        isQueueing,
        queueMode,
        queueElapsed,
        queueReconnectRemaining,
        connectionStatus,
        queueGuarantees,
        updateQueueGuarantee,
        startQueue,
        cancelQueue,
        party,
    } = useMatchmaking();
    const [selectedMode, setSelectedMode] = useState(queueMode ?? MATCH_MODES.ONES);
    const [partyQueueNotice, setPartyQueueNotice] = useState(null);

    useEffect(() => {
        if (isGuest) {
            setCustomLobby(null);
            setCustomLobbyChecked(true);
            return undefined;
        }
        let disposed = false;
        const loadCurrentCustomLobby = async () => {
            try {
                const response = await fetch(apiUrl("/api/custom-lobbies/current"), {
                    credentials: "include",
                    cache: "no-store",
                });
                if (!disposed && response.ok) {
                    setCustomLobby(await response.json().catch(() => null));
                }
            } catch {
                // The custom lobby page remains the source of truth if this snapshot fails.
            } finally {
                if (!disposed) setCustomLobbyChecked(true);
            }
        };
        void loadCurrentCustomLobby();
        return () => {
            disposed = true;
        };
    }, [isGuest]);

    useEffect(() => {
        let disposed = false;
        setProfileStats(loadCachedProfileStats(profileCacheKey));
        const loadProfile = async () => {
            try {
                const response = await fetch(apiUrl("/api/profile"), {
                    credentials: "include",
                    cache: "no-store",
                });
                if (!disposed && response.ok) {
                    const nextProfile = await response.json().catch(() => null);
                    if (nextProfile) {
                        const nextStats = cacheProfileStats(profileCacheKey, nextProfile.queueStats);
                        setProfileStats(nextStats);
                    }
                }
            } catch {
                // The cards can render without stats if this optional snapshot fails.
            }
        };
        void loadProfile();
        return () => {
            disposed = true;
        };
    }, [profileCacheKey]);

    useEffect(() => {
        if (!partyQueueNotice) return undefined;
        const timeoutId = window.setTimeout(() => setPartyQueueNotice(null), PARTY_QUEUE_NOTICE_DURATION_MS);
        return () => window.clearTimeout(timeoutId);
    }, [partyQueueNotice]);

    const displayedMode = isQueueing && queueMode ? queueMode : selectedMode;
    const members = party?.members ?? [];
    const isPartyLeader = members.some((member) => (
        member.leader === true && String(member.userId) === String(user?.id)
    ));
    const isFullParty = Boolean(party && members.length >= party.capacity);
    const partyHasOfflineMember = Boolean(party && members.some((member) => member.online === false));
    const partyQueueBlocked = Boolean(party && !isPartyLeader);
    const hasCustomLobby = Boolean(customLobby?.lobbyId);

    const modeBlocked = (mode) => (
        partyQueueBlocked
        || partyHasOfflineMember
        || (isFullParty && mode.id === MATCH_MODES.ONES)
    );

    const requestQueue = (mode) => {
        if (!mode.available || isQueueing) return;
        if (isFullParty && mode.id === MATCH_MODES.ONES) {
            setPartyQueueNotice("A party of 2 cannot queue a 1v1.");
            return;
        }
        if (modeBlocked(mode)) return;
        setSelectedMode(mode.id);
        void startQueue(mode.id, queueGuarantees);
    };

    return (
        <main className="queue-page min-h-screen bg-[#171a1c] font-interface text-slate-100">
            <AppNavbar account />
            <section className="mx-auto flex min-h-[calc(100vh-72px)] w-full max-w-5xl flex-col px-5 py-7 sm:px-8 sm:py-9">
                <header className="max-w-2xl">
                    <p className="font-mono text-[10px] font-bold tracking-[.24em] text-cyan-400">MATCHMAKING</p>
                    <h1 className="mt-2 font-display-action text-5xl uppercase tracking-wide text-white sm:text-6xl">Choose your queue</h1>
                    {isGuest && (
                        <p className="mt-4 max-w-xl rounded-lg border border-amber-400/35 bg-amber-950/20 px-4 py-3 text-xs leading-5 text-amber-200" role="status">
                            Guest matches are against other guests only. No Elo or match history is saved.
                        </p>
                    )}
                </header>

                <QueueAbilityGuaranteePicker
                    key={isQueueing ? "queue-active" : "queue-idle"}
                    values={queueGuarantees}
                    onChange={updateQueueGuarantee}
                    disabled={isQueueing}
                />

                <section aria-labelledby="ranked-matchmaking-title" className="mt-7">
                    <h2 id="ranked-matchmaking-title" className="queue-section-title">Ranked Matchmaking</h2>
                    <div className="mt-3 grid gap-4 md:grid-cols-2">
                        {QUEUE_MODES.map((mode) => {
                            const active = isQueueing && displayedMode === mode.id;
                            const playersPerTeam = mode.id === MATCH_MODES.TWOS ? 2 : 1;
                            const partySizeBlocked = isFullParty && mode.id === MATCH_MODES.ONES;
                            const modeStats = mode.id === MATCH_MODES.TWOS
                                ? profileStats?.twos
                                : profileStats?.ones;
                            const queueActionDisabled = !mode.available || (!active && (isQueueing || (modeBlocked(mode) && !(partySizeBlocked && isPartyLeader))));
                            return (
                                <article
                                    key={mode.id}
                                    aria-label={`Queue ${mode.label}`}
                                    data-active={active ? "true" : undefined}
                                    className="queue-mode-card flex w-full flex-col rounded-xl border p-4 text-left sm:p-5"
                                >
                                    <span className="flex w-full items-center gap-4">
                                        <QueuePlayerGroup count={playersPerTeam} side="left" large />
                                        <span className="min-w-0">
                                            <span className="block font-display-action text-2xl tracking-wide text-white sm:text-3xl">Queue {mode.label}</span>
                                            <span className="mt-1 block text-sm text-slate-300">{playersPerTeam === 1 ? "Solo" : "Team"} ranked matchmaking.</span>
                                        </span>
                                    </span>
                                    <span className="queue-mode-stats mt-4 w-full border-t border-slate-600/60 pt-3">
                                        <span>
                                            <span className="block font-mono text-[9px] font-bold tracking-[.2em] text-slate-400">ELO</span>
                                            <span className="mt-1 block font-mono text-xl font-bold leading-none text-white">{formatQueueElo(modeStats)}</span>
                                        </span>
                                        <span>
                                            <span className="block font-mono text-[9px] font-bold tracking-[.2em] text-slate-400">RECORD</span>
                                            <span className="mt-1 block whitespace-nowrap font-mono text-lg font-bold leading-none text-white">{formatQueueRecord(modeStats)}</span>
                                            <span className="mt-1 block font-mono text-[8px] font-bold tracking-[.16em] text-cyan-300">W-L-D</span>
                                        </span>
                                    </span>
                                    <button
                                        type="button"
                                        disabled={queueActionDisabled}
                                        onClick={() => { if (active) cancelQueue(); else requestQueue(mode); }}
                                        aria-label={active ? `Cancel ${mode.label} queue` : `Find ${mode.label} match`}
                                        className="queue-mode-cta mt-4 flex w-full items-center justify-center gap-3 rounded-lg border px-4 py-3 font-mono text-[11px] font-bold tracking-[.14em] text-cyan-100 transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cyan-200 disabled:cursor-not-allowed disabled:opacity-55"
                                    >
                                        <span>{active ? "CANCEL QUEUE" : "FIND MATCH"}</span>
                                        {active && <span aria-live="polite">{formatQueueTime(queueElapsed)}</span>}
                                    </button>
                                    {active && connectionStatus !== "CONNECTED" && (
                                        <span className="mt-2 block text-[9px] font-bold tracking-wider text-amber-300">
                                            RECONNECTING{queueReconnectRemaining > 0 ? ` · ${queueReconnectRemaining}s` : ""}
                                        </span>
                                    )}
                                </article>
                            );
                        })}
                    </div>
                </section>

                {!isGuest && <section aria-labelledby="private-matches-title" className="mt-7">
                    <h2 id="private-matches-title" className="queue-section-title">Private Matches</h2>
                    <button
                        type="button"
                        onClick={() => navigate("/custom-lobby", hasCustomLobby ? undefined : { state: { create: true } })}
                        disabled={isQueueing || !customLobbyChecked}
                        aria-label={hasCustomLobby ? "Open custom lobby" : "Create custom lobby"}
                        className="queue-custom-card mt-3 flex w-full flex-wrap items-center gap-4 rounded-xl border p-4 text-left transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cyan-200 disabled:cursor-not-allowed disabled:opacity-50 sm:flex-nowrap sm:p-5"
                    >
                        <QueuePlayerGroup count={4} side="left" large />
                        <span className="min-w-0 flex-1">
                            <span className="block font-display-action text-xl tracking-wide text-white sm:text-2xl">
                                {!customLobbyChecked ? "CHECKING..." : hasCustomLobby ? "OPEN CUSTOM LOBBY" : "CREATE CUSTOM LOBBY"}
                            </span>
                            <span className="mt-1 block text-sm text-slate-300">Play privately with friends. Up to 4 players.</span>
                        </span>
                        <span className="queue-custom-cta flex w-full items-center justify-center gap-3 rounded-lg border px-4 py-3 font-mono text-[11px] font-bold tracking-[.12em] text-cyan-100 sm:w-auto sm:min-w-44">
                            {hasCustomLobby ? "OPEN LOBBY" : "CREATE MATCH"}
                        </span>
                    </button>
                </section>}

                {(partyQueueBlocked || partyHasOfflineMember) && (
                    <section className="queue-notice mt-5 rounded-xl border border-slate-800 bg-[#07111b] p-5 sm:p-6">
                        {partyQueueBlocked && <p className="text-xs text-amber-300">Only the party leader can start the party queue.</p>}
                        {partyHasOfflineMember && (
                            <p className={`text-xs leading-5 text-amber-300 ${partyQueueBlocked ? "mt-3" : ""}`}>
                                {isQueueing
                                    ? "A party member is offline. A match cannot be found until everyone is online. The queue timer continues while they reconnect."
                                    : "Every party member must be online before the queue can start."}
                            </p>
                        )}
                    </section>
                )}

            </section>
            {partyQueueNotice && (
                <div className="pointer-events-none fixed inset-x-0 bottom-6 z-50 flex justify-center px-5">
                    <p className="pointer-events-auto rounded border border-amber-400/50 bg-[#171a1c]/95 px-4 py-3 text-center text-xs font-semibold text-amber-200 shadow-2xl backdrop-blur-sm" role="alert">{partyQueueNotice}</p>
                </div>
            )}
        </main>
    );
}
