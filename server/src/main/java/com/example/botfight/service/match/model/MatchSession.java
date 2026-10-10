package com.example.botfight.service.match.model;

import java.time.Duration;
import com.example.botfight.service.match.state.MatchPhase;

import com.example.botfight.service.simulation.WorkerReplay.EndBotState;
import com.example.botfight.DTO.match.MatchReplayDTO;
import com.example.botfight.domain.match.MatchMode;
import com.example.botfight.service.match.MatchTimingPolicy;
import java.time.Instant;
import java.util.HashSet;
import java.util.List;
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
        Instant countdownEndsAt,
        Instant buildingEndsAt,
        int roundNumber,
        Instant playbackStartsAt,
        MatchReplayDTO replayPlayback,
        Instant resultRevealsAt,
        Instant roundReadyAt,
        boolean ended,
        MatchMode mode,
        int baseClockSeconds,
        int incrementSeconds,
        Set<UUID> surrenderVotes,
        List<EndBotState> segmentEndState,
        MatchPhase phase) {
    public MatchSession {
        java.util.Objects.requireNonNull(phase, "phase");
        mode = mode == null ? MatchMode.ONES : mode;
        baseClockSeconds = MatchTimingPolicy.resolveBaseClockSeconds(mode, baseClockSeconds);
        incrementSeconds = Math.max(
                MatchTimingPolicy.MIN_CUSTOM_INCREMENT_SECONDS,
                Math.min(MatchTimingPolicy.MAX_CUSTOM_INCREMENT_SECONDS, incrementSeconds));
        surrenderVotes = surrenderVotes == null ? Set.of() : Set.copyOf(surrenderVotes);
        segmentEndState = segmentEndState == null ? List.of() : List.copyOf(segmentEndState);
    }

    public MatchMode mode() {
        return mode == null ? MatchMode.ONES : mode;
    }

    /**
     * Marks a player's build as over. Their clock is the time left when they submitted, so the time
     * spent building comes off it; a player whose clock ran out ({@code submittedAt} at or after their
     * deadline) is left at zero. Without a recorded build start nothing is deducted.
     */
    public MatchSession withFinishedPlayer(UUID userId, UUID botSubmissionId, Instant submittedAt) {
        List<MatchPlayer> nextPlayers = players.stream()
                .map(player -> player.userId().equals(userId) ? finish(player, botSubmissionId, submittedAt) : player)
                .toList();
        Builder next = nextPlayers.stream().allMatch(MatchPlayer::finished)
                ? transition(MatchPhase.SIMULATION_LOADING) : toBuilder();
        return next.players(nextPlayers).build();
    }

    /** Marks a player finished with no clock deduction, for fixtures and non-building paths. */
    public MatchSession withFinishedPlayer(UUID userId, UUID botSubmissionId) {
        return withFinishedPlayer(userId, botSubmissionId, null);
    }

    private MatchPlayer finish(MatchPlayer player, UUID botSubmissionId, Instant submittedAt) {
        long remainingMs = player.clockRemainingMs();
        if (submittedAt != null && countdownEndsAt != null) {
            long spentMs = Math.max(0, Duration.between(countdownEndsAt, submittedAt).toMillis());
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
        return toBuilder()
                .players(players.stream()
                        .map(player -> player.userId().equals(userId)
                                ? player.withTimeoutFallback(timeoutFallback)
                                : player)
                        .toList()).build();
    }

    /**
     * Starts the next round's pick phase. Clocks carry over untouched (they only move during a build);
     * the segment end state stays so a reconnecting client can see the frozen position.
     */
    public MatchSession nextRound() {
        return transition(MatchPhase.LOADOUT_SELECT)
                .players(players.stream()
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
                        .toList())
                .loadoutSelectionEndsAt(null)
                .countdownEndsAt(null)
                .buildingEndsAt(null)
                .roundNumber(roundNumber + 1)
                .playbackStartsAt(null)
                .replayPlayback(null)
                .resultRevealsAt(null)
                .roundReadyAt(null)
                .ended(false).build();
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
        return transition(MatchPhase.LOADOUT_SELECT)
                .players(unlockedPlayers)
                .loadoutSelectionEndsAt(deadline)
                .countdownEndsAt(null)
                .buildingEndsAt(null)
                .playbackStartsAt(null)
                .replayPlayback(null)
                .resultRevealsAt(null)
                .roundReadyAt(null)
                .ended(false).build();
    }

    public MatchSession withSelectedLoadout(UUID userId, String selectedLoadout, boolean selected) {
        return toBuilder()
                .players(players.stream()
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
                        .toList()).build();
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
        return toBuilder()
                .surrenderVotes(nextVotes).build();
    }

    public MatchSession withDefaultLoadoutSelections() {
        return toBuilder()
                .players(players.stream()
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
                        .toList()).build();
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
        return transition(MatchPhase.BUILDING)
                .players(clockedPlayers)
                .countdownEndsAt(nextCountdownEndsAt)
                .buildingEndsAt(nextBuildingEndsAt)
                .playbackStartsAt(null)
                .replayPlayback(null)
                .resultRevealsAt(null)
                .roundReadyAt(null)
                .ended(false).build();
    }

    public MatchSession withReplay(
            MatchReplayDTO nextReplayPlayback,
            Instant nextPlaybackStartsAt,
            Instant nextResultRevealsAt,
            Instant nextRoundReadyAt,
            boolean nextEnded) {
        return transition(MatchPhase.REPLAY)
                .loadoutSelectionEndsAt(null)
                .countdownEndsAt(null)
                .buildingEndsAt(null)
                .playbackStartsAt(nextPlaybackStartsAt)
                .replayPlayback(nextReplayPlayback)
                .resultRevealsAt(nextResultRevealsAt)
                .roundReadyAt(nextRoundReadyAt)
                .ended(nextEnded).build();
    }

    public MatchSession withSegmentEndState(List<EndBotState> nextSegmentEndState) {
        return toBuilder()
                .segmentEndState(nextSegmentEndState).build();
    }

    public MatchSession withoutReplay() {
        return toBuilder()
                .playbackStartsAt(null)
                .replayPlayback(null)
                .resultRevealsAt(null)
                .roundReadyAt(null)
                .ended(false).build();
    }

    public boolean isReplay() {
        return phase == MatchPhase.REPLAY || phase == MatchPhase.RESULT_READY;
    }

    private Builder transition(MatchPhase target) {
        phase.checkTransitionTo(target);
        return toBuilder().phase(target);
    }

    public MatchSession simulating() { return transition(MatchPhase.SIMULATING).build(); }
    public MatchSession simulationFailed() { return transition(MatchPhase.SIMULATION_LOADING).build(); }
    public MatchSession resultReady() { return transition(MatchPhase.RESULT_READY).build(); }

    public Builder toBuilder() {
        return new Builder()
                .matchId(matchId)
                .simulationSeed(simulationSeed)
                .players(players)
                .loadoutSelectionEndsAt(loadoutSelectionEndsAt)
                .countdownEndsAt(countdownEndsAt)
                .buildingEndsAt(buildingEndsAt)
                .roundNumber(roundNumber)
                .playbackStartsAt(playbackStartsAt)
                .replayPlayback(replayPlayback)
                .resultRevealsAt(resultRevealsAt)
                .roundReadyAt(roundReadyAt)
                .ended(ended)
                .mode(mode)
                .baseClockSeconds(baseClockSeconds)
                .incrementSeconds(incrementSeconds)
                .surrenderVotes(surrenderVotes)
                .segmentEndState(segmentEndState)
                .phase(phase);
    }

    public static final class Builder {
        private UUID matchId;
        private long simulationSeed;
        private List<MatchPlayer> players;
        private Instant loadoutSelectionEndsAt;
        private Instant countdownEndsAt;
        private Instant buildingEndsAt;
        private int roundNumber;
        private Instant playbackStartsAt;
        private MatchReplayDTO replayPlayback;
        private Instant resultRevealsAt;
        private Instant roundReadyAt;
        private boolean ended;
        private MatchMode mode;
        private int baseClockSeconds;
        private int incrementSeconds;
        private Set<UUID> surrenderVotes;
        private List<EndBotState> segmentEndState;
        private MatchPhase phase;

        public Builder matchId(UUID value) { matchId = value; return this; }
        public Builder simulationSeed(long value) { simulationSeed = value; return this; }
        public Builder players(List<MatchPlayer> value) { players = value; return this; }
        public Builder loadoutSelectionEndsAt(Instant value) { loadoutSelectionEndsAt = value; return this; }
        public Builder countdownEndsAt(Instant value) { countdownEndsAt = value; return this; }
        public Builder buildingEndsAt(Instant value) { buildingEndsAt = value; return this; }
        public Builder roundNumber(int value) { roundNumber = value; return this; }
        public Builder playbackStartsAt(Instant value) { playbackStartsAt = value; return this; }
        public Builder replayPlayback(MatchReplayDTO value) { replayPlayback = value; return this; }
        public Builder resultRevealsAt(Instant value) { resultRevealsAt = value; return this; }
        public Builder roundReadyAt(Instant value) { roundReadyAt = value; return this; }
        public Builder ended(boolean value) { ended = value; return this; }
        public Builder mode(MatchMode value) { mode = value; return this; }
        public Builder baseClockSeconds(int value) { baseClockSeconds = value; return this; }
        public Builder incrementSeconds(int value) { incrementSeconds = value; return this; }
        public Builder surrenderVotes(Set<UUID> value) { surrenderVotes = value; return this; }
        public Builder segmentEndState(List<EndBotState> value) { segmentEndState = value; return this; }
        private Builder phase(MatchPhase value) { phase = value; return this; }

        public MatchSession build() {
            return new MatchSession(
                    matchId,
                    simulationSeed,
                    players,
                    loadoutSelectionEndsAt,
                    countdownEndsAt,
                    buildingEndsAt,
                    roundNumber,
                    playbackStartsAt,
                    replayPlayback,
                    resultRevealsAt,
                    roundReadyAt,
                    ended,
                    mode,
                    baseClockSeconds,
                    incrementSeconds,
                    surrenderVotes,
                    segmentEndState,
                    phase);
        }
    }
}
