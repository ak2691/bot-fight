export const MATCH_MODES = Object.freeze({
    ONES: "ONES",
    TWOS: "TWOS",
    CUSTOM: "CUSTOM",
});

export const QUEUE_MODES = Object.freeze([
    Object.freeze({
        id: MATCH_MODES.ONES,
        label: "1v1",
        available: true,
    }),
    Object.freeze({
        id: MATCH_MODES.TWOS,
        label: "2v2",
        available: true,
    }),
]);

export const MATCH_MODE_LABELS = Object.freeze({
    [MATCH_MODES.ONES]: "1v1",
    [MATCH_MODES.TWOS]: "2v2",
    [MATCH_MODES.CUSTOM]: "Custom",
});

export function matchModeLabel(mode) {
    return MATCH_MODE_LABELS[String(mode ?? "").toUpperCase()] ?? "Match";
}
