package com.example.botfight.service.match;

import com.example.botfight.service.match.state.MatchPhase;

import com.example.botfight.service.match.state.MatchRuntimeState;

import org.springframework.stereotype.Component;

import com.example.botfight.DTO.match.MatchEventType;

import com.example.botfight.domain.submission.BotSubmission;
import com.example.botfight.domain.submission.BotSubmissionStatus;
import com.example.botfight.service.auth.AuthException;
import com.example.botfight.service.match.event.MatchEventFactory;
import com.example.botfight.service.match.event.OutboundMatchmakingEvent;
import com.example.botfight.service.match.model.MatchPlayer;
import com.example.botfight.service.match.model.MatchSession;
import com.example.botfight.service.match.model.MatchSubmissionResult;
import com.example.botfight.service.match.state.MatchSubmissionKey;
import com.example.botfight.service.match.state.RoundSubmissionRecord;
import java.time.Clock;
import java.time.Instant;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.UUID;
import java.util.concurrent.ConcurrentMap;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.json.JsonMapper;
import tools.jackson.databind.node.ObjectNode;

/** Owns authoritative match-bound brain idempotency and submission transitions. */
@Component
public final class MatchSubmissionService {
    public static final String BUILDING_PHASE = "BUILDING";

    private final MatchScheduler matchScheduler;
    private final MatchRuntimeState state;
    private final ConcurrentMap<MatchSubmissionKey, BotSubmission> submissionsByKey;
    private final ConcurrentMap<UUID, List<RoundSubmissionRecord>> roundHistoryByMatchId;
    private final Clock clock;
    private final JsonMapper jsonMapper;
    private final MatchPersistenceService persistenceService;
    private final MatchLoadoutService loadoutService;
    private final MatchEventFactory eventFactory;

    public MatchSubmissionService(
            MatchRuntimeState state,
            Clock clock,
            JsonMapper jsonMapper,
            MatchPersistenceService persistenceService,
            MatchLoadoutService loadoutService,
            MatchEventFactory eventFactory,
            MatchScheduler matchScheduler) {
        this.matchScheduler = matchScheduler;
        this.state = state;
        this.submissionsByKey = state.matchSubmissionsByKey();
        this.roundHistoryByMatchId = state.roundHistoryByMatchId();
        this.clock = clock;
        this.jsonMapper = jsonMapper;
        this.persistenceService = persistenceService;
        this.loadoutService = loadoutService;
        this.eventFactory = eventFactory;
    }

    public boolean isCurrent(
            UUID userId,
            UUID expectedMatchId,
            Integer expectedRoundNumber,
            String expectedPhase) {
        if (userId == null
                || expectedMatchId == null
                || expectedRoundNumber == null
                || !BUILDING_PHASE.equals(expectedPhase)) {
            return false;
        }
        MatchSubmissionKey key = new MatchSubmissionKey(
                expectedMatchId,
                expectedRoundNumber,
                expectedPhase,
                userId);
        if (submissionsByKey.containsKey(key)) return true;
        return isCurrentLocked(userId, expectedMatchId, expectedRoundNumber, expectedPhase);
    }

    public MatchSubmissionResult accept(
            UUID userId,
            UUID expectedMatchId,
            Integer expectedRoundNumber,
            String expectedPhase,
            BotSubmission submission) {
        if (userId == null
                || expectedMatchId == null
                || expectedRoundNumber == null
                || !BUILDING_PHASE.equals(expectedPhase)) {
            return MatchSubmissionResult.rejected("match submission context is invalid");
        }

        MatchSubmissionKey key = new MatchSubmissionKey(
                expectedMatchId,
                expectedRoundNumber,
                expectedPhase,
                userId);
        BotSubmission existing = submissionsByKey.get(key);
        if (existing != null) {
            if (Objects.equals(
                    existing.getRequestFingerprint(),
                    submission == null ? null : submission.getRequestFingerprint())) {
                return MatchSubmissionResult.duplicateResult();
            }
            return MatchSubmissionResult.rejected(
                    "this player already submitted a different bot brain for this round");
        }

        if (!isCurrentLocked(userId, expectedMatchId, expectedRoundNumber, expectedPhase)) {
            return MatchSubmissionResult.rejected(
                    "bot submission is stale because the match is no longer in this round's building phase");
        }
        if (submission == null
                || submission.getStatus() != BotSubmissionStatus.VALIDATED
                || !expectedMatchId.equals(submission.getMatchId())) {
            return MatchSubmissionResult.rejected("bot submission is not valid for this match");
        }

        MatchSession session = state.activeSessionForUser(userId);
        MatchPlayer submittingPlayer = playerForUser(session, userId);
        if (submittingPlayer.finished()) {
            return MatchSubmissionResult.rejected("this player has already finished this round");
        }

        bindSubmissionToAuthoritativeLoadout(submission, submittingPlayer.selectedLoadout());
        String submissionLoadout = loadoutService.normalize(submission.getSelectedLoadout());
        String submittedLoadout = loadoutService.submissionLoadoutId(submission);
        if (submittedLoadout != null && !submittedLoadout.equals(submittingPlayer.selectedLoadout())) {
            return MatchSubmissionResult.rejected("bot submission does not match the selected bot loadout");
        }
        if (submittedLoadout == null
                && !"custom:bds".equals(submissionLoadout)
                && !"custom".equals(submissionLoadout)
                && !submissionLoadout.equals(submittingPlayer.selectedLoadout())) {
            return MatchSubmissionResult.rejected("bot submission does not match the selected bot loadout");
        }

        if (submission.getId() == null) submission.setId(UUID.randomUUID());
        submissionsByKey.put(key, submission);
        // The time spent building comes off this player's clock.
        MatchSession updatedSession = session.withFinishedPlayer(userId, submission.getId(), Instant.now(clock));
        if (MatchPlayer.isTimeoutFallback(submission.getTimeoutFallback())) {
            updatedSession = updatedSession.withTimeoutFallback(userId, submission.getTimeoutFallback());
        }
        putSession(updatedSession);
        return MatchSubmissionResult.accepted(afterPlayerFinished(
                updatedSession,
                submittingPlayer.username() + " finished building."));
    }

    public BotSubmission latestRoundSubmission(UUID matchId, UUID userId) {
        List<RoundSubmissionRecord> history = roundHistoryByMatchId.getOrDefault(matchId, List.of());
        for (int index = history.size() - 1; index >= 0; index--) {
            BotSubmission submission = history.get(index).submissionsByUser().get(userId);
            if (submission != null) return submission;
        }
        return null;
    }

    public Map<UUID, BotSubmission> submissionsForRound(MatchSession session) {
        Map<UUID, BotSubmission> submissions = new HashMap<>();
        submissionsByKey.forEach((key, submission) -> {
            if (session.matchId().equals(key.matchId())
                    && session.roundNumber() == key.roundNumber()
                    && BUILDING_PHASE.equals(key.phase())) {
                submissions.put(key.userId(), submission);
            }
        });
        return Map.copyOf(submissions);
    }

    public void removeForRound(UUID matchId, int roundNumber) {
        submissionsByKey.keySet().removeIf(key -> matchId.equals(key.matchId())
                && roundNumber == key.roundNumber());
    }

    public void removeAll(UUID matchId) {
        submissionsByKey.keySet().removeIf(key -> matchId.equals(key.matchId()));
    }

    public void persistCodeHistory(MatchSession session) {
        Map<Integer, Map<UUID, BotSubmission>> submissionsByRound = new HashMap<>();
        roundHistoryByMatchId.getOrDefault(session.matchId(), List.of()).forEach(round ->
                submissionsByRound.put(
                        round.roundNumber(),
                        new HashMap<>(round.submissionsByUser())));

        submissionsByKey.forEach((key, submission) -> {
            if (session.matchId().equals(key.matchId())) {
                submissionsByRound
                        .computeIfAbsent(key.roundNumber(), ignored -> new HashMap<>())
                        .put(key.userId(), submission);
            }
        });
        persistenceService.persistMatchRoundBotCodes(session.matchId(), submissionsByRound);
    }

    public List<OutboundMatchmakingEvent> afterPlayerFinished(
            MatchSession updatedSession,
            String waitingMessage) {
        if (!updatedSession.players().stream().allMatch(MatchPlayer::finished)) {
            return updatedSession.players().stream()
                    .map(player -> eventFactory.forPlayer(updatedSession,
                player,
                MatchEventType.PLAYER_FINISHED,
                "WAITING_FOR_FINISH",
                null,
                waitingMessage,
                0,
                null,
                null,
                null,
                null))
                    .toList();
        }
        matchScheduler.simulate(updatedSession.matchId(), updatedSession.roundNumber());
        return updatedSession.players().stream()
                .map(player -> eventFactory.forPlayer(updatedSession,
                player,
                MatchEventType.SIMULATION_LOADING,
                "SIMULATION_LOADING",
                null,
                "Loading the authoritative round replay.",
                0,
                null,
                null,
                null,
                null))
                .map(OutboundMatchmakingEvent::scheduledDelivery)
                .toList();
    }

    private boolean isCurrentLocked(
            UUID userId,
            UUID expectedMatchId,
            int expectedRoundNumber,
            String expectedPhase) {
        if (!BUILDING_PHASE.equals(expectedPhase)) return false;
        MatchSession session = state.activeSessionForUser(userId);
        if (session == null
                || !expectedMatchId.equals(session.matchId())
                || session.roundNumber() != expectedRoundNumber
                || session.countdownEndsAt() == null
                || session.buildingEndsAt() == null
                || session.players().stream().allMatch(MatchPlayer::finished)) {
            return false;
        }
        // Each player builds against their own clock, so a teammate running out does not close this
        // player's window.
        MatchPlayer builder = playerForUser(session, userId);
        Instant expiresAt = builder.buildExpiresAt();
        return expiresAt != null && Instant.now(clock).isBefore(expiresAt);
    }

    private void bindSubmissionToAuthoritativeLoadout(
            BotSubmission submission,
            String selectedLoadout) {
        if (submission == null || selectedLoadout == null) return;
        try {
            JsonNode parsed = jsonMapper.readTree(
                    submission.getBrainPayload() == null ? "{}" : submission.getBrainPayload());
            ObjectNode brain = parsed != null && parsed.isObject()
                    ? (ObjectNode) parsed.deepCopy()
                    : jsonMapper.createObjectNode();
            ObjectNode loadout = loadoutService.encodedLoadoutNode(selectedLoadout);
            if (loadout == null) brain.remove("loadout");
            else brain.set("loadout", loadout);
            submission.setSelectedLoadout(selectedLoadout);
            submission.setBrainPayload(jsonMapper.writeValueAsString(brain));
        } catch (Exception exception) {
            throw new AuthException("authoritative bot loadout could not be applied");
        }
    }

    private MatchPlayer playerForUser(MatchSession session, UUID userId) {
        return session.players().stream()
                .filter(player -> player.userId().equals(userId))
                .findFirst()
                .orElseThrow(() -> new AuthException("player is not in this match"));
    }

    private void putSession(MatchSession session) {
        state.putSession(session);
    }
    public List<OutboundMatchmakingEvent> simulationLoadingEvents(UUID matchId, int round) {
        MatchSession session = state.activeSessionForMatch(matchId);
        if (session == null || session.roundNumber() != round
                || session.phase() != MatchPhase.SIMULATION_LOADING) return List.of();
        return session.players().stream().map(player -> eventFactory.forPlayer(session, player,
                MatchEventType.SIMULATION_LOADING, session.phase().wireStatus(), null,
                "Loading the authoritative round replay.", 0, null, null, null, null)).toList();
    }

    public void requireActiveMatchForUser(UUID userId, UUID matchId) {
        MatchSession session = state.activeSessionForUser(userId);
        if (session == null || matchId == null || !session.matchId().equals(matchId)) {
            throw new AuthException("user is not active in this match");
        }
        playerForUser(session, userId);
    }

}
