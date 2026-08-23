import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import test from "node:test";

const SOURCE_PATH = fileURLToPath(new URL("./useMatchmakingSocket.js", import.meta.url));

test("matchmaking socket hook owns active-client handler registration and cleanup", () => {
    const source = readFileSync(SOURCE_PATH, "utf8");

    assert.match(source, /getActiveMatchmakingClient\(/);
    assert.doesNotMatch(source, /disconnectActiveMatchmakingClient/);
    assert.doesNotMatch(source, /closeSocketAfterChatRef/);
    assert.match(source, /callbackRef\.current/);
    assert.match(source, /autoReconnect: true/);
    assert.match(source, /autoJoinOnConnect: false/);
    assert.match(source, /client\.resumeReconnect\?\.\(\)/);
    assert.match(source, /client\.subscribeMatch\?\.\(\)/);
    assert.match(source, /client\.unsubscribeMatch\?\.\(\)/);
    assert.match(source, /clearPendingEvents/);
    assert.match(source, /client\.setHandlers\(\)/);
    assert.match(source, /void client\.connect\(\)/);
    assert.doesNotMatch(source, /createMatchmakingClient/);
});
