import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { cacheProfileStats, loadCachedProfileStats, PROFILE_STATS_CACHE_TTL_MS } from "../profile/profileStatsCache.js";
import { abilityForRound, guaranteeSummary } from "../queue/queueGuarantees.js";

const read = (relative) => readFileSync(fileURLToPath(new URL(relative, import.meta.url)), "utf8");
const BLOCK = read("./RankedMatchBlock.jsx");
const HOME = read("./HomePage.jsx");
const HOME_PROFILE = read("./useHomeProfile.js");
const HOME_CSS = read("./home.css");
const PICKER = read("../queue/QueueAbilityGuaranteePicker.jsx");
const GUARANTEE_CSS = read("../queue/guarantees.css");
const PROVIDER = read("../../matchmaking/MatchmakingProvider.jsx");
const APP = read("../../App.jsx");
const LOBBY = read("../customLobby/CustomLobbyPage.jsx");
const NAVBAR = read("../../components/AppNavbar.jsx");
const NAVBAR_CSS = read("../../components/navbar.css");

test("the queue page is gone and /queue redirects home", () => {
    assert.doesNotMatch(APP, /QueuePage/);
    assert.match(APP, /<Route path="\/queue" element=\{<Navigate to="\/home" replace \/>\} \/>/);
});

test("ranked queue controls are disabled while a custom lobby exists and private match is disabled during ranked activity", () => {
    assert.match(BLOCK, /const hasCustomLobby = Boolean\(customLobby\?\.lobbyId\)/);
    assert.match(BLOCK, /const queueActionDisabled = !mode\.available[\s\S]*?\|\| hasCustomLobby/);
    assert.match(BLOCK, /rankedParticipationActive = Boolean\([\s\S]*?isQueueing \|\| pendingAcceptance \|\| activeMatchStatus\?\.activeMatch/);
    assert.match(BLOCK, /disabled=\{!hasCustomLobby && \(rankedParticipationActive \|\| !customLobbyChecked\)\}/);
});

test("guarantee helpers find the round's ability and summarise locked offers", () => {
    assert.equal(abilityForRound([], 1), null);
    assert.equal(abilityForRound([null, null, null], 2), null);
    assert.equal(guaranteeSummary([]), "random (R1), random (R2), random (R3)");
});

test("route changes do not leave and rejoin an active queue", () => {
    const queueEffect = PROVIDER.match(/useEffect\(\(\) => \{\s*if \(!hasGameAccess \|\| !queueConnectionEnabled\)[\s\S]*?\}, \[[\s\S]*?queueConnectionEnabled[\s\S]*?\]\);/);

    assert.ok(queueEffect);
    assert.match(queueEffect[0], /navigateRef\.current\("\/match"\)/);
    assert.doesNotMatch(queueEffect[0], /\bnavigate\b/);
    assert.doesNotMatch(queueEffect[0], /client\.leaveQueue\(\)/);
});

test("queue recovery asks the server instead of using browser storage", () => {
    assert.doesNotMatch(PROVIDER, /localStorage|sessionStorage/);
    assert.match(PROVIDER, /event\.queueStartedAt/);
});

test("profile stats cache is isolated by profile and expires safely", () => {
    const values = new Map();
    const storage = {
        getItem: (key) => values.get(key) ?? null,
        setItem: (key, value) => values.set(key, value),
        removeItem: (key) => values.delete(key),
    };
    const stats = {
        ones: { wins: 4, losses: 2, draws: 1, elo: 1035 },
        twos: { wins: 1, losses: 3, draws: 0, elo: 987 },
    };

    cacheProfileStats("profile-one", stats, storage, 1_000);
    assert.deepEqual(loadCachedProfileStats("profile-one", storage, 1_001), stats);
    assert.equal(loadCachedProfileStats("profile-two", storage, 1_001), null);
    assert.equal(loadCachedProfileStats("profile-one", storage, 1_000 + PROFILE_STATS_CACHE_TTL_MS + 1), null);
});

