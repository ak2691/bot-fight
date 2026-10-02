import assert from "node:assert/strict";
import test from "node:test";
import { groupChatMessages, isSystemChatMessage, shortChatTime } from "./chatPanelFormat.js";

test("shortChatTime renders compact relative times", () => {
    const now = Date.parse("2026-01-01T12:00:00Z");
    assert.equal(shortChatTime("2026-01-01T11:59:50Z", now), "now");
    assert.equal(shortChatTime("2026-01-01T11:58:00Z", now), "2m");
    assert.equal(shortChatTime("2026-01-01T09:00:00Z", now), "3h");
    assert.equal(shortChatTime("2025-12-29T12:00:00Z", now), "3d");
    assert.equal(shortChatTime(null, now), null);
});

test("consecutive messages from one sender and channel share a group", () => {
    const grouped = groupChatMessages([
        { username: "a", channel: "ALL", message: "1" },
        { username: "a", channel: "ALL", message: "2" },
        { username: "a", channel: "TEAM", message: "3" },
        { username: "b", message: "4" },
        { system: true, message: "joined" },
        { username: "b", message: "5" },
    ]);
    assert.deepEqual(grouped.map((entry) => entry.startsGroup), [true, false, true, true, true, true]);
    assert.equal(isSystemChatMessage({ type: "system" }), true);
});
