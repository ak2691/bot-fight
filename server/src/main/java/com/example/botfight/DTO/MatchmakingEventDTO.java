package com.example.botfight.DTO;

import java.time.Instant;
import java.util.List;
import java.util.UUID;
import tools.jackson.databind.JsonNode;

public record MatchmakingEventDTO(
        String type,
        UUID matchId,
        Long simulationSeed,
        String status,
        MatchmakingPlayerDTO player,
        MatchmakingPlayerDTO opponent,
        List<MatchmakingPlayerDTO> players,
        Instant serverNow,
        Instant classSelectionEndsAt,
        Instant objectPlacementEndsAt,
        Instant countdownEndsAt,
        Instant trainingEndsAt,
        Instant playbackStartsAt,
        Instant resultRevealsAt,
        String rulesetVersion,
        MatchPlaybackDTO playback,
        Integer roundNumber,
        Integer winsRequired,
        String message,
        UUID objectPlacementUserId,
        List<MatchPlaybackDTO.ObstaclePlacementDTO> objectPlacements,
        List<MatchPlaybackDTO.ObstaclePlacementDTO> obstacles,
        List<RoundBrainDTO> roundBrains,
        Boolean previousRoundWon,
        List<String> abilityOffers,
        Integer roundBlockLimit,
        UUID disconnectedUserId,
        Instant disconnectEndsAt) {

    public MatchmakingEventDTO(
            String type,
            UUID matchId,
            Long simulationSeed,
            String status,
            MatchmakingPlayerDTO player,
            MatchmakingPlayerDTO opponent,
            List<MatchmakingPlayerDTO> players,
            Instant serverNow,
            Instant classSelectionEndsAt,
            Instant objectPlacementEndsAt,
            Instant countdownEndsAt,
            Instant trainingEndsAt,
            Instant playbackStartsAt,
            Instant resultRevealsAt,
            String rulesetVersion,
            MatchPlaybackDTO playback,
            Integer roundNumber,
            Integer winsRequired,
            String message,
            UUID objectPlacementUserId,
            List<MatchPlaybackDTO.ObstaclePlacementDTO> objectPlacements,
            List<MatchPlaybackDTO.ObstaclePlacementDTO> obstacles,
            List<RoundBrainDTO> roundBrains,
            Boolean previousRoundWon,
            List<String> abilityOffers,
            Integer roundBlockLimit) {
        this(
                type,
                matchId,
                simulationSeed,
                status,
                player,
                opponent,
                players,
                serverNow,
                classSelectionEndsAt,
                objectPlacementEndsAt,
                countdownEndsAt,
                trainingEndsAt,
                playbackStartsAt,
                resultRevealsAt,
                rulesetVersion,
                playback,
                roundNumber,
                winsRequired,
                message,
                objectPlacementUserId,
                objectPlacements,
                obstacles,
                roundBrains,
                previousRoundWon,
                abilityOffers,
                roundBlockLimit,
                null,
                null);
    }

    public record RoundBrainDTO(int roundNumber, JsonNode brain, boolean won) {
    }
}
