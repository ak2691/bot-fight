import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const routeSource = readFileSync(new URL("./MatchProtectedRoute.jsx", import.meta.url), "utf8");
const appSource = readFileSync(new URL("../App.jsx", import.meta.url), "utf8");

test("direct match navigation revalidates the server before mounting the game", () => {
    assert.match(routeSource, /refreshActiveMatchStatus\(controller\.signal\)/);
    assert.match(routeSource, /const \[isRevalidating, setIsRevalidating\] = useState\(!cachedHandoff\)/);
    assert.match(routeSource, /const \[routeStatus, setRouteStatus\] = useState/);
    assert.match(routeSource, /if \(isRevalidating \|\| routeStatus\.loading\)/);
    assert.match(routeSource, /if \(routeStatus\.activeMatch !== true\)/);
    assert.match(routeSource, /setRouteStatus\(nextStatus\)/);
    assert.match(routeSource, /<Navigate to="\/home" replace \/>/);
    assert.match(appSource, /<MatchProtectedRoute>\s*<GamePage \/>\s*<\/MatchProtectedRoute>/s);
});

test("terminal active-match updates do not eject an already authorized match page", () => {
    assert.match(routeSource, /routeStatus\.activeMatch/);
    assert.doesNotMatch(routeSource, /activeMatchStatus: status/);
});

test("internal active-match handoffs reuse the server-verified route state", () => {
    assert.match(routeSource, /useLocation/);
    assert.match(routeSource, /activeMatchVerified/);
    assert.match(routeSource, /if \(cachedHandoff\)/);
});
