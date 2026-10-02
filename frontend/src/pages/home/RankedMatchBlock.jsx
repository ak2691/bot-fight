import { useEffect, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "../../auth/auth-context";
import { apiUrl } from "../../config/api";
import { useMatchmaking } from "../../matchmaking/matchmaking-context";
import { MATCH_MODES, QUEUE_MODES } from "../../matchmaking/matchModes";
import QueueAbilityGuaranteePicker from "../queue/QueueAbilityGuaranteePicker.jsx";
import { ButtonIcon } from "../../components/exploreTileArt.jsx";
import Toast, { ToastStack } from "../../components/Toast.jsx";
import { guaranteeSummary } from "../queue/queueGuarantees.js";

const PARTY_QUEUE_NOTICE_DURATION_MS = 3500;

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

function recordParts(stats) {
    const values = [stats?.wins, stats?.losses, stats?.draws].map(numericStat);
    return values.every((value) => value !== null) ? values : null;
}

// Ranked matchmaking, practice and private-match entry points. This is QueuePage's behaviour moved onto the home page.
export default function RankedMatchBlock({ activeMatch = false, activeMatchId = null, profileStats = null }) {
    const navigate = useNavigate();
    const location = useLocation();
    const { user, isGuest } = useAuth();
    const [customLobby, setCustomLobby] = useState(null);
    const [customLobbyChecked, setCustomLobbyChecked] = useState(false);
    const {
        isQueueing,
        queueMode,
        queueElapsed,
        queueReconnectRemaining,
        connectionStatus,
        pendingAcceptance,
        activeMatchStatus,
        queueGuarantees,
        updateQueueGuarantee,
        startQueue,
        cancelQueue,
        party,
    } = useMatchmaking();
    const [selectedMode, setSelectedMode] = useState(queueMode ?? (QUEUE_MODES.some((candidate) => candidate.id === location.state?.queueMode) ? location.state.queueMode : MATCH_MODES.ONES));
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
        if (!partyQueueNotice) return undefined;
        const timeoutId = window.setTimeout(() => setPartyQueueNotice(null), PARTY_QUEUE_NOTICE_DURATION_MS);
        return () => window.clearTimeout(timeoutId);
    }, [partyQueueNotice]);

    const displayedMode = isQueueing && queueMode ? queueMode : selectedMode;
    const mode = QUEUE_MODES.find((candidate) => candidate.id === displayedMode) ?? QUEUE_MODES[0];
    const modeStats = mode.id === MATCH_MODES.TWOS ? profileStats?.twos : profileStats?.ones;
    const record = recordParts(modeStats);
    const members = party?.members ?? [];
    const isPartyLeader = members.some((member) => (
        member.leader === true && String(member.userId) === String(user?.id)
    ));
    const isFullParty = Boolean(party && members.length >= party.capacity);
    const partyHasOfflineMember = Boolean(party && members.some((member) => member.online === false));
    const partyQueueBlocked = Boolean(party && !isPartyLeader);
    const hasCustomLobby = Boolean(customLobby?.lobbyId);
    const rankedParticipationActive = Boolean(
        isQueueing || pendingAcceptance || activeMatchStatus?.activeMatch,
    );

    const modeBlocked = (candidate) => (
        partyQueueBlocked
        || partyHasOfflineMember
        || (isFullParty && candidate.id === MATCH_MODES.ONES)
    );

    const requestQueue = (candidate) => {
        if (!candidate.available || isQueueing || hasCustomLobby) return;
        if (isFullParty && candidate.id === MATCH_MODES.ONES) {
            setPartyQueueNotice("A party of 2 cannot queue a 1v1.");
            return;
        }
        if (modeBlocked(candidate)) return;
        setSelectedMode(candidate.id);
        void startQueue(candidate.id, queueGuarantees);
    };

    const partySizeBlocked = isFullParty && mode.id === MATCH_MODES.ONES;
    const queueActionDisabled = !mode.available
        || hasCustomLobby
        || isQueueing
        || (modeBlocked(mode) && !(partySizeBlocked && isPartyLeader));

    const rejoinMatch = () => navigate("/match", {
        state: {
            activeMatchVerified: true,
            matchId: activeMatchId,
        },
    });

    const state = activeMatch ? "active" : isQueueing ? "searching" : "idle";

    return (
        <section className="hq-block" aria-labelledby="hq-title" data-state={state}>
            {state === "active" && (
                <>
                    <header className="hq-head">
                        <h2 id="hq-title" className="hq-title">Match in progress</h2>
                    </header>
                    <p className="hq-note">Your ranked match is still running.</p>
                    <button type="button" onClick={rejoinMatch} className="hud-btn hud-btn--primary hud-btn--lg">
                        <ButtonIcon name="rejoin" /><span>Rejoin match</span>
                    </button>
                </>
            )}

            {state === "searching" && (
                <>
                    <header className="hq-head">
                        <h2 id="hq-title" className="hq-title">Searching for a {mode.label.toUpperCase()}</h2>
                        <span className="hq-timer" aria-live="polite">{formatQueueTime(queueElapsed)}</span>
                    </header>
                    <div className="hq-progress" role="progressbar" aria-label="Searching for a match" aria-valuetext="Searching"><span /></div>
                    <p className="hq-note">Offers locked in: {guaranteeSummary(queueGuarantees)}</p>
                    {connectionStatus !== "CONNECTED" && (
                        <p className="hq-note hq-note--warn" role="status">
                            Reconnecting{queueReconnectRemaining > 0 ? ` · ${queueReconnectRemaining}s` : ""}
                        </p>
                    )}
                    <button type="button" onClick={cancelQueue} className="hud-btn hud-btn--regular hud-btn--lg hq-cancel" aria-label={`Cancel ${mode.label} queue`}>
                        Cancel
                    </button>
                </>
            )}

            {state === "idle" && (
                <>
                    <header className="hq-head">
                        <h2 id="hq-title" className="hq-title">Ranked match</h2>
                        <span className="hq-stats" aria-label={`${mode.label} stats`}>
                            <b>{formatQueueElo(modeStats)}</b>
                            <span className="hq-stats__record">
                                {record ? (
                                    <>
                                        {" · "}<span className="hq-win">{record[0]}W</span> <span className="hq-loss">{record[1]}L</span> <span className="hq-draw">{record[2]}D</span>
                                    </>
                                ) : " · ..."}
                            </span>
                        </span>
                        <div className="hq-toggle" role="group" aria-label="Queue mode">
                            {QUEUE_MODES.map((candidate) => (
                                <button
                                    key={candidate.id}
                                    type="button"
                                    aria-pressed={displayedMode === candidate.id}
                                    disabled={!candidate.available}
                                    className={displayedMode === candidate.id ? "is-active" : ""}
                                    onClick={() => setSelectedMode(candidate.id)}
                                >
                                    {candidate.label.toUpperCase()}
                                </button>
                            ))}
                        </div>
                    </header>

                    {isGuest && (
                        <p className="hq-notice" role="status">
                            Guest matches are against other guests only. No Elo or match history is saved.
                        </p>
                    )}

                    <QueueAbilityGuaranteePicker
                        values={queueGuarantees}
                        onChange={updateQueueGuarantee}
                        disabled={isQueueing}
                    />

                    <button
                        type="button"
                        disabled={queueActionDisabled}
                        onClick={() => requestQueue(mode)}
                        aria-label={`Find ${mode.label} match`}
                        className="hud-btn hud-btn--primary hud-btn--lg hq-queue"
                    >
                        <ButtonIcon name="queue" /><span>Queue match</span>
                    </button>

                    <div className="hq-secondary">
                        <button type="button" onClick={() => navigate("/practice")} className="hud-btn hud-btn--regular">
                            <ButtonIcon name="practice" /><span>Practice room</span>
                        </button>
                        {!isGuest && (
                            <button
                                type="button"
                                onClick={() => navigate("/custom-lobby", hasCustomLobby ? undefined : { state: { create: true } })}
                                disabled={!hasCustomLobby && (rankedParticipationActive || !customLobbyChecked)}
                                aria-label={hasCustomLobby ? "Open custom lobby" : "Create custom lobby"}
                                className="hud-btn hud-btn--regular"
                            >
                                <ButtonIcon name="private" /><span>{!customLobbyChecked ? "Checking..." : hasCustomLobby ? "Open lobby" : "Private match"}</span>
                            </button>
                        )}
                    </div>
                </>
            )}

            {(partyQueueBlocked || partyHasOfflineMember) && (
                <div className="hq-notice hq-notice--party">
                    {partyQueueBlocked && <p>Only the party leader can start the party queue.</p>}
                    {partyHasOfflineMember && (
                        <p>
                            {isQueueing
                                ? "A party member is offline. A match cannot be found until everyone is online. The queue timer continues while they reconnect."
                                : "Every party member must be online before the queue can start."}
                        </p>
                    )}
                </div>
            )}

            {partyQueueNotice && (
                <ToastStack>
                    <Toast tone="warning" onDismiss={() => setPartyQueueNotice(null)}>{partyQueueNotice}</Toast>
                </ToastStack>
            )}
        </section>
    );
}
