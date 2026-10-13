import assert from "node:assert/strict";
import test from "node:test";
import { freeSlotX, newRootSlot, rectsOverlap, ROOT_GAP } from "./placement.js";

test("rectangles overlap only when they share area", () => {
    const box = { x: 0, y: 0, width: 100, height: 50 };
    assert.equal(rectsOverlap(box, { x: 99, y: 49, width: 10, height: 10 }), true);
    assert.equal(rectsOverlap(box, { x: 100, y: 0, width: 10, height: 10 }), false, "touching sides do not overlap");
    assert.equal(rectsOverlap(box, { x: 0, y: 50, width: 10, height: 10 }), false, "touching bottoms do not overlap");
});

test("a new node moves right in steps of its width plus 72 until nothing overlaps it", () => {
    const rect = { x: 0, y: 100, width: 340, height: 80 };
    assert.equal(freeSlotX(rect, [], 412), 0, "a free slot stays where it started");
    assert.equal(freeSlotX(rect, [{ x: 0, y: 120, width: 340, height: 80 }], 412), 412);
    const crowded = [{ x: 0, y: 120, width: 340, height: 80 }, { x: 412, y: 120, width: 340, height: 80 }];
    assert.equal(freeSlotX(rect, crowded, 412), 824);
    assert.equal(freeSlotX(rect, [{ x: 0, y: 0, width: 10, height: 10 }], 412), 0, "nodes above or beside the row do not block it");
});

test("a new root sits right of the rightmost root on the first root's top, or at the origin when none", () => {
    assert.deepEqual(newRootSlot([]), { x: 0, y: 0 });
    const roots = [{ x: 100, y: 50, width: 260, height: 84 }, { x: 500, y: 80, width: 260, height: 84 }];
    assert.deepEqual(newRootSlot(roots), { x: 760 + ROOT_GAP, y: 50 });
});
