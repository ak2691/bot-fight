import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const logoSource = readFileSync(new URL("./BotLogo.jsx", import.meta.url), "utf8");
const navbarSource = readFileSync(new URL("./AppNavbar.jsx", import.meta.url), "utf8");
const authLayoutSource = readFileSync(new URL("../pages/auth/AuthLayout.jsx", import.meta.url), "utf8");
const spinningBotSource = readFileSync(new URL("./SpinningBotFace.jsx", import.meta.url), "utf8");
const arenaLoadingSource = readFileSync(new URL("./ArenaLoadingScreen.jsx", import.meta.url), "utf8");
const protectedRouteSource = readFileSync(new URL("../auth/ProtectedRoute.jsx", import.meta.url), "utf8");
const profileSource = readFileSync(new URL("../pages/profile/ProfilePage.jsx", import.meta.url), "utf8");
const profileSearchSource = readFileSync(new URL("../pages/profile/ProfileSearchPage.jsx", import.meta.url), "utf8");

test("bot logo uses the supplied PNG and renders BF when it fails", () => {
    assert.match(logoSource, /bot-design\.png/);
    assert.match(logoSource, /onError=\{\(\) => setImageFailed\(true\)\}/);
    assert.match(logoSource, />BF<\/span>/);
    assert.match(logoSource, /showLabel = false/);
    assert.match(logoSource, /showLabel && <span>BF<\/span>/);
});

test("navbar uses a large clickable bot face while authentication keeps the wordmark", () => {
    assert.match(navbarSource, /className="app-brand-link[^"]*h-12 w-12[^"]*"/);
    assert.match(navbarSource, /<BotLogo className="h-12 w-12 object-contain" \/>/);
    assert.doesNotMatch(navbarSource, /<span className="text-cyan-400">BOT<\/span>/);
    assert.doesNotMatch(navbarSource, /<span className="text-fuchsia-400">FIGHT<\/span>/);

    assert.match(authLayoutSource, /className="auth-brand home-title[^"]*"/);
    assert.match(authLayoutSource, /<span className="home-title-bot block">BOT<\/span>/);
    assert.match(authLayoutSource, /<span className="home-title-fight block">FIGHT<\/span>/);
    assert.doesNotMatch(authLayoutSource, /<BotLogo/);
});

test("loading surfaces share the spinning bot face instead of generic rings or skeletons", () => {
    assert.match(spinningBotSource, /<BotLogo/);
    assert.match(spinningBotSource, /asset-loading-bot/);
    for (const source of [arenaLoadingSource, profileSource, profileSearchSource]) {
        assert.match(source, /<SpinningBotFace/);
    }
    assert.match(protectedRouteSource, /<ArenaLoadingScreen \/>/);
    assert.doesNotMatch(protectedRouteSource, /LOADING SESSION/);
    assert.doesNotMatch(arenaLoadingSource, /animate-spin/);
    assert.doesNotMatch(profileSource, /animate-pulse/);
    assert.doesNotMatch(profileSearchSource, /animate-pulse/);
});

test("public profiles expose the duel invite action while owner profiles do not", () => {
    assert.match(profileSource, /const isOwner = !viewedUsername \|\| isSelfProfile/);
    assert.match(profileSource, /canInvite=\{!isOwner\}/);
    assert.match(profileSource, /Invite to 1v1/);
    assert.match(profileSource, /\/api\/duel-invites/);
    assert.match(profileSource, /DUEL_INVITE_COOLDOWN_MS = 15_000/);
    assert.match(profileSource, /canBlock=\{!isOwner\}/);
    assert.match(profileSource, /\/api\/blocks/);
    assert.match(profileSource, /Block player/);
    assert.match(profileSource, /profile-toolbar-button/);
    assert.match(profileSource, /profile-toolbar-button--red/);
});
