package com.example.botfight.service.match.model;

import com.example.botfight.DTO.match.MatchmakingPlayerDTO;
import com.example.botfight.service.match.MatchTimingPolicy;
import java.time.Instant;
import java.util.UUID;

/**
 * One player's authoritative match state. {@code roundWins} is kept so existing payloads do not break;
 * a timed-rounds match has no round wins and it stays zero.
 *
 * <p>{@code clockRemainingMs} is the player's build clock. It only changes at a build boundary: the
 * increment is added when a build starts, and the time spent is deducted when the player submits or
 * runs out. While a player is building it is the clock as it stood when the build began, and
 * {@code buildEndsAt} is the visible instant it reaches zero.
 */
public record MatchPlayer(
        UUID userId,
        String username,
        String principalName,
        int slot,
        int teamNumber,
        boolean finished,
        UUID botSubmissionId,
        int roundWins,
        String selectedLoadout,
        boolean loadoutSelected,
        long clockRemainingMs,
        String timeoutFallback,
        Instant buildEndsAt) {
    /** Submit the current brain if it is valid; the server falls back to last round's brain if not. */
    public static final String TIMEOUT_FALLBACK_CURRENT = "CURRENT";
    /** Always resubmit last round's brain. */
    public static final String TIMEOUT_FALLBACK_PREVIOUS = "PREVIOUS";

    public MatchPlayer {
        timeoutFallback = normalizeTimeoutFallback(timeoutFallback);
        clockRemainingMs = Math.max(0, clockRemainingMs);
    }

    public static String normalizeTimeoutFallback(String value) {
        return TIMEOUT_FALLBACK_PREVIOUS.equals(value) ? TIMEOUT_FALLBACK_PREVIOUS : TIMEOUT_FALLBACK_CURRENT;
    }

    public static boolean isTimeoutFallback(String value) {
        return TIMEOUT_FALLBACK_CURRENT.equals(value) || TIMEOUT_FALLBACK_PREVIOUS.equals(value);
    }

    public MatchPlayer withClock(long nextClockRemainingMs, Instant nextBuildEndsAt) {
        return new MatchPlayer(
                userId,
                username,
                principalName,
                slot,
                teamNumber,
                finished,
                botSubmissionId,
                roundWins,
                selectedLoadout,
                loadoutSelected,
                nextClockRemainingMs,
                timeoutFallback,
                nextBuildEndsAt);
    }

    public MatchPlayer withTimeoutFallback(String nextTimeoutFallback) {
        return new MatchPlayer(
                userId,
                username,
                principalName,
                slot,
                teamNumber,
                finished,
                botSubmissionId,
                roundWins,
                selectedLoadout,
                loadoutSelected,
                clockRemainingMs,
                nextTimeoutFallback,
                buildEndsAt);
    }

    /**
     * The instant after which this player's own build is over. A player who falls back to last round's
     * brain is resolved exactly at the visible deadline; a player who auto-submits their current brain
     * gets the submission grace so a submit in flight when the clock hits zero can still arrive.
     */
    public Instant buildExpiresAt() {
        if (buildEndsAt == null) return null;
        return TIMEOUT_FALLBACK_PREVIOUS.equals(timeoutFallback)
                ? buildEndsAt
                : buildEndsAt.plusSeconds(MatchTimingPolicy.SUBMISSION_GRACE_SECONDS);
    }

    public MatchmakingPlayerDTO toDto() {
        return new MatchmakingPlayerDTO(
                userId,
                username,
                slot,
                teamNumber,
                finished,
                roundWins,
                selectedLoadout,
                loadoutSelected,
                clockRemainingMs,
                buildEndsAt,
                timeoutFallback);
    }
}
