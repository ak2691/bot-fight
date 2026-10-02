import { useEffect, useRef, useState } from "react";
import ChatReportButton from "../chatModeration/ChatReportButton.jsx";
import PlayerAvatar from "./PlayerAvatar.jsx";
import { groupChatMessages, isSystemChatMessage, shortChatTime } from "./chatPanelFormat.js";

const MAX_MESSAGE_LENGTH = 280;
export const ALL_CHAT = "ALL";
export const TEAM_CHAT = "TEAM";

function messageChannel(message) {
    return String(message?.channel ?? ALL_CHAT).toUpperCase() === TEAM_CHAT ? TEAM_CHAT : ALL_CHAT;
}

export function ChatIcon() {
    return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 5.5h14v10H9l-4 3v-13Z" /></svg>;
}

function SendIcon() {
    return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m4 12 16-8-5 16-3-7Z" /></svg>;
}

function teamTone(teamNumber) {
    const team = Number(teamNumber);
    if (team === 1) return "blue";
    if (team === 2) return "red";
    return "none";
}

/**
 * The one chat panel shared by the match chat and the custom-lobby chat. Callers own the
 * sockets, moderation, rate limits and permissions; this component only presents messages and
 * collects a draft. `teamChat` shows the Team | All toggle and sends the active channel.
 */
export default function ChatPanel({
    className = "",
    label = "Chat",
    inputId,
    inputLabel = "Chat message",
    sendLabel = "Send chat message",
    messages,
    currentUsername = null,
    teamByUsername = null,
    teamChat = false,
    onSend,
    onMinimize = null,
    minimizeLabel = "Minimize chat",
    disabled = false,
    closed = false,
    notice = null,
    renderName = null,
    messagesClassName = "",
}) {
    const [draft, setDraft] = useState("");
    const [activeChannel, setActiveChannel] = useState(ALL_CHAT);
    const messagesRef = useRef(null);
    const channel = teamChat ? activeChannel : ALL_CHAT;
    const visibleMessages = teamChat
        ? messages.filter((message) => isSystemChatMessage(message) || messageChannel(message) === channel)
        : messages;
    const entries = groupChatMessages(visibleMessages);
    const hasContent = visibleMessages.length > 0 || Boolean(notice);

    useEffect(() => {
        if (messagesRef.current) messagesRef.current.scrollTop = messagesRef.current.scrollHeight;
    }, [channel, messages, notice]);

    const submit = (event) => {
        event.preventDefault();
        const text = draft.trim();
        if (!text || disabled) return;
        const sent = teamChat ? onSend(text, channel) : onSend(text);
        if (sent !== false) setDraft("");
    };

    const placeholder = closed
        ? "Chat is closed"
        : disabled
            ? "Chat unavailable"
            : teamChat && channel === TEAM_CHAT ? "Message team" : "Message all";

    return (
        <section className={`chat-panel ${className}`.trim()} aria-label={label}>
            <header className="chat-panel__header">
                <h2 className="chat-panel__title"><ChatIcon /> Chat</h2>
                {teamChat && (
                    <div className="chat-panel__toggle" role="tablist" aria-label="Chat channel">
                        {[[TEAM_CHAT, "Team"], [ALL_CHAT, "All"]].map(([value, text]) => (
                            <button
                                key={value}
                                type="button"
                                role="tab"
                                aria-selected={channel === value}
                                className={channel === value ? "is-active" : undefined}
                                onClick={() => setActiveChannel(value)}
                            >
                                {text}
                            </button>
                        ))}
                    </div>
                )}
                {onMinimize && (
                    <button type="button" className="chat-panel__minimize" onClick={onMinimize} aria-label={minimizeLabel}>−</button>
                )}
            </header>
            <div ref={messagesRef} className={`chat-panel__messages ${messagesClassName}`.trim()} aria-live="polite">
                {!hasContent && <p className="chat-panel__empty">No messages yet. Say hi.</p>}
                {entries.map(({ message, startsGroup }) => {
                    const key = message.messageId ?? `${message.sentAt}-${message.username}-${message.message}`;
                    if (isSystemChatMessage(message)) return <p key={key} className="chat-panel__system">{message.message}</p>;
                    const tone = teamTone(teamByUsername?.[message.username]);
                    const own = message.username === currentUsername;
                    const time = shortChatTime(message.sentAt);
                    return (
                        <div key={key} className={`chat-panel__message${startsGroup ? " is-first" : ""}`}>
                            <span className="chat-panel__avatar">{startsGroup && <PlayerAvatar name={message.username} size={24} />}</span>
                            <div className="chat-panel__body">
                                {startsGroup && (
                                    <p className="chat-panel__meta">
                                        <span className={`chat-panel__name chat-panel__name--${tone}`}>{renderName ? renderName(message.username) : message.username}</span>
                                        {messageChannel(message) === TEAM_CHAT && <span className="chat-panel__tag">TEAM</span>}
                                        {time && <span className="chat-panel__time">{time}</span>}
                                    </p>
                                )}
                                <p className="chat-panel__text">{message.message}</p>
                            </div>
                            {!own && <span className="chat-panel__report"><ChatReportButton messageId={message.messageId} /></span>}
                        </div>
                    );
                })}
                {notice && <p role="status" className="chat-panel__system">{notice}</p>}
            </div>
            <form className="chat-panel__form" onSubmit={submit}>
                <input
                    id={inputId}
                    name="message"
                    type="text"
                    value={draft}
                    onChange={(event) => setDraft(event.target.value)}
                    maxLength={MAX_MESSAGE_LENGTH}
                    placeholder={placeholder}
                    aria-label={inputLabel}
                    autoComplete="off"
                    disabled={disabled}
                />
                <button type="submit" disabled={disabled || !draft.trim()} aria-label={sendLabel}><SendIcon /></button>
            </form>
        </section>
    );
}
