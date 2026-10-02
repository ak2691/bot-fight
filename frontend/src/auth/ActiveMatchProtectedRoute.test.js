import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { SERVER_DOWN_MESSAGE, serverErrorMessage } from "./serverError.js";

const routeSource = readFileSync(new URL("./ActiveMatchProtectedRoute.jsx", import.meta.url), "utf8");
const appSource = readFileSync(new URL("../App.jsx", import.meta.url), "utf8");
const providerSource = readFileSync(new URL("../matchmaking/MatchmakingProvider.jsx", import.meta.url), "utf8");
const serverErrorPageSource = readFileSync(new URL("../pages/ServerErrorPage.jsx", import.meta.url), "utf8");

test("active-match route uses the cached server state without requiring a match subscription", () => {
    assert.match(providerSource, /fetch\(apiUrl\("\/api\/matches\/active"\)/);
    assert.match(providerSource, /activeMatch: matchStatus\.activeMatch === true/);
    assert.match(providerSource, /matchId: matchStatus\.matchId \?\? null/);
    assert.doesNotMatch(routeSource, /Navigate to="\/match"/);
    assert.match(routeSource, /status\.activeMatch === true/);
});

test("server failures use the server-down message", () => {
    assert.equal(SERVER_DOWN_MESSAGE, "Servers are down");
    assert.equal(serverErrorMessage({ status: 500 }), SERVER_DOWN_MESSAGE);
    assert.equal(serverErrorMessage({ status: 502 }), SERVER_DOWN_MESSAGE);
    assert.equal(serverErrorMessage(new TypeError("Failed to fetch")), SERVER_DOWN_MESSAGE);
});

test("queue alert notices dismiss without hiding full-page errors", () => {
});

test("server failures enter the monitored server-recovery route", () => {
    assert.match(routeSource, /Navigate to="\/error" replace/);
    assert.match(serverErrorPageSource, /isAuthenticated \? "Go home" : "Back to login"/);
});

test("client HTTP failures keep a neutral retry message", () => {
    assert.equal(serverErrorMessage({ status: 404 }), "Something went wrong. Retry to continue.");
});

test("home navigation keeps the active-match button available after match unsubscribe", () => {
    assert.match(routeSource, /activeMatchId: status\.matchId/);
    assert.match(appSource, /<ActiveMatchProtectedRoute>\s*<HomePage \/>\s*<\/ActiveMatchProtectedRoute>/s);
});

test("home navigation does not issue a socket-close or completed-match command", () => {
    assert.doesNotMatch(appSource, /leaveCompletedMatchOnActiveClient/);
    assert.doesNotMatch(appSource, /MatchRouteDepartureObserver/);
});
