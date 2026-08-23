import Arena from "../../../gameArena/Arena";
import MatchChat from "../../../matchmaking/MatchChat";
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
    const chat = matchContext?.matchId ? (
        <MatchChat
            messages={chatMessages}
            minimized={chatMinimized}
            onMinimizedChange={onChatMinimizedChange}
            onSend={onSendChat}
            disabled={chatClosed || socketStatus !== "CONNECTED"}
            rateLimitNotice={chatRateLimitNotice}
            closedNotice={chatClosedNotice}
            currentUsername={matchContext?.player?.username}
        />
    ) : null;

    if (chatOnly) return chat;

    return (
        <>
            <Arena
                matchContext={matchContext}
                finishStatus={hasSurrendered
                    ? "SURRENDERED"
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
