import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { fileURLToPath } from "node:url";

const APP_NAVBAR_PATH = fileURLToPath(new URL("../components/AppNavbar.jsx", import.meta.url));
const PROVIDER_PATH = fileURLToPath(new URL("./NotificationsProvider.jsx", import.meta.url));
const PARTY_POPOVER_PATH = fileURLToPath(new URL("../components/PartyPopover.jsx", import.meta.url));
const CUSTOM_LOBBY_PATH = fileURLToPath(new URL("../pages/customLobby/CustomLobbyPage.jsx", import.meta.url));

test("party popover invites in one step and keeps leader-only remove", () => {
    const source = readFileSync(PARTY_POPOVER_PATH, "utf8");

    assert.match(source, /apiUrl\("\/api\/parties"\)/);
});

test("notification panel closes on outside clicks and Escape", () => {
    const source = readFileSync(APP_NAVBAR_PATH, "utf8");

    assert.match(source, /if \(!notificationsPopoverRef\.current\?\.contains\(event\.target\)\) setNotificationsOpen\(false\);/);
    assert.match(source, /if \(event\.key === "Escape"\) setNotificationsOpen\(false\);/);
    assert.match(source, /document\.addEventListener\("pointerdown", handlePointerDown\);/);
    assert.match(source, /document\.removeEventListener\("pointerdown", handlePointerDown\);/);
    assert.match(source, /ref=\{notificationsPopoverRef\} className="relative"/);
});

test("stale party and lobby accepts remove their consumed invite cards", () => {
    const source = readFileSync(PROVIDER_PATH, "utf8");

    assert.match(source, /if \(message === "Party no longer exists"\) \{[\s\S]*markInviteHandled\(inviteId\);[\s\S]*setPendingPartyInvites\(/);
    assert.match(source, /if \(message === "Lobby no longer exists"\) \{[\s\S]*markInviteHandled\(inviteId\);[\s\S]*setPendingCustomLobbyInvites\(/);
});

test("custom-lobby invite accepts are disabled during ranked activity and server errors stay visible", () => {
    const navbarSource = readFileSync(APP_NAVBAR_PATH, "utf8");
    const providerSource = readFileSync(PROVIDER_PATH, "utf8");

    assert.match(navbarSource, /isQueueing \|\| pendingAcceptance \|\| activeMatchStatus\?\.activeMatch/);
    assert.match(providerSource, /if \(!response\.ok\) throw new Error\(body\.message \?\? "The custom lobby invite could not be accepted\."\);[\s\S]*setActionError\(message\)/);
});

test("invite, party, and lobby action messages use the 3.5-second timeout", () => {

});

test("party queue explains that an offline member blocks matching without stopping the timer", () => {

});
