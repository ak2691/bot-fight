import { useNavigate } from "react-router-dom";
import ArenaLoadingScreen from "../../components/ArenaLoadingScreen.jsx";
import SimulationReplay from "../../replay/SimulationReplay";
import { matchReplayArenaLifecycle } from "../../replay/arenaLifecycle.js";
import MatchAcceptanceModal from "../../matchmaking/MatchAcceptanceModal.jsx";
import { useMatchmaking } from "../../matchmaking/matchmaking-context.js";
import AbilitySelectionPanel from "./components/AbilitySelectionPanel.jsx";
import MatchHeader from "./components/MatchHeader.jsx";
import MatchView from "./components/MatchView.jsx";
import { useMatchLifecycle } from "./hooks/useMatchLifecycle.js";

const MATCH_SURFACE_CLASS = "min-h-screen bg-arena-deep text-ink-hi font-ui";

function matchModeContextLabel(mode) {
    const normalized = String(mode ?? "").toUpperCase();
    if (normalized === "ONES") return "Ranked 1v1";
    if (normalized === "TWOS") return "Ranked 2v2";
    if (normalized === "CUSTOM") return "Custom match";
    return null;
}

export default function GamePage() {
    const navigate = useNavigate();
    const { queueGuarantees } = useMatchmaking();
    const lifecycle = useMatchLifecycle({
        navigate,
    });
    const {
        queueStatus,
        socketStatus,
        matchEvent,
        playback,
        matchContext,
        remaining,
        matchAcceptanceDeadlineMs,
        matchAcceptanceAuthoritativeRemaining,
        matchAcceptanceStartDeadlineMs,
        matchAcceptanceState,
        matchAcceptanceError,
        loadoutChoice,
        setLoadoutChoice,
        loadoutSubmitPending,
        hasFinished,
        finishPending,
        hasSurrendered,
        surrenderPending,
        finishError,
        disconnectNotice,
        disconnectRemaining,
        chatMessages,
        chatMinimized,
        chatRateLimitNotice,
        chatClosed,
        chatClosedNotice,
        handleChatMinimizedChange,
        finishMatch,
        surrenderMatch,
        lockLoadout,
        acceptMatch,
        cancelAcceptance,
        sendChatMessage,
        exitToHome,
        preloadShapes,
    } = lifecycle;
    const returnToLobby = () => navigate("/custom-lobby");
    const matchModeLabel = matchModeContextLabel(matchEvent?.mode ?? matchContext?.mode);
    const opponentNames = (matchContext?.players ?? [])
        .filter((participant) => participant && Number(participant.teamNumber) > 0 && Number(participant.teamNumber) !== Number(matchContext?.player?.teamNumber))
        .map((participant) => participant.username)
        .filter(Boolean);
    const opponentName = opponentNames.length === 1 ? opponentNames[0] : matchContext?.opponent?.username ?? null;
    const headerContext = [matchModeLabel, opponentName && opponentNames.length <= 1 ? `vs ${opponentName}` : null].filter(Boolean).join(" · ") || null;

    const matchViewProps = {
        matchContext,
        socketStatus,
        hasSurrendered,
        surrenderPending,
        hasFinished,
        finishPending,
        finishError,
        onFinishMatch: finishMatch,
        onSurrenderMatch: surrenderMatch,
        onExit: exitToHome,
        disconnectNotice,
        disconnectRemaining,
        chatMessages,
        chatMinimized,
        onChatMinimizedChange: handleChatMinimizedChange,
        onSendChat: sendChatMessage,
        chatClosed,
        chatRateLimitNotice,
        chatClosedNotice,
    };

    if (queueStatus === "SIMULATION_LOADING") {
        return <ArenaLoadingScreen />;
    }

    if (queueStatus === "CONNECTING") {
        return <ArenaLoadingScreen />;
    }

    if (queueStatus === "MATCH_ACCEPT") {
        return (
            <main className={MATCH_SURFACE_CLASS}>
                <MatchHeader
                    onExit={exitToHome}
                    disconnectNotice={disconnectNotice}
                    disconnectRemaining={disconnectRemaining}
                    context={headerContext}
                />
                <MatchAcceptanceModal
                    remaining={remaining}
                    authoritativeRemaining={matchAcceptanceAuthoritativeRemaining}
                    deadlineMs={matchAcceptanceDeadlineMs}
                    visibleStartMs={matchAcceptanceStartDeadlineMs}
                    acceptanceState={matchAcceptanceState}
                    otherPlayerAccepted={matchEvent?.otherPlayerAccepted === true}
                    mode={matchEvent?.mode ?? null}
                    connectionStatus={socketStatus}
                    error={matchAcceptanceError}
                    onAccept={acceptMatch}
                    onClose={cancelAcceptance}
                />
            </main>
        );
    }

    const replayArena = matchReplayArenaLifecycle(queueStatus, playback);
    if (replayArena.mounted) {
        return (
            <main className={MATCH_SURFACE_CLASS}>
                <MatchHeader
                    onExit={exitToHome}
                    disconnectNotice={disconnectNotice}
                    disconnectRemaining={disconnectRemaining}
                    context={headerContext}
                />
                <SimulationReplay
                    key={replayArena.key}
                    playback={playback}
                    preloadShapes={preloadShapes}
                    isCustomMatch={matchEvent?.mode === "CUSTOM"}
                    isFinalMatchResult={matchEvent?.type === "MATCH_RESULT_READY"}
                    onReturnToLobby={returnToLobby}
                    mode={matchEvent?.mode ?? null}
                    onHome={exitToHome}
                    onQueueAgain={() => navigate("/home", { state: { queueMode: matchEvent?.mode ?? null } })}
                />
                <MatchView {...matchViewProps} chatOnly />
            </main>
        );
    }

    if (queueStatus === "LOADOUT_SELECT") {
        const currentRound = Math.max(1, Number(matchEvent?.roundNumber ?? 1));
        return (
            <main className={MATCH_SURFACE_CLASS}>
                <MatchHeader
                    onExit={exitToHome}
                    disconnectNotice={disconnectNotice}
                    disconnectRemaining={disconnectRemaining}
                    context={headerContext}
                />
                <AbilitySelectionPanel
                    loadout={loadoutChoice}
                    onChange={setLoadoutChoice}
                    onLockLoadout={lockLoadout}
                    submitting={loadoutSubmitPending}
                    player={matchContext?.player}
                    opponent={matchContext?.opponent}
                    players={matchContext?.players}
                    roundNumber={matchEvent?.roundNumber ?? 1}
                    abilityOffers={matchEvent?.abilityOffers ?? []}
                    guaranteedAbilityId={queueGuarantees?.[currentRound - 1] ?? null}
                    remaining={remaining}
                    error={finishError}
                    onSurrender={surrenderMatch}
                    surrenderPending={surrenderPending}
                    hasSurrendered={hasSurrendered}
                    canSurrender={socketStatus === "CONNECTED"}
                />
                <MatchView {...matchViewProps} chatOnly />
            </main>
        );
    }

    if (queueStatus === "PREP" || queueStatus === "WAITING_FOR_FINISH" || queueStatus === "READY_FOR_PLAYBACK") {
        return <MatchView {...matchViewProps} />;
    }

    return null;
}
