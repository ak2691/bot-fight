package com.example.botfight.service.match.timing;

import com.example.botfight.domain.MatchMode;

/** Centralized round-duration policy shared by match creation and custom lobbies. */
public final class MatchTimingPolicy {
    public static final int ONES_ROUND_SECONDS = 5 * 60;
    public static final int TWOS_ROUND_SECONDS = 6 * 60;
    public static final int DEFAULT_CUSTOM_ROUND_SECONDS = ONES_ROUND_SECONDS;
    public static final int MIN_CUSTOM_ROUND_SECONDS = 30;
    public static final int MAX_CUSTOM_ROUND_SECONDS = 10 * 60;

    private MatchTimingPolicy() {
    }

    public static int defaultRoundDurationSeconds(MatchMode mode) {
        return switch (mode == null ? MatchMode.ONES : mode) {
            case TWOS -> TWOS_ROUND_SECONDS;
            case CUSTOM -> DEFAULT_CUSTOM_ROUND_SECONDS;
            case ONES -> ONES_ROUND_SECONDS;
        };
    }

    /**
     * Resolves the duration for a server-created match. Ranked modes always
     * use their fixed policy; a missing custom value receives the default.
     */
    public static int resolveRoundDurationSeconds(MatchMode mode, Integer requestedSeconds) {
        MatchMode resolvedMode = mode == null ? MatchMode.ONES : mode;
        if (resolvedMode != MatchMode.CUSTOM) {
            return defaultRoundDurationSeconds(resolvedMode);
        }
        if (requestedSeconds == null) {
            return DEFAULT_CUSTOM_ROUND_SECONDS;
        }
        return requireCustomRoundDurationSeconds(requestedSeconds);
    }

    public static int requireCustomRoundDurationSeconds(Integer requestedSeconds) {
        if (requestedSeconds == null
                || requestedSeconds < MIN_CUSTOM_ROUND_SECONDS
                || requestedSeconds > MAX_CUSTOM_ROUND_SECONDS) {
            throw new IllegalArgumentException(
                    "round duration must be between 30 seconds and 10 minutes");
        }
        return requestedSeconds;
    }
}
