import Arena from "../../../gameArena/Arena";
import MatchChat from "../../../matchmaking/MatchChat";
import { useAuth } from "../../../auth/auth-context";
import { DisconnectNotice } from "./MatchHeader.jsx";

export default function MatchView({
    chatOnly = false,
    matchContext,
    socketStatus,
    hasSurrendered,
    surrenderPending,
    hasFinished,
    finishPending,
    finishError,
    onFinishMatch,
    onSurrenderMatch,
    onExit,
    disconnectNotice,
    disconnectRemaining,
    chatMessages,
    chatMinimized,
    onChatMinimizedChange,
    onSendChat,
    chatClosed,
    chatRateLimitNotice,
    chatClosedNotice,
}) {
    const { isGuest, user } = useAuth();
    const teamByUsername = Object.fromEntries(
        (matchContext?.players ?? [])
            .filter((participant) => participant?.username)
            .map((participant) => [participant.username, Number(participant.teamNumber)]),
    );
    const chat = !isGuest && matchContext?.matchId ? (
        <MatchChat
            messages={chatMessages}
            minimized={chatMinimized}
            onMinimizedChange={onChatMinimizedChange}
            onSend={onSendChat}
            disabled={chatClosed || socketStatus !== "CONNECTED"}
            rateLimitNotice={chatRateLimitNotice}
            closedNotice={chatClosedNotice}
            currentUsername={user?.username ?? matchContext?.player?.username}
            teamByUsername={teamByUsername}
        />
    ) : null;

    if (chatOnly) return chat;

    return (
        <>
            <Arena
                matchContext={matchContext}
                finishStatus={hasSurrendered
                    ? "SURRENDER_VOTED"
                    : surrenderPending
                        ? "SURRENDERING"
                        : hasFinished
                            ? "FINISHED"
                            : finishPending
                                ? "SUBMITTING"
                                : "BUILDING"}
                finishError={finishError}
                onFinishMatch={onFinishMatch}
                onSurrenderMatch={onSurrenderMatch}
                onExit={onExit}
            />
            <DisconnectNotice notice={disconnectNotice} remaining={disconnectRemaining} />
            {chat}
        </>
    );
}
