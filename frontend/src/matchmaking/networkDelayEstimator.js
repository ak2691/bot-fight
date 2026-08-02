export const DEFAULT_NETWORK_SAMPLE_TIMEOUT_MS = 2_500;
export const DEFAULT_NETWORK_SAMPLE_COUNT = 9;
export const DEFAULT_LOW_DELAY_SAMPLE_COUNT = 5;
export const DEFAULT_NETWORK_SAMPLE_MAX_AGE_MS = 60_000;

function finiteNumber(value) {
    if (value == null || value === "") return null;
    const number = Number(value);
    return Number.isFinite(number) ? number : null;
}

function invalidSample(reason, values = {}) {
    return {
        ...values,
        valid: false,
        reason,
        rttMs: finiteNumber(values.rttMs),
        networkDelayMs: finiteNumber(values.networkDelayMs),
    };
}

export function monotonicEpochNowMs() {
    if (typeof performance === "object"
        && Number.isFinite(performance.timeOrigin)
        && typeof performance.now === "function") {
        return performance.timeOrigin + performance.now();
    }
    return Date.now();
}

export function calculateNetworkDelaySample({
    clientSendTimeMs,
    serverReceiveTimeMs,
    serverTransmitTimeMs,
    clientReceiveTimeMs,
} = {}) {
    const t0 = finiteNumber(clientSendTimeMs);
    const t1 = finiteNumber(serverReceiveTimeMs);
    const t2 = finiteNumber(serverTransmitTimeMs);
    const t3 = finiteNumber(clientReceiveTimeMs);
    if (t0 == null || t1 == null || t2 == null || t3 == null) {
        return invalidSample("invalid_timestamp", {
            clientSendTimeMs,
            serverReceiveTimeMs,
            serverTransmitTimeMs,
            clientReceiveTimeMs,
        });
    }

    const serverProcessingMs = t2 - t1;
    const rttMs = t3 - t0;
    const networkDelayMs = rttMs - serverProcessingMs;
    if (t3 < t0 || serverProcessingMs < 0 || networkDelayMs < 0) {
        return invalidSample("invalid_rtt", {
            clientSendTimeMs: t0,
            serverReceiveTimeMs: t1,
            serverTransmitTimeMs: t2,
            clientReceiveTimeMs: t3,
            rttMs,
            serverProcessingMs,
            networkDelayMs,
        });
    }

    return {
        valid: true,
        reason: null,
        clientSendTimeMs: t0,
        serverReceiveTimeMs: t1,
        serverTransmitTimeMs: t2,
        clientReceiveTimeMs: t3,
        rttMs,
        serverProcessingMs,
        networkDelayMs,
    };
}

export async function requestNetworkDelaySample({
    fetchImpl = globalThis.fetch,
    url,
    now = () => (typeof performance === "object" && typeof performance.now === "function"
        ? performance.now()
        : Date.now()),
    timeoutMs = DEFAULT_NETWORK_SAMPLE_TIMEOUT_MS,
} = {}) {
    const clientSendTimeMs = finiteNumber(now());
    if (clientSendTimeMs == null || typeof fetchImpl !== "function") {
        return invalidSample("request_unavailable", { clientSendTimeMs });
    }

    const controller = typeof AbortController === "function" ? new AbortController() : null;
    const timeoutId = controller == null || timeoutMs == null
        ? null
        : setTimeout(() => controller.abort(), timeoutMs);
    let clientReceiveTimeMs = null;

    try {
        const response = await fetchImpl(url, {
            credentials: "include",
            cache: "no-store",
            ...(controller ? { signal: controller.signal } : {}),
        });
        clientReceiveTimeMs = finiteNumber(now());
        if (!response?.ok) {
            return invalidSample("http_error", {
                clientSendTimeMs,
                clientReceiveTimeMs,
                rttMs: clientReceiveTimeMs == null ? null : clientReceiveTimeMs - clientSendTimeMs,
            });
        }

        const body = await response.json();
        return calculateNetworkDelaySample({
            clientSendTimeMs,
            serverReceiveTimeMs: new Date(body?.serverReceiveTime).getTime(),
            serverTransmitTimeMs: new Date(body?.serverTransmitTime).getTime(),
            clientReceiveTimeMs,
        });
    } catch {
        clientReceiveTimeMs ??= finiteNumber(now());
        return invalidSample("request_failed", {
            clientSendTimeMs,
            clientReceiveTimeMs,
            rttMs: clientReceiveTimeMs == null ? null : clientReceiveTimeMs - clientSendTimeMs,
        });
    } finally {
        if (timeoutId != null) clearTimeout(timeoutId);
    }
}

export function medianLowestNetworkDelaySample(
    samples = [],
    lowDelaySampleCount = DEFAULT_LOW_DELAY_SAMPLE_COUNT,
) {
    const candidateCount = Math.max(
        1,
        Math.floor(Number(lowDelaySampleCount) || DEFAULT_LOW_DELAY_SAMPLE_COUNT),
    );
    const candidates = samples
        .filter((sample) => sample?.valid !== false && Number.isFinite(sample?.networkDelayMs))
        .sort((left, right) => left.networkDelayMs - right.networkDelayMs)
        .slice(0, candidateCount);
    if (candidates.length === 0) return null;

    const delays = candidates.map((sample) => sample.networkDelayMs).sort((left, right) => left - right);
    const middle = Math.floor(delays.length / 2);
    const networkDelayMs = delays.length % 2 === 1
        ? delays[middle]
        : (delays[middle - 1] + delays[middle]) / 2;

    return {
        ...candidates[0],
        networkDelayMs,
        bestNetworkDelayMs: candidates[0].networkDelayMs,
        selectedSampleCount: candidates.length,
    };
}

export async function requestBestNetworkDelaySample({
    sampleCount = DEFAULT_NETWORK_SAMPLE_COUNT,
    lowDelaySampleCount = DEFAULT_LOW_DELAY_SAMPLE_COUNT,
    ...requestOptions
} = {}) {
    const count = Math.max(1, Math.floor(Number(sampleCount) || DEFAULT_NETWORK_SAMPLE_COUNT));
    const samples = [];
    for (let index = 0; index < count; index += 1) {
        samples.push(await requestNetworkDelaySample(requestOptions));
    }
    return medianLowestNetworkDelaySample(samples, lowDelaySampleCount)
        ?? invalidSample("no_valid_sample");
}

export function estimatedOneWayNetworkDelayMs(sample) {
    return Number.isFinite(sample?.networkDelayMs)
        ? Math.max(0, sample.networkDelayMs / 2)
        : 0;
}

export function createNetworkDelaySynchronizer({
    requestSample,
    acceptSample = (sample) => sample?.valid !== false,
    now = () => Date.now(),
    maxSampleAgeMs = DEFAULT_NETWORK_SAMPLE_MAX_AGE_MS,
} = {}) {
    let retainedSample = null;
    let synchronizationInFlight = null;
    let synchronizationGeneration = 0;

    const freshRetainedSample = () => {
        if (retainedSample == null) return null;
        const currentTimeMs = finiteNumber(now());
        const measuredAtMs = finiteNumber(retainedSample.measuredAtMs);
        const maximumAgeMs = finiteNumber(maxSampleAgeMs);
        if (currentTimeMs == null || measuredAtMs == null || maximumAgeMs == null) return null;
        return currentTimeMs - measuredAtMs <= Math.max(0, maximumAgeMs)
            ? retainedSample
            : null;
    };

    return {
        getSample() {
            return freshRetainedSample();
        },
        clear() {
            retainedSample = null;
            synchronizationGeneration += 1;
            synchronizationInFlight = null;
        },
        synchronize() {
            if (synchronizationInFlight) return synchronizationInFlight;

            const generation = synchronizationGeneration;
            const inFlight = Promise.resolve()
                .then(() => requestSample?.())
                .then((candidate) => {
                    if (generation === synchronizationGeneration && acceptSample(candidate)) {
                        retainedSample = {
                            ...candidate,
                            measuredAtMs: finiteNumber(now()),
                        };
                    }
                    return freshRetainedSample() ?? candidate;
                })
                .finally(() => {
                    if (synchronizationInFlight === inFlight) synchronizationInFlight = null;
                });
            synchronizationInFlight = inFlight;
            return inFlight;
        },
    };
}
