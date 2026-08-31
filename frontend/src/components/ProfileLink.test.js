import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const profileLinkSource = readFileSync(new URL("./ProfileLink.jsx", import.meta.url), "utf8");
const partySource = readFileSync(new URL("./PartyPopover.jsx", import.meta.url), "utf8");
const lobbySource = readFileSync(new URL("../pages/customLobby/CustomLobbyPage.jsx", import.meta.url), "utf8");
const chatSource = readFileSync(new URL("../pages/customLobby/CustomLobbyChat.jsx", import.meta.url), "utf8");

test("profile links navigate directly without hover preview requests", () => {
    assert.match(profileLinkSource, /import \{ Link \} from "react-router-dom"/);
    assert.match(profileLinkSource, /to=\{profilePath\(label\)\}/);
    assert.match(profileLinkSource, /encodeURIComponent\(username\)/);
    assert.doesNotMatch(profileLinkSource, /createPortal|PROFILE_PREVIEW|queueStats|fetch\(/);
});

test("party and custom-lobby usernames use the shared profile link", () => {
    assert.match(partySource, /import ProfileLink from "\.\/ProfileLink\.jsx"/);
    assert.match(partySource, /<ProfileLink username=\{member\.username\}/);
    assert.match(lobbySource, /import ProfileLink from "\.\.\/\.\.\/components\/ProfileLink\.jsx"/);
    assert.match(lobbySource, /<ProfileLink username=\{lobby\.ownerUsername\}/);
    assert.match(lobbySource, /<ProfileLink username=\{member\.username\}/);
    assert.match(chatSource, /import ProfileLink from "\.\.\/\.\.\/components\/ProfileLink\.jsx"/);
    assert.match(chatSource, /<ProfileLink username=\{message\.username\}/);
});

test("opening the party navbar only reveals the already-subscribed presence state", () => {
    assert.doesNotMatch(partySource, /useLocation|pathname\.startsWith\("\/profile"\)|refreshParty/);
    assert.match(partySource, /if \(nextOpen\) \{\s*onOpen\?\.\(\);\s*\}/);
    assert.match(partySource, /member\?\.online !== false/);
});
