import { useEffect, useMemo, useState } from "react";
import { apiUrl } from "../../config/api";
import { fetchPuzzles } from "../../puzzles/puzzleApi.js";
import { cacheProfileStats, loadCachedProfileStats } from "../profile/profileStatsCache.js";

// Profile data the home page shows: queue stats (cached like the queue page did), puzzles solved,
// and the puzzle total when the list endpoint provides it.
export function useHomeProfile(user, isGuest) {
    const profileCacheKey = user?.authenticated === true ? user.id ?? user.username : null;
    const cachedStats = useMemo(() => loadCachedProfileStats(profileCacheKey), [profileCacheKey]);
    const [fetchedStats, setFetchedStats] = useState({ key: null, stats: null });
    const profileStats = fetchedStats.key === profileCacheKey && fetchedStats.stats ? fetchedStats.stats : cachedStats;
    const [puzzlesSolved, setPuzzlesSolved] = useState(null);
    const [totalPuzzles, setTotalPuzzles] = useState(null);

    useEffect(() => {
        let disposed = false;
        const loadProfile = async () => {
            try {
                const response = await fetch(apiUrl("/api/profile"), {
                    credentials: "include",
                    cache: "no-store",
                });
                if (!disposed && response.ok) {
                    const nextProfile = await response.json().catch(() => null);
                    if (nextProfile) {
                        const nextStats = cacheProfileStats(profileCacheKey, nextProfile.queueStats);
                        setFetchedStats({ key: profileCacheKey, stats: nextStats });
                        setPuzzlesSolved(Number.isFinite(Number(nextProfile.puzzlesSolved)) ? Number(nextProfile.puzzlesSolved) : null);
                    }
                }
            } catch {
                // The block can render without stats if this optional snapshot fails.
            }
        };
        void loadProfile();
        return () => {
            disposed = true;
        };
    }, [profileCacheKey]);

    useEffect(() => {
        if (isGuest) return undefined;
        let disposed = false;
        fetchPuzzles(0, 1)
            .then((result) => {
                const total = Number(result?.totalElements);
                if (!disposed && Number.isFinite(total)) setTotalPuzzles(total);
            })
            .catch(() => {
                // The progress bar is optional; "N solved" still renders without a total.
            });
        return () => {
            disposed = true;
        };
    }, [isGuest]);

    return { profileStats, puzzlesSolved, totalPuzzles };
}
