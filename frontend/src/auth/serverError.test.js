import assert from "node:assert/strict";
import test from "node:test";
import {
    defaultAuthRoute,
    isServerUnavailable,
    isServerErrorStatus,
    LOGIN_SERVER_DOWN_MESSAGE,
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
    assert.equal(defaultAuthRoute({ authenticated: false, guest: true }), "/home");
    assert.equal(defaultAuthRoute({ authenticated: false }), "/login");
    assert.equal(defaultAuthRoute(null), "/login");
});

test("network and server failures use the server-down message", () => {
    assert.equal(serverErrorMessage({ status: 500 }), SERVER_DOWN_MESSAGE);
    assert.equal(serverErrorMessage(new TypeError("Failed to fetch")), SERVER_DOWN_MESSAGE);
});

test("the login page only labels network and 5xx failures as server downtime", () => {
    assert.equal(LOGIN_SERVER_DOWN_MESSAGE, "Server is currently down or in maintenance");
    assert.equal(isServerUnavailable(new TypeError("Failed to fetch")), true);
    assert.equal(isServerUnavailable({ status: 503 }), true);
    assert.equal(isServerUnavailable({ status: 401 }), false);
    assert.equal(isServerUnavailable({ status: 429 }), false);
    assert.equal(isServerUnavailable(null), false);
});
