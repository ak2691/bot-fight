import test from "node:test";
import assert from "node:assert/strict";
import { createSnapshot, interpolatePosition, sampleSnapshot } from "./snapshotInterpolation.js";

test("interpolatePosition clamps time and interpolates coordinates", () => {
    assert.deepEqual(interpolatePosition({ x: 0, y: 20 }, { x: 100, y: 60 }, 0.5), { x: 50, y: 40 });
    assert.deepEqual(interpolatePosition({ x: 0, y: 0 }, { x: 10, y: 10 }, 2), { x: 10, y: 10 });
});

test("sampleSnapshot produces a normalized render snapshot", () => {
    const snapshot = createSnapshot(
        { player: { x: 100, y: 100 } },
        { player: { x: 300, y: 500 } },
        1_000,
        400,
    );
    assert.deepEqual(sampleSnapshot(snapshot, 1_100), {
        alpha: 0.25,
        bots: { player: { x: 150, y: 200 } },
    });
});
