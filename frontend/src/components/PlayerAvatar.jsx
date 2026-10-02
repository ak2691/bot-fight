/**
 * The one player avatar tile: the name's initial in Chakra Petch 700 on the shared avatar
 * colour, as a rounded square (radius is ~23% of the size: 56 -> 13px, 36 -> 9px, 30 -> 8px, 24 -> 6px).
 * The round bot-face logo is a different thing and is not replaced by this.
 */
export default function PlayerAvatar({ name, size = 32, className = "" }) {
    const initial = String(name ?? "").trim().slice(0, 1).toUpperCase() || "?";
    return (
        <span
            aria-hidden="true"
            className={`player-avatar ${className}`.trim()}
            style={{
                width: size,
                height: size,
                borderRadius: Math.round(size * 0.23),
                fontSize: Math.max(10, Math.round(size * 0.42)),
            }}
        >
            {initial}
        </span>
    );
}
