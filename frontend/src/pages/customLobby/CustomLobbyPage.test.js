import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

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

test("custom lobby settings are owner-only and guarantee picks persist through shared queue state", () => {
    const picker = readFileSync(new URL("../queue/QueueAbilityGuaranteePicker.jsx", import.meta.url), "utf8");

    assert.match(source, /if \(!lobby\?\.lobbyId \|\| !isOwner \|\| action !== null\) return;/);
    assert.match(source, /body: \{ roundDurationSeconds: seconds \}/);
    assert.match(source, /waitForQueueGuarantees/);
    assert.match(source, /onChange=\{updateQueueGuarantee\}/);
    assert.match(source, /sendCustomLobbyChat\(lobby\.lobbyId, message\)/);
    assert.match(picker, /onChange\?\.\(activeRound, ability\.id\)/);
    assert.match(picker, /onChange\?\.\(activeRound, null\)/);
});
