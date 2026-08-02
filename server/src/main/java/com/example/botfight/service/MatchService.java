package com.example.botfight.service;

import com.example.botfight.DTO.MatchPlaybackDTO;
import com.example.botfight.DTO.ActiveMatchStatusDTO;
import com.example.botfight.DTO.MatchmakingEventDTO;
import com.example.botfight.DTO.MatchmakingPlayerDTO;
import com.example.botfight.DTO.MatchmakingEventDTO.RoundBrainDTO;
import com.example.botfight.domain.Match;
import com.example.botfight.domain.BotSubmission;
import com.example.botfight.simulation.ArenaUnits;
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
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.json.JsonMapper;

@Service
public class MatchService {

    private static final long PLAYBACK_PREP_DELAY_MILLIS = 3_000L;
    // Replay presentation is compressed after the authoritative duel is complete;
    // this does not change the rated simulation or its timeout deadline.
    private static final int REPLAY_PRESENTATION_DURATION_MILLIS = 5_000;
    private static final int REPLAY_BATCH_MILLIS = 1_000;
    private static final int REPLAY_BUFFER_MILLIS = 3_000;
    private static final long ROUND_RESULT_HOLD_MILLIS = 3_000L;
    private static final int LOADOUT_SELECTION_SECONDS = 60;
    private static final int TESTING_SECONDS = 30;
    private static final int SUBMISSION_GRACE_SECONDS = 2;
    private static final int TESTING_ROOM_PREPARATION_SECONDS = 2;
    private static final int WINS_REQUIRED = 2;
    private static final int TOTAL_ROUNDS = 3;
    private static final int MAX_EQUIPPED_ABILITIES = 6;
    private static final Map<Integer, Integer> ROUND_OFFER_COUNTS = Map.of(1, 6, 2, 4, 3, 3);
    private static final Map<Integer, Integer> ROUND_PICK_COUNTS = Map.of(1, 3, 2, 2, 3, 1);
    private static final Map<Integer, List<String>> ROUND_ABILITIES = Map.of(
            1, List.of("swing", "block", "dash", "fire_gun", "throw_grenade", "shoot_fireball", "stun", "heavy_slash", "repulsor_burst", "concussive_shot", "repair_pulse", "proximity_mine", "quick_jab", "pistol_shot"),
            2, List.of("rail_shot", "gravity_grenade", "silence_pulse", "reactive_armor", "hunter_drone", "thrust", "micro_dash"),
            3, List.of("temporal_rewind", "orbital_strike", "absolute_guard", "null_zone", "phase_strike"));
    private static final Map<String, String> ABILITY_CODES = Map.ofEntries(
            Map.entry("swing", "s"), Map.entry("block", "b"), Map.entry("dash", "d"), Map.entry("fire_gun", "g"),
            Map.entry("throw_grenade", "r"), Map.entry("shoot_fireball", "f"), Map.entry("stun", "t"), Map.entry("heavy_slash", "h"),
            Map.entry("repulsor_burst", "u"), Map.entry("concussive_shot", "c"), Map.entry("repair_pulse", "e"), Map.entry("proximity_mine", "m"),
            Map.entry("quick_jab", "j"), Map.entry("pistol_shot", "p"), Map.entry("rail_shot", "R"), Map.entry("gravity_grenade", "G"),
            Map.entry("silence_pulse", "S"), Map.entry("reactive_armor", "A"), Map.entry("hunter_drone", "H"), Map.entry("thrust", "T"),
            Map.entry("micro_dash", "M"), Map.entry("temporal_rewind", "w"), Map.entry("orbital_strike", "o"), Map.entry("absolute_guard", "a"),
            Map.entry("null_zone", "n"), Map.entry("phase_strike", "P"));
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
    private final Map<UUID, MatchSession> activeSessionsByUserId = new HashMap<>();
    private final Set<UUID> initialLoadoutSelectionStartedMatchIds = new java.util.HashSet<>();
    private final Set<UUID> invalidatedReplayMatchIds = new java.util.HashSet<>();
    private final Map<UUID, ReplayResumeState> replayResumeByUserId = new HashMap<>();
    private final Map<UUID, List<RoundSubmissionRecord>> roundHistoryByMatchId = new HashMap<>();
    private final Map<UUID, Map<UUID, Deque<Instant>>> chatMessageTimesByMatchAndUserId = new HashMap<>();
    private final Map<UUID, MatchChatWindow> matchChatWindowsByMatchId = new HashMap<>();
    private final JsonMapper jsonMapper = new JsonMapper();

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

    public synchronized ActiveMatchStatusDTO activeMatchStatus(UUID userId) {
        MatchSession session = activeSessionsByUserId.get(userId);
        if (session == null) {
            ReplayResumeState replayResume = replayResumeByUserId.get(userId);
            boolean resultStillPending = replayResume != null
                    && replayResume.seriesComplete()
                    && Instant.now(clock).isBefore(replayResume.resultRevealsAt());
            if (!resultStillPending) {
                replayResumeByUserId.remove(userId);
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

    public synchronized List<OutboundMatchmakingEvent> resumeMatch(
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
                        replayResume.preparationPlayback()));
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
    public synchronized List<OutboundMatchmakingEvent> startMatch(
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
                Instant.now(clock).plusSeconds(LOADOUT_SELECTION_SECONDS + SUBMISSION_GRACE_SECONDS));
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
    public synchronized List<OutboundMatchmakingEvent> selectLoadout(UUID userId, String selectedLoadout) {
        MatchSession session = activeSessionsByUserId.get(userId);
        if (session == null) {
            return List.of();
        }
        if (session.countdownEndsAt() != null) {
            return List.of(eventForPlayer(session, playerForUser(session, userId), "BOT_TESTING_SESSION_READY"));
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
                    selectedSession.withObstacles(List.of()),
                    "BOT_TESTING_SESSION_READY",
                    "Both players have selected. Starting testing session.",
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
    public synchronized List<OutboundMatchmakingEvent> resolveLoadoutSelectionTimeout(UUID matchId) {
        MatchSession session = activeSessionsByUserId.values().stream()
                .filter(candidate -> candidate.matchId().equals(matchId))
                .findFirst()
                .orElse(null);
        if (session == null || session.countdownEndsAt() != null) {
            return List.of();
        }
        if (session.loadoutSelectionEndsAt() != null && Instant.now(clock).isBefore(session.loadoutSelectionEndsAt())) {
            return List.of();
        }
        return startExpiredLoadoutSelection(session);
    }

    @Transactional
    public synchronized List<OutboundMatchmakingEvent> resolveExpiredLoadoutSelections() {
        Instant now = Instant.now(clock);
        List<MatchSession> expiredSessions = activeSessionsByUserId.values().stream()
                .distinct()
                .filter(session -> session.countdownEndsAt() == null)
                .filter(session -> session.loadoutSelectionEndsAt() != null)
                .filter(session -> !now.isBefore(session.loadoutSelectionEndsAt()))
                .toList();
        List<OutboundMatchmakingEvent> events = new ArrayList<>();
        for (MatchSession session : expiredSessions) {
            MatchSession current = activeSessionsByUserId.get(session.players().getFirst().userId());
            if (current != null && current.countdownEndsAt() == null
                    && current.loadoutSelectionEndsAt() != null
                    && !now.isBefore(current.loadoutSelectionEndsAt())) {
                events.addAll(startExpiredLoadoutSelection(current));
            }
        }
        return events;
    }

    @Transactional
    public synchronized List<OutboundMatchmakingEvent> resolveTestingTimeout(
            UUID matchId,
            Instant expectedDeadline) {
        MatchSession session = activeSessionsByUserId.values().stream()
                .distinct()
                .filter(candidate -> candidate.matchId().equals(matchId))
                .findFirst()
                .orElse(null);
        if (session == null
                || session.testingEndsAt() == null
                || !session.testingEndsAt().equals(expectedDeadline)
                || Instant.now(clock).isBefore(session.testingEndsAt())) {
            return List.of();
        }
        return resolveExpiredTesting(session);
    }

    @Transactional
    public synchronized List<OutboundMatchmakingEvent> resolveExpiredTestingSessions() {
        Instant now = Instant.now(clock);
        List<MatchSession> expiredSessions = activeSessionsByUserId.values().stream()
                .distinct()
                .filter(session -> session.testingEndsAt() != null)
                .filter(session -> !now.isBefore(session.testingEndsAt()))
                .toList();
        List<OutboundMatchmakingEvent> events = new ArrayList<>();
        for (MatchSession session : expiredSessions) {
            MatchSession current = activeSessionsByUserId.get(session.players().getFirst().userId());
            if (current != null
                    && current.testingEndsAt() != null
                    && !now.isBefore(current.testingEndsAt())) {
                events.addAll(resolveExpiredTesting(current));
            }
        }
        return events;
    }

    private List<OutboundMatchmakingEvent> resolveExpiredTesting(MatchSession session) {
        MatchSession resolvedSession = session;
        UUID firstTimedOutUserId = null;
        for (MatchPlayer player : session.players()) {
            if (player.finished()) continue;
            BotSubmission submission = matchPersistenceService.resolveTestingTimeoutSubmission(session, player);
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
                "Testing ended; the server resolved the missing bot brain.");
    }

    private List<OutboundMatchmakingEvent> startExpiredLoadoutSelection(MatchSession session) {
        return startCountdown(
                withDefaultAbilitySelections(session).withObstacles(List.of()),
                "BOT_TESTING_SESSION_READY",
                "Testing session is starting with finalized loadouts.",
                false);
    }

    /** Compatibility shim for callers compiled against the removed placement phase. */
    @Deprecated(forRemoval = true)
    public synchronized List<OutboundMatchmakingEvent> submitObjectPlacements(
            UUID userId,
            List<MatchPlaybackDTO.ObstaclePlacementDTO> ignoredObjects) {
        return List.of();
    }

    /** Compatibility shim for callers compiled against the removed placement phase. */
    @Deprecated(forRemoval = true)
    public synchronized List<OutboundMatchmakingEvent> resolveObjectPlacementTimeout(UUID matchId) {
        return List.of();
    }

    public synchronized List<OutboundMatchmakingEvent> beginInitialLoadoutSelection(UUID matchId) {
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

    public synchronized List<OutboundMatchmakingEvent> markDisconnected(String principalName) {
        return markDisconnected(principalName, null);
    }

    public synchronized List<OutboundMatchmakingEvent> markDisconnected(
            String principalName,
            String socketSessionId) {
        if (principalName == null || principalName.isBlank()) {
            return List.of();
        }
        MatchSession session = findSessionForPrincipal(principalName);
        if (session == null) {
            return List.of();
        }

        MatchPlayer disconnectedPlayer = session.players().stream()
                .filter(player -> player.principalName().equals(principalName))
                .findFirst()
                .orElseThrow();
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
    public synchronized List<OutboundMatchmakingEvent> resolveDisconnectTimeout(
            String principalName,
            Instant expectedDeadline) {
        MatchSession session = findSessionForPrincipal(principalName);
        if (session == null) {
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
            invalidatedReplayMatchIds.add(session.matchId());
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

        invalidatedReplayMatchIds.add(session.matchId());
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

    /**
     * Delayed replay batches are best-effort presentation events. Once the
     * server has resolved a disconnect for a match, those old batches must not
     * arrive after the authoritative disconnection result.
     */
    public synchronized boolean isDelayedReplayEventStillValid(UUID matchId, String eventType) {
        if (matchId == null || !invalidatedReplayMatchIds.contains(matchId)) {
            return true;
        }
        return !Set.of("MATCH_REPLAY_BATCH", "MATCH_RESULT_READY", "MATCH_ROUND_READY")
                .contains(eventType);
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

    public synchronized void requireActiveMatchForUser(UUID userId, UUID matchId) {
        MatchSession session = activeSessionsByUserId.get(userId);
        if (session == null || matchId == null || !session.matchId().equals(matchId)) {
            throw new AuthException("user is not active in this match");
        }
        playerForUser(session, userId);
    }

    public synchronized MatchChatSubmission submitChatMessage(UUID userId, UUID matchId, String rawMessage) {
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

    public synchronized Instant matchChatCloseAt(UUID matchId) {
        MatchChatWindow chatWindow = matchChatWindowsByMatchId.get(matchId);
        return chatWindow == null ? null : chatWindow.closesAt();
    }

    public synchronized MatchChatClosure closeMatchChat(UUID matchId) {
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
    public synchronized List<OutboundMatchmakingEvent> surrender(UUID userId) {
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
    public synchronized List<OutboundMatchmakingEvent> markFinished(UUID userId, UUID botSubmissionId) {
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
                playerForUser(updatedSession, userId).username() + " finished testing.");
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
    public synchronized List<OutboundMatchmakingEvent> completeSimulation(UUID matchId) {
        MatchSession simulationSession = activeSessionsByUserId.values().stream()
                .filter(session -> session.matchId().equals(matchId))
                .findFirst()
                .orElse(null);
        if (simulationSession == null
                || !simulationSession.players().stream().allMatch(MatchPlayer::finished)) {
            return List.of();
        }

        Map<UUID, BotSubmission> submissionsByUserId =
                matchPersistenceService.loadFinishedSubmissions(simulationSession);
        MatchPlaybackDTO playback = matchSimulationService.buildDuelPlayback(simulationSession, submissionsByUserId);
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
            }
        }
        PreparedReplay preparedReplay = prepareReplay(simulationSession, playback);
        MatchPlaybackDTO replayOnlyPlayback = preparedReplay.initialReplayPlayback();
        MatchPlaybackDTO preparationPlayback = preparedReplay.preparationPlayback();
        long replayDurationMillis = preparedReplay.replayDurationMillis();

        // Do not stamp the shared playback deadline until simulation, replay
        // batching, result construction, and reconnect data are all ready.
        Instant preparationCompletedAt = Instant.now(clock);
        Instant playbackStartsAt = preparationCompletedAt.plusMillis(PLAYBACK_PREP_DELAY_MILLIS);
        Instant resultRevealsAt = playbackStartsAt.plusMillis(replayDurationMillis);
        long playbackStartDelayMillis = Math.max(
                0,
                java.time.Duration.between(preparationCompletedAt, playbackStartsAt).toMillis());
        Instant roundReadyAt = resultRevealsAt.plusMillis(ROUND_RESULT_HOLD_MILLIS);
        long roundReadyDelayMillis = Math.max(
                0,
                java.time.Duration.between(preparationCompletedAt, roundReadyAt).toMillis());
        MatchSession preparedSession = simulationSession.withPlaybackStartsAt(playbackStartsAt);
        if (seriesComplete) {
            openMatchChatWindow(
                    scoredSession,
                    resultRevealsAt.plusMillis(MATCH_CHAT_RETENTION_MILLIS));
        }
        List<OutboundMatchmakingEvent> events = new ArrayList<>();
        for (MatchPlayer player : scoredSession.players()) {
            MatchPlayer replayPlayer = playerForUser(simulationSession, player.userId());
            events.add(eventForPlayer(
                    preparedSession,
                    replayPlayer,
                    "SIMULATION_PREPARING",
                    "SIMULATION_PREPARING",
                    replayOnlyPlayback,
                    "Preparing the authoritative round replay.",
                    0,
                    playbackStartsAt,
                    resultRevealsAt,
                    roundReadyAt));
            for (PreparedReplayBatch batch : preparedReplay.batches()) {
                MatchSession batchSession = batch.terminalBatch() ? scoredSession : simulationSession;
                MatchPlayer batchPlayer = batch.terminalBatch() ? player : replayPlayer;
                events.add(eventForPlayer(
                        batchSession,
                        batchPlayer,
                        "MATCH_REPLAY_BATCH",
                        "READY_FOR_PLAYBACK",
                        batch.playback(),
                        batch.terminalBatch() ? "Terminal replay frame ready." : "Replay frames ready.",
                        playbackStartDelayMillis + batch.delayAfterPlaybackStartMillis(),
                        playbackStartsAt,
                        resultRevealsAt,
                        roundReadyAt));
            }
        }
        MatchSession nextRoundSession = null;
        if (!seriesComplete) {
            nextRoundSession = scoredSession.nextRound()
                    .withLoadoutSelection(resultRevealsAt
                            .plusMillis(ROUND_RESULT_HOLD_MILLIS)
                            .plusSeconds(LOADOUT_SELECTION_SECONDS + SUBMISSION_GRACE_SECONDS));
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
                preparedSession,
                scoredSession,
                nextRoundSession,
                preparationPlayback,
                replayOnlyPlayback,
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
            List<OutboundMatchmakingEvent> events = new ArrayList<>();
            boolean playbackHasStarted = !now.isBefore(resume.playbackStartsAt());
            MatchPlaybackDTO visibleReplay = playbackHasStarted
                    ? visibleReplayForReconnect(resume, now)
                    : resume.initialReplayPlayback();
            events.add(eventForPlayer(
                    resume.replaySession(), replayPlayer, "SIMULATION_PREPARING", "SIMULATION_PREPARING",
                    visibleReplay, "Replay ready.", 0,
                    resume.playbackStartsAt(), resume.resultRevealsAt(), resume.roundReadyAt()));
            if (playbackHasStarted) {
                MatchPlaybackDTO replayBuffer = replayBufferForReconnect(resume, now);
                if (!replayBuffer.frames().isEmpty()) {
                    events.add(eventForPlayer(
                            resume.replaySession(), replayPlayer, "MATCH_REPLAY_BATCH", "READY_FOR_PLAYBACK",
                            replayBuffer, "Replay buffer ready.", 0,
                            resume.playbackStartsAt(), resume.resultRevealsAt(), resume.roundReadyAt()));
                }
            }
            return events;
        }
        if (resume.seriesComplete()) return List.of();
        if (resume.nextRoundSession() == null) return List.of();

        MatchPlayer nextRoundPlayer = playerForUser(resume.nextRoundSession(), userId);
        MatchPlayer resultPlayer = playerForUser(resume.resultSession(), userId);
        List<OutboundMatchmakingEvent> events = new ArrayList<>(List.of(
                eventForPlayer(
                            resume.resultSession(), resultPlayer, "SIMULATION_PREPARING", "SIMULATION_PREPARING",
                        visibleReplayForReconnect(resume, now), "Replay ready.", 0,
                        resume.playbackStartsAt(), resume.resultRevealsAt(), resume.roundReadyAt())));
        if (!now.isBefore(resume.roundReadyAt())) {
            events.add(eventForPlayer(
                    resume.nextRoundSession(), nextRoundPlayer, "MATCH_ROUND_READY", "LOADOUT_SELECT",
                    null, "Round " + resume.nextRoundSession().roundNumber() + " loadout ready.",
                    0, resume.playbackStartsAt(), resume.resultRevealsAt(), resume.roundReadyAt()));
        }
        return events;
    }

    private MatchPlaybackDTO visibleReplayForReconnect(ReplayResumeState resume, Instant now) {
        MatchPlaybackDTO playback = resume.replayPlayback();
        long visibleElapsedMs = Math.max(0, java.time.Duration.between(
                resume.playbackStartsAt(), now).toMillis());
        boolean terminalAuthorized = !now.isBefore(resume.resultRevealsAt());
        int finalElapsedMs = finalReplayElapsedMs(playback);
        List<MatchPlaybackDTO.ReplayFrameDTO> frames = playback.frames().stream()
                .filter(frame -> frame.elapsedMs() <= visibleElapsedMs)
                .filter(frame -> terminalAuthorized || frame.elapsedMs() < finalElapsedMs)
                .toList();
        int cursor = frames.isEmpty() ? 0 : frames.getLast().elapsedMs();
        return replayBatch(
                playback,
                playback.initialState(),
                frames,
                Math.max(0, cursor / REPLAY_BATCH_MILLIS),
                cursor,
                terminalAuthorized && cursor >= finalElapsedMs);
    }

    private MatchPlaybackDTO replayBufferForReconnect(ReplayResumeState resume, Instant now) {
        MatchPlaybackDTO playback = resume.replayPlayback();
        long visibleElapsedMs = Math.max(0, java.time.Duration.between(
                resume.playbackStartsAt(), now).toMillis());
        int finalElapsedMs = finalReplayElapsedMs(playback);
        boolean terminalAuthorized = !now.isBefore(resume.resultRevealsAt());
        long nextScheduledBatchStartMs = ((visibleElapsedMs + REPLAY_BUFFER_MILLIS)
                / REPLAY_BATCH_MILLIS + 1) * REPLAY_BATCH_MILLIS;
        long bufferEndMs = Math.max(
                visibleElapsedMs + REPLAY_BUFFER_MILLIS,
                nextScheduledBatchStartMs);
        List<MatchPlaybackDTO.ReplayFrameDTO> frames = playback.frames().stream()
                .filter(frame -> frame.elapsedMs() > visibleElapsedMs)
                .filter(frame -> frame.elapsedMs() <= bufferEndMs)
                .filter(frame -> terminalAuthorized || frame.elapsedMs() < finalElapsedMs)
                .toList();
        if (frames.isEmpty()) {
            return replayBatch(playback, null, List.of(), 0, 0, false);
        }
        int currentCursor = Math.max(0, (int) Math.min(Integer.MAX_VALUE, visibleElapsedMs));
        int sequence = Math.max(1, currentCursor / REPLAY_BATCH_MILLIS + 1);
        return replayBatch(playback, null, frames, sequence, frames.getLast().elapsedMs(), false);
    }

    private MatchPlaybackDTO initialReplayBatch(MatchPlaybackDTO playback) {
        int finalElapsedMs = finalReplayElapsedMs(playback);
        List<MatchPlaybackDTO.ReplayFrameDTO> frames = playback.frames().stream()
                .filter(frame -> frame.elapsedMs() <= REPLAY_BUFFER_MILLIS)
                .filter(frame -> frame.elapsedMs() < finalElapsedMs)
                .toList();
        int cursor = frames.isEmpty() ? 0 : frames.getLast().elapsedMs();
        return replayBatch(playback, playback.initialState(), frames, 0, cursor, finalElapsedMs == 0);
    }

    private PreparedReplay prepareReplay(
            MatchSession session,
            MatchPlaybackDTO playback) {
        MatchPlaybackDTO replayPlayback = retimeReplay(playback);
        MatchPlaybackDTO preparationPlayback = matchSimulationService.buildPreparationPlayback(session);
        if (preparationPlayback == null) {
            preparationPlayback = initialReplayBatch(replayPlayback);
        }
        MatchPlaybackDTO initialReplayPlayback = initialReplayBatch(replayPlayback);
        int replayDurationMillis = finalReplayElapsedMs(replayPlayback);
        List<PreparedReplayBatch> batches = prepareReplayBatches(replayPlayback);
        return new PreparedReplay(
                preparationPlayback,
                initialReplayPlayback,
                replayPlayback,
                replayDurationMillis,
                batches);
    }

    private MatchPlaybackDTO retimeReplay(MatchPlaybackDTO playback) {
        if (playback == null || playback.frames() == null || playback.frames().isEmpty()) return playback;
        int originalDurationMillis = finalReplayElapsedMs(playback);
        if (originalDurationMillis <= 0) return playback;

        List<MatchPlaybackDTO.ReplayFrameDTO> retimedFrames = new ArrayList<>(playback.frames().size());
        int previousElapsedMs = 0;
        for (int index = 0; index < playback.frames().size(); index++) {
            MatchPlaybackDTO.ReplayFrameDTO frame = playback.frames().get(index);
            int elapsedMs = index == playback.frames().size() - 1
                    ? REPLAY_PRESENTATION_DURATION_MILLIS
                    : (int) Math.round((double) frame.elapsedMs()
                            * REPLAY_PRESENTATION_DURATION_MILLIS
                            / originalDurationMillis);
            elapsedMs = Math.max(previousElapsedMs, elapsedMs);
            retimedFrames.add(new MatchPlaybackDTO.ReplayFrameDTO(
                    frame.tick(),
                    elapsedMs,
                    frame.fighters(),
                    frame.obstacles()));
            previousElapsedMs = elapsedMs;
        }
        return new MatchPlaybackDTO(
                playback.matchId(),
                playback.rulesetVersion(),
                playback.status(),
                playback.initialState(),
                List.copyOf(retimedFrames),
                playback.result(),
                playback.winnerUserId(),
                playback.message(),
                playback.batchSequence(),
                playback.replayCursorElapsedMs(),
                playback.terminalBatch());
    }

    private List<PreparedReplayBatch> prepareReplayBatches(MatchPlaybackDTO playback) {
        int finalElapsedMs = finalReplayElapsedMs(playback);
        if (finalElapsedMs <= 0) return List.of();
        List<PreparedReplayBatch> batches = new ArrayList<>();
        int sequence = 1;
        for (int startMs = REPLAY_BUFFER_MILLIS; startMs < finalElapsedMs; startMs += REPLAY_BATCH_MILLIS) {
            int windowStartMs = startMs;
            int endMs = Math.min(finalElapsedMs, windowStartMs + REPLAY_BATCH_MILLIS);
            List<MatchPlaybackDTO.ReplayFrameDTO> frames = playback.frames().stream()
                    .filter(frame -> frame.elapsedMs() > windowStartMs)
                    .filter(frame -> frame.elapsedMs() <= endMs)
                    .filter(frame -> frame.elapsedMs() < finalElapsedMs)
                    .toList();
            if (!frames.isEmpty()) {
                MatchPlaybackDTO batch = replayBatch(
                        playback, null, frames, sequence, frames.getLast().elapsedMs(), false);
                batches.add(new PreparedReplayBatch(
                        batch,
                        Math.max(0, windowStartMs - REPLAY_BUFFER_MILLIS),
                        false));
            }
            sequence++;
        }
        List<MatchPlaybackDTO.ReplayFrameDTO> terminalFrames = playback.frames().stream()
                .filter(frame -> frame.elapsedMs() == finalElapsedMs)
                .toList();
        if (!terminalFrames.isEmpty()) {
            MatchPlaybackDTO terminal = replayBatch(
                    playback, null, terminalFrames, sequence, finalElapsedMs, true);
            batches.add(new PreparedReplayBatch(
                    terminal,
                    Math.max(0, finalElapsedMs - REPLAY_BUFFER_MILLIS),
                    true));
        }
        return List.copyOf(batches);
    }

    private MatchPlaybackDTO replayBatch(
            MatchPlaybackDTO playback,
            MatchPlaybackDTO.ArenaStateDTO initialState,
            List<MatchPlaybackDTO.ReplayFrameDTO> frames,
            int sequence,
            int cursorElapsedMs,
            boolean terminalBatch) {
        return new MatchPlaybackDTO(
                playback.matchId(),
                playback.rulesetVersion(),
                playback.status(),
                initialState,
                List.copyOf(frames),
                terminalBatch ? playback.result() : null,
                terminalBatch ? playback.winnerUserId() : null,
                terminalBatch ? playback.message() : null,
                sequence,
                cursorElapsedMs,
                terminalBatch);
    }

    private int finalReplayElapsedMs(MatchPlaybackDTO playback) {
        return playback.frames().isEmpty() ? 0 : playback.frames().getLast().elapsedMs();
    }

    private MatchPlaybackDTO withWinner(MatchPlaybackDTO playback, UUID winnerUserId, String message) {
        return new MatchPlaybackDTO(playback.matchId(), playback.rulesetVersion(), playback.status(),
                playback.initialState(), playback.frames(), winnerUserId == null ? "DRAW" : "FIGHTER_WIN",
                winnerUserId, message);
    }

    private Map<UUID, Double> roundLossScores(MatchSession session, MatchPlaybackDTO playback) {
        Map<UUID, Double> scores = new HashMap<>();
        session.players().forEach(player -> scores.put(player.userId(), 0.0));
        if (playback.winnerUserId() == null) return Map.copyOf(scores);
        MatchPlayer winner = playerForUser(session, playback.winnerUserId());
        MatchPlayer loser = session.players().stream().filter(player -> !player.userId().equals(winner.userId())).findFirst().orElseThrow();
        if (loser.slot() == 2) {
            MatchPlaybackDTO.FighterPlacementDTO finalWinner = playback.frames().isEmpty() ? null
                    : playback.frames().getLast().fighters().stream()
                            .filter(fighter -> winner.userId().equals(fighter.userId()))
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
                includePreparationHold ? TESTING_ROOM_PREPARATION_SECONDS : 0);
        if (session.loadoutSelectionEndsAt() != null
                && countdownEndsAt.isAfter(session.loadoutSelectionEndsAt())) {
            countdownEndsAt = session.loadoutSelectionEndsAt();
        }
        Instant testingEndsAt = countdownEndsAt.plusSeconds(TESTING_SECONDS + SUBMISSION_GRACE_SECONDS);
        MatchSession countdownSession = session.withCountdown(countdownEndsAt, testingEndsAt);
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
                String code = ABILITY_CODES.get(ability.asText());
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
                .map(ABILITY_CODES::get)
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
                .map(ABILITY_CODES::get)
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
        List<String> additions = automaticAbilityPicks(session, player, drafted, missingPicks);
        String abilities = java.util.stream.Stream.concat(
                        nextCodes.chars().mapToObj(value -> Character.toString((char) value)),
                        additions.stream().map(ABILITY_CODES::get))
                .sorted()
                .collect(java.util.stream.Collectors.joining());
        return "custom:" + abilities + ":" + parts[2];
    }

    private List<String> abilityOffers(MatchSession session) {
        List<String> offers = new ArrayList<>(ROUND_ABILITIES.getOrDefault(session.roundNumber(), List.of()));
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

    private List<String> automaticAbilityPicks(
            MatchSession session,
            MatchPlayer player,
            Set<Integer> excludedCodes,
            int pickCount) {
        List<String> picks = new ArrayList<>(abilityOffers(session));
        picks.removeIf(ability -> {
            String code = ABILITY_CODES.get(ability);
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
        JsonNode columns = brain != null ? brain.get("columns") : null;
        if (columns != null && columns.isArray()) {
            columns.forEach(column -> addTreeFingerprints(
                    fingerprints,
                    column.get("branches"),
                    "column:" + fieldText(column, "id") + ":" + fieldText(column, "createdOrder")));
            return fingerprints;
        }
        JsonNode blocks = brain != null ? brain.get("blocks") : null;
        if (blocks != null && blocks.isArray()) {
            blocks.forEach(block -> addBlockFingerprint(fingerprints, block, "root"));
        }
        JsonNode clusters = brain != null ? brain.get("clusters") : null;
        if (clusters != null && clusters.isArray()) {
            clusters.forEach(cluster -> {
                String context = "cluster:"
                        + fieldText(cluster, "id") + ":"
                        + fieldText(cluster, "priority") + ":"
                        + String.valueOf(cluster.get("conditions"));
                JsonNode clusterBlocks = cluster.get("blocks");
                if (clusterBlocks != null && clusterBlocks.isArray()) {
                    clusterBlocks.forEach(block -> addBlockFingerprint(fingerprints, block, context));
                }
            });
        }
        return fingerprints;
    }

    private void addTreeFingerprints(Map<String, String> fingerprints, JsonNode branches, String context) {
        if (branches == null || !branches.isArray()) return;
        branches.forEach(branch -> {
            String branchContext = context + ":" + fieldText(branch, "branchType") + ":" + fieldText(branch, "createdOrder");
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
                : session.objectPlacementEndsAt() != null
                        ? "OBJECT_PLACEMENT"
                        : session.testingEndsAt() != null ? "TESTING" : "LOADOUT_SELECT";
        return new OutboundMatchmakingEvent(
                recipient.principalName(),
                new MatchmakingEventDTO(
                        type,
                        session.matchId(),
                        session.simulationSeed(),
                        status,
                        recipient.toDto(session.objectPlacementsByUserId().containsKey(recipient.userId())),
                        opponent == null ? null : opponent.toDto(
                                session.objectPlacementsByUserId().containsKey(opponent.userId())),
                        session.players().stream()
                                .map(player -> player.toDto(
                                        session.objectPlacementsByUserId().containsKey(player.userId())))
                                .toList(),
                        Instant.now(clock),
                        session.loadoutSelectionEndsAt(),
                        session.objectPlacementEndsAt(),
                        session.countdownEndsAt(),
                        session.testingEndsAt(),
                        session.playbackStartsAt(),
                        null,
                        MatchSimulationService.DUEL_RULESET_VERSION,
                        playback,
                        session.roundNumber(),
                        session.winsRequired(),
                        message,
                        null,
                        List.of(),
                        session.obstacles(),
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
                : session.objectPlacementEndsAt() != null
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
            UUID objectPlacementUserId,
            List<MatchPlaybackDTO.ObstaclePlacementDTO> objectPlacements) {
        return eventForPlayer(
                session,
                player,
                type,
                status,
                playback,
                message,
                objectPlacementUserId,
                objectPlacements,
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
            UUID objectPlacementUserId,
            List<MatchPlaybackDTO.ObstaclePlacementDTO> objectPlacements,
            long delayMillis) {
        return eventForPlayer(
                session,
                player,
                type,
                status,
                playback,
                message,
                objectPlacementUserId,
                objectPlacements,
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
            UUID objectPlacementUserId,
            List<MatchPlaybackDTO.ObstaclePlacementDTO> objectPlacements,
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
                objectPlacementUserId,
                objectPlacements,
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
            UUID objectPlacementUserId,
            List<MatchPlaybackDTO.ObstaclePlacementDTO> objectPlacements,
            long delayMillis,
            Instant playbackStartsAt,
            Instant resultRevealsAt,
            Instant roundReadyAt) {
        if ("MATCH_REPLAY_BATCH".equals(type)) {
            MatchmakingEventDTO replayBatchEvent = MatchmakingEventDTO.replayBatch(
                    session.matchId(),
                    MatchSimulationService.DUEL_RULESET_VERSION,
                    playback);
            if (playback != null && playback.terminalBatch()) {
                MatchmakingPlayerDTO replayOpponent = session.players().stream()
                        .filter(candidate -> !candidate.userId().equals(player.userId()))
                        .findFirst()
                        .map(candidate -> candidate.toDto(
                                session.objectPlacementsByUserId().containsKey(candidate.userId())))
                        .orElse(null);
                replayBatchEvent = replayBatchEvent.withReplayParticipants(
                        player.toDto(session.objectPlacementsByUserId().containsKey(player.userId())),
                        replayOpponent,
                        session.players().stream()
                                .map(matchPlayer -> matchPlayer.toDto(
                                        session.objectPlacementsByUserId().containsKey(matchPlayer.userId())))
                                .toList());
            }
            return new OutboundMatchmakingEvent(
                    player.principalName(),
                    replayBatchEvent,
                    delayMillis);
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
                        player.toDto(session.objectPlacementsByUserId().containsKey(player.userId())),
                        opponent == null ? null : opponent.toDto(session.objectPlacementsByUserId().containsKey(opponent.userId())),
                        session.players().stream()
                                .map(matchPlayer -> matchPlayer.toDto(
                                        session.objectPlacementsByUserId().containsKey(matchPlayer.userId())))
                                .toList(),
                        simulationPreparingEvent ? null : eventNow,
                        simulationPreparingEvent ? null : session.loadoutSelectionEndsAt(),
                        simulationPreparingEvent ? null : session.objectPlacementEndsAt(),
                        simulationPreparingEvent ? null : session.countdownEndsAt(),
                        simulationPreparingEvent ? null : session.testingEndsAt(),
                        simulationPreparingEvent ? null : playbackStartsAt,
                        simulationPreparingEvent ? null : resultRevealsAt,
                        MatchSimulationService.DUEL_RULESET_VERSION,
                        playback,
                        session.roundNumber(),
                        session.winsRequired(),
                        message,
                        objectPlacementUserId,
                        objectPlacements != null ? List.copyOf(objectPlacements) : List.of(),
                        session.obstacles(),
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
                        simulationPreparingEvent ? null : roundReadyAt,
                        simulationPreparingEvent ? null : matchChatCloseAt(session.matchId())),
                delayMillis);
    }

    private MatchPlayer playerForUser(MatchSession session, UUID userId) {
        return session.players().stream()
                .filter(player -> player.userId().equals(userId))
                .findFirst()
                .orElseThrow(() -> new AuthException("player is not in this match"));
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

    private record PreparedReplay(
            MatchPlaybackDTO preparationPlayback,
            MatchPlaybackDTO initialReplayPlayback,
            MatchPlaybackDTO replayPlayback,
            int replayDurationMillis,
            List<PreparedReplayBatch> batches) {
    }

    private record PreparedReplayBatch(
            MatchPlaybackDTO playback,
            long delayAfterPlaybackStartMillis,
            boolean terminalBatch) {
    }

    private record ReplayResumeState(
            MatchSession replaySession,
            MatchSession resultSession,
            MatchSession nextRoundSession,
            MatchPlaybackDTO preparationPlayback,
            MatchPlaybackDTO initialReplayPlayback,
            MatchPlaybackDTO replayPlayback,
            Instant playbackStartsAt,
            Instant resultRevealsAt,
            Instant roundReadyAt,
            String message,
            boolean seriesComplete) {
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

        MatchmakingPlayerDTO toDto(boolean objectPlacementSubmitted) {
            return new MatchmakingPlayerDTO(
                    userId,
                    username,
                    slot,
                    finished,
                    roundWins,
                    selectedLoadout,
                    loadoutSelected,
                    objectPlacementSubmitted);
        }
    }

    public record MatchSession(
            UUID matchId,
            long simulationSeed,
            List<MatchPlayer> players,
            Instant loadoutSelectionEndsAt,
            Instant objectPlacementEndsAt,
            Instant countdownEndsAt,
            Instant testingEndsAt,
            int roundNumber,
            int winsRequired,
            List<MatchPlaybackDTO.ObstaclePlacementDTO> obstacles,
            Map<UUID, List<MatchPlaybackDTO.ObstaclePlacementDTO>> objectPlacementsByUserId,
            Instant playbackStartsAt) {
        MatchSession(
                UUID matchId,
                long simulationSeed,
                List<MatchPlayer> players,
                Instant loadoutSelectionEndsAt,
                Instant objectPlacementEndsAt,
                Instant countdownEndsAt,
                Instant testingEndsAt,
                int roundNumber,
                int winsRequired,
                List<MatchPlaybackDTO.ObstaclePlacementDTO> obstacles,
                Map<UUID, List<MatchPlaybackDTO.ObstaclePlacementDTO>> objectPlacementsByUserId) {
            this(
                    matchId,
                    simulationSeed,
                    players,
                    loadoutSelectionEndsAt,
                    objectPlacementEndsAt,
                    countdownEndsAt,
                    testingEndsAt,
                    roundNumber,
                    winsRequired,
                    obstacles,
                    objectPlacementsByUserId,
                    null);
        }

        MatchSession withObstacles(List<MatchPlaybackDTO.ObstaclePlacementDTO> obstacles) {
            return new MatchSession(
                    matchId,
                    simulationSeed,
                    players,
                    loadoutSelectionEndsAt,
                    objectPlacementEndsAt,
                    countdownEndsAt,
                    testingEndsAt,
                    roundNumber,
                    winsRequired,
                    obstacles != null ? List.copyOf(obstacles) : List.of(),
                    objectPlacementsByUserId,
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
                    objectPlacementEndsAt,
                    countdownEndsAt,
                    testingEndsAt,
                    roundNumber,
                    winsRequired,
                    obstacles,
                    objectPlacementsByUserId,
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
                    objectPlacementEndsAt,
                    countdownEndsAt,
                    testingEndsAt,
                    roundNumber,
                    winsRequired,
                    obstacles,
                    objectPlacementsByUserId,
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
                    loadoutSelectionEndsAt,
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
            return new MatchSession(matchId, simulationSeed, players, deadline, null, null, null,
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
                    objectPlacementEndsAt,
                    countdownEndsAt,
                    testingEndsAt,
                    roundNumber,
                    winsRequired,
                    obstacles,
                    objectPlacementsByUserId,
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
                    objectPlacementEndsAt,
                    countdownEndsAt,
                    testingEndsAt,
                    roundNumber,
                    winsRequired,
                    obstacles,
                    objectPlacementsByUserId,
                    playbackStartsAt);
        }

        MatchSession withObjectPlacement(Instant nextObjectPlacementEndsAt) {
            return new MatchSession(
                    matchId,
                    simulationSeed,
                    players,
                    loadoutSelectionEndsAt,
                    nextObjectPlacementEndsAt,
                    null,
                    null,
                    roundNumber,
                    winsRequired,
                    List.of(),
                    Map.of(),
                    null);
        }

        MatchSession withObjectPlacements(UUID userId, List<MatchPlaybackDTO.ObstaclePlacementDTO> objects) {
            Map<UUID, List<MatchPlaybackDTO.ObstaclePlacementDTO>> placements = new HashMap<>(objectPlacementsByUserId);
            placements.put(userId, List.copyOf(objects != null ? objects : List.of()));
            return new MatchSession(
                    matchId,
                    simulationSeed,
                    players,
                    loadoutSelectionEndsAt,
                    objectPlacementEndsAt,
                    countdownEndsAt,
                    testingEndsAt,
                    roundNumber,
                    winsRequired,
                    obstacles,
                    Map.copyOf(placements),
                    playbackStartsAt);
        }

        MatchSession withCountdown(Instant nextCountdownEndsAt, Instant nextTestingEndsAt) {
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
                    nextTestingEndsAt,
                    roundNumber,
                    winsRequired,
                    obstacles,
                    objectPlacementsByUserId,
                    null);
        }

        MatchSession withPlaybackStartsAt(Instant deadline) {
            return new MatchSession(
                    matchId,
                    simulationSeed,
                    players,
                    loadoutSelectionEndsAt,
                    objectPlacementEndsAt,
                    countdownEndsAt,
                    testingEndsAt,
                    roundNumber,
                    winsRequired,
                    obstacles,
                    objectPlacementsByUserId,
                    deadline);
        }
    }

    public record OutboundMatchmakingEvent(String principalName, MatchmakingEventDTO event, long delayMillis) {
        public OutboundMatchmakingEvent(String principalName, MatchmakingEventDTO event) {
            this(principalName, event, 0);
        }
    }
}
