import { useEffect, useRef, useState } from "react";
import { useAuth } from "../auth/auth-context";
import { apiUrl } from "../config/api";
import { useMatchmaking } from "../matchmaking/matchmaking-context";
import { ensureCsrfHeaders } from "../security/csrf";
import ProfileLink from "./ProfileLink.jsx";
import PlayerAvatar from "./PlayerAvatar.jsx";
import { Icon } from "./SocialBits.jsx";

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

    const sendPartyInvite = async (partyId, username) => {
        const response = await fetch(apiUrl(`/api/parties/${encodeURIComponent(partyId)}/invites`), {
            method: "POST",
            credentials: "include",
            headers: {
                "Content-Type": "application/json",
                ...(await ensureCsrfHeaders("POST")),
            },
            body: JSON.stringify({ username }),
        });
        return readPartyResponse(response, "The party invite could not be sent.");
    };

    // With no party yet, Invite creates the party first and then invites in one step.
    const inviteToParty = async (event) => {
        event.preventDefault();
        const username = partyUsername.trim();
        if (!username || partyAction) return;
        if (party && !party.partyId) return;
        setPartyAction("invite");
        setPartyError(null);
        setPartyMessage(null);
        let partyId = party?.partyId ?? null;
        try {
            if (!partyId) {
                const response = await fetch(apiUrl("/api/parties"), {
                    method: "POST",
                    credentials: "include",
                    headers: await ensureCsrfHeaders("POST"),
                });
                const created = await readPartyResponse(response, "The party could not be created.");
                partyId = created?.partyId ?? null;
                if (!partyId) {
                    setPartyError(INVITE_FAILURE_MESSAGE);
                    return;
                }
            }
            const body = await sendPartyInvite(partyId, username);
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
    const canInvite = !party || (isLeader && !isFull);
    const ownName = user?.username ?? "You";
    const orderedMembers = [...members].sort((a, b) => Number(a.slot) - Number(b.slot));

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
                    className="absolute right-0 top-[calc(100%+0.5rem)] z-30 max-h-[min(32rem,calc(100vh-6rem))] w-[min(20rem,calc(100vw-2rem))] overflow-y-auto overscroll-contain rounded-xl border border-[#262c33] bg-[#0f1418] shadow-[0_18px_60px_rgba(0,0,0,.45)] game-popover"
                >
                    <div className="flex items-center justify-between gap-3 border-b border-[#262c33] px-3.5 py-3">
                        <h2 className="flex items-center gap-2 font-display text-[15px] font-bold text-[#e6edf3]">
                            <Icon name="users" className="h-4 w-4 text-cyan-300" />
                            Party
                        </h2>
                        {party && isFull
                            ? <span className="text-[11px] font-semibold text-emerald-400">{members.length}/{capacity} · Ready for 2v2</span>
                            : <span className="text-[11px] text-[#8b98a5]">{party ? `${members.length}/${capacity} · Invite a teammate` : "Queue 2v2 together"}</span>}
                    </div>

                    {partyLoading && !party ? (
                        <p className="px-3.5 py-4 text-xs text-[#8b98a5]">Connecting to party...</p>
                    ) : (
                        <div className="px-3.5 py-3">
                            {party ? (
                                <ul className="space-y-1.5" aria-label="Party slots">
                                    {orderedMembers.map((member) => {
                                        const isSelf = String(member.userId) === String(user?.id);
                                        const canKick = isLeader && !isSelf;
                                        const memberOnline = member.online !== false;
                                        return (
                                            <li key={member.userId} className="flex min-h-11 items-center gap-2.5 rounded-lg border border-[#262c33] bg-[#12181d] px-2.5">
                                                <PlayerAvatar name={member.username} size={32} />
                                                <div className="min-w-0 flex-1">
                                                    <div className="flex items-center gap-1.5">
                                                        <ProfileLink username={member.username} className="min-w-0 truncate text-[13px] font-semibold text-[#e6edf3]">{member.username}</ProfileLink>
                                                        {member.leader && <span className="shrink-0 text-[10px] font-bold text-amber-300">LEADER</span>}
                                                    </div>
                                                    <p className="flex items-center gap-1.5 text-[11px] text-[#8b98a5]">
                                                        <span
                                                            className={`h-1.5 w-1.5 shrink-0 rounded-full ${memberOnline ? "bg-emerald-400" : "bg-slate-500"}`}
                                                            aria-label={memberOnline ? "Online" : "Offline"}
                                                        />
                                                        {memberOnline ? "Online" : "Offline"}{isSelf ? " · you" : ""}
                                                    </p>
                                                </div>
                                                {canKick && (
                                                    <button
                                                        type="button"
                                                        onClick={() => void kickPartyMember(member)}
                                                        disabled={partyAction !== null}
                                                        className="min-h-8 shrink-0 rounded-md border border-[#262c33] px-2.5 text-[11px] font-semibold text-[#c9d3dc] hover:border-rose-400/60 hover:text-rose-200 disabled:cursor-not-allowed disabled:opacity-40"
                                                        aria-label={`Kick ${member.username}`}
                                                        title={`Kick ${member.username}`}
                                                    >
                                                        Remove
                                                    </button>
                                                )}
                                            </li>
                                        );
                                    })}
                                </ul>
                            ) : (
                                <div className="flex items-center gap-3">
                                    <div className="flex items-center gap-2" aria-hidden="true">
                                        <PlayerAvatar name={ownName} size={36} />
                                        <span className="grid h-9 w-9 place-items-center rounded-full border border-dashed border-[#3a444d] text-[#8b98a5]"><Icon name="plus" /></span>
                                    </div>
                                    <p className="text-xs leading-4 text-[#8b98a5]">Invite a teammate to play 2v2s together.</p>
                                </div>
                            )}

                            {isQueueing && partyHasOfflineMember && (
                                <p
                                    className="mt-3 rounded-lg border border-amber-400/35 bg-amber-950/20 px-2.5 py-2 text-[11px] leading-4 text-amber-200"
                                    role="status"
                                >
                                    A party member is offline. A match cannot be found until everyone is online. The queue timer continues while they reconnect.
                                </p>
                            )}

                            {canInvite && (
                                <form className="mt-3 flex gap-2" onSubmit={inviteToParty}>
                                    <label className="sr-only" htmlFor="navbar-party-username">Teammate username</label>
                                    <input
                                        id="navbar-party-username"
                                        value={partyUsername}
                                        onChange={(event) => setPartyUsername(event.target.value)}
                                        placeholder="Username or friend"
                                        maxLength={20}
                                        autoComplete="off"
                                        className="min-h-9 min-w-0 flex-1 rounded-md border border-[#262c33] bg-[#0b0f12] px-2.5 text-xs text-[#e6edf3] outline-none placeholder:text-[#5d6975] focus:border-cyan-400"
                                    />
                                    <button
                                        type="submit"
                                        disabled={!partyUsername.trim() || partyAction !== null}
                                        className="min-h-9 rounded-lg border-b-[3px] border-[#1d6f8a] bg-[#2a9cc4] px-3.5 font-display text-xs font-bold text-white hover:bg-[#35aed8] disabled:cursor-not-allowed disabled:opacity-50"
                                    >
                                        {partyAction === "invite" ? "..." : "Invite"}
                                    </button>
                                </form>
                            )}

                            {party && (
                                <div className="mt-3 border-t border-[#262c33] pt-2.5">
                                    <button
                                        type="button"
                                        onClick={() => void leaveParty()}
                                        disabled={partyAction !== null}
                                        className="text-[11px] font-semibold text-rose-400 hover:text-rose-300 disabled:opacity-50"
                                    >
                                        {partyAction === "leave" ? "Leaving..." : "Leave party"}
                                    </button>
                                </div>
                            )}
                        </div>
                    )}

                    {(partyMessage || partyError || partyLoadError) && (
                        <p className={`border-t border-[#262c33] px-3.5 py-2.5 text-[11px] leading-4 ${partyError || partyLoadError ? "text-rose-300" : "text-emerald-300"}`} role={partyError || partyLoadError ? "alert" : "status"}>
                            {partyError ?? partyLoadError ?? partyMessage}
                        </p>
                    )}
                </section>
            )}
        </div>
    );
}
