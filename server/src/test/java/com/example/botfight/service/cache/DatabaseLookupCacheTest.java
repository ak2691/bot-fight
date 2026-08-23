package com.example.botfight.service.cache;

import static org.assertj.core.api.Assertions.assertThat;

import com.example.botfight.DTO.ProfileDTO;
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
}
