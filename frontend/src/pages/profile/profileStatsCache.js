const PROFILE_STATS_CACHE_PREFIX = "botfight-profile-stats-v1";
export const PROFILE_STATS_CACHE_TTL_MS = 10 * 60 * 1000;

function browserStorage() {
    if (typeof window === "undefined") return null;
    try {
        return window.localStorage;
    } catch {
        return null;
    }
}

function normalizedProfileKey(profileKey) {
    const value = String(profileKey ?? "").trim();
    return value || null;
}

export function profileStatsStorageKey(profileKey) {
    const normalized = normalizedProfileKey(profileKey);
    return normalized
        ? `${PROFILE_STATS_CACHE_PREFIX}:${encodeURIComponent(normalized)}`
        : null;
}

function normalizedNumber(value) {
    if (value === null || value === undefined || value === "") return null;
    const numeric = Number(value);
    return Number.isFinite(numeric) ? numeric : null;
}

function normalizeModeStats(stats) {
    if (!stats || typeof stats !== "object") return null;
    const wins = normalizedNumber(stats.wins);
    const losses = normalizedNumber(stats.losses);
    const draws = normalizedNumber(stats.draws);
    const elo = normalizedNumber(stats.elo);
    if ([wins, losses, draws, elo].some((value) => value === null)) return null;
    return { wins, losses, draws, elo };
}

export function normalizeProfileQueueStats(queueStats) {
    if (!queueStats || typeof queueStats !== "object") return null;
    const ones = normalizeModeStats(queueStats.ones);
    const twos = normalizeModeStats(queueStats.twos);
    if (!ones && !twos) return null;
    return { ones, twos };
}

export function loadCachedProfileStats(profileKey, storage = browserStorage(), now = Date.now()) {
    const key = profileStatsStorageKey(profileKey);
    if (!key || !storage) return null;
    try {
        const cached = JSON.parse(storage.getItem(key) ?? "null");
        const cachedAt = Number(cached?.cachedAt);
        if (!Number.isFinite(cachedAt) || now - cachedAt > PROFILE_STATS_CACHE_TTL_MS) {
            storage.removeItem(key);
            return null;
        }
        return normalizeProfileQueueStats(cached?.queueStats);
    } catch {
        return null;
    }
}

export function cacheProfileStats(profileKey, queueStats, storage = browserStorage(), now = Date.now()) {
    const normalized = normalizeProfileQueueStats(queueStats);
    const key = profileStatsStorageKey(profileKey);
    if (!normalized || !key || !storage) return normalized;
    try {
        storage.setItem(key, JSON.stringify({ cachedAt: now, queueStats: normalized }));
    } catch {
        // Cached stats are a display convenience; storage failures must not block the queue.
    }
    return normalized;
}
