import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import AppNavbar from "../../components/AppNavbar";
import { useAuth } from "../../auth/auth-context";
import { apiUrl } from "../../config/api";
import { useMatchmaking } from "../../matchmaking/matchmaking-context";
import { MATCH_MODES, QUEUE_MODES } from "../../matchmaking/matchModes";

function formatQueueTime(elapsedSeconds) {
    const minutes = Math.floor(elapsedSeconds / 60);
    const seconds = elapsedSeconds % 60;
    return `${minutes}:${String(seconds).padStart(2, "0")}`;
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
            <span className={`grid shrink-0 place-items-center rounded-full border border-cyan-300/35 bg-[#071a29] ${count > 1 ? "grid-cols-2" : ""} ${large ? "h-14 w-14 sm:h-16 sm:w-16" : "h-8 w-8"}`} aria-hidden="true">
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

function QueueArrow() {
    return <span className="flex h-10 w-7 shrink-0 items-center justify-center font-interface text-4xl font-light leading-none text-cyan-300" aria-hidden="true">›</span>;
}

export default function QueuePage() {
    const navigate = useNavigate();
    const { user } = useAuth();
    const [customLobby, setCustomLobby] = useState(null);
    const [customLobbyChecked, setCustomLobbyChecked] = useState(false);
    const [profile, setProfile] = useState(null);
    const {
        isQueueing,
        queueMode,
        queueElapsed,
        queueReconnectRemaining,
        connectionStatus,
        startQueue,
        cancelQueue,
        party,
    } = useMatchmaking();
    const [selectedMode, setSelectedMode] = useState(queueMode ?? MATCH_MODES.ONES);
    const [partyQueueNotice, setPartyQueueNotice] = useState(null);

    useEffect(() => {
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
    }, []);

    useEffect(() => {
        let disposed = false;
        const loadProfile = async () => {
            try {
                const response = await fetch(apiUrl("/api/profile"), {
                    credentials: "include",
                    cache: "no-store",
                });
                if (!disposed && response.ok) {
                    const nextProfile = await response.json().catch(() => null);
                    if (nextProfile) setProfile(nextProfile);
                }
            } catch {
                // The cards can render without stats if this optional snapshot fails.
            }
        };
        void loadProfile();
        return () => {
            disposed = true;
        };
    }, []);

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
        void startQueue(mode.id);
    };

    return (
        <main className="min-h-screen bg-[#171a1c] font-interface text-slate-100">
            <AppNavbar account />
            <section className="mx-auto flex min-h-[calc(100vh-72px)] w-full max-w-5xl flex-col px-5 py-8 sm:px-8 sm:py-12">
                <button
                    type="button"
                    onClick={() => navigate("/home")}
                    className="mb-8 self-start font-mono text-[10px] font-bold tracking-[.18em] text-slate-500 hover:text-cyan-200"
                >
                    ← BACK TO HOME
                </button>

                <header className="max-w-2xl">
                    <p className="font-mono text-[10px] font-bold tracking-[.24em] text-cyan-400">MATCHMAKING</p>
                    <h1 className="mt-3 font-display-action text-5xl uppercase tracking-wide text-white sm:text-7xl">Choose your queue</h1>
                </header>

                <div className="mt-10 grid gap-4 md:grid-cols-2">
                    {QUEUE_MODES.map((mode) => {
                        const active = isQueueing && displayedMode === mode.id;
                        const playersPerTeam = mode.id === MATCH_MODES.TWOS ? 2 : 1;
                        const partySizeBlocked = isFullParty && mode.id === MATCH_MODES.ONES;
                        const modeStats = mode.id === MATCH_MODES.TWOS
                            ? profile?.queueStats?.twos
                            : profile?.queueStats?.ones;
                        return (
                            <button
                                type="button"
                                key={mode.id}
                                disabled={!mode.available || (!active && (isQueueing || (modeBlocked(mode) && !(partySizeBlocked && isPartyLeader))))}
                                onClick={() => { if (active) cancelQueue(); else requestQueue(mode); }}
                                aria-label={active ? `Cancel ${mode.label} queue` : `Queue ${mode.label}`}
                                className={`relative flex min-h-44 w-full items-center rounded-2xl border p-4 text-left transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cyan-200 sm:p-6 ${active
                                        ? "border-cyan-400/80 bg-cyan-950/35 shadow-[0_0_36px_rgba(34,211,238,.08)]"
                                        : "border-slate-600/80 bg-[#0d161d]"
                                    } ${!mode.available ? "cursor-not-allowed opacity-65" : "hover:border-cyan-400/50"}`}
                            >
                                <span className="flex w-full min-w-0 items-center gap-4 sm:gap-6">
                                    <QueuePlayerGroup count={playersPerTeam} side="left" large />
                                    <span className="min-w-0 flex-1">
                                        <span className="block whitespace-nowrap font-display-action text-2xl tracking-wide text-white sm:text-3xl">Queue {mode.label}</span>
                                        <span className="mt-4 block">
                                            <span className="block font-mono text-[10px] font-bold tracking-[.18em] text-slate-400">ELO</span>
                                            <span className="mt-1 block font-mono text-2xl font-bold leading-none tracking-normal text-white sm:text-3xl">{modeStats?.elo ?? 1000}</span>
                                        </span>
                                        <span className="mt-4 block border-t border-slate-700/70 pt-3">
                                            <span className="block font-mono text-[10px] font-bold tracking-[.18em] text-slate-400">RECORD</span>
                                            <span className="mt-2 block whitespace-nowrap font-mono text-sm font-bold tracking-[.12em] text-white sm:text-base">
                                                {modeStats?.wins ?? 0}W <span className="text-slate-500">—</span> {modeStats?.losses ?? 0}L <span className="text-slate-500">—</span> {modeStats?.draws ?? 0}D
                                            </span>
                                        </span>
                                    </span>
                                    {active
                                        ? <span className="min-w-14 text-center font-mono text-sm font-bold tracking-widest text-cyan-300" aria-live="polite">
                                            <span aria-hidden="true">{formatQueueTime(queueElapsed)}</span>
                                            {connectionStatus !== "CONNECTED" && (
                                                <span className="mt-1 block text-[9px] leading-3 text-amber-300">
                                                    RECONNECTING{queueReconnectRemaining > 0 ? ` · ${queueReconnectRemaining}s` : ""}
                                                </span>
                                            )}
                                        </span>
                                        : <QueueArrow />}
                                </span>
                            </button>
                        );
                    })}

                    <button
                        type="button"
                        onClick={() => navigate("/custom-lobby", hasCustomLobby ? undefined : { state: { create: true } })}
                        disabled={isQueueing || !customLobbyChecked}
                        aria-label={hasCustomLobby ? "Open custom lobby" : "Create custom lobby"}
                        className="relative flex min-h-44 w-full items-center rounded-2xl border border-slate-600/80 bg-[#202427] p-4 text-left transition hover:border-slate-400/80 hover:bg-[#2a3034] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cyan-200 disabled:cursor-not-allowed disabled:opacity-50 sm:p-6 md:col-span-2 md:mx-auto md:w-[calc(50%_-_0.5rem)]"
                    >
                        <span className="flex w-full min-w-0 items-center gap-4 sm:gap-6">
                            <QueuePlayerGroup count={4} side="left" />
                            <span className="min-w-0 flex-1">
                                <span className="block font-display-action text-lg leading-tight tracking-wide text-white sm:whitespace-nowrap sm:text-2xl">
                                    {!customLobbyChecked ? "CHECKING..." : hasCustomLobby ? "OPEN CUSTOM LOBBY" : "CREATE CUSTOM LOBBY"}
                                </span>
                                <span className="mt-2 block text-sm leading-5 text-slate-400 sm:text-base">
                                    <span className="block">Play privately with friends.</span>
                                    <span className="block">Up to 4 players.</span>
                                </span>
                            </span>
                            <QueueArrow />
                        </span>
                    </button>
                </div>

                {(partyQueueBlocked || partyHasOfflineMember) && (
                    <section className="mt-5 rounded-xl border border-slate-800 bg-[#07111b] p-5 sm:p-6">
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
