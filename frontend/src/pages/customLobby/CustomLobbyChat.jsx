import ChatPanel from "../../components/ChatPanel.jsx";
import ProfileLink from "../../components/ProfileLink.jsx";

export default function CustomLobbyChat({ messages, onSend, disabled = false, notice = null, className = "", currentUsername = null, teamByUsername = null }) {
    return (
        <ChatPanel
            className={`custom-lobby-chat ${className}`.trim()}
            label="Custom lobby chat"
            inputId="custom-lobby-chat-message"
            inputLabel="Custom lobby chat message"
            sendLabel="Send lobby chat message"
            messages={messages}
            currentUsername={currentUsername}
            teamByUsername={teamByUsername}
            onSend={onSend}
            disabled={disabled}
            notice={notice}
            renderName={(username) => <ProfileLink username={username}>{username}</ProfileLink>}
        />
    );
}
