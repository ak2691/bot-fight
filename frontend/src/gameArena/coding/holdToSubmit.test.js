import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { HOLD_TO_SUBMIT_MS, holdProgress, submitBlockedReason } from "./holdToSubmit.js";

test("the hold fills over about 600 ms and never overshoots", () => {
    assert.equal(HOLD_TO_SUBMIT_MS, 600);
    assert.equal(holdProgress(null, 1_000), 0);
    assert.equal(holdProgress(1_000, 1_300), 0.5);
    assert.equal(holdProgress(1_000, 5_000), 1);
});

test("an invalid brain blocks the submit with the first validation message", () => {
    assert.equal(submitBlockedReason({ errors: [] }), null);
    assert.equal(submitBlockedReason({ errors: ["301/300 conditions", "other"] }), "301/300 conditions");
    assert.equal(submitBlockedReason(null), null);
});

test("the hold button is inert while blocked and shows the reason", () => {
    const source = readFileSync(new URL("./HoldToSubmitButton.jsx", import.meta.url), "utf8");
    assert.match(source, /const inert = disabled \|\| Boolean\(blockedReason\)/);
    assert.match(source, /yet: \{blockedReason\}/);
});
