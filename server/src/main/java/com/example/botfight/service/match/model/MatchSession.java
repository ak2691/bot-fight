package com.example.botfight.service.match.model;

import com.example.botfight.DTO.match.MatchPlaybackDTO;
import com.example.botfight.DTO.match.MatchReplayDTO;
import com.example.botfight.domain.match.MatchMode;
import com.example.botfight.service.match.timing.MatchTimingPolicy;
import java.time.Instant;
import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;

/**
 * One live timed-rounds match. {@code baseClockSeconds} and {@code incrementSeconds} are the per-player
 * build clock; {@code buildingEndsAt} is the instant the last player's build expires (including the
 * submission grace), so it is the point after which every build is over. {@code segmentEndState} is the
 * frozen end of the last simulated segment, carried into the next round.
 */
public record MatchSession(
        UUID matchId,
        long simulationSeed,
        List<MatchPlayer> players,
        Instant loadoutSelectionEndsAt,
        Instant entityPlacementEndsAt,
        Instant countdownEndsAt,
        Instant buildingEndsAt,
        int roundNumber,
        List<MatchPlaybackDTO.ArenaEntityDTO> arenaEntities,
        Map<UUID, List<MatchPlaybackDTO.ArenaEntityDTO>> entityPlacementsByUserId,
        Instant playbackStartsAt,
        MatchReplayDTO replayPlayback,
        Instant resultRevealsAt,
        Instant roundReadyAt,
        boolean seriesComplete,
        MatchMode mode,
        int baseClockSeconds,
        int incrementSeconds,
        Set<UUID> surrenderVotes,
        List<MatchReplayDTO.ReplayBotDTO> segmentEndState) {
    public MatchSession {
        mode = mode == null ? MatchMode.ONES : mode;
        baseClockSeconds = MatchTimingPolicy.resolveBaseClockSeconds(mode, baseClockSeconds);
        incrementSeconds = Math.max(
                MatchTimingPolicy.MIN_CUSTOM_INCREMENT_SECONDS,
                Math.min(MatchTimingPolicy.MAX_CUSTOM_INCREMENT_SECONDS, incrementSeconds));
        surrenderVotes = surrenderVotes == null ? Set.of() : Set.copyOf(surrenderVotes);
        segmentEndState = segmentEndState == null ? List.of() : List.copyOf(segmentEndState);
    }

    /** Full constructor for a match with explicit clock settings and no surrender votes. */
    public MatchSession(
            UUID matchId,
            long simulationSeed,
            List<MatchPlayer> players,
            Instant loadoutSelectionEndsAt,
            Instant entityPlacementEndsAt,
            Instant countdownEndsAt,
            Instant buildingEndsAt,
            int roundNumber,
            List<MatchPlaybackDTO.ArenaEntityDTO> arenaEntities,
            Map<UUID, List<MatchPlaybackDTO.ArenaEntityDTO>> entityPlacementsByUserId,
            Instant playbackStartsAt,
            MatchReplayDTO replayPlayback,
            Instant resultRevealsAt,
            Instant roundReadyAt,
            boolean seriesComplete,
            MatchMode mode,
            int baseClockSeconds,
            int incrementSeconds) {
        this(matchId, simulationSeed, players, loadoutSelectionEndsAt, entityPlacementEndsAt, countdownEndsAt,
                buildingEndsAt, roundNumber, arenaEntities, entityPlacementsByUserId, playbackStartsAt,
                replayPlayback, resultRevealsAt, roundReadyAt, seriesComplete, mode, baseClockSeconds,
                incrementSeconds, Set.of(), List.of());
    }

    /** Fixture constructor: a 1v1 on the default clock. */
    public MatchSession(
            UUID matchId,
            long simulationSeed,
            List<MatchPlayer> players,
            Instant loadoutSelectionEndsAt,
            Instant entityPlacementEndsAt,
            Instant countdownEndsAt,
            Instant buildingEndsAt,
            int roundNumber,
            List<MatchPlaybackDTO.ArenaEntityDTO> arenaEntities,
            Map<UUID, List<MatchPlaybackDTO.ArenaEntityDTO>> entityPlacementsByUserId) {
        this(matchId, simulationSeed, players, loadoutSelectionEndsAt, entityPlacementEndsAt, countdownEndsAt,
                buildingEndsAt, roundNumber, arenaEntities, entityPlacementsByUserId, null, null, null, null,
                false, MatchMode.ONES, MatchTimingPolicy.ONES_BASE_CLOCK_SECONDS,
                MatchTimingPolicy.DEFAULT_INCREMENT_SECONDS);
    }

    public MatchMode mode() {
        return mode == null ? MatchMode.ONES : mode;
    }

    public MatchSession withArenaEntities(List<MatchPlaybackDTO.ArenaEntityDTO> nextArenaEntities) {
        return copy(
                players,
                loadoutSelectionEndsAt,
                entityPlacementEndsAt,
                countdownEndsAt,
                buildingEndsAt,
                nextArenaEntities != null ? List.copyOf(nextArenaEntities) : List.of(),
                entityPlacementsByUserId,
                playbackStartsAt,
                replayPlayback,
                resultRevealsAt,
                roundReadyAt,
                seriesComplete);
    }

    /**
     * Marks a player's build as over. Their clock is the time left when they submitted, so the time
     * spent building comes off it; a player whose clock ran out ({@code submittedAt} at or after their
     * deadline) is left at zero. Without a recorded build start nothing is deducted.
     */
    public MatchSession withFinishedPlayer(UUID userId, UUID botSubmissionId, Instant submittedAt) {
        return copy(
                players.stream()
                        .map(player -> player.userId().equals(userId)
                                ? finish(player, botSubmissionId, submittedAt)
                                : player)
                        .toList(),
                loadoutSelectionEndsAt,
                entityPlacementEndsAt,
                countdownEndsAt,
                buildingEndsAt,
                arenaEntities,
                entityPlacementsByUserId,
                playbackStartsAt,
                replayPlayback,
                resultRevealsAt,
                roundReadyAt,
                seriesComplete);
    }

    /** Marks a player finished with no clock deduction, for fixtures and non-building paths. */
    public MatchSession withFinishedPlayer(UUID userId, UUID botSubmissionId) {
        return withFinishedPlayer(userId, botSubmissionId, null);
    }

    private MatchPlayer finish(MatchPlayer player, UUID botSubmissionId, Instant submittedAt) {
        long remainingMs = player.clockRemainingMs();
        if (submittedAt != null && countdownEndsAt != null) {
            long spentMs = Math.max(0, java.time.Duration.between(countdownEndsAt, submittedAt).toMillis());
            remainingMs = Math.max(0, remainingMs - spentMs);
        }
        return new MatchPlayer(
                player.userId(),
                player.username(),
                player.principalName(),
                player.slot(),
                player.teamNumber(),
                true,
                botSubmissionId,
                player.roundWins(),
                player.selectedLoadout(),
                player.loadoutSelected(),
                remainingMs,
                player.timeoutFallback(),
                null);
    }

    /** Records a player's choice of what to do when their clock runs out. */
    public MatchSession withTimeoutFallback(UUID userId, String timeoutFallback) {
        return copy(
                players.stream()
                        .map(player -> player.userId().equals(userId)
                                ? player.withTimeoutFallback(timeoutFallback)
                                : player)
                        .toList(),
                loadoutSelectionEndsAt,
                entityPlacementEndsAt,
                countdownEndsAt,
                buildingEndsAt,
                arenaEntities,
                entityPlacementsByUserId,
                playbackStartsAt,
                replayPlayback,
                resultRevealsAt,
                roundReadyAt,
                seriesComplete);
    }

    /**
     * Starts the next round's pick phase. Clocks carry over untouched (they only move during a build);
     * the segment end state stays so a reconnecting client can see the frozen position.
     */
    public MatchSession nextRound() {
        return new MatchSession(
                matchId,
                simulationSeed,
                players.stream()
                        .map(player -> new MatchPlayer(
                                player.userId(),
                                player.username(),
                                player.principalName(),
                                player.slot(),
                                player.teamNumber(),
                                false,
                                null,
                                player.roundWins(),
                                player.selectedLoadout(),
                                false,
                                player.clockRemainingMs(),
                                player.timeoutFallback(),
                                null))
                        .toList(),
                null,
                null,
                null,
                null,
                roundNumber + 1,
                List.of(),
                Map.of(),
                null,
                null,
                null,
                null,
                false,
                mode(),
                baseClockSeconds(),
                incrementSeconds(),
                surrenderVotes(),
                segmentEndState());
    }

    public MatchSession withLoadoutSelection(Instant deadline) {
        List<MatchPlayer> unlockedPlayers = players.stream()
                .map(player -> new MatchPlayer(
                        player.userId(),
                        player.username(),
                        player.principalName(),
                        player.slot(),
                        player.teamNumber(),
                        player.finished(),
                        player.botSubmissionId(),
                        player.roundWins(),
                        player.selectedLoadout(),
                        false,
                        player.clockRemainingMs(),
                        player.timeoutFallback(),
                        player.buildEndsAt()))
                .toList();
        return copy(
                unlockedPlayers,
                deadline,
                null,
                null,
                null,
                List.of(),
                Map.of(),
                null,
                null,
                null,
                null,
                false);
    }

    public MatchSession withSelectedLoadout(UUID userId, String selectedLoadout, boolean selected) {
        return copy(
                players.stream()
                        .map(player -> player.userId().equals(userId)
                                ? new MatchPlayer(
                                        player.userId(),
                                        player.username(),
                                        player.principalName(),
                                        player.slot(),
                                        player.teamNumber(),
                                        player.finished(),
                                        player.botSubmissionId(),
                                        player.roundWins(),
                                        selectedLoadout,
                                        selected,
                                        player.clockRemainingMs(),
                                        player.timeoutFallback(),
                                        player.buildEndsAt())
                                : player)
                        .toList(),
                loadoutSelectionEndsAt,
                entityPlacementEndsAt,
                countdownEndsAt,
                buildingEndsAt,
                arenaEntities,
                entityPlacementsByUserId,
                playbackStartsAt,
                replayPlayback,
                resultRevealsAt,
                roundReadyAt,
                seriesComplete);
    }

    /** Toggles one authenticated player's match-wide surrender vote. */
    public MatchSession withSurrenderVote(UUID userId, boolean requested) {
        if (userId == null) return this;
        Set<UUID> nextVotes = new HashSet<>(surrenderVotes());
        if (requested) {
            nextVotes.add(userId);
        } else {
            nextVotes.remove(userId);
        }
        return new MatchSession(
                matchId,
                simulationSeed,
                players,
                loadoutSelectionEndsAt,
                entityPlacementEndsAt,
                countdownEndsAt,
                buildingEndsAt,
                roundNumber,
                arenaEntities,
                entityPlacementsByUserId,
                playbackStartsAt,
                replayPlayback,
                resultRevealsAt,
                roundReadyAt,
                seriesComplete,
                mode(),
                baseClockSeconds(),
                incrementSeconds(),
                nextVotes,
                segmentEndState());
    }

    public MatchSession withDefaultLoadoutSelections() {
        return copy(
                players.stream()
                        .map(player -> new MatchPlayer(
                                player.userId(),
                                player.username(),
                                player.principalName(),
                                player.slot(),
                                player.teamNumber(),
                                player.finished(),
                                player.botSubmissionId(),
                                player.roundWins(),
                                player.selectedLoadout() != null ? player.selectedLoadout() : "custom:",
                                true,
                                player.clockRemainingMs(),
                                player.timeoutFallback(),
                                player.buildEndsAt()))
                        .toList(),
                loadoutSelectionEndsAt,
                entityPlacementEndsAt,
                countdownEndsAt,
                buildingEndsAt,
                arenaEntities,
                entityPlacementsByUserId,
                playbackStartsAt,
                replayPlayback,
                resultRevealsAt,
                roundReadyAt,
                seriesComplete);
    }

    public MatchSession withEntityPlacement(Instant nextEntityPlacementEndsAt) {
        return copy(
                players,
                loadoutSelectionEndsAt,
                nextEntityPlacementEndsAt,
                null,
                null,
                List.of(),
                Map.of(),
                null,
                null,
                null,
                null,
                false);
    }

    public MatchSession withEntityPlacements(
            UUID userId,
            List<MatchPlaybackDTO.ArenaEntityDTO> objects) {
        Map<UUID, List<MatchPlaybackDTO.ArenaEntityDTO>> placements =
                new HashMap<>(entityPlacementsByUserId);
        placements.put(userId, List.copyOf(objects != null ? objects : List.of()));
        return copy(
                players,
                loadoutSelectionEndsAt,
                entityPlacementEndsAt,
                countdownEndsAt,
                buildingEndsAt,
                arenaEntities,
                Map.copyOf(placements),
                playbackStartsAt,
                replayPlayback,
                resultRevealsAt,
                roundReadyAt,
                seriesComplete);
    }

    /**
     * Starts the build. Every player's clock gains the increment, then runs from {@code
     * nextCountdownEndsAt}: a player's own deadline is that instant plus their clock, and the session's
     * {@code buildingEndsAt} is the latest instant any player's build can still be accepted (their
     * deadline plus the submission grace, unless they resubmit last round's brain at the deadline).
     */
    public MatchSession withCountdown(Instant nextCountdownEndsAt) {
        long incrementMs = incrementSeconds() * 1_000L;
        List<MatchPlayer> clockedPlayers = players.stream()
                .map(player -> {
                    long clockMs = player.clockRemainingMs() + incrementMs;
                    return new MatchPlayer(
                            player.userId(),
                            player.username(),
                            player.principalName(),
                            player.slot(),
                            player.teamNumber(),
                            player.finished(),
                            player.botSubmissionId(),
                            player.roundWins(),
                            player.selectedLoadout() != null ? player.selectedLoadout() : "melee",
                            true,
                            clockMs,
                            player.timeoutFallback(),
                            nextCountdownEndsAt.plusMillis(clockMs));
                })
                .toList();
        Instant latestExpiry = clockedPlayers.stream()
                .map(MatchPlayer::buildExpiresAt)
                .max(Instant::compareTo)
                .orElse(nextCountdownEndsAt);
        Instant nextBuildingEndsAt = latestExpiry;
        return copy(
                clockedPlayers,
                loadoutSelectionEndsAt,
                null,
                nextCountdownEndsAt,
                nextBuildingEndsAt,
                arenaEntities,
                entityPlacementsByUserId,
                null,
                null,
                null,
                null,
                false);
    }

    public MatchSession withReplay(
            MatchReplayDTO nextReplayPlayback,
            Instant nextPlaybackStartsAt,
            Instant nextResultRevealsAt,
            Instant nextRoundReadyAt,
            boolean nextSeriesComplete) {
        return copy(
                players,
                null,
                null,
                null,
                null,
                arenaEntities,
                entityPlacementsByUserId,
                nextPlaybackStartsAt,
                nextReplayPlayback,
                nextResultRevealsAt,
                nextRoundReadyAt,
                nextSeriesComplete);
    }

    public MatchSession withSegmentEndState(List<MatchReplayDTO.ReplayBotDTO> nextSegmentEndState) {
        return new MatchSession(
                matchId,
                simulationSeed,
                players,
                loadoutSelectionEndsAt,
                entityPlacementEndsAt,
                countdownEndsAt,
                buildingEndsAt,
                roundNumber,
                arenaEntities,
                entityPlacementsByUserId,
                playbackStartsAt,
                replayPlayback,
                resultRevealsAt,
                roundReadyAt,
                seriesComplete,
                mode(),
                baseClockSeconds(),
                incrementSeconds(),
                surrenderVotes(),
                nextSegmentEndState);
    }

    public MatchSession withoutReplay() {
        return copy(
                players,
                loadoutSelectionEndsAt,
                entityPlacementEndsAt,
                countdownEndsAt,
                buildingEndsAt,
                arenaEntities,
                entityPlacementsByUserId,
                null,
                null,
                null,
                null,
                false);
    }

    public boolean isReplay() {
        return playbackStartsAt != null;
    }

    private MatchSession copy(
            List<MatchPlayer> nextPlayers,
            Instant nextLoadoutSelectionEndsAt,
            Instant nextEntityPlacementEndsAt,
            Instant nextCountdownEndsAt,
            Instant nextBuildingEndsAt,
            List<MatchPlaybackDTO.ArenaEntityDTO> nextArenaEntities,
            Map<UUID, List<MatchPlaybackDTO.ArenaEntityDTO>> nextEntityPlacementsByUserId,
            Instant nextPlaybackStartsAt,
            MatchReplayDTO nextReplayPlayback,
            Instant nextResultRevealsAt,
            Instant nextRoundReadyAt,
            boolean nextSeriesComplete) {
        return new MatchSession(
                matchId,
                simulationSeed,
                nextPlayers,
                nextLoadoutSelectionEndsAt,
                nextEntityPlacementEndsAt,
                nextCountdownEndsAt,
                nextBuildingEndsAt,
                roundNumber,
                nextArenaEntities,
                nextEntityPlacementsByUserId,
                nextPlaybackStartsAt,
                nextReplayPlayback,
                nextResultRevealsAt,
                nextRoundReadyAt,
                nextSeriesComplete,
                mode(),
                baseClockSeconds(),
                incrementSeconds(),
                surrenderVotes(),
                segmentEndState());
    }
}
