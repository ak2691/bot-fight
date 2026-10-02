import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import AppNavbar from "../../components/AppNavbar";
import ProfileLink from "../../components/ProfileLink.jsx";
import PlayerAvatar from "../../components/PlayerAvatar.jsx";
import Toast, { ToastStack } from "../../components/Toast.jsx";
import { Icon } from "../../components/SocialBits.jsx";
import { useDialogFocus } from "../../components/useDialogFocus.js";
import { useAuth } from "../../auth/auth-context";
import { apiUrl } from "../../config/api";
import { ensureCsrfHeaders } from "../../security/csrf";
import { useMatchmaking } from "../../matchmaking/matchmaking-context";
import CustomLobbyChat from "./CustomLobbyChat.jsx";
import QueueAbilityGuaranteePicker from "../queue/QueueAbilityGuaranteePicker.jsx";

const TEAM_NONE = 0;
const BLUE_TEAM = 1;
const RED_TEAM = 2;
const MAX_TEAM_SIZE = 2;
const STATUS_MESSAGE_DURATION_MS = 3500;
const INVITE_RATE_LIMIT_MESSAGE = "Inviting too fast, please wait";
const INVITE_FAILURE_MESSAGE = "Can not invite this player";
const RANKED_PARTICIPATION_BLOCK_MESSAGE = "Leave ranked matchmaking or return to the active match before entering a custom lobby.";
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

function formatRoundDuration(seconds) {
    const totalSeconds = Number(seconds);
    if (!Number.isFinite(totalSeconds) || totalSeconds < MIN_ROUND_DURATION_SECONDS) return "5 min";
    if (totalSeconds % 60 === 0) return `${totalSeconds / 60} min`;
    return `${Math.floor(totalSeconds / 60)}:${String(totalSeconds % 60).padStart(2, "0")}`;
}

function normalizeMinimumRoundDuration(value) {
    const seconds = Number(value);
    if (!Number.isFinite(seconds)) return String(MIN_ROUND_DURATION_SECONDS);
    return String(Math.max(MIN_ROUND_DURATION_SECONDS, Math.floor(seconds)));
}

const ROUND_DURATION_PRESETS = [[60, "1 min"], [180, "3 min"], [300, "5 min"]];
const ROUND_DURATION_STEP_SECONDS = 15;

function CustomLobbySettingsModal({ roundSeconds, onRoundSecondsChange, onClose, onSubmit, saving, error }) {
    const dialogRef = useRef(null);
    const [customOpen, setCustomOpen] = useState(() => !ROUND_DURATION_PRESETS.some(([seconds]) => String(seconds) === String(roundSeconds)));
    useDialogFocus(dialogRef, {
        onClose,
        lockScroll: true,
        enabled: true,
    });
    const presetActive = (seconds) => !customOpen && String(seconds) === String(roundSeconds);
    const stepSeconds = (delta) => {
        const current = Number(roundSeconds);
        const base = Number.isFinite(current) ? current : MIN_ROUND_DURATION_SECONDS;
        onRoundSecondsChange(String(Math.min(MAX_ROUND_DURATION_SECONDS, Math.max(MIN_ROUND_DURATION_SECONDS, Math.floor(base) + delta))));
    };

    return (
        <div className="fixed inset-0 z-[110] grid place-items-center bg-black/75 p-4 backdrop-blur-sm" onMouseDown={(event) => { if (event.target === event.currentTarget && !saving) onClose(); }}>
            <section ref={dialogRef} className="game-dialog custom-lobby-settings w-[min(92vw,420px)] rounded-xl border border-[#262c33] bg-[#0f1418] shadow-2xl" role="dialog" aria-modal="true" aria-labelledby="custom-lobby-settings-title" tabIndex={-1}>
                <header className="flex items-center justify-between gap-4 border-b border-[#262c33] px-5 py-3.5">
                    <h2 id="custom-lobby-settings-title" className="font-display text-lg font-bold text-white">Match settings</h2>
                    <button type="button" onClick={onClose} disabled={saving} aria-label="Close custom lobby settings" className="modal-close-button disabled:cursor-wait disabled:opacity-50"><span aria-hidden="true">×</span></button>
                </header>
                <form onSubmit={onSubmit}>
                    <div className="space-y-3 p-5">
                        <p className="text-[13px] font-semibold text-[#e6edf3]" id="custom-lobby-build-time-label">Build time per round</p>
                        <div className="grid grid-cols-4 overflow-hidden rounded-lg border border-[#262c33] bg-[#12181d]" role="group" aria-labelledby="custom-lobby-build-time-label">
                            {ROUND_DURATION_PRESETS.map(([seconds, label]) => (
                                <button key={seconds} type="button" aria-pressed={presetActive(seconds)} onClick={() => { setCustomOpen(false); onRoundSecondsChange(String(seconds)); }} className={`h-9 text-[13px] font-semibold ${presetActive(seconds) ? "bg-[#1f6f8b] text-white" : "text-slate-400 hover:bg-white/[.06] hover:text-white"}`}>{label}</button>
                            ))}
                            <button type="button" aria-pressed={customOpen} onClick={() => setCustomOpen(true)} className={`h-9 text-[13px] font-semibold ${customOpen ? "bg-[#1f6f8b] text-white" : "text-slate-400 hover:bg-white/[.06] hover:text-white"}`}>Custom</button>
                        </div>
                        {customOpen && (
                            <div className="flex items-center gap-2">
                                <button type="button" onClick={() => stepSeconds(-ROUND_DURATION_STEP_SECONDS)} aria-label="Decrease round time" className="h-9 w-9 rounded-lg border border-[#262c33] bg-[#12181d] text-lg text-slate-200 hover:bg-white/[.06]">−</button>
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
                                    className="h-9 w-24 rounded-lg border border-[#262c33] bg-[#12181d] px-2 text-center font-interface-numeric text-sm text-white outline-none focus:border-cyan-400"
                                />
                                <button type="button" onClick={() => stepSeconds(ROUND_DURATION_STEP_SECONDS)} aria-label="Increase round time" className="h-9 w-9 rounded-lg border border-[#262c33] bg-[#12181d] text-lg text-slate-200 hover:bg-white/[.06]">+</button>
                                <span className="text-xs text-slate-500">seconds</span>
                            </div>
                        )}
                        <p className="text-xs leading-5 text-slate-500">How long players have to code before each round. 30 s – 10 min.</p>
                        {error && <p className="rounded-lg border border-rose-400/40 bg-rose-950/20 px-3 py-2 text-xs leading-5 text-rose-200" role="alert">{error}</p>}
                    </div>
                    <footer className="flex justify-end gap-2 border-t border-[#262c33] px-5 py-3.5">
                        <button type="button" onClick={onClose} disabled={saving} className="h-10 rounded-lg border border-[#2d353c] bg-[#12181d] px-4 text-sm font-semibold text-slate-200 hover:bg-white/[.06] disabled:cursor-wait disabled:opacity-50">Cancel</button>
                        <button type="submit" disabled={saving} className="h-10 rounded-lg border-b-[3px] border-[#0f5f78] bg-[#2088ac] px-6 font-display text-sm font-bold text-white hover:brightness-110 disabled:cursor-wait disabled:opacity-50">{saving ? "SAVING..." : "SAVE"}</button>
                    </footer>
                </form>
            </section>
        </div>
    );
}

export default function CustomLobbyPage() {
    const navigate = useNavigate();
    const location = useLocation();
    const { user, isGuest } = useAuth();
    const {
        customLobbyEvent,
        markActiveMatch,
        sendCustomLobbyChat,
        isQueueing,
        pendingAcceptance,
        activeMatchStatus,
        queueGuarantees,
        updateQueueGuarantee,
        waitForQueueGuarantees,
    } = useMatchmaking();
    const [lobby, setLobby] = useState(null);
    const [loadState, setLoadState] = useState("loading");
    const [error, setError] = useState(null);
    const [notice, setNotice] = useState(null);
    const [inviteUsername, setInviteUsername] = useState("");
    const [inviteStatus, setInviteStatus] = useState(null);
    const [roundSeconds, setRoundSeconds] = useState("300");
    const [settingsOpen, setSettingsOpen] = useState(false);
    const [chatOpen, setChatOpen] = useState(false);
    const [action, setAction] = useState(null);
    const [chatMessages, setChatMessages] = useState([]);
    const [chatNotice, setChatNotice] = useState(null);
    const lobbyIdRef = useRef(null);
    const redirectingToMatchRef = useRef(false);
    const shouldCreate = location.state?.create === true;
    const rankedParticipationActive = Boolean(
        isQueueing || pendingAcceptance || activeMatchStatus?.activeMatch,
    );
    const rankedParticipationAtMountRef = useRef(rankedParticipationActive);

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
        if (!customLobbyEvent.lobby && customLobbyEvent.message) {
            lobbyIdRef.current = null;
            setLobby(null);
            setLoadState("error");
            setError(customLobbyEvent.message);
            return;
        }
        lobbyIdRef.current = customLobbyEvent.lobby?.lobbyId ?? null;
        setLobby(customLobbyEvent.lobby ?? null);
        setLoadState(customLobbyEvent.lobby ? "ready" : "empty");
        setError(null);
        if (!customLobbyEvent.lobby) {
            setNotice(null);
            setInviteStatus(null);
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
        const timeoutId = window.setTimeout(() => {
            setNotice(null);
            setError(null);
            if (loadState === "error") setLoadState("empty");
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
            if (shouldCreate && rankedParticipationAtMountRef.current) {
                setLoadState("error");
                setError(RANKED_PARTICIPATION_BLOCK_MESSAGE);
                return;
            }
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
        if (rankedParticipationActive) {
            setError(RANKED_PARTICIPATION_BLOCK_MESSAGE);
            return undefined;
        }
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
        if (result !== undefined) navigate("/home");
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
            async () => {
                if (!await waitForQueueGuarantees()) {
                    throw new Error("Guaranteed offers could not be saved. Try again before starting.");
                }
                return customLobbyRequest(`/api/custom-lobbies/${encodeURIComponent(lobby.lobbyId)}/start`, { method: "POST" });
            },
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

    const blockReason = (() => {
        if (members.length < 2) return { title: "Waiting for players", hint: "Invite at least one more player to start." };
        if (!everyoneOnline) return { title: "A player is offline", hint: "Every player must be online before the match can start." };
        if (!bothTeamsHavePlayers) {
            const emptyTeams = [
                teamCounts[BLUE_TEAM] === 0 ? "Blue" : null,
                teamCounts[RED_TEAM] === 0 ? "Red" : null,
            ].filter(Boolean);
            return {
                title: emptyTeams.length === 2 ? "Both teams need a player" : `${emptyTeams[0]} team needs a player`,
                hint: "Blue and Red each need at least one player.",
            };
        }
        if (!everyoneOnTeam) return { title: "Players still choosing", hint: "Every player must join a team before the match can start." };
        return null;
    })();
    const ownerName = lobby?.ownerUsername ?? null;
    const startDisabledReason = !isOwner
        ? "Only the lobby owner can start this match."
        : blockReason?.hint ?? null;
    const unassignedMembers = members.filter((member) => Number(member.teamNumber) === TEAM_NONE);
    const capacity = lobby?.capacity ?? 4;

    return (
        <>
            <main className="custom-lobby-page min-h-screen bg-[#171a1c] font-interface text-slate-100">
                <AppNavbar account />
                <section className="mx-auto flex min-h-[calc(100vh-72px)] w-full max-w-6xl flex-col px-4 pt-6 sm:px-8 sm:pt-8">
                    <header className="custom-lobby-header flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
                        <div className="min-w-0">
                            <button type="button" onClick={() => navigate("/home")} className="text-xs font-semibold text-slate-500 hover:text-cyan-200">
                                ← Home
                            </button>
                            <h1 className="mt-1 font-display text-3xl font-bold text-white sm:text-4xl">Custom lobby</h1>
                            {lobby && (
                                <div className="mt-2 flex flex-wrap gap-2 text-[11px] font-semibold text-[#c9d3dc]">
                                    <span className="inline-flex items-center gap-1.5 rounded-md border border-[#262c33] bg-[#12181d] px-2 py-1"><Icon name="lock" className="h-3 w-3" />Invite only</span>
                                    <span className="inline-flex items-center gap-1.5 rounded-md border border-[#262c33] bg-[#12181d] px-2 py-1">{members.length} / {capacity} players</span>
                                    <span className="inline-flex items-center gap-1.5 rounded-md border border-[#262c33] bg-[#12181d] px-2 py-1"><Icon name="clock" className="h-3 w-3" />{formatRoundDuration(lobby.roundDurationSeconds)} rounds</span>
                                </div>
                            )}
                        </div>
                        {lobby && isOwner && (
                            <div className="flex w-full items-center gap-2 lg:w-auto">
                                {members.length < capacity && (
                                    <form onSubmit={invitePlayer} className="flex min-w-0 flex-1 items-center gap-2 lg:w-72 lg:flex-none">
                                        <label className="sr-only" htmlFor="custom-lobby-invite-username">Invite player</label>
                                        <input id="custom-lobby-invite-username" type="text" value={inviteUsername} onChange={(event) => setInviteUsername(event.target.value)} maxLength={20} placeholder="Invite by username" autoComplete="off" className="h-9 min-w-0 flex-1 rounded-md border border-[#262c33] bg-[#0b0f12] px-3 text-xs text-white outline-none placeholder:text-slate-500 focus:border-cyan-400" />
                                        <button type="submit" disabled={!inviteUsername.trim() || action !== null || rankedParticipationActive} className="custom-lobby-invite-button h-9 shrink-0 rounded-lg border-b-[3px] border-[#1d6f8a] bg-[#2a9cc4] px-3.5 font-display text-xs font-bold text-white hover:bg-[#35aed8] disabled:cursor-not-allowed disabled:opacity-50">{action === "invite" ? "Inviting..." : "Invite"}</button>
                                    </form>
                                )}
                                <button type="button" onClick={() => { setError(null); setSettingsOpen(true); }} disabled={action !== null} aria-label="Open custom lobby settings" title="Custom lobby settings" className="grid h-9 w-9 shrink-0 place-items-center rounded-md border border-[#262c33] bg-[#12181d] text-slate-300 hover:border-cyan-400/60 hover:text-cyan-200 disabled:cursor-wait disabled:opacity-50">
                                    <Icon name="gear" className="h-[18px] w-[18px]" />
                                </button>
                            </div>
                        )}
                    </header>

                    {loadState === "loading" && <div className="mt-8 rounded-xl border border-[#262c33] bg-[#0f1418] px-6 py-12 text-center text-xs text-slate-500">Loading lobby...</div>}
                    {loadState === "error" && (
                        <div className="mt-8 rounded-xl border border-rose-400/40 bg-rose-950/20 px-6 py-8" role="alert">
                            <p className="text-sm text-rose-200">{error}</p>
                            <button type="button" onClick={createLobby} disabled={rankedParticipationActive} className="mt-5 h-11 rounded-lg border border-cyan-400/70 bg-cyan-950/40 px-5 font-display text-xs font-bold text-cyan-100 disabled:cursor-not-allowed disabled:opacity-50">Create custom lobby</button>
                        </div>
                    )}
                    {loadState === "empty" && (
                        <div className="mt-10 flex flex-1 items-center justify-center">
                            <button type="button" onClick={createLobby} disabled={action !== null || rankedParticipationActive} className="h-12 rounded-lg border-b-[3px] border-[#1d6f8a] bg-[#2a9cc4] px-6 font-display text-sm font-bold text-white hover:bg-[#35aed8] disabled:cursor-wait disabled:opacity-50">{action === "create" ? "Creating..." : "Create custom lobby"}</button>
                        </div>
                    )}
                    {lobby && (
                        <div className="mt-5 grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_20rem] lg:items-start">
                            <div className="flex min-w-0 flex-col gap-4">
                                <div className="grid w-full gap-4 sm:grid-cols-2">
                                    <TeamColumn
                                        title="Blue team"
                                        tone="blue"
                                        teamNumber={BLUE_TEAM}
                                        members={members.filter((member) => Number(member.teamNumber) === BLUE_TEAM)}
                                        userId={user?.id}
                                        owner={isOwner}
                                        canChangeTeam={Boolean(currentMember)}
                                        action={action}
                                        onTeamChange={changeTeam}
                                        onKick={kickPlayer}
                                    />
                                    <TeamColumn
                                        title="Red team"
                                        tone="red"
                                        teamNumber={RED_TEAM}
                                        members={members.filter((member) => Number(member.teamNumber) === RED_TEAM)}
                                        userId={user?.id}
                                        owner={isOwner}
                                        canChangeTeam={Boolean(currentMember)}
                                        action={action}
                                        onTeamChange={changeTeam}
                                        onKick={kickPlayer}
                                    />
                                </div>
                                <NotReadyRoster
                                    members={unassignedMembers}
                                    owner={isOwner}
                                    action={action}
                                    onKick={kickPlayer}
                                />
                                <div className="custom-lobby-guarantees rounded-xl border border-[#262c33] bg-[#0f1418] p-3.5">
                                    <QueueAbilityGuaranteePicker
                                        values={queueGuarantees}
                                        onChange={updateQueueGuarantee}
                                        disabled={action === "start"}
                                    />
                                </div>
                            </div>
                            {!isGuest && (
                                <div className="min-w-0">
                                    <button type="button" onClick={() => setChatOpen(true)} className="flex h-10 w-full items-center justify-center gap-2 rounded-lg border border-[#262c33] bg-[#12181d] text-xs font-semibold text-slate-200 lg:hidden">
                                        <Icon name="chat" className="h-4 w-4" />Chat{chatMessages.length > 0 ? ` (${chatMessages.length})` : ""}
                                    </button>
                                    <div className={chatOpen
                                        ? "fixed inset-x-0 bottom-0 z-[120] max-h-[80vh] rounded-t-xl border-t border-[#262c33] bg-[#0f1418] p-3 shadow-2xl lg:static lg:z-auto lg:max-h-none lg:rounded-none lg:border-0 lg:bg-transparent lg:p-0 lg:shadow-none"
                                        : "hidden lg:block"}>
                                        <button type="button" onClick={() => setChatOpen(false)} className="mb-2 ml-auto block text-xs font-semibold text-slate-400 lg:hidden" aria-label="Close chat">Close</button>
                                        <CustomLobbyChat
                                            messages={chatMessages}
                                            onSend={sendLobbyChat}
                                            currentUsername={user?.username}
                                            teamByUsername={Object.fromEntries(members.map((member) => [member.username, Number(member.teamNumber)]))}
                                            notice={chatNotice}
                                            className="custom-lobby-chat--compact min-w-0"
                                        />
                                    </div>
                                </div>
                            )}
                        </div>
                    )}

                    {(notice || (error && loadState !== "error") || inviteStatus) && (
                        <ToastStack>
                            {notice && <Toast tone="success" onDismiss={() => setNotice(null)}>{notice}</Toast>}
                            {error && loadState !== "error" && <Toast tone="error" onDismiss={() => setError(null)}>{error}</Toast>}
                            {inviteStatus && <Toast tone={inviteStatus.kind === "error" ? "error" : "success"} onDismiss={() => setInviteStatus(null)}>{inviteStatus.message}</Toast>}
                        </ToastStack>
                    )}
                    <div className="flex-1" />
                </section>
                {lobby && (
                    <div className="custom-lobby-status sticky bottom-0 z-20 mt-4 border-t border-[#262c33] bg-[#0f1418]/95 backdrop-blur">
                        <div className="mx-auto flex w-full max-w-6xl flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3 sm:px-8">
                            <div className="flex min-w-0 flex-1 basis-56 items-center gap-2.5">
                                <span className={blockReason ? "text-amber-300" : "text-emerald-400"}><Icon name={blockReason ? "alert" : "check"} className="h-5 w-5" /></span>
                                <div className="min-w-0">
                                    <p className="text-[13px] font-semibold text-[#e6edf3]">{blockReason ? blockReason.title : "Ready to start"}</p>
                                    <p className="text-[11px] text-[#8b98a5]">
                                        {isOwner
                                            ? (blockReason?.hint ?? "Everyone is on a team and online.")
                                            : <>Only {ownerName ? <ProfileLink username={ownerName} className="text-slate-400 hover:text-cyan-200">{ownerName}</ProfileLink> : "the lobby owner"} can start this match.</>}
                                    </p>
                                </div>
                            </div>
                            <button type="button" onClick={leaveLobby} disabled={action !== null} className="text-xs font-semibold text-rose-400 hover:text-rose-300 disabled:cursor-wait disabled:opacity-50">Leave lobby</button>
                            {isOwner && (
                                <span title={canStart ? undefined : (startDisabledReason ?? undefined)} className="block">
                                    <button type="button" onClick={startMatch} disabled={!canStart} className="custom-lobby-start-button h-11 rounded-lg border-b-[3px] border-[#1f6b3f] bg-[#2fa866] px-6 font-display text-sm font-bold tracking-wide text-white hover:bg-[#38bd74] disabled:cursor-not-allowed disabled:opacity-45">{action === "start" ? "STARTING..." : "START MATCH"}</button>
                                </span>
                            )}
                        </div>
                    </div>
                )}
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

const TEAM_STYLES = {
    blue: { section: "border-[#2a5a78] bg-[#0f1b26]", title: "text-sky-300", join: "border-[#2a5a78] text-sky-300 hover:bg-[#15293a]" },
    red: { section: "border-[#5e2f36] bg-[#221316]", title: "text-rose-300", join: "border-[#5e2f36] text-rose-300 hover:bg-[#33191e]" },
};

function SlotMenu({ member, isCurrent, owner, action, onKick, onLeaveTeam }) {
    const [open, setOpen] = useState(false);
    const menuRef = useRef(null);
    const canKick = owner && !member.owner;
    const canLeave = isCurrent;

    useEffect(() => {
        if (!open) return undefined;
        const handlePointerDown = (event) => {
            if (!menuRef.current?.contains(event.target)) setOpen(false);
        };
        const handleKeyDown = (event) => {
            if (event.key === "Escape") setOpen(false);
        };
        document.addEventListener("pointerdown", handlePointerDown);
        document.addEventListener("keydown", handleKeyDown);
        return () => {
            document.removeEventListener("pointerdown", handlePointerDown);
            document.removeEventListener("keydown", handleKeyDown);
        };
    }, [open]);

    if (!canKick && !canLeave) return null;
    return (
        <div ref={menuRef} className="relative shrink-0">
            <button type="button" onClick={() => setOpen((value) => !value)} disabled={action !== null} aria-haspopup="menu" aria-expanded={open} aria-label={`Options for ${member.username}`} title="Options" className="grid h-8 w-8 place-items-center rounded-md text-slate-400 hover:bg-white/5 hover:text-slate-100 disabled:cursor-wait disabled:opacity-50">
                <Icon name="more" className="h-4 w-4 fill-current stroke-none" />
            </button>
            {open && (
                <div role="menu" className="absolute right-0 top-9 z-30 min-w-36 rounded-lg border border-[#262c33] bg-[#0f1418] p-1 shadow-xl">
                    {canLeave && (
                        <button type="button" role="menuitem" onClick={() => { setOpen(false); onLeaveTeam(); }} className="block w-full rounded-md px-3 py-2 text-left text-xs font-semibold text-slate-200 hover:bg-white/5">Leave team</button>
                    )}
                    {canKick && (
                        <button type="button" role="menuitem" onClick={() => { setOpen(false); onKick(member); }} aria-label={`Kick ${member.username}`} title={`Kick ${member.username}`} className="block w-full rounded-md px-3 py-2 text-left text-xs font-semibold text-rose-300 hover:bg-rose-950/30">Kick player</button>
                    )}
                </div>
            )}
        </div>
    );
}

function MemberTags({ member }) {
    return (
        <>
            {member.owner && <span className="shrink-0 text-[10px] font-bold text-amber-300">OWNER</span>}
            {member.online === false && <span className="shrink-0 text-[10px] font-semibold text-slate-500">OFFLINE</span>}
        </>
    );
}

function TeamColumn({ title, tone, teamNumber, members, userId, owner, canChangeTeam, action, onTeamChange, onKick }) {
    const styles = TEAM_STYLES[tone];
    const currentMemberIsHere = members.some((member) => memberIsCurrent(member, userId));
    const openSlotCount = Math.max(0, MAX_TEAM_SIZE - members.length);
    const canJoinTeam = canChangeTeam && !currentMemberIsHere;
    return (
        <section className={`custom-lobby-team rounded-xl border p-3 ${styles.section}`} aria-label={title} data-team={tone} data-current={currentMemberIsHere ? "true" : undefined}>
            <div className="mb-2.5 flex items-center justify-between gap-3">
                <h2 className={`font-display text-sm font-bold ${styles.title}`}>{title}</h2>
                <span className="text-[11px] text-[#8b98a5]">{members.length} / {MAX_TEAM_SIZE}</span>
            </div>
            <div className="space-y-2">
                {members.map((member) => (
                    <div key={member.userId} className={`flex min-h-14 items-center gap-2.5 rounded-lg border px-2.5 py-2 ${memberIsCurrent(member, userId) ? "border-white/25 bg-white/[.06]" : "border-white/10 bg-black/20"}`}>
                        <PlayerAvatar name={member.username} size={32} />
                        <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-1.5">
                                <ProfileLink username={member.username} className="min-w-0 truncate text-[13px] font-semibold text-slate-100">{member.username}</ProfileLink>
                                <MemberTags member={member} />
                            </div>
                        </div>
                        <span className="shrink-0 text-[11px] font-semibold text-emerald-400">READY</span>
                        <SlotMenu
                            member={member}
                            isCurrent={memberIsCurrent(member, userId)}
                            owner={owner}
                            action={action}
                            onKick={onKick}
                            onLeaveTeam={() => onTeamChange(TEAM_NONE)}
                        />
                    </div>
                ))}
                {Array.from({ length: openSlotCount }, (_, index) => (
                    canJoinTeam ? (
                        <button
                            key={`open-${index}`}
                            type="button"
                            onClick={() => onTeamChange(teamNumber)}
                            disabled={action !== null}
                            aria-label={`Join ${title}`}
                            className={`flex min-h-14 w-full items-center justify-center gap-1.5 rounded-lg border border-dashed text-xs font-semibold transition disabled:cursor-wait disabled:opacity-50 ${styles.join}`}
                        >
                            <Icon name="plus" className="h-3.5 w-3.5" />Join {tone}
                        </button>
                    ) : (
                        <div key={`open-${index}`} className="flex min-h-14 items-center justify-center rounded-lg border border-dashed border-white/10 text-xs text-slate-500">Open slot</div>
                    )
                ))}
            </div>
        </section>
    );
}

function NotReadyRoster({ members, owner, action, onKick }) {
    return (
        <section className="custom-lobby-unassigned flex flex-wrap items-center gap-x-4 gap-y-2 rounded-xl border border-[#262c33] bg-[#0f1418] px-3.5 py-2.5" aria-label="Not on a team">
            <h2 className="text-[11px] font-bold text-slate-300">Not on a team</h2>
            {members.length === 0 && <span className="text-[11px] text-slate-500">Everyone&apos;s picked a side</span>}
            {members.map((member) => (
                <LobbyMemberInline key={member.userId} member={member} owner={owner} action={action} onKick={onKick} />
            ))}
        </section>
    );
}

function LobbyMemberInline({ member, owner, action, onKick }) {
    return (
        <div className="flex min-w-0 items-center gap-2">
            <PlayerAvatar name={member.username} size={24} />
            <ProfileLink username={member.username} className="max-w-40 truncate text-xs font-semibold text-slate-100">{member.username}</ProfileLink>
            <MemberTags member={member} />
            <span className="shrink-0 text-[10px] font-semibold text-slate-500">Not ready</span>
            {owner && !member.owner && (
                <button type="button" onClick={() => onKick(member)} disabled={action !== null} aria-label={`Kick ${member.username}`} title={`Kick ${member.username}`} className="text-[11px] font-semibold text-slate-500 hover:text-rose-300 disabled:cursor-wait disabled:opacity-50">Kick</button>
            )}
        </div>
    );
}
