// The lanes editor's small icon set: inline SVG, 24-unit grid, stroke in currentColor. Names are the ones the
// condition catalog and the card rows use. Ability cards show the real ability artwork instead (ActionGlyph).
import { getAbilityCatalogueIcon } from "../../../abilityCatalogueIcons.js";

const PATHS = Object.freeze({
    heart: <path d="M12 20s-7-4.4-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 10c0 5.6-7 10-7 10z" />,
    heartBroken: <><path d="M12 20s-7-4.4-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 10c0 5.6-7 10-7 10z" /><path d="M12 8l-1.5 3 2 1-1.5 3" /></>,
    bolt: <path d="M13 3L5 14h6l-1 7 8-11h-6z" />,
    run: <><circle cx="14" cy="5" r="1.8" /><path d="M10 21l2-6 3 2 1 4M9 11l3-2 3 4 3 1M11 14l-2 2" /></>,
    turn: <><path d="M4 12a8 8 0 0 1 14-5.3M20 12a8 8 0 0 1-14 5.3" /><path d="M18 3v4h-4M6 21v-4h4" /></>,
    ruler: <><path d="M3 17L17 3l4 4L7 21z" /><path d="M7 13l2 2M10 10l2 2M13 7l2 2" /></>,
    edge: <path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5" />,
    clock: <><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></>,
    clockPause: <><circle cx="12" cy="12" r="9" /><path d="M10 9v6M14 9v6" /></>,
    hourglass: <path d="M7 3h10M7 21h10M8 3c0 5 8 5 8 9s-8 4-8 9M16 3c0 5-8 5-8 9s8 4 8 9" />,
    eye: <><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z" /><circle cx="12" cy="12" r="3" /></>,
    target: <><circle cx="12" cy="12" r="9" /><circle cx="12" cy="12" r="5" /><circle cx="12" cy="12" r="1" /></>,
    trend: <path d="M3 17l6-6 4 4 8-8M15 7h6v6" />,
    flame: <path d="M12 21c-4 0-6-2.7-6-6 0-3 2-4.8 3-7 .5 2 1.5 3 3 3.5 0-3 1-5 3-7 0 3 1 5 1 7 1 .5 2 2 2 3.5 0 3-2.5 6-6 6z" />,
    compass: <><circle cx="12" cy="12" r="9" /><path d="M15 9l-2 6-4-2z" /></>,
    crosshair: <><path d="M12 3v18M3 12h18" /><circle cx="12" cy="12" r="4" /></>,
    play: <path d="M7 5l12 7-12 7z" />,
    battery: <><rect x="3" y="8" width="16" height="8" rx="2" /><path d="M21 11v2" /></>,
    hash: <path d="M5 9h14M5 15h14M10 4l-2 16M16 4l-2 16" />,
    check: <><circle cx="12" cy="12" r="9" /><path d="M8 12l3 3 5-6" /></>,
    zone: <circle cx="12" cy="12" r="9" strokeDasharray="3 3" />,
    sparkle: <path d="M12 3v4M12 17v4M3 12h4M17 12h4M6 6l2.5 2.5M15.5 15.5L18 18M18 6l-2.5 2.5M8.5 15.5L6 18" />,
    box: <><path d="M12 3l8 4.5v9L12 21l-8-4.5v-9z" /><path d="M4 7.5l8 4.5 8-4.5M12 12v9" /></>,
    braces: <path d="M8 4c-2 0-2 1-2 3v2c0 1-1 2-2 2 1 0 2 1 2 2v2c0 2 0 3 2 3M16 4c2 0 2 1 2 3v2c0 1 1 2 2 2-1 0-2 1-2 2v2c0 2 0 3-2 3" />,
    walk: <><circle cx="13" cy="4.5" r="1.8" /><path d="M11 21l1-5-2-3 1-4 4 1 2 3M9 10l-2 4-3 1" /></>,
    arrowBack: <><path d="M9 14L4 9l5-5" /><path d="M4 9h11a5 5 0 0 1 0 10h-3" /></>,
    arrowUp: <path d="M12 19V5M5 12l7-7 7 7" />,
    arrowDown: <path d="M12 5v14M19 12l-7 7-7-7" />,
    copy: <><rect x="9" y="9" width="11" height="11" rx="2" /><path d="M5 15V5a2 2 0 0 1 2-2h10" /></>,
    eyeOff: <><path d="M3 3l18 18" /><path d="M10.6 6.1A10 10 0 0 1 12 6c6.5 0 10 6 10 6a17 17 0 0 1-3 3.8M6.6 6.6A17 17 0 0 0 2 12s3.5 6 10 6a10 10 0 0 0 4.4-1" /></>,
    trash: <path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3" />,
    cornerDownRight: <><path d="M6 6v6a3 3 0 0 0 3 3h9" /><path d="M14 11l4 4-4 4" /></>,
    plus: <path d="M12 5v14M5 12h14" />,
    x: <path d="M6 6l12 12M18 6L6 18" />,
    search: <><circle cx="11" cy="11" r="7" /><path d="M20 20l-4-4" /></>,
});

/** One icon by name. Unknown names draw nothing, so a missing entry never breaks a row. */
export function LaneIcon({ name, size = 16, className = "" }) {
    const body = PATHS[name];
    if (!body) return null;
    return (
        <svg
            className={`lane-icon ${className}`.trim()}
            width={size}
            height={size}
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth={2}
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
            focusable="false"
        >
            {body}
        </svg>
    );
}

/** The three-dot ⋯ glyph for row menus (filled dots, so it reads at 16 px). */
export function DotsIcon({ size = 16 }) {
    return (
        <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" focusable="false" className="lane-icon">
            <circle cx="5" cy="12" r="2" />
            <circle cx="12" cy="12" r="2" />
            <circle cx="19" cy="12" r="2" />
        </svg>
    );
}

/** Which icon a plain (non-ability) action draws, by the lane it belongs to. */
const ACTION_ICON_BY_HEAD = Object.freeze({
    movement: "walk",
    rotation: "target",
    cancel: "arrowBack",
    variable: "braces",
});

/**
 * An action's glyph in a chip: the ability's own artwork for an ability or dash card, otherwise a small inline icon for
 * its lane. `size` is the chip's pixel size.
 */
/** Artwork that does not read at icon size: the Sniper's artwork is a thin beam, so an ability draws its lane icon. */
const SLIVER_ARTWORK = new Set(["/assets/ability-list/icons/fire_gun.webp"]);
/** Artwork that is nearly black on the dark square: brightened so its shape shows. */
const DARK_ARTWORK = new Set(["/assets/ability-list/icons/silence_pulse.webp"]);

export function ActionGlyph({ abilityId = null, head = null, size = 26 }) {
    const artwork = abilityId == null ? null : getAbilityCatalogueIcon(abilityId);
    if (artwork && !SLIVER_ARTWORK.has(artwork)) {
        return (
            <span className="lane-glyph lane-glyph--art" style={{ width: size, height: size }}>
                <img className={DARK_ARTWORK.has(artwork) ? "is-boosted" : undefined} src={artwork} alt="" width={size - 6} height={size - 6} draggable={false} />
            </span>
        );
    }
    if (artwork) {
        // The sliver artwork: the lane's icon on the same dark square, stroked in the lane colour.
        return (
            <span className="lane-glyph lane-glyph--art" style={{ width: size, height: size, color: "var(--lane-tone, #3aa6c9)" }}>
                <LaneIcon name="crosshair" size={Math.round(size * 0.66)} />
            </span>
        );
    }
    return (
        <span className="lane-glyph" style={{ width: size, height: size }}>
            <LaneIcon name={ACTION_ICON_BY_HEAD[head] ?? "bolt"} size={Math.round(size * 0.62)} />
        </span>
    );
}
