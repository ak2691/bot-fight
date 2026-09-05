const FORFEIT_REASONS = new Set(["FORFEIT", "RESIGNATION", "DISCONNECTION"]);

export function formatCompletionReason(reason) {
    return FORFEIT_REASONS.has(reason) ? "Forfeit" : "Match Completed";
}
