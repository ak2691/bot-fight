package com.example.botfight.service.match.model;

import com.example.botfight.DTO.MatchPlaybackDTO;
import com.example.botfight.DTO.MatchReplayDTO;
import java.time.Instant;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
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
        boolean seriesComplete) {
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
                false);
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
        return copy(
                players.stream()
                        .map(player -> player.userId().equals(winnerUserId)
                                ? new MatchPlayer(
                                        player.userId(),
                                        player.username(),
                                        player.principalName(),
                                        player.slot(),
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
                false);
    }

    public MatchSession withLoadoutSelection(Instant deadline) {
        List<MatchPlayer> unlockedPlayers = players.stream()
                .map(player -> new MatchPlayer(
                        player.userId(),
                        player.username(),
                        player.principalName(),
                        player.slot(),
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

    public MatchSession withDefaultLoadoutSelections() {
        return copy(
                players.stream()
                        .map(player -> new MatchPlayer(
                                player.userId(),
                                player.username(),
                                player.principalName(),
                                player.slot(),
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
                nextSeriesComplete);
    }
}
