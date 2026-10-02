import { MATCH_MODES } from "../../matchmaking/matchModes.js";

// Pure helpers for how the profile presents match history. The server decides the
// data: participantTeams[0] is always the viewed player's team and `score` is
// "<viewed team rounds>-<other team rounds>".

const FORFEIT_REASONS = new Set(["FORFEIT", "RESIGNATION", "DISCONNECTION", "MUTUAL_DISCONNECTION", "INITIAL_DISCONNECTION"]);
const ROUNDS_PER_MATCH = 3;
const DAY_MS = 24 * 60 * 60 * 1000;

export const MODE_FILTERS = Object.freeze([
    { id: "ALL", label: "All" },
    { id: MATCH_MODES.ONES, label: "1v1" },
    { id: MATCH_MODES.TWOS, label: "2v2" },
    { id: MATCH_MODES.CUSTOM, label: "Custom" },
]);

export const RESULT_FILTERS = Object.freeze([
    { id: "WIN", label: "Wins" },
    { id: "LOSS", label: "Losses" },
]);

export function isForfeit(match) {
    return FORFEIT_REASONS.has(String(match?.completionReason ?? ""));
}

export function matchTeams(match) {
    return Array.isArray(match?.participantTeams)
        ? match.participantTeams.map((team) => (Array.isArray(team) ? team : []))
        : [];
}

export function yourTeam(match) {
    return matchTeams(match)[0] ?? [];
}

export function opponentTeams(match) {
    return matchTeams(match).slice(1);
}

// "nopy1001" for 1v1, "nopy1001, nopy2" for a two-player team, teams joined with " / " beyond that.
export function opponentLabel(match) {
    const teams = opponentTeams(match).filter((team) => team.length > 0);
    return teams.length ? teams.map((team) => team.join(", ")).join(" / ") : "Unknown";
}

export function parseScore(score) {
    const parts = /^(\d+)\s*-\s*(\d+)$/.exec(String(score ?? "").trim());
    return parts ? [Number(parts[1]), Number(parts[2])] : null;
}

export function formatScore(score) {
    const parsed = parseScore(score);
    return parsed ? `${parsed[0]}–${parsed[1]}` : null;
}

export function roundsPlayed(match) {
    const parsed = parseScore(match?.score);
    return parsed ? parsed[0] + parsed[1] : null;
}

export function roundsLabel(match) {
    const played = roundsPlayed(match);
    return played == null ? "Unavailable" : `${played} of ${Math.max(ROUNDS_PER_MATCH, played)} played`;
}

export function eloChangeValue(match) {
    if (!Number.isFinite(match?.ratingBefore) || !Number.isFinite(match?.ratingAfter)) return null;
    return Number.isFinite(match.eloChange) ? match.eloChange : match.ratingAfter - match.ratingBefore;
}

export function formatEloDelta(match) {
    const change = eloChangeValue(match);
    if (change == null) return null;
    return `${change > 0 ? "+" : change < 0 ? "−" : ""}${Math.abs(change)}`;
}

export function eloChangeTone(match) {
    const change = eloChangeValue(match);
    if (change == null || change === 0) return "neutral";
    return change > 0 ? "up" : "down";
}

// Why a match ended, as shown in the details banner. A draw is a timeout.
export function endedByLabel(match) {
    if (isForfeit(match)) return "forfeit";
    if (match?.result === "DRAW") return "timeout";
    return "knockout";
}

// One muted line under the opponent: "2–1 · +16 ELO", "Forfeit · 0–0" or "Timeout · 1–1".
export function matchDetailLine(match) {
    const score = formatScore(match?.score);
    if (isForfeit(match) || match?.result === "DRAW") {
        const reason = isForfeit(match) ? "Forfeit" : "Timeout";
        return score ? `${reason} · ${score}` : reason;
    }
    const delta = formatEloDelta(match);
    return [score, delta ? `${delta} ELO` : null].filter(Boolean).join(" · ") || "Completed";
}

export function resultKey(match) {
    return match?.result === "WIN" ? "win" : match?.result === "LOSS" ? "loss" : "draw";
}

export function bannerTitle(match) {
    return match?.result === "WIN" ? "VICTORY" : match?.result === "LOSS" ? "DEFEAT" : "DRAW";
}

export function teamColorKey(teamNumber) {
    return Number(teamNumber) === 1 ? "blue" : Number(teamNumber) === 2 ? "red" : "neutral";
}

export function teamColorLabel(teamNumber, fallbackIndex = 0) {
    const key = teamColorKey(teamNumber);
    return key === "blue" ? "BLUE" : key === "red" ? "RED" : `TEAM ${fallbackIndex + 1}`;
}

export function formatShortDate(value, now = new Date()) {
    const date = new Date(value);
    if (!value || Number.isNaN(date.getTime())) return "—";
    return new Intl.DateTimeFormat(undefined, {
        month: "short",
        day: "numeric",
        year: date.getFullYear() === now.getFullYear() ? undefined : "numeric",
    }).format(date);
}

// "This week" (last 7 days), "Earlier in <Month>" for the rest of this month, then "<Month>" / "<Month> <Year>".
export function dateGroupLabel(value, now = new Date()) {
    const date = new Date(value);
    if (!value || Number.isNaN(date.getTime())) return "Earlier";
    if (now.getTime() - date.getTime() < 7 * DAY_MS && date.getTime() <= now.getTime() + DAY_MS) return "This week";
    const month = new Intl.DateTimeFormat(undefined, { month: "long" }).format(date);
    if (date.getFullYear() === now.getFullYear() && date.getMonth() === now.getMonth()) return `Earlier in ${month}`;
    return date.getFullYear() === now.getFullYear() ? month : `${month} ${date.getFullYear()}`;
}

// Matches arrive newest first, so consecutive rows with the same label share a group.
export function groupMatchesByDate(matches, now = new Date()) {
    const groups = [];
    matches.forEach((match) => {
        const label = dateGroupLabel(match.completedAt, now);
        const last = groups[groups.length - 1];
        if (last && last.label === label) last.matches.push(match);
        else groups.push({ label, matches: [match] });
    });
    return groups;
}

export function filterMatches(matches, { mode = "ALL", result = null } = {}) {
    return matches.filter((match) => (mode === "ALL" || String(match.mode ?? "").toUpperCase() === mode)
        && (!result || match.result === result));
}

// Win / loss / draw proportions for the ranked bar, as percentages that sum to 100 (or all 0 when empty).
export function recordProportions(stats) {
    const wins = Math.max(0, Number(stats?.wins) || 0);
    const losses = Math.max(0, Number(stats?.losses) || 0);
    const draws = Math.max(0, Number(stats?.draws) || 0);
    const total = wins + losses + draws;
    if (total === 0) return { wins: 0, losses: 0, draws: 0, total: 0 };
    return {
        wins: (wins / total) * 100,
        losses: (losses / total) * 100,
        draws: (draws / total) * 100,
        total,
    };
}
