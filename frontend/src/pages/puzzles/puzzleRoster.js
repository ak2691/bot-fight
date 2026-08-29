export const MIN_PUZZLE_TEAM_SIZE = 1;
export const MAX_PUZZLE_TEAM_SIZE = 2;
export const PUZZLE_PLAYER_TEAM = 1;
export const PUZZLE_OPPONENT_TEAM = 2;

export function normalizePuzzleTeamSize(value, fallback = MIN_PUZZLE_TEAM_SIZE) {
    const numeric = Number(value);
    const fallbackNumeric = Number(fallback);
    const safeFallback = Number.isFinite(fallbackNumeric)
        ? Math.max(MIN_PUZZLE_TEAM_SIZE, Math.min(MAX_PUZZLE_TEAM_SIZE, Math.floor(fallbackNumeric)))
        : MIN_PUZZLE_TEAM_SIZE;
    if (!Number.isFinite(numeric)) return safeFallback;
    return Math.max(MIN_PUZZLE_TEAM_SIZE, Math.min(MAX_PUZZLE_TEAM_SIZE, Math.floor(numeric)));
}

export function puzzleBotRole(teamNumber) {
    return Number(teamNumber) === PUZZLE_OPPONENT_TEAM ? "OPPONENT" : "PLAYER";
}

/**
 * The puzzle API stores a slot within its team. The arena/ECS slot is a
 * globally unique owner key, so red-team slots follow the blue-team slots.
 */
export function puzzleSimulationSlot(teamNumberOrBot, slot = 1, playerTeamSize = MIN_PUZZLE_TEAM_SIZE) {
    const teamNumber = typeof teamNumberOrBot === "object"
        ? teamNumberOrBot?.teamNumber
        : teamNumberOrBot;
    const botSlot = typeof teamNumberOrBot === "object"
        ? teamNumberOrBot?.slot
        : slot;
    const normalizedSlot = Math.max(1, Math.floor(Number(botSlot) || 1));
    return Number(teamNumber) === PUZZLE_OPPONENT_TEAM
        ? normalizePuzzleTeamSize(playerTeamSize) + normalizedSlot
        : normalizedSlot;
}

export function puzzleBotKey(teamNumberOrBot, slot = null) {
    const teamNumber = typeof teamNumberOrBot === "object"
        ? teamNumberOrBot?.teamNumber
        : teamNumberOrBot;
    const botSlot = typeof teamNumberOrBot === "object"
        ? teamNumberOrBot?.slot
        : slot;
    return `${Number(teamNumber) || PUZZLE_PLAYER_TEAM}:${Number(botSlot) || 1}`;
}

export function sortPuzzleBots(bots) {
    return [...(Array.isArray(bots) ? bots : [])].sort((first, second) => (
        Number(first?.teamNumber ?? 0) - Number(second?.teamNumber ?? 0)
        || Number(first?.slot ?? 0) - Number(second?.slot ?? 0)
    ));
}

export function puzzleBotsForTeam(bots, teamNumber) {
    return sortPuzzleBots(bots).filter((bot) => Number(bot?.teamNumber) === Number(teamNumber));
}

/**
 * Converts old role-only puzzle bot payloads and current roster payloads into
 * the same bounded two-team shape. Unknown or excess entries are ignored so
 * the editor never creates a roster the server would reject.
 */
export function normalizePuzzleRoster(
    source,
    playerTeamSize = MIN_PUZZLE_TEAM_SIZE,
    opponentTeamSize = MIN_PUZZLE_TEAM_SIZE,
    createDefaultBot = () => ({}),
) {
    const sizes = [
        normalizePuzzleTeamSize(playerTeamSize),
        normalizePuzzleTeamSize(opponentTeamSize),
    ];
    const entries = Array.isArray(source) ? source : [];
    const used = new Set();
    const result = [];

    [PUZZLE_PLAYER_TEAM, PUZZLE_OPPONENT_TEAM].forEach((teamNumber, teamIndex) => {
        for (let slot = 1; slot <= sizes[teamIndex]; slot += 1) {
            const role = puzzleBotRole(teamNumber);
            const exactIndex = entries.findIndex((candidate, index) => {
                if (used.has(index)) return false;
                const candidateTeam = Number(candidate?.teamNumber);
                const candidateSlot = Number(candidate?.slot);
                return candidateTeam === teamNumber && candidateSlot === slot;
            });
            const roleIndex = exactIndex >= 0 ? exactIndex : entries.findIndex((candidate, index) => {
                if (used.has(index)) return false;
                const candidateTeam = Number(candidate?.teamNumber);
                const candidateRole = String(candidate?.role ?? "").trim().toUpperCase();
                return (candidateRole === role || !candidateRole)
                    && (!Number.isFinite(candidateTeam) || candidateTeam === teamNumber);
            });
            const sourceIndex = exactIndex >= 0 ? exactIndex : roleIndex;
            if (sourceIndex >= 0) used.add(sourceIndex);
            const fallback = createDefaultBot(teamNumber, slot, sizes[teamIndex]) ?? {};
            result.push({
                ...fallback,
                ...(sourceIndex >= 0 ? entries[sourceIndex] : {}),
                role,
                teamNumber,
                slot,
            });
        }
    });

    return result;
}
