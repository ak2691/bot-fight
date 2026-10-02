import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { fileURLToPath } from "node:url";
import {
    bannerTitle,
    dateGroupLabel,
    endedByLabel,
    eloChangeTone,
    filterMatches,
    formatEloDelta,
    formatScore,
    groupMatchesByDate,
    matchDetailLine,
    opponentLabel,
    recordProportions,
    roundsLabel,
    teamColorLabel,
} from "./profileMatchFormat.js";

const NOW = new Date("2026-09-29T12:00:00");
const PROFILE_PAGE = readFileSync(fileURLToPath(new URL("./ProfilePage.jsx", import.meta.url)), "utf8");
const PROFILE_CSS = readFileSync(fileURLToPath(new URL("./profile.css", import.meta.url)), "utf8");

function match(overrides = {}) {
    return {
        matchId: "m1",
        mode: "ONES",
        result: "WIN",
        completionReason: "SIMULATION",
        completedAt: "2026-09-26T10:00:00",
        participantTeams: [["me"], ["nopy1001"]],
        participantTeamNumbers: [1, 2],
        score: "2-1",
        ratingBefore: 1058,
        ratingAfter: 1074,
        eloChange: 16,
        ...overrides,
    };
}

test("opponents are named without repeating the viewed player", () => {
    assert.equal(opponentLabel(match()), "nopy1001");
    assert.equal(opponentLabel(match({ participantTeams: [["me", "mate"], ["a", "b"]] })), "a, b");
    assert.equal(opponentLabel(match({ participantTeams: [["me"]] })), "Unknown");
});

test("detail lines show score and ELO, or the reason a match ended early", () => {
    assert.equal(matchDetailLine(match()), "2–1 · +16 ELO");
    assert.equal(matchDetailLine(match({ result: "LOSS", score: "0-2", eloChange: -14, ratingAfter: 1044 })), "0–2 · −14 ELO");
    assert.equal(matchDetailLine(match({ result: "LOSS", completionReason: "RESIGNATION", score: "0-0" })), "Forfeit · 0–0");
    assert.equal(matchDetailLine(match({ result: "DRAW", score: "1-1" })), "Timeout · 1–1");
    assert.equal(matchDetailLine(match({ ratingBefore: null, ratingAfter: null, eloChange: null })), "2–1");
});

test("the details banner and ELO tile follow the result", () => {
    assert.equal(bannerTitle(match()), "VICTORY");
    assert.equal(bannerTitle(match({ result: "LOSS" })), "DEFEAT");
    assert.equal(bannerTitle(match({ result: "DRAW" })), "DRAW");
    assert.equal(endedByLabel(match({ completionReason: "DISCONNECTION" })), "forfeit");
    assert.equal(endedByLabel(match({ result: "DRAW" })), "timeout");
    assert.equal(endedByLabel(match()), "knockout");
    assert.equal(formatEloDelta(match()), "+16");
    assert.equal(eloChangeTone(match()), "up");
    assert.equal(eloChangeTone(match({ eloChange: -3, ratingAfter: 1055 })), "down");
    assert.equal(formatEloDelta(match({ ratingBefore: null })), null);
    assert.equal(roundsLabel(match({ score: "0-0" })), "0 of 3 played");
    assert.equal(roundsLabel(match({ score: "2-1" })), "3 of 3 played");
    assert.equal(roundsLabel(match({ score: "Score unavailable" })), "Unavailable");
    assert.equal(formatScore("Score unavailable"), null);
    assert.equal(teamColorLabel(1), "BLUE");
    assert.equal(teamColorLabel(2), "RED");
});

test("matches group under date headers newest first", () => {
    assert.equal(dateGroupLabel("2026-09-26T10:00:00", NOW), "This week");
    assert.equal(dateGroupLabel("2026-09-15T10:00:00", NOW), "Earlier in September");
    assert.equal(dateGroupLabel("2026-08-20T10:00:00", NOW), "August");
    assert.equal(dateGroupLabel("2025-12-20T10:00:00", NOW), "December 2025");
    assert.equal(dateGroupLabel(null, NOW), "Earlier");
    const groups = groupMatchesByDate([
        match({ matchId: "a", completedAt: "2026-09-27T10:00:00" }),
        match({ matchId: "b", completedAt: "2026-09-26T10:00:00" }),
        match({ matchId: "c", completedAt: "2026-09-08T10:00:00" }),
        match({ matchId: "d", completedAt: "2026-08-08T10:00:00" }),
    ], NOW);
    assert.deepEqual(groups.map((group) => [group.label, group.matches.map((entry) => entry.matchId)]), [
        ["This week", ["a", "b"]],
        ["Earlier in September", ["c"]],
        ["August", ["d"]],
    ]);
});

test("mode and result filters narrow the loaded matches", () => {
    const loaded = [
        match({ matchId: "a" }),
        match({ matchId: "b", mode: "TWOS", result: "LOSS" }),
        match({ matchId: "c", mode: "CUSTOM", result: "DRAW" }),
        match({ matchId: "d", mode: "ONES", result: "LOSS" }),
    ];
    assert.equal(filterMatches(loaded).length, 4);
    assert.deepEqual(filterMatches(loaded, { mode: "ONES" }).map((entry) => entry.matchId), ["a", "d"]);
    assert.deepEqual(filterMatches(loaded, { result: "LOSS" }).map((entry) => entry.matchId), ["b", "d"]);
    assert.deepEqual(filterMatches(loaded, { mode: "ONES", result: "LOSS" }).map((entry) => entry.matchId), ["d"]);
});

test("record proportions fill the ranked bar", () => {
    assert.deepEqual(recordProportions({ wins: 0, losses: 0, draws: 0 }), { wins: 0, losses: 0, draws: 0, total: 0 });
    const bar = recordProportions({ wins: 23, losses: 11, draws: 1 });
    assert.equal(bar.total, 35);
    assert.ok(Math.abs(bar.wins + bar.losses + bar.draws - 100) < 1e-9);
});

