package com.example.botfight.service.match;

import com.example.botfight.domain.match.MatchMode;

/**
 * Centralized timed-rounds policy shared by match creation and custom lobbies.
 *
 * <p>Each player has a chess-style clock: a base time for the whole match plus an increment added at
 * the start of every build. Only the BUILDING phase spends it. Kit reveal and the replay are fixed
 * durations that never touch a clock.
 */
public final class MatchTimingPolicy {
    public static final int KIT_REVEAL_SECONDS = 10;
    public static final int SUBMISSION_GRACE_SECONDS = 2;

    public static final int ONES_BASE_CLOCK_SECONDS = 3 * 60;
    public static final int TWOS_BASE_CLOCK_SECONDS = 4 * 60;
    public static final int DEFAULT_CUSTOM_BASE_CLOCK_SECONDS = 5 * 60;
    public static final int MIN_CUSTOM_BASE_CLOCK_SECONDS = 30;
    public static final int MAX_CUSTOM_BASE_CLOCK_SECONDS = 10 * 60;

    public static final int DEFAULT_INCREMENT_SECONDS = 30;
    public static final int MIN_CUSTOM_INCREMENT_SECONDS = 0;
    public static final int MAX_CUSTOM_INCREMENT_SECONDS = 60;

    /** Length of one simulated fight segment, and the number of rounds in a match. */
    public static final int SEGMENT_SECONDS = 15;
    public static final int MAX_ROUNDS = 6;

    private MatchTimingPolicy() {
    }

    public static int roundIncrementSeconds(int gapIncrementSeconds, int round) {
        return gapIncrementSeconds + (MatchLoadoutService.unlockedTier(round) == null ? 0 : 15);
    }

    public static int defaultBaseClockSeconds(MatchMode mode) {
        return switch (mode == null ? MatchMode.ONES : mode) {
            case TWOS -> TWOS_BASE_CLOCK_SECONDS;
            case CUSTOM -> DEFAULT_CUSTOM_BASE_CLOCK_SECONDS;
            case ONES -> ONES_BASE_CLOCK_SECONDS;
        };
    }

    /**
     * Resolves the base clock for a server-created match. Ranked modes always use their fixed policy;
     * a missing custom value receives the default.
     */
    public static int resolveBaseClockSeconds(MatchMode mode, Integer requestedSeconds) {
        MatchMode resolvedMode = mode == null ? MatchMode.ONES : mode;
        if (resolvedMode != MatchMode.CUSTOM) {
            return defaultBaseClockSeconds(resolvedMode);
        }
        if (requestedSeconds == null) {
            return DEFAULT_CUSTOM_BASE_CLOCK_SECONDS;
        }
        return requireCustomBaseClockSeconds(requestedSeconds);
    }

    /** Ranked modes always use the default increment; a missing custom value receives the default. */
    public static int resolveIncrementSeconds(MatchMode mode, Integer requestedSeconds) {
        MatchMode resolvedMode = mode == null ? MatchMode.ONES : mode;
        if (resolvedMode != MatchMode.CUSTOM || requestedSeconds == null) {
            return DEFAULT_INCREMENT_SECONDS;
        }
        return requireCustomIncrementSeconds(requestedSeconds);
    }

    public static int requireCustomBaseClockSeconds(Integer requestedSeconds) {
        if (requestedSeconds == null
                || requestedSeconds < MIN_CUSTOM_BASE_CLOCK_SECONDS
                || requestedSeconds > MAX_CUSTOM_BASE_CLOCK_SECONDS) {
            throw new IllegalArgumentException(
                    "base clock must be between 30 seconds and 10 minutes");
        }
        return requestedSeconds;
    }

    public static int requireCustomIncrementSeconds(Integer requestedSeconds) {
        if (requestedSeconds == null
                || requestedSeconds < MIN_CUSTOM_INCREMENT_SECONDS
                || requestedSeconds > MAX_CUSTOM_INCREMENT_SECONDS) {
            throw new IllegalArgumentException(
                    "clock increment must be between 0 and 60 seconds");
        }
        return requestedSeconds;
    }
}
