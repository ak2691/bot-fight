import assert from "node:assert/strict";
import test from "node:test";
import { AUTO_STEP_MS } from "../../../../shared/engine/modelPayloads/arenaConstants.js";
import { buildInitialArenaShapes } from "./arenaShapes.js";
import { advanceShapes as advanceArenaPreviewTickNormalized } from "../testing/fightTick.js";
import { normalizeAbilityStrategyConfiguration as normalizeBrainForTick } from "../../../../shared/engine/botlogic/code/BotCode.js";

// The tick takes normalized brains; tests pass raw ones, so normalize here like the edge does.
const normalizeOrNull = (configuration) => (configuration ? normalizeBrainForTick(configuration) : configuration);
const advanceArenaPreviewTick = (shapes, options) => advanceArenaPreviewTickNormalized(shapes, {
    ...options,
    testingConfiguration: normalizeOrNull(options.testingConfiguration),
    opponentTestingConfiguration: normalizeOrNull(options.opponentTestingConfiguration),
});

test("preview tick decides from the previous state and returns a new state snapshot", () => {
    const initialShapes = buildInitialArenaShapes(null);
    const initialMain = initialShapes.find((shape) => shape.id === "main");
    const walkEast = {
        roots: [{ priority: 1, branches: [{
            id: "walk-east",
            branchType: "if",
            priority: 1,
            conditions: [{ type: "always" }],
            actions: [{ action: "move_walk", movementMode: "absolute", movementDirection: 90 }],
            children: [],
        }] }],
    };

    const nextShapes = advanceArenaPreviewTick(initialShapes, {
        selectedLoadout: "melee",
        opponentLoadout: "melee",
        testingConfiguration: walkEast,
        opponentTestingConfiguration: null,
    });
    const nextMain = nextShapes.find((shape) => shape.id === "main");

    assert.ok(nextMain.x > initialMain.x);
    assert.equal(nextMain.matchElapsedMs, Number(initialMain.matchElapsedMs ?? 0) + AUTO_STEP_MS);
    assert.deepEqual(initialShapes.map((shape) => shape.id), ["main", "opponent-model"]);
    assert.deepEqual(nextShapes.map((shape) => shape.id), ["main", "opponent-model"]);
    assert.equal(initialShapes.find((shape) => shape.id === "main").x, initialMain.x);
});
