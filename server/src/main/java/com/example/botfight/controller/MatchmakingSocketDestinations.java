package com.example.botfight.controller;

import com.example.botfight.DTO.MatchmakingEventDTO;

/**
 * STOMP destinations used by the authenticated matchmaking transport.
 *
 * <p>The destinations are user-specific after Spring resolves the {@code /user} prefix. The
 * match id therefore remains part of the authoritative payload instead of being repeated in the
 * destination path. That also lets an invite recipient subscribe before the server assigns the
 * newly-created match id.</p>
 */
public final class MatchmakingSocketDestinations {

    public static final String MATCHMAKING = "/queue/matchmaking";
    public static final String MATCH = "/queue/match";
    public static final String MATCH_CHAT = "/queue/match-chat";
    private static final String USER_PREFIX = "/user";

    private MatchmakingSocketDestinations() {
    }

    public static String forMatchmakingEvent(MatchmakingEventDTO event) {
        if (event == null
                || event.matchId() == null
                || "MATCH_ACCEPT".equals(event.status())
                || "MATCH_STARTED".equals(event.type())) {
            return MATCHMAKING;
        }
        return MATCH;
    }

    /**
     * Spring may expose a SUBSCRIBE event before or after resolving the user destination.
     * Accept both forms so match-subscription loss detection is not broker-version dependent.
     */
    public static boolean isMatchSubscription(String destination) {
        return MATCH.equals(destination) || (USER_PREFIX + MATCH).equals(destination);
    }
}
