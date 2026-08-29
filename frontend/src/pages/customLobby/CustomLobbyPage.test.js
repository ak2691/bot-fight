import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(new URL("./CustomLobbyPage.jsx", import.meta.url), "utf8");
const appSource = readFileSync(new URL("../../App.jsx", import.meta.url), "utf8");
const providerSource = readFileSync(new URL("../../matchmaking/MatchmakingProvider.jsx", import.meta.url), "utf8");

test("custom lobby page exposes invite-only teams and owner start controls", () => {
    assert.match(source, /\/api\/custom-lobbies/);
    assert.match(providerSource, /subscribeCustomLobby/);
    assert.match(source, /customLobbyEvent/);
    assert.match(source, /roundDurationSeconds/);
    assert.match(source, /ROUND TIME \/ SEC/);
    assert.match(source, /roundDurationSeconds: seconds/);
    assert.match(source, /CustomLobbySettingsModal/);
    assert.match(source, /settingsOpen/);
    assert.match(source, /custom-lobby-round-seconds/);
    assert.match(source, /min="30" max="600" step="1"/);
    assert.match(source, /30–600 SECONDS/);
    assert.match(source, /\/settings/);
    assert.match(source, /CUSTOM_LOBBY_STATE/);
    assert.match(providerSource, /CUSTOM_LOBBY_MATCH_STARTED/);
    assert.match(source, /redirectToMatch/);
    assert.match(providerSource, /event\.matchId/);
    assert.match(source, /NOT READY/);
    assert.match(source, /BLUE TEAM/);
    assert.match(source, /RED TEAM/);
    assert.match(source, /JOIN TEAM/);
    assert.match(source, /LEAVE TEAM/);
    assert.match(source, /suppressRateLimitError/);
    assert.match(source, /START CUSTOM MATCH/);
    assert.match(source, /CustomLobbyChat/);
    assert.match(source, /custom-lobby-chat--compact/);
    assert.match(source, /NotReadyRoster/);
    assert.match(source, /currentMemberIsHere \? "LEAVE TEAM" : "JOIN TEAM"/);
    assert.match(source, /grid-cols-1 gap-5 lg:grid-cols-3/);
    assert.match(source, /lg:col-span-2 flex min-h-0 flex-col/);
    assert.match(source, /grid min-h-0 gap-4 sm:grid-cols-2 lg:flex lg:flex-col/);
    assert.match(source, /flex min-h-8 flex-col items-start gap-3/);
    assert.match(source, /flex w-full min-w-0 flex-wrap items-center/);
    assert.doesNotMatch(source, /lg:items-stretch/);
    assert.match(source, /CUSTOM_LOBBY_CHAT_MESSAGE/);
    assert.match(source, /sendCustomLobbyChat/);
    assert.match(source, /Kick \$\{member\.username\}/);
    assert.match(source, /if \(result !== undefined\) navigate\("\/queue"\);/);
    assert.match(source, /bg-\[#171a1c\]/);
    assert.match(source, /border-dashed/);
    assert.match(source, /border-cyan-400\/70/);
    assert.doesNotMatch(source, /LIVE LOBBY|CONNECTING/);
    assert.doesNotMatch(source, /title="NOT READY"/);
    assert.doesNotMatch(source, /\{members\.length\} READY/);
    assert.doesNotMatch(source, /rounded-lg border border-slate-600\/80 bg-\[#2a3136\] p-3/);
    assert.doesNotMatch(source, /roundMinutes|custom-lobby-round-minutes/);
});

test("an empty or kicked custom-lobby view keeps only the centered create action", () => {
    assert.match(source, /loadState === "empty"/);
    assert.match(source, /mt-10 flex flex-1 items-center justify-center/);
    assert.match(source, /<button type="button" onClick=\{createLobby\}/);
    assert.doesNotMatch(source, /NO ACTIVE LOBBY|Build a private room|Create an invite-only lobby/);
    assert.match(source, /if \(!customLobbyEvent\.lobby\) \{[\s\S]*setNotice\(null\);[\s\S]*setInviteStatus\(null\);/);
});

test("custom lobby is protected from active matches and has its own route", () => {
    assert.match(appSource, /path="\/custom-lobby"/);
    assert.match(appSource, /<CustomLobbyPage \/>/);
    assert.match(appSource, /<ActiveMatchProtectedRoute>/);
});
