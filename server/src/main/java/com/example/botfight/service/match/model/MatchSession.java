package com.example.botfight.service.match.model;

import com.example.botfight.DTO.MatchPlaybackDTO;
import com.example.botfight.DTO.MatchReplayDTO;
import com.example.botfight.domain.MatchMode;
import com.example.botfight.service.match.timing.MatchTimingPolicy;
import java.time.Instant;
import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;

public record MatchSession(
        UUID matchId,
        long simulationSeed,
        List<MatchPlayer> players,
        Instant loadoutSelectionEndsAt,
        Instant entityPlacementEndsAt,
        Instant countdownEndsAt,
        Instant buildingEndsAt,
        int roundNumber,
        int winsRequired,
        List<MatchPlaybackDTO.ArenaEntityDTO> arenaEntities,
        Map<UUID, List<MatchPlaybackDTO.ArenaEntityDTO>> entityPlacementsByUserId,
        Instant playbackStartsAt,
        MatchReplayDTO replayPlayback,
        Instant resultRevealsAt,
        Instant roundReadyAt,
        boolean seriesComplete,
        MatchMode mode,
        int roundDurationSeconds,
        Set<UUID> surrenderVotes,
        Map<UUID, Map<Integer, Integer>> guaranteedAbilitiesByUserId) {
    public MatchSession {
        mode = mode == null ? MatchMode.ONES : mode;
        roundDurationSeconds = MatchTimingPolicy.resolveRoundDurationSeconds(
                mode, roundDurationSeconds);
        surrenderVotes = surrenderVotes == null ? Set.of() : Set.copyOf(surrenderVotes);
        Map<UUID, Map<Integer, Integer>> normalizedGuarantees = new HashMap<>();
        if (guaranteedAbilitiesByUserId != null) {
            guaranteedAbilitiesByUserId.forEach((userId, abilities) -> {
                if (userId == null || abilities == null) return;
                Map<Integer, Integer> normalizedAbilities = new HashMap<>();
                abilities.forEach((round, abilityId) -> {
                    if (round != null && abilityId != null) {
                        normalizedAbilities.put(round, abilityId);
                    }
                });
                normalizedGuarantees.put(userId, Map.copyOf(normalizedAbilities));
            });
        }
        guaranteedAbilitiesByUserId = Map.copyOf(normalizedGuarantees);
    }

    /** Backward-compatible full constructor with a mode and no surrender votes. */
    public MatchSession(
            UUID matchId,
            long simulationSeed,
            List<MatchPlayer> players,
            Instant loadoutSelectionEndsAt,
            Instant entityPlacementEndsAt,
            Instant countdownEndsAt,
            Instant buildingEndsAt,
            int roundNumber,
            int winsRequired,
            List<MatchPlaybackDTO.ArenaEntityDTO> arenaEntities,
            Map<UUID, List<MatchPlaybackDTO.ArenaEntityDTO>> entityPlacementsByUserId,
            Instant playbackStartsAt,
            MatchReplayDTO replayPlayback,
            Instant resultRevealsAt,
            Instant roundReadyAt,
            boolean seriesComplete,
            MatchMode mode) {
        this(
                matchId,
                simulationSeed,
                players,
                loadoutSelectionEndsAt,
                entityPlacementEndsAt,
                countdownEndsAt,
                buildingEndsAt,
                roundNumber,
                winsRequired,
                arenaEntities,
                entityPlacementsByUserId,
                playbackStartsAt,
                replayPlayback,
                resultRevealsAt,
                roundReadyAt,
                seriesComplete,
                mode,
                MatchTimingPolicy.defaultRoundDurationSeconds(mode),
                Set.of(),
                Map.of());
    }

    /** Compatibility constructor for callers that also provide surrender votes. */
    public MatchSession(
            UUID matchId,
            long simulationSeed,
            List<MatchPlayer> players,
            Instant loadoutSelectionEndsAt,
            Instant entityPlacementEndsAt,
            Instant countdownEndsAt,
            Instant buildingEndsAt,
            int roundNumber,
            int winsRequired,
            List<MatchPlaybackDTO.ArenaEntityDTO> arenaEntities,
            Map<UUID, List<MatchPlaybackDTO.ArenaEntityDTO>> entityPlacementsByUserId,
            Instant playbackStartsAt,
            MatchReplayDTO replayPlayback,
            Instant resultRevealsAt,
            Instant roundReadyAt,
            boolean seriesComplete,
            MatchMode mode,
            Set<UUID> surrenderVotes) {
        this(
                matchId,
                simulationSeed,
                players,
                loadoutSelectionEndsAt,
                entityPlacementEndsAt,
                countdownEndsAt,
                buildingEndsAt,
                roundNumber,
                winsRequired,
                arenaEntities,
                entityPlacementsByUserId,
                playbackStartsAt,
                replayPlayback,
                resultRevealsAt,
                roundReadyAt,
                seriesComplete,
                mode,
                MatchTimingPolicy.defaultRoundDurationSeconds(mode),
                surrenderVotes,
                Map.of());
    }

    /** Full constructor for a match with an explicit round duration. */
    public MatchSession(
            UUID matchId,
            long simulationSeed,
            List<MatchPlayer> players,
            Instant loadoutSelectionEndsAt,
            Instant entityPlacementEndsAt,
            Instant countdownEndsAt,
            Instant buildingEndsAt,
            int roundNumber,
            int winsRequired,
            List<MatchPlaybackDTO.ArenaEntityDTO> arenaEntities,
            Map<UUID, List<MatchPlaybackDTO.ArenaEntityDTO>> entityPlacementsByUserId,
            Instant playbackStartsAt,
            MatchReplayDTO replayPlayback,
            Instant resultRevealsAt,
            Instant roundReadyAt,
            boolean seriesComplete,
            MatchMode mode,
            int roundDurationSeconds) {
        this(
                matchId,
                simulationSeed,
                players,
                loadoutSelectionEndsAt,
                entityPlacementEndsAt,
                countdownEndsAt,
                buildingEndsAt,
                roundNumber,
                winsRequired,
                arenaEntities,
                entityPlacementsByUserId,
                playbackStartsAt,
                replayPlayback,
                resultRevealsAt,
                roundReadyAt,
                seriesComplete,
                mode,
                roundDurationSeconds,
                Set.of(),
                Map.of());
    }

    public MatchSession(
            UUID matchId,
            long simulationSeed,
            List<MatchPlayer> players,
            Instant loadoutSelectionEndsAt,
            Instant entityPlacementEndsAt,
            Instant countdownEndsAt,
            Instant buildingEndsAt,
            int roundNumber,
            int winsRequired,
            List<MatchPlaybackDTO.ArenaEntityDTO> arenaEntities,
            Map<UUID, List<MatchPlaybackDTO.ArenaEntityDTO>> entityPlacementsByUserId,
            Instant playbackStartsAt,
            MatchReplayDTO replayPlayback,
            Instant resultRevealsAt,
            Instant roundReadyAt,
            boolean seriesComplete,
            MatchMode mode,
            int roundDurationSeconds,
            Set<UUID> surrenderVotes) {
        this(
                matchId,
                simulationSeed,
                players,
                loadoutSelectionEndsAt,
                entityPlacementEndsAt,
                countdownEndsAt,
                buildingEndsAt,
                roundNumber,
                winsRequired,
                arenaEntities,
                entityPlacementsByUserId,
                playbackStartsAt,
                replayPlayback,
                resultRevealsAt,
                roundReadyAt,
                seriesComplete,
                mode,
                roundDurationSeconds,
                surrenderVotes,
                Map.of());
    }

    /** Backward-compatible full constructor for existing 1v1 fixtures. */
    public MatchSession(
            UUID matchId,
            long simulationSeed,
            List<MatchPlayer> players,
            Instant loadoutSelectionEndsAt,
            Instant entityPlacementEndsAt,
            Instant countdownEndsAt,
            Instant buildingEndsAt,
            int roundNumber,
            int winsRequired,
            List<MatchPlaybackDTO.ArenaEntityDTO> arenaEntities,
            Map<UUID, List<MatchPlaybackDTO.ArenaEntityDTO>> entityPlacementsByUserId,
            Instant playbackStartsAt,
            MatchReplayDTO replayPlayback,
            Instant resultRevealsAt,
            Instant roundReadyAt,
            boolean seriesComplete) {
        this(
                matchId,
                simulationSeed,
                players,
                loadoutSelectionEndsAt,
                entityPlacementEndsAt,
                countdownEndsAt,
                buildingEndsAt,
                roundNumber,
                winsRequired,
                arenaEntities,
                entityPlacementsByUserId,
                playbackStartsAt,
                replayPlayback,
                resultRevealsAt,
                roundReadyAt,
                seriesComplete,
                MatchMode.ONES,
                MatchTimingPolicy.ONES_ROUND_SECONDS,
                Set.of(),
                Map.of());
    }

    public MatchMode mode() {
        return mode == null ? MatchMode.ONES : mode;
    }

    public Map<Integer, Integer> guaranteedAbilitiesFor(UUID userId) {
        if (userId == null) return Map.of();
        return guaranteedAbilitiesByUserId.getOrDefault(userId, Map.of());
    }

    public MatchSession(
            UUID matchId,
            long simulationSeed,
            List<MatchPlayer> players,
            Instant loadoutSelectionEndsAt,
            Instant entityPlacementEndsAt,
            Instant countdownEndsAt,
            Instant buildingEndsAt,
            int roundNumber,
            int winsRequired,
            List<MatchPlaybackDTO.ArenaEntityDTO> arenaEntities,
            Map<UUID, List<MatchPlaybackDTO.ArenaEntityDTO>> entityPlacementsByUserId) {
        this(
                matchId,
                simulationSeed,
                players,
                loadoutSelectionEndsAt,
                entityPlacementEndsAt,
                countdownEndsAt,
                buildingEndsAt,
                roundNumber,
                winsRequired,
                arenaEntities,
                entityPlacementsByUserId,
                null,
                null,
                null,
                null,
                false,
                MatchMode.ONES,
                MatchTimingPolicy.ONES_ROUND_SECONDS,
                Set.of(),
                Map.of());
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

    public MatchSession withFinishedPlayer(UUID userId, UUID botSubmissionId) {
        return copy(
                players.stream()
                        .map(player -> player.userId().equals(userId)
                                ? new MatchPlayer(
                                        player.userId(),
                                        player.username(),
                                        player.principalName(),
                                        player.slot(),
                                        player.teamNumber(),
                                        true,
                                        botSubmissionId,
                                        player.roundWins(),
                                        player.selectedLoadout(),
                                        player.loadoutSelected())
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

    public MatchSession withRoundResult(UUID winnerUserId) {
        int winningTeam = players.stream()
                .filter(player -> player.userId().equals(winnerUserId))
                .map(MatchPlayer::teamNumber)
                .findFirst()
                .orElse(0);
        return copy(
                players.stream()
                        .map(player -> winningTeam > 0 && player.teamNumber() == winningTeam
                                ? new MatchPlayer(
                                        player.userId(),
                                        player.username(),
                                        player.principalName(),
                                        player.slot(),
                                        player.teamNumber(),
                                        player.finished(),
                                        player.botSubmissionId(),
                                        player.roundWins() + 1,
                                        player.selectedLoadout(),
                                        player.loadoutSelected())
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
                                false))
                        .toList(),
                null,
                null,
                null,
                null,
                roundNumber + 1,
                winsRequired,
                List.of(),
                Map.of(),
                null,
                null,
                null,
                null,
                false,
                mode(),
                roundDurationSeconds(),
                surrenderVotes(),
                guaranteedAbilitiesByUserId);
    }

    public MatchSession withGuaranteedAbilities(UUID userId, Map<Integer, Integer> guarantees) {
        if (userId == null) return this;
        Map<UUID, Map<Integer, Integer>> nextGuarantees = new HashMap<>(guaranteedAbilitiesByUserId);
        nextGuarantees.put(userId, guarantees == null ? Map.of() : Map.copyOf(guarantees));
        return copy(
                players,
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
                seriesComplete,
                nextGuarantees);
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
                        false))
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
                false,
                guaranteedAbilitiesByUserId);
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
                                        selected)
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
                winsRequired,
                arenaEntities,
                entityPlacementsByUserId,
                playbackStartsAt,
                replayPlayback,
                resultRevealsAt,
                roundReadyAt,
                seriesComplete,
                mode(),
                roundDurationSeconds(),
                nextVotes,
                guaranteedAbilitiesByUserId);
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
                                true))
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

    public MatchSession withCountdown(Instant nextCountdownEndsAt, Instant nextBuildingEndsAt) {
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
                                player.selectedLoadout() != null ? player.selectedLoadout() : "melee",
                                true))
                        .toList(),
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
        return copy(
                nextPlayers,
                nextLoadoutSelectionEndsAt,
                nextEntityPlacementEndsAt,
                nextCountdownEndsAt,
                nextBuildingEndsAt,
                nextArenaEntities,
                nextEntityPlacementsByUserId,
                nextPlaybackStartsAt,
                nextReplayPlayback,
                nextResultRevealsAt,
                nextRoundReadyAt,
                nextSeriesComplete,
                guaranteedAbilitiesByUserId);
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
            boolean nextSeriesComplete,
            Map<UUID, Map<Integer, Integer>> nextGuaranteedAbilitiesByUserId) {
        return new MatchSession(
                matchId,
                simulationSeed,
                nextPlayers,
                nextLoadoutSelectionEndsAt,
                nextEntityPlacementEndsAt,
                nextCountdownEndsAt,
                nextBuildingEndsAt,
                roundNumber,
                winsRequired,
                nextArenaEntities,
                nextEntityPlacementsByUserId,
                nextPlaybackStartsAt,
                nextReplayPlayback,
                nextResultRevealsAt,
                nextRoundReadyAt,
                nextSeriesComplete,
                mode(),
                roundDurationSeconds(),
                surrenderVotes(),
                nextGuaranteedAbilitiesByUserId);
    }
}
