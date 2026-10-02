/** Short chat timestamp: "now", "2m", "3h", "4d". Null when the value is not a date. */
export function shortChatTime(value, now = Date.now()) {
    const timestamp = value ? new Date(value).getTime() : Number.NaN;
    if (!Number.isFinite(timestamp)) return null;
    const seconds = Math.max(0, Math.floor((now - timestamp) / 1000));
    if (seconds < 45) return "now";
    const minutes = Math.round(seconds / 60);
    if (minutes < 60) return `${minutes}m`;
    const hours = Math.round(minutes / 60);
    if (hours < 24) return `${hours}h`;
    return `${Math.round(hours / 24)}d`;
}

export function isSystemChatMessage(message) {
    return Boolean(message?.system) || String(message?.type ?? "").toUpperCase() === "SYSTEM";
}

/**
 * Marks which messages open a new sender group: a message starts a group unless the previous
 * message is from the same sender and channel and neither is a system line.
 */
export function groupChatMessages(messages) {
    return messages.map((message, index) => {
        const previous = messages[index - 1];
        const continues = Boolean(previous)
            && !isSystemChatMessage(message)
            && !isSystemChatMessage(previous)
            && previous.username === message.username
            && String(previous.channel ?? "ALL").toUpperCase() === String(message.channel ?? "ALL").toUpperCase();
        return { message, startsGroup: !continues };
    });
}
