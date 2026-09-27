import assert from "node:assert/strict";
import test from "node:test";
import {
    AUTH_SESSION_INVALID,
    AUTH_SESSION_TEMPORARY_FAILURE,
    AUTH_SESSION_VALID,
    probeCurrentAuthentication,
} from "./authSession.js";

function response(status, body = null) {
    return {
        status,
        ok: status >= 200 && status < 300,
        json: async () => body,
    };
}

test("authentication probes treat 401 and successful anonymous responses as session loss", async () => {
    assert.equal(
        await probeCurrentAuthentication({ fetchImpl: async () => response(401) }),
        AUTH_SESSION_INVALID,
    );
    assert.equal(
        await probeCurrentAuthentication({
            fetchImpl: async () => response(200, { authenticated: false }),
        }),
        AUTH_SESSION_INVALID,
    );
});

test("authentication probes preserve guests and classify temporary backend failures", async () => {
    assert.equal(
        await probeCurrentAuthentication({
            fetchImpl: async () => response(200, { authenticated: false, guest: true }),
        }),
        AUTH_SESSION_VALID,
    );
    assert.equal(
        await probeCurrentAuthentication({ fetchImpl: async () => response(503) }),
        AUTH_SESSION_TEMPORARY_FAILURE,
    );
    assert.equal(
        await probeCurrentAuthentication({ fetchImpl: async () => { throw new TypeError("offline"); } }),
        AUTH_SESSION_TEMPORARY_FAILURE,
    );
});

test("concurrent authentication probes share one /api/auth/me request", async () => {
    let requestCount = 0;
    let resolveResponse;
    const pendingResponse = new Promise((resolve) => {
        resolveResponse = resolve;
    });
    const fetchImpl = () => {
        requestCount += 1;
        return pendingResponse;
    };

    const first = probeCurrentAuthentication({ fetchImpl });
    const second = probeCurrentAuthentication({ fetchImpl });
    assert.equal(requestCount, 1);
    resolveResponse(response(200, { authenticated: true }));
    assert.deepEqual(await Promise.all([first, second]), [AUTH_SESSION_VALID, AUTH_SESSION_VALID]);
});
