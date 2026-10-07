import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { clampClockSetting, formatClock, formatClockSetting } from "./customLobbyClock.js";

const source = readFileSync(new URL("./CustomLobbyPage.jsx", import.meta.url), "utf8");
const appSource = readFileSync(new URL("../../App.jsx", import.meta.url), "utf8");

test("an empty or kicked custom-lobby view keeps only the centered create action", () => {
    assert.match(source, /if \(!customLobbyEvent\.lobby\) \{[\s\S]*setNotice\(null\);[\s\S]*setInviteStatus\(null\);/);
});

test("custom lobby is protected from active matches and has its own route", () => {
    assert.match(appSource, /path="\/custom-lobby"/);
    assert.match(appSource, /<CustomLobbyPage \/>/);
    assert.match(appSource, /<ActiveMatchProtectedRoute>/);
});

test("custom lobby creation and invites are disabled while ranked matchmaking is active", () => {
    assert.match(source, /isQueueing,[\s\S]*pendingAcceptance,[\s\S]*activeMatchStatus/);
    assert.match(source, /rankedParticipationActive = Boolean\([\s\S]*?isQueueing \|\| pendingAcceptance \|\| activeMatchStatus\?\.activeMatch/);
    assert.match(source, /disabled=\{!inviteUsername\.trim\(\) \|\| action !== null \|\| rankedParticipationActive\}/);
    assert.match(source, /if \(rankedParticipationActive\) \{[\s\S]*RANKED_PARTICIPATION_BLOCK_MESSAGE/);
});

test("custom lobby settings are owner-only and save the base clock and increment", () => {
    assert.match(source, /if \(!lobby\?\.lobbyId \|\| !isOwner \|\| action !== null\) return;/);
    assert.match(source, /body: \{ baseClockSeconds: base, incrementSeconds: increment \}/);
    assert.match(source, /formatClockSetting\(lobby\.baseClockSeconds, lobby\.incrementSeconds\)/);
    assert.match(source, /sendCustomLobbyChat\(lobby\.lobbyId, message\)/);
    assert.doesNotMatch(source, /uarantee|roundDurationSeconds/);
});

test("clock settings show as m:ss and clamp to the server's ranges", () => {
    assert.equal(formatClock(300), "5:00");
    assert.equal(formatClock(30), "0:30");
    assert.equal(formatClockSetting(300, 30), "5:00 + 0:30");
    assert.equal(clampClockSetting("5", 30, 600, 300), 30);
    assert.equal(clampClockSetting("9999", 30, 600, 300), 600);
    assert.equal(clampClockSetting("abc", 0, 60, 30), 30);
    assert.equal(clampClockSetting("-4", 0, 60, 30), 0);
});
