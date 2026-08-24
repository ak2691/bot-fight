import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
    GUEST_USER,
    authUnavailableMessage,
    isAnonymousResponse,
    isAuthenticatedResponse,
    isDefinitiveAuthFailure,
} from "./authState.js";

const contextSource = readFileSync(new URL("./AuthContext.jsx", import.meta.url), "utf8");
const protectedRouteSource = readFileSync(new URL("./ProtectedRoute.jsx", import.meta.url), "utf8");

test("only an explicit anonymous response or 401 is definitive logout", () => {
    assert.equal(isAnonymousResponse({ authenticated: false }), true);
    assert.equal(isAnonymousResponse({}), false);
    assert.equal(isAuthenticatedResponse({ authenticated: true }), true);
    assert.equal(isAuthenticatedResponse({ authenticated: false }), false);
    assert.equal(isDefinitiveAuthFailure({ status: 401 }), true);
    assert.equal(isDefinitiveAuthFailure({ status: 429 }), false);
    assert.equal(isDefinitiveAuthFailure({ status: 503 }), false);
    assert.deepEqual(GUEST_USER, { authenticated: false, username: "guest" });
});

test("temporary authentication failures use retry messaging", () => {
    assert.equal(authUnavailableMessage({ status: 429 }), "Too many requests. Try again shortly.");
    assert.equal(authUnavailableMessage({ status: 503 }), "Unable to verify your session right now. Try again.");
    assert.equal(authUnavailableMessage(new TypeError("Failed to fetch")), "Unable to verify your session right now. Try again.");
});

test("auth bootstrap preserves the user on temporary failures and protected routes offer retry", () => {
    assert.match(contextSource, /error\.status = response\.status/);
    assert.match(contextSource, /setAuthError\(error\)/);
    assert.doesNotMatch(contextSource, /catch \{\s*const guest/);
    assert.match(protectedRouteSource, /authError && !isAuthenticated/);
    assert.match(protectedRouteSource, /onRetry=\{\(\) => void refreshUser\(\)\}/);
});
