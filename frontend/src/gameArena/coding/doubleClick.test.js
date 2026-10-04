import assert from "node:assert/strict";
import test from "node:test";
import { createClickLog } from "./doubleClick.js";

test("two quick clicks on different things are not a double-click", () => {
    const log = createClickLog();
    log.record("node-a:0");
    log.record("node-a:1");
    assert.equal(log.isDoubleClick(), false);
    log.record("node-a:1");
    assert.equal(log.isDoubleClick(), true, "the same row twice");
    log.record("canvas");
    assert.equal(log.isDoubleClick(), false, "clicking something else resets it");
});
