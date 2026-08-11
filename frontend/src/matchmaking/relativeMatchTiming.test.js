import assert from "node:assert/strict";
import test from "node:test";
import {
    relativeLocalDeadlineMs,
    visibleLoadoutSelectionDeadlineMs,
} from "./relativeMatchTiming.js";

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

test("a normal on-time 62-second selection interval displays 60 seconds", () => {
    const authoritativeDeadline = relativeLocalDeadlineMs({
        deadlineServerTime: "2026-07-31T12:01:02.000Z",
        serverTransmitTime: "2026-07-31T12:00:00.000Z",
        localReceiveTimeMs: 10_000,
        estimatedOneWayDelayMs: 50,
    });
    const visibleDeadline = visibleLoadoutSelectionDeadlineMs(authoritativeDeadline, 50);

    assert.equal(Math.ceil((visibleDeadline - 10_000) / 1_000), 60);
});

test("selection visibility applies fixed grace and measured delivery correction", () => {
    assert.equal(visibleLoadoutSelectionDeadlineMs(70_000, 50), 68_050);
    assert.equal(visibleLoadoutSelectionDeadlineMs(70_000, 5_000), 73_000);
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
