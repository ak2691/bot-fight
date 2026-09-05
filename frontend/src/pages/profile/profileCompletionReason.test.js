import assert from "node:assert/strict";
import test from "node:test";
import { formatCompletionReason } from "./profileCompletionReason.js";

test("formats forfeits as Forfeit", () => {
    assert.equal(formatCompletionReason("RESIGNATION"), "Forfeit");
    assert.equal(formatCompletionReason("DISCONNECTION"), "Forfeit");
});

test("formats all other completion reasons as Match Completed", () => {
    assert.equal(formatCompletionReason("SIMULATION"), "Match Completed");
    assert.equal(formatCompletionReason("MUTUAL_DISCONNECTION"), "Match Completed");
    assert.equal(formatCompletionReason(null), "Match Completed");
});
