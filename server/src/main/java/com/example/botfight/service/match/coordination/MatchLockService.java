package com.example.botfight.service.match.coordination;

import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.ConcurrentMap;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.concurrent.locks.ReentrantLock;
import java.util.function.Supplier;

/** Serializes state transitions for one match without blocking unrelated matches. */
public final class MatchLockService {
    private final ConcurrentMap<UUID, MatchCoordination> coordinationByMatchId = new ConcurrentHashMap<>();

    public <T> T withLock(UUID matchId, Supplier<T> operation) {
        if (matchId == null) {
            throw new IllegalArgumentException("matchId is required for coordination");
        }
        MatchCoordination coordination = coordinationByMatchId.compute(
                matchId,
                (ignored, current) -> {
                    MatchCoordination selected = current == null ? new MatchCoordination() : current;
                    selected.references.incrementAndGet();
                    return selected;
                });
        coordination.lock.lock();
        try {
            return operation.get();
        } finally {
            coordination.lock.unlock();
            coordinationByMatchId.computeIfPresent(matchId, (ignored, current) -> {
                if (current != coordination) return current;
                return coordination.references.decrementAndGet() == 0 ? null : current;
            });
        }
    }

    private static final class MatchCoordination {
        private final ReentrantLock lock = new ReentrantLock();
        private final AtomicInteger references = new AtomicInteger();
    }
}
