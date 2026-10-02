import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const profileSource = readFileSync(new URL("../pages/profile/ProfilePage.jsx", import.meta.url), "utf8");

test("profile match history exposes accessible match details", () => {
    assert.match(profileSource, /role="button"\s+tabIndex=\{0\}\s+aria-label=\{`Open \$\{modeLabel\} match details`\}/);
    assert.match(profileSource, /onOpenDetails=\{\(\) => onOpenMatchDetails\(match\)\}/);
});
test("guest match-history messaging applies only to the guest's own profile", () => {
    assert.match(profileSource, /const isGuestProfile = isGuest && isOwner;/);
    assert.match(profileSource, /isGuestProfile=\{isGuestProfile\}/);
    assert.match(profileSource, /if \(isGuestProfile\)/);
    assert.match(profileSource, /const puzzleCount = isGuestProfile \? "—" : \(profile\.puzzlesSolved \?\? 0\);/);
});
