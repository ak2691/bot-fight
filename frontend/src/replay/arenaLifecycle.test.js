import assert from "node:assert/strict";
import test from "node:test";
import { matchReplayArenaLifecycle, MATCH_REPLAY_ARENA_KEY } from "./arenaLifecycle.js";

test("loading-to-playback keeps one mounted replay arena surface for Pixi reuse", () => {
    const loading = matchReplayArenaLifecycle("SIMULATION_LOADING", null);
    const playback = matchReplayArenaLifecycle("PLAYBACK", { initialState: { bots: [] }, frames: [] });

    assert.equal(loading.mounted, true);
    assert.equal(playback.mounted, true);
    assert.equal(loading.key, MATCH_REPLAY_ARENA_KEY);
    assert.equal(playback.key, loading.key);
});

test("the replay arena is not mounted outside an arena lifecycle", () => {
    assert.deepEqual(matchReplayArenaLifecycle("LOADOUT_SELECT", null), {
        mounted: false,
        loading: false,
        key: null,
    });
});
