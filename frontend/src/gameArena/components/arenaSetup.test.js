import assert from "node:assert/strict";
import test from "node:test";
import { arenaBotDisplayName, clampStartPoint, mapPointToArena } from "./arenaSetupHelpers.js";
import {
    PUBLIC_BOT_CENTER_MAX_X,
    PUBLIC_BOT_CENTER_MAX_Y,
    PUBLIC_BOT_CENTER_MIN_X,
    PUBLIC_BOT_CENTER_MIN_Y,
} from "../modelPayloads/arenaConstants.js";


test("dragging on the map maps to whole public arena units inside the legal spawn bounds", () => {
    const rect = { left: 100, top: 50, width: 240, height: 240 };
    // Centre of the square is the arena origin; Y grows upward.
    assert.deepEqual(mapPointToArena(220, 170, rect), { x: 0, y: 0 });
    assert.deepEqual(mapPointToArena(100 + 240 * 0.75, 50 + 240 * 0.25, rect), { x: 300, y: 300 });
    // Far outside the map clamps to the bounds validation uses.
    assert.deepEqual(mapPointToArena(-500, -500, rect), { x: PUBLIC_BOT_CENTER_MIN_X, y: PUBLIC_BOT_CENTER_MAX_Y });
    assert.deepEqual(mapPointToArena(5000, 5000, rect), { x: PUBLIC_BOT_CENTER_MAX_X, y: PUBLIC_BOT_CENTER_MIN_Y });
    assert.deepEqual(clampStartPoint(12.6, -7.4), { x: 13, y: -7 });
});

test("bots are named by team and slot", () => {
    assert.equal(arenaBotDisplayName({ teamNumber: 1, slot: 1 }), "My Bot");
    assert.equal(arenaBotDisplayName({ teamNumber: 1, slot: 2 }), "Teammate 1");
    assert.equal(arenaBotDisplayName({ teamNumber: 2, slot: 2 }), "Opponent 2");
});

