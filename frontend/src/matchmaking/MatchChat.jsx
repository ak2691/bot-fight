import ChatPanel, { ChatIcon } from "../components/ChatPanel.jsx";

export default function MatchChat({ messages, minimized, onMinimizedChange, onSend, disabled = false, rateLimitNotice = null, closedNotice = null, currentUsername = null, teamByUsername = null }) {
    const unread = minimized && messages.some((message) => message.unread && message.username !== currentUsername);

    if (minimized) return (
        <aside className="match-chat match-chat--minimized" aria-label="Match chat minimized">
            <button type="button" className="match-chat__restore" onClick={() => onMinimizedChange(false)} aria-label="Open match chat">
                <ChatIcon />{unread && <span className="match-chat__unread" aria-label="New opponent message" />}
            </button>
        </aside>
    );

    return (
        <ChatPanel
            className="match-chat"
            label="Match chat"
            inputId="match-chat-message"
            inputLabel="Match chat message"
            sendLabel="Send chat message"
            messages={messages}
            currentUsername={currentUsername}
            teamByUsername={teamByUsername}
            teamChat
            onSend={onSend}
            onMinimize={() => onMinimizedChange(true)}
            minimizeLabel="Minimize match chat"
            disabled={disabled}
            closed={Boolean(closedNotice)}
            notice={closedNotice || rateLimitNotice}
        />
    );
}
