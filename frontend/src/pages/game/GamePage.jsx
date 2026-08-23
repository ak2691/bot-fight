import { useNavigate } from "react-router-dom";
import ArenaLoadingScreen from "../../components/ArenaLoadingScreen.jsx";
import SimulationReplay from "../../replay/SimulationReplay";
import { matchReplayArenaLifecycle } from "../../replay/arenaLifecycle.js";
import MatchAcceptanceModal from "../../matchmaking/MatchAcceptanceModal.jsx";
import AbilitySelectionPanel from "./components/AbilitySelectionPanel.jsx";
import MatchHeader from "./components/MatchHeader.jsx";
import MatchView from "./components/MatchView.jsx";
import { useMatchLifecycle } from "./hooks/useMatchLifecycle.js";

const MATCH_SURFACE_CLASS = "gray-button-page min-h-screen bg-arena-deep text-ink-hi font-ui";

export default function GamePage() {
    const navigate = useNavigate();
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
                />
                <MatchAcceptanceModal
                    remaining={remaining}
                    authoritativeRemaining={matchAcceptanceAuthoritativeRemaining}
                    deadlineMs={matchAcceptanceDeadlineMs}
                    visibleStartMs={matchAcceptanceStartDeadlineMs}
                    acceptanceState={matchAcceptanceState}
                    otherPlayerAccepted={matchEvent?.otherPlayerAccepted === true}
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
                />
                <SimulationReplay
                    key={replayArena.key}
                    playback={playback}
                    preloadShapes={preloadShapes}
                />
                <MatchView {...matchViewProps} chatOnly />
            </main>
        );
    }

    if (queueStatus === "LOADOUT_SELECT") {
        return (
            <main className={MATCH_SURFACE_CLASS}>
                <MatchHeader
                    onExit={exitToHome}
                    disconnectNotice={disconnectNotice}
                    disconnectRemaining={disconnectRemaining}
                />
                <AbilitySelectionPanel
                    loadout={loadoutChoice}
                    onChange={setLoadoutChoice}
                    onLockLoadout={lockLoadout}
                    submitting={loadoutSubmitPending}
                    player={matchEvent?.player}
                    opponent={matchEvent?.opponent}
                    roundNumber={matchEvent?.roundNumber ?? 1}
                    abilityOffers={matchEvent?.abilityOffers ?? []}
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
