// Tile art shared by the homepage explore tiles and the tutorial's "What's next" cards.
const TILE_ABILITY_ICONS = [
    "/assets/ability-list/icons/temporal_rewind.webp",
    "/assets/ability-list/icons/rail_shot.webp",
    "/assets/ability-list/icons/shoot_fireball.webp",
];

export function PuzzleTileIcon() {
    return (
        <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M10 4a2 2 0 1 1 4 0v1h3a1 1 0 0 1 1 1v3h-1a2 2 0 1 0 0 4h1v3a1 1 0 0 1-1 1h-3v-1a2 2 0 1 0-4 0v1H7a1 1 0 0 1-1-1v-3h1a2 2 0 1 0 0-4H6V6a1 1 0 0 1 1-1h3Z" />
        </svg>
    );
}

export function ConditionalsTileIcon() {
    return (
        <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <circle cx="6" cy="5" r="2" /><circle cx="6" cy="19" r="2" /><circle cx="18" cy="12" r="2" />
            <path d="M6 7v10" /><path d="M6 12h6a4 4 0 0 0 4 0" />
        </svg>
    );
}

/** The overlapping stack of three ability icons. */
export function AbilityTileArt() {
    return (
        <span className="hq-tile__art" aria-hidden="true">
            {TILE_ABILITY_ICONS.map((icon) => <img key={icon} src={icon} alt="" />)}
        </span>
    );
}

/** Icons for the homepage action buttons (queue, practice, private match, rejoin). */
export function ButtonIcon({ name }) {
    const paths = {
        queue: <><path d="m14.5 4 5.5 5.5" /><path d="m4 20 8-8" /><path d="m10 4-6 6 2 2 6-6Z" /><path d="m14 20 6-6-2-2-6 6Z" /></>,
        practice: <><circle cx="12" cy="12" r="8" /><circle cx="12" cy="12" r="3" /></>,
        private: <><path d="M4 20v-2a4 4 0 0 1 4-4h2" /><circle cx="9" cy="8" r="3" /><path d="M14 20v-1.5a3.5 3.5 0 0 1 3.5-3.5H20" /><circle cx="17" cy="10" r="2.5" /></>,
        rejoin: <><path d="M5 12h14" /><path d="m13 6 6 6-6 6" /></>,
    };
    return <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{paths[name]}</svg>;
}
