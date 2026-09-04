package com.example.botfight.service.cache;

import com.example.botfight.DTO.match.MatchHistoryPageDTO;
import com.example.botfight.DTO.profile.ProfileDTO;
import com.example.botfight.DTO.profile.ProfileSearchPageDTO;
import com.example.botfight.DTO.puzzle.PuzzleListPageDTO;
import com.example.botfight.DTO.profile.SolvedPuzzlePageDTO;
import com.example.botfight.domain.puzzle.PuzzleBotRole;
import com.github.benmanes.caffeine.cache.Cache;
import com.github.benmanes.caffeine.cache.Caffeine;
import com.github.benmanes.caffeine.cache.RemovalCause;
import com.github.benmanes.caffeine.cache.RemovalListener;
import java.time.Duration;
import java.time.Instant;
import java.util.List;
import java.util.UUID;
import java.util.function.Predicate;
import java.util.function.Supplier;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Component;
import tools.jackson.databind.JsonNode;

/**
 * Process-local caches for stable database read models.
 *
 * <p>The cache intentionally owns read snapshots, not managed JPA entities.
 * That keeps lazy relationships and persistence-context state out of the
 * cache. All cache misses execute their supplied database lookup, and all
 * invalidation paths are logged so local server logs show why a request did
 * or did not reach the database.</p>
 */
@Component
public class DatabaseLookupCache {

    private static final Logger LOGGER = LoggerFactory.getLogger(DatabaseLookupCache.class);

    private static final Duration PUZZLE_EXPIRY = Duration.ofMinutes(5);
    private static final Duration PROFILE_EXPIRY = Duration.ofMinutes(10);

    private final Cache<Long, CachedPuzzle> publishedPuzzleCache = newCache(
            "puzzle-detail", 500, PUZZLE_EXPIRY);
    private final Cache<PuzzleListKey, PuzzleListPageDTO> puzzleListCache = newCache(
            "puzzle-list", 2_000, PUZZLE_EXPIRY);
    private final Cache<UUID, ProfileDTO> profileCache = newCache(
            "profile-summary", 5_000, PROFILE_EXPIRY);
    private final Cache<UUID, CachedMatchStats> profileMatchStatsCache = newCache(
            "profile-match-stats", 5_000, PROFILE_EXPIRY);
    private final Cache<UUID, CachedRatings> profileRatingsCache = newCache(
            "profile-ratings", 5_000, PROFILE_EXPIRY);
    private final Cache<UUID, CachedUser> currentUserCache = newCache(
            "profile-current-user", 5_000, PROFILE_EXPIRY);
    private final Cache<String, CachedUser> publicUserCache = newCache(
            "profile-public-user", 5_000, PROFILE_EXPIRY);
    private final Cache<ProfileHistoryKey, MatchHistoryPageDTO> matchHistoryCache = newCache(
            "profile-match-history", 10_000, PROFILE_EXPIRY);
    private final Cache<SolvedPuzzleHistoryKey, SolvedPuzzlePageDTO> solvedPuzzleHistoryCache = newCache(
            "puzzle-submission-history", 5_000, PUZZLE_EXPIRY);
    private final Cache<ProfileSearchKey, ProfileSearchPageDTO> profileSearchCache = newCache(
            "profile-search", 2_000, PROFILE_EXPIRY);

    public CachedPuzzle publishedPuzzle(long puzzleNumber, Supplier<CachedPuzzle> databaseLookup) {
        return getOrLoad("puzzle-detail", publishedPuzzleCache, puzzleNumber, databaseLookup);
    }

    public PuzzleListPageDTO puzzleList(
            PuzzleListKey key,
            Supplier<PuzzleListPageDTO> databaseLookup) {
        return getOrLoad("puzzle-list", puzzleListCache, key, databaseLookup);
    }

    public ProfileDTO profileSummary(UUID userId, Supplier<ProfileDTO> databaseLookup) {
        return getOrLoad("profile-summary", profileCache, userId, databaseLookup);
    }

    public CachedMatchStats profileMatchStats(
            UUID userId,
            Supplier<CachedMatchStats> databaseLookup) {
        return getOrLoad("profile-match-stats", profileMatchStatsCache, userId, databaseLookup);
    }

    public CachedRatings profileRatings(
            UUID userId,
            Supplier<CachedRatings> databaseLookup) {
        return getOrLoad("profile-ratings", profileRatingsCache, userId, databaseLookup);
    }

    public CachedUser currentUser(UUID userId, Supplier<CachedUser> databaseLookup) {
        return getOrLoad("profile-current-user", currentUserCache, userId, databaseLookup);
    }

    public CachedUser publicUser(String normalizedUsername, Supplier<CachedUser> databaseLookup) {
        return getOrLoad("profile-public-user", publicUserCache, normalizedUsername, databaseLookup);
    }

    public MatchHistoryPageDTO matchHistory(
            ProfileHistoryKey key,
            Supplier<MatchHistoryPageDTO> databaseLookup) {
        return getOrLoad("profile-match-history", matchHistoryCache, key, databaseLookup);
    }

    public SolvedPuzzlePageDTO solvedPuzzleHistory(
            SolvedPuzzleHistoryKey key,
            Supplier<SolvedPuzzlePageDTO> databaseLookup) {
        return getOrLoad("puzzle-submission-history", solvedPuzzleHistoryCache, key, databaseLookup);
    }

    public ProfileSearchPageDTO profileSearch(
            ProfileSearchKey key,
            Supplier<ProfileSearchPageDTO> databaseLookup) {
        return getOrLoad("profile-search", profileSearchCache, key, databaseLookup);
    }

    public void logDatabaseWrite(String cacheName, Object key, String operation) {
        LOGGER.info(
                "CACHE_WRITE cache={} key={} operation={} source=database",
                cacheName,
                safeKey(key),
                safeKey(operation));
    }

    public void invalidatePublishedPuzzle(long puzzleNumber, String reason) {
        invalidate("puzzle-detail", publishedPuzzleCache, puzzleNumber, reason);
    }

    public void invalidatePuzzleCatalog(String reason) {
        invalidateAll("puzzle-detail", publishedPuzzleCache, reason);
        invalidateAll("puzzle-list", puzzleListCache, reason);
    }

    public void invalidateAfterPuzzleCompletion(UUID userId, String reason) {
        invalidate("profile-summary", profileCache, userId, reason);
        invalidateMatching(
                "puzzle-list",
                puzzleListCache,
                key -> userId != null && userId.equals(key.userId()),
                reason);
        invalidateMatching(
                "puzzle-submission-history",
                solvedPuzzleHistoryCache,
                key -> userId != null && userId.equals(key.userId()),
                reason);
    }

    public void invalidateAfterAboutMeChange(UUID userId, String reason) {
        invalidate("profile-summary", profileCache, userId, reason);
    }

    public void invalidateAfterMatchWrite(UUID userId, String reason) {
        invalidate("profile-summary", profileCache, userId, reason);
        invalidate("profile-match-stats", profileMatchStatsCache, userId, reason);
        invalidate("profile-ratings", profileRatingsCache, userId, reason);
        invalidateMatching(
                "profile-match-history",
                matchHistoryCache,
                key -> userId != null && userId.equals(key.userId()),
                reason);
    }

    public void invalidateAfterUsernameChange(UUID userId, String reason) {
        invalidate("profile-summary", profileCache, userId, reason);
        invalidate("profile-current-user", currentUserCache, userId, reason);
        invalidateMatchingValues(
                "profile-public-user",
                publicUserCache,
                cachedUser -> userId != null && userId.equals(cachedUser.id()),
                reason);
        invalidateAll("profile-search", profileSearchCache, reason);
        invalidateAll("profile-match-history", matchHistoryCache, reason);
    }

    private <K, V> V getOrLoad(
            String cacheName,
            Cache<K, V> cache,
            K key,
            Supplier<V> databaseLookup) {
        V cached = cache.getIfPresent(key);
        if (cached != null) {
            LOGGER.info("CACHE_HIT cache={} key={} source=memory", cacheName, safeKey(key));
            return cached;
        }

        return cache.get(key, ignored -> {
            LOGGER.info("CACHE_MISS cache={} key={} source=database", cacheName, safeKey(key));
            return databaseLookup.get();
        });
    }

    private <K, V> void invalidate(
            String cacheName,
            Cache<K, V> cache,
            K key,
            String reason) {
        LOGGER.info(
                "CACHE_INVALIDATE cache={} key={} reason={}",
                cacheName,
                safeKey(key),
                safeKey(reason));
        cache.invalidate(key);
    }

    private <K, V> void invalidateMatching(
            String cacheName,
            Cache<K, V> cache,
            Predicate<K> predicate,
            String reason) {
        List<K> keys = cache.asMap().keySet().stream()
                .filter(predicate)
                .toList();
        if (!keys.isEmpty()) {
            LOGGER.info(
                    "CACHE_INVALIDATE_MATCHING cache={} entries={} reason={}",
                    cacheName,
                    keys.size(),
                    safeKey(reason));
            keys.forEach(cache::invalidate);
        }
    }

    private <K, V> void invalidateMatchingValues(
            String cacheName,
            Cache<K, V> cache,
            Predicate<V> predicate,
            String reason) {
        List<K> keys = cache.asMap().entrySet().stream()
                .filter(entry -> predicate.test(entry.getValue()))
                .map(java.util.Map.Entry::getKey)
                .toList();
        if (!keys.isEmpty()) {
            LOGGER.info(
                    "CACHE_INVALIDATE_MATCHING cache={} entries={} reason={}",
                    cacheName,
                    keys.size(),
                    safeKey(reason));
            keys.forEach(cache::invalidate);
        }
    }

    private <K, V> void invalidateAll(
            String cacheName,
            Cache<K, V> cache,
            String reason) {
        LOGGER.info(
                "CACHE_INVALIDATE_ALL cache={} entries={} reason={}",
                cacheName,
                cache.estimatedSize(),
                safeKey(reason));
        cache.invalidateAll();
    }

    private <K, V> Cache<K, V> newCache(
            String cacheName,
            long maximumSize,
            Duration expireAfterWrite) {
        RemovalListener<K, V> removalListener = (key, value, cause) -> logEviction(
                cacheName,
                key,
                cause);
        return Caffeine.newBuilder()
                .maximumSize(maximumSize)
                .expireAfterWrite(expireAfterWrite)
                .removalListener(removalListener)
                .build();
    }

    private void logEviction(String cacheName, Object key, RemovalCause cause) {
        if (cause == RemovalCause.EXPLICIT) {
            LOGGER.info(
                    "CACHE_EVICT cache={} key={} cause={} source=explicit-invalidation",
                    cacheName,
                    safeKey(key),
                    cause);
            return;
        }

        LOGGER.debug(
                "CACHE_EVICT cache={} key={} cause={} source=automatic-lifecycle",
                cacheName,
                safeKey(key),
                cause);
    }

    private String safeKey(Object key) {
        if (key == null) return "null";
        String raw = String.valueOf(key);
        StringBuilder sanitized = new StringBuilder(raw.length());
        raw.codePoints().forEach(codePoint -> sanitized.appendCodePoint(
                Character.isISOControl(codePoint) ? ' ' : codePoint));
        String value = sanitized.toString();
        return value.length() <= 200 ? value : value.substring(0, 200);
    }

    public record CachedPuzzle(
            UUID id,
            long puzzleNumber,
            String name,
            String description,
            int initialElapsedMs,
            boolean hideOpponentCode,
            int timeLimitMs,
            int maxActionNodes,
            int maxConditionNodes,
            int maxCustomVariables,
            int playerTeamSize,
            int opponentTeamSize,
            JsonNode logicConfiguration,
            JsonNode winConditions,
            JsonNode loseConditions,
            List<CachedPuzzleBot> bots) {

        public CachedPuzzle(
                UUID id,
                long puzzleNumber,
                String name,
                String description,
                int initialElapsedMs,
                boolean hideOpponentCode,
                int timeLimitMs,
                int maxActionNodes,
                int maxConditionNodes,
                int maxCustomVariables,
                JsonNode logicConfiguration,
                JsonNode winConditions,
                JsonNode loseConditions,
                List<CachedPuzzleBot> bots) {
            this(
                    id,
                    puzzleNumber,
                    name,
                    description,
                    initialElapsedMs,
                    hideOpponentCode,
                    timeLimitMs,
                    maxActionNodes,
                    maxConditionNodes,
                    maxCustomVariables,
                    1,
                    1,
                    logicConfiguration,
                    winConditions,
                    loseConditions,
                    bots);
        }

        public CachedPuzzle {
            logicConfiguration = copy(logicConfiguration);
            winConditions = copy(winConditions);
            loseConditions = copy(loseConditions);
            bots = List.copyOf(bots);
        }

        private static JsonNode copy(JsonNode value) {
            return value == null ? null : value.deepCopy();
        }
    }

    public record CachedPuzzleBot(
            UUID id,
            PuzzleBotRole role,
            int teamNumber,
            int slot,
            String loadout,
            double startX,
            double startY,
            double rotation,
            double startHp,
            JsonNode brain) {

        public CachedPuzzleBot {
            brain = brain == null ? null : brain.deepCopy();
        }
    }

    public record CachedUser(UUID id, String username, Instant createdAt) {
    }

    public record CachedMatchStats(
            long wins,
            long losses,
            long draws,
            long onesWins,
            long onesLosses,
            long onesDraws,
            long twosWins,
            long twosLosses,
            long twosDraws) {

        public CachedMatchStats(long wins, long losses, long draws) {
            this(wins, losses, draws, 0, 0, 0, 0, 0, 0);
        }
    }

    public record CachedRatings(int ones, int twos) {
    }

    public record PuzzleListKey(int page, int size, UUID userId, String query) {
    }

    public record ProfileHistoryKey(
            UUID userId,
            int page,
            String query,
            Instant fromInclusive,
            Instant toExclusive) {
    }

    public record SolvedPuzzleHistoryKey(UUID userId, int page) {
    }

    public record ProfileSearchKey(int page, String query) {
    }
}
