import { Link } from "react-router-dom";

function normalizedUsername(username) {
    return String(username ?? "").trim();
}

function profilePath(username) {
    return `/profile/${encodeURIComponent(username)}`;
}

export default function ProfileLink({ username, className = "", children = null }) {
    const label = normalizedUsername(username);
    if (!label) return children ?? null;

    return (
        <Link
            to={profilePath(label)}
            aria-label={`Open ${label}'s profile`}
            className={`max-w-full truncate transition hover:text-cyan-200 hover:underline hover:decoration-cyan-400/70 hover:underline-offset-2 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-cyan-400 ${className}`.trim()}
        >
            {children ?? label}
        </Link>
    );
}
