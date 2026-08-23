import assert from "node:assert/strict";
import test from "node:test";
import {
    defaultAuthRoute,
    isServerErrorStatus,
    SERVER_DOWN_MESSAGE,
    serverErrorMessage,
} from "./serverError.js";

test("only 5xx responses keep the custom server error route visible", () => {
    assert.equal(isServerErrorStatus(500), true);
    assert.equal(isServerErrorStatus(503), true);
    assert.equal(isServerErrorStatus(404), false);
    assert.equal(isServerErrorStatus(200), false);
});

test("healthy auth probes return to the authenticated or guest default route", () => {
    assert.equal(defaultAuthRoute({ authenticated: true }), "/home");
    assert.equal(defaultAuthRoute({ authenticated: false }), "/login");
    assert.equal(defaultAuthRoute(null), "/login");
});

test("network and server failures use the server-down message", () => {
    assert.equal(serverErrorMessage({ status: 500 }), SERVER_DOWN_MESSAGE);
    assert.equal(serverErrorMessage(new TypeError("Failed to fetch")), SERVER_DOWN_MESSAGE);
});
