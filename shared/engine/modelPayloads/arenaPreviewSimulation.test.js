import assert from "node:assert/strict";
import test from "node:test";
import { AUTO_STEP_MS } from "./arenaConstants.js";
import { buildInitialArenaShapes, toSimulationBotShape } from "./arenaShapes.js";
import { advanceArenaPreviewTick } from "./arenaPreviewSimulation.js";

test("preview tick decides from the previous state and returns a new state snapshot", () => {
    const initialShapes = buildInitialArenaShapes(null);
    const initialMain = toSimulationBotShape(initialShapes.find((shape) => shape.id === "main"));
    const walkEast = {
        roots: [{ priority: 1, branches: [{
            id: "walk-east",
            branchType: "if",
            priority: 1,
            conditions: [{ type: "always" }],
            actions: [{ action: "move_walk", movementMode: "absolute", movementDirection: "east" }],
            children: [],
        }] }],
    };

    const nextShapes = advanceArenaPreviewTick(initialShapes, {
        selectedLoadout: "melee",
        opponentLoadout: "melee",
        testingConfiguration: walkEast,
        opponentTestingConfiguration: null,
    });
    const nextMain = toSimulationBotShape(nextShapes.find((shape) => shape.id === "main"));

    assert.ok(nextMain.x > initialMain.x);
    assert.equal(nextMain.matchElapsedMs, Number(initialMain.matchElapsedMs ?? 0) + AUTO_STEP_MS);
    assert.deepEqual(initialShapes.map((shape) => shape.id), ["main", "opponent-model"]);
    assert.deepEqual(nextShapes.map((shape) => shape.id), ["main", "opponent-model"]);
    assert.equal(toSimulationBotShape(initialShapes.find((shape) => shape.id === "main")).x, initialMain.x);
});
