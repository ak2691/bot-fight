import test from "node:test";
import assert from "node:assert/strict";
import { buildAutoPlayStartShapes } from "./arenaShapes.js";

test("resuming autoplay preserves arena entities", () => {
    const shapes = [
        { id: "main", type: "circle", x: 100, y: 100 },
        { id: "mine-1", type: "proximityMine", x: 250, y: 250, armed: true },
        { id: "grenade-1", type: "grenade", x: 300, y: 300, stoppedMs: 400 },
    ];

    const resumed = buildAutoPlayStartShapes(shapes, null, false);

    assert.deepEqual(resumed, shapes);
    assert.notEqual(resumed, shapes);
    assert.notEqual(resumed[1], shapes[1]);
});
