import { useEffect, useRef, useState } from "react";

const MAX_MESSAGE_LENGTH = 280;

export default function CustomLobbyChat({ messages, onSend, disabled = false, notice = null, className = "" }) {
    const [draft, setDraft] = useState("");
    const messagesRef = useRef(null);

    useEffect(() => {
        if (messagesRef.current) messagesRef.current.scrollTop = messagesRef.current.scrollHeight;
    }, [messages]);

    const submit = (event) => {
        event.preventDefault();
        const message = draft.trim();
        if (!message || disabled) return;
        if (onSend(message) !== false) setDraft("");
    };

    return (
        <section className={`custom-lobby-chat ${className}`.trim()} aria-label="Custom lobby chat">
            <header className="custom-lobby-chat__header">
                <span><ChatIcon /> LOBBY CHAT</span>
                <span className="custom-lobby-chat__channel">ALL CHAT</span>
            </header>
            <div ref={messagesRef} className="custom-lobby-chat__messages" aria-live="polite">
                {messages.length === 0 && <p className="custom-lobby-chat__empty">No messages yet.</p>}
                {messages.map((message) => (
                    <p key={message.messageId ?? `${message.sentAt}-${message.username}-${message.message}`} className="custom-lobby-chat__message">
                        <strong>{message.username}:</strong> {message.message}
                    </p>
                ))}
            </div>
            {notice && <p role="status" className="custom-lobby-chat__notice">{notice}</p>}
            <form className="custom-lobby-chat__form" onSubmit={submit}>
                <input
                    id="custom-lobby-chat-message"
                    name="message"
                    type="text"
                    value={draft}
                    onChange={(event) => setDraft(event.target.value)}
                    maxLength={MAX_MESSAGE_LENGTH}
                    placeholder={disabled ? "Chat unavailable" : "Type a message..."}
                    aria-label="Custom lobby chat message"
                    autoComplete="off"
                    disabled={disabled}
                />
                <button type="submit" className="gray-button-surface" disabled={disabled || !draft.trim()} aria-label="Send lobby chat message">➤</button>
            </form>
        </section>
    );
}

function ChatIcon() {
    return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 5.5h14v10H9l-4 3v-13Z" /></svg>;
}
