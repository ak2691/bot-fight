import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { fatalPageMessage, isUnsupportedWebGL } from "./fatalRecovery.js";

const boundarySource = readFileSync(new URL("./RouteErrorBoundary.jsx", import.meta.url), "utf8");
const recoveryScreenSource = readFileSync(new URL("../components/FatalRecoveryScreen.jsx", import.meta.url), "utf8");
const matchRouteSource = readFileSync(new URL("./MatchProtectedRoute.jsx", import.meta.url), "utf8");
const protectedRouteSource = readFileSync(new URL("./ProtectedRoute.jsx", import.meta.url), "utf8");

test("dynamic import failures recommend a page refresh", () => {
    assert.equal(
        fatalPageMessage(new Error("Failed to fetch dynamically imported module")),
        "A page file could not be loaded. Refresh the page to load the current version.",
    );
    assert.match(boundarySource, /FatalRecoveryScreen/);
    assert.match(boundarySource, /fatalPageMessage\(this\.state\.error\)/);
    assert.match(recoveryScreenSource, /Refresh page/);
});

test("fatal recovery gives authenticated and anonymous users an escape route", () => {
    assert.match(recoveryScreenSource, /isAuthenticated \? "\/home" : "\/login"/);
    assert.match(recoveryScreenSource, /isAuthenticated \? "Return home" : "Return to login"/);
    assert.match(recoveryScreenSource, /<Link to=\{destination\}/);
});

test("renderer failures distinguish unsupported WebGL from stale assets", () => {
    assert.equal(isUnsupportedWebGL(new Error("Unable to initialize WebGL context")), true);
    assert.equal(isUnsupportedWebGL(new Error("Failed to fetch dynamically imported module")), false);
    assert.match(protectedRouteSource, /showRefresh=\{!unsupported\}/);
});

test("a stale match route with no active match returns home", () => {
    assert.match(matchRouteSource, /if \(routeStatus\.activeMatch !== true\)/);
    assert.match(matchRouteSource, /<Navigate to="\/home" replace \/>/);
});
