import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { PUZZLES_PUBLIC_ENABLED, puzzlesVisibleTo } from "./featureFlags.js";

const read = (relative) => readFileSync(new URL(relative, import.meta.url), "utf8");

test("puzzles are hidden from everyone but admins unless the public flag is on", () => {
    assert.equal(PUZZLES_PUBLIC_ENABLED, false, "off by default");
    assert.equal(puzzlesVisibleTo({ admin: false }), false);
    assert.equal(puzzlesVisibleTo(null), false);
    assert.equal(puzzlesVisibleTo({ admin: true }), true);
    assert.equal(puzzlesVisibleTo({ admin: false }, true), true, "turning the flag on restores them");
});

test("the nav, tiles and public routes follow the puzzles flag, while the admin builder routes do not", () => {
    const navbar = read("../components/AppNavbar.jsx");
    assert.match(navbar, /const puzzlesVisible = puzzlesVisibleTo\(user\)/);
    assert.match(navbar, /allNavLinks\.filter\(\(link\) => link\.id !== "puzzles" \|\| puzzlesVisible\)/);
    assert.match(navbar, /\.filter\(\(tab\) => tab\.id !== "puzzles" \|\| puzzlesVisible\)/, "the phone tab bar too");
    assert.match(navbar, /navigate\("\/admin\/puzzles\/new"\)/, "the admin builder button stays");

    const app = read("../App.jsx");
    assert.match(app, /<PuzzlesRoute>\s*<PuzzleListPage \/>\s*<\/PuzzlesRoute>/);
    assert.match(app, /<PuzzlesRoute>\s*<PuzzlePlayPage \/>\s*<\/PuzzlesRoute>/);
    assert.doesNotMatch(app, /<PuzzlesRoute>\s*<PuzzleBuilderPage/);
    assert.match(read("../auth/PuzzlesRoute.jsx"), /<Navigate to="\/home" replace \/>/);
    assert.match(read("../pages/home/HomePage.jsx"), /puzzlesVisibleTo\(user\) && <button/);
    assert.match(read("../tutorial/TutorialPage.jsx"), /puzzlesVisibleTo\(user\) && <Link to="\/puzzles"/);
});
