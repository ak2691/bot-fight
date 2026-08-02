import assert from "node:assert/strict";
import test from "node:test";
import { relativeLocalDeadlineMs } from "./relativeMatchTiming.js";

test("anchors a server interval locally without using a clock offset", () => {
    const deadline = relativeLocalDeadlineMs({
        deadlineServerTime: "2026-07-31T12:01:02.000Z",
        serverTransmitTime: "2026-07-31T12:00:00.000Z",
        localReceiveTimeMs: 10_000,
        estimatedOneWayDelayMs: 50,
        visibleGraceMs: 2_000,
    });

    assert.equal(deadline, 69_950);
});

test("returns an already elapsed local deadline for a late event", () => {
    const deadline = relativeLocalDeadlineMs({
        deadlineServerTime: "2026-07-31T12:00:03.000Z",
        serverTransmitTime: "2026-07-31T12:00:04.000Z",
        localReceiveTimeMs: 10_000,
        estimatedOneWayDelayMs: 25,
    });

    assert.equal(deadline, 8_975);
});
