package com.example.botfight.service;

import com.example.botfight.DTO.MatchPlaybackDTO;
import com.example.botfight.DTO.ActiveMatchStatusDTO;
import com.example.botfight.DTO.MatchmakingEventDTO;
import com.example.botfight.DTO.MatchmakingPlayerDTO;
import com.example.botfight.DTO.MatchmakingEventDTO.RoundBrainDTO;
import com.example.botfight.domain.Match;
import com.example.botfight.domain.BotSubmission;
import com.example.botfight.simulation.ArenaUnits;
import com.example.botfight.simulation.gameconfig.CompactAbilityCode;
import java.time.Clock;
import java.time.Instant;
import java.util.ArrayDeque;
import java.util.ArrayList;
import java.util.Collections;
import java.util.Deque;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import java.util.Random;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.ConcurrentMap;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.concurrent.locks.ReentrantLock;
import java.util.function.Supplier;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.json.JsonMapper;
import tools.jackson.databind.node.ObjectNode;

@Service
public class MatchService {
    private static final long PLAYBACK_PREP_DELAY_MILLIS = 3_000L;
    private static final int REPLAY_BATCH_MILLIS = 1_000;
    private static final int REPLAY_LOOKAHEAD_MILLIS = 2_000;

    private static final long ROUND_RESULT_HOLD_MILLIS = 3_000L;
    private static final int LOADOUT_SELECTION_SECONDS = 60;
    private static final int BUILDING_SECONDS = 30;
    private static final int SUBMISSION_GRACE_SECONDS = 2;
    private static final int BUILDING_ROOM_PREPARATION_SECONDS = 2;
    private static final int WINS_REQUIRED = 2;
    private static final int TOTAL_ROUNDS = 3;
    private static final int MAX_EQUIPPED_ABILITIES = 6;
    private static final Map<Integer, Integer> ROUND_OFFER_COUNTS = Map.of(1, 6, 2, 4, 3, 3);
    private static final Map<Integer, Integer> ROUND_PICK_COUNTS = Map.of(1, 3, 2, 2, 3, 1);
    private static final Map<Integer, List<Integer>> ROUND_ABILITIES = Map.of(
            1, List.of(1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12),
            2, List.of(13, 14, 15, 16, 17, 18),
            3, List.of(21, 22, 23, 24, 25));
    private static final int ROUND_LOGIC_BLOCK_LIMIT = 100;
    private static final int MATCH_CHAT_MAX_CODE_POINTS = 280;
    private static final int MATCH_CHAT_BURST_LIMIT = 3;
    private static final long MATCH_CHAT_WINDOW_MILLIS = 5_000L;
    private static final long MATCH_CHAT_RETENTION_MILLIS = 30_000L;
    private static final String MATCH_CHAT_CLOSED_MESSAGE = "Match chat is now closed.";
    private static final String COMPLETION_REASON_RESIGNATION = "RESIGNATION";
    private static final String COMPLETION_REASON_DISCONNECTION = "DISCONNECTION";
    private static final String COMPLETION_REASON_MUTUAL_DISCONNECTION = "MUTUAL_DISCONNECTION";
    private static final String COMPLETION_REASON_INITIAL_DISCONNECTION = "INITIAL_DISCONNECTION";

    private final MatchSimulationService matchSimulationService;
    private final MatchPersistenceService matchPersistenceService;
    private final MatchConnectionService matchConnectionService;
    private final Clock clock;
    private final ConcurrentMap<UUID, MatchSession> activeSessionsByUserId = new ConcurrentHashMap<>();
    private final Set<UUID> initialLoadoutSelectionStartedMatchIds = ConcurrentHashMap.newKeySet();
    private final ConcurrentMap<UUID, ReplayResumeState> replayResumeByUserId = new ConcurrentHashMap<>();
    private final ConcurrentMap<UUID, List<RoundSubmissionRecord>> roundHistoryByMatchId = new ConcurrentHashMap<>();
    private final ConcurrentMap<UUID, Map<UUID, Deque<Instant>>> chatMessageTimesByMatchAndUserId = new ConcurrentHashMap<>();
    private final ConcurrentMap<UUID, MatchChatWindow> matchChatWindowsByMatchId = new ConcurrentHashMap<>();
    private final ConcurrentMap<UUID, MatchCoordination> coordinationByMatchId = new ConcurrentHashMap<>();
    private final Set<SimulationKey> simulationsInProgress = ConcurrentHashMap.newKeySet();
    private final JsonMapper jsonMapper = new JsonMapper();

    private Instant loadoutSelectionDeadlineAt(Instant phaseStartedAt) {
        return phaseStartedAt.plusSeconds(LOADOUT_SELECTION_SECONDS + SUBMISSION_GRACE_SECONDS);
    }

    public MatchService(
            MatchSimulationService matchSimulationService,
            MatchPersistenceService matchPersistenceService,
            MatchConnectionService matchConnectionService,
            Clock clock) {
        this.matchSimulationService = matchSimulationService;
        this.matchPersistenceService = matchPersistenceService;
        this.matchConnectionService = matchConnectionService;
        this.clock = clock;
    }

    private UUID matchIdForUser(UUID userId) {
        MatchSession activeSession = activeSessionsByUserId.get(userId);
        if (activeSession != null) return activeSession.matchId();
        ReplayResumeState replayResume = replayResumeByUserId.get(userId);
        return replayResume == null ? null : replayResume.replaySession().matchId();
    }

    /**
     * Serializes state transitions for one match without coupling unrelated
     * matches. The reference count keeps a coordination entry alive while a
     * caller owns or waits for its lock, then removes idle entries.
     */
    private <T> T withMatchLock(UUID matchId, Supplier<T> operation) {
        if (matchId == null) throw new IllegalArgumentException("matchId is required for coordination");
        MatchCoordination coordination = coordinationByMatchId.compute(matchId, (ignored, current) -> {
            MatchCoordination selected = current == null ? new MatchCoordination() : current;
            selected.references.incrementAndGet();
            return selected;
        });
        coordination.lock.lock();
        try {
            return operation.get();
        } finally {
            coordination.lock.unlock();
            coordinationByMatchId.computeIfPresent(matchId, (ignored, current) -> {
                if (current != coordination) return current;
                return coordination.references.decrementAndGet() == 0 ? null : current;
            });
        }
    }

    private static final class MatchCoordination {
        private final ReentrantLock lock = new ReentrantLock();
        private final AtomicInteger references = new AtomicInteger();
    }

    public ActiveMatchStatusDTO activeMatchStatus(UUID userId) {
        MatchSession session = activeSessionsByUserId.get(userId);
        if (session == null) {
            ReplayResumeState replayResume = replayResumeByUserId.get(userId);
            boolean resultStillPending = replayResume != null
                    && replayResume.seriesComplete()
                    && Instant.now(clock).isBefore(replayResume.resultRevealsAt());
            if (!resultStillPending) {
                replayResumeByUserId.remove(userId, replayResume);
                return ActiveMatchStatusDTO.none();
            }
            session = replayResume.replaySession();
        }

        Instant disconnectEndsAt =
                matchConnectionService.disconnectDeadline(userId);
        return new ActiveMatchStatusDTO(
                true,
                disconnectEndsAt != null,
                session.matchId(),
                disconnectEndsAt);
    }

    public List<OutboundMatchmakingEvent> resumeMatch(
            UUID userId,
            String username,
            String principalName,
            String socketSessionId) {
        UUID matchId = matchIdForUser(userId);
        if (matchId == null) {
            return List.of(noActiveMatchEvent(userId, username, principalName));
        }
        return withMatchLock(matchId, () -> resumeMatchLocked(
                userId, username, principalName, socketSessionId));
    }

    private List<OutboundMatchmakingEvent> resumeMatchLocked(
            UUID userId,
            String username,
            String principalName,
            String socketSessionId) {
        if (!activeSessionsByUserId.containsKey(userId)
                && !replayResumeByUserId.containsKey(userId)) {
            return List.of(noActiveMatchEvent(userId, username, principalName));
        }
        matchConnectionService.registerSocket(userId, socketSessionId);
        ReplayResumeState replayResume = replayResumeByUserId.get(userId);
        if (replayResume != null) {
            Instant disconnectDeadline = matchConnectionService.reconnect(userId, socketSessionId);
            List<OutboundMatchmakingEvent> events = new ArrayList<>(
                    replayEventsForReconnect(userId, replayResume));
            if (disconnectDeadline != null) {
                MatchPlayer reconnectingPlayer = playerForUser(replayResume.replaySession(), userId);
                events.addAll(playerReconnectedEvents(
                        replayResume.replaySession(),
                        reconnectingPlayer,
                        replayResume.replayPlayback()));
            }
            if (!events.isEmpty()) return events;
            replayResumeByUserId.remove(userId);
        }
        if (activeSessionsByUserId.containsKey(userId)) {
            MatchSession session = activeSessionsByUserId.get(userId);
            MatchPlayer reconnectingPlayer = playerForUser(session, userId);
            Instant disconnectDeadline = matchConnectionService.reconnect(userId, socketSessionId);
            if (disconnectDeadline == null) {
                return List.of(resumePhaseEvent(session, reconnectingPlayer, null));
            }
            List<OutboundMatchmakingEvent> events = new ArrayList<>();
            events.add(resumePhaseEvent(session, reconnectingPlayer, null));
            events.addAll(playerReconnectedEvents(session, reconnectingPlayer, null));
            return events;
        }

        return List.of();
    }

    @Transactional
    public List<OutboundMatchmakingEvent> startMatch(
            MatchEntrant opponent,
            MatchEntrant player) {
        Match match = matchPersistenceService.createMatch();
        long seed = match.getSimulationSeed();
        boolean queuedPlayerDefendsFirst = (seed & 1L) == 0L;
        MatchEntrant firstDefender = queuedPlayerDefendsFirst ? player : opponent;
        MatchEntrant firstAttacker = queuedPlayerDefendsFirst ? opponent : player;
        List<MatchPlayer> players = List.of(
                new MatchPlayer(
                        firstDefender.userId(), firstDefender.username(), firstDefender.principalName(),
                        1,
                        false,
                        null,
                        0,
                        "custom::0,0,0,0",
                        false),
                new MatchPlayer(
                        firstAttacker.userId(), firstAttacker.username(), firstAttacker.principalName(),
                        2,
                        false,
                        null,
                        0,
                        "custom::0,0,0,0",
                        false));

        MatchSession pendingSession = new MatchSession(
                match.getId(),
                seed,
                players,
                null,
                null,
                null,
                null,
                1,
                WINS_REQUIRED,
                List.of(),
                Map.of());
        matchPersistenceService.createParticipants(match, pendingSession);
        MatchSession session = pendingSession.withLoadoutSelection(
                loadoutSelectionDeadlineAt(Instant.now(clock)));
        activeSessionsByUserId.put(opponent.userId(), session);
        activeSessionsByUserId.put(player.userId(), session);
        matchConnectionService.registerSocket(opponent.userId(), opponent.socketSessionId());
        matchConnectionService.registerSocket(player.userId(), player.socketSessionId());

        return new ArrayList<>(session.players().stream()
                .map(matchPlayer -> eventForPlayer(
                        session,
                        matchPlayer,
                        "MATCH_STARTED",
                        "LOADOUT_SELECT",
                        null,
                        "Match accepted. Choose your opening loadout."))
                .toList());
    }

    @Transactional
    public List<OutboundMatchmakingEvent> selectLoadout(UUID userId, String selectedLoadout) {
        MatchSession observedSession = activeSessionsByUserId.get(userId);
        if (observedSession == null) return List.of();
        return withMatchLock(observedSession.matchId(), () -> selectLoadoutLocked(userId, selectedLoadout));
    }

    private List<OutboundMatchmakingEvent> selectLoadoutLocked(UUID userId, String selectedLoadout) {
        MatchSession session = activeSessionsByUserId.get(userId);
        if (session == null) {
            return List.of();
        }
        if (session.countdownEndsAt() != null) {
            return List.of(eventForPlayer(session, playerForUser(session, userId), "BOT_BUILDING_SESSION_READY"));
        }
        // The next-round session exists while the prior replay is still being
        // shown, but it must not accept stale/duplicated lock messages until
        // MATCH_ROUND_READY activates its authoritative selection deadline.
        if (session.loadoutSelectionEndsAt() == null) {
            return List.of();
        }
        if (session.loadoutSelectionEndsAt() != null
                && !Instant.now(clock).isBefore(session.loadoutSelectionEndsAt())) {
            return startExpiredLoadoutSelection(session);
        }

        MatchPlayer selectingPlayer = playerForUser(session, userId);
        if (selectingPlayer.loadoutSelected()) {
            return List.of(eventForPlayer(session, selectingPlayer, "MATCH_LOADOUT_SELECTED"));
        }
        String normalizedLoadout = normalizeSelectedLoadout(selectedLoadout);
        validateRoundLoadoutBudget(normalizedLoadout, session.roundNumber());
        String completedLoadout = completeRoundAbilityDraft(session, selectingPlayer, normalizedLoadout);
        validateRoundAbilityDraft(session, selectingPlayer, completedLoadout);
        MatchSession selectedSession = session.withSelectedLoadout(userId, completedLoadout, true);
        if (selectedSession.players().stream().allMatch(MatchPlayer::loadoutSelected)) {
            return startCountdown(
                    selectedSession.withArenaEntities(List.of()),
                    "BOT_BUILDING_SESSION_READY",
                    "Both players have selected. Starting building session.",
                    false);
        }

        for (MatchPlayer player : selectedSession.players()) {
            activeSessionsByUserId.put(player.userId(), selectedSession);
        }
        return selectedSession.players().stream()
                .map(player -> eventForPlayer(
                        selectedSession,
                        player,
                        "MATCH_LOADOUT_SELECTED",
                        "LOADOUT_SELECT",
                        null,
                        playerForUser(selectedSession, userId).username() + " locked a loadout."))
                .toList();
    }

    @Transactional
    public List<OutboundMatchmakingEvent> resolveLoadoutSelectionTimeout(UUID matchId) {
        return withMatchLock(matchId, () -> resolveLoadoutSelectionTimeoutLocked(matchId));
    }

    private List<OutboundMatchmakingEvent> resolveLoadoutSelectionTimeoutLocked(UUID matchId) {
        MatchSession session = activeSessionsByUserId.values().stream()
                .filter(candidate -> candidate.matchId().equals(matchId))
                .findFirst()
                .orElse(null);
        if (session == null
                || session.countdownEndsAt() != null
                || session.loadoutSelectionEndsAt() == null) {
            return List.of();
        }
        if (Instant.now(clock).isBefore(session.loadoutSelectionEndsAt())) {
            return List.of();
        }
        return startExpiredLoadoutSelection(session);
    }

    @Transactional
    public List<OutboundMatchmakingEvent> resolveExpiredLoadoutSelections() {
        Instant now = Instant.now(clock);
        List<MatchSession> expiredSessions = activeSessionsByUserId.values().stream()
                .distinct()
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

    @Transactional
    public List<OutboundMatchmakingEvent> resolveBuildingTimeout(
            UUID matchId,
            Instant expectedDeadline) {
        return withMatchLock(matchId, () -> resolveBuildingTimeoutLocked(matchId, expectedDeadline));
    }

    private List<OutboundMatchmakingEvent> resolveBuildingTimeoutLocked(
            UUID matchId,
            Instant expectedDeadline) {
        MatchSession session = activeSessionsByUserId.values().stream()
                .distinct()
                .filter(candidate -> candidate.matchId().equals(matchId))
                .findFirst()
                .orElse(null);
        if (session == null
                || session.buildingEndsAt() == null
                || !session.buildingEndsAt().equals(expectedDeadline)
                || Instant.now(clock).isBefore(session.buildingEndsAt())) {
            return List.of();
        }
        return resolveExpiredBuilding(session);
    }

    @Transactional
    public List<OutboundMatchmakingEvent> resolveExpiredBuildingSessions() {
        Instant now = Instant.now(clock);
        List<MatchSession> expiredSessions = activeSessionsByUserId.values().stream()
                .distinct()
                .filter(session -> session.buildingEndsAt() != null)
                .filter(session -> !now.isBefore(session.buildingEndsAt()))
                .toList();
        List<OutboundMatchmakingEvent> events = new ArrayList<>();
        for (MatchSession session : expiredSessions) {
            events.addAll(resolveBuildingTimeout(session.matchId(), session.buildingEndsAt()));
        }
        return events;
    }

    private List<OutboundMatchmakingEvent> resolveExpiredBuilding(MatchSession session) {
        MatchSession resolvedSession = session;
        UUID firstTimedOutUserId = null;
        for (MatchPlayer player : session.players()) {
            if (player.finished()) continue;
            BotSubmission submission = matchPersistenceService.resolveBuildingTimeoutSubmission(session, player);
            resolvedSession = resolvedSession.withFinishedPlayer(player.userId(), submission.getId());
            matchPersistenceService.attachSubmission(session.matchId(), player.userId(), submission);
            if (firstTimedOutUserId == null) firstTimedOutUserId = player.userId();
        }
        if (firstTimedOutUserId == null) return List.of();

        for (MatchPlayer player : resolvedSession.players()) {
            activeSessionsByUserId.put(player.userId(), resolvedSession);
        }
        return afterPlayerFinished(
                resolvedSession,
                "Building ended; the server resolved the missing bot brain.");
    }

    private List<OutboundMatchmakingEvent> startExpiredLoadoutSelection(MatchSession session) {
        return startCountdown(
                withDefaultAbilitySelections(session).withArenaEntities(List.of()),
                "BOT_BUILDING_SESSION_READY",
                "Building session is starting with finalized loadouts.",
                false);
    }

    public List<OutboundMatchmakingEvent> beginInitialLoadoutSelection(UUID matchId) {
        return withMatchLock(matchId, () -> beginInitialLoadoutSelectionLocked(matchId));
    }

    private List<OutboundMatchmakingEvent> beginInitialLoadoutSelectionLocked(UUID matchId) {
        MatchSession session = activeSessionsByUserId.values().stream()
                .distinct()
                .filter(candidate -> candidate.matchId().equals(matchId))
                .findFirst()
                .orElse(null);
        if (session == null || session.roundNumber() != 1 || session.countdownEndsAt() != null
                || !initialLoadoutSelectionStartedMatchIds.add(matchId)) {
            return List.of();
        }
        return session.players().stream()
                .map(player -> eventForPlayer(
                        session,
                        player,
                        "MATCH_LOADOUT_SELECTION_READY",
                        "LOADOUT_SELECT",
                        null,
                        "Choose your opening loadout."))
                .toList();
    }

    /**
     * Activates a delayed round transition at the server phase boundary. The
     * next selection deadline must be created here, rather than when replay
     * preparation finishes, so replay scheduling or delayed replay delivery
     * cannot spend the next round's selection time.
     */
    public OutboundMatchmakingEvent activateRoundLoadoutSelection(
            OutboundMatchmakingEvent pendingEvent) {
        if (pendingEvent == null || pendingEvent.event() == null
                || !"MATCH_ROUND_READY".equals(pendingEvent.event().type())) {
            return pendingEvent;
        }
        return withMatchLock(pendingEvent.event().matchId(),
                () -> activateRoundLoadoutSelectionLocked(pendingEvent));
    }

    private OutboundMatchmakingEvent activateRoundLoadoutSelectionLocked(
            OutboundMatchmakingEvent pendingEvent) {
        MatchmakingEventDTO event = pendingEvent.event();
        MatchSession session = activeSessionsByUserId.values().stream()
                .distinct()
                .filter(candidate -> candidate.matchId().equals(event.matchId()))
                .filter(candidate -> candidate.roundNumber() == event.roundNumber())
                .findFirst()
                .orElse(null);
        if (session == null) return null;
        MatchPlayer player = session.players().stream()
                .filter(candidate -> candidate.principalName().equals(pendingEvent.principalName()))
                .findFirst()
                .orElse(null);
        if (player == null) return null;

        MatchSession activeSession = session;
        if (activeSession.loadoutSelectionEndsAt() == null) {
            activeSession = activeSession.withLoadoutSelection(
                    loadoutSelectionDeadlineAt(Instant.now(clock)));
            for (MatchPlayer activePlayer : activeSession.players()) {
                activeSessionsByUserId.put(activePlayer.userId(), activeSession);
            }
            replaceReplayResumeNextRoundSession(activeSession);
        }
        return new OutboundMatchmakingEvent(
                pendingEvent.principalName(),
                eventForPlayer(
                        activeSession,
                        playerForUser(activeSession, player.userId()),
                        "MATCH_ROUND_READY",
                        "LOADOUT_SELECT",
                        null,
                        event.message(),
                        0,
                        event.playbackStartsAt(),
                        event.resultRevealsAt(),
                        event.roundReadyAt()).event());
    }

    public List<OutboundMatchmakingEvent> markDisconnected(String principalName) {
        return markDisconnected(principalName, null);
    }

    public List<OutboundMatchmakingEvent> markDisconnected(
            String principalName,
            String socketSessionId) {
        if (principalName == null || principalName.isBlank()) {
            return List.of();
        }
        MatchSession session = findSessionForPrincipal(principalName);
        if (session == null) {
            return List.of();
        }
        return withMatchLock(session.matchId(),
                () -> markDisconnectedLocked(principalName, socketSessionId));
    }

    private List<OutboundMatchmakingEvent> markDisconnectedLocked(
            String principalName,
            String socketSessionId) {
        MatchSession session = findSessionForPrincipal(principalName);
        if (session == null) return List.of();

        MatchPlayer disconnectedPlayer = session.players().stream()
                .filter(player -> player.principalName().equals(principalName))
                .findFirst()
                .orElseThrow();
        if (matchPersistenceService.isTerminalMatch(session.matchId())) {
            activeSessionsByUserId.remove(disconnectedPlayer.userId());
            replayResumeByUserId.remove(disconnectedPlayer.userId());
            matchConnectionService.clear(disconnectedPlayer.userId());
            return List.of();
        }
        Instant deadline = matchConnectionService.beginDisconnect(
                disconnectedPlayer.userId(),
                socketSessionId);
        if (deadline == null) {
            return List.of();
        }
        return session.players().stream()
                .map(player -> disconnectEventForPlayer(
                        session,
                        player,
                        disconnectedPlayer,
                        "PLAYER_DISCONNECTED",
                        deadline,
                        disconnectedPlayer.username() + " disconnected. The match ends in 30 seconds unless they return."))
                .toList();
    }

    @Transactional
    public List<OutboundMatchmakingEvent> resolveDisconnectTimeout(
            String principalName,
            Instant expectedDeadline) {
        MatchSession session = findSessionForPrincipal(principalName);
        if (session == null) {
            return List.of();
        }
        return withMatchLock(session.matchId(),
                () -> resolveDisconnectTimeoutLocked(principalName, expectedDeadline));
    }

    private List<OutboundMatchmakingEvent> resolveDisconnectTimeoutLocked(
            String principalName,
            Instant expectedDeadline) {
        MatchSession session = findSessionForPrincipal(principalName);
        if (session == null) return List.of();
        if (matchPersistenceService.isTerminalMatch(session.matchId())) {
            MatchPlayer terminalPlayer = session.players().stream()
                    .filter(player -> player.principalName().equals(principalName))
                    .findFirst()
                    .orElse(null);
            if (terminalPlayer != null) {
                activeSessionsByUserId.remove(terminalPlayer.userId());
                replayResumeByUserId.remove(terminalPlayer.userId());
                matchConnectionService.clear(terminalPlayer.userId());
            }
            return List.of();
        }
        MatchPlayer disconnectedPlayer = session.players().stream()
                .filter(player -> player.principalName().equals(principalName))
                .findFirst()
                .orElseThrow();
        Instant currentDeadline =
                matchConnectionService.disconnectDeadline(disconnectedPlayer.userId());
        if (currentDeadline == null
                || !currentDeadline.equals(expectedDeadline)
                || Instant.now(clock).isBefore(currentDeadline)) {
            return List.of();
        }
        MatchPlayer winner = session.players().stream()
                .filter(player -> !player.userId().equals(disconnectedPlayer.userId()))
                .findFirst()
                .orElseThrow(() -> new AuthException("opponent was not found"));

        if (disconnectExpiredDuringInitialSelection(session)) {
            matchPersistenceService.completeMatchAsDraw(
                    session.matchId(),
                    COMPLETION_REASON_INITIAL_DISCONNECTION);
            clearSession(session);

            MatchPlaybackDTO result = new MatchPlaybackDTO(
                    session.matchId(),
                    MatchSimulationService.DUEL_RULESET_VERSION,
                    "COMPLETED",
                    null,
                    List.of(),
                    "DRAW",
                    null,
                    "The match is a draw because a player disconnected before round one began.");
            Instant now = Instant.now(clock);
            return session.players().stream()
                    .map(player -> eventForPlayer(
                            session,
                            player,
                            "MATCH_RESULT_READY",
                            "RESULT_READY",
                            result,
                            result.message(),
                            0,
                            now,
                            now))
                    .toList();
        }

        if (matchConnectionService.isDisconnected(winner.userId())) {
            matchPersistenceService.completeMatchAsDraw(
                    session.matchId(),
                    COMPLETION_REASON_MUTUAL_DISCONNECTION);
            clearSession(session);

            MatchPlaybackDTO result = new MatchPlaybackDTO(
                    session.matchId(),
                    MatchSimulationService.DUEL_RULESET_VERSION,
                    "COMPLETED",
                    null,
                    List.of(),
                    "DRAW",
                    null,
                    "The match is a draw because both players disconnected.");
            Instant now = Instant.now(clock);
            return session.players().stream()
                    .map(player -> eventForPlayer(
                            session,
                            player,
                            "MATCH_RESULT_READY",
                            "RESULT_READY",
                            result,
                            result.message(),
                            0,
                            now,
                            now))
                    .toList();
        }

        matchPersistenceService.completeMatchByForfeit(
                session.matchId(),
                disconnectedPlayer,
                winner,
                COMPLETION_REASON_DISCONNECTION);
        clearSession(session);

        MatchPlaybackDTO result = new MatchPlaybackDTO(
                session.matchId(),
                MatchSimulationService.DUEL_RULESET_VERSION,
                "COMPLETED",
                null,
                List.of(),
                "DISCONNECTION_WIN",
                winner.userId(),
                winner.username() + " wins because the opponent did not reconnect.");
        Instant now = Instant.now(clock);
        return session.players().stream()
                .map(player -> eventForPlayer(
                        session,
                        player,
                        "MATCH_RESULT_READY",
                        "RESULT_READY",
                        result,
                        result.message(),
                        0,
                        now,
                        now))
                .toList();
    }

    private boolean disconnectExpiredDuringInitialSelection(MatchSession session) {
        return session.roundNumber() == 1
                && session.loadoutSelectionEndsAt() != null
                && session.countdownEndsAt() == null;
    }

    private MatchSession findSessionForPrincipal(String principalName) {
        MatchSession activeSession = activeSessionsByUserId.values().stream()
                .distinct()
                .filter(candidate -> candidate.players().stream()
                        .anyMatch(player -> player.principalName().equals(principalName)))
                .findFirst()
                .orElse(null);
        if (activeSession != null) {
            return activeSession;
        }
        return replayResumeByUserId.values().stream()
                .distinct()
                .filter(resume -> resume.replaySession().players().stream()
                        .anyMatch(player -> player.principalName().equals(principalName)))
                .map(ReplayResumeState::resultSession)
                .findFirst()
                .orElse(null);
    }

    public void requireActiveMatchForUser(UUID userId, UUID matchId) {
        MatchSession session = activeSessionsByUserId.get(userId);
        if (session == null || matchId == null || !session.matchId().equals(matchId)) {
            throw new AuthException("user is not active in this match");
        }
        playerForUser(session, userId);
    }

    public MatchChatSubmission submitChatMessage(UUID userId, UUID matchId, String rawMessage) {
        if (matchId == null) return MatchChatSubmission.rejected(null, "Match chat is closed.");
        return withMatchLock(matchId, () -> submitChatMessageLocked(userId, matchId, rawMessage));
    }

    private MatchChatSubmission submitChatMessageLocked(UUID userId, UUID matchId, String rawMessage) {
        MatchSession session = activeSessionsByUserId.get(userId);
        Instant now = Instant.now(clock);
        MatchChatParticipant sender;
        List<String> recipientPrincipalNames;
        if (session != null && matchId != null && session.matchId().equals(matchId)) {
            MatchPlayer activeSender = playerForUser(session, userId);
            sender = new MatchChatParticipant(activeSender.username(), activeSender.principalName());
            recipientPrincipalNames = session.players().stream().map(MatchPlayer::principalName).toList();
        } else {
            MatchChatWindow chatWindow = matchChatWindowsByMatchId.get(matchId);
            if (chatWindow == null || !now.isBefore(chatWindow.closesAt())
                    || !chatWindow.participantsByUserId().containsKey(userId)) {
                return MatchChatSubmission.rejected(matchId, "Match chat is closed.");
            }
            sender = chatWindow.participantsByUserId().get(userId);
            recipientPrincipalNames = chatWindow.participantsByUserId().values().stream()
                    .map(MatchChatParticipant::principalName)
                    .toList();
        }
        String message = rawMessage == null ? "" : rawMessage.strip();
        if (message.isBlank() || message.codePointCount(0, message.length()) > MATCH_CHAT_MAX_CODE_POINTS
                || message.codePoints().anyMatch(Character::isISOControl)) {
            return MatchChatSubmission.rejected(matchId, "Message was not accepted.");
        }

        Instant windowStart = now.minusMillis(MATCH_CHAT_WINDOW_MILLIS);
        Map<UUID, Deque<Instant>> messageTimesByUserId =
                chatMessageTimesByMatchAndUserId.computeIfAbsent(matchId, ignored -> new HashMap<>());
        Deque<Instant> acceptedTimes = messageTimesByUserId.computeIfAbsent(userId, ignored -> new ArrayDeque<>());
        while (!acceptedTimes.isEmpty() && !acceptedTimes.peekFirst().isAfter(windowStart)) {
            acceptedTimes.removeFirst();
        }
        if (acceptedTimes.size() >= MATCH_CHAT_BURST_LIMIT) {
            return MatchChatSubmission.rateLimited(matchId);
        }
        acceptedTimes.addLast(now);
        return new MatchChatSubmission(
                MatchChatSubmissionStatus.ACCEPTED,
                UUID.randomUUID(),
                matchId,
                sender.username(),
                message,
                now,
                recipientPrincipalNames);
    }

    public Instant matchChatCloseAt(UUID matchId) {
        MatchChatWindow chatWindow = matchChatWindowsByMatchId.get(matchId);
        return chatWindow == null ? null : chatWindow.closesAt();
    }

    public MatchChatClosure closeMatchChat(UUID matchId) {
        return withMatchLock(matchId, () -> closeMatchChatLocked(matchId));
    }

    private MatchChatClosure closeMatchChatLocked(UUID matchId) {
        MatchChatWindow chatWindow = matchChatWindowsByMatchId.remove(matchId);
        if (chatWindow == null) return null;
        chatMessageTimesByMatchAndUserId.remove(matchId);
        return new MatchChatClosure(
                matchId,
                MATCH_CHAT_CLOSED_MESSAGE,
                chatWindow.participantsByUserId().values().stream()
                        .map(MatchChatParticipant::principalName)
                        .toList());
    }

    @Transactional
    public List<OutboundMatchmakingEvent> surrender(UUID userId) {
        MatchSession observedSession = activeSessionsByUserId.get(userId);
        if (observedSession == null) return List.of();
        return withMatchLock(observedSession.matchId(), () -> surrenderLocked(userId));
    }

    private List<OutboundMatchmakingEvent> surrenderLocked(UUID userId) {
        MatchSession session = activeSessionsByUserId.get(userId);
        if (session == null) {
            return List.of();
        }

        MatchPlayer resigningPlayer = playerForUser(session, userId);
        MatchPlayer winner = session.players().stream()
                .filter(player -> !player.userId().equals(userId))
                .findFirst()
                .orElseThrow(() -> new AuthException("opponent was not found"));

        matchPersistenceService.completeMatchByForfeit(
                session.matchId(),
                resigningPlayer,
                winner,
                COMPLETION_REASON_RESIGNATION);
        clearSession(session);

        MatchPlaybackDTO result = new MatchPlaybackDTO(
                session.matchId(),
                MatchSimulationService.DUEL_RULESET_VERSION,
                "COMPLETED",
                null,
                List.of(),
                "RESIGNATION_WIN",
                winner.userId(),
                winner.username() + " wins by resignation.");
        Instant now = Instant.now(clock);

        return session.players().stream()
                .map(player -> eventForPlayer(
                        session,
                        player,
                        "MATCH_RESULT_READY",
                        "RESULT_READY",
                        result,
                        result.message(),
                        0,
                        now,
                        now))
                .toList();
    }

    @Transactional
    public List<OutboundMatchmakingEvent> markFinished(UUID userId, UUID botSubmissionId) {
        MatchSession observedSession = activeSessionsByUserId.get(userId);
        if (observedSession == null) return List.of();
        return withMatchLock(observedSession.matchId(), () -> markFinishedLocked(userId, botSubmissionId));
    }

    private List<OutboundMatchmakingEvent> markFinishedLocked(UUID userId, UUID botSubmissionId) {
        MatchSession session = activeSessionsByUserId.get(userId);
        if (session == null) {
            return List.of();
        }

        MatchPlayer submittingPlayer = playerForUser(session, userId);
        if (submittingPlayer.finished()) {
            if (!java.util.Objects.equals(submittingPlayer.botSubmissionId(), botSubmissionId)) {
                throw new AuthException("this player already finished with a different bot submission");
            }
            return List.of();
        }

        BotSubmission submission = matchPersistenceService.requireValidatedSubmission(
                userId,
                botSubmissionId,
                session.matchId());
        // The round loadout is server-owned. A client can be holding the
        // pre-timeout draft when the server auto-picks the missing abilities,
        // so bind the validated brain to the finalized session loadout before
        // comparing or persisting it.
        bindSubmissionToAuthoritativeLoadout(submission, submittingPlayer.selectedLoadout());
        String submissionLoadout = normalizeSelectedLoadout(submission.getSelectedLoadout());
        String submittedLoadout = submissionLoadoutId(submission);
        if (submittedLoadout != null && !submittedLoadout.equals(submittingPlayer.selectedLoadout())) {
            throw new AuthException("bot submission does not match the selected bot loadout");
        }
        if (submittedLoadout == null && !"custom:bds:0,0,0,0".equals(submissionLoadout) && !"custom".equals(submissionLoadout)
                && !submissionLoadout.equals(submittingPlayer.selectedLoadout())) {
            throw new AuthException("bot submission does not match the selected bot loadout");
        }
        MatchSession updatedSession = session.withFinishedPlayer(userId, submission.getId());
        for (MatchPlayer player : updatedSession.players()) {
            activeSessionsByUserId.put(player.userId(), updatedSession);
        }

        matchPersistenceService.attachSubmission(
                updatedSession.matchId(),
                userId,
                submission);

        return afterPlayerFinished(
                updatedSession,
                playerForUser(updatedSession, userId).username() + " finished building.");
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
            ObjectNode loadout = encodedLoadoutNode(selectedLoadout);
            if (loadout == null) brain.remove("loadout");
            else brain.set("loadout", loadout);
            submission.setSelectedLoadout(selectedLoadout);
            submission.setBrainPayload(jsonMapper.writeValueAsString(brain));
        } catch (Exception exception) {
            throw new AuthException("authoritative bot loadout could not be applied");
        }
    }

    private ObjectNode encodedLoadoutNode(String selectedLoadout) {
        if (selectedLoadout == null || !selectedLoadout.startsWith("custom:")) return null;
        String[] parts = selectedLoadout.split(":", -1);
        if (parts.length != 3) return null;
        String[] points = parts[2].split(",", -1);
        if (points.length != 4) return null;

        ObjectNode loadout = jsonMapper.createObjectNode();
        var abilityArray = loadout.putArray("abilities");
        for (int index = 0; index < parts[1].length(); index++) {
            String code = String.valueOf(parts[1].charAt(index));
            Integer abilityId = CompactAbilityCode.idForCode(code);
            if (abilityId != null) abilityArray.add(abilityId);
        }
        ObjectNode statPoints = loadout.putObject("statPoints");
        for (int index = 0; index < points.length; index++) {
            try {
                statPoints.put(List.of("maxHp", "moveSpeed", "attackDamage", "attackSpeed").get(index),
                        Math.max(0, Math.min(12, Integer.parseInt(points[index]))));
            } catch (NumberFormatException exception) {
                return null;
            }
        }
        return loadout;
    }

    private List<OutboundMatchmakingEvent> afterPlayerFinished(
            MatchSession updatedSession,
            String waitingMessage) {
        if (!updatedSession.players().stream().allMatch(MatchPlayer::finished)) {
            return updatedSession.players().stream()
                    .map(player -> eventForPlayer(
                            updatedSession,
                            player,
                            "PLAYER_FINISHED",
                            "WAITING_FOR_FINISH",
                            null,
                            waitingMessage))
                    .toList();
        }

        return updatedSession.players().stream()
                .map(player -> eventForPlayer(
                        updatedSession,
                        player,
                        "SIMULATION_LOADING",
                        "SIMULATION_LOADING",
                        null,
                        "Loading the authoritative round replay."))
                .toList();
    }

    @Transactional
    public List<OutboundMatchmakingEvent> completeSimulation(UUID matchId) {
        MatchSession simulationSession = withMatchLock(matchId, () -> claimSimulationLocked(matchId));
        if (simulationSession == null) return List.of();
        SimulationKey simulationKey = new SimulationKey(matchId, simulationSession.roundNumber());
        try {
            Map<UUID, BotSubmission> submissionsByUserId =
                    matchPersistenceService.loadFinishedSubmissions(simulationSession);
            MatchPlaybackDTO playback =
                    matchSimulationService.buildDuelPlayback(simulationSession, submissionsByUserId);
            PreparedReplay preparedReplay = prepareReplay(playback);
            return withMatchLock(matchId, () -> completeSimulationLocked(
                    simulationSession,
                    submissionsByUserId,
                    playback,
                    preparedReplay));
        } finally {
            simulationsInProgress.remove(simulationKey);
        }
    }

    private MatchSession claimSimulationLocked(UUID matchId) {
        MatchSession simulationSession = activeSessionsByUserId.values().stream()
                .filter(session -> session.matchId().equals(matchId))
                .findFirst()
                .orElse(null);
        if (simulationSession == null
                || !simulationSession.players().stream().allMatch(MatchPlayer::finished)) {
            return null;
        }
        SimulationKey simulationKey = new SimulationKey(matchId, simulationSession.roundNumber());
        return simulationsInProgress.add(simulationKey) ? simulationSession : null;
    }

    private List<OutboundMatchmakingEvent> completeSimulationLocked(
            MatchSession simulationSession,
            Map<UUID, BotSubmission> submissionsByUserId,
            MatchPlaybackDTO calculatedPlayback,
            PreparedReplay preparedReplay) {
        MatchSession currentSession = activeSessionsByUserId.values().stream()
                .filter(session -> session.matchId().equals(simulationSession.matchId()))
                .findFirst()
                .orElse(null);
        if (!simulationSession.equals(currentSession)) return List.of();

        MatchPlaybackDTO playback = calculatedPlayback;
        MatchSession scoredSession = simulationSession.withRoundResult(playback.winnerUserId());
        roundHistoryByMatchId.computeIfAbsent(simulationSession.matchId(), ignored -> new ArrayList<>())
                .add(new RoundSubmissionRecord(
                        simulationSession.roundNumber(),
                        playback.winnerUserId(),
                        Map.copyOf(submissionsByUserId),
                        roundLossScores(simulationSession, playback)));
        boolean seriesComplete = simulationSession.roundNumber() >= TOTAL_ROUNDS
                || scoredSession.players().stream().anyMatch(player -> player.roundWins() >= WINS_REQUIRED);
        if (seriesComplete) {
            UUID seriesWinner = seriesWinner(scoredSession);
            playback = withWinner(playback, seriesWinner,
                    seriesWinner == null ? "The best-of-three match ended tied." : playerForUser(scoredSession, seriesWinner).username() + " wins the best-of-three match.");
            matchPersistenceService.completeMatch(scoredSession.matchId(), playback);

            for (MatchPlayer player : scoredSession.players()) {
                activeSessionsByUserId.remove(player.userId());
                matchConnectionService.clear(player.userId());
            }
        }
        if (playback != calculatedPlayback) {
            preparedReplay = prepareReplay(playback);
        }
        long replayDurationMillis = preparedReplay.replayDurationMillis();

        // Do not stamp the shared playback deadline until the complete replay,
        // result construction, and reconnect data are all ready.
        Instant preparationCompletedAt = Instant.now(clock);
        Instant playbackStartsAt = preparationCompletedAt.plusMillis(PLAYBACK_PREP_DELAY_MILLIS);
        Instant resultRevealsAt = playbackStartsAt.plusMillis(replayDurationMillis);
        Instant roundReadyAt = resultRevealsAt.plusMillis(ROUND_RESULT_HOLD_MILLIS);
        long roundReadyDelayMillis = Math.max(
                0,
                java.time.Duration.between(preparationCompletedAt, roundReadyAt).toMillis());
        MatchSession scoredPreparedSession = scoredSession.withPlaybackStartsAt(playbackStartsAt);
        if (seriesComplete) {
            openMatchChatWindow(
                    scoredSession,
                    resultRevealsAt.plusMillis(MATCH_CHAT_RETENTION_MILLIS));
        }
        List<OutboundMatchmakingEvent> events = new ArrayList<>();
        for (MatchPlayer player : scoredSession.players()) {
            events.add(eventForPlayer(
                    scoredPreparedSession,
                    player,
                    "SIMULATION_PREPARING",
                    "SIMULATION_PREPARING",
                    initialReplayBatch(playback),
                    "Preparing the authoritative round replay.",
                    0,
                    playbackStartsAt,
                    resultRevealsAt,
                    roundReadyAt));
            for (PreparedReplayBatch batch : preparedReplay.batches()) {
                events.add(eventForPlayer(
                        scoredPreparedSession,
                        player,
                        "MATCH_REPLAY_BATCH",
                        "READY_FOR_PLAYBACK",
                        batch.playback(),
                        batch.terminalBatch() ? "Terminal replay frame ready." : "Replay frames ready.",
                        Math.max(0, PLAYBACK_PREP_DELAY_MILLIS
                                + batch.playback().replayCursorElapsedMs()
                                - REPLAY_LOOKAHEAD_MILLIS),
                        playbackStartsAt,
                        resultRevealsAt,
                        roundReadyAt));
            }
        }
        MatchSession nextRoundSession = null;
        if (!seriesComplete) {
            // The next selection phase is not active until MATCH_ROUND_READY
            // is published. Its 62-second authoritative deadline is created
            // by activateRoundLoadoutSelection at that phase boundary.
            nextRoundSession = scoredSession.nextRound();
            for (MatchPlayer player : nextRoundSession.players()) {
                activeSessionsByUserId.put(player.userId(), nextRoundSession);
                events.add(eventForPlayer(
                        nextRoundSession,
                        player,
                        "MATCH_ROUND_READY",
                        "LOADOUT_SELECT",
                        null,
                        "Round " + nextRoundSession.roundNumber() + " loadout ready.",
                        roundReadyDelayMillis,
                        playbackStartsAt,
                        resultRevealsAt,
                        roundReadyAt));
            }
        }
        ReplayResumeState replayResume = new ReplayResumeState(
                scoredPreparedSession,
                scoredSession,
                nextRoundSession,
                preparedReplay.replayPlayback(),
                playbackStartsAt,
                resultRevealsAt,
                roundReadyAt,
                playback.message(),
                seriesComplete);
        for (MatchPlayer player : scoredSession.players()) {
            replayResumeByUserId.put(player.userId(), replayResume);
        }
        if (seriesComplete) {
            roundHistoryByMatchId.remove(simulationSession.matchId());
        }
        return events;
    }

    private List<OutboundMatchmakingEvent> replayEventsForReconnect(UUID userId, ReplayResumeState resume) {
        Instant now = Instant.now(clock);
        MatchPlayer replayPlayer = playerForUser(resume.replaySession(), userId);
        if (now.isBefore(resume.resultRevealsAt())) {
            return List.of(eventForPlayer(
                    resume.replaySession(), replayPlayer, "SIMULATION_PREPARING", "SIMULATION_PREPARING",
                    authorizedReplayForReconnect(resume, now), "Replay ready.", 0,
                    resume.playbackStartsAt(), resume.resultRevealsAt(), resume.roundReadyAt()));
        }
        if (resume.seriesComplete()) return List.of();
        if (resume.nextRoundSession() == null) return List.of();

        MatchPlayer nextRoundPlayer = playerForUser(resume.nextRoundSession(), userId);
        MatchPlayer resultPlayer = playerForUser(resume.resultSession(), userId);
        List<OutboundMatchmakingEvent> events = new ArrayList<>(List.of(
                eventForPlayer(
                            resume.resultSession(), resultPlayer, "SIMULATION_PREPARING", "SIMULATION_PREPARING",
                        resume.replayPlayback(), "Replay ready.", 0,
                        resume.playbackStartsAt(), resume.resultRevealsAt(), resume.roundReadyAt())));
        if (!now.isBefore(resume.roundReadyAt())) {
            events.add(eventForPlayer(
                    resume.nextRoundSession(), nextRoundPlayer, "MATCH_ROUND_READY", "LOADOUT_SELECT",
                    null, "Round " + resume.nextRoundSession().roundNumber() + " loadout ready.",
                    0, resume.playbackStartsAt(), resume.resultRevealsAt(), resume.roundReadyAt()));
        }
        return events;
    }

    private PreparedReplay prepareReplay(MatchPlaybackDTO playback) {
        MatchPlaybackDTO replayPlayback = playback;
        int replayDurationMillis = finalReplayElapsedMs(replayPlayback);
        return new PreparedReplay(
                replayPlayback,
                replayDurationMillis,
                prepareReplayBatches(replayPlayback));
    }

    private List<PreparedReplayBatch> prepareReplayBatches(MatchPlaybackDTO playback) {
        int finalElapsedMs = finalReplayElapsedMs(playback);
        if (finalElapsedMs <= 0) return List.of();
        List<PreparedReplayBatch> batches = new ArrayList<>();
        int sequence = 1;
        for (int startMs = 0; startMs < finalElapsedMs; startMs += REPLAY_BATCH_MILLIS) {
            int windowStartMs = startMs;
            int endMs = Math.min(finalElapsedMs, windowStartMs + REPLAY_BATCH_MILLIS);
            List<MatchPlaybackDTO.ReplayFrameDTO> frames = playback.frames().stream()
                    .filter(frame -> frame.elapsedMs() > windowStartMs
                            || (windowStartMs == 0 && frame.elapsedMs() == 0))
                    .filter(frame -> frame.elapsedMs() <= endMs)
                    .toList();
            if (!frames.isEmpty()) {
                boolean terminalBatch = frames.getLast().elapsedMs() >= finalElapsedMs;
                batches.add(new PreparedReplayBatch(
                        replayBatch(playback, null, frames, sequence, frames.getLast().elapsedMs(), terminalBatch),
                        terminalBatch));
            }
            sequence++;
        }
        return List.copyOf(batches);
    }

    private MatchPlaybackDTO authorizedReplayForReconnect(ReplayResumeState resume, Instant now) {
        MatchPlaybackDTO playback = resume.replayPlayback();
        long signedElapsedMs = java.time.Duration.between(resume.playbackStartsAt(), now).toMillis();
        long authorizationCursorMs = signedElapsedMs + REPLAY_LOOKAHEAD_MILLIS;
        int finalElapsedMs = finalReplayElapsedMs(playback);
        long authorizedThroughMs = authorizationCursorMs >= finalElapsedMs
                ? finalElapsedMs
                : Math.max(0, authorizationCursorMs / REPLAY_BATCH_MILLIS * REPLAY_BATCH_MILLIS);
        List<MatchPlaybackDTO.ReplayFrameDTO> frames = playback.frames().stream()
                .filter(frame -> frame.elapsedMs() <= authorizedThroughMs)
                .toList();
        int cursor = frames.isEmpty() ? 0 : frames.getLast().elapsedMs();
        boolean terminal = cursor >= finalReplayElapsedMs(playback);
        int sequence = cursor <= 0 ? 0 : Math.max(1, (cursor - 1) / REPLAY_BATCH_MILLIS + 1);
        return replayBatch(playback, playback.initialState(), frames, sequence, cursor, terminal);
    }

    private MatchPlaybackDTO initialReplayBatch(MatchPlaybackDTO playback) {
        return replayBatch(playback, playback.initialState(), List.of(), 0, 0,
                finalReplayElapsedMs(playback) == 0);
    }

    private MatchPlaybackDTO replayBatch(
            MatchPlaybackDTO playback,
            MatchPlaybackDTO.ArenaStateDTO initialState,
            List<MatchPlaybackDTO.ReplayFrameDTO> frames,
            int sequence,
            int cursorElapsedMs,
            boolean terminalBatch) {
        return new MatchPlaybackDTO(
                playback.matchId(), playback.rulesetVersion(), playback.status(), initialState,
                List.copyOf(frames),
                terminalBatch ? playback.result() : null,
                terminalBatch ? playback.winnerUserId() : null,
                terminalBatch ? playback.message() : null,
                sequence, cursorElapsedMs, terminalBatch);
    }

    private int finalReplayElapsedMs(MatchPlaybackDTO playback) {
        return playback.frames().isEmpty() ? 0 : playback.frames().getLast().elapsedMs();
    }

    private MatchPlaybackDTO withWinner(MatchPlaybackDTO playback, UUID winnerUserId, String message) {
        return new MatchPlaybackDTO(playback.matchId(), playback.rulesetVersion(), playback.status(),
                playback.initialState(), playback.frames(), winnerUserId == null ? "DRAW" : "BOT_WIN",
                winnerUserId, message);
    }

    private Map<UUID, Double> roundLossScores(MatchSession session, MatchPlaybackDTO playback) {
        Map<UUID, Double> scores = new HashMap<>();
        session.players().forEach(player -> scores.put(player.userId(), 0.0));
        if (playback.winnerUserId() == null) return Map.copyOf(scores);
        MatchPlayer winner = playerForUser(session, playback.winnerUserId());
        MatchPlayer loser = session.players().stream().filter(player -> !player.userId().equals(winner.userId())).findFirst().orElseThrow();
        if (loser.slot() == 2) {
            MatchPlaybackDTO.BotStateDTO finalWinner = playback.frames().isEmpty() ? null
                    : playback.frames().getLast().bots().stream()
                            .filter(bot -> winner.userId().equals(bot.userId()))
                            .findFirst()
                            .orElse(null);
            double winnerMaxHp = finalWinner == null ? 100.0 : Math.max(1.0, finalWinner.maxHp());
            double winnerHp = finalWinner == null ? winnerMaxHp : Math.max(0.0, finalWinner.hp());
            scores.put(loser.userId(), Math.max(0.0, Math.min(1.0, (winnerMaxHp - winnerHp) / winnerMaxHp)));
        } else {
            int elapsedMs = playback.frames().isEmpty() ? 0 : playback.frames().get(playback.frames().size() - 1).elapsedMs();
            scores.put(loser.userId(), Math.max(0.0, Math.min(1.0, elapsedMs / 60_000.0)));
        }
        return Map.copyOf(scores);
    }

    private UUID seriesWinner(MatchSession session) {
        MatchPlayer first = session.players().get(0);
        MatchPlayer second = session.players().get(1);
        if (first.roundWins() != second.roundWins()) return first.roundWins() > second.roundWins() ? first.userId() : second.userId();
        Map<UUID, Double> totals = new HashMap<>();
        roundHistoryByMatchId.getOrDefault(session.matchId(), List.of()).forEach(round ->
                round.lossScores().forEach((userId, score) -> totals.merge(userId, score, Double::sum)));
        double firstScore = totals.getOrDefault(first.userId(), 0.0);
        double secondScore = totals.getOrDefault(second.userId(), 0.0);
        if (Math.abs(firstScore - secondScore) < 0.000001) return null;
        return firstScore > secondScore ? first.userId() : second.userId();
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
        Instant buildingEndsAt = countdownEndsAt.plusSeconds(BUILDING_SECONDS + SUBMISSION_GRACE_SECONDS);
        MatchSession countdownSession = session.withCountdown(countdownEndsAt, buildingEndsAt);
        for (MatchPlayer player : countdownSession.players()) {
            activeSessionsByUserId.put(player.userId(), countdownSession);
            matchPersistenceService.updateParticipantSelectedLoadout(
                    countdownSession.matchId(),
                    player);
        }
        return countdownSession.players().stream()
                .map(player -> eventForPlayer(
                        countdownSession,
                        player,
                        type,
                        "PREP",
                        null,
                        message))
                .toList();
    }

    private String normalizeSelectedLoadout(String selectedLoadout) {
        if (selectedLoadout != null && selectedLoadout.matches("custom:[A-Za-z0-9]{0,6}:(?:[0-9]|1[0-2])(?:,(?:[0-9]|1[0-2])){3}")) return selectedLoadout;
        if ("custom".equals(selectedLoadout)) return "custom";
        if ("ranged".equals(selectedLoadout)) return "ranged";
        if ("mage".equals(selectedLoadout)) return "mage";
        return "melee";
    }

    private String submissionLoadoutId(BotSubmission submission) {
        if (submission == null || submission.getBrainPayload() == null) return null;
        try {
            JsonNode loadout = jsonMapper.readTree(submission.getBrainPayload()).path("loadout");
            if (!loadout.isObject()) return null;
            List<String> selectedCodes = new ArrayList<>();
            loadout.path("abilities").forEach(ability -> {
                String code = ability.isIntegralNumber() && ability.canConvertToInt()
                        ? CompactAbilityCode.codeForId(ability.intValue()) : null;
                if (code != null) selectedCodes.add(code);
            });
            selectedCodes.sort(String::compareTo);
            JsonNode stats = loadout.path("statPoints");
            String points = stats.path("maxHp").asInt(0)
                    + "," + stats.path("moveSpeed").asInt(0)
                    + "," + stats.path("attackDamage").asInt(0)
                    + "," + stats.path("attackSpeed").asInt(0);
            return "custom:" + String.join("", selectedCodes) + ":" + points;
        } catch (Exception ignored) {
            return null;
        }
    }

    private void validateRoundLoadoutBudget(String loadout, int roundNumber) {
        if (loadout == null || !loadout.startsWith("custom:")) return;
        String[] parts = loadout.split(":", -1);
        String[] points = parts.length == 3 ? parts[2].split(",", -1) : new String[0];
        int total = 0;
        try {
            for (String point : points) total += Integer.parseInt(point);
        } catch (NumberFormatException ex) {
            throw new AuthException("bot loadout stat points are invalid");
        }
        if (points.length != 4 || total > Math.min(TOTAL_ROUNDS, Math.max(1, roundNumber)) * 4) {
            throw new AuthException("bot loadout exceeds this round's stat point budget");
        }
    }

    private void validateRoundAbilityDraft(MatchSession session, MatchPlayer player, String nextLoadout) {
        if (nextLoadout == null || !nextLoadout.startsWith("custom:")) return;
        int roundNumber = session.roundNumber();
        String nextCodes = nextLoadout.split(":", -1)[1];
        String previousLoadout = player.selectedLoadout();
        String previousCodes = previousLoadout != null && previousLoadout.startsWith("custom:")
                ? previousLoadout.split(":", -1)[1]
                : "";
        Set<Integer> previous = previousCodes.chars().boxed().collect(java.util.stream.Collectors.toSet());
        Set<Integer> next = nextCodes.chars().boxed().collect(java.util.stream.Collectors.toSet());
        Set<Integer> offered = abilityOffers(session).stream()
                .map(CompactAbilityCode::codeForId)
                .filter(java.util.Objects::nonNull)
                .map(code -> (int) code.charAt(0))
                .collect(java.util.stream.Collectors.toSet());
        Set<Integer> drafted = new java.util.HashSet<>(next);
        drafted.removeAll(previous);
        int requiredPicks = ROUND_PICK_COUNTS.getOrDefault(roundNumber, 0);
        if (!next.containsAll(previous) || drafted.size() != requiredPicks
                || !offered.containsAll(drafted) || next.size() > MAX_EQUIPPED_ABILITIES) {
            throw new AuthException("bot loadout must retain prior abilities and choose exactly " + requiredPicks + " abilities from this round's offers");
        }
    }

    private String completeRoundAbilityDraft(MatchSession session, MatchPlayer player, String nextLoadout) {
        if (nextLoadout == null || !nextLoadout.startsWith("custom:")) return nextLoadout;
        String[] parts = nextLoadout.split(":", -1);
        String nextCodes = parts[1];
        String previousLoadout = player.selectedLoadout();
        String previousCodes = previousLoadout != null && previousLoadout.startsWith("custom:")
                ? previousLoadout.split(":", -1)[1]
                : "";
        Set<Integer> previous = previousCodes.chars().boxed().collect(java.util.stream.Collectors.toSet());
        Set<Integer> next = nextCodes.chars().boxed().collect(java.util.stream.Collectors.toSet());
        Set<Integer> offered = abilityOffers(session).stream()
                .map(CompactAbilityCode::codeForId)
                .filter(java.util.Objects::nonNull)
                .map(code -> (int) code.charAt(0))
                .collect(java.util.stream.Collectors.toSet());
        Set<Integer> drafted = new java.util.HashSet<>(next);
        drafted.removeAll(previous);
        int requiredPicks = ROUND_PICK_COUNTS.getOrDefault(session.roundNumber(), 0);
        if (next.size() != nextCodes.length() || !next.containsAll(previous)
                || drafted.size() > requiredPicks || !offered.containsAll(drafted)
                || next.size() > MAX_EQUIPPED_ABILITIES) {
            throw new AuthException("bot loadout must retain prior abilities and choose up to "
                    + requiredPicks + " abilities from this round's offers");
        }

        int missingPicks = requiredPicks - drafted.size();
        List<Integer> additions = automaticAbilityPicks(session, player, drafted, missingPicks);
        String abilities = java.util.stream.Stream.concat(
                        nextCodes.chars().mapToObj(value -> Character.toString((char) value)),
                        additions.stream().map(CompactAbilityCode::codeForId))
                .sorted()
                .collect(java.util.stream.Collectors.joining());
        return "custom:" + abilities + ":" + parts[2];
    }

    private List<Integer> abilityOffers(MatchSession session) {
        List<Integer> offers = new ArrayList<>(ROUND_ABILITIES.getOrDefault(session.roundNumber(), List.of()));
        long seed = session.simulationSeed() ^ (0x9E3779B97F4A7C15L * session.roundNumber());
        Collections.shuffle(offers, new Random(seed));
        return List.copyOf(offers.subList(0, Math.min(ROUND_OFFER_COUNTS.getOrDefault(session.roundNumber(), 0), offers.size())));
    }

    private MatchSession withDefaultAbilitySelections(MatchSession session) {
        MatchSession result = session;
        for (MatchPlayer player : session.players()) {
            if (player.loadoutSelected()) continue;
            String current = player.selectedLoadout() != null && player.selectedLoadout().startsWith("custom:")
                    ? player.selectedLoadout() : "custom::0,0,0,0";
            result = result.withSelectedLoadout(
                    player.userId(),
                    completeRoundAbilityDraft(session, player, current),
                    true);
        }
        return result;
    }

    private List<Integer> automaticAbilityPicks(
            MatchSession session,
            MatchPlayer player,
            Set<Integer> excludedCodes,
            int pickCount) {
        List<Integer> picks = new ArrayList<>(abilityOffers(session));
        picks.removeIf(ability -> {
            String code = CompactAbilityCode.codeForId(ability);
            return code == null || excludedCodes.contains((int) code.charAt(0));
        });
        long seed = session.simulationSeed() ^ player.userId().getMostSignificantBits()
                ^ player.userId().getLeastSignificantBits() ^ (0xD1B54A32D192ED03L * session.roundNumber());
        Collections.shuffle(picks, new Random(seed));
        return picks.subList(0, Math.min(pickCount, picks.size()));
    }

    private void clearSession(MatchSession session) {
        openMatchChatWindow(session);
        for (MatchPlayer player : session.players()) {
            activeSessionsByUserId.remove(player.userId());
            replayResumeByUserId.remove(player.userId());
            matchConnectionService.clear(player.userId());
        }
        roundHistoryByMatchId.remove(session.matchId());
    }

    private void openMatchChatWindow(MatchSession session) {
        openMatchChatWindow(
                session,
                Instant.now(clock).plusMillis(MATCH_CHAT_RETENTION_MILLIS));
    }

    private void openMatchChatWindow(MatchSession session, Instant closesAt) {
        Map<UUID, MatchChatParticipant> participants = new HashMap<>();
        for (MatchPlayer player : session.players()) {
            participants.put(
                    player.userId(),
                    new MatchChatParticipant(player.username(), player.principalName()));
        }
        matchChatWindowsByMatchId.put(
                session.matchId(),
                new MatchChatWindow(
                        closesAt,
                        Map.copyOf(participants)));
    }

    private void validateRoundBrainPolicy(MatchSession session, UUID userId, BotSubmission submission) {
        JsonNode currentBrain = readSubmissionBrain(submission);
        Map<String, String> currentBlocks = blockFingerprints(currentBrain);
        List<RoundSubmissionRecord> history = roundHistoryByMatchId.getOrDefault(session.matchId(), List.of());
        if (history.isEmpty()) {
            if (currentBlocks.size() > ROUND_LOGIC_BLOCK_LIMIT) {
                throw new AuthException("round 1 exceeds the per-round logic block limit");
            }
            return;
        }

        if (session.roundNumber() == 3) {
            if (currentBlocks.size() > ROUND_LOGIC_BLOCK_LIMIT) {
                throw new AuthException("round 3 exceeds the per-round logic block limit");
            }
            return;
        }

        Map<Integer, Map<String, String>> blocksByRound = new HashMap<>();
        Map<String, Integer> introducedRoundById = new HashMap<>();
        for (RoundSubmissionRecord round : history) {
            BotSubmission historicalSubmission = round.submissionsByUser().get(userId);
            if (historicalSubmission == null) continue;
            Map<String, String> blocks = blockFingerprints(readSubmissionBrain(historicalSubmission));
            blocksByRound.put(round.roundNumber(), blocks);
            blocks.keySet().forEach(id -> introducedRoundById.putIfAbsent(id, round.roundNumber()));
        }

        RoundSubmissionRecord previousRound = history.get(history.size() - 1);
        Map<String, String> previousBlocks = blocksByRound.getOrDefault(previousRound.roundNumber(), Map.of());
        boolean previousWinner = userId.equals(previousRound.winnerUserId());

        long newBlockCount = currentBlocks.keySet().stream()
                .filter(id -> !introducedRoundById.containsKey(id))
                .count();
        if (newBlockCount > ROUND_LOGIC_BLOCK_LIMIT) {
            throw new AuthException("current round exceeds the per-round logic block limit");
        }

        for (Map.Entry<String, Integer> introduced : introducedRoundById.entrySet()) {
            String id = introduced.getKey();
            boolean currentlyPresent = currentBlocks.containsKey(id);
            boolean presentLastRound = previousBlocks.containsKey(id);
            if (!presentLastRound && currentlyPresent) {
                throw new AuthException("a deleted prior-round logic block cannot be reintroduced");
            }
            if (introduced.getValue() <= session.roundNumber() - 2) {
                if (presentLastRound
                        && (!currentlyPresent || !currentBlocks.get(id).equals(previousBlocks.get(id)))) {
                    throw new AuthException("logic blocks from two or more rounds ago are locked");
                }
            } else if (presentLastRound && currentlyPresent
                    && !currentBlocks.get(id).equals(previousBlocks.get(id))) {
                throw new AuthException("previous-round logic blocks may only be deleted");
            }
        }
    }

    private List<RoundBrainDTO> roundBrainsForPlayer(UUID matchId, UUID userId) {
        return roundHistoryByMatchId.getOrDefault(matchId, List.of()).stream()
                .map(round -> {
                    BotSubmission submission = round.submissionsByUser().get(userId);
                    if (submission == null) return null;
                    return new RoundBrainDTO(
                            round.roundNumber(),
                            readSubmissionBrain(submission),
                            userId.equals(round.winnerUserId()));
                })
                .filter(round -> round != null)
                .toList();
    }

    private Boolean previousRoundWon(UUID matchId, UUID userId) {
        List<RoundSubmissionRecord> history = roundHistoryByMatchId.getOrDefault(matchId, List.of());
        if (history.isEmpty()) return null;
        return userId.equals(history.get(history.size() - 1).winnerUserId());
    }

    private JsonNode readSubmissionBrain(BotSubmission submission) {
        try {
            return jsonMapper.readTree(submission.getBrainPayload());
        } catch (Exception exception) {
            throw new AuthException("submitted brain could not be read");
        }
    }

    private Map<String, String> blockFingerprints(JsonNode brain) {
        Map<String, String> fingerprints = new HashMap<>();
        JsonNode roots = brain != null ? brain.get("roots") : null;
        if (roots != null && roots.isArray()) {
            for (int rootIndex = 0; rootIndex < roots.size(); rootIndex += 1) {
                JsonNode root = roots.get(rootIndex);
                JsonNode priority = root != null ? root.get("createdOrder") : null;
                String rootPriority = priority != null && priority.isNumber() ? priority.asText() : String.valueOf(rootIndex);
                addTreeFingerprints(fingerprints, root.get("branches"), "root:" + rootPriority);
            }
        }
        return fingerprints;
    }

    private void addTreeFingerprints(Map<String, String> fingerprints, JsonNode branches, String context) {
        if (branches == null || !branches.isArray()) return;
        branches.forEach(branch -> {
            String branchContext = context + ":" + fieldText(branch, "createdOrder");
            addBlockFingerprint(fingerprints, branch, branchContext);
            addTreeFingerprints(fingerprints, branch.get("children"), branchContext + ":" + fieldText(branch, "id"));
        });
    }

    private void addBlockFingerprint(Map<String, String> fingerprints, JsonNode block, String context) {
        String id = fieldText(block, "id");
        if (id.isBlank() || fingerprints.putIfAbsent(id, context + ":" + block) != null) {
            throw new AuthException("logic block IDs must be present and unique across rounds");
        }
    }

    private static String fieldText(JsonNode node, String field) {
        JsonNode value = node != null ? node.get(field) : null;
        return value != null ? value.asText() : "";
    }

    private OutboundMatchmakingEvent disconnectEventForPlayer(
            MatchSession session,
            MatchPlayer recipient,
            MatchPlayer disconnectedPlayer,
            String type,
            Instant deadline,
            String message) {
        return disconnectEventForPlayer(session, recipient, disconnectedPlayer, type, deadline, message, null);
    }

    private OutboundMatchmakingEvent disconnectEventForPlayer(
            MatchSession session,
            MatchPlayer recipient,
            MatchPlayer disconnectedPlayer,
            String type,
            Instant deadline,
            String message,
            MatchPlaybackDTO playback) {
        MatchPlayer opponent = session.players().stream()
                .filter(candidate -> !candidate.userId().equals(recipient.userId()))
                .findFirst()
                .orElse(null);
        UUID activeDisconnectedUserId = deadline != null
                ? disconnectedPlayer.userId()
                : session.players().stream()
                        .filter(candidate -> matchConnectionService.disconnectDeadline(candidate.userId()) != null)
                        .map(MatchPlayer::userId)
                        .findFirst()
                        .orElse(null);
        Instant activeDisconnectEndsAt = deadline != null
                ? deadline
                : activeDisconnectedUserId == null
                        ? null
                        : matchConnectionService.disconnectDeadline(activeDisconnectedUserId);
        String status = session.playbackStartsAt() != null
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
                        playback,
                        session.roundNumber(),
                        session.winsRequired(),
                        message,
                        null,
                        List.of(),
                        session.arenaEntities(),
                        roundBrainsForPlayer(session.matchId(), recipient.userId()),
                        previousRoundWon(session.matchId(), recipient.userId()),
                        abilityOffers(session),
                        ROUND_LOGIC_BLOCK_LIMIT,
                        activeDisconnectedUserId,
                        activeDisconnectEndsAt,
                        null,
                        null,
                        matchChatCloseAt(session.matchId())));
    }

    private List<OutboundMatchmakingEvent> playerReconnectedEvents(
            MatchSession session,
            MatchPlayer reconnectingPlayer,
            MatchPlaybackDTO preparationPlayback) {
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

    private OutboundMatchmakingEvent resumePhaseEvent(
            MatchSession session,
            MatchPlayer player,
            MatchPlaybackDTO preparationPlayback) {
        if (session.playbackStartsAt() != null) {
            return eventForPlayer(
                    session,
                    player,
                    "SIMULATION_PREPARING",
                    "SIMULATION_PREPARING",
                    preparationPlayback,
                    "Preparing the authoritative round replay.",
                    0,
                    session.playbackStartsAt(),
                    null,
                    null);
        }
        if (session.players().stream().allMatch(MatchPlayer::finished)) {
            return eventForPlayer(
                    session,
                    player,
                    "SIMULATION_LOADING",
                    "SIMULATION_LOADING",
                    null,
                    "Loading the authoritative round replay.");
        }
        return eventForPlayer(session, player, "MATCH_FOUND");
    }

    private OutboundMatchmakingEvent noActiveMatchEvent(
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

    private OutboundMatchmakingEvent eventForPlayer(MatchSession session, MatchPlayer player, String type) {
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
        return eventForPlayer(session, player, type, status, null, null);
    }

    private OutboundMatchmakingEvent eventForPlayer(
            MatchSession session,
            MatchPlayer player,
            String type,
            String status,
            MatchPlaybackDTO playback,
            String message) {
        return eventForPlayer(session, player, type, status, playback, message, null, List.of());
    }

    private OutboundMatchmakingEvent eventForPlayer(
            MatchSession session,
            MatchPlayer player,
            String type,
            String status,
            MatchPlaybackDTO playback,
            String message,
            UUID entityPlacementUserId,
            List<MatchPlaybackDTO.ArenaEntityDTO> entityPlacements) {
        return eventForPlayer(
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

    private OutboundMatchmakingEvent eventForPlayer(
            MatchSession session,
            MatchPlayer player,
            String type,
            String status,
            MatchPlaybackDTO playback,
            String message,
            long delayMillis) {
        return eventForPlayer(session, player, type, status, playback, message, null, List.of(), delayMillis);
    }

    private OutboundMatchmakingEvent eventForPlayer(
            MatchSession session,
            MatchPlayer player,
            String type,
            String status,
            MatchPlaybackDTO playback,
            String message,
            UUID entityPlacementUserId,
            List<MatchPlaybackDTO.ArenaEntityDTO> entityPlacements,
            long delayMillis) {
        return eventForPlayer(
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

    private OutboundMatchmakingEvent eventForPlayer(
            MatchSession session,
            MatchPlayer player,
            String type,
            String status,
            MatchPlaybackDTO playback,
            String message,
            long delayMillis,
            Instant playbackStartsAt,
            Instant resultRevealsAt) {
        return eventForPlayer(
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

    private OutboundMatchmakingEvent eventForPlayer(
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
        return eventForPlayer(
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

    private OutboundMatchmakingEvent eventForPlayer(
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
        return eventForPlayer(
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

    private OutboundMatchmakingEvent eventForPlayer(
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
        if ("MATCH_REPLAY_BATCH".equals(type)) {
            MatchmakingEventDTO replayBatchEvent = MatchmakingEventDTO.replayBatch(
                    session.matchId(), MatchSimulationService.DUEL_RULESET_VERSION,
                    playback, playbackStartsAt, resultRevealsAt, roundReadyAt);
            if (playback != null && playback.terminalBatch()) {
                MatchPlayer opponent = session.players().stream()
                        .filter(candidate -> !candidate.userId().equals(player.userId()))
                        .findFirst().orElse(null);
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
                    replayBatchEvent.withMatchTerminal(
                            matchPersistenceService.isTerminalMatch(session.matchId())),
                    delayMillis,
                    playbackStartsAt.plusMillis(delayMillis - PLAYBACK_PREP_DELAY_MILLIS));
        }

        boolean replayPhaseEvent = Set.of(
                "SIMULATION_PREPARING",
                "MATCH_RESULT_READY").contains(type);
        boolean simulationPreparingEvent = "SIMULATION_PREPARING".equals(type);
        Instant eventNow = Instant.now(clock);
        Long simulationPreparingDurationMs = simulationPreparingEvent && playbackStartsAt != null
                ? Math.max(0, java.time.Duration.between(eventNow, playbackStartsAt).toMillis())
                : null;
        MatchPlayer opponent = session.players().stream()
                .filter(candidate -> !candidate.userId().equals(player.userId()))
                .findFirst()
                .orElse(null);
        UUID disconnectedUserId = session.players().stream()
                .filter(candidate -> matchConnectionService.disconnectDeadline(candidate.userId()) != null)
                .map(MatchPlayer::userId)
                .findFirst()
                .orElse(null);
        Instant disconnectEndsAt = disconnectedUserId == null
                ? null
                : matchConnectionService.disconnectDeadline(disconnectedUserId);
        return new OutboundMatchmakingEvent(
                player.principalName(),
                new MatchmakingEventDTO(
                        type,
                        session.matchId(),
                        session.simulationSeed(),
                        status,
                        player.toDto(session.entityPlacementsByUserId().containsKey(player.userId())),
                        opponent == null ? null : opponent.toDto(session.entityPlacementsByUserId().containsKey(opponent.userId())),
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
                        playback,
                        session.roundNumber(),
                        session.winsRequired(),
                        message,
                        entityPlacementUserId,
                        entityPlacements != null ? List.copyOf(entityPlacements) : List.of(),
                        session.arenaEntities(),
                        replayPhaseEvent
                                ? List.of()
                                : roundBrainsForPlayer(session.matchId(), player.userId()),
                        replayPhaseEvent
                                ? null
                                : previousRoundWon(session.matchId(), player.userId()),
                        replayPhaseEvent
                                ? List.of()
                                : abilityOffers(session),
                        replayPhaseEvent ? null : ROUND_LOGIC_BLOCK_LIMIT,
                        disconnectedUserId,
                        disconnectEndsAt,
                        simulationPreparingEvent ? simulationPreparingDurationMs : null,
                        roundReadyAt,
                        matchChatCloseAt(session.matchId()))
                        .withMatchTerminal(matchPersistenceService.isTerminalMatch(session.matchId())),
                delayMillis,
                "MATCH_ROUND_READY".equals(type) ? roundReadyAt : null);
    }

    private MatchPlayer playerForUser(MatchSession session, UUID userId) {
        return session.players().stream()
                .filter(player -> player.userId().equals(userId))
                .findFirst()
                .orElseThrow(() -> new AuthException("player is not in this match"));
    }

    private void replaceReplayResumeNextRoundSession(MatchSession nextRoundSession) {
        replayResumeByUserId.replaceAll((userId, resume) -> {
            if (resume.nextRoundSession() == null
                    || !resume.nextRoundSession().matchId().equals(nextRoundSession.matchId())
                    || resume.nextRoundSession().roundNumber() != nextRoundSession.roundNumber()) {
                return resume;
            }
            return resume.withNextRoundSession(nextRoundSession);
        });
    }

    public enum MatchChatSubmissionStatus { ACCEPTED, RATE_LIMITED, REJECTED }

    private record MatchChatParticipant(String username, String principalName) {
    }

    private record MatchChatWindow(
            Instant closesAt,
            Map<UUID, MatchChatParticipant> participantsByUserId) {
    }

    public record MatchChatClosure(
            UUID matchId,
            String message,
            List<String> recipientPrincipalNames) {
    }

    public record MatchChatSubmission(
            MatchChatSubmissionStatus status,
            UUID messageId,
            UUID matchId,
            String username,
            String message,
            Instant sentAt,
            List<String> recipientPrincipalNames) {
        static MatchChatSubmission rateLimited(UUID matchId) {
            return new MatchChatSubmission(MatchChatSubmissionStatus.RATE_LIMITED, null, matchId, null,
                    "You are sending messages too quickly.", null, List.of());
        }

        static MatchChatSubmission rejected(UUID matchId, String message) {
            return new MatchChatSubmission(MatchChatSubmissionStatus.REJECTED, null, matchId, null,
                    message, null, List.of());
        }
    }

    public record MatchEntrant(
            UUID userId,
            String username,
            String principalName,
            String socketSessionId) {
    }

    private record RoundSubmissionRecord(
            int roundNumber,
            UUID winnerUserId,
            Map<UUID, BotSubmission> submissionsByUser,
            Map<UUID, Double> lossScores) {
    }

    private record SimulationKey(UUID matchId, int roundNumber) {
    }

    private record PreparedReplay(
            MatchPlaybackDTO replayPlayback,
            int replayDurationMillis,
            List<PreparedReplayBatch> batches) {
    }

    private record PreparedReplayBatch(
            MatchPlaybackDTO playback,
            boolean terminalBatch) {
    }

    private record ReplayResumeState(
            MatchSession replaySession,
            MatchSession resultSession,
            MatchSession nextRoundSession,
            MatchPlaybackDTO replayPlayback,
            Instant playbackStartsAt,
            Instant resultRevealsAt,
            Instant roundReadyAt,
            String message,
            boolean seriesComplete) {
        ReplayResumeState withNextRoundSession(MatchSession nextRoundSession) {
            return new ReplayResumeState(
                    replaySession,
                    resultSession,
                    nextRoundSession,
                    replayPlayback,
                    playbackStartsAt,
                    resultRevealsAt,
                    roundReadyAt,
                    message,
                    seriesComplete);
        }
    }

    public record MatchPlayer(
            UUID userId,
            String username,
            String principalName,
            int slot,
            boolean finished,
            UUID botSubmissionId,
            int roundWins,
            String selectedLoadout,
            boolean loadoutSelected) {
        MatchmakingPlayerDTO toDto() {
            return toDto(false);
        }

        MatchmakingPlayerDTO toDto(boolean entityPlacementSubmitted) {
            return new MatchmakingPlayerDTO(
                    userId,
                    username,
                    slot,
                    finished,
                    roundWins,
                    selectedLoadout,
                    loadoutSelected,
                    entityPlacementSubmitted);
        }
    }

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
            Instant playbackStartsAt) {
        public Instant buildingEndsAt() {
            return buildingEndsAt;
        }

        MatchSession(
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
                    null);
        }

        MatchSession withArenaEntities(List<MatchPlaybackDTO.ArenaEntityDTO> arenaEntities) {
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
                    arenaEntities != null ? List.copyOf(arenaEntities) : List.of(),
                    entityPlacementsByUserId,
                    playbackStartsAt);
        }

        MatchSession withFinishedPlayer(UUID userId, UUID botSubmissionId) {
            return new MatchSession(
                    matchId,
                    simulationSeed,
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
                    roundNumber,
                    winsRequired,
                    arenaEntities,
                    entityPlacementsByUserId,
                    playbackStartsAt);
        }

        MatchSession withRoundResult(UUID winnerUserId) {
            return new MatchSession(
                    matchId,
                    simulationSeed,
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
                    roundNumber,
                    winsRequired,
                    arenaEntities,
                    entityPlacementsByUserId,
                    playbackStartsAt);
        }

        MatchSession nextRound() {
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
                    null);
        }

        MatchSession withLoadoutSelection(Instant deadline) {
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
            return new MatchSession(matchId, simulationSeed, unlockedPlayers, deadline, null, null, null,
                    roundNumber, winsRequired, List.of(), Map.of(), null);
        }

        MatchSession withSelectedLoadout(UUID userId, String selectedLoadout, boolean loadoutSelected) {
            return new MatchSession(
                    matchId,
                    simulationSeed,
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
                                            loadoutSelected)
                    : player)
                            .toList(),
                    loadoutSelectionEndsAt,
                    entityPlacementEndsAt,
                    countdownEndsAt,
                    buildingEndsAt,
                    roundNumber,
                    winsRequired,
                    arenaEntities,
                    entityPlacementsByUserId,
                    playbackStartsAt);
        }

        MatchSession withDefaultLoadoutSelections() {
            return new MatchSession(
                    matchId,
                    simulationSeed,
                    players.stream()
                            .map(player -> new MatchPlayer(
                                    player.userId(),
                                    player.username(),
                                    player.principalName(),
                                    player.slot(),
                                    player.finished(),
                                    player.botSubmissionId(),
                                    player.roundWins(),
                                    player.selectedLoadout() != null ? player.selectedLoadout() : "custom::0,0,0,0",
                                    true))
                            .toList(),
                    loadoutSelectionEndsAt,
                    entityPlacementEndsAt,
                    countdownEndsAt,
                    buildingEndsAt,
                    roundNumber,
                    winsRequired,
                    arenaEntities,
                    entityPlacementsByUserId,
                    playbackStartsAt);
        }

        MatchSession withEntityPlacement(Instant nextEntityPlacementEndsAt) {
            return new MatchSession(
                    matchId,
                    simulationSeed,
                    players,
                    loadoutSelectionEndsAt,
                    nextEntityPlacementEndsAt,
                    null,
                    null,
                    roundNumber,
                    winsRequired,
                    List.of(),
                    Map.of(),
                    null);
        }

        MatchSession withEntityPlacements(UUID userId, List<MatchPlaybackDTO.ArenaEntityDTO> objects) {
            Map<UUID, List<MatchPlaybackDTO.ArenaEntityDTO>> placements = new HashMap<>(entityPlacementsByUserId);
            placements.put(userId, List.copyOf(objects != null ? objects : List.of()));
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
                    Map.copyOf(placements),
                    playbackStartsAt);
        }

        MatchSession withCountdown(Instant nextCountdownEndsAt, Instant nextBuildingEndsAt) {
            return new MatchSession(
                    matchId,
                    simulationSeed,
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
                    roundNumber,
                    winsRequired,
                    arenaEntities,
                    entityPlacementsByUserId,
                    null);
        }

        MatchSession withPlaybackStartsAt(Instant deadline) {
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
                    deadline);
        }
    }

    public record OutboundMatchmakingEvent(
            String principalName,
            MatchmakingEventDTO event,
            long delayMillis,
            Instant publishAt) {
        public OutboundMatchmakingEvent(String principalName, MatchmakingEventDTO event) {
            this(principalName, event, 0, null);
        }

        public OutboundMatchmakingEvent(String principalName, MatchmakingEventDTO event, long delayMillis) {
            this(principalName, event, delayMillis, null);
        }
    }
}
