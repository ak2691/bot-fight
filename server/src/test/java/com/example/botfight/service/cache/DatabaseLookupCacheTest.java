package com.example.botfight.service.cache;

import static org.assertj.core.api.Assertions.assertThat;

import com.example.botfight.DTO.ProfileDTO;
import com.example.botfight.DTO.PuzzleListPageDTO;
import com.example.botfight.service.cache.DatabaseLookupCache.CachedPuzzle;
import com.example.botfight.service.cache.DatabaseLookupCache.PuzzleListKey;
import java.util.List;
import java.util.UUID;
import java.util.concurrent.atomic.AtomicInteger;
import org.junit.jupiter.api.Test;

class DatabaseLookupCacheTest {

    @Test
    void reusesProfileReadModelUntilAWriteInvalidatesIt() {
        DatabaseLookupCache cache = new DatabaseLookupCache();
        UUID userId = UUID.randomUUID();
        AtomicInteger databaseLookups = new AtomicInteger();

        ProfileDTO first = cache.profileSummary(userId, () -> {
            databaseLookups.incrementAndGet();
            return new ProfileDTO("cache-user", null, "", 0, 0, 0, 0, 0);
        });
        ProfileDTO second = cache.profileSummary(userId, () -> {
            databaseLookups.incrementAndGet();
            return new ProfileDTO("cache-user", null, "", 0, 0, 0, 0, 0);
        });

        assertThat(second).isSameAs(first);
        assertThat(databaseLookups).hasValue(1);

        cache.invalidateAfterAboutMeChange(userId, "test-write");
        cache.profileSummary(userId, () -> {
            databaseLookups.incrementAndGet();
            return new ProfileDTO("cache-user", null, "updated", 0, 0, 0, 0, 0);
        });

        assertThat(databaseLookups).hasValue(2);
    }

    @Test
    void keepsPuzzleListSearchesSeparateAndInvalidatesThemTogether() {
        DatabaseLookupCache cache = new DatabaseLookupCache();
        UUID userId = UUID.randomUUID();
        PuzzleListKey allPuzzles = new PuzzleListKey(0, 20, userId, "");
        PuzzleListKey searchedPuzzles = new PuzzleListKey(0, 20, userId, "alpha");
        AtomicInteger databaseLookups = new AtomicInteger();

        PuzzleListPageDTO allResult = cache.puzzleList(
                allPuzzles,
                () -> {
                    databaseLookups.incrementAndGet();
                    return new PuzzleListPageDTO(List.of(), 0, 20, false, 0);
                });
        PuzzleListPageDTO cachedAllResult = cache.puzzleList(
                allPuzzles,
                () -> {
                    databaseLookups.incrementAndGet();
                    return new PuzzleListPageDTO(List.of(), 0, 20, false, 0);
                });
        PuzzleListPageDTO searchResult = cache.puzzleList(
                searchedPuzzles,
                () -> {
                    databaseLookups.incrementAndGet();
                    return new PuzzleListPageDTO(List.of(), 0, 20, false, 0);
                });

        assertThat(cachedAllResult).isSameAs(allResult);
        assertThat(searchResult).isNotSameAs(allResult);
        assertThat(databaseLookups).hasValue(2);

        cache.invalidatePuzzleCatalog("test-search-invalidation");
        cache.puzzleList(
                allPuzzles,
                () -> {
                    databaseLookups.incrementAndGet();
                    return new PuzzleListPageDTO(List.of(), 0, 20, false, 0);
                });
        assertThat(databaseLookups).hasValue(3);
    }

    @Test
    void invalidatesPublishedPuzzleDetailsAfterAnAdminWrite() {
        DatabaseLookupCache cache = new DatabaseLookupCache();
        AtomicInteger databaseLookups = new AtomicInteger();
        CachedPuzzle first = cachedPuzzle("before");
        CachedPuzzle second = cachedPuzzle("after");

        CachedPuzzle firstResult = cache.publishedPuzzle(7L, () -> {
            databaseLookups.incrementAndGet();
            return first;
        });
        CachedPuzzle cachedResult = cache.publishedPuzzle(7L, () -> {
            databaseLookups.incrementAndGet();
            return second;
        });

        assertThat(cachedResult).isSameAs(firstResult);
        assertThat(databaseLookups).hasValue(1);

        cache.invalidatePuzzleCatalog("test-puzzle-update");
        CachedPuzzle refreshedResult = cache.publishedPuzzle(7L, () -> {
            databaseLookups.incrementAndGet();
            return second;
        });

        assertThat(refreshedResult).isSameAs(second);
        assertThat(databaseLookups).hasValue(2);
    }

    private static CachedPuzzle cachedPuzzle(String name) {
        return new CachedPuzzle(
                UUID.randomUUID(),
                7L,
                name,
                "description",
                0,
                true,
                90_000,
                100,
                300,
                100,
                null,
                null,
                null,
                List.of());
    }
}
