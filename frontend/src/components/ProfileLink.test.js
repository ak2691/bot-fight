import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const profileLinkSource = readFileSync(new URL("./ProfileLink.jsx", import.meta.url), "utf8");
const partySource = readFileSync(new URL("./PartyPopover.jsx", import.meta.url), "utf8");

test("profile links navigate directly without hover preview requests", () => {
    assert.match(profileLinkSource, /encodeURIComponent\(username\)/);
    assert.doesNotMatch(profileLinkSource, /createPortal|PROFILE_PREVIEW|queueStats|fetch\(/);
});

test("opening the party navbar only reveals the already-subscribed presence state", () => {
    assert.doesNotMatch(partySource, /useLocation|pathname\.startsWith\("\/profile"\)|refreshParty/);
    assert.match(partySource, /if \(nextOpen\) \{\s*onOpen\?\.\(\);\s*\}/);
});
