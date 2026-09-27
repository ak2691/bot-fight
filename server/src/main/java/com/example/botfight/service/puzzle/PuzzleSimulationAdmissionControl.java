package com.example.botfight.service.puzzle;

import com.example.botfight.service.limits.RateLimitExceededException;
import java.time.Duration;
import java.util.Set;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.Semaphore;
import java.util.concurrent.atomic.AtomicBoolean;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;

/** Non-blocking application-wide admission for synchronous puzzle simulations. */
@Service
public class PuzzleSimulationAdmissionControl {

    public static final int DEFAULT_MAX_CONCURRENT_SIMULATIONS = 2;
    private static final Duration RETRY_AFTER = Duration.ofSeconds(1);

    private final Semaphore permits;
    private final Set<UUID> activeUserIds = ConcurrentHashMap.newKeySet();

    public PuzzleSimulationAdmissionControl(
            @Value("${botfight.puzzle.simulation.max-concurrent:" + DEFAULT_MAX_CONCURRENT_SIMULATIONS + "}")
            int maxConcurrentSimulations) {
        if (maxConcurrentSimulations <= 0) {
            throw new IllegalArgumentException("maxConcurrentSimulations must be positive");
        }
        this.permits = new Semaphore(maxConcurrentSimulations);
    }

    /**
     * Claims one simulation slot without waiting. Authenticated users also get
     * at most one active puzzle attempt across the application instance.
     */
    public Lease acquire(UUID userId) {
        if (!permits.tryAcquire()) {
            throw RateLimitExceededException.tooManyRequests(RETRY_AFTER);
        }
        if (userId != null && !activeUserIds.add(userId)) {
            permits.release();
            throw RateLimitExceededException.tooManyRequests(RETRY_AFTER);
        }
        return new Lease(permits, activeUserIds, userId);
    }

    public static final class Lease implements AutoCloseable {
        private final Semaphore permits;
        private final Set<UUID> activeUserIds;
        private final UUID userId;
        private final AtomicBoolean closed = new AtomicBoolean();

        private Lease(Semaphore permits, Set<UUID> activeUserIds, UUID userId) {
            this.permits = permits;
            this.activeUserIds = activeUserIds;
            this.userId = userId;
        }

        @Override
        public void close() {
            if (!closed.compareAndSet(false, true)) return;
            if (userId != null) activeUserIds.remove(userId);
            permits.release();
        }
    }
}
