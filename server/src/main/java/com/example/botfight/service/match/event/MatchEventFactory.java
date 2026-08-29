package com.example.botfight.service.match.event;

import com.example.botfight.DTO.MatchPlaybackDTO;
import com.example.botfight.DTO.MatchReplayDTO;
import com.example.botfight.DTO.MatchmakingEventDTO;
import com.example.botfight.DTO.MatchmakingEventDTO.RoundBrainDTO;
import com.example.botfight.DTO.MatchmakingPlayerDTO;
import com.example.botfight.service.match.chat.MatchChatService;
import com.example.botfight.service.match.connection.MatchConnectionService;
import com.example.botfight.service.match.model.MatchPlayer;
import com.example.botfight.service.match.model.MatchSession;
import com.example.botfight.service.match.persistence.MatchPersistenceService;
import com.example.botfight.service.match.simulation.MatchSimulationService;
import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.util.List;
import java.util.Set;
import java.util.UUID;
import java.util.function.BiFunction;
import java.util.function.Function;

/** Builds authoritative socket snapshots from a match session. */
public final class MatchEventFactory {
    private static final long PLAYBACK_PREP_DELAY_MILLIS = 3_000L;
    private static final int ROUND_LOGIC_BLOCK_LIMIT = 100;

    private final Clock clock;
    private final MatchConnectionService connectionService;
    private final MatchPersistenceService persistenceService;
    private final MatchChatService chatService;
    private final Set<UUID> initialLoadoutSelectionStartedMatchIds;
    private final Function<MatchSession, List<Integer>> abilityOffers;
    private final BiFunction<UUID, UUID, List<RoundBrainDTO>> roundBrainsForPlayer;
    private final BiFunction<UUID, UUID, Boolean> previousRoundWon;

    public MatchEventFactory(
            Clock clock,
            MatchConnectionService connectionService,
            MatchPersistenceService persistenceService,
            MatchChatService chatService,
            Set<UUID> initialLoadoutSelectionStartedMatchIds,
            Function<MatchSession, List<Integer>> abilityOffers,
            BiFunction<UUID, UUID, List<RoundBrainDTO>> roundBrainsForPlayer,
            BiFunction<UUID, UUID, Boolean> previousRoundWon) {
        this.clock = clock;
        this.connectionService = connectionService;
        this.persistenceService = persistenceService;
        this.chatService = chatService;
        this.initialLoadoutSelectionStartedMatchIds = initialLoadoutSelectionStartedMatchIds;
        this.abilityOffers = abilityOffers;
        this.roundBrainsForPlayer = roundBrainsForPlayer;
        this.previousRoundWon = previousRoundWon;
    }

    public OutboundMatchmakingEvent forPlayer(
            MatchSession session,
            MatchPlayer player,
            String type) {
        String status = session.countdownEndsAt() != null
                ? "PREP"
                : session.entityPlacementEndsAt() != null
                        ? "OBJECT_PLACEMENT"
                        : "MATCH_FOUND".equals(type)
                                && session.roundNumber() == 1
                                && session.loadoutSelectionEndsAt() == null
                                && !initialLoadoutSelectionStartedMatchIds.contains(session.matchId())
                                ? "MATCH_FOUND"
                                : "LOADOUT_SELECT";
        return forPlayer(session, player, type, status, null, null);
    }

    public OutboundMatchmakingEvent forCompactReplay(
            MatchSession session,
            MatchPlayer player,
            String type,
            String status,
            MatchReplayDTO playback,
            String message,
            long delayMillis,
            Instant playbackStartsAt,
            Instant resultRevealsAt,
            Instant roundReadyAt) {
        return forPlayer(
                session,
                player,
                type,
                status,
                null,
                message,
                null,
                List.of(),
                delayMillis,
                playbackStartsAt,
                resultRevealsAt,
                roundReadyAt,
                playback);
    }

    public OutboundMatchmakingEvent forPlayer(
            MatchSession session,
            MatchPlayer player,
            String type,
            String status,
            MatchPlaybackDTO playback,
            String message) {
        return forPlayer(session, player, type, status, playback, message, null, List.of());
    }

    public OutboundMatchmakingEvent forPlayer(
            MatchSession session,
            MatchPlayer player,
            String type,
            String status,
            MatchPlaybackDTO playback,
            String message,
            UUID entityPlacementUserId,
            List<MatchPlaybackDTO.ArenaEntityDTO> entityPlacements) {
        return forPlayer(
                session,
                player,
                type,
                status,
                playback,
                message,
                entityPlacementUserId,
                entityPlacements,
                0);
    }

    public OutboundMatchmakingEvent forPlayer(
            MatchSession session,
            MatchPlayer player,
            String type,
            String status,
            MatchPlaybackDTO playback,
            String message,
            long delayMillis) {
        return forPlayer(session, player, type, status, playback, message, null, List.of(), delayMillis);
    }

    public OutboundMatchmakingEvent forPlayer(
            MatchSession session,
            MatchPlayer player,
            String type,
            String status,
            MatchPlaybackDTO playback,
            String message,
            UUID entityPlacementUserId,
            List<MatchPlaybackDTO.ArenaEntityDTO> entityPlacements,
            long delayMillis) {
        return forPlayer(
                session,
                player,
                type,
                status,
                playback,
                message,
                entityPlacementUserId,
                entityPlacements,
                delayMillis,
                null,
                null,
                null);
    }

    public OutboundMatchmakingEvent forPlayer(
            MatchSession session,
            MatchPlayer player,
            String type,
            String status,
            MatchPlaybackDTO playback,
            String message,
            long delayMillis,
            Instant playbackStartsAt,
            Instant resultRevealsAt) {
        return forPlayer(
                session,
                player,
                type,
                status,
                playback,
                message,
                null,
                List.of(),
                delayMillis,
                playbackStartsAt,
                resultRevealsAt,
                null);
    }

    public OutboundMatchmakingEvent forPlayer(
            MatchSession session,
            MatchPlayer player,
            String type,
            String status,
            MatchPlaybackDTO playback,
            String message,
            long delayMillis,
            Instant playbackStartsAt,
            Instant resultRevealsAt,
            Instant roundReadyAt) {
        return forPlayer(
                session,
                player,
                type,
                status,
                playback,
                message,
                null,
                List.of(),
                delayMillis,
                playbackStartsAt,
                resultRevealsAt,
                roundReadyAt);
    }

    public OutboundMatchmakingEvent forPlayer(
            MatchSession session,
            MatchPlayer player,
            String type,
            String status,
            MatchPlaybackDTO playback,
            String message,
            long delayMillis,
            Instant playbackStartsAt,
            Instant resultRevealsAt,
            Instant roundReadyAt,
            MatchReplayDTO compactPlayback) {
        return forPlayer(
                session,
                player,
                type,
                status,
                playback,
                message,
                null,
                List.of(),
                delayMillis,
                playbackStartsAt,
                resultRevealsAt,
                roundReadyAt,
                compactPlayback);
    }

    public OutboundMatchmakingEvent forPlayer(
            MatchSession session,
            MatchPlayer player,
            String type,
            String status,
            MatchPlaybackDTO playback,
            String message,
            UUID entityPlacementUserId,
            List<MatchPlaybackDTO.ArenaEntityDTO> entityPlacements,
            long delayMillis,
            Instant playbackStartsAt,
            Instant resultRevealsAt) {
        return forPlayer(
                session,
                player,
                type,
                status,
                playback,
                message,
                entityPlacementUserId,
                entityPlacements,
                delayMillis,
                playbackStartsAt,
                resultRevealsAt,
                null);
    }

    public OutboundMatchmakingEvent forPlayer(
            MatchSession session,
            MatchPlayer player,
            String type,
            String status,
            MatchPlaybackDTO playback,
            String message,
            UUID entityPlacementUserId,
            List<MatchPlaybackDTO.ArenaEntityDTO> entityPlacements,
            long delayMillis,
            Instant playbackStartsAt,
            Instant resultRevealsAt,
            Instant roundReadyAt) {
        return forPlayer(
                session,
                player,
                type,
                status,
                playback,
                message,
                entityPlacementUserId,
                entityPlacements,
                delayMillis,
                playbackStartsAt,
                resultRevealsAt,
                roundReadyAt,
                null);
    }

    public OutboundMatchmakingEvent forPlayer(
            MatchSession session,
            MatchPlayer player,
            String type,
            String status,
            MatchPlaybackDTO playback,
            String message,
            UUID entityPlacementUserId,
            List<MatchPlaybackDTO.ArenaEntityDTO> entityPlacements,
            long delayMillis,
            Instant playbackStartsAt,
            Instant resultRevealsAt,
            Instant roundReadyAt,
            MatchReplayDTO compactPlayback) {
        if ("MATCH_REPLAY_BATCH".equals(type)) {
            MatchReplayDTO replayPayload = compactPlayback != null
                    ? compactPlayback
                    : MatchReplayDTO.from(playback);
            MatchmakingEventDTO replayBatchEvent = MatchmakingEventDTO.replayBatchPayload(
                    session.matchId(),
                    MatchSimulationService.DUEL_RULESET_VERSION,
                    replayPayload,
                    playbackStartsAt,
                    resultRevealsAt,
                    roundReadyAt,
                    session.roundNumber())
                    .withMode(session.mode().name());
            if ((playback != null && playback.terminalBatch())
                    || (compactPlayback != null && compactPlayback.terminalBatch())) {
                MatchPlayer opponent = opposingPlayer(session, player);
                replayBatchEvent = replayBatchEvent.withReplayParticipants(
                        player.toDto(session.entityPlacementsByUserId().containsKey(player.userId())),
                        opponent == null ? null : opponent.toDto(
                                session.entityPlacementsByUserId().containsKey(opponent.userId())),
                        session.players().stream()
                                .map(matchPlayer -> matchPlayer.toDto(
                                        session.entityPlacementsByUserId().containsKey(matchPlayer.userId())))
                                .toList());
            }
            return new OutboundMatchmakingEvent(
                    player.principalName(),
                    replayBatchEvent,
                    delayMillis,
                    playbackStartsAt.plusMillis(delayMillis - PLAYBACK_PREP_DELAY_MILLIS));
        }

        boolean replayPhaseEvent = Set.of("SIMULATION_PREPARING", "MATCH_RESULT_READY").contains(type);
        boolean simulationPreparingEvent = "SIMULATION_PREPARING".equals(type);
        Instant eventNow = Instant.now(clock);
        Long simulationPreparingDurationMs = simulationPreparingEvent && playbackStartsAt != null
                ? Math.max(0, Duration.between(eventNow, playbackStartsAt).toMillis())
                : null;
        MatchReplayDTO replayPayload = compactPlayback != null
                ? compactPlayback
                : MatchReplayDTO.from(playback);
        if ("MATCH_RESULT_READY".equals(type) && replayPayload != null && persistenceService != null) {
            MatchPersistenceService.RatingChange ratingChange = persistenceService.ratingChangeForPlayer(
                    session.matchId(), player.userId());
            if (ratingChange != null) {
                replayPayload = replayPayload.withRatingChange(
                        ratingChange.before(), ratingChange.after());
            }
        }
        MatchPlayer opponent = opposingPlayer(session, player);
        UUID disconnectedUserId = session.players().stream()
                .filter(candidate -> connectionService.disconnectDeadline(candidate.userId()) != null)
                .map(MatchPlayer::userId)
                .findFirst()
                .orElse(null);
        Instant disconnectEndsAt = disconnectedUserId == null
                ? null
                : connectionService.disconnectDeadline(disconnectedUserId);
        return new OutboundMatchmakingEvent(
                player.principalName(),
                new MatchmakingEventDTO(
                        type,
                        session.matchId(),
                        session.simulationSeed(),
                        status,
                        player.toDto(session.entityPlacementsByUserId().containsKey(player.userId())),
                        opponent == null ? null : opponent.toDto(
                                session.entityPlacementsByUserId().containsKey(opponent.userId())),
                        session.players().stream()
                                .map(matchPlayer -> matchPlayer.toDto(
                                        session.entityPlacementsByUserId().containsKey(matchPlayer.userId())))
                                .toList(),
                        eventNow,
                        simulationPreparingEvent ? null : session.loadoutSelectionEndsAt(),
                        simulationPreparingEvent ? null : session.entityPlacementEndsAt(),
                        simulationPreparingEvent ? null : session.countdownEndsAt(),
                        simulationPreparingEvent ? null : session.buildingEndsAt(),
                        playbackStartsAt,
                        resultRevealsAt,
                        MatchSimulationService.DUEL_RULESET_VERSION,
                        replayPayload,
                        session.roundNumber(),
                        session.winsRequired(),
                        message,
                        entityPlacementUserId,
                        entityPlacements != null ? List.copyOf(entityPlacements) : List.of(),
                        session.arenaEntities(),
                        replayPhaseEvent
                                ? List.of()
                                : roundBrainsForPlayer.apply(session.matchId(), player.userId()),
                        replayPhaseEvent
                                ? null
                                : previousRoundWon.apply(session.matchId(), player.userId()),
                        replayPhaseEvent ? List.of() : abilityOffers.apply(session),
                        replayPhaseEvent ? null : ROUND_LOGIC_BLOCK_LIMIT,
                        disconnectedUserId,
                        disconnectEndsAt,
                        simulationPreparingEvent ? simulationPreparingDurationMs : null,
                        roundReadyAt,
                        chatService.closeAt(session.matchId()))
                        .withMode(session.mode().name())
                        .withSurrenderState(
                                session.surrenderVotes().contains(player.userId()),
                                surrenderVoteCount(session, player),
                                surrenderVoteRequired(session, player)),

                delayMillis,
                "MATCH_ROUND_READY".equals(type) ? roundReadyAt : null);
    }

    public OutboundMatchmakingEvent disconnectEventForPlayer(
            MatchSession session,
            MatchPlayer recipient,
            MatchPlayer disconnectedPlayer,
            String type,
            Instant deadline,
            String message) {
        return disconnectEventForPlayer(session, recipient, disconnectedPlayer, type, deadline, message, null);
    }

    public OutboundMatchmakingEvent disconnectEventForPlayer(
            MatchSession session,
            MatchPlayer recipient,
            MatchPlayer disconnectedPlayer,
            String type,
            Instant deadline,
            String message,
            MatchReplayDTO compactPlayback) {
        MatchPlayer opponent = opposingPlayer(session, recipient);
        UUID activeDisconnectedUserId = deadline != null
                ? disconnectedPlayer.userId()
                : session.players().stream()
                        .filter(candidate -> connectionService.disconnectDeadline(candidate.userId()) != null)
                        .map(MatchPlayer::userId)
                        .findFirst()
                        .orElse(null);
        Instant activeDisconnectEndsAt = deadline != null
                ? deadline
                : activeDisconnectedUserId == null
                        ? null
                        : connectionService.disconnectDeadline(activeDisconnectedUserId);
        String status = session.isReplay()
                ? "SIMULATION_PREPARING"
                : session.players().stream().allMatch(MatchPlayer::finished)
                        ? "SIMULATION_LOADING"
                        : session.countdownEndsAt() != null
                                ? "PREP"
                                : session.entityPlacementEndsAt() != null
                                        ? "OBJECT_PLACEMENT"
                                        : session.buildingEndsAt() != null ? "BUILDING" : "LOADOUT_SELECT";
        return new OutboundMatchmakingEvent(
                recipient.principalName(),
                new MatchmakingEventDTO(
                        type,
                        session.matchId(),
                        session.simulationSeed(),
                        status,
                        recipient.toDto(session.entityPlacementsByUserId().containsKey(recipient.userId())),
                        opponent == null ? null : opponent.toDto(
                                session.entityPlacementsByUserId().containsKey(opponent.userId())),
                        session.players().stream()
                                .map(player -> player.toDto(
                                        session.entityPlacementsByUserId().containsKey(player.userId())))
                                .toList(),
                        Instant.now(clock),
                        session.loadoutSelectionEndsAt(),
                        session.entityPlacementEndsAt(),
                        session.countdownEndsAt(),
                        session.buildingEndsAt(),
                        session.playbackStartsAt(),
                        null,
                        MatchSimulationService.DUEL_RULESET_VERSION,
                        compactPlayback,
                        session.roundNumber(),
                        session.winsRequired(),
                        message,
                        null,
                        List.of(),
                        session.arenaEntities(),
                        roundBrainsForPlayer.apply(session.matchId(), recipient.userId()),
                        previousRoundWon.apply(session.matchId(), recipient.userId()),
                        abilityOffers.apply(session),
                        ROUND_LOGIC_BLOCK_LIMIT,
                        activeDisconnectedUserId,
                        activeDisconnectEndsAt,
                        null,
                        null,
                        chatService.closeAt(session.matchId()))
                        .withMode(session.mode().name())
                        .withSurrenderState(
                                session.surrenderVotes().contains(recipient.userId()),
                                surrenderVoteCount(session, recipient),
                                surrenderVoteRequired(session, recipient)));
    }

    private int surrenderVoteCount(MatchSession session, MatchPlayer player) {
        return (int) session.players().stream()
                .filter(candidate -> candidate.teamNumber() == player.teamNumber())
                .filter(candidate -> session.surrenderVotes().contains(candidate.userId()))
                .count();
    }

    private int surrenderVoteRequired(MatchSession session, MatchPlayer player) {
        return (int) session.players().stream()
                .filter(candidate -> candidate.teamNumber() == player.teamNumber())
                .count();
    }

    private MatchPlayer opposingPlayer(MatchSession session, MatchPlayer player) {
        if (session == null || player == null) return null;
        return session.players().stream()
                .filter(candidate -> candidate.teamNumber() != player.teamNumber())
                .findFirst()
                .orElse(null);
    }

    public List<OutboundMatchmakingEvent> playerReconnectedEvents(
            MatchSession session,
            MatchPlayer reconnectingPlayer,
            MatchReplayDTO preparationPlayback) {
        return session.players().stream()
                .map(player -> disconnectEventForPlayer(
                        session,
                        player,
                        reconnectingPlayer,
                        "PLAYER_RECONNECTED",
                        null,
                        reconnectingPlayer.username() + " reconnected.",
                        preparationPlayback))
                .toList();
    }

    public OutboundMatchmakingEvent resumePhaseEvent(
            MatchSession session,
            MatchPlayer player) {
        if (session.players().stream().allMatch(MatchPlayer::finished)) {
            return forPlayer(
                    session,
                    player,
                    "SIMULATION_LOADING",
                    "SIMULATION_LOADING",
                    null,
                    "Loading the authoritative round replay.");
        }
        return forPlayer(session, player, "MATCH_FOUND");
    }

    public OutboundMatchmakingEvent noActiveMatchEvent(
            UUID userId,
            String username,
            String principalName) {
        return new OutboundMatchmakingEvent(
                principalName,
                new MatchmakingEventDTO(
                        "NO_ACTIVE_MATCH",
                        null,
                        null,
                        "NO_ACTIVE_MATCH",
                        new MatchmakingPlayerDTO(
                                userId,
                                username,
                                1,
                                false,
                                0,
                                "melee",
                                false),
                        null,
                        List.of(),
                        Instant.now(clock),
                        null,
                        null,
                        null,
                        null,
                        null,
                        null,
                        MatchSimulationService.DUEL_RULESET_VERSION,
                        null,
                        null,
                        null,
                        "No active match was found.",
                        null,
                        List.of(),
                        List.of(),
                        List.of(),
                        null,
                        List.of(),
                        ROUND_LOGIC_BLOCK_LIMIT));
    }
}
