export function formatRelativeTime(value, now = Date.now()) {
    const timestamp = value ? new Date(value).getTime() : Number.NaN;
    if (!Number.isFinite(timestamp)) return null;
    const seconds = Math.max(0, Math.floor((now - timestamp) / 1000));
    if (seconds < 45) return "just now";
    const minutes = Math.round(seconds / 60);
    if (minutes < 60) return `${minutes} min ago`;
    const hours = Math.round(minutes / 60);
    if (hours < 24) return `${hours} h ago`;
    return `${Math.round(hours / 24)} d ago`;
}
