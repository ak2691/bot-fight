import { useEffect, useRef, useState } from "react";
import { useAuth } from "../auth/auth-context";
import { apiUrl } from "../config/api";
import { useMatchmaking } from "../matchmaking/matchmaking-context";
import { ensureCsrfHeaders } from "../security/csrf";
import ProfileLink from "./ProfileLink.jsx";

const FALLBACK_PARTY_CAPACITY = 2;
const MAX_RENDERED_PARTY_SLOTS = 20;
const STATUS_MESSAGE_DURATION_MS = 3500;
const INVITE_RATE_LIMIT_MESSAGE = "Inviting too fast, please wait";
const INVITE_FAILURE_MESSAGE = "Can not invite this player";

async function readPartyResponse(response, fallbackMessage) {
    const body = await response.json().catch(() => null);
    if (!response.ok) {
        const error = new Error(body?.message ?? fallbackMessage);
        error.status = response.status;
        throw error;
    }
    return body;
}

export default function PartyPopover({ onOpen = null }) {
    const { user } = useAuth();
    const {
        party,
        partyLoading,
        partyError: partyLoadError,
        isQueueing,
    } = useMatchmaking();
    const popoverRef = useRef(null);
    const [partyOpen, setPartyOpen] = useState(false);
    const [partyAction, setPartyAction] = useState(null);
    const [partyUsername, setPartyUsername] = useState("");
    const [partyError, setPartyError] = useState(null);
    const [partyMessage, setPartyMessage] = useState(null);

    useEffect(() => {
        if (!partyError && !partyMessage) return undefined;
        const timeoutId = window.setTimeout(() => {
            setPartyError(null);
            setPartyMessage(null);
        }, STATUS_MESSAGE_DURATION_MS);
        return () => window.clearTimeout(timeoutId);
    }, [partyError, partyMessage]);

    useEffect(() => {
        if (!partyOpen) return undefined;

        const handlePointerDown = (event) => {
            if (!popoverRef.current?.contains(event.target)) setPartyOpen(false);
        };
        const handleKeyDown = (event) => {
            if (event.key === "Escape") setPartyOpen(false);
        };
        document.addEventListener("pointerdown", handlePointerDown);
        document.addEventListener("keydown", handleKeyDown);
        return () => {
            document.removeEventListener("pointerdown", handlePointerDown);
            document.removeEventListener("keydown", handleKeyDown);
        };
    }, [partyOpen]);

    const toggleParty = () => {
        const nextOpen = !partyOpen;
        setPartyOpen(nextOpen);
        if (nextOpen) {
            onOpen?.();
        }
    };

    const createParty = async () => {
        if (party || partyAction) return;
        setPartyAction("create");
        setPartyError(null);
        setPartyMessage(null);
        try {
            const response = await fetch(apiUrl("/api/parties"), {
                method: "POST",
                credentials: "include",
                headers: await ensureCsrfHeaders("POST"),
            });
            await readPartyResponse(response, "The party could not be created.");
        } catch (error) {
            setPartyError(error.message ?? "The party could not be created.");
        } finally {
            setPartyAction(null);
        }
    };

    const inviteToParty = async (event) => {
        event.preventDefault();
        if (!party?.partyId || !partyUsername.trim() || partyAction) return;
        setPartyAction("invite");
        setPartyError(null);
        setPartyMessage(null);
        try {
            const response = await fetch(apiUrl(`/api/parties/${encodeURIComponent(party.partyId)}/invites`), {
                method: "POST",
                credentials: "include",
                headers: {
                    "Content-Type": "application/json",
                    ...(await ensureCsrfHeaders("POST")),
                },
                body: JSON.stringify({ username: partyUsername.trim() }),
            });
            const body = await readPartyResponse(response, "The party invite could not be sent.");
            setPartyUsername("");
            setPartyMessage(`Invite sent to ${body?.inviteeUsername ?? "your teammate"}.`);
        } catch (error) {
            setPartyError(error?.status === 429 ? INVITE_RATE_LIMIT_MESSAGE : INVITE_FAILURE_MESSAGE);
        } finally {
            setPartyAction(null);
        }
    };

    const leaveParty = async () => {
        if (!party?.partyId || partyAction) return;
        setPartyAction("leave");
        setPartyError(null);
        setPartyMessage(null);
        try {
            const response = await fetch(apiUrl(`/api/parties/${encodeURIComponent(party.partyId)}/leave`), {
                method: "POST",
                credentials: "include",
                headers: await ensureCsrfHeaders("POST"),
            });
            const body = await readPartyResponse(response, "You could not leave the party.");
            setPartyMessage(body ? "You left the party." : "Party closed.");
        } catch (error) {
            setPartyError(error.message ?? "You could not leave the party.");
        } finally {
            setPartyAction(null);
        }
    };

    const kickPartyMember = async (member) => {
        if (!party?.partyId || !member?.userId || partyAction) return;
        setPartyAction(`kick:${member.userId}`);
        setPartyError(null);
        setPartyMessage(null);
        try {
            const response = await fetch(apiUrl(
                `/api/parties/${encodeURIComponent(party.partyId)}/members/${encodeURIComponent(member.userId)}/kick`,
            ), {
                method: "POST",
                credentials: "include",
                headers: await ensureCsrfHeaders("POST"),
            });
            await readPartyResponse(response, "Could not kick this player.");
            setPartyMessage(`${member.username} was removed from the party.`);
        } catch (error) {
            setPartyError(error.message ?? "Could not kick this player.");
        } finally {
            setPartyAction(null);
        }
    };

    const members = party?.members ?? [];
    const capacity = Math.min(
        MAX_RENDERED_PARTY_SLOTS,
        Math.max(1, Number(party?.capacity) || FALLBACK_PARTY_CAPACITY),
    );
    const isLeader = members.some((member) => (
        member.leader === true && String(member.userId) === String(user?.id)
    ));
    const isFull = members.length >= capacity;
    const partyHasOfflineMember = Boolean(party && members.some((member) => member.online === false));
    const partySizeLabel = party ? `${members.length}/${capacity}` : "No party";

    return (
        <div ref={popoverRef} className="relative">
            <button
                type="button"
                onClick={toggleParty}
                aria-expanded={partyOpen}
                aria-controls="party-popover"
                aria-label={party ? `Open party, ${partySizeLabel} slots filled` : "Open party"}
                title="Party"
                className="app-navbar-control app-navbar-icon-control grid min-h-11 min-w-11 place-items-center text-slate-200"
            >
                <svg viewBox="0 0 28 24" className="h-5 w-6 fill-none stroke-current" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.7" aria-hidden="true">
                    <circle cx="9" cy="7.5" r="3.7" />
                    <path d="M2.7 20.2c.6-3.9 2.7-6.1 6.3-6.1s5.7 2.2 6.3 6.1" />
                    <circle cx="20.2" cy="8.8" r="2.7" />
                    <path d="M16.4 20.2c.4-2.9 1.8-4.7 4.3-4.7 2.2 0 3.7 1.7 4.3 4.7" />
                </svg>
            </button>

            {partyOpen && (
                <section
                    id="party-popover"
                    role="dialog"
                    aria-label="Party"
                    className="absolute right-0 top-[calc(100%+0.5rem)] z-30 max-h-[min(32rem,calc(100vh-6rem))] w-[min(20rem,calc(100vw-2rem))] overflow-y-auto overscroll-contain rounded-xl border-2 border-slate-500/80 bg-[#091521f5] p-3 shadow-[0_18px_60px_rgba(0,0,0,.45)]"
                >
                    <div className="flex items-center justify-between gap-3 px-1 pb-2">
                        <div>
                            <h2 className="font-mono text-[10px] font-bold tracking-[.2em] text-cyan-400">PARTY</h2>
                            {!party && <p className="mt-1 text-xs text-slate-500">Queue with a teammate</p>}
                        </div>
                        <span className="font-mono text-[10px] font-bold tracking-widest text-slate-500">{partySizeLabel}</span>
                    </div>

                    {party ? (
                        <>
                            <div className="space-y-2" aria-label="Party slots">
                                {Array.from({ length: capacity }, (_, index) => {
                                    const member = members.find((candidate) => Number(candidate.slot) === index + 1);
                                    const canKick = isLeader && member && String(member.userId) !== String(user?.id);
                                    const memberOnline = member?.online !== false;
                                    return (
                                        <div key={index + 1} className="flex min-h-11 items-center gap-2 rounded-lg border border-slate-800 bg-slate-950/35 px-2.5">
                                            {member ? (
                                                <div className="flex min-w-0 flex-1 items-center gap-2">
                                                    <span
                                                        className={`h-2 w-2 shrink-0 rounded-full ${memberOnline ? "bg-emerald-400" : "bg-slate-500"}`}
                                                        title={memberOnline ? "Online" : "Offline"}
                                                        aria-label={memberOnline ? "Online" : "Offline"}
                                                    />
                                                    <ProfileLink username={member.username} className="min-w-0 truncate text-xs font-bold text-white">{member.username}</ProfileLink>
                                                    {member.leader && <span className="shrink-0 font-mono text-[8px] font-bold tracking-widest text-cyan-300">LEADER</span>}
                                                </div>
                                            ) : (
                                                <span className="flex-1 text-xs text-slate-600">EMPTY</span>
                                            )}
                                            {canKick && (
                                                <button
                                                    type="button"
                                                    onClick={() => void kickPartyMember(member)}
                                                    disabled={partyAction !== null}
                                                    className="flex h-6 w-6 shrink-0 items-center justify-center rounded-[0_2px_0_3px] border border-[#c44747] bg-[#a93636] p-0 font-mono text-base font-bold leading-none text-white hover:border-[#e89090] hover:bg-[#c44747] disabled:cursor-not-allowed disabled:opacity-40"
                                                    aria-label={`Kick ${member.username}`}
                                                    title={`Kick ${member.username}`}
                                                >
                                                    ×
                                                </button>
                                            )}
                                        </div>
                                    );
                                })}
                            </div>

                            {isQueueing && partyHasOfflineMember && (
                                <p
                                    className="mt-3 rounded-lg border border-amber-400/35 bg-amber-950/20 px-2.5 py-2 text-[11px] leading-4 text-amber-200"
                                    role="status"
                                >
                                    A party member is offline. A match cannot be found until everyone is online. The queue timer continues while they reconnect.
                                </p>
                            )}

                            {isLeader && !isFull && (
                                <form className="mt-3 flex gap-2" onSubmit={inviteToParty}>
                                    <label className="sr-only" htmlFor="navbar-party-username">Teammate username</label>
                                    <input
                                        id="navbar-party-username"
                                        value={partyUsername}
                                        onChange={(event) => setPartyUsername(event.target.value)}
                                        placeholder="Invite username"
                                        maxLength={20}
                                        className="min-h-9 min-w-0 flex-1 rounded border border-slate-700 bg-slate-950/60 px-2.5 text-xs text-white outline-none placeholder:text-slate-600 focus:border-cyan-400"
                                    />
                                    <button
                                        type="submit"
                                        disabled={!partyUsername.trim() || partyAction !== null}
                                        className="min-h-9 rounded border border-slate-600 px-2.5 font-mono text-[9px] font-bold tracking-widest text-slate-200 hover:border-cyan-400 hover:text-cyan-100 disabled:cursor-not-allowed disabled:opacity-50"
                                    >
                                        {partyAction === "invite" ? "..." : "INVITE"}
                                    </button>
                                </form>
                            )}

                            <div className={`mt-3 flex border-t border-slate-800/80 pt-3 ${isFull ? "items-center justify-between gap-3" : "justify-end"}`}>
                                {isFull && <p className="text-[11px] leading-4 text-slate-500">Ready for 2v2 queue.</p>}
                                <button
                                    type="button"
                                    onClick={() => void leaveParty()}
                                    disabled={partyAction !== null}
                                    className="shrink-0 font-mono text-[9px] font-bold tracking-widest text-rose-300 hover:text-rose-200 disabled:opacity-50"
                                >
                                    {partyAction === "leave" ? "LEAVING..." : "LEAVE"}
                                </button>
                            </div>
                        </>
                    ) : partyLoading ? (
                        <p className="px-1 py-4 text-xs text-slate-500">Connecting to party...</p>
                    ) : (
                        <div className="px-1 py-2">
                            <p className="text-xs leading-5 text-slate-400">Create a party with a teammate to queue 2v2s together.</p>
                            <button
                                type="button"
                                onClick={() => void createParty()}
                                disabled={partyAction !== null}
                                className="mt-3 min-h-9 w-full rounded border border-cyan-400/60 bg-cyan-950/40 px-3 font-mono text-[10px] font-bold tracking-widest text-cyan-100 hover:bg-cyan-900/50 disabled:cursor-wait disabled:opacity-50"
                            >
                                {partyAction === "create" ? "CREATING..." : "CREATE PARTY"}
                            </button>
                        </div>
                    )}

                    {(partyMessage || partyError || partyLoadError) && (
                        <p className={`mt-3 border-t border-slate-800/80 pt-3 text-[11px] leading-4 ${partyError || partyLoadError ? "text-rose-300" : "text-emerald-300"}`} role={partyError || partyLoadError ? "alert" : "status"}>
                            {partyError ?? partyLoadError ?? partyMessage}
                        </p>
                    )}
                </section>
            )}
        </div>
    );
}
