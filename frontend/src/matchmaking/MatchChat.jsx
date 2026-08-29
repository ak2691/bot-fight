import { useEffect, useRef, useState } from "react";

const MAX_MESSAGE_LENGTH = 280;
const ALL_CHAT = "ALL";
const TEAM_CHAT = "TEAM";

export default function MatchChat({ messages, minimized, onMinimizedChange, onSend, disabled = false, rateLimitNotice = null, closedNotice = null, currentUsername = null }) {
    const [draft, setDraft] = useState("");
    const [activeChannel, setActiveChannel] = useState(ALL_CHAT);
    const messagesRef = useRef(null);
    const unread = minimized && messages.some((message) => message.unread && message.username !== currentUsername);
    const visibleMessages = messages.filter((message) => messageChannel(message) === activeChannel);

    useEffect(() => {
        if (!minimized && messagesRef.current) messagesRef.current.scrollTop = messagesRef.current.scrollHeight;
    }, [activeChannel, messages, minimized]);

    const submit = (event) => {
        event.preventDefault();
        const message = draft.trim();
        if (!message || disabled) return;
        if (onSend(message, activeChannel) !== false) setDraft("");
    };

    if (minimized) return (
        <aside className="match-chat match-chat--minimized" aria-label="Match chat minimized">
            <button type="button" className="match-chat__restore" onClick={() => onMinimizedChange(false)} aria-label="Open match chat">
                <ChatIcon />{unread && <span className="match-chat__unread" aria-label="New opponent message" />}
            </button>
        </aside>
    );

    return (
        <aside className="match-chat" aria-label="Match chat">
            <header className="match-chat__header"><span><ChatIcon /> MATCH CHAT</span><button type="button" className="gray-button-surface" onClick={() => onMinimizedChange(true)} aria-label="Minimize match chat">−</button></header>
            <div className="match-chat__tabs" role="tablist" aria-label="Match chat channels">
                <button type="button" role="tab" aria-selected={activeChannel === ALL_CHAT} className={activeChannel === ALL_CHAT ? "match-chat__tab match-chat__tab--active" : "match-chat__tab"} onClick={() => setActiveChannel(ALL_CHAT)}>ALL CHAT</button>
                <button type="button" role="tab" aria-selected={activeChannel === TEAM_CHAT} className={activeChannel === TEAM_CHAT ? "match-chat__tab match-chat__tab--active" : "match-chat__tab"} onClick={() => setActiveChannel(TEAM_CHAT)}>TEAM CHAT</button>
            </div>
            <div ref={messagesRef} className="match-chat__messages" aria-live="polite">
                {visibleMessages.length === 0 && <p className="match-chat__empty">No messages in {activeChannel === TEAM_CHAT ? "Team Chat" : "All Chat"} yet.</p>}
                {visibleMessages.map((message) => <p key={message.messageId ?? `${message.sentAt}-${message.username}-${message.message}`} className="match-chat__message"><strong>{message.username}:</strong> {message.message}</p>)}
            </div>
            {(closedNotice || rateLimitNotice) && <p role="status" className="match-chat__notice">{closedNotice || rateLimitNotice}</p>}
            <form className="match-chat__form" onSubmit={submit}>
                <input id="match-chat-message" name="message" type="text" value={draft} onChange={(event) => setDraft(event.target.value)} maxLength={MAX_MESSAGE_LENGTH} placeholder={disabled ? "Chat closed" : "Type a message..."} aria-label="Match chat message" autoComplete="off" disabled={disabled} />
                <button type="submit" className="gray-button-surface" disabled={disabled || !draft.trim()} aria-label="Send chat message">➤</button>
            </form>
        </aside>
    );
}

function messageChannel(message) {
    return String(message?.channel ?? ALL_CHAT).toUpperCase() === TEAM_CHAT
        ? TEAM_CHAT
        : ALL_CHAT;
}

function ChatIcon() {
    return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 5.5h14v10H9l-4 3v-13Z" /></svg>;
}
