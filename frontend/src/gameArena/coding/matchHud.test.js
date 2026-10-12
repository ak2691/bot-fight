import assert from "node:assert/strict";
import test from "node:test";
import { finalTeamHp, matchEndReason, roundLabel, teamHpFromBots, teamHpTotals } from "./matchHud.js";

test("round label reads Round k / 6", () => {
    assert.equal(roundLabel(3, 6), "Round 3 / 6");
    assert.equal(roundLabel(undefined, undefined), "Round 1 / 6");
    assert.equal(roundLabel(9, 6), "Round 6 / 6");
});

test("team HP starts full and follows the frozen end of the last segment", () => {
    const players = [{ slot: 1, teamNumber: 1 }, { slot: 2, teamNumber: 2 }, { slot: 3, teamNumber: 2 }];
    assert.deepEqual(teamHpTotals(players, null), { blue: 225, red: 450 });
    assert.deepEqual(teamHpTotals(players, [{ slot: 1, hp: 120 }, { slot: 2, hp: 0 }, { slot: 3, hp: 75 }]), { blue: 120, red: 75 });
});

test("final HP prefers the server's HP decision and otherwise sums the last frame", () => {
    assert.deepEqual(finalTeamHp({ hpDecision: { teamHp: { 1: 90, 2: 40 }, winningTeam: 1 } }), { blue: 90, red: 40, decided: true, winningTeam: 1 });
    assert.deepEqual(finalTeamHp({ segmentEndState: [{ hp: 10, teamNumber: 1 }, { hp: 0, teamNumber: 2 }] }), { blue: 10, red: 0, decided: false, winningTeam: null });
    assert.equal(finalTeamHp({}), null);
    assert.deepEqual(teamHpFromBots([{ hp: 5, teamNumber: 2 }]), { blue: 0, red: 5 });
});

test("a match ends by knockout, HP decision, or a draw", () => {
    assert.equal(matchEndReason({ result: "BOT_WIN", hpDecision: null }), "knockout");
    assert.equal(matchEndReason({ result: "BOT_WIN", hpDecision: { teamHp: {} } }), "HP decision");
    assert.equal(matchEndReason({ result: "DRAW", hpDecision: { teamHp: {} } }), "equal HP");
    assert.equal(matchEndReason({ result: "DRAW", hpDecision: null }), "both bots knocked out");
    assert.equal(matchEndReason({ result: "RESIGNATION_WIN" }), "forfeit");
});
