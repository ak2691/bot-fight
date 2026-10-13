import assert from "node:assert/strict";
import test from "node:test";
import { anchoredPosition, flatItems, initialHighlight, isSameMenuTarget, itemMatches, menuKeyAction, MENU_HEIGHT, menuWords, sectionsFor, stepHighlight } from "./menuModel.js";

const item = (name, description = "", keywords = []) => ({ name, description, keywords });

test("search matches each typed word as the start of a word in the name, description or keywords, ignoring case", () => {
    const distance = item("Distance", "how far the enemy is");
    assert.equal(itemMatches(distance, "dis"), true);
    assert.equal(itemMatches(distance, "DIST far"), true);
    assert.equal(itemMatches(distance, "ance"), false, "a middle of a word does not match");
    assert.equal(itemMatches(distance, "enemy is"), true, "description words count");
    assert.equal(itemMatches(distance, "dist zzz"), false, "every typed word must match");
    assert.equal(itemMatches(item("Enemy HP", "the enemy HP", ["health"]), "health"), true, "keywords count");
    assert.equal(itemMatches(distance, ""), true, "an empty query matches everything");
});

test("menuWords splits on anything that is not a letter or digit", () => {
    assert.deepEqual(menuWords("Enemy HP (opponent 1) 90"), ["enemy", "hp", "opponent", "1", "90"]);
});

test("sections keep their order, count their matches, and an empty group stays but is not shown", () => {
    const groups = [
        { id: "me", label: "Me", tone: "#3aa6c9", items: [item("HP"), item("Stamina")] },
        { id: "enemy", label: "Enemy", tone: "#ff7166", items: [item("Distance"), item("Enemy HP")] },
        { id: "variables", label: "Variables", tone: "#a78bfa", items: [] },
    ];
    const sections = sectionsFor(groups, "hp");
    assert.deepEqual(sections.map((section) => [section.id, section.count, section.shown]), [
        ["me", 1, true],
        ["enemy", 1, true],
        ["variables", 0, false],
    ]);
    assert.deepEqual(flatItems(sections).map((entry) => entry.name), ["HP", "Enemy HP"]);
});

test("the highlight starts on the first match, or on nothing when nothing matches", () => {
    assert.equal(initialHighlight(3), 0);
    assert.equal(initialHighlight(0), -1);
});

test("keys map to menu actions; other keys do nothing", () => {
    assert.equal(menuKeyAction("ArrowDown"), "next");
    assert.equal(menuKeyAction("ArrowUp"), "prev");
    assert.equal(menuKeyAction("Enter"), "choose");
    assert.equal(menuKeyAction("Escape"), "close");
    assert.equal(menuKeyAction("a"), null);
});

test("stepping the highlight clamps at both ends and starts from the top when nothing is highlighted", () => {
    assert.equal(stepHighlight(0, 3, "next"), 1);
    assert.equal(stepHighlight(2, 3, "next"), 2);
    assert.equal(stepHighlight(0, 3, "prev"), 0);
    assert.equal(stepHighlight(-1, 3, "next"), 0);
    assert.equal(stepHighlight(1, 3, "choose"), 1, "choose leaves the highlight alone");
    assert.equal(stepHighlight(0, 0, "next"), -1);
});

test("a desktop menu sits under its button, shifted left to stay on screen, and above it when there is no room below", () => {
    const viewport = { width: 1000, height: 600 };
    assert.deepEqual(anchoredPosition({ left: 100, top: 40, bottom: 60 }, { width: 430, viewport }), { left: 100, top: 66, width: 430, height: MENU_HEIGHT });
    assert.equal(anchoredPosition({ left: 900, top: 40, bottom: 60 }, { width: 430, viewport }).left, 562, "shifted left to fit");
    const low = anchoredPosition({ left: 100, top: 500, bottom: 520 }, { width: 430, viewport });
    assert.equal(low.top, 500 - 6 - MENU_HEIGHT, "above the button when it would run off the bottom");
    assert.equal(anchoredPosition({ left: 100, top: 40, bottom: 60 }, { width: 430, viewport: { width: 300, height: 600 } }).width, 284, "never wider than the viewport");
});

test("a re-click on the same button and mode closes the menu; another mode on the same button switches to it", () => {
    const anchor = {};
    const follow = { type: "card", mode: "follow", cardId: "slash", anchor, scope: "main" };
    const attach = { type: "card", mode: "attach", cardId: "slash", anchor, scope: "main" };
    assert.equal(isSameMenuTarget(follow, { ...follow }), true, "the same opening closes it");
    assert.equal(isSameMenuTarget(follow, attach), false, "Add movement while casting replaces Add follow-up on the same row");
    assert.equal(isSameMenuTarget(follow, { ...follow, anchor: {} }), false, "another button is another menu");
    assert.equal(isSameMenuTarget(null, follow), false);
    const condition = { type: "condition", kind: "card", id: "slash", index: 0, scope: "main", anchor };
    assert.equal(isSameMenuTarget(condition, { ...condition, index: 1 }), false, "a different condition slot is another menu");
    assert.equal(isSameMenuTarget(condition, { ...condition }), true);
});
