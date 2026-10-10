import { BASE_BOT_HP } from "../../../../shared/engine/modelPayloads/arenaConstants.js";

function teamOf(participant) {
    const team = Number(participant?.teamNumber);
    return Number.isFinite(team) && team > 0 ? team : Number(participant?.slot) === 1 ? 1 : 2;
}

/**
 * Each team's total HP for the scoreboard: the frozen end of the last segment when the server sent one,
 * otherwise full HP for every bot (round 1). Matches the server's round 6 HP decision, which compares
 * the same team sums.
 */
export function teamHpTotals(players, segmentEndState) {
    const totals = { 1: 0, 2: 0 };
    const states = Array.isArray(segmentEndState) ? segmentEndState : [];
    for (const player of players ?? []) {
        const team = teamOf(player) === 2 ? 2 : 1;
        const state = states.find((bot) => Number(bot?.slot) === Number(player?.slot));
        const hp = state != null && Number.isFinite(Number(state.hp)) ? Number(state.hp) : BASE_BOT_HP;
        totals[team] += Math.max(0, hp);
    }
    return { blue: totals[1], red: totals[2] };
}

export function roundLabel(roundNumber, maxRounds) {
    const max = Number(maxRounds) > 0 ? Number(maxRounds) : 6;
    return `Round ${Math.min(Math.max(1, Number(roundNumber) || 1), max)} / ${max}`;
}

/** Sum of HP per team over bots that carry `hp` and a team (a replay frame or the frozen end state). */
export function teamHpFromBots(bots) {
    const totals = { blue: 0, red: 0 };
    for (const bot of bots ?? []) {
        const hp = Number(bot?.hp);
        if (!Number.isFinite(hp)) continue;
        totals[teamOf(bot) === 2 ? "red" : "blue"] += Math.max(0, hp);
    }
    return totals;
}

/**
 * Both teams' HP when the match ended: the server's `hpDecision` when round 6 was decided on HP,
 * otherwise the frozen end of the last segment. Null when the server sent neither.
 */
export function finalTeamHp(timedRounds) {
    const decision = timedRounds?.hpDecision;
    if (decision?.teamHp) {
        return {
            blue: Math.max(0, Number(decision.teamHp[1]) || 0),
            red: Math.max(0, Number(decision.teamHp[2]) || 0),
            decided: true,
            winningTeam: decision.winningTeam ?? null,
        };
    }
    const states = timedRounds?.segmentEndState;
    if (Array.isArray(states) && states.length > 0) return { ...teamHpFromBots(states), decided: false, winningTeam: null };
    return null;
}

/** How a finished match was settled, for the result card subtitle. */
export function matchEndReason({ result, hpDecision }) {
    if (result === "RESIGNATION_WIN") return "forfeit";
    if (result === "DISCONNECTION_WIN") return "disconnect";
    if (result === "DRAW") return hpDecision ? "equal HP" : "both bots knocked out";
    return hpDecision ? "HP decision" : "knockout";
}
