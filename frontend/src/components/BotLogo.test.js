import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const logoSource = readFileSync(new URL("./BotLogo.jsx", import.meta.url), "utf8");
const navbarSource = readFileSync(new URL("./AppNavbar.jsx", import.meta.url), "utf8");
const authLayoutSource = readFileSync(new URL("../pages/auth/AuthLayout.jsx", import.meta.url), "utf8");
const spinningBotSource = readFileSync(new URL("./SpinningBotFace.jsx", import.meta.url), "utf8");
const arenaLoadingSource = readFileSync(new URL("./ArenaLoadingScreen.jsx", import.meta.url), "utf8");
const arenaSource = readFileSync(new URL("../gameArena/Arena.jsx", import.meta.url), "utf8");
const protectedRouteSource = readFileSync(new URL("../auth/ProtectedRoute.jsx", import.meta.url), "utf8");
const profileSource = readFileSync(new URL("../pages/profile/ProfilePage.jsx", import.meta.url), "utf8");
const queueSource = readFileSync(new URL("../pages/queue/QueuePage.jsx", import.meta.url), "utf8");
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
    assert.match(globalStyles, /\.profile-page > section \.rounded-full \{[\s\S]*background: #1b2226;[\s\S]*box-shadow: none;/);
    assert.doesNotMatch(globalStyles, /\.profile-page \.rounded-full \{/);
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

test("profile search results use the charcoal profile-card surface", () => {
    assert.match(profileSearchSource, /rounded-2xl border border-cyan-900\/80 bg-\[#151a1d\]/);
    assert.match(profileSearchSource, /hover:bg-\[#1b2226\] focus:bg-\[#1b2226\]/);
    assert.doesNotMatch(profileSearchSource, /rounded-2xl border border-cyan-900\/80 bg-\[#091521ed\]/);
});

test("navbar reserves its layout slot and follows scroll direction globally", () => {
    assert.match(navbarSource, /useLocation/);
    assert.match(navbarSource, /app-navbar-slot/);
    assert.match(navbarSource, /app-navbar--hidden/);
    assert.match(navbarSource, /addEventListener\("scroll"/);
    assert.match(navbarSource, /\.arena-content-shell/);
    assert.match(navbarSource, /inPageFlow = false/);
    assert.match(navbarSource, /app-navbar-slot--in-page-flow/);
    assert.match(navbarSource, /showAtScrollTop/);
    assert.match(navbarSource, /setNavbarVisibility\(\{ pathname, hidden: scrollDelta > 0 \}\)/);
    assert.match(arenaSource, /<AppNavbar inPageFlow/);
    assert.match(arenaSource, /arena-workspace-shell/);
    assert.match(globalStyles, /\.app-navbar-slot \{[\s\S]*min-height: 72px;/);
    assert.doesNotMatch(globalStyles, /\.arena-page-shell:has\(\.app-navbar--hidden\) > \.app-navbar-slot/);
    assert.match(globalStyles, /\.app-navbar--in-page-flow \{[\s\S]*position: sticky;[\s\S]*top: 0;/);
    assert.match(globalStyles, /\.app-navbar-slot--in-page-flow \{[\s\S]*display: contents;/);
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

test("custom lobby creation lives in the queue instead of public profiles", () => {
    assert.match(profileSource, /const isOwner = !viewedUsername \|\| isSelfProfile/);
    assert.match(queueSource, /CREATE CUSTOM LOBBY/);
    assert.match(queueSource, /navigate\("\/custom-lobby"/);
    assert.match(queueSource, /api\/custom-lobbies\/current/);
    assert.match(queueSource, /OPEN CUSTOM LOBBY/);
    assert.match(queueSource, /hasCustomLobby/);
    assert.match(queueSource, /md:col-span-2 md:mx-auto/);
    assert.match(queueSource, /QueuePlayerGroup count=\{4\} side="left"/);
    assert.match(queueSource, /Play privately with friends\./);
    assert.match(queueSource, /Up to 4 players\./);
    assert.doesNotMatch(queueSource, /Invite up to four players|plus-slot/);
    assert.doesNotMatch(queueSource, /AVAILABLE|COMING NEXT/);
    assert.match(queueSource, /profileStats\?\.ones/);
    assert.match(queueSource, /profileStats\?\.twos/);
    assert.doesNotMatch(queueSource, /W: \{profile\?\.wins/);
    assert.match(profileSource, /canBlock=\{!isOwner\}/);
    assert.match(profileSource, /\/api\/blocks/);
    assert.match(profileSource, /Block player/);
    assert.match(profileSource, /profile-toolbar-button/);
    assert.match(profileSource, /profile-toolbar-button--red/);
});

test("queue cards show labeled ELO and W-L-D summaries without adding filler content", () => {
    assert.match(queueSource, /max-w-5xl flex/);
    assert.doesNotMatch(queueSource, /lg:max-w-6xl|xl:max-w-7xl|2xl:max-w-\[1440px\]/);
    assert.match(queueSource, /min-h-44/);
    assert.doesNotMatch(queueSource, /lg:min-h-48|xl:min-h-52|xl:h-10 xl:w-10/);
    assert.match(queueSource, /ELO/);
    assert.match(queueSource, /font-mono text-2xl font-bold leading-none tracking-normal text-white sm:text-3xl/);
    assert.match(queueSource, /RECORD/);
    assert.match(queueSource, /formatQueueElo\(modeStats\)/);
    assert.match(queueSource, /formatQueueRecord\(modeStats\)/);
    assert.match(queueSource, /text-cyan-300">W-L-D<\/span>/);
    assert.doesNotMatch(queueSource, /modeStats\?\.wins \?\? 0\}W/);
    assert.match(queueSource, /formatQueueTime\(queueElapsed\)/);
    assert.doesNotMatch(queueSource, /QUEUE STATUS|CANCEL QUEUE/);
    assert.match(queueSource, /A party of 2 cannot queue a 1v1\./);
    assert.doesNotMatch(queueSource, /W:\$\{modeStats/);
});

test("profile records keep the W-L-D labels below compact numeric values", () => {
    assert.match(profileSource, /\{stats\?\.wins \?\? 0\}-\{stats\?\.losses \?\? 0\}-\{stats\?\.draws \?\? 0\}/);
    assert.match(profileSource, /text-center font-mono text-\[9px\].*W-L-D/);
    assert.doesNotMatch(profileSource, /stats\?\.wins \?\? 0\}W/);
});

test("profile match history aligns modes and exposes accessible match details", () => {
    assert.match(profileSource, /grid-cols-\[4\.25rem_minmax\(0,1fr\)_auto\]/);
    assert.match(profileSource, /self-center w-full whitespace-nowrap/);
    assert.match(profileSource, /onOpenDetails=\{\(\) => onOpenMatchDetails\(match\)\}/);
    assert.match(profileSource, /MatchDetailsModal/);
    assert.match(profileSource, /MatchDetail label="SCORE"/);
    assert.match(profileSource, /MatchDetail label="ELO CHANGE"/);
    assert.match(profileSource, /bg-\[#1B2227\]/);
    assert.match(profileSource, /function eloChangeTone/);
    assert.match(profileSource, /showMode=\{false\} showResult=\{false\} showDate=\{false\} showTeamLabels roomy/);
    assert.match(profileSource, /function matchTeamLabel/);
    assert.match(profileSource, /function matchTeamTone/);
    assert.match(profileSource, /teamIndex > 0 && !showTeamLabels/);
    assert.match(profileSource, /teamIndex > 0 && showTeamLabels/);
    assert.match(profileSource, /font-mono text-lg font-bold text-white/);
    assert.match(profileSource, /flex min-w-0 max-w-full flex-nowrap .*overflow-hidden/);
    assert.match(profileSource, /min-w-0 max-w-full truncate/);
    assert.match(profileSource, /<ProfileLink key=\{`\$\{teamIndex\}-\$\{username\}`\}/);
});
