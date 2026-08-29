import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import AppNavbar from "../../components/AppNavbar";
import { useDialogFocus } from "../../components/useDialogFocus.js";
import { useAuth } from "../../auth/auth-context";
import { apiUrl } from "../../config/api";
import { ensureCsrfHeaders } from "../../security/csrf";
import { useMatchmaking } from "../../matchmaking/matchmaking-context";
import CustomLobbyChat from "./CustomLobbyChat.jsx";

const TEAM_NONE = 0;
const BLUE_TEAM = 1;
const RED_TEAM = 2;
const MAX_TEAM_SIZE = 2;
const STATUS_MESSAGE_DURATION_MS = 3500;
const INVITE_RATE_LIMIT_MESSAGE = "Inviting too fast, please wait";
const INVITE_FAILURE_MESSAGE = "Can not invite this player";
const MIN_ROUND_DURATION_SECONDS = 30;
const MAX_ROUND_DURATION_SECONDS = 10 * 60;

async function customLobbyRequest(path, { method = "GET", body } = {}) {
    const headers = method === "GET" || method === "HEAD"
        ? {}
        : {
            ...(body == null ? {} : { "Content-Type": "application/json" }),
            ...(await ensureCsrfHeaders(method)),
        };
    const response = await fetch(apiUrl(path), {
        method,
        credentials: "include",
        headers,
        body: body == null ? undefined : JSON.stringify(body),
    });
    const responseBody = await response.json().catch(() => null);
    if (!response.ok) {
        const error = new Error(responseBody?.message ?? "The custom lobby action could not be completed.");
        error.status = response.status;
        throw error;
    }
    return responseBody;
}

function memberIsCurrent(member, userId) {
    return member && userId && String(member.userId) === String(userId);
}

function teamLabel(teamNumber) {
    if (Number(teamNumber) === BLUE_TEAM) return "BLUE TEAM";
    if (Number(teamNumber) === RED_TEAM) return "RED TEAM";
    return "NOT READY";
}

function teamTone(teamNumber) {
    if (Number(teamNumber) === BLUE_TEAM) return "blue";
    if (Number(teamNumber) === RED_TEAM) return "red";
    return "none";
}

function formatRoundDuration(seconds) {
    const totalSeconds = Number(seconds);
    if (!Number.isFinite(totalSeconds) || totalSeconds < MIN_ROUND_DURATION_SECONDS) return "5 MINUTES";
    if (totalSeconds % 60 === 0) return `${totalSeconds / 60} MINUTES`;
    return `${Math.floor(totalSeconds / 60)}:${String(totalSeconds % 60).padStart(2, "0")}`;
}

function MoreVerticalIcon() {
    return (
        <svg viewBox="0 0 24 24" className="h-5 w-5 fill-current" aria-hidden="true">
            <circle cx="12" cy="5" r="1.6" />
            <circle cx="12" cy="12" r="1.6" />
            <circle cx="12" cy="19" r="1.6" />
        </svg>
    );
}

function normalizeMinimumRoundDuration(value) {
    const seconds = Number(value);
    if (!Number.isFinite(seconds)) return String(MIN_ROUND_DURATION_SECONDS);
    return String(Math.max(MIN_ROUND_DURATION_SECONDS, Math.floor(seconds)));
}

function CustomLobbySettingsModal({ roundSeconds, onRoundSecondsChange, onClose, onSubmit, saving, error }) {
    const dialogRef = useRef(null);
    useDialogFocus(dialogRef, {
        onClose,
        lockScroll: true,
        enabled: true,
    });

    return (
        <div className="fixed inset-0 z-[110] grid place-items-center bg-black/75 p-4 backdrop-blur-sm" onMouseDown={(event) => { if (event.target === event.currentTarget && !saving) onClose(); }}>
            <section ref={dialogRef} className="w-[min(92vw,520px)] rounded-xl border border-cyan-700/70 bg-[#11171a] shadow-2xl" role="dialog" aria-modal="true" aria-labelledby="custom-lobby-settings-title" tabIndex={-1}>
                <header className="flex items-center justify-between gap-4 border-b border-slate-700/80 bg-slate-950/70 px-5 py-4">
                    <div>
                        <p className="font-mono text-[9px] font-bold tracking-[.2em] text-cyan-300">CUSTOM LOBBY CONFIG</p>
                        <h2 id="custom-lobby-settings-title" className="mt-1 text-lg font-bold text-white">Match settings</h2>
                    </div>
                    <button type="button" onClick={onClose} disabled={saving} aria-label="Close custom lobby settings" className="modal-close-button disabled:cursor-wait disabled:opacity-50"><span aria-hidden="true">×</span></button>
                </header>
                <form onSubmit={onSubmit}>
                    <div className="space-y-4 p-5">
                        <div>
                            <label className="flex min-h-11 items-center justify-between gap-4 border-b border-slate-800/80 pb-2 font-mono text-[9px] font-bold tracking-[.12em] text-slate-300" htmlFor="custom-lobby-round-seconds">
                                <span>ROUND TIME / SEC</span>
                                <div className="flex items-center gap-2">
                                    <input
                                        id="custom-lobby-round-seconds"
                                        type="number" min="30" max="600" step="1"
                                        value={roundSeconds}
                                        onChange={(event) => onRoundSecondsChange(event.target.value)}
                                        onBlur={() => onRoundSecondsChange(normalizeMinimumRoundDuration(roundSeconds))}
                                        onKeyDown={(event) => {
                                            if (event.key !== "Enter") return;
                                            event.preventDefault();
                                            onRoundSecondsChange(normalizeMinimumRoundDuration(event.currentTarget.value));
                                        }}
                                        aria-label="Custom match round time in seconds"
                                        className="h-9 w-24 border border-slate-700 bg-slate-950 px-2 text-center font-interface-numeric text-sm text-white outline-none focus:border-cyan-400"
                                    />
                                    <span className="text-[8px] tracking-widest text-slate-500">SECONDS</span>
                                </div>
                            </label>
                            <p className="mt-3 text-xs leading-5 text-slate-500">Choose how long players have to build each round.</p>
                            <p className="mt-1 font-mono text-[9px] tracking-widest text-slate-600">30–600 SECONDS</p>
                        </div>
                        {error && <p className="border border-rose-400/40 bg-rose-950/20 px-3 py-2 text-xs leading-5 text-rose-200" role="alert">{error}</p>}
                    </div>
                    <footer className="flex justify-end gap-2 border-t border-slate-700/80 bg-slate-950/70 px-5 py-4">
                        <button type="button" onClick={onClose} disabled={saving} className="gray-button-surface min-h-10 border border-slate-600 px-5 font-mono text-[10px] font-bold tracking-[.16em] text-slate-300 disabled:cursor-wait disabled:opacity-50">CANCEL</button>
                        <button type="submit" disabled={saving} className="gray-button-surface min-h-10 border border-cyan-400 px-5 font-mono text-[10px] font-bold tracking-[.16em] text-cyan-100 disabled:cursor-wait disabled:opacity-50">{saving ? "SAVING..." : "SAVE SETTINGS"}</button>
                    </footer>
                </form>
            </section>
        </div>
    );
}

export default function CustomLobbyPage() {
    const navigate = useNavigate();
    const location = useLocation();
    const { user } = useAuth();
    const { customLobbyEvent, markActiveMatch, sendCustomLobbyChat } = useMatchmaking();
    const [lobby, setLobby] = useState(null);
    const [loadState, setLoadState] = useState("loading");
    const [error, setError] = useState(null);
    const [notice, setNotice] = useState(null);
    const [inviteUsername, setInviteUsername] = useState("");
    const [inviteStatus, setInviteStatus] = useState(null);
    const [roundSeconds, setRoundSeconds] = useState("300");
    const [settingsOpen, setSettingsOpen] = useState(false);
    const [action, setAction] = useState(null);
    const [chatMessages, setChatMessages] = useState([]);
    const [chatNotice, setChatNotice] = useState(null);
    const lobbyIdRef = useRef(null);
    const redirectingToMatchRef = useRef(false);
    const shouldCreate = location.state?.create === true;

    const redirectToMatch = useCallback((matchId) => {
        if (!matchId || redirectingToMatchRef.current) return;
        redirectingToMatchRef.current = true;
        markActiveMatch(matchId);
        navigate("/match", {
            state: {
                activeMatchVerified: true,
                matchId,
            },
        });
    }, [markActiveMatch, navigate]);

    useEffect(() => {
        if (!customLobbyEvent) return;
        if (customLobbyEvent.type === "CUSTOM_LOBBY_MATCH_STARTED") return;
        if (customLobbyEvent.type !== "CUSTOM_LOBBY_STATE") return;
        if (!customLobbyEvent.lobby && !customLobbyEvent.message && lobbyIdRef.current) return;
        lobbyIdRef.current = customLobbyEvent.lobby?.lobbyId ?? null;
        setLobby(customLobbyEvent.lobby ?? null);
        setLoadState(customLobbyEvent.lobby ? "ready" : "empty");
        if (customLobbyEvent.lobby) setError(null);
        if (!customLobbyEvent.lobby && customLobbyEvent.message) {
            setNotice(customLobbyEvent.message);
        }
    }, [customLobbyEvent]);

    useEffect(() => {
        if (!customLobbyEvent
            || !customLobbyEvent.type?.startsWith("CUSTOM_LOBBY_CHAT_")) return;
        const activeLobbyId = lobby?.lobbyId ?? lobbyIdRef.current;
        if (!activeLobbyId
            || !customLobbyEvent.lobbyId
            || String(activeLobbyId) !== String(customLobbyEvent.lobbyId)) return;
        if (customLobbyEvent.type === "CUSTOM_LOBBY_CHAT_MESSAGE") {
            setChatMessages((current) => {
                if (current.some((message) => message.messageId === customLobbyEvent.messageId)) return current;
                return [...current, customLobbyEvent].slice(-100);
            });
            return;
        }
        setChatNotice(customLobbyEvent.message ?? "Lobby chat is unavailable.");
    }, [customLobbyEvent, lobby?.lobbyId]);

    useEffect(() => {
        setChatMessages([]);
        setChatNotice(null);
    }, [lobby?.lobbyId]);

    useEffect(() => {
        if (lobby?.roundDurationSeconds == null) return;
        setRoundSeconds(String(Number(lobby.roundDurationSeconds)));
    }, [lobby?.lobbyId, lobby?.roundDurationSeconds]);

    useEffect(() => {
        if (!notice && !error) return undefined;
        if (loadState === "error") return undefined;
        const timeoutId = window.setTimeout(() => {
            setNotice(null);
            setError(null);
        }, STATUS_MESSAGE_DURATION_MS);
        return () => window.clearTimeout(timeoutId);
    }, [error, loadState, notice]);

    useEffect(() => {
        if (!inviteStatus) return undefined;
        const timeoutId = window.setTimeout(() => setInviteStatus(null), STATUS_MESSAGE_DURATION_MS);
        return () => window.clearTimeout(timeoutId);
    }, [inviteStatus]);

    useEffect(() => {
        if (!chatNotice) return undefined;
        const timeoutId = window.setTimeout(() => setChatNotice(null), STATUS_MESSAGE_DURATION_MS);
        return () => window.clearTimeout(timeoutId);
    }, [chatNotice]);

    useEffect(() => {
        let disposed = false;
        const loadLobby = async () => {
            setLoadState("loading");
            setError(null);
            try {
                const nextLobby = shouldCreate
                    ? await customLobbyRequest("/api/custom-lobbies", { method: "POST" })
                    : await customLobbyRequest("/api/custom-lobbies/current");
                if (disposed) return;
                lobbyIdRef.current = nextLobby?.lobbyId ?? null;
                setLobby(nextLobby);
                setLoadState(nextLobby ? "ready" : "empty");
            } catch (requestError) {
                if (disposed) return;
                if (!shouldCreate && requestError.status === 404) {
                    lobbyIdRef.current = null;
                    setLoadState("empty");
                    return;
                }
                setLoadState("error");
                setError(requestError.message ?? "The custom lobby could not be loaded.");
            }
        };
        void loadLobby();
        return () => {
            disposed = true;
        };
    }, [shouldCreate]);

    const members = useMemo(() => lobby?.members ?? [], [lobby?.members]);
    const currentMember = members.find((member) => memberIsCurrent(member, user?.id));
    const isOwner = Boolean(currentMember?.owner)
        || Boolean(lobby?.ownerId && String(lobby.ownerId) === String(user?.id));
    const teamCounts = useMemo(() => ({
        [BLUE_TEAM]: members.filter((member) => Number(member.teamNumber) === BLUE_TEAM).length,
        [RED_TEAM]: members.filter((member) => Number(member.teamNumber) === RED_TEAM).length,
    }), [members]);
    const everyoneOnTeam = members.length > 0 && members.every((member) => Number(member.teamNumber) > TEAM_NONE);
    const bothTeamsHavePlayers = teamCounts[BLUE_TEAM] > 0 && teamCounts[RED_TEAM] > 0;
    const everyoneOnline = members.every((member) => member.online !== false);
    const canStart = isOwner
        && members.length >= 2
        && members.length <= 4
        && everyoneOnTeam
        && bothTeamsHavePlayers
        && everyoneOnline
        && action === null;

    const performAction = async (
        name,
        request,
        successMessage = null,
        updateLobby = true,
        suppressRateLimitError = false,
        statusTarget = "page",
    ) => {
        setAction(name);
        setError(null);
        setNotice(null);
        setInviteStatus(null);
        try {
            const result = await request();
            if (updateLobby && result !== undefined && result !== null) {
                lobbyIdRef.current = result.lobbyId ?? lobbyIdRef.current;
                setLobby(result);
            }
            if (successMessage) {
                if (statusTarget === "invite") {
                    setInviteStatus({ kind: "success", message: successMessage });
                } else {
                    setNotice(successMessage);
                }
            }
            return result;
        } catch (requestError) {
            if (!(suppressRateLimitError && requestError.status === 429)) {
                if (statusTarget === "invite") {
                    setInviteStatus({
                        kind: "error",
                        message: requestError.status === 429
                            ? INVITE_RATE_LIMIT_MESSAGE
                            : INVITE_FAILURE_MESSAGE,
                    });
                } else {
                    setError(requestError.message ?? "The custom lobby action could not be completed.");
                }
            }
            return undefined;
        } finally {
            setAction(null);
        }
    };

    const createLobby = async () => {
        const result = await performAction(
            "create",
            () => customLobbyRequest("/api/custom-lobbies", { method: "POST" }),
        );
        if (result) setLoadState("ready");
        return result;
    };

    const invitePlayer = async (event) => {
        event.preventDefault();
        if (!lobby?.lobbyId || !inviteUsername.trim() || action !== null) return;
        const result = await performAction(
            "invite",
            () => customLobbyRequest(`/api/custom-lobbies/${encodeURIComponent(lobby.lobbyId)}/invites`, {
                method: "POST",
                body: { username: inviteUsername.trim() },
            }),
            `Invite sent to ${inviteUsername.trim()}.`,
            false,
            false,
            "invite",
        );
        if (result) setInviteUsername("");
    };

    const saveRoundDuration = async (event) => {
        event.preventDefault();
        if (!lobby?.lobbyId || !isOwner || action !== null) return;
        const normalizedRoundSeconds = normalizeMinimumRoundDuration(roundSeconds);
        if (normalizedRoundSeconds !== String(roundSeconds)) {
            setRoundSeconds(normalizedRoundSeconds);
        }
        const seconds = Number(normalizedRoundSeconds);
        if (seconds > MAX_ROUND_DURATION_SECONDS) {
            setError("Round time must be a whole number between 30 and 600 seconds.");
            return;
        }
        const result = await performAction(
            "settings",
            () => customLobbyRequest(`/api/custom-lobbies/${encodeURIComponent(lobby.lobbyId)}/settings`, {
                method: "POST",
                body: { roundDurationSeconds: seconds },
            }),
            "Round time updated.",
        );
        if (result) setSettingsOpen(false);
    };

    const closeSettings = () => {
        if (action !== null) return;
        setSettingsOpen(false);
        setError(null);
    };

    const changeTeam = (teamNumber) => {
        if (!lobby?.lobbyId || !currentMember || action !== null) return;
        return performAction(
            `team-${teamNumber}`,
            () => customLobbyRequest(`/api/custom-lobbies/${encodeURIComponent(lobby.lobbyId)}/team`, {
                method: "POST",
                body: { teamNumber },
            }),
            null,
            true,
            true,
        );
    };

    const leaveLobby = async () => {
        if (!lobby?.lobbyId || action !== null) return;
        const result = await performAction(
            "leave",
            () => customLobbyRequest(`/api/custom-lobbies/${encodeURIComponent(lobby.lobbyId)}/leave`, { method: "POST" }),
            null,
            false,
        );
        if (result !== undefined) navigate("/queue");
    };

    const kickPlayer = (member) => {
        if (!lobby?.lobbyId || !member?.userId || action !== null) return;
        return performAction(
            `kick-${member.userId}`,
            () => customLobbyRequest(`/api/custom-lobbies/${encodeURIComponent(lobby.lobbyId)}/members/${encodeURIComponent(member.userId)}/kick`, { method: "POST" }),
        );
    };

    const startMatch = async () => {
        if (!lobby?.lobbyId || !canStart || action !== null) return;
        const result = await performAction(
            "start",
            () => customLobbyRequest(`/api/custom-lobbies/${encodeURIComponent(lobby.lobbyId)}/start`, { method: "POST" }),
            null,
            false,
        );
        if (result?.matchId) redirectToMatch(result.matchId);
    };

    const sendLobbyChat = useCallback((message) => {
        if (!lobby?.lobbyId) return false;
        const sent = sendCustomLobbyChat(lobby.lobbyId, message);
        if (!sent) setChatNotice("Lobby chat is unavailable.");
        return sent;
    }, [lobby?.lobbyId, sendCustomLobbyChat]);

    return (
        <>
        <main className="min-h-screen bg-[#171a1c] font-interface text-slate-100">
            <AppNavbar account />
            <section className="mx-auto flex min-h-[calc(100vh-72px)] w-full max-w-6xl flex-col px-5 py-8 sm:px-8 sm:py-12">
                <button type="button" onClick={() => navigate("/queue")} className="mb-8 self-start font-mono text-[10px] font-bold tracking-[.18em] text-slate-500 hover:text-cyan-200">
                    ← BACK TO QUEUE
                </button>

                <header className="flex flex-col gap-5 border-b border-slate-800 pb-5 lg:flex-row lg:items-start lg:justify-between">
                    <div className="min-w-0 flex-1">
                        <p className="font-mono text-[10px] font-bold tracking-[.24em] text-cyan-400">CUSTOM MATCHMAKING</p>
                        <h1 className="mt-3 font-display-action text-5xl uppercase tracking-wide text-white sm:text-7xl">Custom lobby</h1>
                        {lobby && isOwner && lobby.members.length < (lobby.capacity ?? 4) && (
                            <form onSubmit={invitePlayer} className="mt-5 w-full max-w-sm">
                                <div className="flex items-center gap-2">
                                    <label className="sr-only" htmlFor="custom-lobby-invite-username">Invite player</label>
                                    <input id="custom-lobby-invite-username" type="text" value={inviteUsername} onChange={(event) => setInviteUsername(event.target.value)} maxLength={20} placeholder="Username" className="h-10 min-w-0 flex-1 border border-slate-600 bg-[#202427] px-3 text-sm text-white outline-none placeholder:text-slate-500 focus:border-cyan-400" />
                                    <button type="submit" disabled={!inviteUsername.trim() || action !== null} className="h-10 shrink-0 border border-cyan-300/80 bg-cyan-950/40 px-3 font-mono text-[9px] font-bold tracking-widest text-cyan-100 hover:bg-cyan-900/50 disabled:cursor-not-allowed disabled:opacity-50">{action === "invite" ? "INVITING..." : "INVITE PLAYER"}</button>
                                </div>
                                {inviteStatus && <p className={`mt-2 border-t border-slate-600/80 pt-2 text-[11px] leading-4 ${inviteStatus.kind === "error" ? "text-rose-200" : "text-emerald-200"}`} role={inviteStatus.kind === "error" ? "alert" : "status"}>{inviteStatus.message}</p>}
                            </form>
                        )}
                    </div>
                    {lobby && (
                        <div className="flex w-full shrink-0 items-start justify-between gap-4 rounded-xl border border-slate-800 bg-[#07111b] p-4 lg:ml-8 lg:w-auto lg:min-w-64">
                            <div className="min-w-0 flex-1">
                                <p className="font-mono text-[10px] font-bold tracking-[.2em] text-cyan-400">INVITE ONLY · MATCH SETTINGS</p>
                                <p className="mt-2 text-lg font-bold text-white">{lobby.members.length}/{lobby.capacity ?? 4} players in lobby</p>
                                <p className="mt-1 text-xs text-slate-500">Owner: {lobby.ownerUsername ?? "Unknown"}</p>
                                <p className="mt-4 border-t border-slate-800 pt-3 font-mono text-[9px] tracking-widest text-slate-500">ROUND TIME · {formatRoundDuration(lobby.roundDurationSeconds)}</p>
                            </div>
                            <div className="flex shrink-0 items-start gap-2">
                                {isOwner && (
                                    <button type="button" onClick={() => { setError(null); setSettingsOpen(true); }} disabled={action !== null} aria-label="Open custom lobby settings" title="Custom lobby settings" className="grid h-10 w-10 place-items-center border border-cyan-400/50 bg-cyan-950/20 text-cyan-200 hover:bg-cyan-900/40 disabled:cursor-wait disabled:opacity-50">
                                        <MoreVerticalIcon />
                                    </button>
                                )}
                                <button type="button" onClick={leaveLobby} disabled={action !== null} className="h-10 shrink-0 border border-rose-400/50 px-3 font-mono text-[9px] font-bold tracking-widest text-rose-200 hover:bg-rose-950/30 disabled:cursor-wait disabled:opacity-50">LEAVE LOBBY</button>
                            </div>
                        </div>
                    )}
                </header>

                {loadState === "loading" && <div className="mt-10 border border-slate-800 bg-[#07111b] px-6 py-12 text-center font-mono text-xs tracking-widest text-slate-500">LOADING LOBBY...</div>}
                {loadState === "error" && (
                    <div className="mt-10 border border-rose-400/40 bg-rose-950/20 px-6 py-8" role="alert">
                        <p className="text-sm text-rose-200">{error}</p>
                        <button type="button" onClick={createLobby} className="mt-5 h-11 border border-cyan-400/70 bg-cyan-950/40 px-5 font-mono text-[10px] font-bold tracking-widest text-cyan-100">CREATE CUSTOM LOBBY</button>
                    </div>
                )}
                {loadState === "empty" && (
                    <div className="mt-10 border border-cyan-900/80 bg-[#07111b] px-6 py-12 text-center">
                        <p className="font-mono text-[10px] font-bold tracking-[.2em] text-cyan-400">NO ACTIVE LOBBY</p>
                        <h2 className="mt-3 text-2xl font-bold text-white">Build a private room</h2>
                        <p className="mx-auto mt-3 max-w-md text-sm leading-6 text-slate-500">Create an invite-only lobby and send the room to the players you want to fight.</p>
                        <button type="button" onClick={createLobby} disabled={action !== null} className="mt-6 h-12 border border-cyan-400/70 bg-cyan-950/50 px-6 font-mono text-xs font-bold tracking-widest text-cyan-100 hover:bg-cyan-900/50 disabled:cursor-wait disabled:opacity-50">{action === "create" ? "CREATING..." : "CREATE CUSTOM LOBBY"}</button>
                    </div>
                )}
                {lobby && (
                    <>
                        <div className="mt-6 grid grid-cols-1 gap-5 lg:grid-cols-3 lg:items-start">
                            <div className="lg:col-span-2 flex min-h-0 flex-col gap-5 lg:self-stretch">
                                <div className="grid w-full gap-5 sm:grid-cols-2">
                                    <TeamColumn
                                        title="BLUE TEAM"
                                        subtitle={`${teamCounts[BLUE_TEAM]}/${MAX_TEAM_SIZE} team slots`}
                                        tone="blue"
                                        teamNumber={BLUE_TEAM}
                                        members={members.filter((member) => Number(member.teamNumber) === BLUE_TEAM)}
                                        userId={user?.id}
                                        owner={isOwner}
                                        action={action}
                                        onTeamChange={changeTeam}
                                        onKick={kickPlayer}
                                    />
                                    <TeamColumn
                                        title="RED TEAM"
                                        subtitle={`${teamCounts[RED_TEAM]}/${MAX_TEAM_SIZE} team slots`}
                                        tone="red"
                                        teamNumber={RED_TEAM}
                                        members={members.filter((member) => Number(member.teamNumber) === RED_TEAM)}
                                        userId={user?.id}
                                        owner={isOwner}
                                        action={action}
                                        onTeamChange={changeTeam}
                                        onKick={kickPlayer}
                                    />
                                </div>
                                <NotReadyRoster
                                    className="min-h-0 flex-1"
                                    members={members.filter((member) => Number(member.teamNumber) === TEAM_NONE)}
                                    owner={isOwner}
                                    action={action}
                                    onKick={kickPlayer}
                                />
                            </div>
                            <div className="col-span-1 grid min-h-0 gap-4 sm:grid-cols-2 lg:flex lg:flex-col">
                                <CustomLobbyChat
                                    messages={chatMessages}
                                    onSend={sendLobbyChat}
                                    notice={chatNotice}
                                    className="custom-lobby-chat--compact min-w-0"
                                />
                                <div className="min-w-0 shrink-0 rounded-xl border border-slate-800 bg-[#07111b] p-4">
                                    <p className="font-mono text-[10px] font-bold tracking-[.18em] text-slate-500">LOBBY STATUS</p>
                                    <p className="mt-2 text-sm text-slate-300">{everyoneOnTeam && bothTeamsHavePlayers ? "All players are on a team." : "Players without a team are not ready."}</p>
                                    {isOwner && !everyoneOnline && <p className="mt-1 text-xs text-amber-300">Every player must be online before the match can start.</p>}
                                    {isOwner && members.length < 2 && <p className="mt-1 text-xs text-amber-300">Invite at least one more player to start.</p>}
                                    {isOwner && !bothTeamsHavePlayers && <p className="mt-1 text-xs text-amber-300">Both Blue Team and Red Team need a player.</p>}
                                    {isOwner && !everyoneOnTeam && members.length >= 2 && <p className="mt-1 text-xs text-amber-300">Every player must join a team before the match can start.</p>}
                                    {!isOwner && <p className="mt-1 text-xs text-slate-500">Only {lobby.ownerUsername ?? "the lobby owner"} can start this match.</p>}
                                    <button type="button" onClick={startMatch} disabled={!canStart} className="mt-4 h-11 w-full border border-emerald-400/70 bg-emerald-950/30 px-4 font-mono text-[10px] font-bold tracking-widest text-emerald-100 hover:bg-emerald-900/40 disabled:cursor-not-allowed disabled:opacity-45">{action === "start" ? "STARTING..." : "START CUSTOM MATCH"}</button>
                                </div>
                            </div>
                        </div>

                    </>
                )}

                {notice && <p className="mt-5 text-sm text-emerald-300" role="status">{notice}</p>}
                {error && loadState !== "error" && <p className="mt-5 text-sm text-rose-300" role="alert">{error}</p>}
            </section>
        </main>
        {settingsOpen && (
            <CustomLobbySettingsModal
                roundSeconds={roundSeconds}
                onRoundSecondsChange={setRoundSeconds}
                onClose={closeSettings}
                onSubmit={saveRoundDuration}
                saving={action === "settings"}
                error={error}
            />
        )}
        </>
    );
}

function TeamColumn({ title, subtitle, tone, teamNumber, members, userId, owner, action, onTeamChange, onKick }) {
    const titleTone = tone === "blue" ? "text-cyan-300" : tone === "red" ? "text-rose-300" : "text-slate-300";
    const borderTone = tone === "blue" ? "border-2 border-cyan-400/80" : "border-rose-900/70";
    const currentMemberIsHere = members.some((member) => memberIsCurrent(member, userId));
    const openSlotCount = Math.max(0, MAX_TEAM_SIZE - members.length);
    const canJoinTeam = !currentMemberIsHere && members.length < MAX_TEAM_SIZE;
    const slotTone = tone === "blue"
        ? "border-cyan-400/70 text-cyan-300"
        : "border-rose-900/70 text-rose-400";
    const joinTone = tone === "blue"
        ? "border-cyan-400/70 bg-cyan-950/40 text-cyan-100 hover:bg-cyan-900/50"
        : "border-rose-400/70 bg-rose-950/30 text-rose-100 hover:bg-rose-900/40";
    return (
        <section className={`min-h-64 border bg-[#07111b] p-4 ${borderTone}`} aria-label={title}>
            <div className="flex items-start justify-between gap-3 border-b border-slate-800 pb-3">
                <div>
                    <h2 className={`font-mono text-[11px] font-bold tracking-[.18em] ${titleTone}`}>{title}</h2>
                    <p className="mt-1 text-xs text-slate-600">{subtitle}</p>
                </div>
                <div className="flex shrink-0 items-start gap-2">
                    {(canJoinTeam || currentMemberIsHere) && (
                        <button
                            type="button"
                            onClick={() => onTeamChange(currentMemberIsHere ? TEAM_NONE : teamNumber)}
                            disabled={action !== null}
                            className={`min-h-8 border px-2 font-mono text-[9px] font-bold tracking-widest transition disabled:cursor-wait disabled:opacity-50 ${joinTone}`}
                            aria-label={currentMemberIsHere ? `Leave ${title}` : `Join ${title}`}
                        >
                            {currentMemberIsHere ? "LEAVE TEAM" : "JOIN TEAM"}
                        </button>
                    )}
                </div>
            </div>
            <div className="mt-3 max-h-72 space-y-2 overflow-y-auto overscroll-contain pr-1">
                {members.map((member) => (
                    <LobbyMemberCard
                        key={member.userId}
                        member={member}
                        isCurrent={memberIsCurrent(member, userId)}
                        owner={owner}
                        action={action}
                        onKick={onKick}
                    />
                ))}
                {Array.from({ length: openSlotCount }, (_, index) => (
                    <div key={`open-${index}`} className={`flex min-h-14 items-center gap-3 border border-dashed px-3 py-2 ${slotTone}`}>
                        <span className="flex-1 font-mono text-[9px] font-bold tracking-widest">OPEN SLOT</span>
                    </div>
                ))}
            </div>
        </section>
    );
}

function NotReadyRoster({ className = "", members, owner, action, onKick }) {
    return (
        <section className={`rounded-xl border border-slate-800 bg-[#07111b] px-4 py-3 ${className}`.trim()} aria-label="Not ready players">
            <div className="flex min-h-8 flex-col items-start gap-3">
                <div className="flex flex-wrap items-center gap-3">
                    <h2 className="font-mono text-[10px] font-bold tracking-[.18em] text-slate-300">NOT READY</h2>
                    <span className="text-[11px] text-slate-600">Choose a side to ready up</span>
                </div>
                <div className="flex w-full min-w-0 flex-wrap items-center gap-x-5 gap-y-2">
                    {members.length === 0 && <span className="font-mono text-[9px] tracking-widest text-slate-600">NO PLAYERS WAITING</span>}
                    {members.map((member) => (
                        <LobbyMemberInline
                            key={member.userId}
                            member={member}
                            owner={owner}
                            action={action}
                            onKick={onKick}
                        />
                    ))}
                </div>
            </div>
        </section>
    );
}

function LobbyMemberInline({ member, owner, action, onKick }) {
    return (
        <div className="flex min-w-0 items-center gap-2 border border-slate-800 bg-slate-950/25 px-2 py-1.5">
            <span className={`h-2 w-2 shrink-0 rounded-full ${member.online === false ? "bg-slate-600" : "bg-emerald-400"}`} title={member.online === false ? "Offline" : "Online"} aria-label={member.online === false ? "Offline" : "Online"} />
            <span className="max-w-40 truncate text-sm font-semibold text-slate-100">{member.username}</span>
            {member.owner && <span className="font-mono text-[8px] font-bold tracking-widest text-cyan-300">OWNER</span>}
            {owner && !member.owner && <button type="button" onClick={() => onKick(member)} disabled={action !== null} aria-label={`Kick ${member.username}`} title={`Kick ${member.username}`} className="grid h-5 w-5 place-items-center border border-slate-700 text-sm leading-none text-slate-500 hover:border-rose-400 hover:text-rose-300 disabled:cursor-wait disabled:opacity-50">×</button>}
        </div>
    );
}

function LobbyMemberCard({ member, isCurrent, owner, action, onKick }) {
    const activeTone = teamTone(member.teamNumber);

    return (
        <article className={`border px-3 py-3 ${isCurrent ? "border-cyan-400/70 bg-cyan-950/15" : "border-slate-800 bg-slate-950/25"}`}>
            <div className="flex items-center gap-2">
                <span className={`h-2 w-2 shrink-0 rounded-full ${member.online === false ? "bg-slate-600" : "bg-emerald-400"}`} title={member.online === false ? "Offline" : "Online"} aria-label={member.online === false ? "Offline" : "Online"} />
                <span className="min-w-0 flex-1 truncate text-sm font-semibold text-slate-100">{member.username}</span>
                {member.owner && <span className="font-mono text-[8px] font-bold tracking-widest text-cyan-300">OWNER</span>}
                {owner && !member.owner && <button type="button" onClick={() => onKick(member)} disabled={action !== null} aria-label={`Kick ${member.username}`} title={`Kick ${member.username}`} className="grid h-6 w-6 place-items-center border border-slate-700 text-sm leading-none text-slate-500 hover:border-rose-400 hover:text-rose-300 disabled:cursor-wait disabled:opacity-50">×</button>}
            </div>
            <p className={`mt-1 font-mono text-[8px] tracking-widest ${activeTone === "blue" ? "text-cyan-400" : activeTone === "red" ? "text-rose-400" : "text-slate-600"}`}>{teamLabel(member.teamNumber)}{member.online === false ? " · OFFLINE" : ""}</p>
        </article>
    );
}
