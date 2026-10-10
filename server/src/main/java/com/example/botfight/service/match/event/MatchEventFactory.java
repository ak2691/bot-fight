package com.example.botfight.service.match.event;

import com.example.botfight.service.match.state.MatchPhase;

import com.example.botfight.service.match.MatchHistoryService;

import org.springframework.stereotype.Component;

import com.example.botfight.DTO.match.MatchEventType;

import com.example.botfight.DTO.match.MatchPlaybackDTO;
import com.example.botfight.DTO.match.MatchReplayDTO;
import com.example.botfight.DTO.match.MatchmakingEventDTO;
import com.example.botfight.DTO.match.MatchmakingPlayerDTO;
import com.example.botfight.service.match.MatchChatService;
import com.example.botfight.service.match.connection.MatchConnectionService;
import com.example.botfight.service.match.MatchLoadoutService;
import com.example.botfight.service.match.model.HpDecision;
import com.example.botfight.service.match.model.MatchPlayer;
import com.example.botfight.service.match.model.MatchSession;
import com.example.botfight.service.match.MatchPersistenceService;
import com.example.botfight.service.match.MatchSimulationService;
import com.example.botfight.service.match.MatchTimingPolicy;
import com.example.botfight.simulation.gameconfig.ClosingZoneConfig;
import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.util.Comparator;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.Set;
import java.util.UUID;

/** Builds authoritative socket snapshots from a match session. */
@Component
public final class MatchEventFactory {
    private static final long PLAYBACK_PREP_DELAY_MILLIS = 3_000L;

    private final Clock clock;
    private final MatchConnectionService connectionService;
    private final MatchPersistenceService persistenceService;
    private final MatchChatService chatService;
    private final MatchLoadoutService loadoutService;
    private final MatchHistoryService historyService;

    public MatchEventFactory(
            Clock clock,
            MatchConnectionService connectionService,
            MatchPersistenceService persistenceService,
            MatchChatService chatService,
            MatchLoadoutService loadoutService,
            MatchHistoryService historyService) {
        this.clock = clock;
        this.connectionService = connectionService;
        this.persistenceService = persistenceService;
        this.chatService = chatService;
        this.loadoutService = loadoutService;
        this.historyService = historyService;
    }

    public OutboundMatchmakingEvent forPlayer(
            MatchSession session,
            MatchPlayer player,
            MatchEventType type) {
        String status = session.phase().wireStatus();
        return forPlayer(session,
                player,
                type,
                status,
                null,
                null,
                0,
                null,
                null,
                null,
                null);
    }

    public OutboundMatchmakingEvent forCompactReplay(
            MatchSession session,
            MatchPlayer player,
            MatchEventType type,
            String status,
            MatchReplayDTO playback,
            String message,
            long delayMillis,
            Instant playbackStartsAt,
            Instant resultRevealsAt,
            Instant roundReadyAt) {
        return forPlayer(session,
                player,
                type,
                status,
                null,
                message,
                delayMillis,
                playbackStartsAt,
                resultRevealsAt,
                roundReadyAt,
                playback);
    }

    public OutboundMatchmakingEvent forPlayer(
            MatchSession session,
            MatchPlayer player,
            MatchEventType type,
            String status,
            MatchPlaybackDTO playback,
            String message,
            long delayMillis,
            Instant playbackStartsAt,
            Instant resultRevealsAt,
            Instant roundReadyAt,
            MatchReplayDTO compactPlayback) {
        if (MatchEventType.MATCH_REPLAY_BATCH.equals(type)) {
            MatchReplayDTO replayPayload = compactPlayback != null
                    ? compactPlayback
                    : MatchReplayDTO.from(playback);
            MatchmakingEventDTO replayBatchEvent = MatchmakingEventDTO.builder()
                        .type(MatchEventType.MATCH_REPLAY_BATCH)
                        .matchId(session.matchId())
                        .rulesetVersion(MatchSimulationService.DUEL_RULESET_VERSION)
                        .playback(replayPayload)
                        .playbackStartsAt(playbackStartsAt)
                        .resultRevealsAt(resultRevealsAt)
                        .roundReadyAt(roundReadyAt)
                        .roundNumber(session.roundNumber())
                        .status(status)
                        .mode(session.mode().name()).build();
            if (compactPlayback != null && Boolean.TRUE.equals(compactPlayback.terminalBatch())) {
                MatchPlayer opponent = opposingPlayer(session, player);
                replayBatchEvent = replayBatchEvent.toBuilder()
                        .player(playerDto(session, player))
                        .opponent(opponent == null ? null : playerDto(session, opponent))
                        .players(session.players().stream()
                                .map(matchPlayer -> playerDto(session, matchPlayer))
                                .toList()).build();
            }
            return new OutboundMatchmakingEvent(player.principalName(),
                replayBatchEvent,
                delayMillis,
                playbackStartsAt.plusMillis(delayMillis - PLAYBACK_PREP_DELAY_MILLIS),
                session.phase(),
                type == MatchEventType.MATCH_ROUND_READY && delayMillis > 0);
        }

        boolean replayPhaseEvent = Set.of(MatchEventType.SIMULATION_PREPARING, MatchEventType.MATCH_RESULT_READY).contains(type);
        boolean simulationPreparingEvent = MatchEventType.SIMULATION_PREPARING.equals(type);
        Instant eventNow = Instant.now(clock);
        Long simulationPreparingDurationMs = simulationPreparingEvent && playbackStartsAt != null
                ? Math.max(0, Duration.between(eventNow, playbackStartsAt).toMillis())
                : null;
        MatchReplayDTO replayPayload = compactPlayback != null
                ? compactPlayback
                : MatchReplayDTO.from(playback);
        if (MatchEventType.MATCH_RESULT_READY.equals(type) && replayPayload != null) {
            Map<UUID, MatchPersistenceService.RatingChange> loadedRatingChanges =
                    persistenceService.ratingChangesForMatch(session.matchId());
            Map<UUID, MatchPersistenceService.RatingChange> ratingChanges =
                    loadedRatingChanges == null ? Map.of() : loadedRatingChanges;
            List<MatchReplayDTO.RatingChangeDTO> orderedRatingChanges = session.players().stream()
                    .sorted(Comparator
                            .comparingInt((MatchPlayer candidate) -> ratingChangeOrder(candidate, player))
                            .thenComparingInt(MatchPlayer::slot))
                    .map(candidate -> {
                        MatchPersistenceService.RatingChange ratingChange =
                                ratingChanges.get(candidate.userId());
                        return ratingChange == null
                                ? null
                                : new MatchReplayDTO.RatingChangeDTO(
                                        candidate.username(),
                                        ratingChange.before(),
                                        ratingChange.after());
                    })
                    .filter(Objects::nonNull)
                    .toList();
            replayPayload = replayPayload.withRatingChanges(orderedRatingChanges);
            MatchPersistenceService.RatingChange ratingChange = ratingChanges.get(player.userId());
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
        Instant activeSelectionDeadline = session.loadoutSelectionEndsAt();
        return new OutboundMatchmakingEvent(player.principalName(),
                MatchmakingEventDTO.builder()
                        .type(type)
                        .matchId(session.matchId())
                        .simulationSeed(session.simulationSeed())
                        .status(status)
                        .player(playerDto(session, player))
                        .opponent(opponent == null ? null : playerDto(session, opponent))
                        .players(session.players().stream()
                                .map(matchPlayer -> playerDto(session, matchPlayer))
                                .toList())
                        .serverNow(eventNow)
                        .loadoutSelectionEndsAt(simulationPreparingEvent ? null : activeSelectionDeadline)
                        .countdownEndsAt(simulationPreparingEvent ? null : session.countdownEndsAt())
                        .buildingEndsAt(simulationPreparingEvent ? null : session.buildingEndsAt())
                        .playbackStartsAt(playbackStartsAt)
                        .resultRevealsAt(resultRevealsAt)
                        .rulesetVersion(MatchSimulationService.DUEL_RULESET_VERSION)
                        .playback(replayPayload)
                        .roundNumber(session.roundNumber())
                        .message(message)
                        .roundBrains(replayPhaseEvent
                                ? List.of()
                                : historyService.roundBrainsForPlayer(session.matchId(), player.userId()))
                        .abilityOffers(replayPhaseEvent ? List.of() : loadoutService.abilityOffersForPlayer(session, player.userId()))
                        .disconnectedUserId(disconnectedUserId)
                        .disconnectEndsAt(disconnectEndsAt)
                        .simulationPreparingDurationMs(simulationPreparingEvent ? simulationPreparingDurationMs : null)
                        .roundReadyAt(roundReadyAt)
                        .matchChatEndsAt(chatService.closeAt(session.matchId()))
                        .viewerUserId(playerDto(session, player) == null ? null : playerDto(session, player).userId())
                        .mode(session.mode().name())
                        .surrenderRequestedByMe(session.surrenderVotes().contains(player.userId()))
                        .surrenderVoteCount(surrenderVoteCount(session, player))
                        .surrenderVoteRequired(surrenderVoteRequired(session, player))
                        .timedRounds(timedRounds(session)).build(),
                delayMillis,
                MatchEventType.MATCH_ROUND_READY.equals(type) ? roundReadyAt : null,
                session.phase(),
                type == MatchEventType.MATCH_ROUND_READY && delayMillis > 0);
    }

    /**
     * The timed-rounds block every snapshot carries: the match's clock and round count, the weapon
     * offers while they are open, where the zone appears, and the frozen end of the last segment.
     * The zone ring shown in a round is the size it will contract to at the next step, if any.
     */
    private MatchmakingEventDTO.TimedRoundsDTO timedRounds(MatchSession session) {
        ClosingZoneConfig zone = ClosingZoneConfig.timedRoundsV2();
        int segmentMs = MatchTimingPolicy.SEGMENT_SECONDS * 1_000;
        double warning = zone.warningDiameterAt((Math.max(1, session.roundNumber()) - 1) * segmentMs);
        HpDecision hpDecision = session.ended()
                && session.roundNumber() >= MatchTimingPolicy.MAX_ROUNDS
                ? HpDecision.fromEndState(session.segmentEndState())
                : null;
        return new MatchmakingEventDTO.TimedRoundsDTO(
                MatchTimingPolicy.MAX_ROUNDS,
                session.baseClockSeconds(),
                session.incrementSeconds(),
                MatchTimingPolicy.pickSeconds(session.roundNumber()),
                MatchTimingPolicy.SEGMENT_SECONDS,
                session.roundNumber() <= 1 ? MatchLoadoutService.WEAPON_IDS : List.of(),
                zone.startDelayMs() / segmentMs + 1,
                Double.isNaN(warning) ? null : warning,
                session.segmentEndState().isEmpty() ? null : session.segmentEndState(),
                hpDecision == null
                        ? null
                        : new MatchmakingEventDTO.HpDecisionDTO(hpDecision.teamHp(), hpDecision.winningTeam()));
    }

    private int ratingChangeOrder(MatchPlayer candidate, MatchPlayer recipient) {
        if (Objects.equals(candidate.userId(), recipient.userId())) return 0;
        return candidate.teamNumber() == recipient.teamNumber() ? 1 : 2;
    }

    private MatchmakingPlayerDTO playerDto(MatchSession session, MatchPlayer player) {
        return player.toDto();
    }

    public OutboundMatchmakingEvent disconnectEventForPlayer(
            MatchSession session,
            MatchPlayer recipient,
            MatchPlayer disconnectedPlayer,
            MatchEventType type,
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
        String status = session.phase().wireStatus();
        Instant activeSelectionDeadline = session.loadoutSelectionEndsAt();
        return new OutboundMatchmakingEvent(recipient.principalName(),
                MatchmakingEventDTO.builder()
                        .type(type)
                        .matchId(session.matchId())
                        .simulationSeed(session.simulationSeed())
                        .status(status)
                        .player(playerDto(session, recipient))
                        .opponent(opponent == null ? null : playerDto(session, opponent))
                        .players(session.players().stream()
                                .map(player -> playerDto(session, player))
                                .toList())
                        .serverNow(Instant.now(clock))
                        .loadoutSelectionEndsAt(activeSelectionDeadline)
                        .countdownEndsAt(session.countdownEndsAt())
                        .buildingEndsAt(session.buildingEndsAt())
                        .playbackStartsAt(session.playbackStartsAt())
                        .rulesetVersion(MatchSimulationService.DUEL_RULESET_VERSION)
                        .playback(compactPlayback)
                        .roundNumber(session.roundNumber())
                        .message(message)
                        .roundBrains(historyService.roundBrainsForPlayer(session.matchId(), recipient.userId()))
                        .abilityOffers(loadoutService.abilityOffersForPlayer(session, recipient.userId()))
                        .disconnectedUserId(activeDisconnectedUserId)
                        .disconnectEndsAt(activeDisconnectEndsAt)
                        .matchChatEndsAt(chatService.closeAt(session.matchId()))
                        .viewerUserId(playerDto(session, recipient) == null ? null : playerDto(session, recipient).userId())
                        .mode(session.mode().name())
                        .surrenderRequestedByMe(session.surrenderVotes().contains(recipient.userId()))
                        .surrenderVoteCount(surrenderVoteCount(session, recipient))
                        .surrenderVoteRequired(surrenderVoteRequired(session, recipient))
                        .timedRounds(timedRounds(session)).build(),
                0,
                null,
                session.phase());
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
                .map(player -> disconnectEventForPlayer(session,
                player,
                reconnectingPlayer,
                MatchEventType.PLAYER_RECONNECTED,
                null,
                reconnectingPlayer.username() + " reconnected.",
                preparationPlayback))
                .toList();
    }

    public OutboundMatchmakingEvent resumePhaseEvent(
            MatchSession session,
            MatchPlayer player) {
        if (session.phase() == MatchPhase.SIMULATION_LOADING
                || session.phase() == MatchPhase.SIMULATING) {
            return forPlayer(session,
                player,
                MatchEventType.SIMULATION_LOADING,
                session.phase().wireStatus(),
                null,
                "Loading the authoritative round replay.",
                0,
                null,
                null,
                null,
                null);
        }
        return forPlayer(session,
                player,
                MatchEventType.MATCH_FOUND);
    }

    public OutboundMatchmakingEvent noActiveMatchEvent(
            UUID userId,
            String username,
            String principalName) {
        MatchmakingPlayerDTO viewer = new MatchmakingPlayerDTO(
                userId,
                username,
                1,
                1 <= 2 ? 1 : 1,
                false,
                0,
                "melee",
                false,
                null,
                null,
                null);
        return new OutboundMatchmakingEvent(principalName,
                MatchmakingEventDTO.builder()
                        .type(MatchEventType.NO_ACTIVE_MATCH)
                        .status("NO_ACTIVE_MATCH")
                        .player(viewer)
                        .players(List.of(viewer))
                        .serverNow(Instant.now(clock))
                        .rulesetVersion(MatchSimulationService.DUEL_RULESET_VERSION)
                        .message("No active match was found.")
                        .roundBrains(List.of())
                        .abilityOffers(List.of())
                        .viewerUserId(viewer == null ? null : viewer.userId()).build(),
                0,
                null,
                null);
    }
}
