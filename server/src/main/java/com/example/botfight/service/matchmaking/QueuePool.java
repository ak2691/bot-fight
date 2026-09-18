package com.example.botfight.service.matchmaking;

/**
 * Server-owned matchmaking isolation. Guest games are never allowed to cross
 * into the registered-player pool. Registered users use Elo-aware matching;
 * guests use an independent FIFO pool without ratings.
 */
public enum QueuePool {
    REGISTERED(true),
    GUEST(false);

    private final boolean ranked;

    QueuePool(boolean ranked) {
        this.ranked = ranked;
    }

    public boolean ranked() {
        return ranked;
    }
}
