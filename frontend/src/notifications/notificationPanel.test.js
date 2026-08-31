import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { fileURLToPath } from "node:url";

const APP_NAVBAR_PATH = fileURLToPath(new URL("../components/AppNavbar.jsx", import.meta.url));
const PROVIDER_PATH = fileURLToPath(new URL("./NotificationsProvider.jsx", import.meta.url));
const PARTY_POPOVER_PATH = fileURLToPath(new URL("../components/PartyPopover.jsx", import.meta.url));
const CUSTOM_LOBBY_PATH = fileURLToPath(new URL("../pages/customLobby/CustomLobbyPage.jsx", import.meta.url));

test("notification panel caps its height and scrolls through invite cards", () => {
    const source = readFileSync(APP_NAVBAR_PATH, "utf8");

    assert.match(source, /<section className="absolute right-0 top-12 z-30 max-h-\[min\(32rem,calc\(100vh-6rem\)\)\][\s\S]*overflow-y-auto overscroll-contain/);
});

test("notification panel uses the purple notification-count accent", () => {
    const source = readFileSync(APP_NAVBAR_PATH, "utf8");

    assert.match(source, /border-fuchsia-800\/80/);
    assert.match(source, /tracking-\[\.2em\] text-fuchsia-400">NOTIFICATIONS/);
});

test("stale party and lobby accepts remove their consumed invite cards", () => {
    const source = readFileSync(PROVIDER_PATH, "utf8");

    assert.match(source, /if \(message === "Party no longer exists"\) \{[\s\S]*markInviteHandled\(inviteId\);[\s\S]*setPendingPartyInvites\(/);
    assert.match(source, /if \(message === "Lobby no longer exists"\) \{[\s\S]*markInviteHandled\(inviteId\);[\s\S]*setPendingCustomLobbyInvites\(/);
});

test("invite, party, and lobby action messages use the 3.5-second timeout", () => {
    const providerSource = readFileSync(PROVIDER_PATH, "utf8");
    const partySource = readFileSync(PARTY_POPOVER_PATH, "utf8");
    const lobbySource = readFileSync(CUSTOM_LOBBY_PATH, "utf8");

    assert.match(providerSource, /const ACTION_STATUS_DURATION_MS = 3500;/);
    assert.match(providerSource, /setActionError\(\(current\) => current === actionError \? null : current\);\s*\}, ACTION_STATUS_DURATION_MS\);/);
    assert.match(partySource, /const STATUS_MESSAGE_DURATION_MS = 3500;/);
    assert.match(lobbySource, /const STATUS_MESSAGE_DURATION_MS = 3500;/);
    assert.match(lobbySource, /setNotice\(null\);\s*setError\(null\);[\s\S]*STATUS_MESSAGE_DURATION_MS/);
});

test("party queue explains that an offline member blocks matching without stopping the timer", () => {
    const partySource = readFileSync(PARTY_POPOVER_PATH, "utf8");

    assert.match(partySource, /isQueueing/);
    assert.match(partySource, /partyHasOfflineMember/);
    assert.match(partySource, /isQueueing && partyHasOfflineMember/);
    assert.match(partySource, /A party member is offline\. A match cannot be found until everyone is online\. The queue timer continues while they reconnect\./);
});
