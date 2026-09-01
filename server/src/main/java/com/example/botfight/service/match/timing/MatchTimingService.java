package com.example.botfight.service.match.timing;

import com.example.botfight.DTO.MatchmakingEventDTO;
import com.example.botfight.domain.BotSubmission;
import com.example.botfight.service.auth.AuthException;
import com.example.botfight.service.match.coordination.MatchLockService;
import com.example.botfight.service.match.event.MatchEventFactory;
import com.example.botfight.service.match.event.OutboundMatchmakingEvent;
import com.example.botfight.service.match.loadout.MatchLoadoutService;
import com.example.botfight.service.match.model.MatchPlayer;
import com.example.botfight.service.match.model.MatchSession;
import com.example.botfight.service.match.persistence.MatchPersistenceService;
import com.example.botfight.service.match.state.MatchRuntimeState;
import com.example.botfight.service.match.state.MatchSubmissionKey;
import com.example.botfight.service.match.submission.MatchSubmissionService;
import java.time.Clock;
import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;
import java.util.function.Supplier;

/** Owns loadout, countdown, building-deadline, and round-boundary timing. */
public final class MatchTimingService {
    private static final int LOADOUT_SELECTION_SECONDS = MatchTimingPolicy.LOADOUT_SELECTION_SECONDS;
    private static final int SUBMISSION_GRACE_SECONDS = MatchTimingPolicy.SUBMISSION_GRACE_SECONDS;
    private static final int BUILDING_ROOM_PREPARATION_SECONDS = 2;
    private static final String BUILDING_PHASE = "BUILDING";

    private final MatchRuntimeState state;
    private final Clock clock;
    private final MatchLockService lockService;
    private final MatchPersistenceService persistenceService;
    private final MatchEventFactory eventFactory;
    private final MatchLoadoutService loadoutService;
    private final MatchSubmissionService submissionService;

    public MatchTimingService(
            MatchRuntimeState state,
            Clock clock,
            MatchLockService lockService,
            MatchPersistenceService persistenceService,
            MatchEventFactory eventFactory,
            MatchLoadoutService loadoutService,
            MatchSubmissionService submissionService) {
        this.state = state;
        this.clock = clock;
        this.lockService = lockService;
        this.persistenceService = persistenceService;
        this.eventFactory = eventFactory;
        this.loadoutService = loadoutService;
        this.submissionService = submissionService;
    }

    public List<OutboundMatchmakingEvent> selectLoadout(UUID userId, String selectedLoadout) {
        MatchSession observedSession = state.activeSessionsByUserId().get(userId);
        if (observedSession == null) return List.of();
        return selectLoadout(userId, observedSession.matchId(), observedSession.roundNumber(), selectedLoadout);
    }

    public List<OutboundMatchmakingEvent> selectLoadout(
            UUID userId,
            UUID expectedMatchId,
            Integer expectedRoundNumber,
            String selectedLoadout) {
        if (expectedMatchId == null || expectedRoundNumber == null) return List.of();
        MatchSession observedSession = state.activeSessionsByUserId().get(userId);
        if (observedSession == null
                || !expectedMatchId.equals(observedSession.matchId())
                || expectedRoundNumber.intValue() != observedSession.roundNumber()) {
            return List.of();
        }
        return withLock(expectedMatchId, () -> selectLoadoutLocked(userId, selectedLoadout));
    }

    public List<OutboundMatchmakingEvent> resolveLoadoutSelectionTimeout(UUID matchId) {
        return withLock(matchId, () -> resolveLoadoutSelectionTimeoutLocked(matchId));
    }

    public List<OutboundMatchmakingEvent> resolveExpiredLoadoutSelections() {
        Instant now = Instant.now(clock);
        List<MatchSession> expiredSessions = state.distinctActiveSessions().stream()
                .filter(session -> session.countdownEndsAt() == null)
                .filter(session -> session.loadoutSelectionEndsAt() != null)
                .filter(session -> !now.isBefore(session.loadoutSelectionEndsAt()))
                .toList();
        List<OutboundMatchmakingEvent> events = new ArrayList<>();
        for (MatchSession session : expiredSessions) {
            events.addAll(resolveLoadoutSelectionTimeout(session.matchId()));
        }
        return events;
    }

    public List<OutboundMatchmakingEvent> resolveBuildingTimeout(
            UUID matchId,
            Instant expectedDeadline) {
        return withLock(matchId, () -> resolveBuildingTimeoutLocked(matchId, expectedDeadline));
    }

    public List<OutboundMatchmakingEvent> resolveExpiredBuildingSessions() {
        Instant now = Instant.now(clock);
        List<MatchSession> expiredSessions = state.distinctActiveSessions().stream()
                .filter(session -> session.buildingEndsAt() != null)
                .filter(session -> !now.isBefore(session.buildingEndsAt()))
                .toList();
        List<OutboundMatchmakingEvent> events = new ArrayList<>();
        for (MatchSession session : expiredSessions) {
            events.addAll(resolveBuildingTimeout(session.matchId(), session.buildingEndsAt()));
        }
        return events;
    }

    public List<OutboundMatchmakingEvent> beginInitialLoadoutSelection(UUID matchId) {
        return withLock(matchId, () -> beginInitialLoadoutSelectionLocked(matchId));
    }

    public OutboundMatchmakingEvent activateRoundLoadoutSelection(
            OutboundMatchmakingEvent pendingEvent) {
        if (pendingEvent == null || pendingEvent.event() == null
                || !"MATCH_ROUND_READY".equals(pendingEvent.event().type())) {
            return pendingEvent;
        }
        return withLock(pendingEvent.event().matchId(),
                () -> activateRoundLoadoutSelectionLocked(pendingEvent));
    }

    private List<OutboundMatchmakingEvent> selectLoadoutLocked(
            UUID userId,
            String selectedLoadout) {
        MatchSession session = state.activeSessionsByUserId().get(userId);
        if (session == null || session.countdownEndsAt() != null) {
            return List.of();
        }
        if (session.loadoutSelectionEndsAt() == null) return List.of();
        if (!Instant.now(clock).isBefore(session.loadoutSelectionEndsAt())) {
            return startExpiredLoadoutSelection(session);
        }

        MatchPlayer selectingPlayer = playerForUser(session, userId);
        if (selectingPlayer.loadoutSelected()) {
            return List.of(eventFactory.forPlayer(session, selectingPlayer, "MATCH_LOADOUT_SELECTED"));
        }
        String normalizedLoadout = loadoutService.normalize(selectedLoadout);
        String completedLoadout = loadoutService.completeRoundAbilityDraft(
                session, selectingPlayer, normalizedLoadout);
        loadoutService.validateRoundAbilityDraft(session, selectingPlayer, completedLoadout);
        MatchSession selectedSession = session.withSelectedLoadout(userId, completedLoadout, true);
        if (selectedSession.players().stream().allMatch(MatchPlayer::loadoutSelected)) {
            return startCountdown(
                    selectedSession.withArenaEntities(List.of()),
                    "BOT_BUILDING_SESSION_READY",
                    "Both players have selected. Starting building session.",
                    false);
        }

        state.putSession(selectedSession);
        return selectedSession.players().stream()
                .map(player -> eventFactory.forPlayer(
                        selectedSession,
                        player,
                        "MATCH_LOADOUT_SELECTED",
                        "LOADOUT_SELECT",
                        null,
                        playerForUser(selectedSession, userId).username()
                                + " locked a loadout."))
                .toList();
    }

    private List<OutboundMatchmakingEvent> resolveLoadoutSelectionTimeoutLocked(UUID matchId) {
        MatchSession session = state.activeSessionForMatch(matchId);
        if (session == null || session.countdownEndsAt() != null
                || session.loadoutSelectionEndsAt() == null
                || Instant.now(clock).isBefore(session.loadoutSelectionEndsAt())) {
            return List.of();
        }
        return startExpiredLoadoutSelection(session);
    }

    private List<OutboundMatchmakingEvent> resolveBuildingTimeoutLocked(
            UUID matchId,
            Instant expectedDeadline) {
        MatchSession session = state.activeSessionForMatch(matchId);
        if (session == null
                || session.buildingEndsAt() == null
                || !session.buildingEndsAt().equals(expectedDeadline)
                || Instant.now(clock).isBefore(session.buildingEndsAt())) {
            return List.of();
        }
        return resolveExpiredBuilding(session);
    }

    private List<OutboundMatchmakingEvent> resolveExpiredBuilding(MatchSession session) {
        MatchSession resolvedSession = session;
        boolean playerTimedOut = false;
        for (MatchPlayer player : session.players()) {
            if (player.finished()) continue;
            BotSubmission previous = submissionService.latestRoundSubmission(
                    session.matchId(), player.userId());
            BotSubmission submission = persistenceService.createBuildingTimeoutSubmission(
                    session, player, previous);
            state.matchSubmissionsByKey().put(
                    new MatchSubmissionKey(
                            session.matchId(),
                            session.roundNumber(),
                            BUILDING_PHASE,
                            player.userId()),
                    submission);
            resolvedSession = resolvedSession.withFinishedPlayer(player.userId(), submission.getId());
            playerTimedOut = true;
        }
        if (!playerTimedOut) return List.of();
        state.putSession(resolvedSession);
        return submissionService.afterPlayerFinished(
                resolvedSession,
                "Building ended; the server resolved the missing bot brain.");
    }

    private List<OutboundMatchmakingEvent> startExpiredLoadoutSelection(MatchSession session) {
        return startCountdown(
                loadoutService.withDefaultAbilitySelections(session).withArenaEntities(List.of()),
                "BOT_BUILDING_SESSION_READY",
                "Building session is starting with finalized loadouts.",
                false);
    }

    private List<OutboundMatchmakingEvent> beginInitialLoadoutSelectionLocked(UUID matchId) {
        MatchSession session = state.activeSessionForMatch(matchId);
        if (session == null || session.roundNumber() != 1 || session.countdownEndsAt() != null
                || session.loadoutSelectionEndsAt() != null
                || !state.initialLoadoutSelectionStartedMatchIds().add(matchId)) {
            return List.of();
        }
        return session.players().stream()
                .map(player -> eventFactory.forPlayer(
                        session,
                        player,
                        "MATCH_LOADOUT_SELECTION_READY",
                        "LOADOUT_SELECT",
                        null,
                        "Choose your opening loadout."))
                .toList();
    }

    private OutboundMatchmakingEvent activateRoundLoadoutSelectionLocked(
            OutboundMatchmakingEvent pendingEvent) {
        MatchmakingEventDTO event = pendingEvent.event();
        MatchSession session = state.activeSessionForMatch(event.matchId());
        if (session == null) {
            return null;
        }
        if (session.isReplay()) {
            if (session.seriesComplete()) {
                return null;
            }
            if (session.roundReadyAt() == null) {
                return null;
            }
            if (session.roundNumber() + 1 != event.roundNumber()) {
                return null;
            }
            session = session.nextRound().withLoadoutSelection(
                    loadoutSelectionDeadlineAt(Instant.now(clock)));
            state.putSession(session);
        } else if (session.roundNumber() != event.roundNumber()) {
            return null;
        }
        if (session.entityPlacementEndsAt() != null
                || session.countdownEndsAt() != null
                || session.players().stream().anyMatch(MatchPlayer::finished)) {
            return null;
        }
        MatchPlayer player = session.players().stream()
                .filter(candidate -> candidate.principalName().equals(pendingEvent.principalName()))
                .findFirst()
                .orElse(null);
        if (player == null) {
            return null;
        }

        MatchSession activeSession = session;
        if (activeSession.loadoutSelectionEndsAt() == null) {
            activeSession = activeSession.withLoadoutSelection(
                    loadoutSelectionDeadlineAt(Instant.now(clock)));
            state.putSession(activeSession);
        }
        return new OutboundMatchmakingEvent(
                pendingEvent.principalName(),
                eventFactory.forPlayer(
                        activeSession,
                        playerForUser(activeSession, player.userId()),
                        "MATCH_ROUND_READY",
                        "LOADOUT_SELECT",
                        null,
                        event.message(),
                        0).event());
    }

    private List<OutboundMatchmakingEvent> startCountdown(
            MatchSession session,
            String type,
            String message,
            boolean includePreparationHold) {
        Instant now = Instant.now(clock);
        Instant countdownEndsAt = now.plusSeconds(
                includePreparationHold ? BUILDING_ROOM_PREPARATION_SECONDS : 0);
        if (session.loadoutSelectionEndsAt() != null
                && countdownEndsAt.isAfter(session.loadoutSelectionEndsAt())) {
            countdownEndsAt = session.loadoutSelectionEndsAt();
        }
        Instant buildingEndsAt = countdownEndsAt.plusSeconds(
                session.roundDurationSeconds() + SUBMISSION_GRACE_SECONDS);
        MatchSession countdownSession = session.withCountdown(countdownEndsAt, buildingEndsAt);
        state.putSession(countdownSession);
        for (MatchPlayer player : countdownSession.players()) {
            persistenceService.updateParticipantSelectedLoadout(
                    countdownSession.matchId(), player);
        }
        return countdownSession.players().stream()
                .map(player -> eventFactory.forPlayer(
                        countdownSession,
                        player,
                        type,
                        "PREP",
                        null,
                        message))
                .toList();
    }

    private Instant loadoutSelectionDeadlineAt(Instant phaseStartedAt) {
        return phaseStartedAt.plusSeconds(LOADOUT_SELECTION_SECONDS + SUBMISSION_GRACE_SECONDS);
    }

    private <T> T withLock(UUID matchId, Supplier<T> operation) {
        return lockService.withLock(matchId, operation);
    }

    private MatchPlayer playerForUser(MatchSession session, UUID userId) {
        return session.players().stream()
                .filter(player -> player.userId().equals(userId))
                .findFirst()
                .orElseThrow(() -> new AuthException("player is not in this match"));
    }
}
