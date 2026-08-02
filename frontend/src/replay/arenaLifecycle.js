export const MATCH_REPLAY_ARENA_KEY = "match-replay-arena";

export function matchReplayArenaLifecycle(queueStatus, playback) {
    const loading = queueStatus === "SIMULATION_LOADING";
    const mounted = loading || playback != null;
    return {
        mounted,
        loading,
        key: mounted ? MATCH_REPLAY_ARENA_KEY : null,
    };
}
