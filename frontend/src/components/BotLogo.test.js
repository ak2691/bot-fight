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
const globalStyles = readFileSync(new URL("../index.css", import.meta.url), "utf8");

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
    assert.match(navbarSource, /bg-\[#0e1a22\]/);
    assert.doesNotMatch(navbarSource, /<span className="text-cyan-400">BOT<\/span>/);
    assert.doesNotMatch(navbarSource, /<span className="text-fuchsia-400">FIGHT<\/span>/);

    assert.match(authLayoutSource, /className="auth-brand home-title[^"]*"/);
    assert.match(authLayoutSource, /<span className="home-title-bot block">BOT<\/span>/);
    assert.match(authLayoutSource, /<span className="home-title-fight block">FIGHT<\/span>/);
    assert.doesNotMatch(authLayoutSource, /<BotLogo/);
});

test("profile page uses scoped charcoal surfaces without recoloring the shared navbar", () => {
    assert.match(profileSource, /className="profile-page min-h-screen bg-\[#181b1c\] font-interface text-\[#f2f4f5\]"/);
    assert.match(globalStyles, /\.profile-page \{[\s\S]*background: #181b1c;[\s\S]*color: #f2f4f5;/);
    assert.match(globalStyles, /\.profile-page \.rounded-2xl \{[\s\S]*background: #151a1d;[\s\S]*box-shadow: none;/);
    assert.match(globalStyles, /\.profile-page \.profile-toolbar-button:hover:not\(:disabled\) \{[\s\S]*background-color: #1b2226;/);
    assert.match(globalStyles, /\.profile-page \.profile-toolbar-button \{[\s\S]*--profile-toolbar-border: #3a464d;/);
    assert.match(globalStyles, /\.profile-page \.profile-toolbar-button--primary \{[\s\S]*--profile-toolbar-border: #35c7e8;/);
    assert.match(globalStyles, /\.profile-page \.profile-toolbar-button--red \{[\s\S]*--profile-toolbar-border: rgba\(255, 113, 102, \.52\);/);
    assert.match(globalStyles, /\.puzzle-page-decoration-piece \{[\s\S]*stroke: rgba\(130, 145, 150, \.55\);/);
    assert.doesNotMatch(globalStyles, /\.puzzle-page \.app-navbar/);
});

test("profile secondary actions stay neutral until hover", () => {
    assert.match(profileSource, /className="profile-toolbar-button h-11 text-sm font-bold"[\s\S]*Search/);
    assert.match(profileSource, /className="profile-toolbar-button w-full flex-none text-sm font-bold sm:w-auto"[\s\S]*View All Matches/);
    assert.match(profileSource, /className="profile-toolbar-button text-sm font-bold"[\s\S]*Change username/);
    assert.match(profileSource, /profile-toolbar-button--primary h-11 text-sm font-bold/);
});

test("navbar reserves its layout slot and follows scroll direction globally", () => {
    assert.match(navbarSource, /useLocation/);
    assert.match(navbarSource, /className="app-navbar-slot"/);
    assert.match(navbarSource, /app-navbar--hidden/);
    assert.match(navbarSource, /addEventListener\("scroll"/);
    assert.match(navbarSource, /\.arena-content-shell/);
    assert.match(navbarSource, /setNavbarVisibility\(\{ pathname, hidden: scrollDelta > 0 \}\)/);
    assert.match(globalStyles, /\.app-navbar-slot \{[\s\S]*min-height: 72px;/);
    assert.match(globalStyles, /\.app-navbar \{[\s\S]*position: fixed;/);
    assert.match(globalStyles, /\.app-navbar \{[\s\S]*background-color: #0e1a22;/);
    assert.match(globalStyles, /\.app-navbar--charcoal-page \{[\s\S]*border-bottom-color: #2b353a;/);
    assert.match(navbarSource, /bg-\[#0e1a22\]/);
    assert.match(navbarSource, /app-navbar--charcoal-page/);
    assert.doesNotMatch(navbarSource, /bg-\[#0d1b25(?:f5)?\]/);
    assert.match(globalStyles, /\.app-navbar--hidden \{[\s\S]*translate3d\(0, calc\(-100% - 1px\), 0\)/);
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
