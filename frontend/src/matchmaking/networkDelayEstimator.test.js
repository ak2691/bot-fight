import assert from "node:assert/strict";
import test from "node:test";
import {
    calculateNetworkDelaySample,
    createNetworkDelaySynchronizer,
    DEFAULT_LOW_DELAY_SAMPLE_COUNT,
    DEFAULT_NETWORK_SAMPLE_COUNT,
    estimatedOneWayNetworkDelayMs,
    medianLowestNetworkDelaySample,
    requestNetworkDelaySample,
} from "./networkDelayEstimator.js";

test("uses nine probes and retains the five lowest-delay candidates by default", () => {
    assert.equal(DEFAULT_NETWORK_SAMPLE_COUNT, 9);
    assert.equal(DEFAULT_LOW_DELAY_SAMPLE_COUNT, 5);
});

test("subtracts server processing time from total RTT without calculating an offset", () => {
    assert.deepEqual(calculateNetworkDelaySample({
        clientSendTimeMs: 1_000,
        serverReceiveTimeMs: 50_000,
        serverTransmitTimeMs: 50_040,
        clientReceiveTimeMs: 1_140,
    }), {
        valid: true,
        reason: null,
        clientSendTimeMs: 1_000,
        serverReceiveTimeMs: 50_000,
        serverTransmitTimeMs: 50_040,
        clientReceiveTimeMs: 1_140,
        rttMs: 140,
        serverProcessingMs: 40,
        networkDelayMs: 100,
    });
});

test("requests a fresh four-timestamp network sample", async () => {
    const localTimes = [1_000, 1_140];
    const sample = await requestNetworkDelaySample({
        url: "/api/time",
        now: () => localTimes.shift(),
        fetchImpl: async () => ({
            ok: true,
            json: async () => ({
                serverReceiveTime: new Date(50_000).toISOString(),
                serverTransmitTime: new Date(50_040).toISOString(),
            }),
        }),
    });

    assert.equal(sample.valid, true);
    assert.equal(sample.networkDelayMs, 100);
});

test("filters the slowest probes and takes the median network delay", () => {
    const selected = medianLowestNetworkDelaySample([
        { valid: true, networkDelayMs: 5 },
        { valid: true, networkDelayMs: 8 },
        { valid: true, networkDelayMs: 10 },
        { valid: true, networkDelayMs: 12 },
        { valid: true, networkDelayMs: 14 },
        { valid: true, networkDelayMs: 200 },
        { valid: true, networkDelayMs: 300 },
        { valid: true, networkDelayMs: 400 },
        { valid: true, networkDelayMs: 500 },
    ]);

    assert.equal(selected.networkDelayMs, 10);
    assert.equal(selected.bestNetworkDelayMs, 5);
    assert.equal(selected.selectedSampleCount, 5);
    assert.equal(estimatedOneWayNetworkDelayMs(selected), 5);
});

test("fresh synchronization replaces older delay measurements and expires", async () => {
    const samples = [
        { valid: true, networkDelayMs: 8 },
        { valid: true, networkDelayMs: 20 },
    ];
    let nowMs = 1_000;
    const synchronizer = createNetworkDelaySynchronizer({
        requestSample: async () => samples.shift(),
        now: () => nowMs,
        maxSampleAgeMs: 60_000,
    });

    await synchronizer.synchronize();
    nowMs = 2_000;
    await synchronizer.synchronize();
    assert.equal(synchronizer.getSample().networkDelayMs, 20);

    nowMs = 62_001;
    assert.equal(synchronizer.getSample(), null);
});

test("clearing during an in-flight synchronization discards the old connection sample", async () => {
    const pending = [];
    const synchronizer = createNetworkDelaySynchronizer({
        requestSample: () => new Promise((resolve) => pending.push(resolve)),
        now: () => 1_000,
    });

    const oldConnection = synchronizer.synchronize();
    await Promise.resolve();
    synchronizer.clear();
    const newConnection = synchronizer.synchronize();
    await Promise.resolve();

    pending.shift()({ valid: true, networkDelayMs: 5 });
    await oldConnection;
    assert.equal(synchronizer.getSample(), null);

    pending.shift()({ valid: true, networkDelayMs: 25 });
    await newConnection;
    assert.equal(synchronizer.getSample().networkDelayMs, 25);
});
