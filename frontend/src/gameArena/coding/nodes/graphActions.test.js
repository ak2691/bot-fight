import assert from "node:assert/strict";
import test from "node:test";
import { graphBranchActions, setGraphActions } from "./graphActions.js";

test("editing an action keeps the conditional's own id, even when the action carries one", () => {
    const branch = { id: "b1", conditions: [{ type: "always" }], actions: [{ id: "a1", action: "move_walk", selectable: "opponent_1" }] };
    const next = setGraphActions(branch, [{ ...branch.actions[0], movementMode: "coordinates", targetX: 10 }]);
    assert.equal(next.id, "b1");
    assert.equal(next.actions[0].id, "a1");
    assert.equal(next.action, "move_walk");
    assert.equal(next.movementMode, "coordinates");
});

test("removing every action clears the branch's mirrored action without touching its id", () => {
    const next = setGraphActions({ id: "b1", action: "move_walk", actions: [{ id: "a1", action: "move_walk" }] }, []);
    assert.equal(next.id, "b1");
    assert.equal(next.action, "none");
    assert.deepEqual(graphBranchActions(next), []);
});
